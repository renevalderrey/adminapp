# Data Model: Compras / Órdenes de Compra a Proveedores (Bloque 6)

## ER Diagram

```mermaid
erDiagram
    suppliers ||--o{ supplier_orders : "tiene"
    suppliers ||--o{ supplier_movements : "registra"
    supplier_orders ||--o{ products : "detalle en JSONB"

    suppliers {
        int id PK
        string name
        string phone "NUEVO"
        string email "NUEVO"
        text address "NUEVO"
        string cuit "NUEVO"
    }

    supplier_orders {
        int id PK
        int supplier_id FK
        date date
        decimal total "Calculado de items"
        text notes
        jsonb detail "[{ product_id, product_name, quantity, unit_price }]"
        string status "ENUM: pending | partial | received | cancelled"
    }
```

## Status Flow

```
                    ┌──────────┐
                    │ Pending   │
                    └────┬─────┘
                    │
            ┌───────┴────────┐
            ▼                ▼
      ┌──────────┐    ┌──────────┐
      │ Partial   │    │ Cancelled│
      └─────┬────┘    └──────────┘
            │
            ▼
      ┌──────────┐
      │ Received  │
      └──────────┘
```

## Formulas

### Order Total
```
total = Σ(item.quantity × item.unit_price)
```

### Stock Update on Receive
```
For each received item:
  Stock.quantity += item.quantity_received
  Stock.available += item.quantity_received
```
