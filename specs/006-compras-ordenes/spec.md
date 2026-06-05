# Feature Specification: Compras / Órdenes de Compra a Proveedores (Bloque 6)

**Created**: 2026-05-30

**Status**: Draft

**Input**: Necesidad de gestionar órdenes de compra a proveedores con detalle de productos, seguimiento de estado y recepción de mercadería.

---

## User Scenarios & Testing

### User Story 1 — Órdenes de Compra con Productos (Priority: P1)

Como Administrador, quiero crear órdenes de compra especificando qué productos comprar, en qué cantidad y a qué precio, para tener trazabilidad de los pedidos.

**Acceptance Scenarios**:
1. **Given** la pantalla de nuevo pedido, **When** selecciono un proveedor, agrego productos (búsqueda por nombre), cantidad y precio unitario, **Then** la orden se guarda con los items y el total se calcula automáticamente.
2. **Given** una orden creada, **When** consulto su detalle, **Then** veo la lista de productos, cantidades, precios y total.

### User Story 2 — Estados de Órdenes (Priority: P1)

Como Administrador, quiero que las órdenes tengan estado (pendiente, recibido parcial, recibido completo, anulado), para saber en qué etapa está cada pedido.

### User Story 3 — Recepción de Mercadería (Priority: P1)

Como Administrador, quiero recibir una orden (parcial o totalmente) para que los productos se agreguen automáticamente al stock y se actualice el saldo del proveedor.

**Acceptance Scenarios**:
1. **Given** una orden en estado "pendiente", **When** recibo todos los productos, **Then** el stock se actualiza, la orden pasa a "recibido" y se genera la deuda.
2. **Given** una orden, **When** recibo solo parte de los productos, **Then** la orden queda en "recibido parcial" y solo se actualiza el stock de los productos recibidos.

### User Story 4 — Datos de Contacto del Proveedor (Priority: P2)

Como Administrador, quiero registrar teléfono, email, dirección y CUIT del proveedor, para tener sus datos de contacto en el sistema.

### User Story 5 — Lista Global de Órdenes (Priority: P2)

Como Administrador, quiero ver todas las órdenes de compra en una lista única con filtros (proveedor, estado, fecha), para tener visibilidad de todos los pedidos activos.

---

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE permitir crear órdenes de compra con: proveedor, fecha, items (producto, cantidad, precio unitario), notas.
- **FR-002**: El sistema DEBE calcular automáticamente el total de la orden como `Σ(cantidad × precio_unitario)`.
- **FR-003**: El sistema DEBE asignar un estado a cada orden: `pending`, `partial`, `received`, `cancelled`.
- **FR-004**: El sistema DEBE permitir recibir una orden (parcial o total), actualizando el stock de cada producto y la deuda del proveedor.
- **FR-005**: El sistema DEBE permitir anular una orden en estado `pending` o `partial`.
- **FR-006**: El sistema DEBE almacenar datos de contacto del proveedor: teléfono, email, dirección, CUIT.
- **FR-007**: El sistema DEBE mostrar una lista global de órdenes con filtros por proveedor, estado y rango de fechas.

### Key Entities

- **Supplier** (modificar):
  - `phone` (STRING) — [NUEVO]
  - `email` (STRING) — [NUEVO]
  - `address` (TEXT) — [NUEVO]
  - `cuit` (STRING) — [NUEVO]

- **SupplierOrder** (modificar):
  - `status` (ENUM: pending/partial/received/cancelled) — [NUEVO] default 'pending'
  - `items` se almacenan en `detail` (JSONB existente) como `[{ product_id, product_name, quantity, unit_price }]`

---

## Success Criteria

- **SC-001**: Una orden de compra se crea con items en menos de 60 segundos.
- **SC-002**: Al recibir una orden, el stock se actualiza instantáneamente.
- **SC-003**: Las órdenes se pueden filtrar y visualizar en una lista global.
