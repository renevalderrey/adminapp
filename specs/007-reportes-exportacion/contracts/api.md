# API Contracts: Reportes y Exportación (Bloque 7)

## GET /api/reports/sales?from=&to=

Reporte de ventas con detalle de productos, costos y márgenes.

### Response 200
```json
{
  "ok": true,
  "data": {
    "summary": {
      "total_sales": 1250000,
      "total_cost": 780000,
      "gross_profit": 470000,
      "margin_pct": 37.6,
      "sale_count": 84
    },
    "items": [
      {
        "sale_id": "V001",
        "date": "2026-05-30",
        "product_name": "Whey Protein 2kg",
        "quantity": 2,
        "unit_price": 25000,
        "cost": 15000,
        "margin": 10000,
        "margin_pct": 40
      }
    ]
  }
}
```

## GET /api/reports/inventory

Stock valorizado.

### Response 200
```json
{
  "ok": true,
  "data": {
    "total_value": 3500000,
    "items": [
      {
        "product_id": 1,
        "product_name": "Whey Protein 2kg",
        "sku": "WHEY-2KG",
        "location": "general",
        "quantity": 50,
        "cost": 15000,
        "total_value": 750000
      }
    ]
  }
}
```

## GET /api/reports/profit?from=&to=

Resumen de pérdidas y ganancias.

### Response 200
```json
{
  "ok": true,
  "data": {
    "period": { "from": "2026-05-01", "to": "2026-05-30" },
    "total_revenue": 1250000,
    "total_cost_of_goods": 780000,
    "gross_profit": 470000,
    "fixed_expenses": 240000,
    "net_profit": 230000,
    "net_margin_pct": 18.4
  }
}
```
