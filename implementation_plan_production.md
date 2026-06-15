# Plan de Implementación — Sistema listo para Cliente

> **Objetivo**: Dejar 100% funcional y probado: Inventario, POS + Facturación, Pedidos/Proveedores, Gastos Fijos, Usuarios/Permisos/Onboarding e integración TiendaNube. El resto de módulos quedan bloqueados para usuarios que no sean el owner.

---

## Hallazgos Críticos (Bugs encontrados)

> [!CAUTION]
> ### 🔴 BUG: El POS NO descuenta stock al registrar una venta
> En [sales.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/routes/sales.js#L82-L113), el `POST /api/sales` crea la venta y sus items pero **nunca actualiza la tabla `stock`**. Cada venta debería descontar `quantity` y `available` del stock del punto de venta activo. Esto es fundamental para que el inventario sea confiable.

> [!CAUTION]
> ### 🔴 BUG: Webhook de TiendaNube está vacío (TODO sin implementar)
> En [tiendanube.js controller](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/controllers/tiendanube.js#L40-L48), el `handleWebhook` solo hace `console.log` y devuelve `200 OK` sin procesar ningún evento. No hay lógica para descontar stock cuando llega un `order/created`.

> [!WARNING]
> ### 🟡 Gastos Fijos hardcodeados a "GF1/Ortiz de Ocampo" y "GF2/25 de Mayo"
> En [Expenses.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Expenses.jsx#L98-L107), los nombres de sucursales están hardcodeados. Para un nuevo cliente, los gastos fijos deben vincularse a los puntos de venta reales de la empresa, no a sucursales específicas.

> [!WARNING]
> ### 🟡 FixedExpense no tiene punto_de_venta_id
> El modelo [FixedExpense.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/models/FixedExpense.js) usa un campo `group` con strings arbitrarios ("gf1", "gf2"). Debería vincularse al `punto_de_venta_id` para ser dinámico por sucursal.

> [!WARNING]
> ### 🟡 UsuarioEmpresa ENUM no incluye "gerente"
> En [UsuarioEmpresa.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/models/UsuarioEmpresa.js#L19), el campo `role` tiene ENUM `('admin', 'vendedor', 'produccion', 'compras')` pero en [seedPermissions.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/seedPermissions.js#L74) existe el rol "gerente" con permisos definidos. Hay una inconsistencia.

> [!WARNING]
> ### 🟡 TiendaNube Service guarda tokens globalmente (sin empresa_id)
> En [tiendanubeService.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/services/tiendanubeService.js#L23-L24), el token se guarda como Setting global. En un sistema multi-tenant, debería asociarse a la empresa.

> [!NOTE]
> ### 🔵 Solo existe rama `main` en Git
> No hay ramas `develop`, `staging` ni `test`. No hay protección de ramas ni flujo de CI/CD configurado.

---

## Open Questions

> [!IMPORTANT]
> 1. **¿Tenés acceso a las credenciales de TiendaNube (Client ID y Client Secret) del cliente?** Necesito saber si ya creaste la app en el panel de partners de TiendaNube o si hay que hacerlo.
> 2. **¿El cliente tiene más de una sucursal/punto de venta?** Esto afecta cómo reestructuro los gastos fijos.
> 3. **¿Tu user de Auth0 (el admin/owner) ya está creado en la DB?** ¿Lo tenemos identificable por email o auth0_sub para protegerlo como superadmin?
> 4. **¿Usás GitHub o GitLab?** Para configurar la protección de ramas y el workflow.
> 5. **¿Querés que al anular una venta se devuelva el stock?** (Actualmente no lo hace porque ni siquiera descuenta.)
> 6. **¿Los módulos bloqueados (Recetas, Producción, Clientes, Caja, Impuestos, Reportes, Órdenes de Compra) deben ser completamente invisibles para el cliente, o visibles pero deshabilitados con un mensaje tipo "Proximamente"?**

---

## Proposed Changes

Las fases están ordenadas por dependencia. Cada fase es un PR independiente que se mergea a `develop`.

---

### Fase 0 — Organización Git y Branching Strategy

#### Configuración de ramas

```
main ─────── producción (desplegado)
  └── develop ─── desarrollo activo
        ├── feature/* ─── SDDs individuales
        └── hotfix/* ─── fixes urgentes
```

**Flujo de trabajo:**
1. Crear rama `develop` desde `main`
2. Cada SDD se trabaja en `feature/SDD-XXX-nombre` desde `develop`
3. PR → `develop` con review
4. Cuando se acumula un release estable → merge `develop` → `main`
5. Tags versionados: `v1.0.0`, `v1.1.0`, etc.
6. Configurar protección en `main`: solo merge vía PR, no push directo

**Archivos a crear:**
- `.github/pull_request_template.md` — template de PR
- Actualizar `.gitignore` si hace falta (verificar que `.env` está excluido)

---

### Fase 1 — Inventario de Productos (Estabilización)

**Estado actual:** Funcional pero sin descuento de stock desde POS. El CRUD de productos, búsqueda, marcas, y stock multi-sucursal están implementados.

**Mejoras necesarias:**

#### [MODIFY] [Product.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/models/Product.js)
- Agregar campo `tiendanube_variant_id` (INTEGER, nullable) para vincular con TiendaNube

#### [MODIFY] [Inventory.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Inventory.jsx)
- Mostrar indicador visual de "stock bajo" (cuando `quantity <= min_stock`)
- Asegurar que al editar stock se actualicen ambos campos (`quantity` y `available`)
- Verificar que la búsqueda y filtrado funcionen correctamente con el scope de empresa

#### [MODIFY] [general.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/routes/general.js)
- En `PUT /api/stock/:id`, validar que no se pueda setear stock negativo
- Agregar log/audit trail básico cuando se modifica stock manualmente

---

### Fase 2 — Punto de Venta + Descuento de Stock (Crítico)

**Estado actual:** El POS funciona para registrar ventas pero NO descuenta stock. Este es el fix más crítico.

#### [MODIFY] [sales.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/routes/sales.js#L82-L113)
**En `POST /api/sales` agregar descuento de stock dentro de la transacción:**
```javascript
// Después de crear SaleItems, descontar stock
for (const item of items) {
  if (item.product_id) {
    const stockWhere = { 
      product_id: item.product_id, 
      empresa_id: req.empresaId || 1 
    };
    if (req.puntoDeVentaId) {
      stockWhere.punto_de_venta_id = req.puntoDeVentaId;
    }
    const stock = await Stock.findOne({ where: stockWhere, transaction: t });
    if (stock) {
      const qty = item.quantity || item.qty || 1;
      await stock.update({
        quantity: Math.max(0, stock.quantity - qty),
        available: Math.max(0, stock.available - qty),
      }, { transaction: t });
    }
  }
}
```

**En `DELETE /api/sales/:id` (anulación), devolver stock:**
```javascript
// Antes de destruir SaleItems, recuperar las cantidades
const saleItems = await SaleItem.findAll({ where: { sale_id: req.params.id }, transaction: t });
const sale = await Sale.findByPk(req.params.id, { transaction: t });
for (const item of saleItems) {
  if (item.product_id) {
    const stock = await Stock.findOne({
      where: { product_id: item.product_id, empresa_id: sale.empresa_id, punto_de_venta_id: sale.punto_de_venta_id },
      transaction: t,
    });
    if (stock) {
      await stock.update({
        quantity: stock.quantity + item.quantity,
        available: stock.available + item.quantity,
      }, { transaction: t });
    }
  }
}
```

#### [MODIFY] [Billing.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Billing.jsx)
- Mostrar stock disponible de cada producto en la lista del POS
- Deshabilitar botón "+" si stock = 0
- Mostrar alerta visual si stock bajo al agregar al carrito
- Después de registrar venta exitosa, refrescar lista de productos (`initialize()`)

---

### Fase 3 — Gastos Fijos Dinámicos

**Estado actual:** Hardcodeado a GF1/GF2 con nombres de sucursales específicas.

#### [MODIFY] [FixedExpense.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/models/FixedExpense.js)
- Agregar campo `punto_de_venta_id` (INTEGER, nullable, FK a puntos_de_venta)
- Mantener `group` por retrocompatibilidad pero deprecarlo

#### [MODIFY] [general.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/routes/general.js) (sección expenses)
- `GET /api/expenses`: aceptar query param `punto_de_venta_id` para filtrar
- `POST /api/expenses`: aceptar `punto_de_venta_id` además de `group`

#### [MODIFY] [Expenses.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Expenses.jsx)
- Reemplazar los labels hardcodeados "Ortiz de Ocampo" / "25 de Mayo" por los nombres reales de los puntos de venta de `empresaActiva.puntosDeVenta`
- El selector "Sucursal/Grupo" al crear gasto debe mostrar los PV reales
- Si hay más de 2 PV, soportar N columnas/tabs

---

### Fase 4 — Pedidos y Proveedores (Verificación)

**Estado actual:** El módulo de proveedores tiene un CRUD completo con cuentas corrientes, pedidos, movimientos y documentos. Necesita verificación de que funciona correctamente en contexto multi-tenant.

#### [MODIFY] [suppliers.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/routes/suppliers.js)
- Verificar que todos los queries filtren por `empresa_id`
- Verificar que las cuentas corrientes (pagos, adelantos, saldos) calculen correctamente
- Verificar que el armado de pedidos por marca funcione

#### [MODIFY] [Orders.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Orders.jsx)
- Testing funcional: crear proveedor, registrar movimiento, generar pedido
- Verificar la exportación a WhatsApp

---

### Fase 5 — Usuarios, Permisos y Onboarding

#### [MODIFY] [UsuarioEmpresa.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/models/UsuarioEmpresa.js#L19)
- Agregar `'gerente'` al ENUM de `role` para alinearlo con los permisos definidos en seedPermissions

#### [MODIFY] [seedPermissions.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/seedPermissions.js)
- Revisar que los permisos se siembran correctamente cuando `permisosExistentes > 0` (actualmente solo se seedean si es 0, no se actualizan permisos nuevos)
- Agregar lógica de upsert para que nuevos permisos se agreguen sin perder los existentes

#### [MODIFY] [checkPermission.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/middleware/checkPermission.js)
- Agregar soporte para permisos con wildcard: si el usuario tiene `products.*`, cualquier `products.xxx` pasa
- Esto simplifica el admin que debería tener acceso total

#### Verificar flujo de onboarding:
- [Onboarding.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Onboarding.jsx): el flujo existe y parece funcional
- [empresas.js (onboarding)](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/routes/empresas.js#L12-L96): crea empresa, PV, usuario_empresa, suscripción y envía email
- **Verificar**: que después del onboarding el usuario sea redirigido al POS y tenga todos los permisos de admin
- **Verificar**: que el flujo de invitación por email funcione end-to-end (invitar → email → click link → login/signup → aceptar → acceso)

#### [MODIFY] [App.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/App.jsx)
- Después de login, si hay `pendingInvite` en localStorage, hacer el accept-invite automáticamente
- Actualmente el código guarda `pendingInvite` (línea 68) pero **nunca lo consume**

#### [NEW] Lógica de aceptación automática de invitación
- En `App.jsx` o en un hook dedicado, después de que `usuario` se carga:
  ```javascript
  useEffect(() => {
    const token = localStorage.getItem('pendingInvite');
    if (token && usuario) {
      api.post(`/auth/accept-invite/${token}`)
        .then(() => { localStorage.removeItem('pendingInvite'); loadEmpresaContext(); })
        .catch(() => localStorage.removeItem('pendingInvite'));
    }
  }, [usuario]);
  ```

---

### Fase 6 — Bloqueo de Módulos No-Core

**Objetivo:** Los módulos que no están en scope (Recetas, Producción, Clientes, Caja, Impuestos, Reportes, Órdenes de Compra) deben estar bloqueados para todos los usuarios excepto tu user (superadmin/owner).

#### [MODIFY] [app-sidebar.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/components/app-sidebar.jsx)
- Agregar concepto de "módulo habilitado" vs "módulo disponible"
- Los módulos bloqueados no aparecen en el sidebar para usuarios normales
- Para el superadmin, todos los módulos son visibles

#### [MODIFY] [App.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/App.jsx)
- Agregar guard a las rutas de módulos bloqueados
- Si un usuario navega directamente a `/produccion`, redirigir a `/pos`

#### Implementación propuesta:
- En la tabla `empresas.settings` (JSONB), agregar un campo `enabled_modules`:
  ```json
  {
    "enabled_modules": ["pos", "inventario", "proveedores", "gastos", "equipo", "config"],
    "owner_auth0_sub": "auth0|xxxxxxx"
  }
  ```
- El sidebar filtra según `enabled_modules` + permiso del usuario
- El owner (identificado por `auth0_sub`) ve todo siempre

---

### Fase 7 — Integración TiendaNube (Descuento de Stock)

**Estado actual:** OAuth flow parcialmente implementado. Webhook vacío. No hay mapping producto ↔ variante TiendaNube.

#### [MODIFY] [tiendanubeService.js](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/services/tiendanubeService.js)
- Asociar token a `empresa_id` en lugar de guardar como Setting global
- Agregar método `updateVariantStock(variantId, quantity)` para sincronizar stock hacia TiendaNube
- Agregar método `processOrderCreated(orderData)` para descontar stock local cuando TiendaNube notifica una orden

#### [MODIFY] [tiendanube.js controller](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/controllers/tiendanube.js#L40-L48)
Implementar `handleWebhook`:
```javascript
const handleWebhook = async (req, res) => {
  const event = req.headers['x-event'];
  
  if (event === 'order/created' || event === 'order/paid') {
    const orderData = req.body;
    // 1. Obtener items de la orden
    // 2. Para cada item, buscar producto local por tiendanube_variant_id
    // 3. Descontar stock del punto de venta configurado
    await tiendanubeService.processOrderCreated(orderData);
  }
  
  res.status(200).send('OK');
};
```

#### [NEW] Endpoint para mapear productos locales con variantes de TiendaNube
- `GET /api/tiendanube/products` — lista productos de la tienda TN
- `POST /api/tiendanube/mapping` — vincula `product.id` local con `variant_id` de TN
- `POST /api/tiendanube/sync-stock` — sincroniza stock actual hacia TiendaNube

#### [MODIFY] [Inventory.jsx](file:///c:/Users/renev/Documents/sistema-de-facturacion/frontend/src/pages/Inventory.jsx) o nueva sección en Settings
- UI para vincular productos locales con productos de TiendaNube
- Botón "Sincronizar stock con TiendaNube"
- Indicador de estado de conexión con TiendaNube

#### [MODIFY] [tiendanube.js routes](file:///c:/Users/renev/Documents/sistema-de-facturacion/backend/src/routes/tiendanube.js)
- Agregar autenticación al webhook (verificar firma HMAC si TN lo soporta)
- Agregar las nuevas rutas de mapping y sync

---

## Orden de Ejecución (SDDs)

| # | SDD | Fase | Prioridad | Dependencias |
|---|-----|------|-----------|-------------|
| 1 | SDD-001 | Git Setup | 🔴 Alta | — |
| 2 | SDD-002 | Fix descuento stock en POS | 🔴 Crítica | SDD-001 |
| 3 | SDD-003 | Inventario mejoras | 🟡 Media | SDD-001 |
| 4 | SDD-004 | Gastos fijos dinámicos | 🟡 Media | SDD-001 |
| 5 | SDD-005 | Proveedores verificación | 🟡 Media | SDD-001 |
| 6 | SDD-006 | Permisos + ENUM gerente | 🟡 Media | SDD-001 |
| 7 | SDD-007 | Onboarding + Invitaciones E2E | 🟡 Media | SDD-006 |
| 8 | SDD-008 | Bloqueo módulos no-core | 🟡 Media | SDD-006 |
| 9 | SDD-009 | TiendaNube webhook + mapping | 🔵 Baja | SDD-002, SDD-003 |

---

## Verification Plan

### Automated Tests
```bash
# No hay tests unitarios actualmente. Propongo agregar tests básicos para las rutas críticas:
# 1. Test de descuento de stock al crear venta
# 2. Test de devolución de stock al anular venta
# 3. Test de permisos (usuario sin permiso → 403)
# 4. Test de onboarding (crear empresa → obtener contexto)
```

### Manual Verification
- **POS completo**: Crear producto → cargar stock → vender → verificar que stock se redujo en DB
- **Onboarding**: Nuevo usuario se registra → completa onboarding → accede al sistema → ve solo módulos habilitados
- **Invitación**: Admin invita → email llega → usuario acepta → accede con rol correcto
- **Permisos**: Vendedor no puede acceder a configuración ni ver proveedores
- **TiendaNube**: Conectar → mapear producto → venta en TN → webhook → stock se reduce → stock en TN se actualiza
- **Gastos**: Crear gastos asociados a cada PV → ver totales correctos
- **Git**: Verificar que ramas main y develop están protegidas, PRs funcionan

### Smoke Test del Cliente
1. Cliente se registra (Auth0)
2. Completa onboarding (empresa + sucursal)
3. Carga productos (manual o masivo)
4. Carga stock
5. Realiza una venta en POS
6. Verifica que stock se descontó
7. Ve historial de ventas
8. Carga gastos fijos
9. Invita a un vendedor
10. Vendedor accede y solo ve POS + Ventas
