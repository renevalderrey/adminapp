# API Contracts: Compras / Órdenes de Compra a Proveedores (Bloque 6)

## GET /api/suppliers/orders

Lista global de órdenes de compra.

### Query Parameters
| Parámetro | Tipo | Descripción |
|:---|:---|:---|
| `supplier_id` | int | Filtrar por proveedor |
| `status` | string | pending, partial, received, cancelled |
| `from` | date | Fecha desde |
| `to` | date | Fecha hasta |
| `limit` | int | (default: 50) |
| `offset` | int | (default: 0) |

### Response 200
```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "supplier_id": 1,
      "supplier_name": "Distribuidora XYZ",
      "date": "2026-05-15",
      "total": 150000,
      "status": "pending",
      "notes": "Pedido mensual",
      "items": [
        { "product_id": 10, "product_name": "Whey Protein 2kg", "quantity": 5, "unit_price": 12000 }
      ],
      "createdAt": "2026-05-15T10:00:00.000Z"
    }
  ]
}
```

## POST /api/suppliers/:id/orders

Crear orden de compra con items.

### Request Body
```json
{
  "date": "2026-05-30",
  "notes": "Pedido Junio",
  "items": [
    { "product_id": 10, "product_name": "Whey Protein 2kg", "quantity": 5, "unit_price": 12000 },
    { "product_id": 15, "product_name": "Creatina 300g", "quantity": 10, "unit_price": 8500 }
  ]
}
```

### Response 201
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "supplier_id": 1,
    "date": "2026-05-30",
    "total": 145000,
    "status": "pending",
    "notes": "Pedido Junio",
    "detail": [{ "product_id": 10, "product_name": "Whey Protein 2kg", "quantity": 5, "unit_price": 12000 }, { "product_id": 15, "product_name": "Creatina 300g", "quantity": 10, "unit_price": 8500 }]
  }
}
```

## PUT /api/suppliers/orders/:id/receive

Recibir (parcial o total) una orden.

### Request Body
```json
{
  "items": [
    { "product_id": 10, "quantity_received": 5 },
    { "product_id": 15, "quantity_received": 5 }
  ],
  "location": "general"
}
```

### Response 200
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "status": "partial",
    "message": "Orden recibida parcialmente. Stock actualizado."
  }
}
```

## PUT /api/suppliers/orders/:id/cancel

Cancelar una orden.

### Response 200
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "status": "cancelled"
  }
}
```

## GET /api/suppliers/orders/:id

Detalle de una orden.

### Response 200
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "supplier_id": 1,
    "supplier_name": "Distribuidora XYZ",
    "date": "2026-05-15",
    "total": 150000,
    "status": "pending",
    "notes": "Pedido mensual",
    "items": [ ... ],
    "createdAt": "..."
  }
}
```

## PUT /api/suppliers/:id

Actualizar datos del proveedor.

### Request Body
```json
{
  "name": "Distribuidora XYZ",
  "phone": "341-1234567",
  "email": "ventas@xyz.com",
  "address": "Av. Siempre Viva 123",
  "cuit": "30-12345678-9"
}
```
