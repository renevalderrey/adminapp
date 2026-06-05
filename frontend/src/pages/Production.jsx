import React, { useState, useEffect, useCallback } from 'react';
import {
  getProductionOrders,
  getProductionOrder,
  createProductionOrder,
  voidProductionOrder,
  getProductRecipe,
  getProducts,
} from '@/services/api';
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
  DialogDescription,
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
  Search,
  Plus,
  Eye,
  XCircle,
  Loader2,
  AlertTriangle,
  Calendar,
  Package,
  Hash,
  FileText,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';

const Production = () => {
  const [allProducts, setAllProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    product_id: '',
    status: '',
    batch_code: '',
    date_from: '',
    date_to: '',
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [createErrors, setCreateErrors] = useState('');
  const [preview, setPreview] = useState(null);
  const [calculating, setCalculating] = useState(false);

  const [form, setForm] = useState({
    product_id: '',
    quantity_produced: '',
    batch_code: '',
    production_date: format(new Date(), 'yyyy-MM-dd'),
    location: 'general',
    notes: '',
  });

  const fetchOrders = useCallback(async (filtersToUse) => {
    setLoading(true);
    try {
      const params = {};
      if (filtersToUse.product_id) params.product_id = filtersToUse.product_id;
      if (filtersToUse.status) params.status = filtersToUse.status;
      if (filtersToUse.batch_code) params.batch_code = filtersToUse.batch_code;
      if (filtersToUse.date_from) params.date_from = filtersToUse.date_from;
      if (filtersToUse.date_to) params.date_to = filtersToUse.date_to;
      params.limit = 100;
      const res = await getProductionOrders(params);
      setOrders(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error('Error fetching orders:', err);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    fetchOrders(newFilters);
  };

  const handleFormChange = (key, value) => {
    const newForm = { ...form, [key]: value };
    setForm(newForm);
    setCreateErrors('');

    if (newForm.product_id && newForm.quantity_produced) {
      calculatePreview(newForm.product_id, newForm.quantity_produced);
    } else {
      setPreview(null);
    }
  };

  const calculatePreview = async (productId, quantity) => {
    setCalculating(true);
    try {
      const res = await getProductRecipe(productId);
      const recipe = res.data.data;
      if (!recipe) {
        setPreview(null);
        return;
      }
      const items = recipe.items || [];
      const lossPct = parseFloat(recipe.loss_percentage) || 0;
      const recipeYield = parseFloat(recipe.yield) || 1;
      const qty = parseFloat(quantity) || 0;

      let totalIngredientsCost = 0;
      const ingredientDetails = [];

      for (const item of items) {
        const itemQty = parseFloat(item.quantity) || 0;
        const unitCost = parseFloat(item.ingredient ? item.ingredient.cost : 0) || 0;
        const subtotal = itemQty * unitCost;
        totalIngredientsCost += subtotal;
        ingredientDetails.push({
          name: item.ingredient ? item.ingredient.name : 'N/A',
          qty: itemQty,
          unitCost,
          subtotal,
          required: itemQty * qty,
        });
      }

      const denominator = recipeYield * (1 - lossPct / 100);
      const totalCost = denominator > 0 ? (totalIngredientsCost * qty) / denominator : 0;
      const unitCost = qty > 0 ? totalCost / qty : 0;

      setPreview({
        ingredientDetails,
        totalCost: totalCost.toFixed(2),
        unitCost: unitCost.toFixed(4),
        lossPct,
        recipeYield,
      });
    } catch (err) {
      console.error('Preview error:', err);
      setPreview(null);
    } finally {
      setCalculating(false);
    }
  };

  const openCreateModal = () => {
    setForm({
      product_id: '',
      quantity_produced: '',
      batch_code: '',
      production_date: format(new Date(), 'yyyy-MM-dd'),
      location: 'general',
      notes: '',
    });
    setPreview(null);
    setCreateErrors('');
    setShowCreateModal(true);
  };

  const handleCreate = async () => {
    if (!form.product_id || !form.quantity_produced || !form.batch_code) {
      setCreateErrors('Completá los campos requeridos: producto, cantidad y lote');
      return;
    }
    setCreating(true);
    setCreateErrors('');
    try {
      await createProductionOrder({
        product_id: parseInt(form.product_id),
        quantity_produced: parseFloat(form.quantity_produced),
        batch_code: form.batch_code,
        production_date: form.production_date,
        location: form.location,
        notes: form.notes || undefined,
      });
      setShowCreateModal(false);
      fetchOrders(filters);
    } catch (err) {
      setCreateErrors(err.response?.data?.error || err.message);
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (id) => {
    try {
      const res = await getProductionOrder(id);
      setDetailOrder(res.data.data);
      setShowDetailModal(true);
    } catch (err) {
      console.error('Error fetching detail:', err);
    }
  };

  const openVoidConfirm = (order) => {
    setSelectedOrder(order);
    setShowVoidConfirm(true);
  };

  const handleVoid = async () => {
    if (!selectedOrder) return;
    setVoiding(true);
    try {
      await voidProductionOrder(selectedOrder.id);
      setShowVoidConfirm(false);
      setSelectedOrder(null);
      setShowDetailModal(false);
      fetchOrders(filters);
    } catch (err) {
      console.error('Error voiding order:', err);
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setVoiding(false);
    }
  };

  const [productsWithRecipe, setProductsWithRecipe] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await getProducts();
        const all = res.data.data || [];
        setAllProducts(all);
        const withRecipe = [];
        for (const p of all) {
          try {
            const r = await getProductRecipe(p.id);
            if (r.data.data) withRecipe.push({ ...p, recipe: r.data.data });
          } catch { }
        }
        setProductsWithRecipe(withRecipe);
      } catch { }
    })();
  }, []);

  const formatCurrency = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? '-' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Producción</h1>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva Orden
        </Button>
      </div>

      {errorMsg && (
        <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {errorMsg}
          <button className="ml-auto font-bold" onClick={() => setErrorMsg('')}>×</button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[150px]">
              <Select value={filters.product_id} onValueChange={(v) => handleFilterChange('product_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Producto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">Todos</SelectItem>
                  {allProducts.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[130px]">
              <Select value={filters.status} onValueChange={(v) => handleFilterChange('status', v === ' ' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">Todos</SelectItem>
                  <SelectItem value="completed">Completada</SelectItem>
                  <SelectItem value="voided">Anulada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[130px]">
              <Input
                placeholder="Lote..."
                value={filters.batch_code}
                onChange={(e) => handleFilterChange('batch_code', e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[130px]">
              <Input
                type="date"
                value={filters.date_from}
                onChange={(e) => handleFilterChange('date_from', e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[130px]">
              <Input
                type="date"
                value={filters.date_to}
                onChange={(e) => handleFilterChange('date_to', e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => {
              const cleared = { product_id: '', status: '', batch_code: '', date_from: '', date_to: '' };
              setFilters(cleared);
              fetchOrders(cleared);
            }}>
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay órdenes de producción</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Costo Unit.</TableHead>
                  <TableHead className="text-right">Costo Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(order => (
                  <TableRow key={order.id}>
                    <TableCell>{order.production_date}</TableCell>
                    <TableCell className="font-medium">{order.product_name}</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 py-0.5 rounded">{order.batch_code}</code></TableCell>
                    <TableCell className="text-right">{parseFloat(order.quantity_produced).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCurrency(order.unit_cost_calculated)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCurrency(order.total_cost)}</TableCell>
                    <TableCell>
                      <Badge variant={order.status === 'voided' ? 'secondary' : 'default'}>
                        {order.status === 'completed' ? 'Completada' : 'Anulada'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openDetail(order.id)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {order.status === 'completed' && (
                          <Button variant="ghost" size="icon" onClick={() => openVoidConfirm(order)}>
                            <XCircle className="h-4 w-4 text-destructive" />
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

      {total > 0 && (
        <p className="text-sm text-muted-foreground">
          Mostrando {orders.length} de {total} órdenes
        </p>
      )}

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva Orden de Producción</DialogTitle>
            <DialogDescription>
              Completá los datos para registrar una nueva orden.
            </DialogDescription>
          </DialogHeader>

          {createErrors && (
            <div className="bg-destructive/10 text-destructive px-3 py-2 rounded-md text-sm">
              {createErrors}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Producto a fabricar *</Label>
              <Select value={form.product_id} onValueChange={(v) => handleFormChange('product_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto con receta..." />
                </SelectTrigger>
                <SelectContent>
                  {productsWithRecipe.length === 0 && (
                    <SelectItem value="__none__" disabled>No hay productos con receta</SelectItem>
                  )}
                  {productsWithRecipe.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cantidad a producir *</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.quantity_produced}
                  onChange={(e) => handleFormChange('quantity_produced', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Código de Lote *</Label>
                <Input
                  value={form.batch_code}
                  onChange={(e) => handleFormChange('batch_code', e.target.value)}
                  placeholder="Ej: P-2026-001"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha de producción</Label>
                <Input
                  type="date"
                  value={form.production_date}
                  onChange={(e) => handleFormChange('production_date', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Sucursal destino</Label>
                <Select value={form.location} onValueChange={(v) => handleFormChange('location', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="ortiz">Ortiz</SelectItem>
                    <SelectItem value="mayo">Mayo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => handleFormChange('notes', e.target.value)}
                placeholder="Observaciones opcionales..."
              />
            </div>

            {calculating && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Calculando costos...
              </div>
            )}

            {preview && !calculating && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">Preview de Costos</p>
                <div className="text-xs space-y-1">
                  {preview.ingredientDetails.map((ing, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{ing.name}: {ing.qty} unid. × {formatCurrency(ing.unitCost)}</span>
                      <span className="font-mono">{formatCurrency(ing.subtotal)}</span>
                    </div>
                  ))}
                  <div className="border-t pt-1 mt-1" />
                  <div className="flex justify-between text-sm font-medium">
                    <span>Costo Total Lote</span>
                    <span className="font-mono">{formatCurrency(preview.totalCost)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-medium">
                    <span>Costo Unitario Real</span>
                    <span className="font-mono">{formatCurrency(preview.unitCost)}</span>
                  </div>
                  {preview.lossPct > 0 && (
                    <div className="text-muted-foreground">
                      Merma: {preview.lossPct}% | Rendimiento: {preview.recipeYield} unid.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar Orden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Detalle de Orden de Producción</DialogTitle>
          </DialogHeader>
          {detailOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Producto:</span>
                  <p className="font-medium">{detailOrder.product_name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Lote:</span>
                  <p className="font-mono">{detailOrder.batch_code}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Fecha:</span>
                  <p>{detailOrder.production_date}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Estado:</span>
                  <Badge variant={detailOrder.status === 'voided' ? 'secondary' : 'default'}>
                    {detailOrder.status === 'completed' ? 'Completada' : 'Anulada'}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Cantidad producida:</span>
                  <p>{parseFloat(detailOrder.quantity_produced).toFixed(2)} unid.</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Costo unitario:</span>
                  <p className="font-mono">{formatCurrency(detailOrder.unit_cost_calculated)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Costo total lote:</span>
                  <p className="font-mono">{formatCurrency(detailOrder.total_cost)}</p>
                </div>
                {detailOrder.voided_at && (
                  <div>
                    <span className="text-muted-foreground">Anulada el:</span>
                    <p>{format(new Date(detailOrder.voided_at), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                )}
              </div>

              {detailOrder.items && detailOrder.items.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Insumos consumidos</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Insumo</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">Costo Unit.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailOrder.items.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>{item.ingredient_name}</TableCell>
                          <TableCell className="text-right">{parseFloat(item.quantity_used).toFixed(4)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatCurrency(item.unit_cost_at_time)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {detailOrder.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Notas:</span>
                  <p className="mt-1 p-2 bg-muted/50 rounded text-sm">{detailOrder.notes}</p>
                </div>
              )}

              {detailOrder.status === 'completed' && (
                <div className="flex justify-end">
                  <Button variant="destructive" onClick={() => {
                    setShowDetailModal(false);
                    setTimeout(() => openVoidConfirm(detailOrder), 300);
                  }}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Anular Orden
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showVoidConfirm} onOpenChange={setShowVoidConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar Anulación</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de anular la orden de producción{selectedOrder ? ` #${selectedOrder.id} - ${selectedOrder.product_name}` : ''}?
              <br /><br />
              Se revertirán los movimientos de stock: los insumos volverán al inventario y el producto terminado se descontará.
              <br /><br />
              <strong>Esta acción no se puede deshacer.</strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVoidConfirm(false)} disabled={voiding}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleVoid} disabled={voiding}>
              {voiding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar Anulación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Production;
