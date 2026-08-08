import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { Can } from '@/components/Can'
import {
  Scale, Plus, Trash2, Eye, EyeOff, FileSpreadsheet, Loader2, TrendingDown, Info, ClipboardList,
} from 'lucide-react'
// El `pesos` propio de esta pantalla NO era el de siempre: mostraba los
// centavos solo si el precio los tenía. Esa diferencia es deliberada —ver
// `pesosDeLista` en utils/formato.js— y por eso se mudó con nombre propio en
// vez de aplanarse contra `pesos`.
import { pesosDeLista, fechaDeHoy } from '@/utils/formato'
import { mensajeDeError } from '@/utils/erroresDeApi'

// ════════════════════════════════════════════
//  Comparador de proveedores
//
//  La última función del sistema anterior que faltaba. Se cargan las listas de
//  precios de varios proveedores y la pantalla dice quién tiene cada producto
//  más barato. Es como se decide a quién comprarle.
//
//  Esta pantalla es además la REFERENCIA VIVA de docs/REGLAS-DISENO.md:
//  encabezado de pantalla, tarjetas, tabla en grid, badges de estado, estados
//  vacíos. Cuando algo del documento no se entienda, mirar acá.
// ════════════════════════════════════════════

/** Clases del botón secundario del sistema (34px, borde, hover en surface-3). */
const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface ' +
  'px-3 text-[13px] font-medium transition-colors hover:bg-surface-3'

export default function Comparador() {
  const [listas, setListas] = useState([])
  const [comparacion, setComparacion] = useState(null)
  // Arranca en `true` para que el PRIMER pintado —antes de que corra el efecto—
  // ya muestre el spinner y no el vacío.
  //
  // ⚠ Es la mitad defensiva, y conviene saber que **ningún test la puede
  // verificar**: `cargar()` hace `setCargando(true)` en su primera línea, así
  // que en jsdom, con el render envuelto en `act`, el valor inicial nunca se
  // observa. Se comprobó por mutación: volverlo a `false` deja los siete casos
  // en verde.
  //
  // Lo que sí carga el peso —y sí se pone en rojo— es **el orden de las tres
  // ramas** de más abajo: cargando, después vacío, después datos. Al revés, la
  // pantalla afirmaba «Todavía no cargaste ninguna lista» al lado de su propio
  // spinner, durante toda la request.
  //
  // `pages/Expenses.jsx` ya lo había resuelto, con siete líneas de comentario
  // explicando el caso. La corrección existía y no se había llevado a las otras.
  const [cargando, setCargando] = useState(true)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)

  const { confirm, ConfirmDialog } = useConfirmDialog()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [resListas, resComp] = await Promise.all([
        api.get('/comparador/listas'),
        api.get('/comparador'),
      ])

      setListas(resListas.data?.data || [])
      setComparacion(resComp.data?.data || null)
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudieron cargar las listas de proveedores.'))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const alternarActiva = async (lista) => {
    try {
      await api.put(`/comparador/listas/${lista.id}`, { activa: !lista.activa })
      cargar()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo cambiar el estado de la lista.'))
    }
  }

  const eliminar = async (lista) => {
    const ok = await confirm(`¿Eliminar la lista "${lista.nombre}"?`, {
      verbo: 'Eliminar lista',
    })
    if (!ok) return

    try {
      await api.delete(`/comparador/listas/${lista.id}`)
      cargar()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo eliminar la lista.'))
    }
  }

  const activas = useMemo(() => listas.filter(l => l.activa), [listas])
  const grupos = comparacion?.grupos || []

  const exportar = () => {
    if (grupos.length === 0) {
      toast.error('No hay nada para exportar.')
      return
    }

    const filas = grupos.map(g => {
      const fila = {
        Producto: g.nombre,
        Proveedores: g.cantidad_proveedores,
        'Más barato': g.precios[0]?.proveedor || '',
        'Precio mínimo': g.precio_minimo,
        'Precio máximo': g.precio_maximo,
        Diferencia: g.diferencia,
        'Diferencia %': g.diferencia_pct,
      }

      for (const lista of activas) {
        fila[lista.nombre] = g.precios.find(p => p.lista_id === lista.id)?.precio ?? ''
      }

      return fila
    })

    const hoja = XLSX.utils.json_to_sheet(filas)
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Comparación')
    XLSX.writeFile(libro, `comparacion_proveedores_${fechaDeHoy()}.xlsx`)
  }

  // Una columna por proveedor activo. El grid se arma a mano porque el ancho
  // depende de cuántas listas haya cargadas.
  const columnas = {
    gridTemplateColumns: `minmax(0,1.6fr) ${activas.map(() => 'minmax(120px,1fr)').join(' ')} 132px`,
  }

  return (
    <div className="anim-subida mx-auto flex max-w-[1320px] flex-col gap-6">

      {/* ── Encabezado de pantalla ── */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-brand" />
            Comparador de proveedores
          </h1>
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">
            Cargá las listas de precios de cada proveedor y mirá quién tiene cada
            producto más barato. Los productos se emparejan por nombre, así que
            conviene revisar los que tengan poca coincidencia.
          </p>
        </div>

        <div className="flex gap-2">
          <button className={BOTON_SECUNDARIO} onClick={exportar}>
            <FileSpreadsheet className="h-3.5 w-3.5 text-fg-3" />
            Exportar
          </button>

          {/* ⚠ Sin el permiso el botón se DESHABILITA con su motivo, no se esconde.
              Escondiéndolo, el estado vacío de abajo le decía al usuario «Pegá la
              lista de precios que te manda cada proveedor» y le sacaba de la
              pantalla el único botón que hace eso: la pantalla le pedía algo y
              le escondía cómo hacerlo. Es la llamada de soporte «a mí no me
              sale». La regla está en REGLAS-DISENO → «Controles apagados». */}
          <Can
            codigo="proveedores.crear"
            fallback={
              <button
                disabled
                title="Te falta el permiso «proveedores.crear». Pediselo a quien administra la empresa."
                className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px]
                           font-semibold text-white shadow-nivel-1
                           disabled:cursor-not-allowed disabled:opacity-55"
              >
                <Plus className="h-4 w-4" />
                Cargar lista
              </button>
            }
          >
            <button
              className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px]
                         font-semibold text-white shadow-nivel-1 transition-colors hover:bg-brand-dark
                         focus-visible:border-brand focus-visible:outline-none"
              onClick={() => setDialogoAbierto(true)}
            >
              <Plus className="h-4 w-4" />
              Cargar lista
            </button>
          </Can>
        </div>
      </div>

      {/* ── Listas cargadas ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <h2>Listas cargadas</h2>
          <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
            {listas.length}
          </span>
          <div className="flex-1" />
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
        </div>

        {cargando ? (
          /* ⚠ La carga va ANTES del vacío, y ése es el orden que fija
             REGLAS-DISENO → «Carga». Al revés, la pantalla afirma «Todavía no
             cargaste ninguna lista» mientras las listas viajan por la red: le
             dice al usuario que su sistema está vacío justo cuando se está
             formando la primera impresión. */
          <div className="grid place-items-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        ) : listas.length === 0 ? (
          <div className="py-12 text-center">
            <ClipboardList className="mx-auto h-7 w-7 text-fg-3" />
            <p className="mt-3 font-semibold">Todavía no cargaste ninguna lista.</p>
            <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
              Pegá la lista de precios que te manda cada proveedor. Con dos o más
              podés compararlas.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {listas.map(lista => (
              <div key={lista.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">{lista.nombre}</p>
                  <p className="text-xs text-fg-3">
                    <span className="num">{lista.cantidad_items}</span> productos · {lista.fecha}
                  </p>
                </div>

                {lista.activa ? (
                  <span className="rounded-md border border-ok-line bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
                    En la comparación
                  </span>
                ) : (
                  <span className="rounded-md border border-border bg-surface-3 px-2 py-0.5 text-xs font-semibold text-fg-3">
                    Archivada
                  </span>
                )}

                <Can codigo="proveedores.editar">
                  <button
                    onClick={() => alternarActiva(lista)}
                    title={lista.activa ? 'Sacar de la comparación' : 'Volver a incluirla'}
                    className="grid h-[29px] w-[29px] place-items-center rounded-lg text-fg-3
                               transition-colors hover:bg-surface-3 hover:text-foreground"
                  >
                    {lista.activa ? <EyeOff className="h-[15px] w-[15px]" /> : <Eye className="h-[15px] w-[15px]" />}
                  </button>
                </Can>

                <Can codigo="proveedores.eliminar">
                  <button
                    onClick={() => eliminar(lista)}
                    title="Eliminar"
                    className="grid h-[29px] w-[29px] place-items-center rounded-lg text-fg-3
                               transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="h-[15px] w-[15px]" />
                  </button>
                </Can>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Resumen ── */}
      {comparacion && comparacion.proveedores.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta
            etiqueta="Productos comparables"
            valor={comparacion.comparables}
            nota="Están en dos o más listas"
          />
          <Tarjeta
            etiqueta="Solo en un proveedor"
            valor={comparacion.solo_en_uno}
            nota="No se pueden comparar"
          />
          {comparacion.proveedores
            .slice()
            .sort((a, b) => b.gana - a.gana)
            .slice(0, 2)
            .map(p => (
              <Tarjeta
                key={p.lista_id}
                etiqueta={p.nombre}
                valor={p.gana}
                nota="Productos en los que es el más barato"
              />
            ))}
        </div>
      )}

      {/* ── Comparación ── */}
      {comparacion?.aviso ? (
        <div className="flex items-start gap-3 rounded-xl border border-info-line bg-info-soft px-5 py-4">
          <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-info" />
          <div>
            <p className="text-[13.5px] font-semibold text-info">{comparacion.aviso}</p>
            <p className="mt-0.5 text-[13px] text-fg-2">
              Cargá la lista de otro proveedor para empezar a comparar.
            </p>
          </div>
        </div>
      ) : grupos.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
            <h2>Comparación</h2>
            <span className="num rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-dark">
              {grupos.length}
            </span>
            <div className="flex-1" />
            <span className="text-[12.5px] text-fg-3">
              El precio más bajo de cada fila va resaltado
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="eyebrow grid gap-x-4 border-b border-border bg-surface-2 px-5 py-2.5" style={columnas}>
                <span>Producto</span>
                {activas.map(l => (
                  <span key={l.id} className="text-right">{l.nombre}</span>
                ))}
                <span className="text-right">Diferencia</span>
              </div>

              {grupos.map((g, i) => {
                const dudoso = g.precios.some(p => p.coincidencia < 0.6 && p.coincidencia < 1)

                return (
                  <div
                    key={`${g.nombre}-${i}`}
                    className="grid items-center gap-x-4 border-b border-border px-5 py-3.5 transition-colors hover:bg-surface-2"
                    style={columnas}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px]" title={g.nombre}>{g.nombre}</p>
                      {dudoso && (
                        <p className="mt-0.5 text-[11px] font-medium text-warn" title="Los nombres no se parecen tanto: conviene revisar que sea el mismo producto">
                          coincidencia parcial · revisar
                        </p>
                      )}
                    </div>

                    {activas.map(lista => {
                      const precio = g.precios.find(p => p.lista_id === lista.id)

                      if (!precio) {
                        return (
                          <span key={lista.id} className="text-right text-[13px] text-fg-3">
                            —
                          </span>
                        )
                      }

                      const esElMasBarato = g.cantidad_proveedores > 1 && precio.lista_id === g.mas_barato

                      return (
                        <span key={lista.id} className="flex justify-end">
                          <span
                            className={`num rounded-md px-2 py-0.5 text-[13.5px] ${
                              esElMasBarato
                                ? 'border border-ok-line bg-ok-soft font-semibold text-ok'
                                : 'font-medium'
                            }`}
                            title={precio.nombre}
                          >
                            ${pesosDeLista(precio.precio)}
                          </span>
                        </span>
                      )
                    })}

                    <span className="flex justify-end">
                      {g.cantidad_proveedores > 1 ? (
                        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-fg-2">
                          <TrendingDown className="h-3.5 w-3.5 text-ok" />
                          <span className="num">${pesosDeLista(g.diferencia)}</span>
                          <span className="num text-fg-3">({g.diferencia_pct}%)</span>
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-fg-3">un proveedor</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      <DialogoCargarLista
        open={dialogoAbierto}
        onOpenChange={setDialogoAbierto}
        onCargada={cargar}
      />

      <ConfirmDialog />
    </div>
  )
}

/** Tarjeta de dato del resumen. */
function Tarjeta({ etiqueta, valor, nota }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-[18px] shadow-nivel-1">
      <span className="truncate text-[11.5px] font-semibold text-fg-2" title={etiqueta}>
        {etiqueta}
      </span>
      <span className="num text-[26px] font-semibold leading-none">{valor}</span>
      <span className="text-[11.5px] text-fg-3">{nota}</span>
    </div>
  )
}

/**
 * Carga de una lista.
 *
 * Se acepta texto pegado además de Excel porque así es como llegan: en el
 * cuerpo de un mail o en un PDF del que se copia. Obligar a armar un Excel
 * antes es lo que hace que la función no se use.
 */
function DialogoCargarLista({ open, onOpenChange, onCargada }) {
  const [nombre, setNombre] = useState('')
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)

  const guardar = async (items) => {
    if (!nombre.trim()) {
      toast.error('Poné el nombre del proveedor.')
      return
    }

    setGuardando(true)
    try {
      const res = await api.post('/comparador/listas', {
        nombre: nombre.trim(),
        ...(items ? { items } : { texto }),
      })

      const data = res.data?.data
      let mensaje = `${data.cantidad_items} productos cargados.`
      if (data.ignoradas > 0) mensaje += ` ${data.ignoradas} líneas no se pudieron leer.`

      toast.success(mensaje)

      setNombre('')
      setTexto('')
      onOpenChange(false)
      onCargada?.()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar la lista.'))
    } finally {
      setGuardando(false)
    }
  }

  const subirExcel = async (archivo) => {
    if (!archivo) return

    try {
      const buffer = await archivo.arrayBuffer()
      const libro = XLSX.read(buffer)
      const hoja = libro.Sheets[libro.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })

      // Se toman las dos primeras columnas: nombre y precio. Los encabezados
      // de una lista de proveedor no siguen ninguna convención, así que pedir
      // nombres de columna exactos sería pedirle al usuario que edite el
      // archivo antes.
      const items = filas
        .map(fila => ({ nombre: String(fila[0] || '').trim(), precio: Number(fila[1]) }))
        .filter(i => i.nombre && Number.isFinite(i.precio) && i.precio > 0)

      if (items.length === 0) {
        toast.error('No se encontró ninguna fila con nombre y precio en las dos primeras columnas.')
        return
      }

      await guardar(items)
    } catch (err) {
      toast.error(`No se pudo leer el archivo: ${err.message}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cargar lista de precios</DialogTitle>
          <DialogDescription>
            Pegá la lista tal como te la mandaron, o subí el Excel. Cada línea
            tiene que terminar con el precio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="comp-nombre">Proveedor</Label>
            <Input
              id="comp-nombre"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej: Distribuidora Norte"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="comp-texto">Lista</Label>
            <textarea
              id="comp-texto"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              rows={9}
              placeholder={'Whey Protein 1kg   $12.500\nCreatina 300g;8990\nShaker 600ml - 1.500'}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[13px]
                         transition-colors focus-visible:border-brand focus-visible:outline-none"
            />
            <p className="text-xs text-fg-3">
              Se entienden $, puntos de miles y comas decimales. Las líneas que no
              tengan precio se saltean y se te avisa cuántas fueron.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border-2 px-3 py-2.5">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-fg-3" />
            <span className="text-[13px] text-fg-2">O subí un Excel (nombre en la primera columna, precio en la segunda)</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={e => subirExcel(e.target.files?.[0])}
              className="ml-auto max-w-[170px] text-xs text-fg-3 file:mr-2 file:rounded-md file:border-0
                         file:bg-surface-3 file:px-2 file:py-1 file:text-xs file:font-medium"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => guardar()} disabled={guardando || !texto.trim()}>
            {guardando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Cargar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
