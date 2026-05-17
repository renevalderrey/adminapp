import React, { useState, useEffect } from 'react'
import api from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Users, Truck, Plus, CreditCard,
} from 'lucide-react'

const Orders = () => {
  const [suppliers, setSuppliers] = useState([])
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isAddingSupplier, setIsAddingSupplier] = useState(false)
  const [isAddingPayment, setIsAddingPayment] = useState(false)
  const [isAddingOrder, setIsAddingOrder] = useState(false)

  const [formData, setFormData] = useState({ name: '' })
  const [payData, setPayData] = useState({ amount: '', method: 'ef', date: new Date().toISOString().split('T')[0], notes: '' })
  const [orderData, setOrderData] = useState({ total: '', date: new Date().toISOString().split('T')[0], notes: '' })

  const fetchSuppliers = async () => {
    setLoading(true)
    try {
      const res = await api.get('/suppliers')
      setSuppliers(res.data.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSuppliers() }, [])

  const calculateBalance = (supplier) => {
    if (!supplier || !supplier.movements) return 0
    return supplier.movements.reduce((sum, m) => {
      return m.type === 'deuda' ? sum + parseFloat(m.amount) : sum - parseFloat(m.amount)
    }, 0)
  }

  const handleCreateSupplier = async (e) => {
    e.preventDefault()
    try {
      await api.post('/suppliers', formData)
      setIsAddingSupplier(false)
      setFormData({ name: '' })
      fetchSuppliers()
    } catch (err) { alert(err.message) }
  }

  const handleRegisterPayment = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/suppliers/${selectedSupplier.id}/payments`, {
        date: payData.date, amount: parseFloat(payData.amount),
        payment_method: payData.method, notes: payData.notes,
      })
      setIsAddingPayment(false)
      setPayData({ amount: '', method: 'ef', date: new Date().toISOString().split('T')[0], notes: '' })
      const res = await api.get(`/suppliers/${selectedSupplier.id}`)
      setSelectedSupplier(res.data.data)
      fetchSuppliers()
    } catch (err) { alert(err.message) }
  }

  const handleRegisterOrder = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/suppliers/${selectedSupplier.id}/orders`, {
        date: orderData.date, total: parseFloat(orderData.total), notes: orderData.notes,
      })
      setIsAddingOrder(false)
      setOrderData({ total: '', date: new Date().toISOString().split('T')[0], notes: '' })
      const res = await api.get(`/suppliers/${selectedSupplier.id}`)
      setSelectedSupplier(res.data.data)
      fetchSuppliers()
    } catch (err) { alert(err.message) }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Cuentas <span className="text-primary">Proveedores</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestión de pedidos, saldos y pagos a proveedores.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsAddingSupplier(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo Proveedor
        </Button>
      </div>

      <div className="grid lg:grid-cols-[340px_1fr] gap-6">
        {/* Supplier List */}
        <Card className="h-fit">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm">Proveedores</CardTitle>
          </CardHeader>
          <ScrollArea className="max-h-[70vh]">
            {suppliers.map(s => {
              const balance = calculateBalance(s)
              const isActive = selectedSupplier?.id === s.id
              return (
                <div
                  key={s.id}
                  onClick={async () => {
                    const res = await api.get(`/suppliers/${s.id}`)
                    setSelectedSupplier(res.data.data)
                  }}
                  className={`flex items-center justify-between px-4 py-3 border-b cursor-pointer transition-colors
                    ${isActive ? 'bg-accent border-l-4 border-l-primary' : 'hover:bg-accent/50 border-l-4 border-l-transparent'}`}
                >
                  <div>
                    <p className="font-bold text-sm">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">{s.movements?.length || 0} movimientos</p>
                  </div>
                  <span className={`font-black font-mono text-sm ${balance > 0 ? 'text-destructive' : 'text-green-500'}`}>
                    ${balance.toLocaleString()}
                  </span>
                </div>
              )
            })}
          </ScrollArea>
        </Card>

        {/* Detail */}
        <div>
          {selectedSupplier ? (
            <div className="space-y-6">
              <Card className="border-l-4 border-l-primary">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-black">{selectedSupplier.name}</h2>
                      <p className="text-xs text-muted-foreground mt-1">ID Proveedor: #{selectedSupplier.id}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Saldo Pendiente</p>
                      <p className={`text-2xl font-black font-mono ${calculateBalance(selectedSupplier) > 0 ? 'text-destructive' : 'text-green-500'}`}>
                        ${calculateBalance(selectedSupplier).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <Button size="sm" onClick={() => setIsAddingOrder(true)}>
                      <Truck className="h-4 w-4 mr-1" /> Registrar Pedido
                    </Button>
                    <Button variant="outline" size="sm" className="text-green-500 border-green-500/30 hover:text-green-500"
                      onClick={() => setIsAddingPayment(true)}>
                      <CreditCard className="h-4 w-4 mr-1" /> Registrar Pago
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm">Historial de Cuenta</CardTitle>
                </CardHeader>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>FECHA</TableHead>
                      <TableHead>OPERACIÓN</TableHead>
                      <TableHead>NOTAS</TableHead>
                      <TableHead className="text-right">DEBE</TableHead>
                      <TableHead className="text-right">HABER</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedSupplier.movements?.sort((a, b) => new Date(b.date) - new Date(a.date)).map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(m.date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={m.type === 'deuda' ? 'destructive' : 'outline'}
                            className={m.type !== 'deuda' ? 'text-green-500 border-green-500/30' : ''}>
                            {m.type === 'deuda' ? 'Pedido' : 'Pago'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {m.notes || '–'} {m.payment_method && `(${m.payment_method})`}
                        </TableCell>
                        <TableCell className="text-right font-bold font-mono text-destructive">
                          {m.type === 'deuda' ? `+${parseFloat(m.amount).toLocaleString()}` : ''}
                        </TableCell>
                        <TableCell className="text-right font-bold font-mono text-green-500">
                          {m.type === 'pago' ? `-${parseFloat(m.amount).toLocaleString()}` : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Users className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <p className="font-semibold">Seleccioná un proveedor</p>
              <p className="text-sm text-muted-foreground mt-1">Hacé clic en la lista para ver la cuenta corriente y pedidos.</p>
            </div>
          )}
        </div>
      </div>

      {/* Dialog: New Supplier */}
      <Dialog open={isAddingSupplier} onOpenChange={setIsAddingSupplier}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nuevo Proveedor</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateSupplier} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Nombre del Proveedor / Fábrica</label>
              <Input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAddingSupplier(false)}>Cancelar</Button>
              <Button className="flex-1" type="submit">Crear</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: New Order */}
      <Dialog open={isAddingOrder} onOpenChange={setIsAddingOrder}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Registrar Pedido</DialogTitle></DialogHeader>
          <form onSubmit={handleRegisterOrder} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Monto Total del Pedido ($)</label>
              <Input type="number" required value={orderData.total} onChange={e => setOrderData({ ...orderData, total: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Notas / Detalle</label>
              <Input value={orderData.notes} onChange={e => setOrderData({ ...orderData, notes: e.target.value })} placeholder="Ej: Pedido Verano 2025" />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAddingOrder(false)}>Cancelar</Button>
              <Button className="flex-1" type="submit">Registrar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: New Payment */}
      <Dialog open={isAddingPayment} onOpenChange={setIsAddingPayment}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Registrar Pago</DialogTitle></DialogHeader>
          <form onSubmit={handleRegisterPayment} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Monto Pagado ($)</label>
              <Input type="number" required value={payData.amount} onChange={e => setPayData({ ...payData, amount: e.target.value })} className="text-lg font-bold" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Método de Pago</label>
              <select
                value={payData.method}
                onChange={e => setPayData({ ...payData, method: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="ef">Efectivo</option>
                <option value="tr">Transferencia</option>
                <option value="qr">QR / Billetera</option>
              </select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAddingPayment(false)}>Cancelar</Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700" type="submit">Confirmar Pago</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Orders
