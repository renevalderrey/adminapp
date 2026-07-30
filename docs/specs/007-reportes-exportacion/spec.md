# Feature Specification: Reportes y Exportación (Bloque 7)

**Created**: 2026-05-30

**Status**: Draft

---

## User Scenarios & Testing

### User Story 1 — Reporte de Ventas (Priority: P1)

Como Administrador, quiero ver un reporte de ventas por período con detalle de productos, costos y márgenes, para analizar la rentabilidad.

**Acceptance Scenarios**:
1. **Given** el reporte de ventas, **When** selecciono un rango de fechas, **Then** veo la lista de ventas con items, costos, margen bruto por producto.
2. **Given** el reporte visible, **When** hago clic en "Exportar", **Then** descargo un archivo XLSX o CSV con los mismos datos.

### User Story 2 — Reporte de Rentabilidad (Priority: P1)

Como Administrador, quiero ver un resumen de ganancias vs gastos en un período, para evaluar la salud financiera del negocio.

### User Story 3 — Reporte de Stock / Inventario (Priority: P2)

Como Administrador, quiero ver el inventario actual valorizado (cantidad × costo), para conocer el capital invertido en stock.

### User Story 4 — Exportación a Excel y CSV (Priority: P1)

Como Administrador, quiero exportar cualquier reporte a Excel (.xlsx) y CSV, para analizar los datos externamente.

---

## Requirements

- **FR-001**: El sistema DEBE mostrar un reporte de ventas con: fecha, productos, cantidades, precio unitario, costo, margen.
- **FR-002**: El sistema DEBE mostrar un reporte de rentabilidad: ingresos totales, costos de ventas, gastos fijos, margen neto.
- **FR-003**: El sistema DEBE mostrar un reporte de inventario valorizado: producto, stock total, costo unitario, valor total.
- **FR-004**: El sistema DEBE permitir exportar cualquier reporte a XLSX y CSV.
- **FR-005**: El sistema DEBE tener filtros de fecha en todos los reportes.
