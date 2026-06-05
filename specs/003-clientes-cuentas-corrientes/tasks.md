# Tasks: Clientes y Cuentas Corrientes (Bloque 3)

## Fase 1: Backend — Modelos

- [ ] **T301** Crear modelo `Customer` en `backend/src/models/Customer.js`
- [ ] **T302** Crear modelo `CustomerPayment` en `backend/src/models/CustomerPayment.js`
- [ ] **T303** Agregar `customer_id` y `customer_name` al modelo `Sale` (modificar existente)
- [ ] **T304** Agregar `due_date` al modelo `SupplierMovement` (modificar existente)
- [ ] **T305** Registrar relaciones en `backend/src/models/index.js`

## Fase 2: Backend — Servicio

- [ ] **T306** Crear `backend/src/services/customerService.js`
  - Debt calculation with aging
  - Customer ranking
  - Summary (receivables + payables)
  - Payment registration

## Fase 3: Backend — Rutas

- [ ] **T307** Crear `backend/src/routes/customers.js` (CRUD + payments + ranking + summary)
- [ ] **T308** Modificar `backend/src/routes/sales.js` para aceptar customer_id
- [ ] **T309** Registrar ruta en `server.js`

## Fase 4: Frontend

- [ ] **T310** Extender `frontend/src/services/api.js` con customer endpoints
- [ ] **T311** Crear `frontend/src/pages/Customers.jsx` (lista, detalle con aging, pagos)
- [ ] **T312** Modificar `frontend/src/pages/Billing.jsx` para seleccionar cliente
- [ ] **T313** Agregar ruta en `App.jsx` y navegación en sidebar
- [ ] **T314** Verificación de flujo completo
