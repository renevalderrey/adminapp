# Feature Specification: Flujo de Caja e Impuestos (Bloque 4)

**Feature Branch**: `004-flujo-caja-impuestos`

**Created**: 2026-05-30

**Status**: Draft

**Input**: Requerimientos del PRD referidos a Flujo de Caja (entradas/salidas, proyecciones), Carga Impositiva (Monotributo, IIBB, Retenciones), Costos Laborales (mano de obra, amortización).

---

## User Stories

### User Story 1 - Registro Unificado de Flujo de Caja (Priority: P1)
Como Administrador, quiero ver en una sola pantalla todos los movimientos de efectivo (ventas, gastos, pagos a proveedores, cobranzas, movimientos manuales) para conocer el saldo real en tiempo real.

### User Story 2 - Proyecciones de Caja a 30/60 Días (Priority: P2)
Como Administrador, quiero que el sistema proyecte el saldo futuro basado en gastos recurrentes e ingresos estimados para anticipar faltantes de efectivo.

### User Story 3 - Cálculo Automático de Monotributo (Priority: P2)
Como Administrador, quiero que el sistema calcule automáticamente el monto del Monotributo a pagar según la facturación acumulada y la categoría.

### User Story 4 - Registro de IIBB y Retenciones (Priority: P3)
Como Administrador, quiero registrar pagos de IIBB y retenciones para trackear la carga impositiva total.

---

## Requirements

### Functional Requirements
- **FR-001**: El sistema DEBE agregar todos los movimientos financieros (ventas, gastos, pagos proveedores, cobranzas) en una vista unificada de flujo de caja.
- **FR-002**: El sistema DEBE permitir registro manual de movimientos no cubiertos (préstamos, retiros, inversiones).
- **FR-003**: El sistema DEBE calcular el saldo actual en base a ingresos - egresos.
- **FR-004**: El sistema DEBE proyectar saldo a 30 y 60 días basado en gastos fijos recurrentes.
- **FR-005**: El sistema DEBE permitir configurar escalas de Monotributo (ingreso anual, categoría, monto).
- **FR-006**: El sistema DEBE calcular automáticamente el Monotributo según facturación del período.
- **FR-007**: El sistema DEBE permitir registrar pagos de impuestos (Monotributo, IIBB, retenciones).

### Key Entities

- **CashFlowEntry** [NUEVA] — Movimientos manuales de caja:
  - `id`, `type` (inflow/outflow), `category`, `amount`, `entry_date`, `description`, `reference`, `is_recurring`, `recurring_frequency`

- **TaxConfig** [NUEVA] — Configuración de impuestos:
  - `id`, `tax_type` (monotributo/iibb/retenciones), `config` (JSONB con escalas y tasas)

- **TaxPayment** [NUEVA] — Pagos de impuestos registrados:
  - `id`, `tax_type`, `amount`, `payment_date`, `period_from`, `period_to`, `notes`
