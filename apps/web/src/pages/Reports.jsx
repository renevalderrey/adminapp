import React, { useState, useEffect, useCallback } from 'react';
import {
  getSalesReport,
  getInventoryReport,
  getProfitReport,
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
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';

const TABS = [
  { id: 'sales', label: 'Ventas' },
  { id: 'profit', label: 'Rentabilidad' },
  { id: 'inventory', label: 'Inventario' },
];

const Reports = () => {
  const [activeTab, setActiveTab] = useState('sales');
  const [salesData, setSalesData] = useState(null);
  const [profitData, setProfitData] = useState(null);
  const [inventoryData, setInventoryData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [dateFrom, setDateFrom] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const fetchSales = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSalesReport(dateFrom, dateTo);
      if (res.data?.ok) setSalesData(res.data.data);
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [dateFrom, dateTo]);

  const fetchProfit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProfitReport(dateFrom, dateTo);
      if (res.data?.ok) setProfitData(res.data.data);
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [dateFrom, dateTo]);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getInventoryReport();
      if (res.data?.ok) setInventoryData(res.data.data);
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, []);

  useEffect(() => {
    if (activeTab === 'sales') fetchSales();
    else if (activeTab === 'profit') fetchProfit();
    else if (activeTab === 'inventory') fetchInventory();
  }, [activeTab, fetchSales, fetchProfit, fetchInventory]);

  const formatCurrency = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? '-' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  };

  const exportToXLSX = (data, filename) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  const exportToCSV = (data, filename) => {
    const headers = Object.keys(data[0] || {});
    const csvRows = [
      headers.join(','),
      ...data.map(row =>
        headers.map(h => {
          const val = row[h];
          const str = String(val ?? '');
          return str.includes(',') ? `"${str}"` : str;
        }).join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date Filter (except inventory) */}
      {activeTab !== 'inventory' && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Desde</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hasta</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
              </div>
              <Button size="sm" onClick={activeTab === 'sales' ? fetchSales : fetchProfit}>
                Generar Reporte
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          {/* Sales Report */}
          {activeTab === 'sales' && salesData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-3 text-center">
                    <DollarSign className="h-4 w-4 mx-auto mb-1 text-primary" />
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Ventas</p>
                    <p className="text-lg font-black font-mono">{formatCurrency(salesData.summary.total_sales)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <TrendingDown className="h-4 w-4 mx-auto mb-1 text-destructive" />
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Costo</p>
                    <p className="text-lg font-black font-mono">{formatCurrency(salesData.summary.total_cost)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <TrendingUp className="h-4 w-4 mx-auto mb-1 text-green-600" />
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Ganancia Bruta</p>
                    <p className="text-lg font-black font-mono text-green-600">{formatCurrency(salesData.summary.gross_profit)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <TrendingUp className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Margen %</p>
                    <p className="text-lg font-black font-mono">{salesData.summary.margin_pct}%</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm text-muted-foreground">
                    {salesData.items.length} líneas — {salesData.summary.sale_count} ventas
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => exportToXLSX(salesData.items, 'reporte-ventas')}>
                      <FileSpreadsheet className="h-4 w-4 mr-1" /> XLSX
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => exportToCSV(salesData.items, 'reporte-ventas')}>
                      <FileText className="h-4 w-4 mr-1" /> CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0 max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Venta</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Cant</TableHead>
                        <TableHead className="text-right">P/U</TableHead>
                        <TableHead className="text-right">Costo</TableHead>
                        <TableHead className="text-right">Margen</TableHead>
                        <TableHead className="text-right">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesData.items.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{item.date}</TableCell>
                          <TableCell className="text-xs font-mono">{item.sale_id}</TableCell>
                          <TableCell className="text-sm">{item.product_name}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{item.quantity}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(item.unit_price)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(item.cost)}</TableCell>
                          <TableCell className={`text-right font-mono text-sm font-medium ${item.margin >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                            {formatCurrency(item.margin)}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm ${item.margin_pct >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                            {item.margin_pct}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Profit Report */}
          {activeTab === 'profit' && profitData && (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="text-center p-4 bg-green-50 dark:bg-green-950/20 rounded-lg">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Ingresos</p>
                      <p className="text-2xl font-black font-mono text-green-600">{formatCurrency(profitData.total_revenue)}</p>
                    </div>
                    <div className="text-center p-4 bg-red-50 dark:bg-red-950/20 rounded-lg">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Costo de Ventas</p>
                      <p className="text-2xl font-black font-mono text-destructive">{formatCurrency(profitData.total_cost_of_goods)}</p>
                    </div>
                    <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Ganancia Bruta</p>
                      <p className="text-2xl font-black font-mono text-blue-600">{formatCurrency(profitData.gross_profit)}</p>
                    </div>
                    <div className="text-center p-4 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Gastos Fijos</p>
                      <p className="text-2xl font-black font-mono text-orange-600">{formatCurrency(profitData.fixed_expenses)}</p>
                    </div>
                    <div className="text-center p-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Ganancia Neta</p>
                      <p className={`text-2xl font-black font-mono ${profitData.net_profit >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {formatCurrency(profitData.net_profit)}
                      </p>
                    </div>
                    <div className="text-center p-4 bg-muted rounded-lg">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">Margen Neto</p>
                      <p className={`text-2xl font-black font-mono ${profitData.net_margin_pct >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {profitData.net_margin_pct}%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => exportToXLSX([profitData], 'reporte-rentabilidad')}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" /> XLSX
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportToCSV([profitData], 'reporte-rentabilidad')}>
                  <FileText className="h-4 w-4 mr-1" /> CSV
                </Button>
              </div>
            </div>
          )}

          {/* Inventory Report */}
          {activeTab === 'inventory' && inventoryData && (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Package className="h-8 w-8 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">Valor Total del Inventario</p>
                      <p className="text-2xl font-black font-mono">{formatCurrency(inventoryData.total_value)}</p>
                    </div>
                    <Badge variant="outline" className="ml-auto">{inventoryData.items.length} productos</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm text-muted-foreground">Detalle por Producto</CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => exportToXLSX(inventoryData.items, 'inventario')}>
                      <FileSpreadsheet className="h-4 w-4 mr-1" /> XLSX
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => exportToCSV(inventoryData.items, 'inventario')}>
                      <FileText className="h-4 w-4 mr-1" /> CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0 max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Ubicación</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Costo U.</TableHead>
                        <TableHead className="text-right">Valor Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventoryData.items.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{item.product_name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.sku}</TableCell>
                          <TableCell className="text-xs capitalize">{item.location}</TableCell>
                          <TableCell className="text-right font-mono">{item.quantity}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(item.cost)}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatCurrency(item.total_value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Reports;
