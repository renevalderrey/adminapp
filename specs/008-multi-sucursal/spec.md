# Feature Specification: Multi-Sucursal / Transferencias (Bloque 8)

**Created**: 2026-05-30

**Status**: Draft

---

## User Scenarios & Testing

### User Story 1 — Stock por Sucursal (Priority: P1)

Como Administrador, quiero ver el stock separado por sucursal (General, Ortiz, Mayo), para saber qué productos tengo en cada local.

**Acceptance Scenarios**:
1. **Given** la página de inventario, **When** selecciono una sucursal, **Then** veo solo el stock de esa sucursal.

### User Story 2 — Transferencia de Stock (Priority: P1)

Como Administrador, quiero transferir stock de una sucursal a otra, para reabastecer sucursales sin necesidad de una orden de compra.

**Acceptance Scenarios**:
1. **Given** el diálogo de transferencia, **When** selecciono origen, destino, producto y cantidad, **Then** el stock se descuenta del origen y se acredita en el destino.

### User Story 3 — Ventas por Sucursal (Priority: P2)

Como Administrador, quiero seleccionar la sucursal al hacer una venta en el POS, para que cada venta quede asociada al local correcto.

### User Story 4 — Historial de Transferencias (Priority: P3)

Como Administrador, quiero ver un registro de todas las transferencias realizadas, para tener trazabilidad.

---

## Requirements

- **FR-001**: El sistema DEBE mostrar el stock filtrado por sucursal en la página de inventario.
- **FR-002**: El sistema DEBE permitir transferir stock entre sucursales con: origen, destino, producto, cantidad.
- **FR-003**: El sistema DEBE validar que haya stock suficiente en origen antes de transferir.
- **FR-004**: El sistema DEBE registrar cada transferencia con fecha, origen, destino y detalle.
- **FR-005**: El sistema DEBE permitir seleccionar la sucursal al registrar una venta.
