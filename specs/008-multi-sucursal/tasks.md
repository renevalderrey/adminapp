# Tasks: Multi-Sucursal / Transferencias (Bloque 8)

## Fase 1: Backend

- [ ] **T801** Crear modelo `StockTransfer` en `backend/src/models/StockTransfer.js`
- [ ] **T802** Registrar en `models/index.js`
- [ ] **T803** Crear `backend/src/routes/stock.js` con:
  - `POST /api/stock/transfer` — transferir stock entre sucursales
  - `GET /api/stock/transfers` — historial
- [ ] **T804** Registrar ruta en `server.js`

## Fase 2: Frontend

- [ ] **T805** Extender `api.js` con endpoints de transferencia
- [ ] **T806** Modificar `Inventory.jsx`:
  - Tabs de sucursal (General, Ortiz, Mayo, Todos)
  - Botón "Transferir Stock" que abre diálogo
- [ ] **T807** Crear `StockTransferDialog.jsx` con formulario de transferencia
- [ ] **T808** Modificar `Billing.jsx` con selector de sucursal
- [ ] **T809** Modificar `InvoicesList.jsx` con filtro de sucursal
- [ ] **T810** Verificar build
