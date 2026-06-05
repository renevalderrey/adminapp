import React, { useState, useEffect, useCallback } from 'react';
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  getCustomerDebt,
  createCustomerPayment,
  getCustomerRanking,
  getCustomerSummary,
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
  Users,
  Plus,
  Search,
  Eye,
  DollarSign,
  TrendingUp,
  Loader2,
  AlertTriangle,
  CreditCard,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Pagination from '@/components/Pagination';
import { format } from 'date-fns';

const Customers = () => {
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [summary, setSummary] = useState(null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '', tax_id: '', email: '', phone: '', address: '', tax_condition: 'consumidor_final', notes: '',
  });
  const [editId, setEditId] = useState(null);

  const [payForm, setPayForm] = useState({
    amount: '', payment_date: format(new Date(), 'yyyy-MM-dd'), payment_method: 'ef', reference: '', notes: '',
  });

  const fetchCustomers = useCallback(async (query, p) => {
    setLoading(true);
    try {
      const params = {};
      if (query) params.search = query;
      params.limit = limit;
      params.offset = ((p || page) - 1) * limit;
      const res = await getCustomers(params);
      setCustomers(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error(err);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => { fetchCustomers(search, page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPage(1);
    fetchCustomers(search, 1);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditId(null);
    setForm({ name: '', tax_id: '', email: '', phone: '', address: '', tax_condition: 'consumidor_final', notes: '' });
    setError('');
    setShowForm(true);
  };

  const openEdit = (c) => {
    setEditId(c.id);
    setForm({ name: c.name, tax_id: c.tax_id || '', email: c.email || '', phone: c.phone || '', address: c.address || '', tax_condition: c.tax_condition || 'consumidor_final', notes: c.notes || '' });
    setError('');
    setShowForm(true);
  };

  const openDetail = async (c) => {
    setSelectedCustomer(c);
    try {
      const res = await getCustomer(c.id);
      setDetailData(res.data.data);
      setShowDetail(true);
    } catch (err) {
      console.error(err);
    }
  };

  const openPayment = (c) => {
    setSelectedCustomer(c);
    setPayForm({ amount: '', payment_date: format(new Date(), 'yyyy-MM-dd'), payment_method: 'ef', reference: '', notes: '' });
    setError('');
    setShowPayment(true);
  };

  const openRanking = async () => {
    try {
      const res = await getCustomerRanking(20);
      setRanking(res.data.data || []);
      setShowRanking(true);
    } catch (err) {
      console.error(err);
    }
  };

  const openSummary = async () => {
    try {
      const res = await getCustomerSummary();
      setSummary(res.data.data);
      setShowSummary(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name) { setError('El nombre es requerido'); return; }
    setSaving(true);
    setError('');
    try {
      if (editId) {
        await updateCustomer(editId, form);
      } else {
        await createCustomer(form);
      }
      setShowForm(false);
      fetchCustomers(search);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePayment = async () => {
    if (!payForm.amount || parseFloat(payForm.amount) <= 0) { setError('Ingrese un monto válido'); return; }
    setPaying(true);
    setError('');
    try {
      await createCustomerPayment(selectedCustomer.id, payForm);
      setShowPayment(false);
      if (detailData) openDetail(selectedCustomer);
      fetchCustomers(search);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setPaying(false);
    }
  };

  const formatCurrency = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? '-' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openSummary}>
            <CreditCard className="h-4 w-4 mr-2" />
            Resumen CC
          </Button>
          <Button variant="outline" onClick={openRanking}>
            <TrendingUp className="h-4 w-4 mr-2" />
            Ranking
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Cliente
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">{error}
          <button className="ml-auto font-bold float-right" onClick={() => setError('')}>×</button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {total > 0 ? `${total} clientes registrados` : 'Clientes'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o CUIT..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay clientes registrados</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>CUIT/DNI</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Condición</TableHead>
                    <TableHead className="text-right">Compras</TableHead>
                    <TableHead className="text-right">Visitas</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-xs font-mono">{c.tax_id || '-'}</TableCell>
                      <TableCell className="text-xs">{c.email || c.phone || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {c.tax_condition === 'ri' ? 'RI' : c.tax_condition === 'monotributo' ? 'Monotributo' : 'Cons. Final'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatCurrency(c.total_purchases)}</TableCell>
                      <TableCell className="text-right">{c.total_visits}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono text-xs ${c.balance > 0 ? 'text-destructive font-semibold' : 'text-green-600'}`}>
                          {formatCurrency(c.balance)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openDetail(c)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                            <Users className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openPayment(c)}>
                            <DollarSign className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                totalPages={Math.ceil(total / limit)}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre/Razón Social *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>CUIT/DNI</Label>
                <Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Condición Fiscal</Label>
                <Select value={form.tax_condition} onValueChange={(v) => setForm({ ...form, tax_condition: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consumidor_final">Consumidor Final</SelectItem>
                    <SelectItem value="monotributo">Monotributo</SelectItem>
                    <SelectItem value="ri">Responsable Inscripto</SelectItem>
                    <SelectItem value="exento">Exento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editId ? 'Guardar' : 'Crear Cliente'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetail} onOpenChange={setShowDetail} className="max-w-2xl">
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle del Cliente</DialogTitle>
          </DialogHeader>
          {detailData && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Nombre:</span> <p className="font-medium">{detailData.customer.name}</p></div>
                <div><span className="text-muted-foreground">CUIT:</span> <p>{detailData.customer.tax_id || '-'}</p></div>
                <div><span className="text-muted-foreground">Email:</span> <p>{detailData.customer.email || '-'}</p></div>
                <div><span className="text-muted-foreground">Teléfono:</span> <p>{detailData.customer.phone || '-'}</p></div>
                <div><span className="text-muted-foreground">Condición:</span> <p>{detailData.customer.tax_condition}</p></div>
                <div><span className="text-muted-foreground">Saldo:</span>
                  <p className={`font-bold ${detailData.balance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {formatCurrency(detailData.balance)}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Aging de Deuda</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { key: '0_30', label: '0-30 días' },
                    { key: '31_60', label: '31-60 días' },
                    { key: '61_90', label: '61-90 días' },
                    { key: '90_plus', label: '90+ días' },
                  ].map(b => (
                    <Card key={b.key} className={`${detailData.aging?.[b.key] > 0 ? 'bg-destructive/5' : ''}`}>
                      <CardContent className="p-3 text-center">
                        <p className="text-xs text-muted-foreground">{b.label}</p>
                        <p className="text-sm font-mono font-bold">{formatCurrency(detailData.aging?.[b.key])}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium mb-2">Últimas Ventas</p>
                  {detailData.recent_sales?.length > 0 ? (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {detailData.recent_sales.map(s => (
                        <div key={s.id} className="flex justify-between text-xs p-1.5 bg-muted/50 rounded">
                          <span>{s.date}</span>
                          <span className="font-mono">{formatCurrency(s.total)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sin ventas registradas</p>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Últimos Pagos</p>
                  {detailData.recent_payments?.length > 0 ? (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {detailData.recent_payments.map(p => (
                        <div key={p.id} className="flex justify-between text-xs p-1.5 bg-muted/50 rounded">
                          <span>{p.payment_date}</span>
                          <span className="font-mono text-green-600">-{formatCurrency(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sin pagos registrados</p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowDetail(false); openPayment(selectedCustomer); }}>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Registrar Pago
                </Button>
                <Button onClick={() => setShowDetail(false)}>Cerrar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar Pago</DialogTitle>
            <DialogDescription>
              Cliente: {selectedCustomer?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Monto *</Label>
              <Input type="number" step="0.01" min="0.01" value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input type="date" value={payForm.payment_date}
                  onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Método</Label>
                <Select value={payForm.payment_method} onValueChange={(v) => setPayForm({ ...payForm, payment_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ef">Efectivo</SelectItem>
                    <SelectItem value="tr">Transferencia</SelectItem>
                    <SelectItem value="td">Tarjeta Débito</SelectItem>
                    <SelectItem value="tc">Tarjeta Crédito</SelectItem>
                    <SelectItem value="qr">QR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Referencia</Label>
              <Input value={payForm.reference}
                onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="N° de recibo..." />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayment(false)}>Cancelar</Button>
            <Button onClick={handlePayment} disabled={paying}>
              {paying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Registrar Pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRanking} onOpenChange={setShowRanking} className="max-w-lg">
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ranking de Clientes</DialogTitle>
          </DialogHeader>
          {ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total Comprado</TableHead>
                  <TableHead className="text-right">Visitas</TableHead>
                  <TableHead>Última Compra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranking.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCurrency(c.total_purchases)}</TableCell>
                    <TableCell className="text-right">{c.visit_count}</TableCell>
                    <TableCell className="text-xs">{c.last_purchase || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resumen de Cuentas Corrientes</DialogTitle>
          </DialogHeader>
          {summary ? (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-medium mb-2">Cuentas por Cobrar (Clientes)</p>
                <p className="text-2xl font-bold text-destructive">{formatCurrency(summary.total_receivable)}</p>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {[
                    { key: '0_30', label: '0-30' }, { key: '31_60', label: '31-60' },
                    { key: '61_90', label: '61-90' }, { key: '90_plus', label: '90+' },
                  ].map(b => (
                    <div key={b.key} className="text-center">
                      <p className="text-xs text-muted-foreground">{b.label}</p>
                      <p className="text-sm font-mono">{formatCurrency(summary.aging?.[b.key])}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-2">Cuentas por Pagar (Proveedores)</p>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(summary.total_payable)}</p>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {[
                    { key: '0_30', label: '0-30' }, { key: '31_60', label: '31-60' },
                    { key: '61_90', label: '61-90' }, { key: '90_plus', label: '90+' },
                  ].map(b => (
                    <div key={b.key} className="text-center">
                      <p className="text-xs text-muted-foreground">{b.label}</p>
                      <p className="text-sm font-mono">{formatCurrency(summary.supplier_aging?.[b.key])}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t pt-2 text-sm">
                <div className="flex justify-between">
                  <span>Diferencia (Cobrar - Pagar)</span>
                  <span className={`font-bold ${summary.total_receivable - summary.total_payable >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                    {formatCurrency(summary.total_receivable - summary.total_payable)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Customers;
