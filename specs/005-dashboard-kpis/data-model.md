# Data Model: Dashboard Estratégico / KPIs (Bloque 5)

No se crean nuevas tablas. El dashboard es una vista agregada (read model) que consulta:

## Fuentes de Datos

```
dashboard_kpis {
  sales_last_30d {
    total:          SUM(Sale.total) WHERE date >= hoy-30
    count:          COUNT(Sale.id)  WHERE date >= hoy-30
    avg_ticket:     total / count
    by_method:      { efectivo: X, tarjeta: Y, ... }
  }
  sales_current_month {
    total:          SUM(Sale.total) WHERE date >= 1ro del mes
    count:          COUNT(Sale.id)
  }
  sales_previous_month {
    total:          SUM(Sale.total) WHERE date >= 1ro del mes anterior AND date < 1ro del mes actual
    count:          COUNT(Sale.id)
  }
  cashflow {
    balance:        CashflowService.getBalance().balance
    projected_30d:  CashflowService.getBalance().projected_30d
    projected_60d:  CashflowService.getBalance().projected_60d
  }
  customers {
    active:         COUNT(Customer) WHERE is_active = true
    with_debt:      COUNT(Customer con balance > 0)
  }
  receivables {
    total:          SUM(Sale) - SUM(CustomerPayment)
    aging:          { 0_30, 31_60, 61_90, 90_plus }
  }
  payables {
    total:          SUM(SupplierMovement) WHERE type = 'deuda'
    aging:          { 0_30, 31_60, 61_90, 90_plus } por due_date
  }
  products {
    active:         COUNT(Product) WHERE is_active = true
    low_stock:      COUNT(Stock) WHERE quantity <= min_stock
  }
  fixed_expenses:   SUM(FixedExpense.amount)
  alerts {
    low_stock:      Stock WHERE quantity <= min_stock (top 5)
    expiring:       Stock WHERE expiration_date <= hoy+30 (top 5)
  }
}
```

## Cálculos

### Aging de Cuentas por Cobrar
```
0-30 días:   ventas con fecha entre hoy-30 y hoy, menos pagos en mismo período
31-60 días:  ventas con fecha entre hoy-60 y hoy-31, menos pagos
61-90 días:  ventas con fecha entre hoy-90 y hoy-61, menos pagos
90+ días:    ventas con fecha < hoy-90, menos pagos
```

### Aging de Cuentas por Pagar
```
0-30 días:   SupplierMovement(due_date entre hoy y hoy+30)
31-60 días:  SupplierMovement(due_date entre hoy+31 y hoy+60)
61-90 días:  SupplierMovement(due_date entre hoy+61 y hoy+90)
90+ días:    SupplierMovement(due_date > hoy+90)
```
