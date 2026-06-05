import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getTaxConfig,
  updateTaxConfig,
  getTaxCalculation,
  getTaxPayments,
  createTaxPayment,
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
  FileCheck,
  Plus,
  Calculator,
  Loader2,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';

const Taxes = () => {
  const [calculation, setCalculation] = useState(null);
  const [payments, setPayments] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [saving, setSaving] = useState(false);

  const [payForm, setPayForm] = useState({
    tax_type: 'monotributo',
    amount: '',
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    period_from: '',
    period_to: '',
    notes: '',
  });

  const [configForm, setConfigForm] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [calcRes, payRes, cfgRes] = await Promise.all([
        getTaxCalculation(new Date().getFullYear()),
        getTaxPayments(),
        getTaxConfig('monotributo'),
      ]);
      setCalculation(calcRes.data.data);
      setPayments(payRes.data.data || []);
      setConfig(cfgRes.data.data);
      setConfigForm(JSON.stringify(cfgRes.data.data?.config || {}, null, 2));
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

  const handlePayment = async () => {
    if (!payForm.amount || parseFloat(payForm.amount) <= 0) return;
    setSaving(true);
    try {
      await createTaxPayment(payForm);
      setShowPayment(false);
      fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(configForm);
      await updateTaxConfig('monotributo', parsed);
      setShowConfig(false);
      fetchData();
    } catch (err) {
      toast.error('Error en JSON: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Impuestos</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowConfig(true)}>
            <Calculator className="h-4 w-4 mr-2" />
            Configurar Escalas
          </Button>
          <Button onClick={() => setShowPayment(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Registrar Pago
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Monotributo - Cálculo Anual</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {calculation && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Facturación Anual</span>
                      <span className="font-mono font-medium">{formatCurrency(calculation.annual_billing)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Categoría</span>
                      <Badge>{calculation.category}</Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cuota Mensual</span>
                      <span className="font-mono">{formatCurrency(calculation.monthly_amount)}</span>
                    </div>
                    <div className="border-t pt-2">
                      <div className="flex justify-between text-sm font-medium">
                        <span>Total Anual</span>
                        <span className="font-mono">{formatCurrency(calculation.annual_total)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Pagado en el año</span>
                        <span className="font-mono text-green-600">{formatCurrency(calculation.paid_ytd)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold">
                        <span>Saldo Restante</span>
                        <span className={`font-mono ${calculation.remaining_ytd > 0 ? 'text-destructive' : 'text-green-600'}`}>
                          {formatCurrency(calculation.remaining_ytd)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Pagos Registrados</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">Sin pagos registrados</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs">{p.payment_date}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{p.tax_type}</Badge></TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(p.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar Pago de Impuesto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={payForm.tax_type} onValueChange={(v) => setPayForm({ ...payForm, tax_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monotributo">Monotributo</SelectItem>
                  <SelectItem value="iibb">IIBB</SelectItem>
                  <SelectItem value="retenciones">Retenciones</SelectItem>
                  <SelectItem value="ganancias">Ganancias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monto *</Label>
                <Input type="number" step="0.01" min="0.01" value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input type="date" value={payForm.payment_date}
                  onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Período Desde</Label>
                <Input type="date" value={payForm.period_from}
                  onChange={(e) => setPayForm({ ...payForm, period_from: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Período Hasta</Label>
                <Input type="date" value={payForm.period_to}
                  onChange={(e) => setPayForm({ ...payForm, period_to: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayment(false)}>Cancelar</Button>
            <Button onClick={handlePayment} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showConfig} onOpenChange={setShowConfig} className="max-w-lg">
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configuración de Escalas Monotributo</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Formato JSON. Cada escala: {`{ category, max_income, monthly }`}</p>
            <textarea
              className="w-full h-64 font-mono text-xs p-3 border rounded-md bg-muted/50"
              value={configForm}
              onChange={(e) => setConfigForm(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfig(false)}>Cancelar</Button>
            <Button onClick={handleSaveConfig} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Taxes;
