# API Contracts: Dashboard Estratégico / KPIs (Bloque 5)

## GET /api/dashboard/kpis

Retorna todos los indicadores del dashboard en una sola llamada.

### Response 200

```json
{
  "ok": true,
  "data": {
    "sales_30d": {
      "total": 1250000,
      "count": 84,
      "avg_ticket": 14881,
      "by_method": {
        "efectivo": 450000,
        "tarjeta_debito": 380000,
        "tarjeta_credito": 320000,
        "transferencia": 100000
      }
    },
    "sales_current_month": {
      "total": 950000,
      "count": 62
    },
    "sales_previous_month": {
      "total": 880000,
      "count": 58
    },
    "cashflow": {
      "balance": 1250000.50,
      "projected_30d": 1450000.00,
      "projected_60d": 1650000.00
    },
    "customers": {
      "active": 45,
      "with_debt": 12
    },
    "receivables": {
      "total": 280000,
      "aging": {
        "0_30": 150000,
        "31_60": 80000,
        "61_90": 30000,
        "90_plus": 20000
      }
    },
    "payables": {
      "total": 175000,
      "aging": {
        "0_30": 100000,
        "31_60": 50000,
        "61_90": 15000,
        "90_plus": 10000
      }
    },
    "products": {
      "active": 340,
      "low_stock": 8
    },
    "fixed_expenses": 2400000,
    "alerts": {
      "low_stock": [
        { "id": 1, "product_name": "Whey Protein", "location": "Local", "quantity": 3, "min_stock": 10 }
      ],
      "expiring": [
        { "id": 2, "product_name": "Creatina", "location": "Depósito", "expiration_date": "2026-06-15" }
      ]
    }
  }
}
```
