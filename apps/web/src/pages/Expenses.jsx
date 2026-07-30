import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
import useStore from '@/store/useStore'
import api from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, Store } from 'lucide-react'
import { useConfirmDialog } from '@/components/ConfirmDialog'

const Expenses = () => {
  const { initialize, empresaActiva } = useStore()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [formData, setFormData] = useState({ name: '', amount: '', punto_de_venta_id: '' })

  const puntosDeVenta = empresaActiva?.puntosDeVenta || []

  const fetchExpenses = async () => {
    setLoading(true)
    try {
      const res = await api.get('/expenses')
      setExpenses(res.data.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchExpenses() }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    try {
      await api.post('/expenses', {
        name: formData.name,
        amount: formData.amount,
        punto_de_venta_id: formData.punto_de_venta_id ? parseInt(formData.punto_de_venta_id) : null,
      })
      setIsAdding(false)
      setFormData({ name: '', amount: '', punto_de_venta_id: '' })
      fetchExpenses()
      initialize()
    } catch (err) {
      toast.error('Error: ' + err.message)
    }
  }

  const handleDelete = async (id) => {
    const ok = await confirm('¿Eliminar este gasto?')
    if (!ok) return
    try {
      await api.delete(`/expenses/${id}`)
      fetchExpenses()
      initialize()
    } catch (err) {
      toast.error('Error: ' + err.message)
    }
  }

  const groups = {}
  for (const pv of puntosDeVenta) {
    groups[pv.id] = {
      name: pv.name,
      expenses: expenses.filter(e => e.punto_de_venta_id === pv.id || e.group === 'gf' + puntosDeVenta.indexOf(pv)),
    }
  }
  groups['general'] = {
    name: 'General',
    expenses: expenses.filter(e => !e.punto_de_venta_id && !e.group?.startsWith('gf')),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Gastos <span className="text-primary">Fijos</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Costos operativos agrupados por sucursal.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo Gasto
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.entries(groups).filter(([_, g]) => g.name !== 'General').map(([key, group]) => {
          const total = group.expenses.reduce((s, e) => s + parseFloat(e.amount), 0)
          return (
            <Card key={key}>
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Total {group.name}
                </p>
                <p className="text-2xl font-black font-mono mt-1 text-destructive">
                  ${total.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {Object.entries(groups).map(([key, group]) => (
          <Card key={key}>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm flex items-center gap-2">
                <Store className="h-4 w-4" /> {group.name}
              </CardTitle>
            </CardHeader>
            <Table>
              <TableBody>
                {group.expenses.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-sm text-muted-foreground text-center py-4">
                      Sin gastos registrados
                    </TableCell>
                  </TableRow>
                ) : group.expenses.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{e.name}</TableCell>
                    <TableCell className="text-right font-bold font-mono text-destructive">
                      -${parseFloat(e.amount).toLocaleString()}
                    </TableCell>
                    <TableCell className="w-10">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(e.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))}
      </div>

      <Dialog open={isAdding} onOpenChange={setIsAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Agregar Gasto</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Descripción</label>
              <Input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Monto ($)</label>
              <Input type="number" required value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
              <select
                value={formData.punto_de_venta_id}
                onChange={e => setFormData({ ...formData, punto_de_venta_id: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">General (sin sucursal)</option>
                {puntosDeVenta.map(pv => (
                  <option key={pv.id} value={pv.id}>{pv.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAdding(false)}>Cancelar</Button>
              <Button className="flex-1" type="submit">Guardar Gasto</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </div>
  )
}

export default Expenses
