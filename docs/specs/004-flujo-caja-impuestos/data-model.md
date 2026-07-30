# Data Model: Flujo de Caja e Impuestos

## Cash Flow Sources
- Sales (inflows)
- Customer payments (inflows)
- Expenses (outflows)
- Supplier payments (outflows)
- CashFlowEntry (manual inflows/outflows)
- Tax payments (outflows)

## Formulas

### Current Balance
```
Balance = Σ(ingresos) - Σ(egresos)
```

### 30-Day Projection
```
Proyección 30d = Saldo Actual + Σ(Ingresos Esperados 30d) - Σ(Gastos Fijos 30d) - Σ(Impuestos 30d)
```

### Monotributo Calculation
```
Categoría = lookup(ingreso_anual_facturado en escala Monotributo)
Monto Mensual = categoría.monto
```
