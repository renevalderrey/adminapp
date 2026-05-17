import React, { useState, useEffect } from 'react'
import useStore from '@/store/useStore'
import api from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Plus, Trash2, Store, Users,
} from 'lucide-react'

const Expenses = () => {
  const { initialize } = useStore()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [formData, setFormData] = useState({ name: '', amount: '', group: 'gf1' })

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
      await api.post('/expenses', formData)
      setIsAdding(false)
      setFormData({ name: '', amount: '', group: 'gf1' })
      fetchExpenses()
      initialize()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este gasto?')) return
    try {
      await api.delete(`/expenses/${id}`)
      fetchExpenses()
      initialize()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  const gf1 = expenses.filter(e => e.group === 'gf1')
  const gf2 = expenses.filter(e => e.group === 'gf2')
  const totalGf1 = gf1.reduce((sum, e) => sum + parseFloat(e.amount), 0)
  const totalGf2 = gf2.reduce((sum, e) => sum + parseFloat(e.amount), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Gastos <span className="text-primary">Fijos</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Administración de costos operativos (GF1 y GF2).
          </p>
        </div>
        <Button size="sm" onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo Gasto
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-orange-500/20">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total O. de Ocampo (GF1)</p>
            <p className="text-2xl font-black font-mono mt-1 text-orange-500">${totalGf1.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-pink-500/20">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total 25 de Mayo (GF2)</p>
            <p className="text-2xl font-black font-mono mt-1 text-pink-500">${totalGf2.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm flex items-center gap-2">
              <Store className="h-4 w-4 text-orange-500" /> Suc. Ortiz de Ocampo (GF1)
            </CardTitle>
          </CardHeader>
          <Table>
            <TableBody>
              {gf1.map(e => (
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

        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-pink-500" /> Suc. 25 de Mayo (GF2)
            </CardTitle>
          </CardHeader>
          <Table>
            <TableBody>
              {gf2.map(e => (
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
      </div>

      {/* Dialog: New Expense */}
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
              <label className="text-xs font-medium text-muted-foreground">Sucursal / Grupo</label>
              <select
                value={formData.group}
                onChange={e => setFormData({ ...formData, group: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="gf1">Ortiz de Ocampo (GF1)</option>
                <option value="gf2">25 de Mayo (GF2)</option>
              </select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAdding(false)}>Cancelar</Button>
              <Button className="flex-1" type="submit">Guardar Gasto</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Expenses
