# Feature Specification: Dashboard Estratégico / KPIs (Bloque 5)

**Created**: 2026-05-30

**Status**: Draft

**Input**: Requerimientos de visibilidad estratégica: panel de control con indicadores clave de negocio en tiempo real.

---

## User Scenarios & Testing

### User Story 1 — Visión General de KPIs (Priority: P1)

Como Administrador, quiero ver en una sola pantalla los indicadores clave del negocio (ventas 30d, saldo de caja, proyecciones, clientes en deuda, productos con bajo stock), para tomar decisiones informadas sin tener que navegar entre múltiples secciones.

**Acceptance Scenarios**:
1. **Given** el dashboard, **When** se carga, **Then** veo tarjetas con: Ventas 30d, Ticket Promedio, Saldo de Caja, Proyección 30d, Clientes con Deuda, Productos con Bajo Stock.
2. **Given** el dashboard, **When** hay datos actualizados, **Then** las tarjetas reflejan los valores en vivo (no hardcodeados).

### User Story 2 — Ventas y Facturación (Priority: P1)

Como Administrador, quiero ver el resumen de ventas del período actual y anterior, para evaluar tendencias.

**Acceptance Scenarios**:
1. **Given** el dashboard, **When** veo la sección de ventas, **Then** veo total facturado este mes, total mes anterior, cantidad de ventas, y promedio por ticket.
2. **Given** el dashboard, **When** hay ventas registradas, **Then** veo el desglose por método de pago.

### User Story 3 — Cuentas Corrientes (Priority: P2)

Como Administrador, quiero ver en el dashboard el total por cobrar y por pagar con aging, para saber la exposición financiera global.

### User Story 4 — Alertas Rápidas (Priority: P2)

Como Administrador, quiero ver en el dashboard un resumen de alertas activas (stock bajo, vencimientos próximos), para priorizar acciones.

---

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE mostrar en el dashboard: ventas de los últimos 30 días (total, cantidad, ticket promedio).
- **FR-002**: El sistema DEBE mostrar el saldo de caja actual y proyecciones a 30 y 60 días.
- **FR-003**: El sistema DEBE mostrar la cantidad de clientes activos y cuántos tienen saldo deudor.
- **FR-004**: El sistema DEBE mostrar el total de cuentas por cobrar y por pagar con aging.
- **FR-005**: El sistema DEBE mostrar la cantidad de productos activos y cuántos tienen stock bajo.
- **FR-006**: El sistema DEBE mostrar los gastos fijos totales del período.
- **FR-007**: El sistema DEBE agregar todos los KPIs en un solo endpoint `/api/dashboard/kpis` para eficiencia.

### Key Entities

- No se crean entidades nuevas. El dashboard es una vista agregada de entidades existentes:
  - Sale, SaleItem
  - Product, Stock
  - Customer, CustomerPayment
  - CashFlowEntry
  - FixedExpense
  - SupplierMovement

---

## Success Criteria

- **SC-001**: El dashboard carga todos los KPIs en menos de 2 segundos (una sola llamada API).
- **SC-002**: Todos los valores mostrados corresponden a datos en vivo de la base de datos.
- **SC-003**: El BEP Simulator existente se conserva como herramienta interactiva.
