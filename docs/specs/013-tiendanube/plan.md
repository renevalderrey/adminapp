# Implementation Plan: TiendaNube — pantalla nueva completa

**Spec**: [spec.md](./spec.md) · **Rama**: `013-tiendanube`
**Escrito**: 5 de agosto de 2026

---

## Summary

Se levanta una integración que **no funciona en ninguno de sus dos extremos** y
recién después se le dibuja la pantalla. El OAuth gana un `state` opaco de un
solo uso guardado en una tabla propia; el webhook recupera el cuerpo crudo
moviendo el montaje del router público **arriba** del `express.json()` global, lo
que de paso lo saca del rate limiter pensado para el navegador; y el descuento
por pedido pasa a ser atómico con su idempotencia sostenida por una tabla nueva,
`tiendanube_pedidos`, **y no por el índice único sobre `stock_movements` que la
spec pide, porque ése rompería toda venta de más de una línea** (hallazgo 1 de
este plan, el más caro). La vinculación deja de vivir en dos filas de `settings`
y pasa a `tiendanube_tiendas`, con la sucursal designada, el `user_id` único a
nivel base y el estado de la última comunicación — **el token se queda en
`settings`**, para no agregar un lugar nuevo donde esté en claro. La
sincronización pasa a ser una cola de una fila por variante, drenada dentro del
proceso y con una reconciliación diaria de respaldo colgada del cron externo que
ya existe. `controllers/` desaparece: es el único directorio del servidor que
**ninguna de las cinco guardias estáticas mira**, y por eso el `create` sin
validar del hallazgo 3 pasó inadvertido. **Hay dos migraciones**, y una de ellas
mueve datos.

---

## Technical Context

### Qué existe hoy, y qué le pasa a cada pieza

Relevado archivo por archivo. **Nada se conserva por estar.**

| Pieza | Dónde | Veredicto | Por qué |
|---|---|---|---|
| `models/TiendanubeMapping.js` + `20260606-add-tiendanube-mapping.js` | — | **Se conserva, con dos columnas ensanchadas** | Los dos índices únicos, las dos FK con `ON DELETE CASCADE` y el bug documentado de `addConstraint` quedan intactos. Lo único que cambia es `INTEGER → BIGINT` en los dos ids de TiendaNube. Ver la decisión 12 |
| La separación en dos routers | `routes/tiendanube.js:26-51`, `server.js:344-346` | **Se conserva** | Es la corrección de un defecto anterior, está documentada y `permisosDeRutas.test.js:81-85` la reconoce. Lo único que cambia es **el orden del montaje** del `publico` (decisión 5) |
| `firmaValida` | `controllers/tiendanube.js:69-84` | **Se conserva tal cual** | HMAC-SHA256 sobre el cuerpo crudo, `timingSafeEqual`, chequeo de longitud previo. Está bien escrita; lo que falta es que le llegue el cuerpo |
| Solo `order/paid` | `:118-122` | **Se conserva** | Procesar además `order/created` descontaba dos veces por la misma venta. Supuesto 6 |
| `Math.max(0, …)` del stock que se publica | `tiendanubeService.js:79` | **Se conserva** | TiendaNube no acepta negativos |
| `resolverSucursal` en el descuento | `tiendanubeService.js:122` | **Se conserva, con la sucursal designada** | Sigue siendo la única función que contesta «qué sucursal». Lo que cambia es qué se le pasa (decisión 4) |
| `getStoredToken` | `tiendanubeService.js:40-54` | **Se parte en dos** | El token sigue saliendo de `settings`; el `user_id` pasa a salir de `tiendanube_tiendas`. Ver la decisión 3 |
| `processOrderCreated` | `tiendanubeService.js:102-173` | **Se reescribe, en el mismo archivo** | Su guarda de idempotencia y su resolución de sucursal están escritas y comentadas; lo que falta es que sean atómicas. **Se queda en `tiendanubeService.js` a propósito**: `descuentoDeStock.test.js:227` lo ancla ahí |
| `controllers/tiendanube.js` | — | **Se disuelve y el directorio se borra** | Decisión 1. Es el punto ciego de las cinco guardias |
| `empresaDeLaTienda` | `controllers/tiendanube.js:92-101` | **Se tira** | `Setting.findAll` sobre **todas** las empresas quedándose con el primer match. Pasa a ser un `findOne` sobre una columna con índice único |
| `syncStock` | `:173-199` | **Se tira entero** | Recorre todas las filas de `Stock` de la empresa y manda un PUT por cada una; con tres sucursales son tres PUT a la misma variante y gana el último |
| `createMapping` | `:155-171` | **Se tira** | Escribe una fila hija bajo un padre que nadie validó (hallazgo 3 de la spec) |
| `getStatus` | `:53-61` | **Se tira** | Devuelve un booleano; FR-004 pide cuatro estados |
| `getProducts` | `tiendanubeService.js:56-71` | **Se tira** | Una sola página, sin timeout, sin 429 |
| `getAuthUrl` | `:10-16` | **Se reescribe** | El 500 con mensaje claro cuando falta `TIENDANUBE_CLIENT_ID` **se conserva**: es lo correcto y es el cuarto estado de FR-006 |
| `products.tiendanube_variant_id` | migración `20260603`, `Product.js:86` | **La columna queda; sale de `CAMPOS_EDITABLES`** | FR-070 a FR-072. Decisión 13 |
| La tarjeta de `/facturacion` | `Settings.jsx:372-403` | **Se saca; queda un enlace** | [PENDIENTE N11] y US7 escenario 5 |

### Qué se reusa tal cual, sin escribir nada nuevo

| Pieza | Dónde | Cómo entra |
|---|---|---|
| `findScoped` / `scoped` / `assertEmpresaId` | `apps/api/src/utils/tenantScope.js` | Todo lo nuevo del servidor. `createMapping` es el caso de FR-030 |
| `fallo` / `ErrorDeNegocio` | `apps/api/src/utils/errores.js:60,38` | Los siete handlers. FR-061 |
| `resolverSucursal` / `sucursalPorDefecto` / `ubicacionDeStock` | `apps/api/src/utils/sucursalDeStock.js:114,79,185` | La sucursal designada se resuelve con `sucursalPorDefecto` al vincular y con `findScoped` al cambiarla |
| `logger` con su redacción | `apps/api/src/utils/logger.js:63-67` | Ya cubre `access_token`, `*.access_token` y `tiendanube_access_token`. **No hay que agregar nada**: hay que dejar de usar `console.error` |
| `reportarError` / `beforeSend` | `apps/api/src/config/sentry.js:55` | Ya tapa `access_token` antes de salir a un tercero |
| `checkPermission` | `apps/api/src/middleware/checkPermission.js` | `config.ver` / `config.editar` ([PENDIENTE N1] por defecto) |
| `POST /api/tareas/ejecutar` con `x-cron-secret` | `server.js:219-236` | El disparador de la reconciliación. Decisión 8 |
| El molde de migración con SQL crudo y transacción | `migrations/20260808-indices-de-empresa-en-proveedores.js` | Las dos migraciones nuevas |
| `TablaGrid` / `Encabezado` / `Fila` / `BotonDeFila` | `apps/web/src/components/TablaGrid.jsx:47,63,86,114` | La tabla de variantes. `columnas` es el string crudo de `grid-template-columns` |
| `Sheet` / `SheetContent` | `apps/web/src/components/ui/sheet.jsx` | El panel de mapeo, con `style={{ width: '520px', maxWidth: '92vw' }}` y **no** en clases |
| `Pagination` | `apps/web/src/components/Pagination.jsx` | 1-indexado, `{ page, totalPages, onPageChange }` |
| `useConfirmDialog` | `apps/web/src/components/ConfirmDialog.jsx:12` | Desvincular y cambiar la sucursal designada |
| `Can` / `usePermission` | `apps/web/src/components/Can.jsx:16` | `codigo=`, nunca `permission=` |
| `PageHeader` / `MarcoDePantalla` / `RouteGuard` | `apps/web/src/components/`, `App.jsx:35` | La ruta nueva |
| `tonoDeStock` | `apps/web/src/utils/inventario.js:221` | El **molde** del badge por tokens: tres clases juntas. Se copia la forma, no la función |
| El arnés de integración | `apps/api/src/tests/integracion/baseDePruebas.js`, `fixtures.js` | Los dos archivos nuevos. `baseDePruebas` va **primero de todo** |

### Lo que se relevó y cambia el diseño

Ocho hallazgos que la spec no tiene. Los tres primeros mueven decisiones
grandes; el 1 invalida un requisito.

**1. El índice único que pide FR-026 rompería toda venta de más de una línea.**
FR-026, textual: «La idempotencia DEBE sostenerse en una **restricción de la
base** sobre `(empresa_id, referencia_id)` de `stock_movements`». `referencia_id`
**no es único por diseño en ninguno de sus tres usos**:

| Escritor | Dónde | Qué guarda en `referencia_id` | Cuántas filas por valor |
|---|---|---|---|
| Venta | `routes/sales.js:557` | `sale.id` | **una por línea de la venta** |
| Anulación | `routes/sales.js:726` | `sale.id`, el **mismo** de la venta | una por línea, encima del valor ya usado |
| Pedido de TiendaNube | `tiendanubeService.js:154` | `tn_order_{id}` | **una por ítem del pedido** |
| Ajuste manual | `routes/general.js:95` | `null` | — |

Crear ese índice deja el punto de venta inservible el día del deploy: una venta
de dos productos choca contra la restricción, la transacción se revierte entera y
`POST /api/sales` responde error para **cualquier** ticket de más de una línea.
La anulación choca contra las filas de la venta original. Y el propio pedido de
TiendaNube choca consigo mismo a partir del segundo ítem.

Ensanchar la clave —`(empresa_id, referencia_id, tipo, product_id,
punto_de_venta_id)`— tampoco sirve: dos líneas del mismo producto en el mismo
ticket vuelven a chocar, y sobre todo pone una restricción global en una tabla
que escriben cuatro caminos para beneficio de uno solo. **La idempotencia del
pedido no cabe en `stock_movements`.** Ver la decisión 6.

**2. `controllers/` es el punto ciego de las cinco guardias, y contiene un solo
archivo.** `aislamientoEmpresas.test.js` lee `routes/`, `services/` y `utils/`
(`:581`, `:685`); `observabilidad.test.js` lee **solo** `routes/` (`:152`);
`permisosDeRutas.test.js` lee **solo** `routes/` (`:547`). `src/controllers/`
tiene exactamente un archivo: `tiendanube.js`.

Eso reencuadra el hallazgo 3 de la spec. La spec lo explica diciendo que
`aislamientoEmpresas.test.js` «busca `findByPk(req.params…)` y acá no hay». No
es eso: el detector `analizarCreates` (`:365-427`) **reconoce exactamente esta
forma** —su muestra sintética `MUESTRA_CREATE_MALA` (`:538`) es
`SupplierMovement.create({ supplier_id: req.params.id, … })`, la misma familia—
y habría nombrado `createMapping` con archivo y línea. **Nunca lo miró.**

Consecuencia: FR-039 pide una guardia estática que ya existe. Lo que falta no es
la guardia, es que el archivo esté donde la guardia mira. Ver la decisión 1.

**3. No hay ninguna reserva de stock en el sistema, así que hoy `available` y
`quantity` son el mismo número — y cuatro escritores pisan la diferencia.**
La decisión 2 del usuario dice «un producto con 10 en depósito y 3 comprometidos
publica 7». Ese estado **AdminApp no lo produce**: no hay concepto de
comprometido. Los ocho caminos que escriben `stock` mueven las dos columnas
juntas, y cuatro de ellos **le asignan a `available` el valor de `quantity`**,
borrando cualquier diferencia que existiera:

| Camino | Línea | Qué le hace a `available` |
|---|---|---|
| Venta y anulación | `sales.js:552`, `:721` | El mismo delta que a `quantity` |
| Recepción de compra | `purchaseService.js:495` | El mismo delta |
| Pedido de TiendaNube | `tiendanubeService.js:149` | El mismo delta |
| Transferencia entre sucursales | `stock.js:146,156` | El mismo delta |
| **Producción** | `productionService.js:378`, `:508` | **`available = quantity`** |
| **Importación CSV** | `import.js:438` | **`available = quantity`** |
| **Alta masiva de productos** | `products.js:329` | **`available = quantity`** |
| Ajuste manual | `general.js:86-91` | Es **el único** que las puede separar |

O sea: publicar `available` es la decisión correcta y **no cuesta nada hoy**,
porque el número es idéntico salvo que alguien haya editado el stock a mano; y el
día que exista una reserva de verdad, hay tres escritores que la borran sin que
nada avise. Se implementa `available` igual —FR es FR y la decisión es del
usuario— y **la pantalla dice cuál publica** (US7 escenario 3), pero el plan no
puede afirmar que eso proteja de una sobreventa que hoy no puede ocurrir. Queda
anotado en `PROXIMOS-PROYECTOS.md`.

**4. El `state` nunca se pudo completar, así que en producción no hay ni una
fila de `settings` con `tiendanube_user_id`.** `getAuthUrl` (`:15`) devuelve la
URL sin `state` y `handleCallback` (`:38-42`) exige un `state` entero: el
circuito termina siempre en `?tiendanube=error&motivo=sin_empresa`, **antes** de
llamar a `getAccessToken`. Nunca se ejecutó el `Setting.upsert` de
`tiendanubeService.js:22-31`.

Consecuencia concreta y verificable: la migración de datos de la decisión 3
—mover `tiendanube_user_id` de `settings` a la tabla nueva— es un **no-op en
producción**. Existe para una base de desarrollo con la fila puesta a mano. Y eso
es exactamente lo que la hace peligrosa: ver el hallazgo 5.

**5. La semilla de `verificar-reversibilidad.js` no toca `settings`, así que la
única migración con datos de este hito pasaría en verde sin ejecutar su rama.**
`sembrar()` (`scripts/verificar-reversibilidad.js:425-470`) inserta en
`empresas`, `products`, `recipes`, `recipe_items`, `cashflow_entries`,
`invitaciones`, `production_orders`, `suppliers`, `supplier_orders`,
`supplier_movements` y `suscripciones`. **No inserta en `settings`, ni en
`puntos_de_venta`, ni en `stock`.**

El propio encabezado del script explica por qué eso importa: «sobre una base
vacía casi todo `down` pasa». Un `down` que tiene que **restaurar** las dos filas
de `settings` no restauraría ninguna, y el script compararía dos esquemas
idénticos y saldría con código 0. La semilla se amplía en la fase 1, y eso es
parte del trabajo, no un detalle.

**6. Los ids de TiendaNube están declarados `INTEGER` y son identificadores de
un tercero.** `TiendanubeMapping.tiendanube_variant_id` y
`tiendanube_product_id` son `INTEGER` (`TiendanubeMapping.js:8-9`), igual que
`products.tiendanube_variant_id` (migración `20260603`). `int4` tope en
2.147.483.647. Los ids de TiendaNube hoy entran; el día que no entren, el
síntoma es un 500 al insertar un mapeo, sin ningún mensaje que diga qué pasó.
Una tabla nueva que se una contra ésa con `BIGINT` sería peor: dos columnas del
mismo dato con tipos distintos. Ver la decisión 12.

**7. El cron externo que tendría que correr la reconciliación falla todos los
días.** `.github/workflows/tareas-diarias.yml:50-51` corta si faltan `API_URL` o
`CRON_SECRET`, y `docs/OPERACION.md:17` los tiene marcados **sin hacer**. O sea
que `POST /api/tareas/ejecutar` hoy **no se llama nunca**, y sin `CRON_SECRET`
del lado de Render respondería 404 aunque se llamara (`server.js:222-224`).

Esto no invalida la decisión 8, pero cambia lo que se puede prometer: una red de
respaldo colgada de ese cron **hoy no atrapa nada**. Por eso el diseño no depende
de él para el caso normal (decisión 8) y por eso la pantalla muestra **cuándo
corrió la última reconciliación**, en vez de dar por hecho que corre.

**8. `RouteGuard` con un módulo nuevo deja la pantalla invisible hasta que
alguien edite cada empresa.** `App.jsx:58-62`: si `enabled_modules` es un arreglo
y no contiene el módulo pedido, redirige a `/pos`. Ninguna empresa tiene
`tiendanube` en su `enabled_modules` hoy, y no hay endpoint que lo agregue salvo
`PUT /api/empresas/:id` con el `settings` entero (`routes/empresas.js:503-511`).
Es el mismo aviso que `marcoDePantalla.test.js:166-171` deja escrito para las
ocho rutas que todavía no tienen guard. Va como paso manual P5 y como riesgo 2.

### Módulos no liberados y los tres gates

**La pantalla es para el cliente** (FR-069): el plan la lista en la sección 1
entre lo que ve el cliente, y no está en la lista de CONVENCIONES («clientes,
recetas, producción, caja, impuestos y reportes»). **No lleva `soloSuperadmin`.**
El gateo es el de módulo y va en los tres lados:

| Lado | Hoy | Queda |
|---|---|---|
| Barra lateral | No existe el ítem | `navegacion.js`, grupo «Configuración`: `{ to: '/tiendanube', modulo: 'tiendanube', permission: 'config.ver' }` |
| `RouteGuard` | No existe la ruta | `<MarcoDePantalla><RouteGuard requiredModule="tiendanube"><Tiendanube/></RouteGuard></MarcoDePantalla>` |
| API | `config.ver` / `config.editar` en las cinco rutas privadas | Igual, más las siete nuevas. **Y `checkSubscription` deja de eximir las privadas** (FR-064) |

**No se crea ningún permiso** ([PENDIENTE N1] por defecto). `config.ver` y
`config.editar` existen (`seedPermissions.js:59-60`) y ya los usan las cinco
rutas de hoy. Queda anotado en `PROXIMOS-PROYECTOS.md` que el día que el
encargado de depósito tenga que sincronizar sin ver el CUIT, hace falta un
permiso propio.

---

## Lo que la spec pide y hay que ajustar

Cinco cosas. La primera es la más cara y no es negociable.

### 1. FR-026 no se puede cumplir como está escrito

Hallazgo 1. La restricción sobre `(empresa_id, referencia_id)` de
`stock_movements` deja el punto de venta inservible.

| FR-026 dice | Queda |
|---|---|
| La idempotencia se sostiene en una restricción sobre `(empresa_id, referencia_id)` de `stock_movements` | La idempotencia se sostiene en una restricción de la base: **`UNIQUE (empresa_id, tiendanube_order_id)` sobre la tabla nueva `tiendanube_pedidos`**, una fila por pedido, insertada **dentro** de la transacción que descuenta |
| Dos entregas en paralelo descuentan una sola vez | **Igual, sin cambios.** Es la garantía que importa y se cumple más fuerte: la restricción es sobre el pedido, que es la unidad de idempotencia, y no sobre una columna que cuatro caminos comparten |

Lo que la spec quería —«y no en un `findOne` previo»— se cumple entero: el
`INSERT` va primero, y el `SequelizeUniqueConstraintError` es la mitad que
sostiene la garantía, igual que en `POST /api/sales`.

### 2. FR-057, FR-058 y FR-059 no pueden convivir con un pasamanos de la API

FR-057 pide todas las páginas del catálogo; FR-058, el total de variantes y
cuántas están mapeadas; FR-059, búsqueda por nombre y por SKU más un filtro «solo
sin mapear». **Ninguno de los tres se puede contestar sobre una página que
todavía no se pidió.** Filtrar sobre la página que llegó es exactamente el
defecto que FR-057 viene a cerrar, con otro nombre.

| Queda | Por qué |
|---|---|
| El servidor recorre **todas** las páginas de TiendaNube y guarda una **instantánea local** en `tiendanube_variantes` | Es la única forma de contestar «cuántas hay», «cuáles no están mapeadas» y «buscá esto» sin pedirle a un tercero con cuota una consulta que no sabe hacer |
| `GET /api/tiendanube/variantes` pagina, busca y filtra **sobre la instantánea**, no sobre la API | Es la consulta que `Pagination.jsx` necesita, y es barata |
| La pantalla muestra **cuándo se refrescó** y ofrece refrescar | Una instantánea sin fecha a la vista es una mentira con horario |

No es una caché de conveniencia: es la única forma de que los tres requisitos
coexistan. Y la instantánea **no es una segunda fuente de verdad** —el catálogo
de TiendaNube no es un dato de AdminApp— a diferencia de un `saldo`
desnormalizado, que sí lo sería.

### 3. La decisión 2 es correcta y hoy no cambia ningún número

Hallazgo 3. Se implementa `available` (FR-028 y la sincronización), la pantalla
lo dice, y queda escrito que el escenario que la decisión previene —10 en
depósito, 3 comprometidos— **no existe todavía en el modelo**, y que tres
escritores borrarían la reserva el día que exista.

### 4. FR-042 se parte en dos, porque «corrida» significa dos cosas distintas

Con la decisión 4 del usuario —sincronizar ante cada movimiento— hay dos
disparadores con vidas distintas: el empujón por movimiento, que puede pasar
cientos de veces por día, y la corrida explícita (el botón, y la reconciliación).
Registrar las dos en la misma tabla produce cientos de filas diarias que nadie
lee y que crecen sin tope.

| FR-042 dice | Queda |
|---|---|
| La corrida deja un registro persistente con cuándo, cuánto, quién, cuántas, cuáles fallaron y por qué | **Igual, para las corridas explícitas**: manual y reconciliación. Van a `tiendanube_corridas` |
| — | El empujón por movimiento **no escribe una corrida**: su estado vive en la fila de la variante (`pendiente_desde`, `intentos`, `ultimo_error`), que es **más útil** —dice qué está desfasado ahora, no qué pasó en un lote— y está acotado a una fila por variante |

FR-043 («el resultado sobrevive un reinicio») se cumple por los dos lados: las
dos cosas son filas.

### 5. FR-021 y FR-039 piden guardias que en parte ya existen

| La spec pide | Queda |
|---|---|
| FR-039 · una guardia que falle ante un `create` de un hijo con un id del cuerpo sin validar el padre | **Ya existe** (`analizarCreates`). Lo que se hace es **borrar el directorio que no miraba** (decisión 1). No se escribe ninguna guardia nueva |
| FR-021 · una guardia que falle si el webhook vuelve a quedar sin cuerpo crudo | **Se escribe, y es nueva**: lee `server.js` y afirma que el montaje del router público está **antes** que `app.use(express.json(`. Va en `tests/observabilidad.test.js` |
| FR-047 · una guardia de que ninguna llamada saliente queda sin `timeout` | **Se escribe**, junto a la anterior |
| FR-060 · ningún `console.error` en el camino de esta integración | **Se escribe** como guardia sobre `routes/`, `services/` y `utils/`, no solo sobre TiendaNube: la regla es del repositorio |

---

## Decisiones

### 1. `controllers/` se disuelve y el directorio se borra

**Se eligió:** los siete handlers de `controllers/tiendanube.js` se reparten
entre `routes/tiendanube.js` —los que son un handler de ruta— y
`services/tiendanubeService.js` / `services/tiendanubeSincronizacion.js` —lo que
es lógica—. El directorio `src/controllers/` deja de existir.

**Por qué.** Es el hallazgo 2: ninguna de las cinco guardias estáticas lo mira, y
tiene un solo archivo. Las dos salidas eran agregar `controllers` a las listas de
las tres guardias, o mover el archivo a donde las guardias ya miran.

**Alternativas descartadas:**

- **Agregar `leerArchivos('controllers')` a las tres guardias y dejar el archivo
  donde está**, **porque** deja en pie una convención que el resto del
  repositorio no usa —diecinueve archivos de rutas, catorce de servicios, un
  controlador— y porque cada guardia futura vuelve a nacer sin ese directorio.
  La lista de directorios de una guardia es exactamente el lugar donde nadie
  mira: la de `observabilidad.test.js` dice `routes` y nada más desde que se
  escribió.
- **Dejarlo y confiar en la revisión**, **porque** es lo que se hizo y produjo el
  hallazgo 3: un `create` con `product_id` del cuerpo, idéntico al defecto 1 de
  la funcionalidad 012, sobrevivió a una auditoría de aislamiento que encontró
  veintiocho casos.

**Consecuencia inmediata, y por eso es la fase 2:** al mover el archivo,
`analizarCreates` nombra `createMapping`, `observabilidad` nombra los cinco
`res.status(...).json({ok:false,error:...})` escritos a mano, y
`permisosDeRutas` no cambia nada. Las tres se arreglan en el mismo corte, que es
chico y no toca comportamiento salvo el 404 de FR-030 —que es el arreglo de un
IDOR y se puede desplegar solo.

### 2. El `state` es un token opaco de un solo uso, en su propia tabla, y se consume con un `UPDATE … RETURNING`

**Se eligió:** `tiendanube_estados_oauth` con `token` (32 bytes de
`crypto.randomBytes`, en hexadecimal), `empresa_id`, `usuario_id`, `expira_en` y
`consumido_en`. `GET /api/tiendanube/auth` inserta la fila y devuelve la URL con
`state=<token>`. El callback lo consume así:

```sql
UPDATE tiendanube_estados_oauth
   SET consumido_en = NOW()
 WHERE token = $1 AND consumido_en IS NULL AND expira_en > NOW()
RETURNING empresa_id, usuario_id;
```

**Cero filas devueltas = el `state` no sirve**, sin distinguir si no existe, si
venció o si ya se usó — que es lo mismo que hace `findScoped` al responder 404 y
por el mismo motivo: distinguirlos le dice a quien prueba tokens cuál de las tres
cosas acertó. Lo que **sí** se distingue en el log es cuál de las tres fue.

**Por qué un `UPDATE … RETURNING` y no un `findOne` seguido de un `update`.**
Es la lección del CAE y la de `POST /api/sales`, otra vez: dos callbacks con el
mismo `state` —el usuario recarga la pestaña de vuelta— pasan los dos por el
`findOne` y los dos canjean el `code`. Un `UPDATE` condicional es atómico y la
base decide quién gana. Sin esto, «de un solo uso» es una intención, no una
garantía.

**Alternativas descartadas:**

- **`empresaId` firmado con HMAC y con vencimiento** (opción b de [PENDIENTE 1]),
  **porque** el usuario ya la descartó y el motivo escrito sigue valiendo: no
  protege contra reusar el mismo `state` dentro de su ventana. Un `state`
  capturado del historial del navegador sirve tantas veces como quepan en su
  vida.
- **Guardarlo como una fila de `settings`**, **porque** `settings` tiene PK
  `(key, empresa_id)`: una sola fila por empresa, y dos pestañas iniciando el
  OAuth a la vez —caso de borde explícito de la spec— se pisarían. Además no hay
  dónde poner el vencimiento sin inventar una convención dentro del JSONB.
- **Un `state` con el `empresaId` en claro** (opción c), **porque** es lo que hay
  que no hacer y la spec ya lo explica.

**La limpieza de los vencidos** va en el mismo `POST /api/tareas/ejecutar` de la
decisión 8: `DELETE … WHERE expira_en < NOW() - INTERVAL '1 day'`. Una tabla de
tokens sin barrido es una tabla que crece para siempre.

### 3. La vinculación vive en `tiendanube_tiendas`; el token se queda en `settings`

**Se eligió:** una tabla nueva con **todo lo de la vinculación menos el token**:

| Columna | Para qué |
|---|---|
| `empresa_id` | **PK**. Supuesto 14: una empresa opera una sola tienda |
| `tiendanube_user_id` | **`UNIQUE`**. Es FR-036, y la garantía es de la base |
| `nombre` | Qué tienda, para el bloque de estado (FR-004) |
| `punto_de_venta_id` | La sucursal designada. **`NOT NULL`**. Decisión 4 |
| `vinculada_en` | Desde cuándo (FR-004) |
| `ultima_comunicacion_en` / `ultima_comunicacion_ok` / `ultimo_error` | El cuarto estado de FR-006, y el 401 de FR-049 |
| `catalogo_refrescado_en` | Lo que la pantalla muestra al lado de la instantánea |
| `sincronizando_desde` | El arriendo de FR-044. Decisión 9 |

**El token sigue en `settings.tiendanube_access_token`, y eso es deliberado.**
FR-077: esta funcionalidad no cifra el token **y no puede agregar ningún lugar
nuevo donde quede en claro**. El día que se haga el proyecto 6 de
`PROXIMOS-PROYECTOS.md` —cifrar la clave de AFIP y el token de TiendaNube
juntos—, el trabajo es sobre `settings` y sobre nada más. Una columna
`access_token` en la tabla nueva sería un segundo lugar que ese proyecto tendría
que descubrir.

**El `user_id` sí se muda**, y las dos filas de `settings` que hoy lo guardarían
se borran en la migración: es un solo dato y tiene un solo lugar. Que sea un
no-op en producción (hallazgo 4) no cambia la disciplina.

**Alternativas descartadas:**

- **Todo en `settings`, con claves nuevas** (`tiendanube_sucursal`,
  `tiendanube_ultima_comunicacion`, …), **porque** FR-036 pide una **restricción
  de la base** sobre la tienda vinculada, y sobre `value` JSONB eso es un índice
  único funcional parcial —`ON settings ((value #>> '{}')) WHERE key =
  'tiendanube_user_id'`—: se puede escribir, y es una restricción que nadie va a
  entender dentro de un año en una tabla compartida con la configuración fiscal.
  Y porque el `NOT NULL` de la sucursal designada, la FK a `puntos_de_venta` y la
  fecha de vencimiento no se pueden expresar en un JSONB sin código que valide, y
  código que valida es exactamente lo que FR-036 dice que no alcanza.
- **Meter el token en la tabla nueva y sacarlo de `settings`**, **porque** viola
  FR-077 y le mueve el objetivo al proyecto 6.
- **Permitir dos tiendas por empresa** (`id` autoincremental en vez de
  `empresa_id` como PK), **porque** el supuesto 14 dice que nada en el modelo lo
  contempla, y una PK que admite dos filas obliga a que **cada** consulta de esta
  integración decida cuál. Es una generalización que nadie pidió y que se paga en
  todas las consultas.

### 4. Una sucursal designada, `NOT NULL`, que sale del mismo lugar para las dos mitades

**Se eligió:** `tiendanube_tiendas.punto_de_venta_id`, obligatoria. De ahí sale
el stock que se publica **y** ahí se descuenta el pedido. Al vincular se resuelve
con `sucursalPorDefecto(empresaId)` —que nunca devuelve null y tira
`ErrorDeNegocio` si la empresa no tiene ninguna sucursal— y después se cambia con
`PUT /api/tiendanube/sucursal`, que la resuelve con `findScoped`.

En el descuento, `processOrderCreated` deja de llamar a `resolverSucursal({
empresaId, puntoDeVentaId: null })` —que caía al escalón por defecto— y pasa a
`resolverSucursal({ empresaId, puntoDeVentaId: tienda.punto_de_venta_id })`.
`resolverSucursal` sigue siendo la única función que contesta la pregunta, así
que `descuentoDeStock.test.js:248` sigue en verde.

**Por qué `NOT NULL` y no «si no hay, la por defecto».** Porque «si no hay» es
literalmente el defecto de hoy: el webhook pasa `null`, cae al escalón por
defecto, y la sincronización elige otra por el orden de las filas. Una columna
que no admite null no tiene rama de omisión que se pueda equivocar.

**Cambiar la sucursal designada tiene consecuencias y la pantalla las dice.**
Cambiarla mueve **todos** los números publicados, así que el `PUT` encola las
variantes mapeadas para volver a empujar, y el `ConfirmDialog` dice cuántas y de
qué sucursal a cuál. No hacerlo dejaría la tienda publicando el stock de una
sucursal y descontando de otra hasta el próximo movimiento de cada producto, que
es el defecto de hoy con una demora encima.

**Alternativas descartadas:**

- **La suma de todas las sucursales**, **porque** es lo que más vende y lo que
  peor descuenta: la tienda publica 40 unidades repartidas en tres locales y el
  pedido descuenta de uno, que puede tener cero.
- **Elegirla en cada corrida** (un `punto_de_venta_id` en el cuerpo de
  `POST /sync-stock`, como hoy), **porque** deja el descuento sin resolver igual
  —el webhook no tiene cuerpo donde ponerlo— y las dos mitades vuelven a poder no
  coincidir.

### 5. El webhook recupera el cuerpo crudo moviendo el montaje, no agregando un `verify` global

**Se eligió:** en `server.js`, `app.use('/api/tiendanube', require('./routes/tiendanube').publico)`
sube de la línea 345 a **antes** de `app.use(express.json({ limit: '10mb' }))`
(:149). El router público ya trae su propio `express.json({ type, verify })`
(`routes/tiendanube.js:37-39`), que **sí** se ejecuta cuando nadie parseó antes.

Queda con `requestId` (:53), `helmet` (:56), `morgan` (:101) y `cors` (:133)
delante, que son los cuatro que hacen falta. El montaje del router `privado`
**no se mueve**: sigue después, detrás de `...authEmpresa`, y como el público
solo declara `/callback` y `/webhook`, el resto cae al privado por orden de
declaración.

**El mismo movimiento resuelve FR-029.** El rate limiter se monta en `:260`, o
sea después: el webhook deja de contra los 600 requests por IP cada 15 minutos
pensados para un navegador. Un 429 al webhook es un pedido que no descuenta, y
las IP de TiendaNube no son las de nadie sentado en una caja.

**Y hay que dejarlo escrito en los dos archivos**, porque es contraintuitivo:
cualquier ruta que alguien agregue al router `publico` a partir de mañana nace
**sin `express.json` y sin rate limit**.

**Alternativas descartadas:**

- **Ponerle `verify` al `express.json()` global**, **porque** guardaría el
  `rawBody` de **todas** las peticiones de la aplicación, con un límite de 10 MB:
  una importación de catálogo pasaría a ocupar el doble de memoria por request, y
  el buffer quedaría colgado del `req` hasta que el handler termine. Es pagar en
  todos lados por un endpoint.
- **`express.json({ type: (req) => !req.path.startsWith('/api/tiendanube/webhook') })`**,
  **porque** ata el parser global a una ruta por su string, y la próxima ruta que
  necesite cuerpo crudo tiene que acordarse de editar una condición que vive a
  doscientas líneas de distancia.
- **Un `express.raw()` propio en el router**, **porque** obliga a parsear el JSON
  a mano en el handler y a duplicar el manejo de un cuerpo mal formado, que
  `express.json` ya hace.

**La guardia (FR-021)** lee `server.js` y compara los dos índices:
`indexOf("require('./routes/tiendanube').publico")` tiene que ser **menor** que
`indexOf('app.use(express.json(')`. Va con sus dos muestras sintéticas —con y sin
el defecto— como las de `dfd7009`, porque una guardia sin muestra es una guardia
que nadie sabe si mira algo. Es lo único que impide que el próximo `app.use`
vuelva a matar la integración sin que nadie se entere.

### 6. La idempotencia del pedido vive en `tiendanube_pedidos`, no en `stock_movements`

**Se eligió:** una tabla con `UNIQUE (empresa_id, tiendanube_order_id)`, una fila
por pedido, escrita **primero** y **dentro** de la transacción que descuenta:

```js
const t = await sequelize.transaction();
// 1. El INSERT va primero. Si choca, este pedido ya se procesó y no se toca nada.
const pedido = await TiendanubePedido.create({ empresa_id, tiendanube_order_id, … }, { transaction: t });
// 2. Los ítems, con lock sobre cada fila de stock.
// 3. commit
```

y el `catch` de `SequelizeUniqueConstraintError` responde «ya procesado» sin
descontar. **Es la misma forma que `POST /api/sales`**, y es la mitad que un test
secuencial no toca.

**Por qué no en `stock_movements`:** hallazgo 1. Un índice único sobre
`(empresa_id, referencia_id)` rompe toda venta de más de una línea, toda
anulación y todo pedido de más de un ítem.

**Por qué la tabla nueva sirve además para otras dos cosas.** Es donde vive
FR-027 —los ítems que **no** descontaron, con su variante y su motivo, en una
columna `items` JSONB— y de dónde sale `GET /api/tiendanube/pedidos` para la
pantalla. Sin ella, «un ítem cuya variante no está mapeada queda registrado y se
puede ver» no tiene dónde quedar: hoy se saltea con un `continue`
(`tiendanubeService.js:129,134,144`) y lo único que queda es que el inventario
está mal.

**FR-025, atómico de verdad:** la transacción envuelve el `INSERT` del pedido,
los `UPDATE` de stock —cada uno con `lock: t.LOCK.UPDATE` sobre el `findOne` de
`Stock`, que **no lleva `include`**— y los `StockMovement.create`. Si el tercer
ítem falla, no queda ni la fila del pedido: el reintento de TiendaNube vuelve a
entrar por el camino normal. Hoy quedan dos ítems descontados para siempre y el
reintento contesta «ya procesado».

> ⚠ **El `lock` va sobre un `findOne` sin `include`, y eso importa.** La
> mitigación de una línea anotada para el defecto de concurrencia del hito 6
> —`lock: t.LOCK.UPDATE` sobre un `findOne` **con** `include`— produce un 500 en
> toda recepción, porque Sequelize lo traduce a un `LEFT OUTER JOIN` y Postgres
> no admite `FOR UPDATE` sobre el lado externo de un outer join. La forma
> correcta ahí es `lock: { level: t.LOCK.UPDATE, of: Modelo }`. Acá no hace falta
> porque no hay `include`, y **no se le agrega ninguno**.

**Alternativas descartadas:**

- **El índice único que pide FR-026**, arriba.
- **Ensancharlo a `(empresa_id, referencia_id, tipo, product_id, punto_de_venta_id)`**,
  **porque** dos líneas del mismo producto en un ticket vuelven a chocar, y
  porque pone una restricción global sobre una tabla que escriben cuatro caminos
  para beneficio de uno.
- **Un `SELECT … FOR UPDATE` sobre una fila de la tienda, como semáforo**,
  **porque** serializa todos los pedidos de una tienda contra una sola fila y
  convierte un pico de ventas en una cola; y porque un semáforo lo sostiene la
  duración de una transacción, no una restricción.

### 7. El catálogo se guarda como instantánea, y esa misma tabla es la cola

**Se eligió:** `tiendanube_variantes`, **una fila por (empresa, variante)**, con
`UNIQUE (empresa_id, tiendanube_variant_id)`. La fila guarda dos cosas que
parecían dos tablas:

| Grupo | Columnas | Para qué |
|---|---|---|
| Lo que dice TiendaNube | `tiendanube_product_id`, `nombre_producto`, `nombre_variante`, `sku`, `stock_en_tienda`, `vista_en` | FR-052, FR-057, FR-058, FR-059, y «esta variante ya no está en tu tienda» (`vista_en` anterior al último refresco) |
| Lo que le debemos | `stock_publicado`, `publicado_en`, `pendiente_desde`, `intentos`, `proximo_intento_en`, `ultimo_error`, `motivo_no_publicado` | La cola de la decisión 8, FR-041, FR-045, FR-046 |

**Por qué una tabla y no dos.** Porque son la misma pregunta —«¿cómo está esta
variante?»— y porque la cola necesita **exactamente** una fila por variante: es
lo que agrupa los empujones sin ningún temporizador (decisión 8). Dos tablas
obligarían a un `join` en cada carga de pantalla para dibujar una fila.

**Por qué no es una segunda fuente de verdad.** El catálogo de TiendaNube no es
un dato de AdminApp: es la respuesta de un tercero, con la fecha en que se pidió
a la vista. `stock_publicado` tampoco: es el registro de **lo que se mandó**, que
es un hecho histórico, no una copia del stock. La fuente del stock sigue siendo
`stock.available` de la sucursal designada, y se lee en el momento de empujar.

**Alternativas descartadas:**

- **Pasar a través la respuesta de TiendaNube en cada carga** (lo de hoy, más las
  páginas que faltan), **porque** un catálogo de 2.000 variantes son ~20 llamadas
  a una API con cuota **por cada vez que alguien abre la pantalla**, y porque
  FR-058 y FR-059 no se pueden contestar sin tener todo (ajuste 2).
- **Guardar el catálogo como JSONB en `tiendanube_tiendas`**, **porque** buscar,
  filtrar y paginar sobre él sería `jsonb_array_elements`, que ningún doble de
  `modelosFalsos.js` entiende y que la decisión 4 del plan de la 012 ya descartó
  por el mismo motivo.
- **Una tabla de cola aparte de la del catálogo**, **porque** la unicidad por
  variante —que es lo que agrupa— tendría que estar en las dos, y una variante
  encolada que no está en el catálogo no significa nada.

### 8. La red de la decisión 4: la cola se drena en el proceso, y el cron es la red, no el mecanismo

**Se eligió:** tres piezas, y **dónde corre cada una** es la parte que importa.

**(a) El encolado: un hook de Sequelize sobre `Stock`.**
`afterCreate` y `afterUpdate` sobre el modelo `Stock`, dentro de la transacción
del que escribió (`options.transaction`). Marca la variante mapeada de ese
producto como pendiente:

```sql
UPDATE tiendanube_variantes
   SET pendiente_desde = COALESCE(pendiente_desde, NOW()),
       proximo_intento_en = LEAST(COALESCE(proximo_intento_en, NOW() + INTERVAL '5 seconds'),
                                  NOW() + INTERVAL '5 seconds')
 WHERE empresa_id = $1 AND tiendanube_variant_id = $2;
```

**Por qué un hook y no una llamada en cada uno de los ocho lugares que escriben
stock.** Porque el repositorio ya tiene escrito qué pasa cuando una regla vive en
ocho lugares: el encabezado de `utils/sucursalDeStock.js` lo dice —«hoy hay diez
lugares que escriben en `stock` y cada uno decide la sucursal a su manera»— y el
resultado fueron filas sin sucursal. El noveno escritor de stock no se va a
acordar de encolar, y el síntoma sería una variante desfasada en silencio, que es
justamente lo que la decisión 4 vino a evitar. Los ocho escritores usan
`instancia.update()` o `Modelo.create()`; ninguno usa `Stock.update()` de clase,
así que los dos hooks los alcanzan a todos.

**Por qué el hook no puede tumbar una venta.** Va envuelto en `try/catch` con
`logger.error` y **no revierte la transacción del que llamó**. Una tabla de cola
con un problema no tiene por qué impedir cobrar. Lo que hace aceptable ese
`catch` —y sin lo cual sería un `sendEmail` devolviendo `ok: true`— es que la
reconciliación diaria compara y corrige lo que se perdió: **la red es lo que
permite que el encolado sea best-effort**.

**(b) El drenaje: dentro del proceso, disparado por la propia petición.**
`drenarCola(empresaId)` toma las filas con `pendiente_desde IS NOT NULL AND
proximo_intento_en <= NOW()`, manda un PUT por fila y actualiza. Se llama con
`setImmediate(() => drenarCola(empresaId).catch(…))` después de responder, con un
`Map<empresaId, Promise>` de un solo drenaje simultáneo por empresa.

**Por qué no `setInterval`.** `server.js:198-204` lo explica: en el free tier de
Render el servicio duerme a los 15 minutos sin tráfico y `setInterval` no dispara
mientras duerme. Un temporizador que no corre de noche es peor que no tenerlo,
porque parece que está.

**Por qué el disparo por petición alcanza para el caso normal.** Un movimiento de
stock **es** una petición: alguien cobró, recibió mercadería o ajustó el
inventario, o entró un pedido por el webhook. Si el proceso está dormido, no hay
movimiento que encolar. La latencia normal es de segundos.

**(c) La reconciliación: `POST /api/tareas/ejecutar`, el cron externo que ya
existe.** Una vez por día, para cada tienda vinculada: refresca la instantánea
del catálogo, compara `tiendanube_variantes.stock_publicado` contra el
`stock.available` actual de la sucursal designada **y** contra el
`stock_en_tienda` que acaba de traer TiendaNube, y **encola solo lo que
difiere**. Deja su fila en `tiendanube_corridas` con
`disparador: 'reconciliacion'`. Y borra los `state` vencidos (decisión 2).

**Comparar contra las dos cosas no cuesta nada extra** —el refresco de la
instantánea hay que hacerlo igual (FR-057)— y atrapa dos fallas distintas: el
empujón que se perdió, y el número que alguien cambió a mano en el panel de
TiendaNube.

⚠ **Ese cron hoy falla todos los días** (hallazgo 7): faltan `API_URL` y
`CRON_SECRET`. Por eso la pantalla muestra **cuándo fue la última
reconciliación**, con su tono, en vez de dar por hecho que corre. Es la
diferencia entre una red y la creencia de que hay una red.

**El backoff:** `proximo_intento_en = NOW() + min(2^intentos, 60) minutos`, y un
429 respeta `Retry-After` si viene. A los 8 intentos la fila deja de reintentarse
sola —`ultimo_error` queda escrito y la pantalla la muestra en rojo— y solo la
mueve una corrida manual o la reconciliación. Una fila que reintenta para siempre
contra un token revocado es un ataque a la cuota de la tienda.

**Alternativas descartadas:**

- **Un `setInterval` en el proceso**, arriba.
- **Agrupar con un temporizador en memoria** (`setTimeout` de 5 segundos por
  producto, como un *debounce*), **porque** muere con el proceso: en el free tier
  el servicio se reinicia y se duerme, y lo que estaba esperando en un
  `setTimeout` no lo reintenta nadie. El agrupado sale gratis y es durable
  haciéndolo con **la unicidad de la fila**: cien movimientos del mismo producto
  en diez segundos actualizan cien veces la misma fila y producen **un** PUT.
- **Una cola externa** (Redis, BullMQ), **porque** es un servicio más que
  aprovisionar, monitorear y pagar, para una integración de una tienda por
  empresa, y porque el free tier no tiene dónde correr un worker.
- **Empujar de forma síncrona dentro de la transacción del movimiento**,
  **porque** ataría el tiempo de una venta al tiempo de respuesta de TiendaNube,
  y un 429 o un timeout de la API de un tercero haría fallar el cobro.

### 9. `tiendanube_corridas` y un arriendo, no un semáforo en memoria

**Se eligió:** las corridas explícitas —manual y reconciliación— escriben una
fila en `tiendanube_corridas` con `empezada_en`, `terminada_en`, `disparador`,
`usuario_id`, `mandadas`, `fallidas` y `fallas` (JSONB con variante y motivo, no
las que salieron bien: con un catálogo grande son cientos de filas que nadie lee,
[PENDIENTE N2]).

FR-044 —no dos sincronizaciones a la vez— se sostiene con un **arriendo** en
`tiendanube_tiendas.sincronizando_desde`, tomado con un `UPDATE` condicional:

```sql
UPDATE tiendanube_tiendas SET sincronizando_desde = NOW()
 WHERE empresa_id = $1
   AND (sincronizando_desde IS NULL OR sincronizando_desde < NOW() - INTERVAL '10 minutes');
```

Cero filas = hay una corriendo, y la respuesta lo dice.

**Por qué un arriendo y no una bandera en memoria.** Porque una bandera en
memoria no sobrevive un reinicio: la corrida que se cortó por la mitad —US5
escenario 6— dejaría la bandera puesta para siempre si fuera una fila sin
vencimiento, y no dejaría nada si fuera una variable. Los diez minutos son lo que
hace que una caída no bloquee la sincronización hasta que alguien entre a la
base.

**Y por eso «volver a sincronizar es seguro» es verdad** (FR-045): el PUT manda
el número absoluto, no un delta. Lo que quedó escrito del lado de TiendaNube son
las variantes que ya se mandaron y ninguna otra.

**Alternativa descartada:** un `pg_advisory_lock`, **porque** vive mientras dure
la sesión de base y no se puede consultar desde otra petición para contestar «hay
una corriendo» sin intentar tomarlo, y porque no deja rastro de cuándo empezó,
que es lo que la pantalla tiene que mostrar.

### 10. `checkSubscription` deja de eximir las rutas privadas, y sigue eximiendo las dos públicas

**Se eligió:** `EXEMPT_PREFIXES` (`middleware/checkSubscription.js:4-8`) cambia
`'/api/tiendanube'` por los dos caminos exactos:

```js
'/api/tiendanube/callback',
'/api/tiendanube/webhook',
```

`isExempt` ya compara con `startsWith` sobre `req.originalUrl`, así que el
callback con `?code=…&state=…` sigue entrando. Las once rutas privadas pasan a
estar detrás de `checkSubscription` como cualquier otra (FR-064).

**Por qué las dos públicas siguen exentas.** No tienen sesión, así que
`req.empresaId` no existe cuando el middleware corre, y cortarlas rompería la
integración de quien sí paga al día: TiendaNube deshabilita el webhook ante
errores repetidos y un 402 es un error repetido. Es US8 escenario 5.

⚠ **Y hay que decir que esa mitad se cumple por otro motivo del que la spec
supone.** Las dos rutas públicas **nunca llegan a `checkSubscription`**: viven en
el router `publico`, que `server.js` monta **sin** `authEmpresa`, y Express
atiende con el primer montaje que matchee. Dejarlas en `EXEMPT_PREFIXES` es
defensivo y gratis, pero **un test que afirme «el webhook funciona con la
suscripción vencida» pasaría igual con la lista vacía**: no prueba lo que dice
probar. Lo que sí hay que verificar —y es el criterio 17— es que las once rutas
privadas **sí** queden cortadas.

**Alternativa descartada:** dejarlo como está, **porque** es la misma forma del
paywall eludible que `CONVENCIONES.md` cita entre los tres errores más caros del
proyecto: una empresa con la suscripción vencida sigue sincronizando su tienda.

### 11. Los tres errores de TiendaNube se distinguen entre sí y del error de AdminApp

**Se eligió:** una función `errorDeTiendanube(err)` en
`services/tiendanubeService.js` que clasifica lo que devuelve axios y lo
convierte en un `ErrorDeNegocio` con el texto que corresponde:

| Lo que pasó | Cómo se detecta | Qué ve el usuario | Qué queda en la fila de la tienda |
|---|---|---|---|
| No contesta | `code: 'ECONNABORTED'` (el `timeout`) | «TiendaNube no respondió a tiempo. Volvé a intentar en unos minutos.» | `ultima_comunicacion_ok = false` |
| 429 | `status === 429` | No es un error: se reintenta con espera. Solo se ve si se agotan los intentos | La variante queda encolada |
| 401 | `status === 401` | «Tu tienda desconectó AdminApp. Hay que volver a vincularla.» | Estado **«vinculada con error»** (FR-049, FR-006) |
| 5xx | `status >= 500` | «TiendaNube tuvo un problema. No es de AdminApp.» | idem |
| Cualquier otra cosa | — | El mensaje genérico de `fallo` | — |

**Todo esto necesita `timeout`, y hoy no hay ninguno.** Las tres llamadas
(`tiendanubeService.js:13`, `:60`, `:77`) van a llevar `timeout: 15000`, con el
precedente escrito en `afipService.js:86-89`. Sin timeout, «no contesta» no es un
caso: es un request de la aplicación esperando para siempre y ocupando una
conexión del pool.

**Y el `console.error` de `tiendanubeService.js:35` se va.** Es el único lugar
donde el material sensible de esta integración podía llegar a un log, y es
justamente el que esquiva la redacción de `logger.js:63-67` y la de
`sentry.js:55`. La guardia de FR-060 lo vigila para todo el repositorio, no solo
para TiendaNube.

**Alternativa descartada:** mapear los códigos en la pantalla con un `switch`,
**porque** los mensajes ya están en castellano del lado del servidor y son los
únicos que saben el contexto — la misma decisión 8 del plan de la 012.

### 12. Los ids de TiendaNube pasan a `BIGINT`, incluida la tabla que el supuesto 4 conserva

**Se eligió:** las tablas nuevas declaran `tiendanube_variant_id`,
`tiendanube_product_id`, `tiendanube_user_id` y `tiendanube_order_id` como
`BIGINT`, y la migración **ensancha las dos columnas de `tiendanube_mappings`**
de `INTEGER` a `BIGINT`.

**Es una desviación declarada del supuesto 4 de la spec** («el modelo
`TiendanubeMapping` y su migración se conservan tal cual»), y va acá para que
`sdd-verify` no la lea como un olvido. Lo que el supuesto protege —los dos
índices únicos, las dos FK con `ON DELETE CASCADE`, el bug documentado de
`addConstraint`— **queda intacto**. Lo único que cambia es el ancho de dos
columnas.

**Por qué.** Hallazgo 6: son identificadores de un tercero y `int4` topa en
2.147.483.647. Y sobre todo, dejarlas en `INTEGER` mientras la instantánea usa
`BIGINT` significa unir dos columnas del mismo dato con tipos distintos: Postgres
lo resuelve, pero el día del desbordamiento una de las dos tablas acepta la fila
y la otra no, y el mapeo queda apuntando a una variante que existe.

**El `down` es seguro**: volver a `INTEGER` no puede fallar por datos, porque
ningún valor guardado bajo `int4` puede exceder `int4`. Es lo que hace que
`verificar-reversibilidad.js` la pueda probar de verdad.

**Alternativa descartada:** declarar las tablas nuevas en `INTEGER` para que
coincidan, **porque** propaga el problema a cinco columnas más en vez de
resolverlo en dos.

### 13. El campo muerto sale de `CAMPOS_EDITABLES` y la columna se queda

**Se eligió:** `'tiendanube_variant_id'` sale de la lista de
`routes/products.js:44`. La columna **no se borra** y el modelo tampoco cambia.

Es FR-070 a FR-072 y [PENDIENTE] de US9 exactamente: sacarlo de la lista blanca
es reversible; el `DROP COLUMN` no.

**Qué pasa con los datos ya cargados** (FR-071): **se ignoran, explícitamente y
por escrito**, en tres lugares —el comentario del modelo, este plan y
`PROXIMOS-PROYECTOS.md`—. No se migran a `tiendanube_mappings` porque un valor
que alguien escribió esperando que hiciera algo **no dice contra qué producto de
TiendaNube estaba pensado**: la tabla de mapeos necesita también el
`tiendanube_product_id`, que esa columna no tiene, y adivinarlo del catálogo
crearía mapeos que nadie confirmó. Es el mismo criterio que [PENDIENTE N3]: la
sugerencia se propone, no se aplica sola.

**La pantalla de producto sigue mostrando el campo si tiene valor**, en solo
lectura y con la leyenda «Este campo no se usa: el mapeo se hace desde
TiendaNube», con enlace. Un dato que desaparece sin que nadie diga que
desapareció es el peor de los dos.

### 14. Las reglas salen a `utils/` en los dos lados, y ningún componente calcula nada

**Se eligió:** cinco archivos de funciones puras, tres del lado de la web y dos
del servidor.

| Archivo | Qué contiene | Por qué es puro |
|---|---|---|
| `apps/web/src/utils/tiendanube.js` | `estadoDeLaConexion` (los cuatro de FR-006) · `tonoDeConexion` · `estadoDeMapeo` · `tonoDeMapeo` · `resumenDeCorrida` · `filtrarVariantes` | Son reglas y tonos: primero la función pura, y el test de render cubre que el badge esté en la fila correcta |
| `apps/web/src/utils/formato.js` | Ya existe (hito 012). Se **reusa** `fechaCorta` para «hace cuánto» | No se escribe una segunda |
| `apps/web/src/utils/erroresDeApi.js` | Ya existe (hito 012). Se reusa | idem |
| `apps/api/src/utils/tiendanubeCatalogo.js` | `normalizarCatalogo(paginas)` → filas de variante · `sugerirPorSku(variantes, productos)` | Es la transformación de la respuesta de un tercero: se prueba con una fixture de **más de una página**, con un producto de varias variantes, con SKU vacío y con SKU repetido en dos productos |
| `apps/api/src/utils/tiendanubeCola.js` | `proximoIntento(intentos, retryAfter)` · `clasificarError(err)` · `hayQueEmpujar(fila, disponible)` | El backoff y la clasificación son aritmética y ramas, no red |

**Las tres funciones que la spec manda a `utils/` y que NO son puras** —el
refresco del catálogo, el drenaje y la reconciliación— viven en
`services/tiendanubeSincronizacion.js` y se prueban en integración. Ponerlas en
`utils/` porque «las reglas van a utils» sería llamar regla a una llamada HTTP.

**Los tests de `apps/api` van en `src/tests/`, nunca en `utils/*.test.js`**: el
`testMatch` de `jest.config.js` solo levanta `src/tests/**`, y lo protege
`todosLosTestsCorren.test.js`.

### 15. La sincronización vive en un archivo nuevo y el descuento se queda donde está

**Se eligió:** `services/tiendanubeSincronizacion.js` para el refresco del
catálogo, el drenaje de la cola, la corrida explícita y la reconciliación.
`processOrderCreated` **no se muda**: se queda en
`services/tiendanubeService.js`.

**Por qué el descuento no se mueve.** `descuentoDeStock.test.js:226-251` ancla
sobre ese archivo tres cosas: que haya **exactamente un** bloque de búsqueda de
stock (`expect(bloques.length).toBe(1)`), que no busque por una sucursal que
pueda ser nula, y que la sucursal salga de `utils/sucursalDeStock`. Mudarlo
dejaría el ancla mirando un archivo sin ninguna búsqueda de stock —o sea, **en
verde sin haber mirado nada**, que es el modo de falla que este repositorio viene
juntando—. Y meter en el mismo archivo la sincronización, que también lee
`Stock`, subiría el conteo a dos sin que nada explique por qué.

Queda escrito acá y en el encabezado del archivo nuevo: **`tiendanubeService.js`
tiene una sola búsqueda de fila de stock y tiene que seguir teniendo una sola.**

---

## Project Structure

### Archivos nuevos

```
apps/api/src/
  migrations/20260810-tiendanube-vinculacion-y-estado.js
                                     tiendanube_tiendas · tiendanube_estados_oauth ·
                                     mueve settings.tiendanube_user_id · BIGINT en mappings
  migrations/20260811-tiendanube-catalogo-pedidos-y-corridas.js
                                     tiendanube_variantes · tiendanube_pedidos ·
                                     tiendanube_corridas · sus índices
  models/TiendanubeTienda.js
  models/TiendanubeEstadoOauth.js
  models/TiendanubeVariante.js
  models/TiendanubePedido.js
  models/TiendanubeCorrida.js
  services/tiendanubeSincronizacion.js   refrescarCatalogo · drenarCola ·
                                         sincronizar · reconciliar
  utils/tiendanubeCatalogo.js            normalizarCatalogo · sugerirPorSku
  utils/tiendanubeCola.js                proximoIntento · clasificarError · hayQueEmpujar
  tests/tiendanubeCatalogo.test.js       las funciones puras del catálogo
  tests/tiendanubeCola.test.js           el backoff y la clasificación de errores
  tests/tiendanubeRutas.test.js          los endpoints, con modelosFalsos
  tests/integracion/tiendanubeWebhook.integracion.test.js
  tests/integracion/tiendanubeAislamiento.integracion.test.js

apps/web/src/
  pages/Tiendanube.jsx                   la pantalla
  components/PanelDeMapeo.jsx            el panel lateral de 520px
  components/EstadoDeTiendanube.jsx      el bloque de conexión + última corrida
  utils/tiendanube.js                    los estados, los tonos, el resumen, el filtro
  utils/tiendanube.test.js
  tests/renderDeTiendanube.test.jsx
```

### Archivos modificados

```
apps/api/src/
  server.js                     el montaje del router publico SUBE arriba de
                                express.json (decisión 5) · POST /api/tareas/ejecutar
                                gana la reconciliación y el barrido de estados
  routes/tiendanube.js          los siete handlers que bajan de controllers/ +
                                los siete nuevos · el comentario de por qué el
                                montaje está donde está
  services/tiendanubeService.js getAccessToken sin console.error y con timeout ·
                                getStoredToken partido · getProducts con todas las
                                páginas · updateVariantStock con timeout y 429 ·
                                processOrderCreated atómico e idempotente ·
                                errorDeTiendanube
  models/Stock.js               los dos hooks del encolado (decisión 8a)
  models/TiendanubeMapping.js   los dos ids a BIGINT
  models/index.js               los cinco modelos nuevos
  models/Product.js             el comentario de la columna muerta (FR-071)
  routes/products.js            tiendanube_variant_id sale de CAMPOS_EDITABLES
  middleware/checkSubscription.js  el prefijo entero se parte en los dos caminos
  tests/observabilidad.test.js  +la guardia del cuerpo crudo (FR-021) ·
                                +la del timeout (FR-047) · +la del console.error (FR-060)
  scripts/verificar-reversibilidad.js  la semilla gana settings, puntos_de_venta,
                                stock y tiendanube_mappings (hallazgo 5)

apps/api/src/controllers/      ← EL DIRECTORIO SE BORRA (decisión 1)

apps/web/src/
  App.jsx                       la ruta /tiendanube con MarcoDePantalla + RouteGuard
  components/navegacion.js      el ítem, con modulo y permission
  pages/Settings.jsx            la tarjeta de TiendaNube se va; queda un enlace
  services/api.js               los helpers de los doce endpoints
  tests/guardiasDeDiseno.test.js  +los tres archivos nuevos, toHaveLength(16) → (19)

apps/web/pruebas-de-navegador/
  marcoDeLasPantallas.navegador.js   diecisiete rutas → dieciocho

docs/PROXIMOS-PROYECTOS.md      lo anotado: no hay reservas de stock y tres
                                escritores las borrarían · el permiso propio de
                                TiendaNube · registrar la venta del pedido ·
                                order/cancelled · el entorno de pruebas
docs/OPERACION.md               habilitar el módulo por empresa · las tres
                                variables de entorno · qué mirar si la
                                reconciliación no corre
```

> **Los tres componentes de la web reciben props explícitos y no leen el store
> por su cuenta**, igual que los tres de `components/pos/`, que tienen una
> guardia que lo verifica (`guardiasDeDiseno.test.js:274-293`). Acá no se agrega
> esa guardia: son tres archivos y la regla va en el encabezado de cada uno.

### Orden de fases

**El principio de orden es distinto al de la 012, y hay que decirlo.** Allá había
un defecto que perdía plata todos los días y por eso iba primero. Acá **la
integración está muerta**: no descuenta nada, no vincula nada. No hay daño en
curso que apurar. Lo que ordena las fases es otra cosa: **qué desbloquea al
resto**, y **qué se puede desplegar y revertir solo**.

Con una excepción, que va segunda: el IDOR del hallazgo 3 de la spec sí es daño
real —la empresa B puede colgar un mapeo de un producto de la A— y es de una
línea.

| # | Fase | Qué deja verificable | Se despliega solo |
|---|---|---|---|
| 1 | **Las dos migraciones, los cinco modelos y la semilla de reversibilidad.** Sin una línea de comportamiento | `verificar:esquema` y `verificar-reversibilidad.js` pasan con la semilla ampliada (hallazgo 5). Las tablas existen y nadie las lee | Sí. Es aditivo puro |
| 2 | **`controllers/` se disuelve.** Los siete handlers bajan a `routes/`, el directorio se borra, y con eso entran cinco guardias: `findScoped` en el mapeo (FR-030), `fallo`/`ErrorDeNegocio` (FR-061), el `console.error` fuera (FR-060) | US4 escenario 1 y criterio 6: la empresa B recibe **404** donde hoy recibe 201. Verificable contra hoy | Sí, y arregla un IDOR |
| 3 | **El OAuth completo.** `state` opaco, `tiendanube_tiendas` que se escribe al vincular con su sucursal designada, el único de tienda, desvincular, `GET /status` con los cuatro estados | US1 entera del lado del servidor, US4 escenario 4, criterios 1 y 7. Verificable contra hoy, donde termina siempre en `?motivo=sin_empresa` | Sí |
| 4 | **El webhook vivo, atómico e idempotente.** El montaje sube, la guardia de FR-021, `empresaDeLaTienda` por índice único, `tiendanube_pedidos`, la transacción con lock, el registro por ítem, el rate limiter | US2 entera, criterios 2, 3, 4 y 5. **Es la fase más grande y la más importante**, y necesita la 3 (la sucursal designada sale de ahí) | Sí |
| 5 | **El catálogo y el mapeo.** El refresco con todas las páginas, `timeout`, el 429, `tiendanube_variantes`, listar y borrar mapeos, la sugerencia por SKU, los dos choques de índice único como mensaje legible | US3 del lado del servidor, criterios 8 y 9 | Sí |
| 6 | **La sincronización explícita.** `tiendanube_corridas`, el arriendo, un PUT por variante, `available`, el fallo que no corta, FR-046 | US5 escenarios 1 a 10, criterios 10, 11 y 12 | Sí |
| 7 | **La cola y la reconciliación** (decisión 4 entera): los hooks de `Stock`, el drenaje, el backoff, `POST /api/tareas/ejecutar` | US5 escenario 11, criterio 14. **Después de la 6 a propósito**: la corrida explícita es el mismo motor y hay que poder culparla sola si falla | Sí |
| 8 | **`checkSubscription` deja de eximir las privadas** | US8 escenario 4, criterio 17. Cuatro líneas, un revert | Sí |
| 9 | **La columna muerta sale de `CAMPOS_EDITABLES`** | US9, criterio 19. Una línea | Sí |
| 10 | **Web: las funciones puras y sus tests** (`utils/tiendanube.js`) | Nada visible. Es lo que hace verificables las fases 12 y 13 | Sí |
| 11 | **Web: las guardias.** Los tres archivos entran a `guardiasDeDiseno.test.js` **antes** de escribirse; la ruta entra a `marcoDePantalla.test.js` y a `marcoDeLasPantallas.navegador.js` | Queda **en rojo a propósito** hasta la fase 12 | No: va con la 12 |
| 12 | **Web: la pantalla.** Ruta, `RouteGuard`, ítem de menú, bloque de estado con los cuatro casos, tabla de variantes en `TablaGrid`, panel de mapeo, los cuatro estados vacíos, los avisos de US7 | US1, US3, US7 y US8 del lado de la pantalla. Criterios 16, 18, 21 | Sí, **después del paso manual P5** |
| 13 | **Web: sincronizar, la última corrida y lo que no descontó** | US5 y US6 del lado de la pantalla, criterios 11 y 12 | Sí |
| 14 | **La tarjeta de `/facturacion` se va y queda el enlace** | US7 escenario 5. Va última porque toca una pantalla que este hito no rediseña | Sí |
| 15 | **Pruebas de navegador y los dos documentos** (`OPERACION`, `PROXIMOS-PROYECTOS`) | Criterio 22 | Sí |

**La fase 1 antes que todo, y sola, no es burocracia.** Es la única con
migraciones, y una de las dos mueve datos. El proyecto 0 dejó escrito que una
migración que no se puede revertir no se puede probar, y `verificar-reversibilidad.js`
lo comprueba **ejecutándola**: mezclarla con el corte que estrena el `state` haría
que un fallo del `down` se lea como un fallo del OAuth.

**La fase 4 después de la 3, y no al revés.** El webhook necesita saber a qué
empresa y a qué sucursal pertenece un pedido, y las dos cosas salen de la fila que
crea la fase 3. Despertar el webhook antes sería empezar a descontar de la
sucursal por defecto —el defecto que la decisión 4 del usuario viene a cerrar—
durante los días que dure el resto del hito.

**La fase 11 en rojo a propósito** es el riesgo 8 del plan de la 010 y la decisión
11 del de la 011, textual: agregar los archivos a la guardia **después** de
escribirlos es cómo se descubren treinta hexadecimales al final, cuando ya nadie
sabe cuál vino de dónde.

---

## Cómo se verifica

### Función pura

| Qué | Archivo | Cubre |
|---|---|---|
| `normalizarCatalogo`: **dos páginas**, un producto con tres variantes, una variante con SKU vacío, un producto sin variantes, una respuesta con `variants: null` | `api/tests/tiendanubeCatalogo.test.js` | FR-052, FR-057, y la advertencia de fixtures de la spec |
| `sugerirPorSku`: SKU coincidente único, SKU repetido en **dos** productos del sistema (no sugiere, **dice que hay dos**), SKU vacío, distinta capitalización, con espacios | idem | [PENDIENTE N3], US3 escenario 6 |
| `proximoIntento`: intento 0, 3, 8, con `Retry-After` en segundos, con `Retry-After` como fecha, sin cabecera | `api/tests/tiendanubeCola.test.js` | FR-048 |
| `clasificarError`: `ECONNABORTED`, 401, 429, 500, 400, un error sin `response` | idem | FR-049, FR-062, US6 escenarios 1 a 4 |
| `hayQueEmpujar`: sin fila de stock (**no publica cero**), disponible igual al publicado, disponible distinto, disponible negativo | idem | FR-045, FR-046, US5 escenario 7 |
| Los cuatro estados de la conexión y su tono, incluidos «sin configurar en el servidor» y «no se pudo comprobar» | `web/utils/tiendanube.test.js` | FR-006, FR-054, US1 escenarios 9 y 10 |
| `estadoDeMapeo` / `tonoDeMapeo`: mapeada, sin mapear, mapeada a un producto que ya no existe, variante que ya no está en la tienda. **Nunca devuelve `undefined`** | idem | FR-054, US3 escenarios 3 y 11 |
| `resumenDeCorrida`: cero fallas, una falla, todas fallaron, corrida en curso, sin ninguna corrida | idem | FR-042, US5 escenario 2 |
| `filtrarVariantes`: «solo sin mapear» con todo mapeado, búsqueda por nombre, por SKU, con acentos | idem | FR-059, US3 escenario 13 |

### Contra la API con `modelosFalsos`

| Qué | Archivo | Cubre |
|---|---|---|
| `GET /auth` sin `TIENDANUBE_CLIENT_ID` responde 500 con su mensaje, y con la variable devuelve una URL **con `state`** | `api/tests/tiendanubeRutas.test.js` | FR-001, US1 escenarios 2 y 9 |
| El callback sin `code` y el callback con `state` desconocido redirigen con **motivos distintos** y **no guardan ningún token** | idem | FR-002, FR-003, US1 escenarios 4 y 5 |
| `POST /mapeos` con ids que no son enteros responde 400 | idem | FR-031 |
| `POST /mapeos` con un `product_id` de otra empresa responde **404** y no crea nada | idem | FR-030, US4 escenario 1 |
| `POST /sincronizar` sin ningún mapeo no manda ninguna llamada y lo dice | idem | US5 escenario 9 |
| El webhook con firma inválida responde 401 y **loguea** con evento y origen | idem | FR-022 |
| El webhook con un evento que no es `order/paid` responde 200 sin procesar | idem | FR-024, US2 escenario 11 |
| El webhook de una tienda no vinculada responde **200** y loguea | idem | US2 escenario 9 |
| Ninguna respuesta de ningún endpoint contiene la cadena del token | idem | FR-075, criterio 20, US1 escenario 7 |

### Integración contra Postgres

Es el nivel que esta funcionalidad no puede saltear: `modelosFalsos.js` no
entiende transacciones, `lock`, ni restricciones únicas, y lo dice en su propio
encabezado.

| Qué | Archivo | Cubre |
|---|---|---|
| Un `order/paid` **firmado** entra por la app real y **descuenta**: `req.rawBody` llegó | `tiendanubeWebhook.integracion.test.js` | FR-020, US2 escenarios 1 y 3, criterio 2 |
| El mismo pedido entregado **seis veces en paralelo** descuenta **una** vez, y lo que lo garantiza es el choque de la restricción única — espiando el `logger.info` que deja esa rama, como hace `idempotenciaDeVentas.integracion.test.js:140` | idem | FR-026, US2 escenario 5, criterio 3 |
| El mismo pedido dos veces **seguidas** tampoco descuenta dos veces | idem | US2 escenario 4 |
| Un pedido de cinco ítems donde el tercero falla **no deja ninguna fila de `tiendanube_pedidos`** y el stock de los dos primeros queda como estaba | idem | FR-025, US2 escenario 6, criterio 4 |
| Un ítem sin mapeo y un ítem mapeado sin fila de stock quedan escritos en `pedido.items` con su motivo | idem | FR-027, US2 escenarios 7 y 8, criterio 5 |
| El descuento baja `quantity` **y** `available`, y sale de la **sucursal designada**, no de la por defecto — con la fixture teniendo dos sucursales y la designada **no** siendo la de menor id | idem | FR-028, decisión 4 |
| La empresa B no lista, no crea y no borra mapeos de la A; la fila de A **sigue ahí** después del intento | `tiendanubeAislamiento.integracion.test.js` | FR-033, FR-034, FR-038, US4 escenarios 2 y 3 |
| Dos empresas no pueden vincular el mismo `tiendanube_user_id`: la segunda choca contra el **índice único** | idem | FR-036, US4 escenario 4, criterio 7 |
| Borrar un producto borra su mapeo (`ON DELETE CASCADE`) y la variante vuelve a «sin mapear» | idem | US3 escenario 11 |
| Un `state` consumido dos veces resuelve **una** sola: el `UPDATE … RETURNING` devuelve cero filas la segunda | idem | Decisión 2, US1 escenario 4 |
| El arriendo de FR-044: dos `POST /sincronizar` en paralelo, uno arranca y el otro recibe «hay una corriendo» | idem | FR-044, US5 escenario 5 |
| El hook de `Stock`: una venta encola la variante mapeada de ese producto, en la misma transacción | idem | Decisión 8a |

**La fixture de estos dos archivos amplía `sembrarDosEmpresas`** con: dos
sucursales por empresa (la designada **no** es la de menor id), una tienda
vinculada en cada empresa con `user_id` distinto, tres mapeos en A y uno en B, un
producto mapeado **sin fila de stock** en la sucursal designada, y un producto
con `available` distinto de `quantity`. Sin eso, la mitad de las afirmaciones de
arriba pasan con y sin el defecto.

### Guardias estáticas

| Qué | Dónde | Cubre |
|---|---|---|
| El montaje del router público está **antes** de `app.use(express.json(` en `server.js`, con sus dos muestras sintéticas | `observabilidad.test.js` | FR-021, y es lo único que impide que el próximo `app.use` lo vuelva a matar |
| Ninguna llamada de `axios` de `services/tiendanubeService.js` ni de `tiendanubeSincronizacion.js` queda sin `timeout` | idem | FR-047, criterio 13 |
| Ningún archivo de `routes/`, `services/` ni `utils/` usa `console.error` | idem | FR-060, criterio 15 |
| `src/controllers/` **no existe** | idem | Decisión 1. Sin esto, alguien lo vuelve a crear y las cinco guardias vuelven a no mirar |
| El `create` del mapeo tiene su `findScoped` delante — lo hace `analizarCreates`, **que ya existe**, en cuanto el archivo vive en `routes/` | `aislamientoEmpresas.test.js` | FR-039, US4 escenario 6 |
| Cada ruta nueva del router privado declara su permiso, y la excepción del público sigue diciendo lo mismo | `permisosDeRutas.test.js` | FR-067, FR-068, US8 escenario 7 |
| `tiendanubeService.js` sigue teniendo **una sola** búsqueda de fila de stock y sigue resolviendo la sucursal con `utils/sucursalDeStock` | `descuentoDeStock.test.js` | Decisión 15. **El ancla no se mueve** |
| Los tres archivos nuevos de la web no tienen hexadecimales, `dark:`, clases de la paleta ni `Table*` | `guardiasDeDiseno.test.js` | FR-056, criterio 21 |
| `/tiendanube` está envuelta en `MarcoDePantalla` y lleva `requiredModule="tiendanube"` porque el ítem lo declara | `marcoDePantalla.test.js` | FR-050, FR-066, US8 escenarios 2 y 6 |

**Tres anclas se miran y ninguna se mueve**, y eso hay que verificarlo, no
suponerlo:

- `analizarIncludes` sigue en `toBe(4)`. **Por eso el listado de mapeos no usa
  `include`**: trae `TiendanubeMapping.findAll({ where: { empresa_id } })` y
  después `Product.findAll({ where: { empresa_id, id: [...] } })`, y une en JS —
  el mismo corte de la decisión 4 del plan de la 012. Agregar
  `Product.hasOne(TiendanubeMapping)` subiría el número a 5 sin ninguna necesidad.
- `analizarCreates` sigue con su `arrayContaining` de dos archivos, que es un
  `arrayContaining`: agregar `routes/tiendanube.js` a la población no lo rompe.
- `permisosDeRutas.test.js:547` sigue con sus **diecinueve** archivos de
  `routes/`: no se agrega ningún archivo de rutas, se agregan rutas al que ya
  está.

### Render (jsdom)

| Qué | Archivo | Cubre |
|---|---|---|
| El encabezado y las filas comparten el **mismo string** de `grid-template-columns` | `renderDeTiendanube.test.jsx` | FR-051, criterio 21 |
| El badge «Sin mapear» está **en la fila de la variante que corresponde**, con una lista donde la segunda y la cuarta están mapeadas | idem | US3 escenario 3 |
| «Sincronizar stock» sin `config.editar` está **deshabilitado con su explicación en el documento**, no ausente | idem | FR-054, US5 escenario 10, US1 escenario 11 |
| Apretar «Sincronizar» dos veces manda **una sola** `api.post`, espiando la instancia de axios | idem | US5 escenario 5, criterio 11 |
| Un 429 y un 502 muestran avisos **distintos**, no cierran el panel y no pierden lo escrito | idem | US6 escenarios 2 y 4, FR-062 |
| La pantalla dice que un pedido **baja inventario y no registra una venta** | idem | FR-073, criterio 16 |
| La pantalla **no dice «bidireccional»** sin aclarar qué va en cada sentido, y dice de qué sucursal y qué número publica | idem | FR-074, US7 escenarios 2 y 3 |
| Los **cuatro** estados vacíos dicen cosas distintas: sin tienda, tienda sin productos, sin mapeos, filtro sin resultados | idem | FR-055, US3 escenarios 12 y 13 |
| El bloque de estado **no contiene el token** de ninguna forma, ni truncado | idem | FR-075, US1 escenario 7 |
| «Desvincular» abre confirmación y la confirmación **dice que los mapeos no se borran** | idem | FR-005, US1 escenario 8, [PENDIENTE N9] |
| El bloque de la última corrida se renderiza dentro de `await act(async () => …)` porque pide datos al montar | idem | `CONVENCIONES.md`, punto 5 |

### Navegador

Solo lo que necesita un motor de maquetado:

1. `/tiendanube` está adentro del contenedor de 1320px y el `<body>` **no
   desborda** a 1140px ni a 1920px (criterio 22). Es la ruta dieciocho de
   `marcoDeLasPantallas.navegador.js`.
2. Un nombre de variante largo **no se mete en la columna de acciones** de la
   tabla.
3. El panel mide **520px de verdad**, después de que opinen el `max-w-[92vw]` y
   el `sm:max-w-sm` que el propio `sheet.jsx` trae.

**Lo que NO baja al navegador**, aunque se pueda escribir: el tono de un badge,
qué variantes entran en el filtro, el texto del resumen de la corrida y el
cálculo del backoff. Los cuatro los contesta una función pura de la tabla de
arriba.

### Lo que no se puede testear, y por qué

Esto es lo más importante de esta sección. Los pasos manuales del hito anterior
arrancaron en doce y once nunca se corrieron; acá son **cinco**, y cada uno
existe porque **no hay forma automática de contestarlo**, no porque escribir el
test diera trabajo.

**No hay entorno de pruebas de TiendaNube** (supuesto 11). Las tres URL están
literales en el servicio y ponerle una variable está Fuera de alcance. Todo lo de
arriba dobla la API de TiendaNube. Consecuencia, dicha sin adornos: **el contrato
real del tercero no lo verifica ni un solo test.** Ni el nombre de la cabecera de
la firma (`x-linkedstore-hmac-sha256`), ni el formato de la paginación, ni la
forma del cuerpo del webhook, ni que `PUT .../variants/{id}` acepte `{ stock }`.
El test de la firma HMAC prueba que AdminApp verifica lo que AdminApp firmó, que
es el circuito, no el algoritmo del otro lado.

| # | Paso manual | Por qué no hay test |
|---|---|---|
| P1 | **Vincular una tienda real de TiendaNube de punta a punta** y verificar que la fila de `tiendanube_tiendas` queda con el `user_id` y el nombre correctos | Es el único que valida el contrato del tercero: la URL de autorización, el canje del `code` y la forma de la respuesta |
| P2 | **Comprar algo en esa tienda** y verificar que llega el `order/paid`, que la firma valida y que el stock bajó en la sucursal designada | idem. Y es lo que comprueba que el movimiento del montaje (decisión 5) funciona **en Render**, no solo en un `supertest` |
| P3 | `node scripts/verificar-reversibilidad.js` **con la semilla ampliada**, desde `20260810` | El `down` de una migración que mueve datos no se puede probar sin aplicarlo y revertirlo contra Postgres; el script existe para eso y hoy su semilla no tocaría la rama (hallazgo 5) |
| P4 | **Configurar `API_URL` y `CRON_SECRET`** (hoy faltan, `OPERACION.md:17`) y verificar que la reconciliación corre y deja su fila | Un cron externo no se puede ejercitar desde la suite. Y hoy **falla todos los días**, así que sin este paso la red de la decisión 4 no existe |
| P5 | **Mirar en producción qué empresas van a recibir `tiendanube` en `enabled_modules`**, y agregarlo, **antes** de la fase 12 | `RouteGuard` con un módulo que nadie tiene deja la pantalla invisible para todos (hallazgo 8). Es la misma precaución que la fase 8 del plan de la 012 |

---

## Riesgos

**1. Alguien lee FR-026 y crea el índice único sobre `stock_movements`.** Es el
hallazgo 1 y es el peor de esta lista: el punto de venta deja de registrar
cualquier venta de más de una línea, y la anulación deja de funcionar entera.
*Cómo se detecta:* inmediatamente, y de la peor forma — el comercio no puede
cobrar. *Mitigación:* está escrito en tres lugares —el ajuste 1, la decisión 6 y
este riesgo— y la migración de la fase 1 **no lo crea**. *Lo que hay que hacer si
alguien lo propone igual:* mostrarle `routes/sales.js:557` y contar las filas que
escribe una venta de dos productos.

**2. La pantalla nueva es invisible para todas las empresas hasta que alguien
edite `enabled_modules`.** Hallazgo 8. `RouteGuard` redirige a `/pos` y el ítem
no se dibuja. *Cómo se detecta:* el cliente dice que no ve la pantalla que se le
anunció. *Mitigación:* el paso manual P5 va **antes** de la fase 12, y el único
camino para agregarlo es `PUT /api/empresas/:id` con el `settings` entero
(`routes/empresas.js:503-511`), que hay que armar con cuidado para no pisar el
resto del JSON. *Lo que no se hace:* dejar la ruta sin `RouteGuard` para que se
vea — eso es el gate que solo está en el menú, y el plan dice que va en los tres
lados o no sirve.

**3. El hook de `Stock` corre dentro de la transacción de toda venta, toda
recepción y toda producción.** Es la decisión 8a y toca el camino más caliente
del sistema. *Consecuencia si falla:* una tabla de cola con un problema —un
índice corrupto, un deadlock— podría hacer fallar un cobro. *Mitigación:* el hook
va en `try/catch` con `logger.error` y **no revierte**; lo que hace aceptable ese
`catch` es la reconciliación diaria, que es la única razón por la que un encolado
perdido no es un dato perdido. *Cómo se detecta:* el log de `logger.error` con
`tiendanube: no se pudo encolar`, y la reconciliación corrigiendo variantes que
nadie encoló. *Lo que hay que mirar antes de dar por buena la fase 7:* que el
`UPDATE` del encolado toque **una** fila por índice único y no barra la tabla.

**4. La reconciliación depende de un cron que hoy falla todos los días.**
Hallazgo 7: faltan `API_URL` y `CRON_SECRET`, y sin el segundo el endpoint
responde 404 aunque se llame. *Consecuencia:* la red de la decisión 4 no atrapa
nada hasta el paso manual P4. *Mitigación:* el caso normal **no** depende del
cron (el drenaje es in-process, decisión 8b), y la pantalla muestra cuándo fue la
última reconciliación con su tono, así que la ausencia se ve. *Lo que no se
hace:* subir la frecuencia del cron para compensar — cada corrida despierta el
servicio, que es lo que el free tier cobra.

**5. El movimiento del montaje del router público cambia lo que hay antes de
`/api/tiendanube/callback` y `/webhook` para siempre.** Decisión 5. *Consecuencia
buscada:* sin `express.json` global y sin rate limiter. *Consecuencia no
buscada:* cualquier ruta que alguien agregue a ese router a partir de mañana nace
igual, y si necesita un cuerpo JSON no lo va a tener. *Cómo se detecta:*
`req.body` vacío en la ruta nueva. *Mitigación:* el comentario va en los dos
archivos —`server.js` y `routes/tiendanube.js`— y la guardia de FR-021 obliga a
leerlo al que mueva el montaje.

**6. `checkSubscription` deja de eximir once rutas de golpe.** *Consecuencia:*
una empresa con la suscripción vencida —o **sin fila de suscripción**, que
`checkSubscription.js:34` trata como bloqueo— pierde la pantalla entera con un
402. *Es lo correcto* y es el criterio 17, pero es una función que alguien puede
estar usando hoy. *Cómo se detecta:* la pantalla muestra el 402 con su mensaje.
*Mitigación:* la fase 8 va sola y es un revert de cuatro líneas. *Lo que hay que
mirar antes:* que ninguna empresa cliente esté sin fila de suscripción, que es un
dato inconsistente que ese middleware ya bloquea en todo el resto de la API.

**7. La instantánea del catálogo puede quedar vieja y la pantalla mostrar
variantes que ya no existen.** Decisión 7. *Consecuencia:* alguien mapea una
variante borrada y la sincronización falla en esa fila para siempre. *Cómo se
detecta:* la fila queda con `ultimo_error` y `vista_en` anterior al último
refresco, y la pantalla la marca. *Mitigación:* la fecha del refresco está a la
vista, el botón de refrescar está al lado, y la reconciliación refresca una vez
por día. *Lo que no se hace:* refrescar en cada carga de pantalla — es el ajuste
2 y son veinte llamadas a una API con cuota por visita.

**8. Cambiar la sucursal designada mueve todos los números publicados de golpe.**
Decisión 4. *Consecuencia buscada:* que las dos mitades sigan coincidiendo.
*Consecuencia no buscada:* la tienda puede pasar de publicar 40 a publicar 12 en
minutos, y el dueño no lo pidió — lo pidió cambiando una sucursal. *Cómo se
detecta:* las ventas de la tienda online caen. *Mitigación:* el `ConfirmDialog`
dice cuántas variantes se van a volver a empujar y de qué sucursal a cuál,
**antes** de confirmar.

**9. `tiendanube_pedidos` y `tiendanube_corridas` crecen sin tope.** *Cuánto:* una
fila por pedido de la tienda y una por corrida explícita. Es poco, pero es para
siempre. *Mitigación:* el mismo `POST /api/tareas/ejecutar` borra las corridas de
más de 90 días. **Los pedidos no se borran**: son la idempotencia, y un pedido
borrado es un pedido que se puede volver a descontar si TiendaNube reintenta un
webhook viejo. *Lo que hay que mirar:* que el borrado de corridas no toque
`tiendanube_pedidos` por copiar la consulta.

**10. `TIENDANUBE_CLIENT_SECRET` ausente se ve idéntico a un ataque.**
`firmaValida` devuelve `false` si falta el secreto (`:73`), así que un despliegue
mal configurado y un intento de suplantación producen el mismo 401 y el mismo
`logger.warn`. *Mitigación:* el rechazo pasa a loguear **cuál de las tres cosas
faltó** —secreto, cabecera o cuerpo crudo—, y al arrancar, si hay filas en
`tiendanube_tiendas` y no hay secreto, `server.js` deja un `logger.error` que lo
dice con todas las letras. *Por qué no se corta el arranque:* una empresa sin
TiendaNube no tiene por qué quedarse sin API por una variable de una integración
opcional.

**11. La migración de datos de la fase 1 es un no-op en producción, y eso la hace
fácil de dar por buena.** Hallazgos 4 y 5. *Consecuencia:* si el `down` estuviera
mal, nadie se enteraría hasta el día que haya que revertir un deploy con datos
reales. *Mitigación:* la semilla de `verificar-reversibilidad.js` se amplía en la
misma fase, y el paso manual P3 la ejecuta. *Cómo se detecta:* el script imprime
las diferencias de esquema como «sobra» / «falta».

**12. Los pedidos de la tienda online siguen sin registrar una venta, y ahora la
pantalla lo hace visible.** Hallazgo 7 de la spec, explícitamente Fuera de
alcance. *Consecuencia:* alguien va a leer el aviso y preguntar cuándo se
arregla; hoy la respuesta es que es una funcionalidad propia —tipo de
comprobante, punto de venta de AFIP, cliente, medio de pago y numeración—.
*Por qué se hace igual:* hoy la pantalla dice lo contrario («sincronización
bidireccional», `Settings.jsx:395`), que es la misma familia de error que
`sendEmail` devolviendo `ok: true`. *Mitigación:* queda anotado en
`PROXIMOS-PROYECTOS.md` con su primer paso.

---

## Anexos

- Las cinco tablas nuevas, los tipos, los índices y las dos migraciones con su
  reversa y el motivo de cada una: [data-model.md](./data-model.md)
- Parámetros, respuestas y códigos de error de los catorce endpoints:
  [contracts/api-endpoints.md](./contracts/api-endpoints.md)
