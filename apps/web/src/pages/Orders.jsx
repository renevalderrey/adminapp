import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
import api from '@/services/api'
import {
  getSuppliers,
  getProducts,
  updateSupplier,
  receivePurchaseOrder,
  cancelPurchaseOrder,
} from '@/services/api'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Users, Truck, Plus, CreditCard, Pencil, Package, XCircle, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Label } from '@/components/ui/label'

const STATUS_LABELS = {
  pending: 'Pendiente',
  partial: 'Recibido Parcial',
  received: 'Recibido',
  cancelled: 'Anulado',
}

const Orders = () => {
  const [suppliers, setSuppliers] = useState([])
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isAddingSupplier, setIsAddingSupplier] = useState(false)
  const [isAddingPayment, setIsAddingPayment] = useState(false)
  const [isAddingOrder, setIsAddingOrder] = useState(false)
  const [isEditingSupplier, setIsEditingSupplier] = useState(false)
  const [isReceive, setIsReceive] = useState(false)
  const [receiveItems, setReceiveItems] = useState({})

  const [formData, setFormData] = useState({ name: '' })
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', address: '', cuit: '' })
  const [payData, setPayData] = useState({ amount: '', method: 'ef', date: new Date().toISOString().split('T')[0], notes: '' })
  const [orderItems, setOrderItems] = useState([{ product_id: '', product_name: '', quantity: 1, unit_price: '' }])
  const [orderNotes, setOrderNotes] = useState('')
  const [products, setProducts] = useState([])
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0])
  const [expandedOrders, setExpandedOrders] = useState({})

  const fetchSuppliers = async () => {
    setLoading(true)
    try {
      const res = await getSuppliers()
      setSuppliers(res.data.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSuppliers() }, [])

  const loadProducts = async () => {
    try {
      const res = await getProducts({ limit: 500 })
      setProducts(res.data.data || [])
    } catch (err) { console.error(err) }
  }

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
    } catch (err) { toast.error(err.message) }
  }

  const handleEditSupplier = async (e) => {
    e.preventDefault()
    try {
      await updateSupplier(selectedSupplier.id, editForm)
      setIsEditingSupplier(false)
      const res = await api.get(`/suppliers/${selectedSupplier.id}`)
      setSelectedSupplier(res.data.data)
      fetchSuppliers()
    } catch (err) { toast.error(err.message) }
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
    } catch (err) { toast.error(err.message) }
  }

  const handleAddOrderItem = () => {
    setOrderItems([...orderItems, { product_id: '', product_name: '', quantity: 1, unit_price: '' }])
  }

  const handleRemoveOrderItem = (index) => {
    setOrderItems(orderItems.filter((_, i) => i !== index))
  }

  const handleOrderItemChange = (index, field, value) => {
    const updated = [...orderItems]
    updated[index][field] = value
    if (field === 'product_id') {
      const product = products.find(p => p.id === parseInt(value))
      if (product) {
        updated[index].product_name = product.name
        updated[index].unit_price = product.cost || ''
      }
    }
    setOrderItems(updated)
  }

  const calcOrderTotal = () => {
    return orderItems.reduce((sum, item) => {
      return sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)
    }, 0)
  }

  const handleRegisterOrder = async (e) => {
    e.preventDefault()
    try {
      const items = orderItems.filter(i => i.product_name && parseFloat(i.quantity) > 0)
      if (items.length === 0) { toast.error('Agregá al menos un producto'); return }
      await api.post(`/suppliers/${selectedSupplier.id}/orders`, {
        date: orderDate,
        notes: orderNotes,
        items: items.map(i => ({
          product_id: i.product_id ? parseInt(i.product_id) : null,
          product_name: i.product_name,
          quantity: parseFloat(i.quantity),
          unit_price: parseFloat(i.unit_price),
        })),
      })
      setIsAddingOrder(false)
      setOrderItems([{ product_id: '', product_name: '', quantity: 1, unit_price: '' }])
      setOrderNotes('')
      const res = await api.get(`/suppliers/${selectedSupplier.id}`)
      setSelectedSupplier(res.data.data)
      fetchSuppliers()
      toast.success('Pedido registrado')
    } catch (err) { toast.error(err.message) }
  }

  const handleReceiveOrder = async (order) => {
    const items = (order.detail || [])
      .filter(item => {
        const qty = parseFloat(receiveItems[item.product_id])
        return qty > 0
      })
      .map(item => ({
        product_id: item.product_id,
        quantity_received: parseFloat(receiveItems[item.product_id]),
      }))
    if (items.length === 0) { toast.error('Ingresá cantidad recibida'); return }
    try {
      await receivePurchaseOrder(order.id, items, 'general')
      setIsReceive(false)
      setReceiveItems({})
      const res = await api.get(`/suppliers/${selectedSupplier.id}`)
      setSelectedSupplier(res.data.data)
      fetchSuppliers()
      toast.success('Mercadería recibida')
    } catch (err) { toast.error(err.message) }
  }

  const handleCancelOrder = async (orderId) => {
    const ok = await confirm('¿Anular esta orden?')
    if (!ok) return
    try {
      await cancelPurchaseOrder(orderId)
      const res = await api.get(`/suppliers/${selectedSupplier.id}`)
      setSelectedSupplier(res.data.data)
      fetchSuppliers()
      toast.success('Orden anulada')
    } catch (err) { toast.error(err.message) }
  }

  const selectSupplier = async (s) => {
    const res = await api.get(`/suppliers/${s.id}`)
    setSelectedSupplier(res.data.data)
    loadProducts()
  }

  const toggleOrderExpand = (orderId) => {
    setExpandedOrders(prev => ({ ...prev, [orderId]: !prev[orderId] }))
  }

  return (
    <div className="space-y-6">
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
                  onClick={() => selectSupplier(s)}
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
              {/* Supplier Header */}
              <Card className="border-l-4 border-l-primary">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-black">{selectedSupplier.name}</h2>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => {
                            setEditForm({
                              name: selectedSupplier.name,
                              phone: selectedSupplier.phone || '',
                              email: selectedSupplier.email || '',
                              address: selectedSupplier.address || '',
                              cuit: selectedSupplier.cuit || '',
                            })
                            setIsEditingSupplier(true)
                          }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        <span>ID #{selectedSupplier.id}</span>
                        {selectedSupplier.cuit && <span>CUIT: {selectedSupplier.cuit}</span>}
                        {selectedSupplier.phone && <span>Tel: {selectedSupplier.phone}</span>}
                        {selectedSupplier.email && <span>Email: {selectedSupplier.email}</span>}
                        {selectedSupplier.address && <span>Dir: {selectedSupplier.address}</span>}
                      </div>
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

              {/* Orders */}
              {selectedSupplier.orders?.length > 0 && (
                <Card>
                  <CardHeader className="pb-3 border-b">
                    <CardTitle className="text-sm">Órdenes de Compra</CardTitle>
                  </CardHeader>
                  <div className="divide-y">
                    {selectedSupplier.orders.map(order => {
                      const detail = order.detail || []
                      const isExpanded = expandedOrders[order.id]
                      return (
                        <div key={order.id}>
                          <div
                            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/30"
                            onClick={() => toggleOrderExpand(order.id)}
                          >
                            <div className="flex items-center gap-3">
                              <Package className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">Orden #{order.id}</p>
                                <p className="text-xs text-muted-foreground">{order.date} — {detail.length} items</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge variant={order.status === 'pending' ? 'secondary' : order.status === 'received' ? 'default' : 'outline'}>
                                {STATUS_LABELS[order.status] || order.status}
                              </Badge>
                              <span className="font-mono font-bold text-sm">${parseFloat(order.total).toLocaleString()}</span>
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="px-4 pb-3 space-y-2">
                              {detail.length > 0 && (
                                <div className="bg-muted/30 rounded-lg p-3">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-muted-foreground">
                                        <th className="text-left font-medium py-1">Producto</th>
                                        <th className="text-right font-medium py-1">Cant</th>
                                        <th className="text-right font-medium py-1">P/U</th>
                                        <th className="text-right font-medium py-1">Subtotal</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.map((item, i) => (
                                        <tr key={i} className="border-t border-muted/50">
                                          <td className="py-1">{item.product_name}</td>
                                          <td className="text-right py-1 font-mono">{item.quantity}</td>
                                          <td className="text-right py-1 font-mono">${parseFloat(item.unit_price).toLocaleString()}</td>
                                          <td className="text-right py-1 font-mono">${(item.quantity * item.unit_price).toLocaleString()}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              <div className="flex gap-2">
                                {(order.status === 'pending' || order.status === 'partial') && (
                                  <>
                                    <Button size="sm" variant="outline" className="text-green-600 border-green-600/30"
                                      onClick={() => { setIsReceive(true); setReceiveItems({}) }}>
                                      <Truck className="h-3.5 w-3.5 mr-1" /> Recibir
                                    </Button>
                                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30"
                                      onClick={() => handleCancelOrder(order.id)}>
                                      <XCircle className="h-3.5 w-3.5 mr-1" /> Anular
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}

              {/* Account History */}
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
              <Label>Nombre del Proveedor / Fábrica</Label>
              <Input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAddingSupplier(false)}>Cancelar</Button>
              <Button className="flex-1" type="submit">Crear</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Edit Supplier */}
      <Dialog open={isEditingSupplier} onOpenChange={setIsEditingSupplier}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Editar Proveedor</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSupplier} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>CUIT</Label>
              <Input value={editForm.cuit} onChange={e => setEditForm({ ...editForm, cuit: e.target.value })} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsEditingSupplier(false)}>Cancelar</Button>
              <Button className="flex-1" type="submit">Guardar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: New Order */}
      <Dialog open={isAddingOrder} onOpenChange={setIsAddingOrder}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Registrar Pedido — {selectedSupplier?.name}</DialogTitle></DialogHeader>
          <form onSubmit={handleRegisterOrder} className="space-y-4">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Productos</Label>
                <Button type="button" size="sm" variant="outline" onClick={handleAddOrderItem}>
                  <Plus className="h-3 w-3 mr-1" /> Agregar
                </Button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {orderItems.map((item, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Input
                        placeholder="Nombre del producto"
                        value={item.product_name}
                        onChange={e => handleOrderItemChange(i, 'product_name', e.target.value)}
                        list={`product-list-${i}`}
                      />
                      <datalist id={`product-list-${i}`}>
                        {products.map(p => (
                          <option key={p.id} value={p.name} data-id={p.id} />
                        ))}
                      </datalist>
                    </div>
                    <div className="w-20">
                      <Input type="number" min="1" step="1" placeholder="Cant"
                        value={item.quantity} onChange={e => handleOrderItemChange(i, 'quantity', e.target.value)} />
                    </div>
                    <div className="w-24">
                      <Input type="number" min="0" step="0.01" placeholder="P/U"
                        value={item.unit_price} onChange={e => handleOrderItemChange(i, 'unit_price', e.target.value)} />
                    </div>
                    {orderItems.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive"
                        onClick={() => handleRemoveOrderItem(i)}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-between items-center">
              <div className="text-sm text-muted-foreground">
                {orderItems.filter(i => i.product_name).length} productos
              </div>
              <div className="text-lg font-bold font-mono">
                Total: ${calcOrderTotal().toLocaleString()}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={orderNotes} onChange={e => setOrderNotes(e.target.value)} placeholder="Ej: Pedido mensual" />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAddingOrder(false)}>Cancelar</Button>
              <Button className="flex-1" type="submit">Registrar Pedido</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Receive Order */}
      <Dialog open={isReceive} onOpenChange={setIsReceive}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Recibir Mercadería</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Ingresá la cantidad recibida de cada producto:</p>
            {(() => {
              const orders = selectedSupplier?.orders?.filter(o => o.status === 'pending' || o.status === 'partial') || []
              const items = orders.flatMap(o => (o.detail || []).map(item => ({ ...item, order_id: o.id })))
              const uniqueItems = items.filter((item, idx, self) =>
                idx === self.findIndex(i => i.product_id === item.product_id)
              )
              return uniqueItems.map(item => (
                <div key={item.product_id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground">Pedido: {item.quantity}</p>
                  </div>
                  <Input
                    type="number" min="0" step="1" className="w-24 text-right font-mono"
                    placeholder="Cant"
                    value={receiveItems[item.product_id] || ''}
                    onChange={(e) => setReceiveItems({ ...receiveItems, [item.product_id]: e.target.value })}
                  />
                </div>
              ))
            })()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsReceive(false)}>Cancelar</Button>
              <Button onClick={() => {
                const order = selectedSupplier?.orders?.find(o => o.status === 'pending' || o.status === 'partial')
                if (order) handleReceiveOrder(order)
              }}>
                <Truck className="h-4 w-4 mr-1" /> Confirmar Recepción
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: New Payment */}
      <Dialog open={isAddingPayment} onOpenChange={setIsAddingPayment}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Registrar Pago</DialogTitle></DialogHeader>
          <form onSubmit={handleRegisterPayment} className="space-y-4">
            <div className="space-y-2">
              <Label>Monto Pagado ($)</Label>
              <Input type="number" required value={payData.amount} onChange={e => setPayData({ ...payData, amount: e.target.value })} className="text-lg font-bold" />
            </div>
            <div className="space-y-2">
              <Label>Método de Pago</Label>
              <Select value={payData.method} onValueChange={(v) => setPayData({ ...payData, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ef">Efectivo</SelectItem>
                  <SelectItem value="tr">Transferencia</SelectItem>
                  <SelectItem value="qr">QR / Billetera</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAddingPayment(false)}>Cancelar</Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700" type="submit">Confirmar Pago</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </div>
  )
}

export default Orders
