# Technical Plan: Compras / Órdenes de Compra a Proveedores (Bloque 6)

## Architecture

```
Backend
├── models/
│   ├── Supplier.js              [MODIFICAR] +phone, email, address, cuit
│   └── SupplierOrder.js         [MODIFICAR] +status ENUM
├── services/
│   └── purchaseService.js       [NUEVO] — orden con items, recepción, cancelación
└── routes/
    └── suppliers.js             [MODIFICAR] +endpoints de órdenes + update supplier

Frontend
├── pages/
│   ├── Orders.jsx               [MODIFICAR] +items en pedido + recepción + contacto proveedor
│   └── PurchaseOrders.jsx       [NUEVO] — lista global de órdenes con filtros
├── services/
│   └── api.js                   [MODIFICAR] +order endpoints
├── App.jsx                      [MODIFICAR] +ruta
└── components/
    └── app-sidebar.jsx          [MODIFICAR] +nav
```

## Key Decisions

| Decisión | Elección | Justificación |
|:---|:---|:---|
| Line items en JSONB | `SupplierOrder.detail` existente | Evita crear modelo nuevo; el campo ya está migrado con datos legacy |
| Stock update al recibir | Se actualiza `Stock.quantity` directo | Ya existe el modelo Stock con location; asumimos location del default |
| Deuda se genera al recibir | Se crea `SupplierMovement` al recibir (no al crear) | La deuda real existe cuando llega la mercadería |
| Status enum | `pending → partial → received` o `cancelled` | Flujo simple y cubre todos los casos |
