# Tasks: Insumos, Fórmulas y Recetas (Bloque 1)

**Input**: Documentos de diseño en [specs/001-insumos-formulas/](file:///c:/Users/renev/Documents/sistema-de-facturacion/specs/001-insumos-formulas/)
- [spec.md](file:///c:/Users/renev/Documents/sistema-de-facturacion/specs/001-insumos-formulas/spec.md)
- [plan.md](file:///c:/Users/renev/Documents/sistema-de-facturacion/specs/001-insumos-formulas/plan.md)
- [data-model.md](file:///c:/Users/renev/Documents/sistema-de-facturacion/specs/001-insumos-formulas/data-model.md)
- [api-endpoints.md](file:///c:/Users/renev/Documents/sistema-de-facturacion/specs/001-insumos-formulas/contracts/api-endpoints.md)

---

## Phase 1: Foundational (Base de Datos y Modelos Sequelize)
**Purpose**: Crear la estructura de datos en base de datos PostgreSQL e inicializar los modelos Sequelize.

- [ ] **T101** Crear archivo de migración de base de datos para extender `products` (wholesale_margin, wholesale_price) y `stock` (min_stock, current_batch, expiration_date, purchase_date).
- [ ] **T102** Crear archivo de migración para las nuevas tablas `recipes`, `recipe_items` y `product_cost_history`.
- [ ] **T103** [P] Modificar el modelo [Product.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/models/Product.js) agregando `wholesale_margin` y `wholesale_price`.
- [ ] **T104** [P] Modificar el modelo [Stock.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/models/Stock.js) agregando `min_stock`, `current_batch`, `expiration_date` y `purchase_date`.
- [ ] **T105** [P] Crear el modelo `Recipe.js` en `backend/src/models/Recipe.js`.
- [ ] **T106** [P] Crear el modelo `RecipeItem.js` en `backend/src/models/RecipeItem.js`.
- [ ] **T107** [P] Crear el modelo `ProductCostHistory.js` en `backend/src/models/ProductCostHistory.js`.
- [ ] **T108** Modificar [index.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/models/index.js) de modelos para establecer las asociaciones Sequelize y exportar los nuevos modelos.

**Checkpoint**: Base de datos y ORM configurados.

---

## Phase 2: Foundational (Motor de Cálculo de Costos y Recálculo en Cascada)
**Purpose**: Desarrollar la lógica de negocio para el cálculo de costos y la actualización en cascada sin ciclos infinitos.

- [ ] **T109** Crear servicio de costos `backend/src/services/costService.js` con método `calculateProductCost(productId)` que implemente la fórmula del PRD:
  $$\frac{\sum (Ingredientes)}{Rendimiento \times (1 - Merma)}$$
- [ ] **T110** Implementar en `costService.js` la detección de ciclos de dependencia (prevención de bucles recursivos infinitos al asociar recetas).
- [ ] **T111** Implementar en `costService.js` el método `recalculateCascadingCosts(productId)` que busque todos los productos cuyas recetas contengan este producto como ingrediente, actualice su costo y llame recursivamente a su recálculo. Cada cambio debe registrarse en `ProductCostHistory`.

**Checkpoint**: Lógica de cálculo y cascada completamente testeada en backend.

---

## Phase 3: User Story 1 - Gestión Unificada de Productos e Historial de Costos (P1)
**Purpose**: Habilitar el registro de compras, lotes, stock mínimo y visualización de historial de costos.

- [ ] **T112** Modificar rutas de productos [products.js (Rutas)](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/routes/products.js) para registrar historial de costo (`ProductCostHistory`) al modificar manualmente el costo de un producto base (`PUT /api/products/:id`).
- [ ] **T113** Crear ruta `GET /api/products/:id/cost-history` en `backend/src/routes/products.js` para retornar el historial de costos.
- [ ] **T114** [P] Modificar vista [Inventory.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Inventory.jsx) en el frontend para permitir cargar stock mínimo, lote, fecha de vencimiento y fecha de compra en la tabla de stock por sucursal.
- [ ] **T115** Agregar en la vista de edición de productos del frontend una solapa o sección de "Historial de Variación de Costos" que consuma la nueva ruta.

**Checkpoint**: Flujo de producto base con historial y control de lote/vencimiento funcional.

---

## Phase 4: User Story 2 & 3 - Recetas y Recálculo Automático (P2 y P3)
**Purpose**: Habilitar el armado de recetas en interfaz y el recálculo automático en cascada.

- [ ] **T116** Crear rutas en backend `GET /api/products/:id/recipe` y `POST /api/products/:id/recipe` para obtener y guardar recetas (asociadas a `costService.js` para gatillar el cálculo de costo inmediato y cascada).
- [ ] **T117** Crear una tienda de Zustand en `frontend/src/store/recipeStore.js` para administrar el estado de recetas de productos en la interfaz.
- [ ] **T118** Crear la página `frontend/src/pages/Recipes.jsx` para la creación y edición visual de recetas (buscador de productos ingredientes, inputs de cantidad, merma, rendimiento y visualización de costo estimado).
- [ ] **T119** Registrar la nueva ruta `/recetas` en [App.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/App.jsx) y añadir el link de acceso en el Sidebar.

**Checkpoint**: Ciclo completo de recetas y cálculo en cascada operativo entre cliente y servidor.

---

## Phase 5: Polish & Alertas de Inventario
**Purpose**: Añadir pulido visual de alertas de stock mínimo y control de vencimientos próximos.

- [ ] **T120** Crear endpoint `GET /api/general/alerts` que devuelva productos con stock actual < stock mínimo y lotes a vencer en los próximos 30 días.
- [ ] **T121** Implementar un widget visualmente premium en el panel principal [Dashboard.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Dashboard.jsx) que muestre estas alertas.
- [ ] **T122** Realizar optimización de estilos CSS en las nuevas vistas siguiendo la estética de diseño premium (tema oscuro, bordes suavizados, micro-animaciones).
- [ ] **T123** Generar el documento final de entrega `walkthrough.md` con las pruebas de flujo y capturas.
