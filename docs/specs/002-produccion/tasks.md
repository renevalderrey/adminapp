# Tasks: Producción (Bloque 2)

Checklist de implementación detallado para el módulo de Producción.

---

## Fase 1: Backend — Modelos

- [ ] **T201** Crear modelo `ProductionOrder` en `backend/src/models/ProductionOrder.js`
  - Campos: `id`, `product_id`, `quantity_produced`, `batch_code`, `production_date`, `unit_cost_calculated`, `total_cost`, `status (ENUM)`, `notes`, `voided_at`, `cost_snapshot (JSONB)`
  - Sin `references` explícitos (FK gestionadas por asociaciones)
  - `tableName: 'production_orders'`

- [ ] **T202** Crear modelo `ProductionOrderItem` en `backend/src/models/ProductionOrderItem.js`
  - Campos: `id`, `production_order_id`, `ingredient_product_id`, `quantity_used`, `unit_cost_at_time`
  - Sin `references` explícitos
  - `tableName: 'production_order_items'`

- [ ] **T203** Registrar modelos y relaciones en `backend/src/models/index.js`
  - `ProductionOrder.hasMany(ProductionOrderItem, { foreignKey: 'production_order_id', as: 'items', onDelete: 'CASCADE' })`
  - `ProductionOrderItem.belongsTo(ProductionOrder, { foreignKey: 'production_order_id' })`
  - `Product.hasMany(ProductionOrder, { foreignKey: 'product_id', as: 'productionOrders' })`
  - `ProductionOrder.belongsTo(Product, { foreignKey: 'product_id', as: 'product' })`
  - `Product.hasMany(ProductionOrderItem, { foreignKey: 'ingredient_product_id', as: 'usedInProduction' })`
  - `ProductionOrderItem.belongsTo(Product, { foreignKey: 'ingredient_product_id', as: 'ingredient' })`
  - Exportar `ProductionOrder`, `ProductionOrderItem` en el módulo

- [ ] **T204** Verificar que el servidor reinicia sin errores (`npm run dev`) y las tablas se crean en PostgreSQL

---

## Fase 2: Backend — Servicio de Producción

- [ ] **T205** Crear `backend/src/services/productionService.js`

- [ ] **T206** Implementar `calculateOrderCosts(productId, quantityProduced)`:
  - Buscar `Recipe` con `RecipeItems` e incluir `Product` (costo) por cada ítem
  - Calcular `Costo Total = (Σ qty_item × cost_ingredient × quantityProduced) / (yield × (1 - loss_pct))`
  - Calcular `Costo Unitario = Costo Total / quantityProduced`
  - Retornar `{ totalCost, unitCost, items[], costSnapshot, warnings[] }`

- [ ] **T207** Implementar `validateStockForProduction(recipeItems, quantityProduced, location)`:
  - Por cada ingrediente, verificar stock disponible en `location`
  - Retornar array de `warnings` (no bloquear)

- [ ] **T208** Implementar `createProductionOrder(data)` con transacción:
  1. Verificar receta activa → error si no existe
  2. Llamar a `calculateOrderCosts`
  3. Llamar a `validateStockForProduction`
  4. En transacción:
     - Crear `ProductionOrder` (status='completed')
     - Crear `ProductionOrderItem[]`
     - Por cada ingrediente: `Stock.decrement('quantity', ...)` en `location`
     - Producto terminado: `Stock.increment('quantity', ...)`, actualizar `current_batch` y `purchase_date`
     - Si `unitCost !== product.cost`: actualizar `product.cost` y crear `ProductCostHistory`
  5. Retornar orden con warnings

- [ ] **T209** Implementar `voidProductionOrder(id)` con transacción:
  1. Buscar orden por ID → 404 si no existe
  2. Verificar `status === 'completed'` → error si ya anulada
  3. En transacción:
     - Por cada `ProductionOrderItem`: `Stock.increment('quantity', ...)` del ingrediente
     - Producto terminado: `Stock.decrement('quantity', ...)` (hasta 0)
     - Actualizar `production_order.status = 'voided'`, `voided_at = NOW()`
  4. Retornar orden actualizada

---

## Fase 3: Backend — Rutas

- [ ] **T210** Crear `backend/src/routes/production.js`
  - `GET /` — listar órdenes con filtros (product_id, status, batch_code, date_from, date_to, limit, offset)
  - `GET /:id` — detalle con items incluidos
  - `POST /` — crear orden (llamar `productionService.createProductionOrder`)
  - `POST /:id/void` — anular orden (llamar `productionService.voidProductionOrder`)

- [ ] **T211** Registrar ruta en `backend/src/server.js`:
  - `app.use('/api/production', ...authMiddleware, require('./routes/production'))`

- [ ] **T212** Verificar endpoints con cliente HTTP (Postman / curl):
  - `POST /api/production` con producto con receta → verificar costo calculado y movimiento de stock
  - `POST /api/production/:id/void` → verificar reversión de stock
  - `GET /api/production` con filtros → verificar paginación y resultados

---

## Fase 4: Frontend — API Service

- [ ] **T213** Extender `frontend/src/services/api.js` con:
  ```js
  export const getProductionOrders = (params) => axios.get('/api/production', { params })
  export const getProductionOrder = (id) => axios.get(`/api/production/${id}`)
  export const createProductionOrder = (data) => axios.post('/api/production', data)
  export const voidProductionOrder = (id, data) => axios.post(`/api/production/${id}/void`, data)
  ```

---

## Fase 5: Frontend — Página de Producción

- [ ] **T214** Crear `frontend/src/pages/Production.jsx`:
  - **Estado**: `orders`, `loading`, `showModal`, `selectedOrder`, `filters`
  - **Al montar**: `fetchOrders()` con filtros por defecto
  - **Tabla de historial**: columnas Fecha / Producto / Lote / Qty / Costo Unit. / Total / Estado / Acciones
  - **Acciones por fila**: Ver detalle (modal) / Anular (confirmación)
  - **Filtros**: por producto, fecha desde/hasta, estado, lote
  - **Botón**: "Nueva Orden de Producción" → abre modal de creación

- [ ] **T215** Implementar **Modal de Nueva Orden**:
  - Selector de producto (solo los que tienen receta → filtrar desde store o query)
  - Input cantidad a producir
  - Input código de lote
  - Date picker fecha de producción
  - Selector de sucursal destino
  - Textarea notas
  - **Preview de costos en tiempo real**: al cambiar producto/cantidad, llamar `calculateOrderCosts` en frontend (replicar fórmula) o hacer `GET /api/production/preview` si se implementa
  - Mostrar advertencias de stock (si las hay)
  - Botón "Confirmar Orden"

- [ ] **T216** Implementar **Modal de Detalle de Orden**:
  - Mostrar info completa: cabecera + tabla de insumos consumidos + costo snapshot
  - Botón "Anular Orden" (solo si status='completed')

- [ ] **T217** Implementar **confirmación de anulación**:
  - Dialog de confirmación antes de anular
  - Al confirmar: llamar `voidProductionOrder(id)`, refrescar lista

---

## Fase 6: Frontend — Integración de Navegación

- [ ] **T218** Agregar ruta en `frontend/src/App.jsx`:
  - `<Route path="/produccion" element={<Production />} />`

- [ ] **T219** Agregar enlace en `frontend/src/components/app-sidebar.jsx`:
  - Sección: "Operaciones" o similar
  - Item: icono `Factory` o `Wrench` + texto "Producción"
  - `href="/produccion"`

---

## Fase 7: Pruebas y Walkthrough

- [ ] **T220** Prueba de flujo completo:
  1. Crear producto con receta (desde Bloque 1)
  2. Cargar stock de insumos en inventario
  3. Registrar orden de producción → verificar costos y stock
  4. Anular la orden → verificar reversión de stock
  5. Verificar historial con filtros

- [ ] **T221** Documentar en `specs/002-produccion/walkthrough.md`:
  - Flujos probados
  - Screenshots o descripción de UI
  - Resultados de verificación de cálculos
  - Estado final

---

## Resumen de Archivos a Crear/Modificar

| Acción | Archivo |
| :--- | :--- |
| [CREAR] | `backend/src/models/ProductionOrder.js` |
| [CREAR] | `backend/src/models/ProductionOrderItem.js` |
| [MODIFICAR] | `backend/src/models/index.js` |
| [CREAR] | `backend/src/services/productionService.js` |
| [CREAR] | `backend/src/routes/production.js` |
| [MODIFICAR] | `backend/src/server.js` |
| [MODIFICAR] | `frontend/src/services/api.js` |
| [CREAR] | `frontend/src/pages/Production.jsx` |
| [MODIFICAR] | `frontend/src/App.jsx` |
| [MODIFICAR] | `frontend/src/components/app-sidebar.jsx` |
