import React, { useState, useEffect } from 'react'
import useStore from '@/store/useStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  TrendingUp,
  Calculator,
  Target,
  AlertCircle,
  Zap,
} from 'lucide-react'

const Dashboard = () => {
  const { products, settings, initialize } = useStore()
  const [targetSales, setTargetSales] = useState(settings.target_sales || 7000000)
  const [fixedExpenses, setFixedExpenses] = useState(settings.fixed_expenses_total || 2400000)

  useEffect(() => {
    initialize()
  }, [initialize])

  const bepMargin = Math.round((fixedExpenses / targetSales) * 100)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">
          Panel de <span className="text-primary">Control</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Análisis de rentabilidad y Punto de Equilibrio (BEP).
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Facturación Estimada</p>
            <p className="text-2xl font-black font-mono mt-1">${(targetSales / 1000000).toFixed(1)}M</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Objetivo mensual</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gastos Fijos (GF)</p>
            <p className="text-2xl font-black font-mono mt-1 text-destructive">${(fixedExpenses / 1000000).toFixed(1)}M</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Sueldos, Alquiler, Impuestos</p>
          </CardContent>
        </Card>
        <Card className="border-green-500/30 bg-green-500/5 dark:bg-green-500/5">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Margen BEP</p>
            <p className="text-2xl font-black font-mono mt-1 text-green-500">{bepMargin}%</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Mínimo para no perder</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Promedio Ticket</p>
            <p className="text-2xl font-black font-mono mt-1">$14.5K</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Últimos 30 días</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* BEP Calculator */}
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

        {/* Strategies */}
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
                  <span className="font-bold text-sm text-green-500">🎯 BEP JUSTO</span>
                  <Badge variant="outline" className="text-green-500 border-green-500/30">{bepMargin}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Precio de supervivencia. Cubre exactamente los gastos fijos sin utilidad neta.</p>
              </CardContent>
            </Card>

            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-primary">⚡ RECOMENDADO</span>
                  <Badge>{bepMargin + 10}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Equilibrio entre competitividad y rentabilidad saludable (10% utilidad neta).</p>
              </CardContent>
            </Card>

            <Card className="border-orange-500/20 bg-orange-500/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-orange-500">🚀 AGRESIVO</span>
                  <Badge variant="outline" className="text-orange-500 border-orange-500/30">{bepMargin + 25}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Maximización de márgenes para productos exclusivos o baja rotación.</p>
              </CardContent>
            </Card>

            <Card className="bg-muted/50">
              <CardContent className="p-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-[11px] text-muted-foreground font-medium">
                  El recargo por tarjeta sugerido es del <strong>{settings.recargo_tarjeta}%</strong> para mantener estos márgenes.
                </span>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default Dashboard
