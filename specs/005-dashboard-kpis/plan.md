# Technical Plan: Dashboard Estratégico / KPIs (Bloque 5)

## Architecture

```
Backend
├── services/
│   └── dashboardService.js      [NUEVO]
├── routes/
│   └── dashboard.js             [NUEVO]

Frontend
├── pages/
│   └── Dashboard.jsx            [REESCRIBIR] — KPIs en vivo + BEP Simulator
├── services/
│   └── api.js                   [MODIFICAR] +dashboard KPI endpoint
└── App.jsx / server.js          [MODIFICAR] +route mount
```

## Key Decisions

| Decisión | Elección | Justificación |
|:---|:---|:---|
| Endpoint único | `GET /api/dashboard/kpis` | Evita N llamadas paralelas; un solo viaje red |
| Sin caching inicial | Consulta directa a DB | Volumen de datos bajo; si escala se agrega Redis |
| BEP Simulator se conserva | Se mantiene en el mismo Dashboard.jsx | Es la herramienta actual; se agregan KPIs arriba |
| Sin librería de charts | Solo cards + tablas | Consistente con el stack actual; evita dependencia extra |
| Período default | Últimos 30 días corridos | Simple y consistente con el flujo de caja |
