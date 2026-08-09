# Auditoría de aislamiento entre empresas cliente

**Fecha:** 30 de julio de 2026
**Alcance:** 16 archivos de rutas y 12 services de `apps/api/src`
**Estado:** cerrada. 20 endpoints corregidos, 119 tests en verde.

---

## Qué se auditó y por qué

Favalio es un ERP multi-empresa: todas las empresas cliente comparten base de
datos y servidor, y se separan por la columna `empresa_id`. Si una consulta se
olvida de ese filtro, una empresa ve —o modifica— los datos de otra.

La causa estructural es que `checkPermission(codigo)` verifica que el usuario
tenga el permiso **en su empresa activa** (`req.empresaId`). Lo que no hace, y
no puede hacer porque no conoce la ruta, es verificar que el recurso
identificado por el `:id` de la URL pertenezca a esa empresa. Las rutas hacían
`Model.findByPk(req.params.id)` directo.

---

## Causas raíz

Antes de la tabla, las tres cosas que hacían que el problema se repitiera:

### 1. `req.empresaId` dejaba de ser confiable en silencio

`loadEmpresaContext` no falla el request cuando no puede resolver la empresa:
loguea y llama `next()`. Las rutas compensaban con `req.empresaId || 1`,
presente en ~50 lugares, más 31 defaults `empresaId = 1` en los services.

Efecto: ante un contexto no resuelto, el request operaba sobre la **empresa 1**
—en producción, un cliente real— tanto para leer como para escribir.

**Corregido:** middleware `requireEmpresa`, que corta con 403 en vez de dejar
que la ruta elija una empresa. Los ~80 fallbacks eliminados.

### 2. La clave primaria de `settings` no incluía la empresa

`settings` se creó con `key` como única PK. Solo puede existir **una fila por
clave en toda la base**.

`routes/afip.js` hacía `Setting.upsert({ key: 'afip_cert', value: cert })` sin
`empresa_id`. La segunda empresa que cargaba su certificado pisaba el de la
primera, y desde ese momento las facturas de la primera se emitían firmadas con
el certificado y el CUIT de la segunda.

**Corregido:** migración `20260730-settings-pk-por-empresa`, PK compuesta
`(key, empresa_id)`.

### 3. Cachés singleton compartidas entre empresas

`afipAuth` guardaba el ticket WSAA en `this.taCache` sobre una instancia única.
`afipService` cacheaba un solo cliente SOAP, y como la URL del WSDL depende de
si la empresa está en homologación o producción, la primera empresa en facturar
fijaba el entorno para todas.

**Corregido:** `Map` por empresa y por entorno respectivamente.

---

## Cobertura endpoint por endpoint

Leyenda: **✅** corregido · **✓** ya estaba bien · **—** no aplica

### `routes/empresas.js`

| Endpoint | Estado | Exposición |
|---|---|---|
| `POST /:empresaId/invitar` | ✅ | **Acceso a otra empresa.** Se invitaba al email indicado a la empresa del `:empresaId` sin verificar que fuera la propia: bastaba poner el id de otra empresa y el mail propio |
| `PUT /usuarios/:id` | ✅ | Cambiar rol o desactivar a cualquier miembro de cualquier empresa |
| `GET /:id` | ✅ | Leer la empresa completa de otro cliente, incluidos `settings` |
| `PUT /:id`, `DELETE /:id` | ✅ | Editar o desactivar la empresa de otro cliente |
| `PUT /puntos-de-venta/:id` | ✅ | Editar sucursales ajenas |
| `DELETE /puntos-de-venta/:id` | ✅ | Desactivar sucursales ajenas |
| `DELETE /invitaciones/:id` | ✅ | Revocar invitaciones ajenas |
| `POST /onboarding` | — | Crea la empresa; no puede exigirla |
| `GET /mi-contexto` | ✓ | Filtra por `usuario_id` |
| `PUT /cambiar-empresa/:id` | ✓ | Valida membresía activa |

### `routes/customers.js`

| Endpoint | Estado | Exposición |
|---|---|---|
| `GET /summary` | ✅ | **La fuga más directa.** SQL crudo sin cláusula de empresa: sumaba ventas, pagos y movimientos de proveedores de toda la base. No hacía falta enumerar ids |
| `GET /:id` | ✅ | Leer el cliente de otra empresa |
| `PUT /:id`, `DELETE /:id` | ✅ | Editar o desactivar clientes ajenos |
| `GET /:id/debt` | ✅ | Deuda y aging ajenos |
| `GET /:id/payments` | ✅ | Historial de pagos ajeno |
| `GET /:id/sales` | ✅ | Historial de ventas ajeno |
| `POST /:id/payments` | ✅ | Registrar pagos sobre clientes ajenos |
| `GET /`, `GET /ranking`, `POST /` | ✓ | Ya filtraban |

### `routes/sales.js` y `routes/production.js`

| Endpoint | Estado | Exposición |
|---|---|---|
| `PUT /sales/:id/void` | ✅ | Anular la venta de otra empresa. La anulación **devuelve stock**: además de leer, alteraba su inventario |
| `POST /production/:id/void` | ✅ | Ídem, revirtiendo stock de insumos |
| `GET /production/:id` | ✅ | Leer órdenes ajenas |
| `POST /production` | ✅ | `product_id` sin validar: `calculateOrderCosts` lee la receta de ese producto y guarda los costos de sus insumos en `cost_snapshot`, que vuelve en la respuesta |

### `routes/products.js`

| Endpoint | Estado | Exposición |
|---|---|---|
| `POST /:id/recipe` | ✅ | Ni el producto elaborado ni los `ingredient_product_id` se validaban. Se podía armar una receta con productos ajenos como insumos, y el costo calculado revelaba sus costos |
| `GET /:id` | ✅ | Leer productos ajenos |
| `PUT /:id`, `DELETE /:id` | ✅ | Editar o desactivar productos ajenos |

### `routes/general.js`, `routes/stock.js`, `routes/cashflow.js`

| Endpoint | Estado | Exposición |
|---|---|---|
| `PUT /stock/:id` | ✅ | Modificar stock ajeno |
| `PUT /expenses/:id` | ✅ | Modificar gastos fijos ajenos |
| `POST /stock` | ✅ | `punto_de_venta_id` sin validar |
| `DELETE /cashflow/entries/:id` | ✅ | Borrar movimientos de caja ajenos |
| `GET /stock`, `/brands`, `/expenses`, `/settings` | ✅ | Filtraban con `empresa_id = X OR empresa_id IS NULL`. La rama del OR era código muerto (`empresa_id` es `NOT NULL` en las 22 tablas) pero se volvería una fuga si alguien hace la columna nullable |

### `routes/afip.js` y sus services

| Punto | Estado | Exposición |
|---|---|---|
| PK de `settings` | ✅ | **Lo más grave.** Una sola fila por clave en toda la base: CUIT, certificado, clave privada y entorno compartidos. Las facturas de una empresa salían con la identidad fiscal de otra |
| `afipAuth.taCache` | ✅ | Ticket WSAA compartido entre empresas |
| `afipService.wsfeClient` | ✅ | La primera empresa en facturar fijaba homologación/producción para todas |
| `getAuthParam` | ✅ | Leía `afip_cuit` sin `empresa_id` |
| `createVoucher` | ✅ | `Setting.findAll()` sin filtro: `tax_condition` podía salir de otra empresa, cambiando si el IVA se discrimina o no |
| `POST /setup` | ✅ | Además: se validan cert y key como PEM antes de guardar, se valida `environment`, un setup parcial ya no borra el certificado cargado, y se invalida el ticket WSAA cacheado |

### Ya estaban correctos

`routes/suppliers.js` (14 queries, todas con `where: { id, empresa_id }`),
`routes/taxes.js`, `routes/reports.js`, `routes/import.js`,
`services/purchaseService.js`, `services/tiendanubeService.js`,
`routes/dashboard.js`.

---

## Cómo se evita que vuelva

### Helpers

`src/utils/tenantScope.js`:

- `findScoped(Model, id, empresaId, opciones)` — reemplaza a `findByPk`
- `findScopedOrFail(...)` — lanza un error con `status: 404`
- `scoped(where, empresaId)` — fusiona el filtro en consultas de listado
- `assertEmpresaId(empresaId)` — falla ruidosamente en vez de degradar

Dos decisiones que conviene entender:

**Se responde 404 y no 403** cuando el recurso es de otra empresa. Un 403
confirmaría que ese id existe en algún lado, lo que permite mapear la base
ajena enumerando ids. El 404 no distingue "no existe" de "no es tuyo".

**`scoped()` pisa el `empresa_id` que venga en el `where`.** Si no lo hiciera,
mandar `empresa_id` en el body permitiría elegir sobre qué empresa se consulta.

### Guardias automáticos

`src/tests/aislamientoEmpresas.test.js` lee el código fuente y falla si los
patrones peligrosos reaparecen: fallbacks a la empresa 1, `findByPk` con id del
cliente, filtros con `empresa_id IS NULL`, lecturas de `Setting` sin empresa en
AFIP, `taCache` como objeto único, routers montados sin `authEmpresa`.

Son groseros a propósito: un análisis exacto exigiría un parser, y lo que se
busca es que el error sea **visible en la revisión**. Los casos legítimos van en
una lista de excepciones con su motivo escrito; esa lista es lo que hay que
mirar en un code review.

Verificado que fallan de verdad: inyectando `req.empresaId || 1` en
`routes/taxes.js`, la suite pasa a 1 failed / 118 passed e indica archivo y
línea.

---

## Lo que queda pendiente

### La clave privada de AFIP se guarda en texto plano

Cerrar el cruce entre empresas era lo urgente. Cifrarla en reposo exige decidir
dónde vive la clave de cifrado —variable de entorno, KMS, Vault— y es trabajo
aparte. Hoy, cualquiera con acceso de lectura a la base tiene las claves
fiscales de todos los clientes.

### La migración hay que correrla

`20260730-settings-pk-por-empresa` corre sola al arrancar el contenedor, pero
conviene verificar en Neon que la PK quedó compuesta:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'settings'::regclass AND contype = 'p';
-- esperado: PRIMARY KEY (key, empresa_id)
```

Las filas existentes conservan su `empresa_id` (default 1), con lo cual la
configuración actual queda asignada a la empresa 1. Si Comprafit no es la
empresa 1, hay que reasignarlas a mano.

### Los tests no tocan la base

Los guardias son estáticos y los unitarios usan modelos falsos. Falta el test
de integración real —crear dos empresas, autenticar como una, pedir el recurso
de la otra, esperar 404— que requiere una base de test y fixtures. Es el
siguiente paso natural, y el que da la garantía más fuerte.

### Frentes 2 y 3 sin empezar

Este documento cubre solo el Frente 1 de `ANALISIS.md`. Siguen abiertos la
verificación de la lógica financiera (0% de cobertura sobre ~9.500 líneas) y el
estado real de la integración AFIP.

---

## Adenda: ocho endpoints que esta auditoría no encontró

**31 de julio de 2026.** Aparecieron revisando los bloques `catch` de cada ruta,
no buscando fugas. Son de la misma clase que los 20 de arriba.

**En `products.js`** — consultaban por `product_id` sin resolver antes el
producto con scoping:

- `GET /:id/cost-history` — la evolución de costos de un producto ajeno.
- `GET /:id/recipe` — la fórmula: qué insumos lleva y en qué proporción.
- `DELETE /:id/recipe` — **borrar** la receta de otra empresa cliente.

`POST /:id/recipe` sí tenía el chequeo. Se había corregido una de las cuatro.

**En `empresas.js`** — rutas que toman el id de la URL en vez del contexto, sin
`requireEmpresaPropia`:

- `GET /:empresaId/puntos-de-venta`
- `POST /:empresaId/puntos-de-venta`
- `GET /:empresaId/invitaciones` (emails de los invitados)
- `GET /:empresaId/usuarios` (nombres y emails del equipo)
- `POST /:empresaId/usuarios` — **agregar un usuario, incluido uno mismo, al
  equipo de otra empresa, con el rol que se pida.**

`checkPermission` verifica el permiso en la empresa **activa**, no en la de la
URL. El middleware existía y estaba puesto en dos rutas.

### Por qué no las encontró

Las guardias de este frente buscan `findByPk` con id del cliente y fallbacks a
`empresa_id: 1`. Ninguno de estos ocho casos usa esos patrones: los de
`products.js` usan `where: { product_id: ... }`, y los de `empresas.js` filtran
correctamente por `empresa_id` — solo que por el de la URL.

Se agregaron dos guardias nuevas en `src/tests/observabilidad.test.js` que
cubren exactamente esas dos formas, verificadas contra la versión anterior del
código: detectan los 7 y los 5 casos respectivamente.

**La lección se sostiene: los guardias estáticos atrapan la repetición de un
patrón conocido, no la clase entera del problema.** Sigue faltando el test de
integración contra base real.
