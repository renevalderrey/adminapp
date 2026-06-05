# Tasks: Compras / Órdenes de Compra a Proveedores (Bloque 6)

## Fase 1: Backend — Modelos

- [ ] **T601** Agregar campos `phone`, `email`, `address`, `cuit` al modelo Supplier
- [ ] **T602** Agregar campo `status` (ENUM: pending/partial/received/cancelled) al modelo SupplierOrder

## Fase 2: Backend — Servicio

- [ ] **T603** Crear `backend/src/services/purchaseService.js`:
  - `createOrder(supplierId, data)` — crea orden con items en detail JSONB, calcula total
  - `receiveOrder(orderId, itemsReceived)` — actualiza stock, actualiza status, crea SupplierMovement
  - `cancelOrder(orderId)` — cambia status a cancelled
  - `getOrders(filters)` — lista con filtros por supplier, status, fechas
  - `getOrderDetail(orderId)` — orden con items parseados

## Fase 3: Backend — Rutas

- [ ] **T604** Agregar endpoints en `suppliers.js`:
  - `GET /api/suppliers/orders` — lista global de órdenes
  - `GET /api/suppliers/orders/:id` — detalle de orden
  - `PUT /api/suppliers/orders/:id/receive` — recepción (body: items[])
  - `PUT /api/suppliers/orders/:id/cancel` — cancelación
  - `PUT /api/suppliers/:id` — actualizar datos del proveedor
- [ ] **T605** Modificar `POST /:id/orders` para aceptar items[] y calcular total

## Fase 4: Frontend

- [ ] **T606** Extender `api.js` con nuevos endpoints de órdenes y update supplier
- [ ] **T607** Crear `frontend/src/pages/PurchaseOrders.jsx` — lista global con filtros
- [ ] **T608** Modificar `Orders.jsx`:
  - Diálogo de pedido con items (buscador de productos, cantidad, precio)
  - Botón "Recibir" con diálogo de recepción
  - Campos de contacto en detalle del proveedor
- [ ] **T609** Agregar ruta en App.jsx y nav en sidebar
- [ ] **T610** Verificar build
