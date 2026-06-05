# API Contracts: Clientes y Cuentas Corrientes (Bloque 3)

## GET /api/customers

Lista clientes con búsqueda.

### Query Parameters
| Parámetro | Tipo | Descripción |
|:---|:---|:---|
| `search` | string | Búsqueda por nombre o CUIT |
| `active` | boolean | Filtrar activos/inactivos (default: true) |
| `limit` | integer | (default: 50) |
| `offset` | integer | (default: 0) |

### Response 200
```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "name": "Juan Pérez",
      "tax_id": "20-12345678-9",
      "email": "juan@mail.com",
      "phone": "341-1234567",
      "address": "Santa Fe 1234",
      "tax_condition": "monotributo",
      "notes": null,
      "is_active": true,
      "total_purchases": 150000,
      "total_visits": 12,
      "last_purchase": "2026-05-28",
      "balance": 25000
    }
  ],
  "total": 1
}
```

## GET /api/customers/:id

Detalle completo con historial y aging.

### Response 200
```json
{
  "ok": true,
  "data": {
    "customer": { "...": "..." },
    "aging": {
      "current": 25000,
      "buckets": {
        "0_30": 10000,
        "31_60": 8000,
        "61_90": 5000,
        "90_plus": 2000
      }
    },
    "recent_sales": [],
    "recent_payments": []
  }
}
```

## POST /api/customers

Crear cliente.

### Request Body
```json
{
  "name": "Juan Pérez",
  "tax_id": "20-12345678-9",
  "email": "juan@mail.com",
  "phone": "341-1234567",
  "address": "Santa Fe 1234",
  "tax_condition": "monotributo",
  "notes": ""
}
```

## GET /api/customers/ranking

Ranking de clientes por volumen.

### Response 200
```json
{
  "ok": true,
  "data": [
    { "id": 1, "name": "Juan Pérez", "total_purchases": 500000, "visit_count": 25, "frequency": 3.2, "last_purchase": "2026-05-30" }
  ]
}
```

## POST /api/customers/:id/payments

Registrar pago de cliente.

### Request
```json
{
  "amount": 5000,
  "payment_date": "2026-05-30",
  "payment_method": "ef",
  "reference": "Recibo 001",
  "notes": ""
}
```

## GET /api/customers/summary

Resumen de cuentas por cobrar.

### Response
```json
{
  "ok": true,
  "data": {
    "total_receivable": 150000,
    "aging": {
      "0_30": 80000,
      "31_60": 40000,
      "61_90": 20000,
      "90_plus": 10000
    },
    "total_payable": 95000,
    "supplier_aging": {
      "0_30": 50000,
      "31_60": 30000,
      "61_90": 10000,
      "90_plus": 5000
    }
  }
}
```
