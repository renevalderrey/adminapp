import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import api from '@/services/api'
import useStore from '@/store/useStore'
import { usePermission } from '@/hooks/usePermission'
import { enviarPedidoPorWhatsapp } from '@/utils/pedidoWhatsapp'
import { fechaDeHoy, pesos } from '@/utils/formato'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { faltaElPermiso } from '@/utils/permisos'
import { ESPERA_DE_BUSQUEDA } from '@/utils/busqueda'
import PageHeader from '@/components/PageHeader'
import EstadoVacio from '@/components/EstadoVacio'
import {
  AlertTriangle, MessageCircle, FileSpreadsheet, ShoppingCart, RefreshCw, Minus, Plus,
  PackageCheck, Loader2, Check,
} from 'lucide-react'

// ════════════════════════════════════════════
//  Faltantes → pedido
//
//  La rutina semanal de reposición: mirar qué falta, poner cantidades, mandarlo
//  al proveedor. El sistema anterior tenía esta pantalla; acá había una alerta
//  de stock bajo en el panel, pero suelta — sin proveedor, sin costo y sin
//  cantidad sugerida, así que armar el pedido seguía siendo a mano.
//
//  Se agrupa por proveedor porque es la unidad en la que se pide.
//
//  ── Lo que se corrigió en el hito 9, y por qué estaba ──
//
//  Ésta es la única de las doce pantallas que **nunca entró a un hito de
//  rediseño**: no es una que se desalineó, es una que nunca se alineó. Y hasta
//  el hito 9 no tenía **una sola prueba**, aunque crea órdenes de compra, manda
//  WhatsApp y exporta a Excel.
//
//  El orden del informe fue guardia → test de render → reescritura, y no es un
//  detalle de proceso: reescribir presentación sin una red que diga qué hacía la
//  pantalla es cómo se pierde una regla de negocio sin que nadie se entere. Acá
//  las reglas son «cuánto pedirle a quién» y «qué importe tiene ese pedido».
//
//  Lo que apareció al escribir esa red:
//
//   1. **El `<label>` del umbral no estaba asociado a su campo.** Con un lector
//      de pantalla el número no tiene nombre, y hacer clic en la palabra no
//      enfoca el campo. Lo encontró el test, no una lectura.
//   2. **Dos clics en «Orden de compra» creaban DOS órdenes.** Es el mismo molde
//      que el doble pago de la cuenta corriente, y acá también es plata: dos
//      órdenes duplican la deuda con el proveedor cuando se reciben.
//   3. **Los importes se formateaban con `toLocaleString('es-AR')` a secas**, o
//      sea máximo tres decimales por defecto: `$1.234,567` al lado de
//      `$1.200`. Es el defecto exacto que `utils/formato.js` existe para evitar.
//   4. **El botón de orden de compra no miraba ningún permiso.** Quien no puede
//      crearlas apretaba, comía un 403 y no sabía por qué.
//   5. **El umbral consultaba en cada tecla.** Escribir «100» son tres consultas
//      a un endpoint que barre el inventario entero.
//   6. **Nada decía que la orden ya se había creado**, así que la única forma de
//      no crearla dos veces era acordarse.
// ════════════════════════════════════════════

export default function Faltantes() {
  const [datos, setDatos] = useState(null)

  // ⚠ Arranca en `true`, no en `false`.
  //
  // El `useEffect` de abajo consulta al montar, así que el primer render SIEMPRE
  // es una carga en curso. Con `false` había un frame en el que ni el spinner ni
  // el vacío ni los datos se dibujaban: la pantalla quedaba en blanco.
  const [cargando, setCargando] = useState(true)

  // Lo tipeado, y lo que de verdad se le pregunta al servidor. Son DOS estados
  // porque la consulta va con rebote: mientras se escribe «100», el campo dice
  // 100 y el filtro todavía dice 10.
  const [umbralTipeado, setUmbralTipeado] = useState(3)
  const [umbral, setUmbral] = useState(3)

  // Cantidades editadas por el usuario, por product_id. Arrancan en la
  // sugerida y se pisan al tocar los botones.
  const [cantidades, setCantidades] = useState({})
  const [excluidos, setExcluidos] = useState(new Set())
  const [nota, setNota] = useState('')

  // Los proveedores a los que ya se les creó la orden en esta pasada.
  const [ordenados, setOrdenados] = useState(new Set())

  // ⚠ Un `useRef` y no un estado: un estado se lee actualizado recién en el
  // render siguiente, así que dos clics de la misma tanda entran los dos. Es el
  // mismo molde del cobro del punto de venta y del pago a proveedores.
  const creandoOrden = useRef(new Set())

  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)
  const { can } = usePermission()

  const puedeCrearOrdenes = can('ordenes_compra.crear')

  // El rebote del umbral. Sale de `utils/busqueda.js` porque es el mismo tiempo
  // que espera cualquier campo de esta aplicación antes de consultar.
  useEffect(() => {
    if (umbralTipeado === umbral) return undefined

    const reloj = setTimeout(() => setUmbral(umbralTipeado), ESPERA_DE_BUSQUEDA)

    return () => clearTimeout(reloj)
  }, [umbralTipeado, umbral])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ umbral: String(umbral) })
      if (puntoDeVentaActivo?.id) params.set('punto_de_venta_id', puntoDeVentaActivo.id)

      const res = await api.get(`/faltantes?${params}`)
      const data = res.data?.data || null
      setDatos(data)

      // Las cantidades se reinician con cada carga: si cambió el stock, la
      // sugerencia vieja ya no vale. Las órdenes ya creadas también: es una
      // lista nueva.
      const iniciales = {}
      for (const grupo of data?.proveedores || []) {
        for (const item of grupo.items) iniciales[item.product_id] = item.sugerido
      }
      setCantidades(iniciales)
      setExcluidos(new Set())
      setOrdenados(new Set())
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudieron cargar los faltantes.'))
    } finally {
      setCargando(false)
    }
  }, [umbral, puntoDeVentaActivo?.id])

  useEffect(() => { cargar() }, [cargar])

  const cantidadDe = (item) => {
    const valor = cantidades[item.product_id]
    return valor === undefined ? item.sugerido : valor
  }

  const cambiarCantidad = (productId, valor) => {
    const numero = Math.max(0, Math.floor(Number(valor) || 0))
    setCantidades(prev => ({ ...prev, [productId]: numero }))
  }

  const alternarExcluido = (productId) => {
    setExcluidos(prev => {
      const siguiente = new Set(prev)
      if (siguiente.has(productId)) siguiente.delete(productId)
      else siguiente.add(productId)
      return siguiente
    })
  }

  /** Lo que realmente se va a pedir de un proveedor. */
  const itemsAPedir = useCallback((grupo) => (
    grupo.items
      .filter(i => !excluidos.has(i.product_id) && cantidadDe(i) > 0)
      .map(i => ({
        nombre: i.nombre,
        cantidad: cantidadDe(i),
        marca: i.marca,
        costo: i.costo,
        product_id: i.product_id,
      }))
  ), [cantidades, excluidos])

  const enviarWhatsapp = (grupo, conPrecios) => {
    const items = itemsAPedir(grupo)

    if (items.length === 0) {
      toast.error('No hay nada para pedir de este proveedor.')
      return
    }

    const { conDestinatario } = enviarPedidoPorWhatsapp({
      items,
      telefono: grupo.proveedor?.telefono,
      proveedor: grupo.proveedor?.nombre,
      conPrecios,
      nota,
      titulo: 'PEDIDO DE REPOSICIÓN',
    })

    if (!conDestinatario) {
      toast.info('El proveedor no tiene teléfono cargado: elegí el contacto en WhatsApp.')
    }
  }

  const exportarExcel = (grupo) => {
    const items = itemsAPedir(grupo)

    if (items.length === 0) {
      toast.error('No hay nada para exportar.')
      return
    }

    const filas = items.map(i => ({
      Producto: i.nombre,
      Marca: i.marca || '',
      Cantidad: i.cantidad,
      'Costo unitario': i.costo,
      Subtotal: Math.round(i.costo * i.cantidad * 100) / 100,
    }))

    const hoja = XLSX.utils.json_to_sheet(filas)
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Pedido')

    const proveedor = (grupo.proveedor?.nombre || 'sin-proveedor').replace(/[^\w-]+/g, '_')
    XLSX.writeFile(libro, `pedido_${proveedor}_${fechaDeHoy()}.xlsx`)
  }

  const crearOrdenDeCompra = async (grupo) => {
    if (!grupo.supplier_id) {
      toast.error('Este grupo no tiene proveedor asignado. Asignale uno a los productos primero.')
      return
    }

    // ⚠ El cerrojo, por proveedor. Dos clics en la misma tanda creaban DOS
    // órdenes de compra al mismo proveedor, y cuando las dos se reciben la
    // deuda queda duplicada. Es plata, y del lado que peor se detecta.
    if (creandoOrden.current.has(grupo.supplier_id)) return
    creandoOrden.current.add(grupo.supplier_id)

    try {
      const items = itemsAPedir(grupo)
      if (items.length === 0) {
        toast.error('No hay nada para pedir de este proveedor.')
        return
      }

      await api.post(`/suppliers/${grupo.supplier_id}/orders`, {
        // ⚠ `fechaDeHoy()` y NO `new Date().toISOString()`. El ISO da la fecha
        // en UTC, y en Argentina —UTC-3— desde las 21:00 ya es el día
        // siguiente allá. Una reposición cargada un jueves a las 22:00 se
        // asentaba en la cuenta del proveedor con fecha del viernes.
        //
        // Y esta pantalla NO dibuja la fecha en ningún lado, así que nadie lo
        // veía acá: aparecía después, en la cuenta corriente, corrido de día y
        // a veces de mes.
        date: fechaDeHoy(),
        notes: nota || 'Reposición de faltantes',
        items: items.map(i => ({
          product_id: i.product_id,
          product_name: i.nombre,
          quantity: i.cantidad,
          unit_price: i.costo,
        })),
      })

      // La marca queda a la vista: sin ella, la única forma de no crear la misma
      // orden dos veces era acordarse.
      setOrdenados(prev => new Set(prev).add(grupo.supplier_id))
      toast.success(`Orden de compra creada para ${grupo.proveedor?.nombre}.`)
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo crear la orden de compra.'))
    } finally {
      // Se suelta SIEMPRE, incluidos los dos `return` de arriba. Sin esto, un
      // solo intento fallido dejaría el botón inerte por el resto de la sesión.
      creandoOrden.current.delete(grupo.supplier_id)
    }
  }

  const totalAPedir = useMemo(() => {
    if (!datos) return { items: 0, importe: 0 }

    let items = 0
    let importe = 0

    for (const grupo of datos.proveedores) {
      for (const item of itemsAPedir(grupo)) {
        items += 1
        importe += (Number(item.costo) || 0) * item.cantidad
      }
    }

    return { items, importe: Math.round(importe * 100) / 100 }
  }, [datos, itemsAPedir])

  return (
    <div className="anim-subida flex flex-col gap-6">
      <PageHeader
        titulo="Faltantes"
        descripcion={
          'Lo que hay que reponer, agrupado por proveedor.'
          + (puntoDeVentaActivo?.name ? ` Sucursal: ${puntoDeVentaActivo.name}.` : '')
        }
        icono={AlertTriangle}
      >
        {/* ⚠ `htmlFor` e `id`. El `<label>` estaba suelto: con un lector de
            pantalla el campo no tenía nombre, y hacer clic en la palabra
            «Umbral» no lo enfocaba. Lo encontró el test de render. */}
        <label htmlFor="umbral-de-faltantes" className="eyebrow">
          Umbral
        </label>
        <input
          id="umbral-de-faltantes"
          type="number"
          min="0"
          value={umbralTipeado}
          onChange={e => setUmbralTipeado(Math.max(0, Number(e.target.value) || 0))}
          title="Para los productos que no tienen stock mínimo cargado"
          className="num h-[34px] w-20 rounded-lg border border-border bg-surface px-2.5 text-[13px]
                     transition-colors focus-visible:border-brand focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={cargar}
          disabled={cargando}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3
                     text-[13px] font-medium transition-colors hover:border-border-2 hover:bg-surface-3
                     focus-visible:border-brand focus-visible:outline-none
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-fg-3 ${cargando ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </PageHeader>

      {/* ── Los dos números del pedido, y la nota ── */}
      <section className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-surface px-5 py-4 shadow-nivel-1">
        <div>
          <p className="eyebrow">Productos a pedir</p>
          <p className="num mt-1 text-[26px] font-semibold leading-none">{totalAPedir.items}</p>
        </div>

        <div className="h-10 w-px bg-border" />

        <div>
          <p className="eyebrow">Costo estimado</p>
          {/* `pesos()` y no `toLocaleString()` a secas: sin el máximo de
              decimales, un costo con tres decimales salía «$1.234,567» al lado
              de otro que salía «$1.200». */}
          <p className="num mt-1 text-[26px] font-semibold leading-none">
            ${pesos(totalAPedir.importe)}
          </p>
        </div>

        <div className="h-10 w-px bg-border" />

        <div className="min-w-[240px] flex-1">
          <label htmlFor="nota-del-pedido" className="eyebrow">
            Nota para el proveedor
          </label>
          <input
            id="nota-del-pedido"
            value={nota}
            onChange={e => setNota(e.target.value)}
            placeholder="Ej: entregar por la mañana"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px]
                       transition-colors focus-visible:border-brand focus-visible:outline-none"
          />
        </div>
      </section>

      {/* ⚠ El orden de las tres ramas no es negociable: cargando → vacío →
          datos. Con el vacío primero, la pantalla afirma «no falta nada»
          mientras los faltantes viajan — y le dice a alguien que su inventario
          está bien justo cuando se está formando la primera impresión. */}
      {cargando && !datos ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
        </div>
      ) : datos && datos.proveedores.length === 0 ? (
        <section className="rounded-xl border border-border bg-surface shadow-nivel-1">
          <EstadoVacio
            icono={PackageCheck}
            codigo="sin_faltantes"
            titulo="No falta nada."
            detalle={`Ningún producto está por debajo de su mínimo (ni del umbral de ${umbral}).`}
          />
        </section>
      ) : (
        datos?.proveedores.map(grupo => {
          const yaOrdenado = grupo.supplier_id && ordenados.has(grupo.supplier_id)

          return (
            <section
              key={grupo.supplier_id || 'sin-proveedor'}
              className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1"
            >
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <h2>{grupo.proveedor?.nombre || 'Sin proveedor asignado'}</h2>
                  <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
                    {grupo.items.length}
                  </span>
                  {yaOrdenado && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-ok-line bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">
                      <Check className="h-3 w-3" />
                      Orden creada
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <BotonDeGrupo onClick={() => enviarWhatsapp(grupo, false)}>
                    <MessageCircle className="h-3.5 w-3.5 text-fg-3" />
                    WhatsApp
                  </BotonDeGrupo>

                  <BotonDeGrupo
                    onClick={() => enviarWhatsapp(grupo, true)}
                    title="Incluye los costos de compra en el mensaje"
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-fg-3" />
                    Con precios
                  </BotonDeGrupo>

                  <BotonDeGrupo onClick={() => exportarExcel(grupo)}>
                    <FileSpreadsheet className="h-3.5 w-3.5 text-fg-3" />
                    Excel
                  </BotonDeGrupo>

                  {/* Sin proveedor no hay a quién pedirle: el botón no existe.
                      Sin el permiso SÍ existe, apagado y con el motivo — que es
                      la regla del sistema: deshabilitar diciendo por qué, no
                      esconder. */}
                  {grupo.supplier_id && (
                    <button
                      type="button"
                      onClick={() => crearOrdenDeCompra(grupo)}
                      disabled={!puedeCrearOrdenes}
                      title={
                        puedeCrearOrdenes
                          ? 'Crea la orden de compra con lo tildado'
                          : faltaElPermiso('ordenes_compra.crear')
                      }
                      className="inline-flex h-[30px] items-center gap-1.5 rounded-lg bg-brand px-3
                                 text-[12.5px] font-semibold text-brand-fg transition-colors hover:bg-brand-2
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40
                                 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" />
                      Orden de compra
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1 p-3">
                {grupo.items.map(item => {
                  const excluido = excluidos.has(item.product_id)
                  const cantidad = cantidadDe(item)

                  return (
                    <div
                      key={item.product_id}
                      className={`flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2
                                  ${excluido ? 'opacity-40' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!excluido}
                        onChange={() => alternarExcluido(item.product_id)}
                        aria-label={`Pedir ${item.nombre}`}
                        className="h-4 w-4 shrink-0 accent-brand"
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold">{item.nombre}</p>
                        <p className="text-[12px] text-fg-2">
                          {item.marca || 'Sin marca'} · stock <span className="num">{item.stock}</span>
                          {item.min_stock > 0
                            ? <> / mín. <span className="num">{item.min_stock}</span></>
                            : ' (sin mínimo cargado)'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        <BotonDePaso
                          onClick={() => cambiarCantidad(item.product_id, cantidad - 1)}
                          etiqueta={`Sacar uno de ${item.nombre}`}
                        >
                          <Minus className="h-3 w-3" />
                        </BotonDePaso>

                        <input
                          type="number"
                          min="0"
                          value={cantidad}
                          onChange={e => cambiarCantidad(item.product_id, e.target.value)}
                          aria-label={`Cantidad de ${item.nombre}`}
                          className="num h-7 w-16 rounded-lg border border-border bg-surface text-center text-[13px]
                                     transition-colors focus-visible:border-brand focus-visible:outline-none"
                        />

                        <BotonDePaso
                          onClick={() => cambiarCantidad(item.product_id, cantidad + 1)}
                          etiqueta={`Agregar uno de ${item.nombre}`}
                        >
                          <Plus className="h-3 w-3" />
                        </BotonDePaso>
                      </div>

                      <div className="num w-24 text-right text-[13px] font-semibold">
                        ${pesos((Number(item.costo) || 0) * cantidad)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

/** Un botón secundario del encabezado de un grupo. */
function BotonDeGrupo({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3
                 text-[12.5px] font-medium transition-colors hover:border-border-2 hover:bg-surface-3
                 focus-visible:border-brand focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

/**
 * El «−» y el «+» de una cantidad.
 *
 * `etiqueta` no es opcional: sin ella, con un lector de pantalla los dos botones
 * de cada fila se anuncian como «botón» a secas, y en una lista de veinte
 * productos hay cuarenta botones sin nombre.
 */
function BotonDePaso({ onClick, etiqueta, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      className="inline-grid h-7 w-7 place-items-center rounded-lg border border-border bg-surface
                 text-fg-2 transition-colors hover:border-border-2 hover:bg-surface-3
                 focus-visible:border-brand focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
