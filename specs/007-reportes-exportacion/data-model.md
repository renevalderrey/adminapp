# Data Model: Reportes y Exportación (Bloque 7)

No se crean nuevas tablas. Los reportes consultan datos existentes:

## Reporte de Ventas

```
SELECT
  s.id AS sale_id,
  s.date,
  si.product_name,
  si.quantity,
  si.unit_price,
  p.cost AS unit_cost,
  (si.unit_price - p.cost) AS margin,
  CASE WHEN p.cost > 0 THEN ((si.unit_price - p.cost) / p.cost) * 100 ELSE 0 END AS margin_pct
FROM sales s
JOIN sale_items si ON si.sale_id = s.id
LEFT JOIN products p ON p.id = si.product_id
WHERE s.date BETWEEN :from AND :to
ORDER BY s.date DESC
```

## Reporte de Inventario

```
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  s.location,
  s.quantity,
  p.cost,
  (s.quantity * p.cost) AS total_value
FROM stock s
JOIN products p ON p.id = s.product_id
WHERE s.quantity > 0
ORDER BY total_value DESC
```

## Reporte de Rentabilidad

```
Ingresos = SUM(Sale.total) WHERE date BETWEEN from AND to
Costo_Ventas = SUM(SaleItem.quantity * Product.cost) WHERE sale.date BETWEEN from AND to
Ganancia_Bruta = Ingresos - Costo_Ventas
Gastos_Fijos = SUM(FixedExpense.amount)
Ganancia_Neta = Ganancia_Bruta - Gastos_Fijos
```
