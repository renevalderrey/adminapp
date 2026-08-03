import React, { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import api from '@/services/api'
import { calcularPrecios } from '@/utils/precios'
import { usePermission } from '@/hooks/usePermission'
import HistorialDeCostos from '@/components/HistorialDeCostos'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from 'lucide-react'

// ════════════════════════════════════════════
//  ADMINAPP · Panel del producto
//
//  Reemplaza a `ProductForm.jsx`. Es un panel lateral y no un modal por el mismo
//  motivo que el de ventas: el usuario corrige un costo o un mínimo **mirando el
//  resto de la lista**, que es lo que le dice si el número que está por escribir
//  tiene sentido. Un modal tapa exactamente eso.
//
//  Se apoya en `components/ui/sheet.jsx`, que ya resuelve Esc, el clic en el
//  overlay, la trampa de foco, el bloqueo del scroll del body y el retorno del
//  foco a la fila. Escrito a mano ese trabajo de accesibilidad queda a medias.
//
//  ── Lo que este panel hace y el formulario viejo no ──
//
//   · El precio se calcula EN VIVO con `calcularPrecios`, así que se ve el
//     efecto del costo y del margen antes de guardar. Es la misma función que
//     usa el POS: una segunda implementación del precio es una segunda respuesta
//     a la misma pregunta.
//   · El stock se edita por SUCURSAL, incluidas aquellas donde el producto
//     todavía no tiene fila. Antes, un producto sin ninguna fila de stock no
//     mostraba ninguna sucursal y no había forma de cargarle la primera.
//   · Guardar **no recarga el catálogo**: devuelve el producto ya actualizado y
//     la pantalla reemplaza esa fila (FR-035). `initialize()` después de cada
//     guardado dispara tres pedidos, pone `loading` global —la tabla entera
//     parpadea— y devuelve la lista al principio, con lo cual el usuario pierde
//     la página, la búsqueda, el orden y el scroll.
// ════════════════════════════════════════════

/** Las mismas categorías que ofrecía `ProductForm.jsx`. */
const CATEGORIAS = [
  'proteina', 'pre', 'amino', 'creatina', 'colageno', 'vitamina',
  'accesorio', 'indumentaria', 'alimento', 'pack', 'otro',
]

const UNIDADES = [
  { value: 'unidad', label: 'Unidad' },
  { value: 'kg', label: 'Kg' },
  { value: 'gr', label: 'Gr' },
  { value: 'litro', label: 'Litro' },
  { value: 'ml', label: 'Ml' },
]

/** Los campos del producto, tal como los manda el `PUT`. */
const FORMULARIO_VACIO = {
  name: '',
  description: '',
  sku: '',
  barcode: '',
  cost: '',
  brand_id: '',
  margin_override: '',
  price_override: '',
  wholesale_margin: '',
  wholesale_price: '',
  category: 'otro',
  unit_type: 'unidad',
  unit_size: '',
  taxed: true,
  image_url: '',
}

const pesos = (n) => Number(n || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:pointer-events-none disabled:opacity-60'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:pointer-events-none disabled:opacity-60'

const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none disabled:bg-surface-2 disabled:text-fg-2'

/** Un campo con su etiqueta. */
function Campo({ etiqueta, children, ancho = '' }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${ancho}`}>
      <span className="eyebrow">{etiqueta}</span>
      {children}
    </label>
  )
}

/**
 * Lo que el formulario manda al servidor.
 *
 * Los vacíos van como `null` y no como `''`: una cadena vacía en un DECIMAL
 * hace fallar la validación de Sequelize, y en una FK como `brand_id` intenta
 * resolver una marca con id `''`.
 */
function limpiar(valor) {
  return valor === '' || valor === undefined || valor === null ? null : valor
}

/**
 * @param {object|null} producto El producto de la fila, o `null` para el alta.
 * @param {Array} sucursales Todas las de la empresa, incluidas las inactivas.
 * @param {Function} onGuardado Recibe el producto actualizado, con `stock` y
 *   `brand` ya armados, para que la pantalla reemplace su fila sin recargar.
 * @param {Function} onCreado Se llama después de crear uno nuevo.
 * @param {Function} onDesactivado Recibe el id del producto dado de baja.
 */
export default function PanelProducto({
  abierto,
  onOpenChange,
  producto,
  sucursales = [],
  marcas = [],
  settings = {},
  onGuardado,
  onCreado,
  onDesactivado,
}) {
  const { can } = usePermission()
  // El alta y la edición piden permisos distintos, así que «puede tocar los
  // campos» depende de en cuál de las dos está el panel.
  const esAlta = !producto
  const puedeEditar = esAlta ? can('products.crear') : can('products.editar')
  const puedeEditarStock = can('stock.editar')
  const puedeDarDeBaja = !esAlta && can('products.eliminar')

  const [form, setForm] = useState(FORMULARIO_VACIO)
  const [filasDeStock, setFilasDeStock] = useState([])
  const [guardando, setGuardando] = useState(false)
  /** El aviso de «hay cambios sin guardar», que aparece al intentar cerrar. */
  const [avisandoDescarte, setAvisandoDescarte] = useState(false)
  /** La foto de cómo estaba todo al abrir, para saber si hay cambios. */
  const [original, setOriginal] = useState({ form: FORMULARIO_VACIO, stock: [] })

  // Al abrir se arma el formulario desde el producto y UNA fila por sucursal,
  // exista o no la fila de stock. Un producto sin ninguna fila mostraba antes
  // una sección vacía y no había forma de cargarle la primera cantidad.
  useEffect(() => {
    if (!abierto) return

    const datos = producto ? {
      ...FORMULARIO_VACIO,
      ...Object.fromEntries(
        Object.keys(FORMULARIO_VACIO).map((campo) => [campo, producto[campo] ?? FORMULARIO_VACIO[campo]])
      ),
      brand_id: producto.brand_id ? String(producto.brand_id) : '',
      taxed: producto.taxed !== undefined ? producto.taxed : true,
      category: producto.category || 'otro',
      unit_type: producto.unit_type || 'unidad',
    } : FORMULARIO_VACIO

    const filas = sucursales.map((sucursal) => {
      const existente = (producto?.stock || [])
        .find((s) => String(s.punto_de_venta_id) === String(sucursal.id))

      return {
        id: existente?.id ?? null,
        punto_de_venta_id: sucursal.id,
        nombre: sucursal.name,
        inactiva: sucursal.is_active === false,
        quantity: existente?.quantity ?? 0,
        // `available` es de solo lectura: lo mueve el servidor con el mismo
        // delta que `quantity`. Editarlo a mano es como se desincronizan.
        available: existente?.available ?? 0,
        min_stock: existente?.min_stock ?? 0,
      }
    })

    setForm(datos)
    setFilasDeStock(filas)
    setOriginal({ form: datos, stock: filas })
    setAvisandoDescarte(false)
  }, [abierto, producto, sucursales])

  const cambiar = (campo) => (valor) => setForm((actual) => ({ ...actual, [campo]: valor }))

  const cambiarStock = (indice, campo, valor) => {
    setFilasDeStock((filas) => filas.map((f, i) => (i === indice ? { ...f, [campo]: valor } : f)))
  }

  /** Si hay algo distinto de como estaba al abrir. */
  const hayCambios = useMemo(() => (
    JSON.stringify(form) !== JSON.stringify(original.form)
    || JSON.stringify(filasDeStock) !== JSON.stringify(original.stock)
  ), [form, filasDeStock, original])

  /**
   * El precio, recalculado mientras se escribe.
   *
   * Sale de `calcularPrecios` y no de una cuenta escrita acá: la convención de
   * margen —recargo sobre costo y no margen sobre venta— ya costó una
   * calculadora que recomendaba precios que garantizan pérdida.
   */
  const precios = useMemo(() => calcularPrecios({
    cost: form.cost,
    margin_override: form.margin_override === '' ? null : form.margin_override,
    price_override: form.price_override,
  }, settings), [form.cost, form.margin_override, form.price_override, settings])

  /** Las categorías que se ofrecen, más la del producto si es una que no está
   *  en la lista: `Product.category` es texto libre y no se puede perder. */
  const categorias = useMemo(() => (
    form.category && !CATEGORIAS.includes(form.category)
      ? [...CATEGORIAS, form.category]
      : CATEGORIAS
  ), [form.category])

  /**
   * Cierra el panel, avisando si hay cambios sin guardar.
   *
   * Sin cambios cierra sin preguntar: un panel que pregunta siempre enseña a
   * apretar «Descartar» sin leer, y entonces el aviso deja de proteger nada.
   */
  const intentarCerrar = (siguiente) => {
    if (siguiente) return
    if (guardando) return

    if (hayCambios) {
      setAvisandoDescarte(true)
      return
    }

    onOpenChange(false)
  }

  const descartar = () => {
    setAvisandoDescarte(false)
    setForm(original.form)
    setFilasDeStock(original.stock)
    onOpenChange(false)
  }

  /** El cuerpo del producto, igual para el alta y para la edición. */
  const cuerpoDelProducto = () => ({
    name: form.name,
    description: limpiar(form.description),
    sku: limpiar(form.sku),
    barcode: limpiar(form.barcode),
    cost: form.cost || 0,
    brand_id: limpiar(form.brand_id),
    margin_override: limpiar(form.margin_override),
    price_override: limpiar(form.price_override),
    wholesale_margin: limpiar(form.wholesale_margin),
    wholesale_price: limpiar(form.wholesale_price),
    category: form.category,
    unit_type: form.unit_type,
    unit_size: limpiar(form.unit_size),
    taxed: form.taxed,
    image_url: limpiar(form.image_url),
  })

  /** Lo que no se puede guardar, o `null`. */
  const problemaDelFormulario = () => {
    if (!String(form.name || '').trim()) return 'El producto necesita un nombre.'

    // La cantidad negativa se rechaza acá y también en la API, en las DOS rutas
    // —`POST /api/stock` y `PUT /api/stock/:id`—. Antes solo la rechazaba el
    // `PUT`, así que cargar -5 pasaba o no según si la fila ya existía: el mismo
    // campo de la misma pantalla validaba o no según un detalle invisible.
    const negativa = filasDeStock.find((f) => Number(f.quantity) < 0 || Number(f.min_stock) < 0)

    if (negativa) return `El stock no puede ser negativo (${negativa.nombre}).`

    return null
  }

  /**
   * Crea el producto y **sus filas de stock**.
   *
   * Es lo que el formulario viejo no hacía: `ProductForm` creaba el producto con
   * `stockEntries` vacío, así que un alta no dejaba ninguna fila de stock y
   * había que volver a abrir el producto para cargar la primera cantidad. Acá
   * el alta escribe en `Stock` por un camino que antes no existía, y cada fila
   * va con su `punto_de_venta_id`.
   */
  const crear = async () => {
    const problema = problemaDelFormulario()

    if (problema) {
      toast.error(problema)
      return
    }

    setGuardando(true)
    try {
      const respuesta = await api.post('/products', cuerpoDelProducto())
      const creado = respuesta.data.data

      // Solo las sucursales donde se cargó algo: crear una fila en cero en cada
      // sucursal por cada producto nuevo llena la tabla de filas que no dicen
      // nada y que igual se crean solas cuando entra mercadería.
      const conCarga = filasDeStock.filter((f) => Number(f.quantity) > 0 || Number(f.min_stock) > 0)

      for (const fila of conCarga) {
        await api.post('/stock', {
          product_id: creado.id,
          punto_de_venta_id: fila.punto_de_venta_id,
          quantity: Number(fila.quantity),
          min_stock: Number(fila.min_stock),
        })
      }

      toast.success('Producto creado')
      onCreado?.(creado)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setGuardando(false)
    }
  }

  const guardar = async () => {
    if (guardando) return
    if (esAlta) return crear()

    const problema = problemaDelFormulario()

    if (problema) {
      toast.error(problema)
      return
    }

    setGuardando(true)
    try {
      const respuesta = await api.put(`/products/${producto.id}`, cuerpoDelProducto())
      const actualizado = respuesta.data.data

      // Solo las filas de stock que CAMBIARON. Mandarlas todas escribiría un
      // `StockMovement` por sucursal en cada guardado, y el historial de
      // movimientos pasaría a estar lleno de cambios que no ocurrieron.
      const porSucursal = new Map((producto.stock || []).map((s) => [String(s.punto_de_venta_id), s]))

      for (const [i, fila] of filasDeStock.entries()) {
        const antes = original.stock[i]
        const sinCambios = antes
          && Number(antes.quantity) === Number(fila.quantity)
          && Number(antes.min_stock) === Number(fila.min_stock)

        if (sinCambios) continue

        const res = fila.id
          ? await api.put(`/stock/${fila.id}`, {
            quantity: Number(fila.quantity),
            min_stock: Number(fila.min_stock),
          })
          // Sin fila previa se crea. `punto_de_venta_id` va siempre: una fila de
          // stock sin sucursal es mercadería que la pantalla no muestra nunca.
          : await api.post('/stock', {
            product_id: producto.id,
            punto_de_venta_id: fila.punto_de_venta_id,
            quantity: Number(fila.quantity),
            min_stock: Number(fila.min_stock),
          })

        porSucursal.set(String(fila.punto_de_venta_id), res.data.data)
      }

      // La fila de la tabla se arma acá y no se relee del servidor: el `PUT` del
      // producto no devuelve ni `stock` ni `brand` —no los incluye—, así que
      // pasarlo tal cual dejaría la fila sin marca y sin cantidades hasta la
      // próxima recarga.
      const marca = marcas.find((m) => String(m.id) === String(form.brand_id)) || null

      onGuardado?.({
        ...actualizado,
        brand: marca,
        stock: [...porSucursal.values()],
      })

      toast.success('Producto actualizado')
      onOpenChange(false)
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setGuardando(false)
    }
  }

  /** Vuelve a poner en circulación un producto dado de baja (FR-039). */
  const reactivar = async () => {
    if (!producto || guardando) return

    setGuardando(true)
    try {
      const res = await api.put(`/products/${producto.id}`, { is_active: true })
      toast.success('Producto reactivado')
      onGuardado?.({ ...res.data.data, brand: producto.brand, stock: producto.stock })
      onOpenChange(false)
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setGuardando(false)
    }
  }

  /**
   * Da de baja el producto.
   *
   * Es baja lógica —`DELETE /api/products/:id` pone `is_active: false`— y no un
   * borrado: las ventas viejas siguen apuntando al producto. Vuelve con el
   * filtro «Desactivados» de la pantalla.
   */
  const darDeBaja = async () => {
    if (!producto || guardando) return

    setGuardando(true)
    try {
      await api.delete(`/products/${producto.id}`)
      toast.success('Producto desactivado. Lo encontrás con el filtro «Desactivados».')
      onDesactivado?.(producto.id)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setGuardando(false)
    }
  }

  const desactivado = producto?.is_active === false
  const subtitulo = producto
    ? [producto.brand?.name, producto.category, producto.sku].filter(Boolean).join(' · ')
    : 'Completá los datos. Podés cargarle stock en cada sucursal antes de guardar.'

  return (
    <Sheet open={abierto} onOpenChange={intentarCerrar}>
      <SheetContent
        // El ancho va en `style` y no en clases: `SheetContent` trae
        // `data-[side=right]:sm:max-w-sm` y `w-3/4` propios, y esas reglas viven
        // en un media query que gana por orden de hoja. Un estilo en línea las
        // supera sin pelearse con el orden del CSS.
        style={{ width: '520px', maxWidth: '92vw' }}
        className="anim-panel gap-0 overflow-y-auto bg-surface p-0 shadow-nivel-3"
      >
        <div className="border-b border-border px-6 py-5 pr-12">
          <p className="eyebrow">Producto</p>

          <SheetTitle className="mt-1 text-[19px] font-semibold">
            {esAlta ? 'Nuevo producto' : (producto.name || '—')}
          </SheetTitle>

          <SheetDescription className="mt-1 text-[13px] text-fg-2">
            {subtitulo || 'Sin marca, categoría ni SKU'}
          </SheetDescription>
        </div>

        {!abierto ? null : (
          <div className="flex flex-col gap-7 px-6 py-6">

            {desactivado && (
              <div className="flex items-start gap-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-3.5">
                <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warn" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-warn">Este producto está desactivado</p>
                  <p className="mt-1 text-[12.5px] text-fg-2">
                    No aparece en el punto de venta ni en el listado normal. Su
                    stock y su historial siguen enteros.
                  </p>
                  {puedeEditar && (
                    <button className={`${BOTON_SECUNDARIO} mt-2.5`} disabled={guardando} onClick={reactivar}>
                      <RotateCcw className="h-3.5 w-3.5 text-fg-3" />
                      Reactivar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Datos ── */}
            <div className="flex flex-col gap-4">
              <h2>Datos</h2>

              <Campo etiqueta="Nombre">
                <input
                  className={CAMPO}
                  value={form.name}
                  disabled={!puedeEditar}
                  onChange={(e) => cambiar('name')(e.target.value)}
                />
              </Campo>

              <Campo etiqueta="Descripción">
                <textarea
                  className={`${CAMPO} h-auto py-2`}
                  rows={2}
                  value={form.description || ''}
                  disabled={!puedeEditar}
                  onChange={(e) => cambiar('description')(e.target.value)}
                />
              </Campo>

              <div className="grid grid-cols-2 gap-4">
                <Campo etiqueta="SKU">
                  <input
                    className={`${CAMPO} num`}
                    value={form.sku || ''}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('sku')(e.target.value)}
                  />
                </Campo>
                <Campo etiqueta="Código de barras">
                  <input
                    className={`${CAMPO} num`}
                    value={form.barcode || ''}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('barcode')(e.target.value)}
                  />
                </Campo>
              </div>
            </div>

            {/* ── Precio ── */}
            <div className="flex flex-col gap-4">
              <h2>Precio</h2>

              <div className="grid grid-cols-2 gap-4">
                <Campo etiqueta="Costo">
                  <input
                    type="number" step="0.01" min="0"
                    className={`${CAMPO} num`}
                    value={form.cost ?? ''}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('cost')(e.target.value)}
                  />
                </Campo>
                <Campo etiqueta="Margen %">
                  <input
                    type="number" step="0.01"
                    placeholder={`${settings.margin_efectivo ?? ''}`}
                    className={`${CAMPO} num`}
                    value={form.margin_override ?? ''}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('margin_override')(e.target.value)}
                  />
                </Campo>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Campo etiqueta="Precio manual">
                  <input
                    type="number" step="0.01" min="0"
                    className={`${CAMPO} num`}
                    value={form.price_override ?? ''}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('price_override')(e.target.value)}
                  />
                </Campo>
                <Campo etiqueta="Margen mayorista %">
                  <input
                    type="number" step="0.01"
                    className={`${CAMPO} num`}
                    value={form.wholesale_margin ?? ''}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('wholesale_margin')(e.target.value)}
                  />
                </Campo>
              </div>

              <Campo etiqueta="Precio mayorista">
                <input
                  type="number" step="0.01" min="0"
                  className={`${CAMPO} num`}
                  value={form.wholesale_price ?? ''}
                  disabled={!puedeEditar}
                  onChange={(e) => cambiar('wholesale_price')(e.target.value)}
                />
              </Campo>

              {/* El resultado, mientras se escribe. Es lo que hace que corregir
                  un costo sea una decisión y no una apuesta. */}
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
                {precios.sinCosto ? (
                  <p className="text-[12.5px] text-warn">
                    Sin costo y sin precio manual, el producto sale a $0 en el
                    punto de venta y se puede vender gratis sin que nada avise.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                    <span className="flex flex-col">
                      <span className="eyebrow">Contado</span>
                      <span className="num text-[17px] font-semibold">${pesos(precios.cashPrice)}</span>
                    </span>
                    <span className="flex flex-col">
                      <span className="eyebrow">Tarjeta</span>
                      <span className="num text-[15px] text-fg-2">
                        {precios.cardPrice === null ? '—' : `$${pesos(precios.cardPrice)}`}
                      </span>
                    </span>
                    <span className="flex flex-col">
                      <span className="eyebrow">Alianza</span>
                      <span className="num text-[15px] text-fg-2">${pesos(precios.alliancePrice)}</span>
                    </span>
                    {precios.usaPrecioManual && (
                      <span className="text-[11.5px] text-fg-3">
                        El precio manual anula el cálculo por margen.
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Clasificación ── */}
            <div className="flex flex-col gap-4">
              <h2>Clasificación</h2>

              <div className="grid grid-cols-2 gap-4">
                <Campo etiqueta="Marca">
                  <select
                    className={CAMPO}
                    value={form.brand_id || ''}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('brand_id')(e.target.value)}
                  >
                    <option value="">Sin marca</option>
                    {marcas.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Categoría">
                  <select
                    className={CAMPO}
                    value={form.category || 'otro'}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('category')(e.target.value)}
                  >
                    {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Campo>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Campo etiqueta="Unidad">
                  <select
                    className={CAMPO}
                    value={form.unit_type || 'unidad'}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('unit_type')(e.target.value)}
                  >
                    {UNIDADES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Tamaño del envase">
                  <input
                    type="number" step="0.01"
                    className={`${CAMPO} num`}
                    value={form.unit_size ?? ''}
                    disabled={!puedeEditar}
                    onChange={(e) => cambiar('unit_size')(e.target.value)}
                  />
                </Campo>
              </div>

              <Campo etiqueta="URL de imagen">
                <input
                  className={CAMPO}
                  value={form.image_url || ''}
                  disabled={!puedeEditar}
                  onChange={(e) => cambiar('image_url')(e.target.value)}
                />
              </Campo>

              <label className="flex items-center gap-2.5 text-[13px]">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={!!form.taxed}
                  disabled={!puedeEditar}
                  onChange={(e) => cambiar('taxed')(e.target.checked)}
                />
                Producto gravado (IVA)
              </label>
            </div>

            {/* ── Stock por sucursal ── */}
            <div className="flex flex-col gap-3">
              <h2>Stock por sucursal</h2>

              {filasDeStock.length === 0 ? (
                <p className="text-[12.5px] text-fg-2">
                  La empresa no tiene ninguna sucursal cargada.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="eyebrow grid grid-cols-[minmax(0,1fr)_84px_84px] gap-x-3 border-b border-border bg-surface-2 px-4 py-2">
                    <span>Sucursal</span>
                    <span className="text-right">Cantidad</span>
                    <span className="text-right">Mínimo</span>
                  </div>

                  {filasDeStock.map((fila, i) => {
                    // `available` es lo que se puede vender; `quantity`, lo que
                    // hay. Cuando difieren, la diferencia son unidades
                    // comprometidas, y mostrar solo una de las dos hace que el
                    // usuario corrija la que no era.
                    const reservadas = Number(fila.quantity) - Number(fila.available)

                    return (
                      <div key={fila.punto_de_venta_id} className="border-b border-border px-4 py-2.5 last:border-b-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_84px_84px] items-center gap-x-3">
                          <span className="truncate text-[13px]" title={fila.nombre}>
                            {fila.nombre}
                            {fila.inactiva && <span className="text-fg-3"> (inactiva)</span>}
                          </span>
                          <input
                            type="number" min="0" step="1"
                            className={`${CAMPO} num h-8 text-right`}
                            value={fila.quantity}
                            disabled={!puedeEditarStock}
                            onChange={(e) => cambiarStock(i, 'quantity', e.target.value)}
                          />
                          <input
                            type="number" min="0" step="1"
                            className={`${CAMPO} num h-8 text-right`}
                            value={fila.min_stock}
                            disabled={!puedeEditarStock}
                            onChange={(e) => cambiarStock(i, 'min_stock', e.target.value)}
                          />
                        </div>

                        {reservadas !== 0 && (
                          <p className="mt-1.5 text-[11.5px] text-fg-3">
                            Disponible para vender: <span className="num">{fila.available}</span>.
                            {reservadas > 0
                              ? ` Hay ${reservadas} unidad${reservadas === 1 ? '' : 'es'} comprometida${reservadas === 1 ? '' : 's'} en ventas o producción.`
                              : ' El disponible quedó por encima de la cantidad física: hay que revisarlo.'}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {!puedeEditarStock && (
                <p className="text-[11.5px] text-fg-3">
                  Necesitás el permiso «stock.editar» para cambiar estas
                  cantidades.
                </p>
              )}
            </div>

            {/* En el alta no hay historial que mostrar: el producto todavía no
                existe y pedirlo sería un 404. */}
            {!esAlta && <HistorialDeCostos productoId={producto.id} />}
          </div>
        )}

        {/* ── Pie ── */}
        {abierto && (
          <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-border bg-surface-2 px-6 py-4">
            {avisandoDescarte && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-2.5">
                <p className="flex-1 text-[12.5px] text-warn">
                  Hay cambios sin guardar.
                </p>
                <button className={BOTON_SECUNDARIO} onClick={() => setAvisandoDescarte(false)}>
                  Seguir editando
                </button>
                <button className={`${BOTON_SECUNDARIO} text-danger hover:bg-danger-soft`} onClick={descartar}>
                  Descartar
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {puedeDarDeBaja && !desactivado && (
                <button
                  className={`${BOTON_SECUNDARIO} text-danger hover:bg-danger-soft`}
                  disabled={guardando}
                  onClick={darDeBaja}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Desactivar
                </button>
              )}

              <div className="flex-1" />

              <button className={BOTON_SECUNDARIO} disabled={guardando} onClick={() => intentarCerrar(false)}>
                Cerrar
              </button>

              {/* Deshabilitado con la explicación, no ausente: ausente deja al
                  usuario sin entender por qué no puede hacer nada. El bloqueo
                  real está en la API. */}
              <button
                className={BOTON_PRINCIPAL}
                disabled={!puedeEditar || guardando || !hayCambios}
                title={puedeEditar
                  ? undefined
                  : `Necesitás el permiso «products.${esAlta ? 'crear' : 'editar'}»`}
                onClick={guardar}
              >
                {guardando
                  ? <><Loader2 className="h-4 w-4 animate-spin" />{esAlta ? 'Creando…' : 'Guardando…'}</>
                  : (esAlta ? 'Crear producto' : 'Guardar cambios')}
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
