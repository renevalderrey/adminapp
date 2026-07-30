# Feature Specification: Insumos, Fórmulas y Recetas (Bloque 1)

**Feature Branch**: `001-insumos-formulas`

**Created**: 2026-05-30

**Status**: Draft

**Input**: Requerimientos operativos del PRD referidos a Productos (Categoría, Canales de venta, Margen), Insumos (Precio compra, Proveedor, Lote, Fecha compra, Stock, Historial precios) y Recetas / Fórmulas (Insumos, Cantidades, Merma, Rendimiento, Cálculo de costo automático).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gestión Unificada de Productos e Insumos (Priority: P1)

Como Administrador, quiero que los insumos y materias primas se gestionen dentro de la entidad unificada de Productos, permitiendo que cualquier producto actúe como insumo de otro, para soportar flujos de cualquier tipo de comercio (ej. venta directa de insumos o elaboración de productos complejos).

**Why this priority**: Unificar insumos y productos simplifica el modelo de datos, evita duplicidad en la gestión de inventario/sucursales y permite que un insumo (como "Harina" o "Leche") también pueda venderse directamente al público.

**Independent Test**:
- Crear un producto que actúe como insumo (ej. "Suero de Leche 1kg") con costo de compra y stock mínimo.
- Validar que aparezca en el inventario general y que pueda asociarse a un proveedor y registrar su historial de costos.

**Acceptance Scenarios**:

1. **Given** un administrador en la sección de inventario, **When** crea un producto "Suero de Leche" con costo de compra de $1000, proveedor "Distribuidora Gym", stock mínimo de 10 unidades, lote "L-001" y fecha de compra actual, **Then** el producto se guarda en la base de datos con stock inicial y se registra la primera entrada en su historial de variación de costos.
2. **Given** un producto existente con costo de $1000, **When** el administrador actualiza su costo a $1200 en la interfaz o mediante una orden de compra, **Then** el sistema actualiza su costo activo y registra un registro histórico indicando la variación.

---

### User Story 2 - Definición de Recetas con Ingredientes (Priority: P2)

Como Administrador, quiero configurar la receta de un producto terminado seleccionando otros productos de mi inventario como ingredientes (insumos), especificando cantidades, porcentaje de merma y rendimiento, para modelar procesos de fabricación en cualquier rubro.

**Why this priority**: Permite vincular productos jerárquicamente. Un producto complejo se compone de productos más simples.

**Independent Test**:
- Crear un producto "Proteína Proteica" y definir una receta cuyos ingredientes sean otros productos existentes ("Suero base" y "Saborizante base").
- Verificar que la receta y sus ítems se guarden y relacionen correctamente.

**Acceptance Scenarios**:

1. **Given** los productos "Proteína Whey 1kg" (producto terminado), "Suero de Leche" (ingrediente) y "Saborizante" (ingrediente), **When** el administrador crea una receta para "Proteína Whey 1kg" asignando 950g de "Suero de Leche" y 50g de "Saborizante", con 5% de merma, **Then** la receta queda asociada al producto principal y se registran los ingredientes.

---

### User Story 3 - Cálculo de Costo Automático en Cascada (Priority: P3)

Como Administrador, quiero que el sistema calcule automáticamente el costo de un producto complejo sumando el costo de sus ingredientes según la receta, y que ante cualquier cambio de costo en un ingrediente base, todos los productos que lo utilicen actualicen su costo en cascada.

**Why this priority**: Automatiza el control de costos reales en contextos inflacionarios o de variación constante de precios de proveedores.

**Independent Test**:
- Cambiar el costo de un producto base (ingrediente) y verificar inmediatamente que el costo de todos los productos fabricados con él cambie de acuerdo a la fórmula.

**Acceptance Scenarios**:

1. **Given** el producto "Pan" con receta de 1kg de "Harina" (costo base $100) y rendimiento 1 unidad, **When** el costo de la "Harina" cambia a $150, **Then** el costo de "Pan" se actualiza automáticamente a $150.
2. **Given** un producto con una receta que incluye un 10% de merma (Costo ingredientes = $900), **When** se calcula el costo por unidad, **Then** el costo unitario real resultante debe ser de $1000 (fórmula: `Costo Total Ingredientes / (1 - % Merma)`).

---

### Edge Cases

- **Referencias Circulares**: ¿Qué ocurre si el Producto A se incluye en la receta del Producto B, y el Producto B en la del Producto A? *El sistema debe validar en la creación/edición de recetas que no se generen bucles infinitos de dependencia.*
- **Productos sin Receta**: Conservan su costo manual ingresado por el usuario (compras directas a proveedores).
- **Inactivación de Ingredientes**: Si un producto que actúa como ingrediente se marca como inactivo (`is_active = false`), se debe advertir al usuario que forma parte de una receta activa y alertar visualmente.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE unificar insumos y productos terminados en la misma tabla `products`. Cualquier producto registrado puede actuar como insumo/ingrediente de otro.
- **FR-002**: El sistema DEBE permitir registrar para cada producto: proveedor, lote actual y fecha de compra del lote en la tabla de stock o producto.
- **FR-003**: El sistema DEBE mantener un historial de costos (`product_cost_history`) para realizar seguimiento a las variaciones de costos de compra y producción.
- **FR-004**: El sistema DEBE permitir asignar una única Receta (`recipes`) por producto.
- **FR-005**: El sistema DEBE permitir asociar múltiples productos como ingredientes de una receta mediante la tabla intermedia `recipe_items` indicando la cantidad.
- **FR-006**: El sistema DEBE calcular el costo del producto terminado mediante la fórmula:
  $$Costo\_Calculado = \frac{\sum (Cantidad\_Ingrediente \times Costo\_Ingrediente\_Base)}{Rendimiento \times (1 - Porcentaje\_Merma)}$$
- **FR-007**: El sistema DEBE recalcular síncronamente el costo de los productos terminados en cascada al cambiar el costo de un ingrediente base, validando y previniendo bucles circulares.
- **FR-008**: El sistema DEBE permitir establecer alertas de stock mínimo a nivel de producto/sucursal en la tabla `stock`.
- **FR-009**: El sistema DEBE soportar precios y márgenes diferenciados por canal de venta en `products` (Precio Local y Precio Mayorista) en preparación para el POS.

### Key Entities *(include if feature involves data)*

- **Product** (Existente, a extender):
  - `id` (INTEGER, PK)
  - `name` (STRING)
  - `sku` (STRING)
  - `cost` (DECIMAL) - Costo manual para materias primas, o automático para fabricados
  - `brand_id` (INTEGER, FK a brands)
  - `margin_override` (DECIMAL) - Margen local
  - `price_override` (DECIMAL) - Precio local manual
  - `wholesale_margin` (DECIMAL) - [NUEVO] Margen mayorista
  - `wholesale_price` (DECIMAL) - [NUEVO] Precio mayorista manual
  - `category` (STRING)
  - `is_active` (BOOLEAN)
- **ProductCostHistory** [NUEVO]:
  - `id` (INTEGER, PK)
  - `product_id` (INTEGER, FK a products)
  - `date` (DATE)
  - `old_cost` (DECIMAL)
  - `new_cost` (DECIMAL)
- **Recipe** [NUEVO]:
  - `id` (INTEGER, PK)
  - `product_id` (INTEGER, FK a products, Único) - Producto elaborado
  - `loss_percentage` (DECIMAL) - Merma (0.00 a 1.00)
  - `yield` (DECIMAL) - Rendimiento de la receta en unidades
- **RecipeItem** [NUEVO]:
  - `id` (INTEGER, PK)
  - `recipe_id` (INTEGER, FK a recipes)
  - `ingredient_product_id` (INTEGER, FK a products) - El producto ingrediente
  - `quantity` (DECIMAL) - Cantidad requerida
- **Stock** (Existente, a extender):
  - `id` (INTEGER, PK)
  - `product_id` (INTEGER, FK a products)
  - `location` (STRING) - Sucursal
  - `quantity` (INTEGER) - Stock actual
  - `available` (INTEGER) - Disponible
  - `min_stock` (INTEGER) - [NUEVO] Alerta de stock mínimo
  - `current_batch` (STRING) - [NUEVO] Lote actual
  - `expiration_date` (DATEONLY) - [NUEVO] Fecha de vencimiento del lote
  - `purchase_date` (DATEONLY) - [NUEVO] Fecha de compra del lote

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un administrador puede configurar una receta utilizando otros productos en menos de 2 minutos desde la interfaz.
- **SC-002**: El cálculo de cascada para 100 productos dependientes de un insumo base se realiza en menos de 500ms.
- **SC-003**: Cero inconsistencias matemáticas en el cálculo de costos con mermas y rendimientos.

---

## Assumptions

- Se asume que las unidades de medida base se cargan de forma homogénea (ej. si el insumo se compra por kg, la cantidad de la receta se expresa como fracción decimal de kg; ej. 0.05 para 50 gramos).
- Se asume que la base de datos se mantiene relacional y utiliza Sequelize para asegurar la integridad referencial al eliminar o desactivar productos.
