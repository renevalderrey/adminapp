# Technical Plan: Multi-Sucursal / Transferencias (Bloque 8)

## Architecture

```
Backend
├── models/
│   └── StockTransfer.js         [NUEVO] — log de transferencias
├── routes/
│   └── stock.js                 [NUEVO] — /api/stock/transfer
├── models/
│   └── index.js                 [MODIFICAR] +StockTransfer

Frontend
├── pages/
│   ├── Inventory.jsx            [MODIFICAR] +tabs sucursal + diálogo transferencia
│   ├── Billing.jsx              [MODIFICAR] +selector de sucursal
│   └── InvoicesList.jsx         [MODIFICAR] +filtro sucursal
├── services/
│   └── api.js                   [MODIFICAR] +transfer endpoint
└── components/
    └── StockTransferDialog.jsx  [NUEVO] diálogo reutilizable
```

## Key Decisions

| Decisión | Elección | Justificación |
|:---|:---|:---|
| Modelo de transferencia | `StockTransfer` con items JSONB | Simple, trazabilidad completa |
| Transferencia atómica | Transacción Sequelize | Consistencia: falla todo o nada |
| Location values | `general`, `ortiz`, `mayo` | Ya existen en el sistema |
