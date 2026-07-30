# SDDs — Sistema listo para Cliente

> Documento maestro con los 9 SDDs ordenados por dependencia.
> Cada SDD es independiente y se implementa en una `feature/SDD-XXX` branch desde `develop`.

---

## Índice

| SDD | Descripción | Prioridad | Depende de |
|-----|-------------|-----------|------------|
| [SDD-001](#sdd-001---git-setup--infraestructura) | Git Setup + Infraestructura | 🔴 Alta | — |
| [SDD-002](#sdd-002---fix-descuento-de-stock-en-pos) | Fix descuento de stock en POS | 🔴 Crítica | SDD-001 |
| [SDD-003](#sdd-003---inventario-mejoras) | Inventario mejoras | 🟡 Media | SDD-001 |
| [SDD-004](#sdd-004---gastos-fijos-dinámicos) | Gastos fijos dinámicos | 🟡 Media | SDD-001 |
| [SDD-005](#sdd-005---proveedores-verificación) | Proveedores verificación | 🟡 Media | SDD-001 |
| [SDD-006](#sdd-006---permisos--enum-gerente) | Permisos + ENUM gerente | 🟡 Media | SDD-001 |
| [SDD-007](#sdd-007---onboarding--invitaciones-e2e) | Onboarding + Invitaciones E2E | 🟡 Media | SDD-006 |
| [SDD-008](#sdd-008---bloqueo-de-módulos-no-core) | Bloqueo de módulos no-core | 🟡 Media | SDD-006 |
| [SDD-009](#sdd-009---tiendanube-webhook--mapping) | TiendaNube webhook + mapping | 🔵 Baja | SDD-002, SDD-003 |

---

## Convenciones globales

- **Commits**: `SDD-XXX: mensaje descriptivo` (ej. `SDD-002: descuenta stock al crear venta`)
- **Branches**: `feature/SDD-XXX-nombre-corto` desde `develop`
- **PRs**: Siempre target `develop`. Usar template de PR.
- **Migrations**: Cada cambio de schema requiere un migration file nuevo en `backend/src/migrations/`. NO modificar la migración inicial.
- **Modelos**: Se actualizan para reflejar el schema, pero el source of truth es la migración.

---

## SDD-001 — Git Setup + Infraestructura

### Objetivo
Establecer branching strategy, CI/CD, testing framework, y convenciones del proyecto.

### Archivos a crear

#### `.github/pull_request_template.md`
```markdown
## Descripción
[Breve descripción del cambio]

## SDD Relacionado
[Ej: SDD-002]

## Tipo de Cambio
- [ ] Bug fix
- [ ] Nueva funcionalidad
- [ ] Refactor
- [ ] Infraestructura / CI

## Cómo se probó
[Pasos para verificar el cambio]

## Checklist
- [ ] Probado manualmente
- [ ] No rompe tests existentes (si los hay)
- [ ] Migración hacia atrás compatible
```

#### `.env.example` (raíz del proyecto)
```bash
# Backend
PORT=5000
DATABASE_URL=postgresql://postgres:comprafit_secure_2025@localhost:5433/comprafit
AUTH0_DOMACEJEMPLO=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.comprafit.com
TIENDANUBE_CLIENT_ID=
TIENDANUBE_CLIENT_SECRET=
FRONTEND_URL=http://localhost:5173
# Solo para desarrollo local - NUNCA activar en producción
BYPASS_AUTH=false

# Frontend
VITE_API_URL=http://localhost:5000/api
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=your-client-id
VITE_AUTH0_AUDIENCE=https://api.comprafit.com
```

#### `backend/jest.config.js`
```js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterSetup: ['<rootDir>/src/tests/setup.js'],
  testMatch: ['**/__tests__/**/*.test.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

#### `backend/src/tests/setup.js`
- Configurar base de datos de test (SQLite en memoria o PostgreSQL separada)
- Setup de `beforeEach` / `afterEach` para transacciones
- Mock de Auth0 middleware

#### `backend/package.json` - agregar scripts
```json
{
  "scripts": {
    "test": "jest --forceExit --detectOpenHandles",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

### Archivos a modificar

#### `.gitignore`
Verificar que incluya:
```
.env
.env.local
node_modules/
dist/
*.log
.DS_Store
backend/src/tests/coverage/
```

### Dependencias a instalar
```bash
cd backend
npm install --save-dev jest supertest
```

### Criterios de aceptación
- [ ] Rama `develop` existe y está sincronizada con `main`
- [ ] PR template funcional en `.github/`
- [ ] `.env.example` documenta todas las variables de entorno
- [ ] `jest` + `supertest` instalados como devDependencies
- [ ] `npm test` corre y pasa (0 tests es aceptable)
- [ ] `.gitignore` excluye `.env`, `node_modules/`, `dist/`

---

## SDD-002 — Fix Descuento de Stock en POS

### Objetivo
**BUG CRÍTICO**: El POS registra ventas pero nunca descuenta stock. Además, el DELETE /sales/:id es un hard-delete destructivo sin devolución de stock.

### Database Migrations

#### Migration 1: `20260601-add-stock-movements.js`
Crear tabla `stock_movements` para auditoría de cambios de stock.

```sql
CREATE TABLE stock_movements (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  punto_de_venta_id INTEGER REFERENCES puntos_de_venta(id) ON DELETE SET NULL,
  tipo VARCHAR(30) NOT NULL,  -- 'sale', 'sale_void', 'manual', 'transfer_in', 'transfer_out', 'purchase'
  referencia_id VARCHAR(40),   -- sale ID, transfer ID, etc.
  cantidad_anterior INTEGER NOT NULL,
  cantidad_nueva INTEGER NOT NULL,
  disponible_anterior INTEGER NOT NULL,
  disponible_nuevo INTEGER NOT NULL,
  usuario_id VARCHAR(255),     -- auth0_sub
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_empresa ON stock_movements(empresa_id);
CREATE INDEX idx_stock_movements_fecha ON stock_movements(created_at);
```

#### Migration 2: `20260602-add-voided-status-to-sales.js`
Agregar columna `status` a `sales` para evitar hard-deletes.

```sql
ALTER TABLE sales ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE sales ADD COLUMN voided_at TIMESTAMP;
ALTER TABLE sales ADD COLUMN voided_by VARCHAR(255);
CREATE INDEX idx_sales_status ON sales(status);
```

### Modelos nuevos

#### `backend/src/models/StockMovement.js`
```javascript
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StockMovement = sequelize.define('StockMovement', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  empresa_id: { type: DataTypes.INTEGER, allowNull: false },
  product_id: { type: DataTypes.INTEGER, allowNull: false },
  punto_de_venta_id: { type: DataTypes.INTEGER, allowNull: true },
  tipo: { type: DataTypes.STRING(30), allowNull: false },
  referencia_id: { type: DataTypes.STRING(40), allowNull: true },
  cantidad_anterior: { type: DataTypes.INTEGER, allowNull: false },
  cantidad_nueva: { type: DataTypes.INTEGER, allowNull: false },
  disponible_anterior: { type: DataTypes.INTEGER, allowNull: false },
  disponible_nuevo: { type: DataTypes.INTEGER, allowNull: false },
  usuario_id: { type: DataTypes.STRING(255), allowNull: true },
}, {
  tableName: 'stock_movements',
  timestamps: true,
  updatedAt: false,
});

module.exports = StockMovement;
```

### Modificaciones

#### `backend/src/models/index.js`
Agregar:
```javascript
const StockMovement = require('./StockMovement');
// ... en exports:
StockMovement,
```

#### `backend/src/routes/sales.js` — `POST /api/sales`
Reemplazar el handler actual con:

```javascript
router.post('/', checkPermission('ventas.crear'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id, date, time, total, payment_method, notes, location, seller, items, afip_cae, afip_nro, afip_vto, afip_type, customer_id, customer_name } = req.body;

    const saleData = { 
      id, date, time, total, payment_method, notes, location, seller, 
      afip_cae, afip_nro, afip_vto, afip_type, 
      empresa_id: req.empresaId || 1, 
      punto_de_venta_id: req.puntoDeVentaId || null,
      status: 'active',
    };
    if (customer_id) {
      saleData.customer_id = customer_id;
      saleData.customer_name = customer_name || null;
    }

    const sale = await Sale.create(saleData, { transaction: t });

    if (Array.isArray(items) && items.length) {
      const saleItems = items.map(item => ({
        sale_id: sale.id,
        product_name: item.product_name || item.n || 'Producto',
        product_id: item.product_id || null,
        quantity: item.quantity || item.qty || 1,
        unit_price: item.unit_price || item.precio || 0,
        payment_method: item.payment_method || item.mp || null,
      }));
      await SaleItem.bulkCreate(saleItems, { transaction: t });

      // ── Descontar stock con row-level locking ──
      for (const si of saleItems) {
        if (!si.product_id) continue;

        const stock = await Stock.findOne({
          where: { 
            product_id: si.product_id, 
            empresa_id: req.empresaId || 1,
            punto_de_venta_id: req.puntoDeVentaId || null,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (stock) {
          const qty = si.quantity;
          if (stock.available < qty) {
            throw new Error(`Stock insuficiente para "${si.product_name}": disponible ${stock.available}, requerido ${qty}`);
          }
          const oldQty = stock.quantity;
          const oldAvail = stock.available;
          await stock.update({
            quantity: stock.quantity - qty,
            available: stock.available - qty,
          }, { transaction: t });

          await StockMovement.create({
            empresa_id: req.empresaId || 1,
            product_id: si.product_id,
            punto_de_venta_id: req.puntoDeVentaId || null,
            tipo: 'sale',
            referencia_id: sale.id,
            cantidad_anterior: oldQty,
            cantidad_nueva: stock.quantity,
            disponible_anterior: oldAvail,
            disponible_nuevo: stock.available,
            usuario_id: req.userId,
          }, { transaction: t });
        }
      }
    }

    await t.commit();
    res.status(201).json({ ok: true, data: sale });
  } catch (err) {
    await t.rollback();
    if (err.message.startsWith('Stock insuficiente')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

#### `backend/src/routes/sales.js` — `DELETE /api/sales/:id` → CAMBIAR A `PUT /api/sales/:id/void`
Reemplazar el DELETE con un soft-void:

```javascript
// PUT /api/sales/:id/void — Anular venta (devolver stock, soft delete)
router.put('/:id/void', checkPermission('ventas.anular'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const sale = await Sale.findByPk(req.params.id, { 
      include: [{ model: SaleItem, as: 'items' }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!sale) return res.status(404).json({ ok: false, error: 'Venta no encontrada' });
    if (sale.status === 'voided') return res.status(400).json({ ok: false, error: 'Venta ya anulada' });

    // Devolver stock
    for (const item of sale.items || []) {
      if (!item.product_id) continue;

      const stock = await Stock.findOne({
        where: { 
          product_id: item.product_id, 
          empresa_id: sale.empresa_id,
          punto_de_venta_id: sale.punto_de_venta_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (stock) {
        const oldQty = stock.quantity;
        const oldAvail = stock.available;
        await stock.update({
          quantity: stock.quantity + item.quantity,
          available: stock.available + item.quantity,
        }, { transaction: t });

        await StockMovement.create({
          empresa_id: sale.empresa_id,
          product_id: item.product_id,
          punto_de_venta_id: sale.punto_de_venta_id,
          tipo: 'sale_void',
          referencia_id: sale.id,
          cantidad_anterior: oldQty,
          cantidad_nueva: stock.quantity,
          disponible_anterior: oldAvail,
          disponible_nuevo: stock.available,
          usuario_id: req.userId,
        }, { transaction: t });
      }
    }

    await sale.update({
      status: 'voided',
      voided_at: new Date(),
      voided_by: req.userId,
    }, { transaction: t });

    await t.commit();
    res.json({ ok: true, message: 'Venta anulada y stock restaurado' });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

Mantener DELETE por retrocompatibilidad (por ahora) pero deprecado:
```javascript
// DELETE /api/sales/:id — DEPRECATED: usar PUT /:id/void
router.delete('/:id', checkPermission('ventas.anular'), async (req, res) => {
  return res.status(400).json({ ok: false, error: 'Use PUT /api/sales/:id/void en su lugar' });
});
```

#### `backend/src/routes/general.js` — `PUT /api/stock/:id`
Agregar validación de stock negativo y auditoría:

```javascript
router.put('/stock/:id', checkPermission('stock.editar'), async (req, res) => {
  try {
    const stock = await Stock.findByPk(req.params.id);
    if (!stock) return res.status(404).json({ ok: false, error: 'Registro de stock no encontrado' });

    const { quantity, available } = req.body;
    if (quantity !== undefined && quantity < 0) {
      return res.status(400).json({ ok: false, error: 'El stock no puede ser negativo' });
    }
    if (available !== undefined && available < 0) {
      return res.status(400).json({ ok: false, error: 'El disponible no puede ser negativo' });
    }

    const oldQty = stock.quantity;
    const oldAvail = stock.available;

    await stock.update(req.body);

    // Registrar movimiento manual
    if (quantity !== undefined || available !== undefined) {
      const StockMovement = require('../models/StockMovement');
      await StockMovement.create({
        empresa_id: stock.empresa_id,
        product_id: stock.product_id,
        punto_de_venta_id: stock.punto_de_venta_id,
        tipo: 'manual',
        cantidad_anterior: oldQty,
        cantidad_nueva: stock.quantity,
        disponible_anterior: oldAvail,
        disponible_nuevo: stock.available,
        usuario_id: req.userId,
      });
    }

    res.json({ ok: true, data: stock });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

#### `frontend/src/pages/Billing.jsx`
- Mostrar stock disponible en cada tarjeta de producto
- Al hacer clic en "+", verificar stock > 0 (deshabilitar botón si stock=0)
- Mostrar badge "Stock bajo" (≤ min_stock) con color naranja
- Después de venta exitosa, refrescar `initialize()` (ya está? check: clearCart() se llama, pero initialize() no se llama después de la venta. Agregar)

```javascript
// En el componente, después de una venta exitosa:
await api.post('/sales', salePayload);
toast.success(...);
clearCart();
initialize();  // ← agregar esto para refrescar stock
```

#### `frontend/src/services/api.js`
Agregar función de anulación:
```javascript
export const voidSale = (id) => api.put(`/sales/${id}/void`);
```

### Criterios de aceptación
- [ ] Vender un producto reduce `quantity` y `available` en tabla stock
- [ ] Vender con stock insuficiente devuelve 400 + mensaje claro
- [ ] Anular venta (`PUT /sales/:id/void`) restaura stock
- [ ] Cada cambio de stock queda registrado en `stock_movements`
- [ ] Ajuste manual de stock por API valida no-negativos y guarda auditoría
- [ ] El POS en frontend muestra stock disponible y deshabilita "+" si stock=0
- [ ] `DELETE /sales/:id` devuelve error indicando usar `PUT /sales/:id/void`

---

## SDD-003 — Inventario Mejoras

### Objetivo
Mejorar la UI de inventario con indicador de stock bajo (basado en `min_stock` real del producto), y agregar campo `tiendanube_variant_id` al modelo Product (para futura integración TN).

### Database Migrations

#### Migration: `20260603-add-tiendanube-variant-id.js`
```sql
ALTER TABLE products ADD COLUMN tiendanube_variant_id INTEGER;
CREATE INDEX idx_products_tiendanube_variant ON products(tiendanube_variant_id);
```

### Modificaciones

#### `backend/src/models/Product.js`
Agregar campo:
```javascript
tiendanube_variant_id: {
  type: DataTypes.INTEGER,
  allowNull: true,
},
```

#### `frontend/src/pages/Inventory.jsx`
Reemplazar la lógica de `lowStock` (line 136-139) que actualmente hardcodea `<= 5`:

```javascript
// Reemplazar:
const lowStock = products.filter(p => {
  const total = getStockForLocation(p, activeLocation)
  return total <= 5 && total > 0
}).length

// Con stock real de min_stock:
const lowStock = products.filter(p => {
  const total = getStockForLocation(p, activeLocation)
  const minStock = p.stock?.find(s => {
    if (activeLocation === 'all') return true
    return s.location === activeLocation
  })?.min_stock || 0
  return total > 0 && total <= minStock
}).length
```

En la tabla, en las celdas de stock, cambiar el badge:
```javascript
// Si stock <= min_stock real, badge 'destructive' o 'warning'
// Si stock = 0, badge 'destructive'
// Si stock > min_stock, badge 'outline'

const stockEntry = p.stock?.find(s => s.location === loc.value)
const qty = stockEntry?.quantity || 0
const minStock = stockEntry?.min_stock || 0

let badgeVariant = 'outline'
if (qty === 0) badgeVariant = 'destructive'
else if (qty <= minStock) badgeVariant = 'warning' // o 'secondary' con clase naranja

<Badge variant={badgeVariant} className="font-mono">{qty}</Badge>
```

### Criterios de aceptación
- [ ] Productos con `quantity <= min_stock` se muestran con badge naranja/rojo
- [ ] Productos sin stock se muestran con badge rojo
- [ ] Productos con stock OK se muestran normal
- [ ] Campo `tiendanube_variant_id` existe en modelo y DB (nullable)

---

## SDD-004 — Gastos Fijos Dinámicos

### Objetivo
Reemplazar el sistema hardcodeado GF1/GF2 por uno vinculado a `punto_de_venta_id` real.

### Database Migrations

#### Migration: `20260604-add-pv-to-fixed-expenses.js`
```sql
ALTER TABLE fixed_expenses ADD COLUMN punto_de_venta_id INTEGER REFERENCES puntos_de_venta(id) ON DELETE SET NULL;
CREATE INDEX idx_fixed_expenses_pv ON fixed_expenses(punto_de_venta_id);
```

### Modificaciones

#### `backend/src/models/FixedExpense.js`
Agregar campo:
```javascript
punto_de_venta_id: {
  type: DataTypes.INTEGER,
  allowNull: true,
  references: { model: 'puntos_de_venta', key: 'id' },
},
```

#### `backend/src/routes/general.js`
En `GET /api/expenses`, aceptar `punto_de_venta_id` como filtro:
```javascript
router.get('/expenses', checkPermission('gastos.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId || 1;
    const where = {
      [Op.or]: [
        { empresa_id: empresaId },
        { empresa_id: null },
      ],
    };
    if (req.query.group) where.group = req.query.group;
    if (req.query.punto_de_venta_id) where.punto_de_venta_id = req.query.punto_de_venta_id;
    const expenses = await FixedExpense.findAll({ where, order: [['id', 'ASC']] });
    res.json({ ok: true, data: expenses });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

En `POST /api/expenses`, aceptar `punto_de_venta_id`:
```javascript
router.post('/expenses', checkPermission('gastos.crear'), async (req, res) => {
  try {
    const data = { ...req.body, empresa_id: req.empresaId || 1 };
    // Si no se envía group pero se envía punto_de_venta_id, derivar group de PV
    if (!data.group && data.punto_de_venta_id) {
      data.group = 'pv_' + data.punto_de_venta_id;
    }
    const expense = await FixedExpense.create(data);
    res.status(201).json({ ok: true, data: expense });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

#### `frontend/src/pages/Expenses.jsx`
Reemplazar completamente con versión dinámica:

```javascript
import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
import useStore from '@/store/useStore'
import api from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Trash2, Store } from 'lucide-react'
import { useConfirmDialog } from '@/components/ConfirmDialog'

const Expenses = () => {
  const { initialize, empresaActiva } = useStore()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [formData, setFormData] = useState({ name: '', amount: '', punto_de_venta_id: '' })

  const puntosDeVenta = empresaActiva?.puntosDeVenta || []

  const fetchExpenses = async () => {
    setLoading(true)
    try {
      const res = await api.get('/expenses')
      setExpenses(res.data.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchExpenses() }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    try {
      await api.post('/expenses', {
        name: formData.name,
        amount: formData.amount,
        punto_de_venta_id: formData.punto_de_venta_id ? parseInt(formData.punto_de_venta_id) : null,
      })
      setIsAdding(false)
      setFormData({ name: '', amount: '', punto_de_venta_id: '' })
      fetchExpenses()
      initialize()
    } catch (err) {
      toast.error('Error: ' + err.message)
    }
  }

  const handleDelete = async (id) => {
    const ok = await confirm('¿Eliminar este gasto?')
    if (!ok) return
    try {
      await api.delete(`/expenses/${id}`)
      fetchExpenses()
      initialize()
    } catch (err) {
      toast.error('Error: ' + err.message)
    }
  }

  // Agrupar gastos por punto de venta
  const groups = {}
  for (const pv of puntosDeVenta) {
    groups[pv.id] = {
      name: pv.name,
      expenses: expenses.filter(e => e.punto_de_venta_id === pv.id || e.group === 'gf' + puntosDeVenta.indexOf(pv)),
    }
  }
  // Gastos sin PV asignado van a "General"
  groups['general'] = {
    name: 'General',
    expenses: expenses.filter(e => !e.punto_de_venta_id && !e.group?.startsWith('gf')),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Gastos <span className="text-primary">Fijos</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Costos operativos agrupados por sucursal.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo Gasto
        </Button>
      </div>

      {/* Stats por PV */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.entries(groups).filter(([_, g]) => g.name !== 'General').map(([key, group]) => {
          const total = group.expenses.reduce((s, e) => s + parseFloat(e.amount), 0)
          return (
            <Card key={key}>
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Total {group.name}
                </p>
                <p className="text-2xl font-black font-mono mt-1 text-destructive">
                  ${total.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Tablas por PV */}
      <div className="grid lg:grid-cols-2 gap-6">
        {Object.entries(groups).map(([key, group]) => (
          <Card key={key}>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm flex items-center gap-2">
                <Store className="h-4 w-4" /> {group.name}
              </CardTitle>
            </CardHeader>
            <Table>
              <TableBody>
                {group.expenses.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-sm text-muted-foreground text-center py-4">
                      Sin gastos registrados
                    </TableCell>
                  </TableRow>
                ) : group.expenses.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{e.name}</TableCell>
                    <TableCell className="text-right font-bold font-mono text-destructive">
                      -${parseFloat(e.amount).toLocaleString()}
                    </TableCell>
                    <TableCell className="w-10">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(e.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))}
      </div>

      {/* Dialog: New Expense */}
      <Dialog open={isAdding} onOpenChange={setIsAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Agregar Gasto</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Descripción</label>
              <Input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Monto ($)</label>
              <Input type="number" required value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
              <select
                value={formData.punto_de_venta_id}
                onChange={e => setFormData({ ...formData, punto_de_venta_id: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">General (sin sucursal)</option>
                {puntosDeVenta.map(pv => (
                  <option key={pv.id} value={pv.id}>{pv.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setIsAdding(false)}>Cancelar</Button>
              <Button className="flex-1" type="submit">Guardar Gasto</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </div>
  )
}

export default Expenses
```

### Criterios de aceptación
- [ ] Gastos se muestran agrupados por punto de venta real
- [ ] Al crear gasto, selector muestra los puntos de venta de la empresa
- [ ] Gastos existentes con `group='gf1'` y `group='gf2'` se muestran correctamente (retrocompatibilidad)
- [ ] Backend acepta `punto_de_venta_id` y filtra por él

---

## SDD-005 — Proveedores Verificación

### Objetivo
Verificar que el módulo de proveedores funcione correctamente en multi-tenant. No hay cambios de código mayores, solo revisión y fixes si se encuentran bugs.

### Archivos a revisar

#### `backend/src/routes/suppliers.js` (leer y revisar)
- [ ] Todos los `findAll`, `findOne`, `create`, `update`, `destroy` filtran por `empresa_id`
- [ ] Las cuentas corrientes (pagos, adelantos, saldos) usan `req.empresaId || 1`
- [ ] Los pedidos por marca funcionan correctamente

#### `frontend/src/pages/Orders.jsx` (leer y revisar)
- [ ] Al crear proveedor, se asigna a la empresa activa
- [ ] Al registrar movimiento, se filtra por empresa activa
- [ ] Los totales de cuenta corriente se calculan correctamente
- [ ] Exportación a WhatsApp funciona

#### `frontend/src/services/api.js`
- [ ] Las funciones de proveedores ya envían `X-Empresa-Id` header (verificado: sí, via interceptor global)

### Criterios de aceptación
- [ ] CRUD completo de proveedores funciona multi-tenant
- [ ] Cuenta corriente con pagos, adelantos, saldos calcula correctamente
- [ ] Armado de pedidos por marca genera el detalle JSON correcto
- [ ] Exportación a WhatsApp genera link correcto

---

## SDD-006 — Permisos + ENUM Gerente

### Objetivo
Agregar `'gerente'` al ENUM de `UsuarioEmpresa.role`, agregar wildcard support en permisos, y proteger `BYPASS_AUTH`.

### Database Migrations

#### Migration: `20260605-add-gerente-to-usuario-empresas-role.js`
```sql
-- PostgreSQL no permite alterar ENUMs directamente. 
-- Cambiamos a VARCHAR(20) para evitar el problema del ENUM.
ALTER TABLE usuario_empresas ALTER COLUMN role TYPE VARCHAR(20);
```

### Modificaciones

#### `backend/src/models/UsuarioEmpresa.js`
Cambiar de ENUM a VARCHAR:
```javascript
role: {
  type: DataTypes.STRING(20),
  allowNull: false,
  defaultValue: 'vendedor',
},
```

#### `backend/src/middleware/checkPermission.js`
Agregar wildcard support + BYPASS_AUTH guard:

```javascript
const logger = require('../utils/logger');

function checkPermission(codigo) {
  return (req, res, next) => {
    // BYPASS_AUTH solo en desarrollo
    if (process.env.BYPASS_AUTH === 'true') {
      if (process.env.NODE_ENV === 'production') {
        logger.error('BYPASS_AUTH está activo en producción. Negando acceso por seguridad.');
        return res.status(500).json({ error: 'CONFIG_ERROR', message: 'Error de configuración del servidor' });
      }
      return next();
    }

    if (!req.usuarioPermisos || !Array.isArray(req.usuarioPermisos)) {
      logger.warn({
        userId: req.userId,
        permission: codigo,
        path: req.originalUrl,
      }, 'Permission denied: no permissions loaded');

      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `No tienes permiso para realizar esta acción (${codigo})`,
      });
    }

    // Wildcard support: si usuario tiene "products.*", "products.ver" pasa
    const wildcard = codigo.split('.').slice(0, -1).join('.') + '.*';
    
    if (req.usuarioPermisos.includes(codigo) || req.usuarioPermisos.includes(wildcard)) {
      return next();
    }

    logger.warn({
      userId: req.userId,
      permission: codigo,
      wildcard,
      userPermissions: req.usuarioPermisos,
      path: req.originalUrl,
    }, `Permission denied: ${codigo}`);

    return res.status(403).json({
      error: 'FORBIDDEN',
      message: `No tienes permiso para realizar esta acción (${codigo})`,
    });
  };
}

module.exports = checkPermission;
```

#### `frontend/src/hooks/usePermission.js`
Agregar wildcard support en frontend:

```javascript
import useStore from '@/store/useStore';

export function usePermission() {
  const permisos = useStore(s => s.permisos);

  function can(codigo) {
    if (!codigo) return true;
    if (!permisos || !Array.isArray(permisos)) return false;
    if (permisos.includes(codigo)) return true;
    const wildcard = codigo.split('.').slice(0, -1).join('.') + '.*';
    return permisos.includes(wildcard);
  }

  function canAny(codigos) {
    return codigos.some(c => can(c));
  }

  function canAll(codigos) {
    return codigos.every(c => can(c));
  }

  return { can, canAny, canAll, permisos };
}
```

#### `backend/src/seedPermissions.js`
Agregar lógica de upsert para que nuevos permisos se agreguen a DBs existentes:

```javascript
async function seedPermissions() {
  try {
    // Siempre hacer upsert de permisos que no existan
    for (const permiso of PERMISOS) {
      await Permiso.findOrCreate({
        where: { codigo: permiso.codigo },
        defaults: permiso,
      });
    }

    // Siempre hacer upsert de roles
    for (const r of ['admin', 'gerente', 'vendedor', 'produccion', 'compras']) {
      const [rol] = await Rol.findOrCreate({
        where: { nombre: r, empresa_id: null },
        defaults: { nombre: r, is_system: true, empresa_id: null },
      });

      const permisoCodigos = ROLE_PERMISOS[r] || [];
      for (const codigo of permisoCodigos) {
        await RolPermiso.findOrCreate({
          where: { rol_id: rol.id, permiso_codigo: codigo },
          defaults: { rol_id: rol.id, permiso_codigo: codigo },
        });
      }
    }

    logger.info('Permissions seeded/updated successfully');
    await fixMissingRolIds();
  } catch (err) {
    logger.error({ err }, 'Error seeding permissions');
  }
}
```

### Criterios de aceptación
- [ ] `gerente` es un role válido en `usuario_empresas.role`
- [ ] Wildcard `products.*` permite acceso a `products.ver`, `products.crear`, etc.
- [ ] `BYPASS_AUTH` en producción devuelve 500 error en vez de saltar permisos
- [ ] Nuevos permisos agregados al array `PERMISOS` se seedean en DBs existentes

---

## SDD-007 — Onboarding + Invitaciones E2E

### Objetivo
Completar el flujo de invitación (pendingInvite se guarda pero nunca se consume) y verificar el onboarding end-to-end.

### Modificaciones

#### `frontend/src/App.jsx`
Agregar consumo de `pendingInvite` después de que el usuario se carga:

```javascript
// Agregar después del useEffect que carga empresa context:
useEffect(() => {
  const token = localStorage.getItem('pendingInvite');
  if (token && usuario) {
    api.post(`/auth/accept-invite/${token}`)
      .then(() => {
        localStorage.removeItem('pendingInvite');
        loadEmpresaContext();
      })
      .catch(() => {
        localStorage.removeItem('pendingInvite');
      });
  }
}, [usuario]);
```

#### `frontend/src/App.jsx`
Agregar import de api:
```javascript
import api from '@/services/api'
```

### Verificación manual requerida

- [ ] **Onboarding completo**: Nuevo usuario se registra → onboarding → empresa + PV creados → redirige al POS
- [ ] **Invitación**: Admin invita → email llega → usuario sin cuenta hace clic → login/signup → redirige a app → invitación se acepta automáticamente → usuario ve el sistema
- [ ] **Invitación expirada**: Si el token expiró, mostrar mensaje claro
- [ ] **Usuario existente**: Usuario ya logueado acepta invitación → se agrega a la empresa automáticamente

### Verificar rutas backend
- `POST /auth/accept-invite/:token` — leer y verificar que asigna rol correcto
- `GET /empresas/mi-contexto` — leer y verificar que devuelve permisos después de aceptar

### Criterios de aceptación
- [ ] `pendingInvite` en localStorage es consumido después del login
- [ ] Invitación se acepta automáticamente sin intervención manual
- [ ] Después de aceptar, el usuario ve los módulos correspondientes a su rol
- [ ] El flujo de onboarding termina en el POS con permisos de admin

---

## SDD-008 — Bloqueo de Módulos No-Core

### Objetivo
Los módulos fuera de scope (Recetas, Producción, Clientes, Caja, Impuestos, Reportes, Órdenes de Compra) deben estar ocultos para usuarios normales. El owner (identificado por `auth0_sub` en `empresas.settings.owner_auth0_sub`) ve todo.

### Módulos permitidos (core)
- POS (`/pos`)
- Ventas (`/ventas`)
- Inventario (`/inventario`)
- Proveedores (`/proveedores`)
- Gastos Fijos (`/gastos`)
- Equipo (`/team`)
- Panel (`/panel`)
- Facturación AFIP (`/facturacion`)
- Suscripción (`/suscripcion`)

### Módulos bloqueados (non-core)
- Recetas (`/recetas`)
- Producción (`/produccion`)
- Clientes (`/clientes`)
- Caja (`/caja`)
- Impuestos (`/impuestos`)
- Reportes (`/reportes`)
- Órdenes de Compra (`/ordenes-compra`)

### Modificaciones

#### `frontend/src/components/app-sidebar.jsx`
Filtrar usando `enabled_modules` del `empresaActiva.settings`, con override para owner:

```javascript
// Obtener módulos habilitados
const empresaSettings = empresaActiva?.settings || {}
const enabledModules = empresaSettings.enabled_modules
const ownerAuth0Sub = empresaSettings.owner_auth0_sub
const isOwner = user?.sub === ownerAuth0Sub

// Mapear ruta → módulo
const routeToModule = {
  '/pos': 'pos',
  '/ventas': 'ventas',
  '/clientes': 'clientes',
  '/produccion': 'produccion',
  '/inventario': 'inventario',
  '/recetas': 'recetas',
  '/proveedores': 'proveedores',
  '/ordenes-compra': 'ordenes-compra',
  '/gastos': 'gastos',
  '/reportes': 'reportes',
  '/caja': 'caja',
  '/impuestos': 'impuestos',
  '/panel': 'panel',
  '/facturacion': 'facturacion',
  '/team': 'equipo',
  '/suscripcion': 'suscripcion',
}

// En el filtrado de navSections:
const visibleItems = section.items.filter(item => {
  const hasPermission = !item.permission || can(item.permission)
  if (!hasPermission) return false
  // Owner ve todo
  if (isOwner) return true
  // Si hay enabled_modules configurados, filtrar
  if (enabledModules && Array.isArray(enabledModules)) {
    const module = routeToModule[item.to]
    return module ? enabledModules.includes(module) : true
  }
  return true
})
```

#### `frontend/src/App.jsx`
Agregar guard en rutas para módulos bloqueados:

```javascript
// Componente RouteGuard
function RouteGuard({ children, requiredModule }) {
  const usuario = useStore(s => s.usuario)
  const empresaActiva = useStore(s => s.empresaActiva)
  const { user } = useAuth0()
  const { can } = usePermission()

  const empresaSettings = empresaActiva?.settings || {}
  const enabledModules = empresaSettings.enabled_modules
  const ownerAuth0Sub = empresaSettings.owner_auth0_sub
  const isOwner = user?.sub === ownerAuth0Sub

  if (isOwner) return children

  if (enabledModules && Array.isArray(enabledModules) && requiredModule) {
    if (!enabledModules.includes(requiredModule)) {
      return <Navigate to="/pos" replace />
    }
  }

  return children
}

// Envolver rutas bloqueadas:
<Route path="/recetas" element={
  <RouteGuard requiredModule="recetas"><Recipes /></RouteGuard>
} />
<Route path="/produccion" element={
  <RouteGuard requiredModule="produccion"><Production /></RouteGuard>
} />
// ... etc para cada módulo bloqueado
```

### Criterios de aceptación
- [ ] Usuario normal NO ve Recetas, Producción, Clientes, Caja, Impuestos, Reportes, Órdenes de Compra en el sidebar
- [ ] Usuario normal redirige a `/pos` si navega directamente a una ruta bloqueada
- [ ] Owner (identificado por `auth0_sub`) ve todos los módulos siempre
- [ ] Si `enabled_modules` no está configurado, todos los módulos habilitados por permisos son visibles

---

## SDD-009 — TiendaNube Webhook + Mapping

### Objetivo
Implementar el webhook de TiendaNube (actualmente vacío), agregar mapping de productos, y sincronización de stock.

### Database Migrations

#### Migration: `20260606-add-tiendanube-mapping.js`
```sql
CREATE TABLE tiendanube_mappings (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tiendanube_variant_id INTEGER NOT NULL,
  tiendanube_product_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(empresa_id, product_id),
  UNIQUE(empresa_id, tiendanube_variant_id)
);
```

#### Migration: `20260607-add-tiendanube-token-per-empresa.js`
```sql
-- Agregar empresa_id a settings donde key = 'tiendanube_access_token' y 'tiendanube_user_id'
-- Ya existe empresa_id en settings pero actualmente se guarda sin filtrar por empresa.
-- NO cambiar schema, solo asegurar que el service guarde con empresa_id correcta.
```

### Modelos nuevos

#### `backend/src/models/TiendanubeMapping.js`
```javascript
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TiendanubeMapping = sequelize.define('TiendanubeMapping', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  empresa_id: { type: DataTypes.INTEGER, allowNull: false },
  product_id: { type: DataTypes.INTEGER, allowNull: false },
  tiendanube_variant_id: { type: DataTypes.INTEGER, allowNull: false },
  tiendanube_product_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'tiendanube_mappings',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['empresa_id', 'product_id'] },
    { unique: true, fields: ['empresa_id', 'tiendanube_variant_id'] },
  ],
});

module.exports = TiendanubeMapping;
```

### Modificaciones

#### `backend/src/services/tiendanubeService.js`
- Asociar token a `empresa_id` (recibir `empresaId` como parámetro)
- Agregar métodos `updateVariantStock` y `processOrderCreated`

```javascript
const axios = require('axios');
const { Setting, Stock, Product, TiendanubeMapping, StockMovement } = require('../models');

class TiendaNubeService {
  constructor() {
    this.clientId = process.env.TIENDANUBE_CLIENT_ID;
    this.clientSecret = process.env.TIENDANUBE_CLIENT_SECRET;
  }

  async getAccessToken(code, empresaId) {
    try {
      const response = await axios.post('https://www.tiendanube.com/apps/authorize/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code: code
      });

      const { access_token, token_type, scope, user_id } = response.data;

      // Guardar token por empresa
      await Setting.upsert({ 
        key: 'tiendanube_access_token', 
        value: access_token, 
        empresa_id: empresaId 
      });
      await Setting.upsert({ 
        key: 'tiendanube_user_id', 
        value: user_id, 
        empresa_id: empresaId 
      });

      return { access_token, user_id };
    } catch (error) {
      console.error('Error al obtener token TiendaNube:', error.response?.data || error.message);
      throw new Error('No se pudo autenticar con TiendaNube');
    }
  }

  async getStoredToken(empresaId) {
    const tokenSetting = await Setting.findOne({ 
      where: { key: 'tiendanube_access_token', empresa_id: empresaId } 
    });
    const userIdSetting = await Setting.findOne({ 
      where: { key: 'tiendanube_user_id', empresa_id: empresaId } 
    });
    
    if (!tokenSetting || !userIdSetting) return null;

    return {
      access_token: tokenSetting.value,
      user_id: userIdSetting.value
    };
  }

  async getProducts(empresaId) {
    const credentials = await this.getStoredToken(empresaId);
    if (!credentials) throw new Error('TiendaNube no está vinculada');

    const response = await axios.get(
      `https://api.tiendanube.com/v1/${credentials.user_id}/products`, 
      {
        headers: {
          'Authentication': `bearer ${credentials.access_token}`,
          'User-Agent': `Nexar POS (${process.env.TIENDANUBE_CONTACT_EMAIL || 'contacto@tudominio.com'})`
        }
      }
    );

    return response.data;
  }

  async updateVariantStock(empresaId, variantId, quantity) {
    const credentials = await this.getStoredToken(empresaId);
    if (!credentials) throw new Error('TiendaNube no está vinculada');

    await axios.put(
      `https://api.tiendanube.com/v1/${credentials.user_id}/products/variants/${variantId}`,
      { stock: Math.max(0, quantity) },
      {
        headers: {
          'Authentication': `bearer ${credentials.access_token}`,
          'User-Agent': `Nexar POS (${process.env.TIENDANUBE_CONTACT_EMAIL || 'contacto@tudominio.com'})`,
          'Content-Type': 'application/json',
        }
      }
    );
  }

  async processOrderCreated(orderData, empresaId, puntoDeVentaId) {
    const sequelize = require('../config/database');
    const { Sale, SaleItem, Stock } = require('../models');
    
    const items = orderData.products || orderData.items || [];
    
    for (const item of items) {
      const variantId = item.product_variant_id || item.variant_id;
      if (!variantId) continue;

      const mapping = await TiendanubeMapping.findOne({
        where: { tiendanube_variant_id: variantId, empresa_id: empresaId }
      });

      if (mapping) {
        const stock = await Stock.findOne({
          where: { 
            product_id: mapping.product_id, 
            empresa_id: empresaId,
            punto_de_venta_id: puntoDeVentaId || null,
          }
        });

        if (stock) {
          const qty = item.quantity || 1;
          const oldQty = stock.quantity;
          const oldAvail = stock.available;
          
          await stock.update({
            quantity: Math.max(0, stock.quantity - qty),
            available: Math.max(0, stock.available - qty),
          });

          await StockMovement.create({
            empresa_id: empresaId,
            product_id: mapping.product_id,
            punto_de_venta_id: puntoDeVentaId || null,
            tipo: 'tiendanube_sale',
            referencia_id: `tn_order_${orderData.id}`,
            cantidad_anterior: oldQty,
            cantidad_nueva: stock.quantity,
            disponible_anterior: oldAvail,
            disponible_nuevo: stock.available,
            usuario_id: 'tiendanube',
          });
        }
      }
    }
  }
}

module.exports = new TiendaNubeService();
```

#### `backend/src/controllers/tiendanube.js`
Reemplazar `handleWebhook`:

```javascript
const handleWebhook = async (req, res) => {
  try {
    const event = req.headers['x-event'];
    const storeId = req.headers['x-store-id']; // o extraer de la URL
    const empresaId = req.empresaId || 1;

    if (event === 'order/created' || event === 'order/paid') {
      const orderData = req.body;
      await tiendanubeService.processOrderCreated(orderData, empresaId, req.puntoDeVentaId || null);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing TiendaNube webhook:', error);
    // Siempre responder 200 a TN para que no reintente
    res.status(200).send('OK');
  }
};
```

#### `backend/src/routes/tiendanube.js`
Agregar nuevas rutas:

```javascript
router.get('/products', async (req, res) => {
  try {
    const products = await tiendanubeService.getProducts(req.empresaId || 1);
    res.json({ ok: true, data: products });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/mapping', async (req, res) => {
  try {
    const { product_id, tiendanube_variant_id, tiendanube_product_id } = req.body;
    const mapping = await TiendanubeMapping.create({
      empresa_id: req.empresaId || 1,
      product_id,
      tiendanube_variant_id,
      tiendanube_product_id,
    });
    res.status(201).json({ ok: true, data: mapping });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/sync-stock', async (req, res) => {
  try {
    const { punto_de_venta_id } = req.body;
    const empresaId = req.empresaId || 1;
    
    const mappings = await TiendanubeMapping.findAll({ where: { empresa_id: empresaId } });
    const stockWhere = { empresa_id: empresaId };
    if (punto_de_venta_id) stockWhere.punto_de_venta_id = punto_de_venta_id;
    
    const stockEntries = await Stock.findAll({ where: stockWhere });
    
    let synced = 0;
    for (const stock of stockEntries) {
      const mapping = mappings.find(m => m.product_id === stock.product_id);
      if (mapping) {
        await tiendanubeService.updateVariantStock(empresaId, mapping.tiendanube_variant_id, stock.quantity);
        synced++;
      }
    }
    
    res.json({ ok: true, synced });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

### Criterios de aceptación
- [ ] Token de TiendaNube se guarda asociado a `empresa_id`
- [ ] `POST /api/tiendanube/products` lista productos de la tienda
- [ ] `POST /api/tiendanube/mapping` vincula producto local con variante TN
- [ ] `POST /api/tiendanube/sync-stock` sincroniza stock hacia TN
- [ ] Webhook `order/created` descuenta stock local del producto mapeado
- [ ] Webhook responde siempre 200 para evitar reintentos de TN

---

## Testing Plan

### Configuración de tests (base)
```bash
cd backend
npm install --save-dev jest supertest
```

### Tests a implementar en SDD-002

#### `backend/src/__tests__/sales.test.js`
```javascript
const request = require('supertest');
const app = require('../app'); // asumiendo que app exporta express

describe('POST /api/sales', () => {
  it('debe descontar stock al crear una venta', async () => {
    // Setup: crear producto con stock=10
    // POST /api/sales con quantity=3
    // GET /api/stock → verificar stock=7
  });

  it('debe rechazar venta con stock insuficiente', async () => {
    // Setup: crear producto con stock=2
    // POST /api/sales con quantity=5
    // Esperar 400 + mensaje error
  });
});

describe('PUT /api/sales/:id/void', () => {
  it('debe restaurar stock al anular venta', async () => {
    // Setup: crear producto con stock=10, crear venta con qty=3
    // PUT /sales/:id/void
    // GET /api/stock → verificar stock=10 otra vez
  });
});
```

#### `backend/src/__tests__/permissions.test.js`
```javascript
describe('checkPermission middleware', () => {
  it('debe permitir acceso con wildcard products.*', async () => {
    // Setup: req.usuarioPermisos = ['products.*']
    // Llamar middleware con codigo='products.ver'
    // Esperar next() llamado
  });

  it('debe denegar acceso sin permiso', async () => {
    // Setup: req.usuarioPermisos = ['products.ver']
    // Llamar middleware con codigo='stock.ver'
    // Esperar 403
  });
});
```

---

## Resumen de Migraciones

| Archivo | Tabla/Cambio | SDD |
|---------|-------------|-----|
| `20260601-add-stock-movements.js` | `stock_movements` (nueva) | SDD-002 |
| `20260602-add-voided-status-to-sales.js` | `sales.status`, `sales.voided_at`, `sales.voided_by` | SDD-002 |
| `20260603-add-tiendanube-variant-id.js` | `products.tiendanube_variant_id` | SDD-003 |
| `20260604-add-pv-to-fixed-expenses.js` | `fixed_expenses.punto_de_venta_id` | SDD-004 |
| `20260605-add-gerente-to-usuario-empresas-role.js` | `usuario_empresas.role` → VARCHAR | SDD-006 |
| `20260606-add-tiendanube-mapping.js` | `tiendanube_mappings` (nueva) | SDD-009 |
| `20260607-add-tiendanube-token-per-empresa.js` | (solo código, sin schema) | SDD-009 |

## Resumen de Modelos Nuevos

| Modelo | Archivo | SDD |
|--------|---------|-----|
| `StockMovement` | `backend/src/models/StockMovement.js` | SDD-002 |
| `TiendanubeMapping` | `backend/src/models/TiendanubeMapping.js` | SDD-009 |

## Orden de implementación recomendado

1. **SDD-001** → Git setup, branches, test infra
2. **SDD-002** → Fix crítico de stock + soft-void + auditoría
3. **SDD-003** → Inventario mejoras (paralelizable con SDD-004,005,006)
4. **SDD-004** → Gastos fijos dinámicos
5. **SDD-005** → Proveedores verificación
6. **SDD-006** → Permisos + ENUM gerente
7. **SDD-007** → Onboarding + invitaciones
8. **SDD-008** → Bloqueo de módulos
9. **SDD-009** → TiendaNube (depende de SDD-002 y SDD-003)
