import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import api from '@/services/api'
import useStore from '@/store/useStore'
import { enviarPedidoPorWhatsapp } from '@/utils/pedidoWhatsapp'
import { fechaDeHoy } from '@/utils/formato'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertTriangle, MessageCircle, FileSpreadsheet, ShoppingCart, RefreshCw, Minus, Plus,
  PackageCheck,
} from 'lucide-react'
import EstadoVacio from '@/components/EstadoVacio'

// ════════════════════════════════════════════
//  Faltantes → pedido
//
//  La rutina semanal de reposición: mirar qué falta, poner cantidades, mandarlo
//  al proveedor. El sistema anterior tenía esta pantalla; acá había una alerta
//  de stock bajo en el panel, pero suelta — sin proveedor, sin costo y sin
//  cantidad sugerida, así que armar el pedido seguía siendo a mano.
//
//  Se agrupa por proveedor porque es la unidad en la que se pide.
// ════════════════════════════════════════════

export default function Faltantes() {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [umbral, setUmbral] = useState(3)

  // Cantidades editadas por el usuario, por product_id. Arrancan en la
  // sugerida y se pisan al tocar los botones.
  const [cantidades, setCantidades] = useState({})
  const [excluidos, setExcluidos] = useState(new Set())
  const [nota, setNota] = useState('')

  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ umbral: String(umbral) })
      if (puntoDeVentaActivo?.id) params.set('punto_de_venta_id', puntoDeVentaActivo.id)

      const res = await api.get(`/faltantes?${params}`)
      const data = res.data?.data || null
      setDatos(data)

      // Las cantidades se reinician con cada carga: si cambió el stock, la
      // sugerencia vieja ya no vale.
      const iniciales = {}
      for (const grupo of data?.proveedores || []) {
        for (const item of grupo.items) iniciales[item.product_id] = item.sugerido
      }
      setCantidades(iniciales)
      setExcluidos(new Set())
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

    const items = itemsAPedir(grupo)
    if (items.length === 0) {
      toast.error('No hay nada para pedir de este proveedor.')
      return
    }

    try {
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

      toast.success(`Orden de compra creada para ${grupo.proveedor?.nombre}.`)
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo crear la orden de compra.'))
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
    <div className="anim-subida space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-warn" />
            Faltantes
          </h1>
          <p className="text-sm text-muted-foreground">
            Lo que hay que reponer, agrupado por proveedor.
            {puntoDeVentaActivo?.name && ` Sucursal: ${puntoDeVentaActivo.name}.`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Umbral
          </label>
          <Input
            type="number"
            min="0"
            value={umbral}
            onChange={e => setUmbral(Math.max(0, Number(e.target.value) || 0))}
            className="h-9 w-20 text-sm"
            title="Para los productos que no tienen stock mínimo cargado"
          />
          <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
            <RefreshCw className={`h-4 w-4 mr-1 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Productos a pedir
            </p>
            <p className="num text-[26px] font-semibold">{totalAPedir.items}</p>
          </div>
          <Separator orientation="vertical" className="h-10" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Costo estimado
            </p>
            <p className="num text-[26px] font-semibold tabular-nums">
              ${totalAPedir.importe.toLocaleString('es-AR')}
            </p>
          </div>
          <Separator orientation="vertical" className="h-10" />
          <div className="flex-1 min-w-[240px]">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Nota para el proveedor
            </label>
            <Input
              value={nota}
              onChange={e => setNota(e.target.value)}
              placeholder="Ej: entregar por la mañana"
              className="h-9 text-sm mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {cargando && !datos && (
        <p className="text-sm text-muted-foreground py-8 text-center">Calculando faltantes...</p>
      )}

      {datos && datos.proveedores.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EstadoVacio
              icono={PackageCheck}
              codigo="sin_faltantes"
              titulo="No falta nada."
              detalle={`Ningún producto está por debajo de su mínimo (ni del umbral de ${umbral}).`}
            />
          </CardContent>
        </Card>
      )}

      {datos?.proveedores.map(grupo => (
        <Card key={grupo.supplier_id || 'sin-proveedor'}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                {grupo.proveedor?.nombre || 'Sin proveedor asignado'}
                <Badge variant="secondary">{grupo.items.length}</Badge>
              </CardTitle>

              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => enviarWhatsapp(grupo, false)}>
                  <MessageCircle className="h-4 w-4 mr-1" />
                  WhatsApp
                </Button>
                <Button size="sm" variant="outline" onClick={() => enviarWhatsapp(grupo, true)}
                  title="Incluye los costos de compra en el mensaje">
                  <MessageCircle className="h-4 w-4 mr-1" />
                  Con precios
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportarExcel(grupo)}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" />
                  Excel
                </Button>
                {grupo.supplier_id && (
                  <Button size="sm" onClick={() => crearOrdenDeCompra(grupo)}>
                    <ShoppingCart className="h-4 w-4 mr-1" />
                    Orden de compra
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="space-y-1">
              {grupo.items.map(item => {
                const excluido = excluidos.has(item.product_id)
                const cantidad = cantidadDe(item)

                return (
                  <div
                    key={item.product_id}
                    className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${excluido ? 'opacity-40' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={!excluido}
                      onChange={() => alternarExcluido(item.product_id)}
                      className="h-4 w-4 shrink-0"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{item.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.marca || 'Sin marca'} · stock {item.stock}
                        {item.min_stock > 0 ? ` / mín. ${item.min_stock}` : ' (sin mínimo cargado)'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-7 w-7"
                        onClick={() => cambiarCantidad(item.product_id, cantidad - 1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min="0"
                        value={cantidad}
                        onChange={e => cambiarCantidad(item.product_id, e.target.value)}
                        className="h-7 w-16 text-center text-sm tabular-nums"
                      />
                      <Button variant="outline" size="icon" className="h-7 w-7"
                        onClick={() => cambiarCantidad(item.product_id, cantidad + 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="w-24 text-right font-mono text-sm tabular-nums">
                      ${((Number(item.costo) || 0) * cantidad).toLocaleString('es-AR')}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
