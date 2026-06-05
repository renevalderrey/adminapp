# Tasks: Dashboard Estratégico / KPIs (Bloque 5)

## Fase 1: Backend — Servicio y Ruta

- [ ] **T501** Crear `backend/src/services/dashboardService.js` con método `getKpis()`
  - Ventas 30d (total, cantidad, ticket promedio)
  - Ventas mes actual vs mes anterior
  - Desglose por método de pago (30d)
  - Saldo de caja y proyecciones (reusa cashflowService)
  - Clientes activos y con deuda
  - Cuentas por cobrar y por pagar con aging (reusa customerService y SupplierMovement)
  - Productos activos y con stock bajo
  - Gastos fijos totales
- [ ] **T502** Crear `backend/src/routes/dashboard.js` con `GET /api/dashboard/kpis`
- [ ] **T503** Registrar ruta en `server.js`

## Fase 2: Frontend

- [ ] **T504** Extender `frontend/src/services/api.js` con `getDashboardKpis()`
- [ ] **T505** Reescribir `frontend/src/pages/Dashboard.jsx`:
  - Fila de KPI cards con datos en vivo
  - Sección de ventas (total, ticket prom, vs mes anterior, métodos de pago)
  - Sección de cuentas corrientes (cobrar + pagar con aging)
  - Sección de alertas rápidas
  - BEP Simulator se mantiene debajo
- [ ] **T506** Verificar build de frontend
