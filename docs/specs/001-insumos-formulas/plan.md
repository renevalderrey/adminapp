# Implementation Plan: Insumos, Fórmulas y Recetas (Bloque 1)

**Branch**: `001-insumos-formulas` | **Date**: 2026-05-30 | **Spec**: [specs/001-insumos-formulas/spec.md](file:///c:/Users/renev/Documents/sistema-de-facturacion/specs/001-insumos-formulas/spec.md)

---

## Summary
El objetivo es permitir la composición de productos mediante recetas compuestas por otros productos (actuando como insumos/ingredientes). Implementaremos:
1. Extensiones al modelo `Product` y `Stock` para albergar precios mayoristas, lotes y stock mínimo.
2. Nuevas tablas `recipes` y `recipe_items` para modelar la relación.
3. Un servicio en el backend que recalcule en cascada el costo de productos compuestos cuando varíe el costo de algún ingrediente.
4. Vistas en React (Zustand + CSS) para gestionar estas relaciones.

---

## Technical Context

- **Language/Version**: Node.js v18+, React 19 (JavaScript)
- **Primary Dependencies**: Express.js, Sequelize ORM, PG (PostgreSQL client), Axios, Zustand (State Management)
- **Storage**: PostgreSQL database
- **Testing**: Jest/Supertest (opcional, validación mediante endpoints locales)
- **Target Platform**: Web application (Desktop/Mobile responsive)
- **Project Type**: Web Application (Monorepo-like client/server structure)
- **Performance Goals**: Recálculo en cascada síncrono para hasta 100 productos en <500ms
- **Constraints**: Evitar ciclos recursivos en la definición de recetas

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Modular Architecture**: Se respeta la separación de rutas (`backend/src/routes`), modelos (`backend/src/models`) y vistas (`frontend/src/pages`).
- **Zustand & CSS**: Se usará Zustand para el estado del frontend y CSS puro (no Tailwind) para los nuevos componentes.
- **Inmutabilidad**: No se implementarán borrados físicos de productos ni recetas que afecten registros históricos.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-insumos-formulas/
├── plan.md              # Este archivo
├── data-model.md        # Diseño de base de datos detallado
├── contracts/
│   └── api-endpoints.md  # Definición de endpoints nuevos/modificados
```

### Source Code Modifications

```text
backend/
├── src/
│   ├── models/
│   │   ├── Product.js        # Modificado: Agregar campos de precio/margen mayorista
│   │   ├── Stock.js          # Modificado: Agregar min_stock, lotes y vencimientos
│   │   ├── Recipe.js         # NUEVO: Tabla recipes
│   │   ├── RecipeItem.js     # NUEVO: Tabla recipe_items
│   │   ├── ProductCostHistory.js # NUEVO: Tabla product_cost_history
│   │   └── index.js          # Modificado: Asociaciones Sequelize
│   └── routes/
│       ├── products.js       # Modificado: CRUD de recetas y recálculo
│       └── general.js        # Modificado: Alertas de stock mínimo e historial
frontend/
└── src/
    ├── pages/
    │   ├── Inventory.jsx     # Modificado: Soporte para editar costos/lotes
    │   ├── Recipes.jsx       # NUEVO: Vista de gestión de fórmulas
    │   └── Dashboard.jsx     # Modificado: Añadir widget de stock mínimo y alertas
    └── store/
        └── inventoryStore.js # NUEVO/Modificado: Estado de Zustand para recetas
```

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Recálculo en cascada recursivo | Necesario para actualizar costos cuando un ingrediente cambia de precio. | Consultar y calcular en tiempo real cada vez que se lista el producto degrada el rendimiento de consultas a gran escala. Guardar el costo cacheado es más eficiente. |
