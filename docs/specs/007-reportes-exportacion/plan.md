# Technical Plan: Reportes y Exportación (Bloque 7)

## Architecture

```
Backend
├── routes/
│   └── reports.js              [NUEVO] — /api/reports/sales, /inventory, /profit

Frontend
├── pages/
│   └── Reports.jsx             [NUEVO] — tabs: Ventas, Rentabilidad, Stock
├── services/
│   └── api.js                  [MODIFICAR] +report endpoints
├── App.jsx                     [MODIFICAR] +ruta
└── components/
    └── app-sidebar.jsx         [MODIFICAR] +nav
```

## Key Decisions

| Decisión | Elección | Justificación |
|:---|:---|:---|
| Export library | `xlsx` (SheetJS) en frontend | Genera XLSX del lado cliente sin recargar servidor |
| CSV export | nativo (Blob + URL.createObjectURL) | Sin dependencias, built-in en JS |
| Profit report | Nuevo endpoint backend | Necesita unir ventas, costos de productos y gastos fijos |
