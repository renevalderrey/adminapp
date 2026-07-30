import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getPurchaseOrders,
  getPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  getSuppliers,
} from '@/services/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Package,
  Truck,
  XCircle,
  CheckCircle2,
  Loader2,
  Search,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';

const STATUS_LABELS = {
  pending: 'Pendiente',
  partial: 'Recibido Parcial',
  received: 'Recibido',
  cancelled: 'Anulado',
};

const STATUS_VARIANTS = {
  pending: 'secondary',
  partial: 'warning',
  received: 'default',
  cancelled: 'outline',
};

const PurchaseOrders = () => {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [suppliers, setSuppliers] = useState([]);

  const [filters, setFilters] = useState({
    supplier_id: '',
    status: '',
    from: '',
    to: '',
  });

  const [receiveForm, setReceiveForm] = useState({});

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.supplier_id) params.supplier_id = filters.supplier_id;
      if (filters.status) params.status = filters.status;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      params.limit = 100;

      const res = await getPurchaseOrders(params);
      setOrders(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    getSuppliers().then(res => setSuppliers(res.data.data || [])).catch(() => {});
  }, []);

  const formatCurrency = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? '-' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  };

  const handleViewDetail = async (id) => {
    try {
      const res = await getPurchaseOrder(id);
      setSelectedOrder(res.data.data);
      setShowDetail(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReceive = async () => {
    if (!selectedOrder) return;
    try {
      const items = selectedOrder.items
        .filter(item => {
          const qty = parseFloat(receiveForm[item.product_id]);
          return qty > 0;
        })
        .map(item => ({
          product_id: item.product_id,
          quantity_received: parseFloat(receiveForm[item.product_id]),
        }));

      if (items.length === 0) return;

      await receivePurchaseOrder(selectedOrder.id, items, 'general');
      setShowReceive(false);
      setShowDetail(false);
      fetchOrders();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancel = async (id) => {
    const ok = await confirm('¿Anular esta orden de compra?');
    if (!ok) return;
    try {
      await cancelPurchaseOrder(id);
      fetchOrders();
      setShowDetail(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Órdenes de Compra</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Proveedor</Label>
              <Select value={filters.supplier_id} onValueChange={(v) => setFilters({ ...filters, supplier_id: v })}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">Todos</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Estado</Label>
              <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">Todos</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="partial">Recibido Parcial</SelectItem>
                  <SelectItem value="received">Recibido</SelectItem>
                  <SelectItem value="cancelled">Anulado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="w-40" />
            </div>
            <Button size="sm" onClick={fetchOrders}><Search className="h-4 w-4 mr-1" /> Filtrar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-muted-foreground">{total} órdenes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Sin órdenes de compra
                    </TableCell>
                  </TableRow>
                ) : orders.map(o => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-accent/50" onClick={() => handleViewDetail(o.id)}>
                    <TableCell className="text-xs font-mono">{o.id}</TableCell>
                    <TableCell className="font-medium">{o.supplier_name}</TableCell>
                    <TableCell className="text-xs">{o.date}</TableCell>
                    <TableCell className="text-xs">{o.items?.length || 0} items</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(o.total)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[o.status] || 'outline'}>
                        {STATUS_LABELS[o.status] || o.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        {(o.status === 'pending' || o.status === 'partial') && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600"
                            onClick={() => { setSelectedOrder(o); setShowReceive(true); setReceiveForm({}); }}>
                            <Truck className="h-4 w-4" />
                          </Button>
                        )}
                        {(o.status === 'pending' || o.status === 'partial') && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            onClick={() => handleCancel(o.id)}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Order Detail Dialog */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Orden #{selectedOrder?.id} — {selectedOrder?.supplier_name}</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="text-xs text-muted-foreground">
                  Fecha: {selectedOrder.date} | {selectedOrder.notes || 'Sin notas'}
                </div>
                <Badge variant={STATUS_VARIANTS[selectedOrder.status]}>
                  {STATUS_LABELS[selectedOrder.status]}
                </Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">P/U</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedOrder.items?.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell>{item.product_name}</TableCell>
                      <TableCell className="text-right font-mono">{item.quantity}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(item.quantity * item.unit_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="font-bold">Total</span>
                <span className="font-bold font-mono text-lg">{formatCurrency(selectedOrder.total)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog open={showReceive} onOpenChange={setShowReceive}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recibir Orden #{selectedOrder?.id}</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Ingresá la cantidad recibida de cada producto:</p>
              {selectedOrder.items?.map((item) => {
                const ordered = parseFloat(item.quantity) || 0;
                const received = parseFloat(item.quantity_received) || 0;
                const remaining = ordered - received;
                return (
                  <div key={item.product_id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.product_name}</p>
                      <p className="text-xs text-muted-foreground">Pedido: {ordered} | Recibido: {received}</p>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={remaining}
                      step="1"
                      className="w-24 text-right font-mono"
                      placeholder={`Máx ${remaining}`}
                      value={receiveForm[item.product_id] || ''}
                      onChange={(e) => setReceiveForm({ ...receiveForm, [item.product_id]: e.target.value })}
                    />
                  </div>
                );
              })}
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowReceive(false)}>Cancelar</Button>
                <Button onClick={handleReceive}><Truck className="h-4 w-4 mr-1" /> Confirmar Recepción</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </div>
  );
};

export default PurchaseOrders;
