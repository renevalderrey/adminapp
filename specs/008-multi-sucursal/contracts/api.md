# API Contracts: Multi-Sucursal / Transferencias (Bloque 8)

## POST /api/stock/transfer

Transferir stock entre sucursales.

### Request Body
```json
{
  "from_location": "general",
  "to_location": "ortiz",
  "items": [
    { "product_id": 10, "quantity": 5 }
  ]
}
```

### Response 200
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "from_location": "general",
    "to_location": "ortiz",
    "items": [
      { "product_id": 10, "product_name": "Whey Protein 2kg", "quantity": 5 }
    ],
    "createdAt": "2026-05-30T10:00:00.000Z"
  }
}
```

## GET /api/stock/transfers

Historial de transferencias.

### Query Parameters
| Parámetro | Tipo | Descripción |
|:---|:---|:---|
| `limit` | int | (default: 50) |
| `offset` | int | (default: 0) |

### Response 200
```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "from_location": "general",
      "to_location": "ortiz",
      "items": [{ "product_id": 10, "product_name": "Whey Protein 2kg", "quantity": 5 }],
      "createdAt": "2026-05-30T10:00:00.000Z"
    }
  ],
  "total": 1
}
```
