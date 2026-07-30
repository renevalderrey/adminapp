# Technical Plan: Clientes y Cuentas Corrientes (Bloque 3)

## Architecture

```
Backend
├── models/
│   ├── Customer.js          [NUEVO]
│   ├── CustomerPayment.js   [NUEVO]
│   ├── Sale.js              [MODIFICAR] +customer_id, +customer_name
│   └── Supplier.js          [MODIFICAR] +due_date en SupplierMovement
├── services/
│   └── customerService.js   [NUEVO]
└── routes/
    └── customers.js         [NUEVO]

Frontend
├── pages/
│   ├── Customers.jsx        [NUEVO]
│   └── Billing.jsx          [MODIFICAR] +customer selector
├── services/
│   └── api.js               [MODIFICAR]
├── App.jsx                  [MODIFICAR] +ruta
└── components/
    └── app-sidebar.jsx      [MODIFICAR] +nav
```

## Key Decisions

| Decisión | Elección | Justificación |
|:---|:---|:---|
| Customer snapshot en venta | `customer_name` en Sale | Histórico: si el cliente cambia de nombre, la venta conserva el original |
| Aging base | Fecha de venta (no vencimiento) | El 80% de los clientes paga a la vista; usamos fecha de factura como default |
| Cálculo de deuda | Lado servidor (servicio) | Consistencia: evita discrepancias entre frontends |
| Soft delete de clientes | `is_active = false` | Trazabilidad: las ventas históricas mantienen la referencia al cliente |
| Pagos FIFO | Se aplican a deuda más antigua | Simplifica la lógica y es el método más común en PyMEs |
