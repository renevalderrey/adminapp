import React, { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Undo2, History, Loader2 } from 'lucide-react'

// ════════════════════════════════════════════
//  Actualización masiva de precios, con deshacer
//
//  Cuando un proveedor manda una lista nueva hay que tocar decenas o cientos
//  de productos. Hacerlo de a uno no es viable; hacerlo en masa sin red de
//  seguridad es peor, porque un porcentaje mal tipeado deja el catálogo entero
//  mal y no hay forma de reconstruir los precios anteriores.
//
//  Cada operación guarda una foto de cómo estaba cada producto. Deshacer es
//  escribirla de vuelta. El sistema anterior tenía esta función y era de las
//  más usadas.
// ════════════════════════════════════════════

const MODOS = [
  {
    valor: 'costo',
    etiqueta: 'Ajustar costo por %',
    ayuda: 'Sube o baja el costo un porcentaje. Es lo que se usa cuando llega una lista nueva del proveedor. Los precios de venta se recalculan solos a partir del costo.',
    sufijo: '%',
    permiteNegativo: true,
  },
  {
    valor: 'margen',
    etiqueta: 'Fijar margen',
    ayuda: 'Pone el mismo margen a todos los seleccionados. Borra el precio fijo si lo tenían, porque un precio fijo tapa al margen.',
    sufijo: '%',
    permiteNegativo: false,
  },
  {
    valor: 'precio',
    etiqueta: 'Fijar precio de venta',
    ayuda: 'Pone el mismo precio final a todos los seleccionados, sin importar el costo.',
    sufijo: '$',
    permiteNegativo: false,
  },
]

const formatoFecha = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const descripcionDeModo = (modo, valor) => {
  if (modo === 'costo') return `Costo ${valor > 0 ? '+' : ''}${valor}%`
  if (modo === 'margen') return `Margen ${valor}%`
  return `Precio $${Number(valor).toLocaleString('es-AR')}`
}

export default function PreciosMasivos({ open, onOpenChange, productIds = [], onAplicado }) {
  const [modo, setModo] = useState('costo')
  const [valor, setValor] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [aplicando, setAplicando] = useState(false)

  const [historial, setHistorial] = useState([])
  const [cargandoHistorial, setCargandoHistorial] = useState(false)
  const [deshaciendo, setDeshaciendo] = useState(null)

  const modoActual = MODOS.find(m => m.valor === modo)

  const cargarHistorial = useCallback(async () => {
    setCargandoHistorial(true)
    try {
      const res = await api.get('/precios/historial?limite=10')
      setHistorial(res.data?.data || [])
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setCargandoHistorial(false)
    }
  }, [])

  useEffect(() => {
    if (open) cargarHistorial()
  }, [open, cargarHistorial])

  const aplicar = async () => {
    const numero = Number(valor)

    if (valor === '' || !Number.isFinite(numero)) {
      toast.error('Poné un valor.')
      return
    }

    if (!modoActual.permiteNegativo && numero < 0) {
      toast.error('El valor no puede ser negativo.')
      return
    }

    setAplicando(true)
    try {
      const res = await api.post('/precios/masivo', {
        product_ids: productIds,
        modo,
        valor: numero,
        descripcion: descripcion.trim() || descripcionDeModo(modo, numero),
      })

      const data = res.data?.data

      let mensaje = `${data.cantidad_productos} productos actualizados.`
      if (data.omitidos > 0) mensaje += ` ${data.omitidos} ya tenían ese valor.`

      toast.success(mensaje)

      setValor('')
      setDescripcion('')
      await cargarHistorial()
      onAplicado?.()
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setAplicando(false)
    }
  }

  const deshacer = async (actualizacion) => {
    setDeshaciendo(actualizacion.id)
    try {
      const res = await api.post(`/precios/historial/${actualizacion.id}/deshacer`)
      const data = res.data?.data

      let mensaje = `${data.restaurados} productos volvieron a su precio anterior.`
      if (data.faltantes > 0) mensaje += ` ${data.faltantes} ya no existen.`

      toast.success(mensaje)

      await cargarHistorial()
      onAplicado?.()
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setDeshaciendo(null)
    }
  }

  // Solo la última sin revertir se puede deshacer: revertir una del medio
  // dejaría precios que nunca existieron.
  const idDeshacible = historial.find(h => !h.revertida)?.id

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Actualizar precios</DialogTitle>
          <DialogDescription>
            {productIds.length === 0
              ? 'Seleccioná productos en la lista para aplicarles un cambio.'
              : `Se va a aplicar a ${productIds.length} producto${productIds.length === 1 ? '' : 's'}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MODOS.map(m => (
              <button
                key={m.valor}
                type="button"
                onClick={() => setModo(m.valor)}
                className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  modo === m.valor ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                }`}
              >
                {m.etiqueta}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">{modoActual.ayuda}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="precio-valor">
                Valor {modoActual.sufijo === '%' ? '(porcentaje)' : '(pesos)'}
              </Label>
              <Input
                id="precio-valor"
                type="number"
                step="0.01"
                value={valor}
                onChange={e => setValor(e.target.value)}
                placeholder={modo === 'costo' ? 'Ej: 12 para +12%, -5 para bajar' : 'Ej: 45'}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="precio-desc">Descripción (opcional)</Label>
              <Input
                id="precio-desc"
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                placeholder="Ej: lista Star Nutrition julio"
              />
            </div>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold flex items-center gap-1.5">
                <History className="h-4 w-4" /> Últimas actualizaciones
              </p>
              {cargandoHistorial && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>

            {historial.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">Todavía no hiciste ninguna.</p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {historial.map(h => (
                  <div key={h.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">
                        {h.descripcion || descripcionDeModo(h.modo, h.valor)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatoFecha(h.fecha)} · {h.cantidad_productos} productos
                        {h.usuario ? ` · ${h.usuario}` : ''}
                      </p>
                    </div>

                    {h.revertida ? (
                      <Badge variant="secondary" className="shrink-0">deshecha</Badge>
                    ) : h.id === idDeshacible ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={deshaciendo === h.id}
                        onClick={() => deshacer(h)}
                      >
                        {deshaciendo === h.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <><Undo2 className="h-3.5 w-3.5 mr-1" /> Deshacer</>}
                      </Button>
                    ) : (
                      <span
                        className="text-[10px] text-muted-foreground shrink-0 max-w-[7rem] text-right leading-tight"
                        title="Solo se puede deshacer la última: revertir una del medio dejaría precios que nunca existieron"
                      >
                        deshacé primero las posteriores
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={aplicar} disabled={aplicando || productIds.length === 0}>
            {aplicando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Aplicar a {productIds.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
