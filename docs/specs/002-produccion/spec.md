# Feature Specification: Producción (Bloque 2)

**Feature Branch**: `002-produccion`

**Created**: 2026-05-30

**Status**: Draft

**Input**: Requerimientos del PRD referidos al módulo de Producción: Fecha de producción, Producto fabricado, Cantidad producida, Lote asignado al lote producido, Cálculo del Costo total del lote y Costo unitario real. El módulo debe integrarse con el sistema de Recetas/Fórmulas (Bloque 1) y actualizar el stock de insumos y productos terminados.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar una Orden de Producción (Priority: P1)

Como Administrador, quiero registrar una orden de producción indicando qué producto voy a fabricar, cuántas unidades y cuándo, para que el sistema calcule automáticamente el costo total del lote y unitario basándose en la receta activa, y actualice el stock de insumos descontando lo consumido y acreditando el stock de producto terminado.

**Why this priority**: Es el flujo central del módulo. Sin él, no hay trazabilidad de producción. Depende directamente del Bloque 1 (Recetas y Costos).

**Independent Test**:
- Con el producto "Proteína Whey 1kg" que tiene receta con ingredientes cargados en stock, registrar una orden de producción de 10 unidades.
- Verificar que: el costo unitario y total se calculan, el stock de insumos se descuenta y el stock del producto terminado se acredita.

**Acceptance Scenarios**:

1. **Given** el producto "Proteína Whey 1kg" con receta activa (ingredientes: 950g Suero + 50g Saborizante, merma 5%, rendimiento 1 unidad), con stock suficiente de insumos, **When** el administrador registra una orden de producción de 10 unidades con lote "P-2026-001", **Then** el sistema calcula `Costo Total Lote = (Costo_Ingredientes × 10) / (1 - 0.05)` y `Costo Unitario = Costo Total / 10`, descuenta los insumos del stock y acredita 10 unidades al stock del producto terminado.

2. **Given** una orden de producción registrada, **When** el administrador consulta el historial de producción, **Then** ve la orden con fecha, producto, cantidad, lote, costo unitario real y estado.

3. **Given** stock insuficiente de algún ingrediente, **When** se intenta registrar una orden de producción, **Then** el sistema muestra una advertencia indicando qué insumos están por debajo de la cantidad requerida y permite confirmar igual o cancelar.

---

### User Story 2 - Asignación y Trazabilidad de Lotes (Priority: P2)

Como Administrador, quiero que cada orden de producción genere o se asocie a un número de lote, para poder rastrear qué insumos (y de qué proveedor/fecha) se usaron en cada lote de producto terminado.

**Why this priority**: La trazabilidad de lotes es esencial para el control de calidad, gestión de vencimientos y reclamos.

**Independent Test**:
- Registrar una orden de producción asignando el lote "P-2026-001".
- Verificar que el producto terminado en stock queda marcado con ese lote y la fecha de producción.

**Acceptance Scenarios**:

1. **Given** una orden de producción completada, **When** el administrador consulta el stock del producto terminado, **Then** el registro de stock muestra el `current_batch = "P-2026-001"` y la `purchase_date` = fecha de producción.

2. **Given** múltiples órdenes de producción para el mismo producto con lotes distintos, **When** el administrador consulta el inventario, **Then** puede distinguir cada lote con su fecha, costo y cantidad disponible.

---

### User Story 3 - Anulación de Orden de Producción (Priority: P3)

Como Administrador, quiero poder anular una orden de producción que fue registrada por error, para que el sistema revierta los movimientos de stock (devuelva insumos y descuente el producto terminado) manteniendo la trazabilidad de la anulación.

**Why this priority**: Garantiza la integridad del inventario ante errores operativos sin eliminar registros históricos.

**Independent Test**:
- Registrar una orden de producción, luego anularla.
- Verificar que el stock de insumos vuelve al valor previo y el stock de producto terminado se descuenta.

**Acceptance Scenarios**:

1. **Given** una orden de producción en estado "completada", **When** el administrador la anula, **Then** el sistema registra la anulación (estado = "anulada"), revierte los movimientos de stock y no elimina el registro histórico.

2. **Given** una orden ya anulada, **When** se intenta anularla nuevamente, **Then** el sistema devuelve un error indicando que ya está anulada.

---

### Edge Cases

- **Stock insuficiente de insumos**: El sistema advierte pero permite confirmar. No bloquea la producción, dado que puede haber stock no registrado. El déficit queda marcado en el registro.
- **Producto sin receta**: No se puede registrar una orden de producción para un producto que no tiene receta activa. El sistema muestra un error claro.
- **Receta modificada después de producción**: Los cambios en la receta no afectan retroactivamente las órdenes de producción ya registradas. Cada orden guarda una "foto" del costo calculado al momento.
- **Cantidad producida ≠ rendimiento de receta**: Si el rendimiento esperado es 10 unidades pero se ingresa 12, el sistema acepta el valor real ingresado y recalcula el costo unitario real en base a lo efectivamente producido.
- **Anulación con stock ya vendido**: Si el producto terminado ya fue parcialmente vendido, la anulación solo revierte la parte disponible en stock. El sistema alerta si el stock disponible es menor al de la orden.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir registrar órdenes de producción con: producto fabricado, cantidad producida, fecha, lote asignado y notas opcionales.
- **FR-002**: El sistema DEBE calcular automáticamente el `Costo Total del Lote` y el `Costo Unitario Real` al registrar una orden, usando la receta activa del producto y los costos vigentes de los ingredientes.
- **FR-003**: El sistema DEBE descontar del stock los insumos/ingredientes consumidos según la receta y la cantidad producida al confirmar la orden.
- **FR-004**: El sistema DEBE acreditar en el stock del producto terminado la cantidad producida, con el lote y fecha de producción como `current_batch` y `purchase_date`.
- **FR-005**: El sistema DEBE guardar en la orden de producción el detalle de costos calculados (snapshot al momento de producir) para trazabilidad histórica independiente de cambios futuros en precios.
- **FR-006**: El sistema DEBE mostrar una advertencia (no bloqueante) si algún insumo tiene stock inferior a la cantidad requerida para la orden.
- **FR-007**: El sistema DEBE rechazar el registro de una orden de producción si el producto no tiene receta activa.
- **FR-008**: El sistema DEBE permitir la anulación de una orden de producción con reversión de movimientos de stock, sin eliminación del registro histórico (soft void).
- **FR-009**: El sistema DEBE mantener un historial de todas las órdenes de producción (completadas y anuladas) consultable por producto, fecha y lote.
- **FR-010**: El sistema DEBE registrar en `product_cost_history` un nuevo hito cuando el costo unitario real difiere del costo actual del producto, actualizando el costo vigente.

### Key Entities *(include if feature involves data)*

- **ProductionOrder** [NUEVA]:
  - `id` (INTEGER, PK)
  - `product_id` (INTEGER, FK a products) — Producto fabricado
  - `quantity_produced` (DECIMAL) — Unidades efectivamente producidas
  - `batch_code` (STRING) — Lote asignado al resultado (ej. "P-2026-001")
  - `production_date` (DATEONLY) — Fecha de producción
  - `unit_cost_calculated` (DECIMAL) — Costo unitario real calculado al momento
  - `total_cost` (DECIMAL) — Costo total del lote
  - `status` (ENUM: 'completed', 'voided') — Estado de la orden
  - `notes` (TEXT) — Notas opcionales
  - `voided_at` (TIMESTAMP, NULL) — Fecha de anulación
  - `cost_snapshot` (JSONB) — Detalle de ingredientes y costos al momento de producción

- **ProductionOrderItem** [NUEVA]:
  - `id` (INTEGER, PK)
  - `production_order_id` (INTEGER, FK a production_orders)
  - `ingredient_product_id` (INTEGER, FK a products) — Insumo consumido
  - `quantity_used` (DECIMAL) — Cantidad efectivamente descontada del stock
  - `unit_cost_at_time` (DECIMAL) — Costo unitario del insumo al momento de producción

- **Stock** (Existente, sin cambios de esquema):
  - Los campos `current_batch`, `expiration_date` y `purchase_date` ya fueron agregados en el Bloque 1. Se utilizan para registrar el lote del producto terminado producido.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un administrador puede registrar una orden de producción completa en menos de 60 segundos.
- **SC-002**: El cálculo de costo unitario es exacto al centavo respecto a la fórmula: `Costo Total = (Σ Cantidad_i × Costo_i) / (Rendimiento × (1 - Merma))`.
- **SC-003**: Después de registrar una orden, el stock de todos los insumos utilizados refleja los descuentos correctos en menos de 2 segundos.
- **SC-004**: La anulación de una orden revierte el stock al estado previo con cero inconsistencias.
- **SC-005**: El historial de producción permite filtrar por producto o lote y muestra al menos: fecha, cantidad, costo unitario y estado.

---

## Assumptions

- Se asume que las unidades de medida entre receta y stock son consistentes (misma base decimal definida en Bloque 1).
- El stock de producto terminado se acredita en la `location` por defecto ("general") a menos que el usuario especifique otra sucursal.
- La anulación solo está disponible para órdenes con estado "completed". No se puede re-completar una orden anulada.
- El `batch_code` es ingresado manualmente por el usuario (no autogenerado), dado que los lotes pueden seguir nomenclaturas propias del negocio.
- Las órdenes de producción no modifican directamente `product_cost_history` a menos que el costo unitario real calculado difiera del costo actual del producto en la tabla `products`.
- El módulo de Producción depende del Bloque 1 completamente implementado (Recetas, Ingredientes, Costo en Cascada).
