import React, { useState, useEffect } from 'react'
import useStore from '@/store/useStore'
import { getAlerts, getDashboardKpis } from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useIsMounted } from '@/lib/useAsyncEffect'
import {
  TrendingUp,
  Calculator,
  Target,
  AlertCircle,
  Zap,
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  TrendingDown,
  Wallet,
  Loader2,
} from 'lucide-react'

const Dashboard = () => {
  const isMounted = useIsMounted()
  const { settings, initialize } = useStore()
  const [targetSales, setTargetSales] = useState(7000000)
  const [fixedExpenses, setFixedExpenses] = useState(2400000)
  const [alerts, setAlerts] = useState({ lowStock: [], expiringStock: [] })
  const [kpis, setKpis] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    initialize()
    fetchData()
    return () => ctrl.abort()
  }, [initialize])

  useEffect(() => {
    if (settings) {
      setTargetSales(settings.target_sales || 7000000)
      setFixedExpenses(settings.fixed_expenses_total || 2400000)
    }
  }, [settings])

  const fetchData = async () => {
    try {
      const [kpiRes, alertsRes] = await Promise.all([
        getDashboardKpis(),
        getAlerts(),
      ])
      if (!isMounted()) return
      if (kpiRes.data?.ok) setKpis(kpiRes.data.data)
      if (alertsRes.data?.ok) setAlerts(alertsRes.data.data)
    } catch (err) {
      console.error('[Dashboard]', err)
    } finally {
      if (isMounted()) setLoading(false)
    }
  }

  const bepMargin = fixedExpenses > 0 && targetSales > 0
    ? Math.round((fixedExpenses / targetSales) * 100)
    : 0

  const formatCurrency = (val) => {
    const n = parseFloat(val)
    if (isNaN(n)) return '-'
    if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M'
    if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'K'
    return '$' + n.toLocaleString('es-AR')
  }

  const formatFull = (val) => {
    const n = parseFloat(val)
    if (isNaN(n)) return '-'
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 })
  }

  const calcGrowth = (current, previous) => {
    if (!previous || previous === 0) return null
    return ((current - previous) / previous) * 100
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">
          Panel de <span className="text-primary">Control</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Indicadores clave del negocio en tiempo real.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <ShoppingCart className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ventas 30d</p>
            <p className="text-lg font-black font-mono mt-1">{formatCurrency(kpis?.sales_30d?.total)}</p>
            <p className="text-[10px] text-muted-foreground">{kpis?.sales_30d?.count} ops</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <TrendingUp className="h-4 w-4 mx-auto mb-1 text-green-600" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ticket Prom.</p>
            <p className="text-lg font-black font-mono mt-1">{formatCurrency(kpis?.sales_30d?.avg_ticket)}</p>
            <p className="text-[10px] text-muted-foreground">promedio 30d</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <DollarSign className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Saldo Caja</p>
            <p className={`text-lg font-black font-mono mt-1 ${kpis?.cashflow?.balance >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {formatCurrency(kpis?.cashflow?.balance)}
            </p>
            <p className="text-[10px] text-muted-foreground">actual</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <Wallet className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Proy. 30d</p>
            <p className={`text-lg font-black font-mono mt-1 ${kpis?.cashflow?.projected_30d >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {formatCurrency(kpis?.cashflow?.projected_30d)}
            </p>
            <p className="text-[10px] text-muted-foreground">proyección</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Clientes</p>
            <p className="text-lg font-black font-mono mt-1">{kpis?.customers?.active || 0}</p>
            <p className="text-[10px] text-muted-foreground">
              {kpis?.customers?.with_debt || 0} con deuda
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <Package className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Productos</p>
            <p className="text-lg font-black font-mono mt-1">{kpis?.products?.active || 0}</p>
            <p className="text-[10px] text-orange-500">
              {kpis?.products?.low_stock || 0} stock bajo
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Sales Section */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Ventas</CardTitle>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Este mes: <strong className="text-foreground">{formatCurrency(kpis?.sales_current_month?.total)}</strong></span>
                {kpis?.sales_previous_month?.total > 0 && (
                  <Badge variant={calcGrowth(kpis?.sales_current_month?.total, kpis?.sales_previous_month?.total) >= 0 ? 'default' : 'destructive'} className="text-[10px]">
                    {calcGrowth(kpis?.sales_current_month?.total, kpis?.sales_previous_month?.total) >= 0 ? '+' : ''}
                    {calcGrowth(kpis?.sales_current_month?.total, kpis?.sales_previous_month?.total)?.toFixed(1)}%
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Mes Anterior</p>
                <p className="text-lg font-bold font-mono mt-1">{formatCurrency(kpis?.sales_previous_month?.total)}</p>
                <p className="text-[10px] text-muted-foreground">{kpis?.sales_previous_month?.count} ventas</p>
              </div>
              <div className="bg-primary/5 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Mes Actual</p>
                <p className="text-lg font-bold font-mono mt-1">{formatCurrency(kpis?.sales_current_month?.total)}</p>
                <p className="text-[10px] text-muted-foreground">{kpis?.sales_current_month?.count} ventas</p>
              </div>
            </div>

            {kpis?.sales_30d?.by_method && Object.keys(kpis.sales_30d.by_method).length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Por Método de Pago (30d)</p>
                <div className="space-y-1.5">
                  {Object.entries(kpis.sales_30d.by_method).map(([method, total]) => (
                    <div key={method} className="flex justify-between items-center text-xs">
                      <span className="capitalize">{method.replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-muted rounded-full h-1.5">
                          <div
                            className="bg-primary h-1.5 rounded-full"
                            style={{ width: `${Math.min(100, (total / kpis.sales_30d.total) * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono w-20 text-right">{formatCurrency(total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cuentas Corrientes */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Cuentas Corrientes</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 dark:bg-green-950/20 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Por Cobrar</p>
                <p className="text-lg font-bold font-mono mt-1 text-green-600">{formatCurrency(kpis?.receivables?.total)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Por Pagar</p>
                <p className="text-lg font-bold font-mono mt-1 text-destructive">{formatCurrency(kpis?.payables?.total)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Aging Cobrar</p>
                {kpis?.receivables?.aging && (
                  <div className="space-y-1">
                    {[['0_30', '0-30d'], ['31_60', '31-60d'], ['61_90', '61-90d'], ['90_plus', '90+d']].map(([key, label]) => (
                      <div key={key} className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium">{formatCurrency(kpis.receivables.aging[key])}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Aging Pagar</p>
                {kpis?.payables?.aging && (
                  <div className="space-y-1">
                    {[['0_30', '0-30d'], ['31_60', '31-60d'], ['61_90', '61-90d'], ['90_plus', '90+d']].map(([key, label]) => (
                      <div key={key} className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium">{formatCurrency(kpis.payables.aging[key])}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 bg-muted/40 rounded-lg p-2.5 text-xs">
              <TrendingDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">
                Gastos Fijos: <strong className="text-foreground">{formatFull(kpis?.fixed_expenses)}</strong>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* BEP Simulator + Strategies */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">Simulador de Punto de Equilibrio</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Meta de Ventas ($)
                </label>
                <Input
                  type="number"
                  value={targetSales}
                  onChange={(e) => setTargetSales(parseFloat(e.target.value))}
                  className="text-lg font-bold font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Gastos Fijos Mensuales ($)
                </label>
                <Input
                  type="number"
                  value={fixedExpenses}
                  onChange={(e) => setFixedExpenses(parseFloat(e.target.value))}
                  className="text-lg font-bold font-mono"
                />
              </div>
            </div>

            <Card className="bg-muted/50">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Target className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Resultado de Viabilidad</p>
                    <p className="text-[11px] text-muted-foreground">Basado en tus costos operativos actuales.</p>
                  </div>
                </div>
                <p className="text-3xl font-black font-mono text-green-500">
                  {bepMargin}%{' '}
                  <span className="text-sm font-semibold text-muted-foreground ml-2">
                    de margen promedio
                  </span>
                </p>
                <p className="text-sm leading-relaxed text-foreground mt-2">
                  Para cubrir tus gastos fijos de <strong>${fixedExpenses.toLocaleString()}</strong> con
                  una facturación de <strong>${targetSales.toLocaleString()}</strong>,
                  necesitás un recargo mínimo del <strong>{bepMargin}%</strong> sobre el costo de todos tus productos.
                </p>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-orange-500" />
              <CardTitle className="text-sm">Estrategias de Precio</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Card className="border-green-500/20 bg-green-500/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-green-500">BEP JUSTO</span>
                  <Badge variant="outline" className="text-green-500 border-green-500/30">{bepMargin}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Precio de supervivencia. Cubre exactamente los gastos fijos sin utilidad neta.</p>
              </CardContent>
            </Card>

            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-primary">RECOMENDADO</span>
                  <Badge>{bepMargin + 10}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Equilibrio entre competitividad y rentabilidad saludable (10% utilidad neta).</p>
              </CardContent>
            </Card>

            <Card className="border-orange-500/20 bg-orange-500/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-orange-500">AGRESIVO</span>
                  <Badge variant="outline" className="text-orange-500 border-orange-500/30">{bepMargin + 25}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Maximización de márgenes para productos exclusivos o baja rotación.</p>
              </CardContent>
            </Card>

            <Card className="bg-muted/50">
              <CardContent className="p-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-[11px] text-muted-foreground font-medium">
                  El recargo por tarjeta sugerido es del <strong>{settings?.recargo_tarjeta || 0}%</strong> para mantener estos márgenes.
                </span>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      </div>

      {/* Alertas */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card className={alerts.lowStock?.length > 0 ? 'border-orange-500/30' : ''}>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-sm font-bold">Alertas de Stock Mínimo</CardTitle>
            </div>
            {alerts.lowStock?.length > 0 && (
              <Badge variant="destructive">{alerts.lowStock.length} productos</Badge>
            )}
          </CardHeader>
          <CardContent className="max-h-[280px] overflow-y-auto space-y-2">
            {alerts.lowStock?.map(item => (
              <div key={item.id} className="flex justify-between items-center bg-muted/40 p-2.5 rounded-lg text-xs">
                <div>
                  <p className="font-semibold text-foreground">{item.product_name}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">Sucursal: {item.location}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold font-mono text-orange-500">{item.quantity} u.</p>
                  <p className="text-[9px] text-muted-foreground">Mínimo: {item.min_stock} u.</p>
                </div>
              </div>
            ))}
            {(!alerts.lowStock || alerts.lowStock.length === 0) && (
              <div className="text-center text-xs text-muted-foreground py-8">
                Cero alertas. Todo el stock está por encima del mínimo.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={alerts.expiringStock?.length > 0 ? 'border-red-500/30' : ''}>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <CardTitle className="text-sm font-bold">Vencimientos Próximos (30 días)</CardTitle>
            </div>
            {alerts.expiringStock?.length > 0 && (
              <Badge variant="destructive" className="bg-red-500 hover:bg-red-600">{alerts.expiringStock.length} lotes</Badge>
            )}
          </CardHeader>
          <CardContent className="max-h-[280px] overflow-y-auto space-y-2">
            {alerts.expiringStock?.map(item => (
              <div key={item.id} className="flex justify-between items-center bg-muted/40 p-2.5 rounded-lg text-xs">
                <div>
                  <p className="font-semibold text-foreground">{item.product_name}</p>
                  <p className="text-[10px] text-muted-foreground">Lote: {item.current_batch || 'Sin Lote'} | Sucursal: {item.location}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-red-500">{new Date(item.expiration_date).toLocaleDateString()}</p>
                  <p className="text-[9px] text-muted-foreground">Vence pronto</p>
                </div>
              </div>
            ))}
            {(!alerts.expiringStock || alerts.expiringStock.length === 0) && (
              <div className="text-center text-xs text-muted-foreground py-8">
                Cero alertas. No hay lotes próximos a vencer.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default Dashboard
