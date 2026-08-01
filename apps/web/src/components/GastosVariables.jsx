import React, { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import api from '@/services/api'
import useStore from '@/store/useStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Plus, Trash2, User, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { Can } from '@/components/Can'

// ════════════════════════════════════════════
//  Gastos variables
//
//  Los que cambian mes a mes y tienen un responsable: viáticos, combustible,
//  adelantos, compras sueltas. El sistema anterior los cargaba así —por
//  persona y por mes— y era rutina de fin de mes.
//
//  Están separados de los fijos a propósito: el punto de equilibrio se calcula
//  con los FIJOS. Si entraran en la misma bolsa, cargar un viático le
//  cambiaría el precio recomendado a todo el catálogo.
// ════════════════════════════════════════════

const mesActual = () => new Date().toISOString().slice(0, 7)

/** '2026-07' → 'julio 2026'. */
function nombreDelMes(mes) {
  const [anio, m] = mes.split('-')
  const fecha = new Date(Number(anio), Number(m) - 1, 1)
  return fecha.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

function desplazarMes(mes, delta) {
  const [anio, m] = mes.split('-').map(Number)
  const fecha = new Date(anio, m - 1 + delta, 1)
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
}

export default function GastosVariables() {
  const empresaActiva = useStore(s => s.empresaActiva)
  const puntosDeVenta = empresaActiva?.puntosDeVenta || []

  const [mes, setMes] = useState(mesActual())
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const { confirm, ConfirmDialog } = useConfirmDialog()

  const [nuevo, setNuevo] = useState({ persona: '', nombre: '', monto: '', punto_de_venta_id: '' })

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await api.get(`/gastos-variables?mes=${mes}`)
      setDatos(res.data?.data || null)
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setCargando(false)
    }
  }, [mes])

  useEffect(() => { cargar() }, [cargar])

  const agregar = async (e) => {
    e.preventDefault()

    if (!nuevo.persona.trim() || !nuevo.nombre.trim()) {
      toast.error('Falta la persona o el concepto.')
      return
    }

    setGuardando(true)
    try {
      await api.post('/gastos-variables', {
        persona: nuevo.persona.trim(),
        nombre: nuevo.nombre.trim(),
        monto: Number(nuevo.monto) || 0,
        mes,
        punto_de_venta_id: nuevo.punto_de_venta_id ? Number(nuevo.punto_de_venta_id) : null,
      })

      // La persona queda cargada: lo normal es cargar varios gastos seguidos
      // de la misma persona.
      setNuevo(prev => ({ ...prev, nombre: '', monto: '' }))
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setGuardando(false)
    }
  }

  const eliminar = async (gasto) => {
    const ok = await confirm(`¿Eliminar "${gasto.nombre}"?`)
    if (!ok) return

    try {
      await api.delete(`/gastos-variables/${gasto.id}`)
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    }
  }

  const personas = datos?.personas || []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setMes(desplazarMes(mes, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="min-w-[9rem] text-center text-sm font-bold capitalize">
            {nombreDelMes(mes)}
          </span>

          <Button variant="outline" size="icon" className="h-8 w-8"
            disabled={mes >= mesActual()}
            onClick={() => setMes(desplazarMes(mes, 1))}
            title={mes >= mesActual() ? 'No se cargan gastos de meses que no empezaron' : ''}>
            <ChevronRight className="h-4 w-4" />
          </Button>

          {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Total del mes
          </p>
          <p className="text-2xl font-black font-mono text-destructive tabular-nums">
            ${(datos?.total || 0).toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      <Can codigo="gastos.crear">
        <Card>
          <CardContent className="py-4">
            <form onSubmit={agregar} className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto_auto_auto] gap-2 items-end">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Persona
                </label>
                <Input
                  list="personas-cargadas"
                  value={nuevo.persona}
                  onChange={e => setNuevo({ ...nuevo, persona: e.target.value })}
                  placeholder="Nombre"
                  className="h-9"
                />
                {/* Sugiere las que ya se cargaron este mes: evita que la misma
                    persona quede escrita de tres formas distintas. */}
                <datalist id="personas-cargadas">
                  {personas.map(p => <option key={p.persona} value={p.persona} />)}
                </datalist>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Concepto
                </label>
                <Input
                  value={nuevo.nombre}
                  onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
                  placeholder="Ej: nafta, viático, adelanto"
                  className="h-9"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Monto
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={nuevo.monto}
                  onChange={e => setNuevo({ ...nuevo, monto: e.target.value })}
                  placeholder="0"
                  className="h-9 w-32 font-mono"
                />
              </div>

              {puntosDeVenta.length > 1 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Sucursal
                  </label>
                  <select
                    value={nuevo.punto_de_venta_id}
                    onChange={e => setNuevo({ ...nuevo, punto_de_venta_id: e.target.value })}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">General</option>
                    {puntosDeVenta.map(pv => (
                      <option key={pv.id} value={pv.id}>{pv.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <Button type="submit" disabled={guardando} className="h-9">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-1">Agregar</span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </Can>

      {personas.length === 0 && !cargando ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-semibold">Sin gastos variables en {nombreDelMes(mes)}.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Cargá el primero con el formulario de arriba.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {personas.map(grupo => (
            <Card key={grupo.persona}>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <User className="h-4 w-4" /> {grupo.persona}
                  </span>
                  <Badge variant="secondary" className="font-mono">
                    ${grupo.total.toLocaleString('es-AR')}
                  </Badge>
                </CardTitle>
              </CardHeader>

              <Table>
                <TableBody>
                  {grupo.items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm">{item.nombre}</TableCell>
                      <TableCell className="text-right font-bold font-mono text-destructive tabular-nums">
                        -${item.monto.toLocaleString('es-AR')}
                      </TableCell>
                      <TableCell className="w-10">
                        <Can codigo="gastos.eliminar">
                          <Button variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => eliminar(item)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Can>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}
