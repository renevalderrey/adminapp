# Feature Specification: Clientes y Cuentas Corrientes (Bloque 3)

**Feature Branch**: `003-clientes-cuentas-corrientes`

**Created**: 2026-05-30

**Status**: Draft

**Input**: Requerimientos del PRD referidos a Gestión de Clientes (historial de compra, control de deuda, frecuencia, ranking) y Cuentas Corrientes (cuentas por cobrar, cuentas por pagar, vencimientos, aging).

---

## User Scenarios & Testing

### User Story 1 - Registro y Gestión de Clientes (Priority: P1)

Como Administrador, quiero registrar clientes con sus datos fiscales y de contacto, para asociar las ventas a cada cliente y poder trackear su historial y deuda.

**Why this priority**: Es la base del módulo. Sin clientes registrados no hay cuenta corriente posible.

**Acceptance Scenarios**:
1. **Given** el formulario de nuevo cliente, **When** completo nombre, CUIT/DNI, email y teléfono, **Then** el cliente se guarda y aparece en la lista de clientes.
2. **Given** un cliente existente con ventas asociadas, **When** lo busco por nombre o CUIT, **Then** veo su historial de compras, deuda actual y frecuencia.

### User Story 2 - Cuenta Corriente de Clientes (Priority: P1)

Como Administrador, quiero ver la deuda de cada cliente con aging (30/60/90+ días), para gestionar cobranzas y conocer la exposición.

**Why this priority**: Control financiero crítico para evitar incobrables.

**Acceptance Scenarios**:
1. **Given** un cliente con ventas impagas, **When** consulto su detalle, **Then** veo saldo deudor total y desglose por antigüedad (0-30, 31-60, 61-90, 90+ días).
2. **Given** un cliente con deuda, **When** registro un pago, **Then** el saldo se actualiza y queda registrado en el historial de pagos.

### User Story 3 - Vinculación de Ventas a Clientes (Priority: P2)

Como Administrador, quiero seleccionar un cliente al hacer una venta en el POS, para que la venta quede automáticamente registrada en su cuenta corriente.

**Why this priority**: Automatiza la creación de deuda de clientes.

**Acceptance Scenarios**:
1. **Given** el POS abierto, **When** selecciono un cliente y confirmo la venta, **Then** la venta queda asociada al cliente y se refleja en su cuenta corriente.
2. **Given** una venta sin cliente asignado, **When** se confirma, **Then** la venta se registra como venta al público general (sin cuenta corriente).

### User Story 4 - Ranking de Clientes (Priority: P3)

Como Administrador, quiero ver un ranking de clientes por volumen de compra y frecuencia, para identificar clientes VIP y enfocar estrategias de fidelización.

### User Story 5 - Cuentas por Pagar con Aging (Priority: P2)

Como Administrador, quiero que las deudas con proveedores tengan fecha de vencimiento y aging, para gestionar pagos y evitar moras.

---

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE permitir registrar clientes con: nombre, CUIT/DNI, email, teléfono, dirección, condición fiscal, notas y estado activo/inactivo.
- **FR-002**: El sistema DEBE asociar cada venta a un cliente (opcional). Si no se especifica, la venta queda como "Consumidor Final".
- **FR-003**: El sistema DEBE calcular automáticamente la deuda de cada cliente como: `Saldo = Σ Ventas - Σ Pagos`.
- **FR-004**: El sistema DEBE mostrar el aging de deuda: saldos con 0-30, 31-60, 61-90 y 90+ días de vencimiento.
- **FR-005**: El sistema DEBE permitir registrar pagos de clientes con: monto, fecha, método de pago, referencia y notas.
- **FR-006**: El sistema DEBE mantener un ranking de clientes por: total comprado (histórico), frecuencia de compra, última compra.
- **FR-007**: El sistema DEBE agregar `due_date` a los movimientos de proveedores para permitir aging de cuentas por pagar.
- **FR-008**: El sistema DEBE mostrar un resumen de cuentas por cobrar y cuentas por pagar con totales aging.

### Key Entities

- **Customer** [NUEVA]:
  - `id` (INTEGER, PK)
  - `name` (STRING) — Nombre/Razón social
  - `tax_id` (STRING) — CUIT/DNI
  - `email` (STRING)
  - `phone` (STRING)
  - `address` (TEXT)
  - `tax_condition` (STRING) — `monotributo`, `ri`, `exento`, `consumidor_final`
  - `notes` (TEXT)
  - `is_active` (BOOLEAN)

- **CustomerPayment** [NUEVA]:
  - `id` (INTEGER, PK)
  - `customer_id` (INTEGER, FK)
  - `amount` (DECIMAL)
  - `payment_date` (DATEONLY)
  - `payment_method` (STRING)
  - `reference` (STRING)
  - `notes` (TEXT)

- **Sale** (Existente, a modificar):
  - `customer_id` (INTEGER, FK, NULL) — [NUEVO] Cliente asociado
  - `customer_name` (STRING) — [NUEVO] Nombre al momento de la venta (histórico)

- **SupplierMovement** (Existente, a modificar):
  - `due_date` (DATEONLY, NULL) — [NUEVO] Fecha de vencimiento

---

## Success Criteria

- **SC-001**: Un administrador puede registrar un cliente en menos de 30 segundos.
- **SC-002**: El cálculo de deuda (ventas - pagos) es exacto al centavo.
- **SC-003**: El aging de deuda se calcula correctamente en base a la fecha de cada venta.
- **SC-004**: El ranking de clientes se actualiza automáticamente con cada venta.

---

## Assumptions

- Una venta sin cliente asociado se considera "Consumidor Final" y no genera cuenta corriente.
- La deuda se calcula como: ventas totales (sin AFIP) - pagos registrados.
- El aging se calcula desde la fecha de la venta (no desde la fecha de vencimiento, a menos que se especifique).
- Los pagos se aplican a la deuda más antigua primero (FIFO).
