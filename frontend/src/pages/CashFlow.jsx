import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getCashflowBalance,
  getCashflowMovements,
  createCashflowEntry,
  deleteCashflowEntry,
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
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';

const CashFlow = () => {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [balance, setBalance] = useState(null);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    type: 'inflow',
    category: 'otro',
    amount: '',
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    reference: '',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [balRes, movRes] = await Promise.all([
        getCashflowBalance(),
        getCashflowMovements({ limit: 200 }),
      ]);
      setBalance(balRes.data.data);
      setMovements(movRes.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const formatCurrency = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? '-' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleCreate = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Monto inválido'); return; }
    try {
      await createCashflowEntry(form);
      setShowModal(false);
      setForm({ type: 'inflow', category: 'otro', amount: '', entry_date: format(new Date(), 'yyyy-MM-dd'), description: '', reference: '' });
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm('¿Eliminar este movimiento?');
    if (!ok) return;
    try {
      await deleteCashflowEntry(id);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Flujo de Caja</h1>
        <Button onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Movimiento
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">{error}
          <button className="float-right font-bold" onClick={() => setError('')}>×</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className={balance?.balance >= 0 ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'}>
              <CardContent className="p-4 text-center">
                <Wallet className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Saldo Actual</p>
                <p className={`text-xl font-bold font-mono ${balance?.balance >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                  {formatCurrency(balance?.balance)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <TrendingUp className="h-5 w-5 mx-auto mb-1 text-green-600" />
                <p className="text-xs text-muted-foreground">Ingresos 30d</p>
                <p className="text-lg font-bold font-mono text-green-600">{formatCurrency(balance?.total_inflows_30d)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <TrendingDown className="h-5 w-5 mx-auto mb-1 text-destructive" />
                <p className="text-xs text-muted-foreground">Egresos 30d</p>
                <p className="text-lg font-bold font-mono text-destructive">{formatCurrency(balance?.total_outflows_30d)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <DollarSign className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Proyección 30d</p>
                <p className={`text-lg font-bold font-mono ${balance?.projected_30d >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                  {formatCurrency(balance?.projected_30d)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <DollarSign className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Proyección 60d</p>
                <p className={`text-lg font-bold font-mono ${balance?.projected_60d >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                  {formatCurrency(balance?.projected_60d)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Movimientos ({movements.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Fuente</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Sin movimientos en el período
                      </TableCell>
                    </TableRow>
                  ) : movements.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{m.date || '-'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{m.source}</Badge></TableCell>
                      <TableCell className="text-sm">{m.description}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-medium ${m.type === 'inflow' ? 'text-green-600' : 'text-destructive'}`}>
                        {m.type === 'inflow' ? '+' : '-'}{formatCurrency(m.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.type === 'inflow' ? 'default' : 'secondary'} className="text-xs">
                          {m.type === 'inflow' ? 'Ingreso' : 'Egreso'}
                        </Badge>
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo Movimiento Manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inflow">Ingreso</SelectItem>
                    <SelectItem value="outflow">Egreso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Categoría</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="otro">Otro</SelectItem>
                    <SelectItem value="prestamo">Préstamo</SelectItem>
                    <SelectItem value="inversion">Inversión</SelectItem>
                    <SelectItem value="retiro">Retiro Personal</SelectItem>
                    <SelectItem value="alquiler">Alquiler</SelectItem>
                    <SelectItem value="servicio">Servicio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monto *</Label>
                <Input type="number" step="0.01" min="0.01" value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input type="date" value={form.entry_date}
                  onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Referencia</Label>
              <Input value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </div>
  );
};

export default CashFlow;
