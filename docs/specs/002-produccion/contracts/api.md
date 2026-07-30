# API Contracts: Producción (Bloque 2)

Base URL: `/api/production`

---

## GET /api/production

Lista las órdenes de producción con soporte de filtros.

### Query Parameters

| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `product_id` | integer | Filtrar por producto fabricado |
| `status` | string | `completed` \| `voided` \| (vacío = todos) |
| `batch_code` | string | Filtrar por código de lote (búsqueda parcial) |
| `date_from` | date (YYYY-MM-DD) | Fecha de producción desde |
| `date_to` | date (YYYY-MM-DD) | Fecha de producción hasta |
| `limit` | integer | Cantidad máxima de resultados (default: 50) |
| `offset` | integer | Paginación (default: 0) |

### Response 200 OK

```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "product_id": 5,
      "product_name": "Proteína Whey 1kg",
      "quantity_produced": 10,
      "batch_code": "P-2026-001",
      "production_date": "2026-05-30",
      "unit_cost_calculated": "10000.00",
      "total_cost": "100000.00",
      "status": "completed",
      "notes": null,
      "voided_at": null,
      "created_at": "2026-05-30T22:00:00.000Z"
    }
  ],
  "total": 1
}
```

---

## GET /api/production/:id

Retorna el detalle completo de una orden incluyendo los insumos consumidos.

### Response 200 OK

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "product_id": 5,
    "product_name": "Proteína Whey 1kg",
    "quantity_produced": 10,
    "batch_code": "P-2026-001",
    "production_date": "2026-05-30",
    "unit_cost_calculated": "10000.00",
    "total_cost": "100000.00",
    "status": "completed",
    "notes": null,
    "voided_at": null,
    "cost_snapshot": {
      "recipe_yield": 1,
      "loss_percentage": 0.05,
      "ingredients": [
        { "product_id": 3, "name": "Suero de Leche", "quantity": 9.5, "unit_cost": 900, "subtotal": 8550 },
        { "product_id": 4, "name": "Saborizante", "quantity": 0.5, "unit_cost": 1900, "subtotal": 950 }
      ]
    },
    "items": [
      {
        "id": 1,
        "ingredient_product_id": 3,
        "ingredient_name": "Suero de Leche",
        "quantity_used": 95,
        "unit_cost_at_time": "900.00"
      },
      {
        "id": 2,
        "ingredient_product_id": 4,
        "ingredient_name": "Saborizante",
        "quantity_used": 5,
        "unit_cost_at_time": "1900.00"
      }
    ]
  }
}
```

### Response 404

```json
{ "ok": false, "error": "Orden de producción no encontrada" }
```

---

## POST /api/production

Crea una nueva orden de producción, calcula costos y mueve stock.

### Request Body

```json
{
  "product_id": 5,
  "quantity_produced": 10,
  "batch_code": "P-2026-001",
  "production_date": "2026-05-30",
  "location": "general",
  "notes": "Primer lote del mes"
}
```

| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `product_id` | integer | ✅ | ID del producto a fabricar |
| `quantity_produced` | number | ✅ | Cantidad de unidades a producir |
| `batch_code` | string | ✅ | Código de lote del resultado |
| `production_date` | string (date) | ✅ | Fecha de producción |
| `location` | string | ❌ | Sucursal destino (default: "general") |
| `notes` | string | ❌ | Observaciones libres |

### Response 201 Created

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "product_id": 5,
    "quantity_produced": 10,
    "batch_code": "P-2026-001",
    "production_date": "2026-05-30",
    "unit_cost_calculated": "10000.0000",
    "total_cost": "100000.00",
    "status": "completed",
    "cost_snapshot": { "..." : "..." },
    "items": [ "..." ]
  },
  "warnings": [
    "Stock insuficiente de 'Suero de Leche': disponible 8, requerido 9.5"
  ]
}
```

> **Nota**: `warnings` es un array vacío si no hay advertencias. La orden se crea igual.

### Response 400 Bad Request

```json
{ "ok": false, "error": "El producto no tiene una receta activa configurada" }
```

```json
{ "ok": false, "error": "quantity_produced debe ser mayor a 0" }
```

---

## POST /api/production/:id/void

Anula una orden de producción y revierte los movimientos de stock.

### Request Body (opcional)

```json
{
  "reason": "Error de ingreso de datos"
}
```

### Response 200 OK

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "status": "voided",
    "voided_at": "2026-05-30T22:30:00.000Z"
  },
  "message": "Orden anulada. Stock revertido correctamente."
}
```

### Response 400 Bad Request

```json
{ "ok": false, "error": "La orden ya se encuentra anulada" }
```

### Response 404

```json
{ "ok": false, "error": "Orden de producción no encontrada" }
```
