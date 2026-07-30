# Technical Plan: Producción (Bloque 2)

**Feature Branch**: `002-produccion`

**Depends on**: Bloque 1 (Insumos, Fórmulas y Recetas) — modelos `Recipe`, `RecipeItem`, `Product`, `Stock`, `ProductCostHistory` deben estar presentes y funcionales.

---

## 1. Objetivo

Implementar el módulo de Producción que permite:
1. Registrar órdenes de fabricación vinculadas a recetas existentes.
2. Calcular automáticamente costos (unitario y total del lote).
3. Mover stock (descontar insumos, acreditar producto terminado).
4. Anular órdenes con reversión de stock (soft void).
5. Consultar historial de producción con filtros.

---

## 2. Arquitectura de Componentes

```
Backend
├── models/
│   ├── ProductionOrder.js       [NUEVO]
│   └── ProductionOrderItem.js   [NUEVO]
├── services/
│   └── productionService.js     [NUEVO] — lógica de negocio centralizada
└── routes/
    └── production.js            [NUEVO] — endpoints REST

Frontend
├── pages/
│   └── Production.jsx           [NUEVO] — página principal de producción
├── services/
│   └── api.js                   [MODIFICAR] — agregar llamadas a /api/production
└── App.jsx + app-sidebar.jsx    [MODIFICAR] — ruta y navegación
```

---

## 3. Contratos de API

Ver `contracts/` para detalle completo. Resumen:

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/production` | Listar órdenes con filtros (producto, fecha, estado, lote) |
| `GET` | `/api/production/:id` | Detalle de una orden con sus items |
| `POST` | `/api/production` | Crear nueva orden de producción |
| `POST` | `/api/production/:id/void` | Anular una orden (soft void + reversión de stock) |

---

## 4. Lógica del Servicio de Producción (`productionService.js`)

### 4.1 `createProductionOrder(data, transaction?)`

```
1. Buscar la receta activa del producto (Recipe + RecipeItems + costos de Products)
2. Si no tiene receta → throw Error("Producto sin receta activa")
3. Calcular:
   a. Costo Total Ingredientes por unidad de receta
   b. Costo Total Lote = (Costo_por_unidad_receta × quantity_produced) / (yield × (1 - loss_pct))
   c. Costo Unitario = Costo Total Lote / quantity_produced
4. Validar stock de insumos → devolver warnings (no bloquear)
5. Dentro de una TRANSACCIÓN:
   a. Crear ProductionOrder con status='completed' y cost_snapshot
   b. Crear ProductionOrderItems por cada ingrediente
   c. Descontar stock de cada insumo (findOrCreate por product_id+location, update quantity)
   d. Acreditar stock del producto terminado (findOrCreate, update quantity + current_batch + purchase_date)
   e. Si el costo unitario calculado ≠ product.cost → actualizar product.cost y registrar en ProductCostHistory
6. Retornar la orden creada con sus items
```

### 4.2 `voidProductionOrder(id, transaction?)`

```
1. Buscar la orden por ID, verificar que status === 'completed'
2. Si ya está 'voided' → throw Error
3. Dentro de una TRANSACCIÓN:
   a. Para cada ProductionOrderItem: sumar quantity_used de vuelta al stock del insumo
   b. Descontar quantity_produced del stock del producto terminado (hasta 0, no negativo)
   c. Actualizar production_order.status = 'voided', voided_at = NOW()
4. Retornar la orden actualizada
```

---

## 5. Interfaz de Usuario (`Production.jsx`)

### Layout Principal
```
┌─────────────────────────────────────────────────────────────┐
│ Producción                        [+ Nueva Orden]           │
├──────────────────┬──────────────────────────────────────────┤
│ FILTROS          │ HISTORIAL DE ÓRDENES                     │
│ · Producto       │ Tabla: Fecha | Producto | Lote | Qty |   │
│ · Fecha desde    │        Costo Unit. | Costo Total | Estado │
│ · Fecha hasta    │        [Detalle] [Anular]                 │
│ · Lote           │                                          │
│ · Estado         │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

### Modal: Nueva Orden de Producción
```
┌─────────────────────────────────────────────────────────────┐
│ Nueva Orden de Producción                                   │
├─────────────────────────────────────────────────────────────┤
│ Producto a fabricar: [Selector de productos con receta]     │
│ Cantidad a producir: [Input numérico]                       │
│ Código de Lote:      [Input texto]                          │
│ Fecha de producción: [Date picker]                          │
│ Sucursal destino:    [Selector location]                    │
│ Notas:               [Textarea]                             │
├─────────────────────────────────────────────────────────────┤
│ PREVIEW DE COSTOS (calculado en tiempo real):               │
│ · Ingredientes: [Lista con cantidades y costos]             │
│ · Costo total lote: $X.XXX                                  │
│ · Costo unitario: $X.XXX                                    │
│ ⚠ Advertencias de stock (si las hay)                        │
├─────────────────────────────────────────────────────────────┤
│                              [Cancelar] [Confirmar Orden]   │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Decisiones Técnicas

| Decisión | Elección | Justificación |
| :--- | :--- | :--- |
| Anulación | Soft void (`status='voided'`) | Trazabilidad histórica. Consistente con la decisión del Bloque 1 para ventas. |
| Cálculo de costo | En backend (servicio) | Garantiza consistencia. El frontend muestra un preview usando el mismo cálculo pero el oficial lo hace el servidor. |
| Stock de insumos negativo | Permitido con warning | Puede haber stock no registrado. No se bloquea la producción. |
| Snapshot de costos | JSONB en production_orders | Inmutabilidad histórica. Los cambios futuros de precio no afectan los registros pasados. |
| Actualización de `product.cost` | Solo si difiere | Evita entradas innecesarias en `product_cost_history` y recálculos en cascada. |

---

## 7. Plan de Implementación (Fases)

### Fase 1 - Backend
1. Crear modelos `ProductionOrder` y `ProductionOrderItem` (Sequelize)
2. Agregar relaciones en `models/index.js`
3. Implementar `productionService.js` con `createProductionOrder` y `voidProductionOrder`
4. Crear rutas en `routes/production.js`
5. Registrar rutas en `server.js`

### Fase 2 - Frontend
1. Extender `api.js` con los nuevos endpoints
2. Crear `Production.jsx` con historial, modal de nueva orden y preview de costos
3. Registrar ruta en `App.jsx` y navegación en `app-sidebar.jsx`

### Fase 3 - Validación
1. Prueba manual: crear orden → verificar stock → anular → verificar reversión
2. Documentar en `walkthrough.md`
