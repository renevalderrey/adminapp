# Tasks: Reportes y Exportación (Bloque 7)

## Fase 1: Backend

- [ ] **T701** Crear `backend/src/routes/reports.js`:
  - `GET /api/reports/sales?from=&to=` — ventas con items, costos, margen
  - `GET /api/reports/inventory` — stock valorizado
  - `GET /api/reports/profit?from=&to=` — P&L resumido
- [ ] **T702** Registrar ruta en `server.js`

## Fase 2: Frontend

- [ ] **T703** Instalar `xlsx` en frontend
- [ ] **T704** Extender `api.js` con endpoints de reportes
- [ ] **T705** Crear `frontend/src/pages/Reports.jsx` con:
  - Tabs: Ventas, Rentabilidad, Stock
  - Filtro de fechas
  - Tablas con datos
  - Botones Exportar XLSX y CSV
- [ ] **T706** Agregar ruta y sidebar
- [ ] **T707** Verificar build
