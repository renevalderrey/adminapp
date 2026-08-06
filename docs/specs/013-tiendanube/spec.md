# Feature Specification: TiendaNube — pantalla nueva completa

**Feature Branch**: `013-tiendanube`
**Created**: 5 de agosto de 2026
**Status**: Draft — hay puntos abiertos, ver «Lo que falta decidir»
**Input**:

> Hito 7 del plan (`docs/PLAN-COMPRAFIT.md`, sección **4.10**), textual:
>
> **4.10 · TiendaNube**
>
> **No tiene pantalla.** Hoy la vinculación vive escondida en Ajustes y los
> endpoints de productos, mapeo y sincronización de stock no tienen interfaz
> ninguna. Como el cliente sí lo va a ver, hace falta:
> - Estado de la conexión y botón de vincular.
> - Mapeo de productos de TiendaNube contra los del sistema.
> - Sincronización de stock, con el resultado de la última corrida.
>
> Y del cuadro de orden de ejecución (sección 6): «7 · TiendaNube · **Pantalla
> nueva completa**». En el cuadro de audiencias (sección 1): «TiendaNube ·
> **nuevo · pedido explícitamente**».

---

## Un aviso antes de empezar

El pedido dice que «la vinculación vive escondida en Ajustes» y que «los
endpoints de productos, mapeo y sincronización no tienen interfaz ninguna». Eso
describe una integración que funciona y a la que le falta la pantalla.
**El relevamiento dice otra cosa: la integración no funciona en ninguno de sus
dos extremos.**

1. **Vincular una tienda es imposible hoy.** `getAuthUrl` arma la URL de
   autorización **sin `state`** (`controllers/tiendanube.js:15`) y
   `handleCallback` **rechaza el callback que no traiga `state`** (`:38-42`),
   porque es el único dato que dice a qué empresa pertenece el token. El
   frontend manda al usuario a esa URL tal cual (`Settings.jsx:81-90`). El
   circuito termina siempre en `/settings?tiendanube=error&motivo=sin_empresa`.

2. **Ningún pedido de la tienda online descuenta stock, y nunca lo hizo.**
   `server.js:149` monta `express.json()` **globalmente**, antes de montar el
   router público (`:345`). Cuando la petición llega al `express.json({verify})`
   del webhook (`routes/tiendanube.js:37-39`), body-parser ya marcó el cuerpo
   como parseado y **no ejecuta el `verify`**: `req.rawBody` queda `undefined`,
   `firmaValida` corta en `!req.rawBody` (`controllers/tiendanube.js:73`) y
   **todo webhook responde 401**. Comprobado corriendo los dos parsers en ese
   orden: `hayRawBody: false`.

El segundo es peor de lo que parece. El comentario que está tres líneas más
arriba (`:104-105`) dice: «Siempre 200: TiendaNube reintenta y **deshabilita el
webhook** si recibe errores repetidos». El código que ese comentario protege
responde 401. O sea que la integración, además de no descontar nada, **se
autodesactiva del lado de TiendaNube**.

Los dos entran. Rediseñar la pantalla de una integración muerta es pintar la
pared del lado de afuera: quedaría una pantalla que dice «Conectado» sobre algo
que nunca conectó.

Y una tercera cosa que **no** entra pero que la pantalla tiene que decir: un
pedido de la tienda online **baja el inventario y no registra ninguna venta**.
Está escrito como LIMITACIÓN CONOCIDA en el propio servicio
(`tiendanubeService.js:96-100`) y en `docs/ANALISIS.md`. El stock desaparece sin
ingreso asociado. Hoy nada en la interfaz lo advierte.

---

## Qué patrones ya están fijados, y cuáles de ellos aplican acá

Las funcionalidades 009 a 012 dejaron el patrón escrito en componentes
compartidos. **Esta pantalla no inventa nada que ya exista.** Decirlo
explícitamente es parte del trabajo: sin esto, `sdd-verify` marca como desvío
cada cosa que se resolvió distinta a propósito.

| Patrón | ¿Aplica? | Dónde y por qué |
|---|---|---|
| `MarcoDePantalla` (dos capas: la de afuera scrollea a ancho completo, la de adentro centra a 1320px) | **Sí** | La pantalla no pide alto completo ni dos zonas de scroll independientes: no es el caso del POS, que es la única excepción escrita en `REGLAS-DISENO.md`. La ruta nueva **se envuelve en la ruta**, no dibuja su propio marco (`MarcoDePantalla.jsx:41-43`), y **entra en las dos listas**: `tests/marcoDePantalla.test.js` (que lee `App.jsx`) y `pruebas-de-navegador/marcoDeLasPantallas.navegador.js:41-44`, que hoy tiene diecisiete rutas y pasa a tener dieciocho |
| `TablaGrid` / `Encabezado` / `Fila` / `BotonDeFila` | **Sí, para el mapeo** | La lista de variantes de la tienda contra los productos del sistema **es** una tabla: nombre, SKU, stock de cada lado, estado del mapeo y acciones. Va con las cuatro piezas y sus medidas literales —`11px 20px` en el encabezado, `15px 20px` en las filas, `gap-x` de 16px, botones de 29px (`TablaGrid.jsx:67`, `:90`, `:123`)— y **no** con los `Table*` de shadcn |
| La disciplina del `grid-template-columns` | **Sí, sin excepción** | El encabezado y las filas comparten el **mismo string**, que se escribe una vez. Es lo que evita leer un stock bajo la etiqueta «SKU» (`TablaGrid.jsx:58-61`) |
| `ui/sheet.jsx` para el panel lateral | **Sí** | El detalle de una variante y el formulario de mapeo van en panel lateral de 520px con `max-w-[92vw]`, como `PanelProducto.jsx` y `PanelOrdenDeCompra.jsx`. **No un modal**: se elige el producto del sistema mirando la lista, no tapándola. Es la misma decisión que tomó Inventario en el hito 4 |
| Tokens de `index.css`, cero hex, cero `dark:`, cero clases de la paleta de Tailwind, cero `Table*` | **Sí, sin excepción** | La pantalla nueva y su panel **entran a la lista de `guardiasDeDiseno.test.js`** (`NOMBRES`, hoy dieciséis archivos) **antes** de escribirse: un archivo de esa lista que todavía no existe da un hallazgo propio —«el archivo NO existe: la guardia no miró nada»— y eso es deliberado (`guardiasDeDiseno.test.js:122-137`) |
| Badge de estado con las **tres** clases juntas | **Sí** | `border-…-line`, `bg-…-soft` y `text-…` en un solo string, desde una función pura que nunca devuelve `undefined`, como `tonoDeProveedor` (`REGLAS-DISENO.md`, «Badge de estado»). Los estados acá son los del mapeo y los de la conexión |
| Estado vacío con ícono apagado y dos líneas | **Sí, cuatro veces** | Sin tienda vinculada; tienda vinculada y sin productos; con productos y sin ningún mapeo; y el filtro que no devolvió nada. Los cuatro dicen cosas distintas y **no pueden compartir el mismo texto** |
| `PageHeader` (`h1` + descripción + acción principal) | **Sí** | La acción principal es «Sincronizar stock» cuando hay tienda vinculada, y «Conectar con TiendaNube» cuando no |
| `utils/` para las reglas, antes que un test de render | **Sí** | El estado de un mapeo, el tono de su badge, el resumen de una corrida, la sugerencia por SKU y la normalización de la respuesta de TiendaNube son funciones puras. Ver «Qué se verifica en qué nivel» |
| `findScoped` / `scoped` / `assertEmpresaId` de `utils/tenantScope.js` | **Sí, y es uno de los hallazgos** | `createMapping` escribe una fila hija bajo un producto que nadie validó. Ver hallazgo 3 |
| `fallo(req, res, err, 'mensaje en castellano')` y `ErrorDeNegocio` de `utils/errores.js` | **Sí** | Hoy el controlador responde a mano con `res.status(...).json({ok:false,error:...})` en seis lugares y el servicio usa `console.error` (`tiendanubeService.js:35`), que **no pasa por la redacción del logger**. Ver hallazgo 11 |
| `resolverSucursal` de `utils/sucursalDeStock.js` | **Sí, y es donde hay que decidir** | Es la única función que contesta «qué sucursal le toca a esta fila de stock» y el servicio ya la usa (`tiendanubeService.js:122`). Lo que falta decidir es **cuál** sucursal es la de la tienda online: ver [PENDIENTE 3] |
| El cuarto nivel: tests de integración contra Postgres | **Sí, y es imprescindible acá** | La idempotencia con dos entregas en paralelo y el aislamiento **ejecutado** no los puede contestar un doble: `tests/helpers/modelosFalsos.js` no entiende transacciones, `lock`, ni restricciones únicas. Hoy **TiendaNube no tiene un solo test de integración** y está escrito así en `PROXIMOS-PROYECTOS.md` |
| Los tres gates del plan (`soloSuperadmin` / `modulo` / `permission`) | **Sí, en los tres lados** | Barra lateral, `RouteGuard` y API. Hoy la pantalla no existe en `navegacion.js` y las rutas privadas exigen `config.ver` / `config.editar`. Ver [PENDIENTE N1] |
| `Pagination.jsx` | **Sí** | El catálogo de una tienda no cabe en una pantalla, y hoy la API trae **una sola página** de TiendaNube. Ver hallazgo 10 |
| `HistorialDeCostos.jsx` como molde de «bloque que pide datos al montar» | **Sí, para la última corrida** | Un componente que pide algo al montar se renderiza dentro de `await act(async () => …)` en su test (`CONVENCIONES.md`, punto 5) |

---

## Contexto: qué existe hoy del lado del servidor

Es la parte más importante del relevamiento: **la spec no puede pedir lo que ya
existe ni dar por hecho lo que no**. Relevado archivo por archivo.

### Resumen en una línea

**Está**: el modelo de mapeo con sus dos índices únicos, su migración, el
servicio con los cuatro métodos, el controlador con siete handlers, dos routers
separados por exposición, el montaje en `server.js`, tres variables de entorno,
la redacción del token en logs y en Sentry, y una guardia estática que vigila
cómo el servicio busca la fila de stock.

**Falta**: que algo de eso funcione de punta a punta, listar y borrar mapeos,
desvincular, paginar el catálogo de la tienda, cualquier registro de qué pasó en
la última corrida, cualquier interfaz que no sea una tarjeta de 30 líneas al
final de Ajustes, y **un solo test —de cualquier nivel— que ejercite el
comportamiento**.

### La API · qué está y qué falta

| Cosa | Dónde | Estado real |
|---|---|---|
| Montaje en dos partes | `server.js:344-346` | **Está y está bien pensado**: `publico` sin sesión para lo que llama TiendaNube, `privado` detrás de `...authEmpresa`. Es la corrección de un defecto anterior y está documentada en `routes/tiendanube.js:5-24`. `permisosDeRutas.test.js:81-85` la reconoce como excepción documentada |
| `GET /api/tiendanube/auth` | `controllers/tiendanube.js:10-16` | Devuelve `https://www.tiendanube.com/apps/{clientId}/authorize`. **Sin `state`** → el callback no puede resolver la empresa. Ver hallazgo 2 |
| `GET /api/tiendanube/callback` | `:30-51` | Público. Exige `state` entero (`:38`) y si no viene redirige a `?tiendanube=error&motivo=sin_empresa`. **El rechazo es correcto; la mitad que lo hace posible no existe** |
| `GET /api/tiendanube/status` | `:53-61` | Devuelve **solo** `{ ok, linked: boolean }`. No dice qué tienda, ni desde cuándo, ni si la API contesta |
| `POST /api/tiendanube/webhook` | `:103-143` + `routes/tiendanube.js:35-42` | **Muerto**: `req.rawBody` nunca se llena. Ver hallazgo 1. Escucha únicamente `order/paid` (`:122`), decisión correcta y documentada —antes se procesaban `order/created` **y** `order/paid` y el stock bajaba dos veces por la misma venta |
| `GET /api/tiendanube/products` | `:145-153` | Pasa a través la respuesta cruda de TiendaNube. **Sin paginación**: solo la primera página. Ver hallazgo 10 |
| `POST /api/tiendanube/mapping` | `:155-171` | Crea el mapeo. **No valida que el producto sea de la empresa** (hallazgo 3) y **no distingue el choque del índice único** de un error del servidor: 500 genérico (`:169`) |
| `POST /api/tiendanube/sync-stock` | `:173-199` | Empuja stock a TiendaNube. Ver hallazgo 5 |
| **Listar mapeos** | — | **No existe.** Sin esto no se puede dibujar la pantalla de mapeo |
| **Borrar / editar un mapeo** | — | **No existe.** Un mapeo equivocado no se puede corregir más que por la base |
| **Desvincular la tienda** | — | **No existe.** No hay forma de borrar el token desde la aplicación |
| **Registro de la última corrida** | — | **No existe en ningún lado.** Es lo que el pedido nombra explícitamente |
| Firma HMAC del webhook | `:69-84` | **Escrita y correcta**: HMAC-SHA256 sobre el cuerpo crudo, comparación en tiempo constante con `timingSafeEqual`, chequeo de longitud previo. **Nunca se ejecuta con un `rawBody` de verdad** |
| Resolución de empresa desde el webhook | `:92-101` | `Setting.findAll({ key: 'tiendanube_user_id' })` **sobre todas las empresas**, y se queda con el primer match. Ver hallazgo 4 |
| Suscripción | `middleware/checkSubscription.js:4-8` | `/api/tiendanube` está **entero** en `EXEMPT_PREFIXES`. Ver hallazgo 12 |
| Rate limit propio | `server.js:253-260` | 600 requests por IP cada 15 min sobre `/api/`. **Aplica también al webhook**, que llega desde las IP de TiendaNube y no desde el navegador de nadie |
| Timeouts salientes | — | **Ninguna** de las tres llamadas `axios` tiene `timeout` (`tiendanubeService.js:13`, `:60`, `:77`). El precedente contrario está en `afipService.js:86-89`, con el comentario que explica por qué |

### El servicio

`apps/api/src/services/tiendanubeService.js`, 177 líneas, cuatro métodos.

| Método | Qué hace | Estado real |
|---|---|---|
| `getAccessToken(code, empresaId)` (`:11`) | Canjea el `code` y guarda `tiendanube_access_token` y `tiendanube_user_id` en `settings`, **con `empresa_id`** | El scoping por empresa está bien. El `catch` usa `console.error` (`:35`), que **no pasa por la redacción de pino ni por la de Sentry**. Ver hallazgo 11 |
| `getStoredToken(empresaId)` (`:40`) | Lee las dos filas de `settings` de esa empresa | **Correcto.** `AUDITORIA-AISLAMIENTO.md:137` lo lista entre los que «ya estaban correctos» |
| `getProducts(empresaId)` (`:56`) | `GET /v1/{user_id}/products` | Sin paginación, sin timeout, sin manejo de 429 |
| `updateVariantStock(empresaId, variantId, quantity)` (`:73`) | `PUT /v1/{user_id}/products/variants/{id}` con `{ stock: Math.max(0, quantity) }` | Sin timeout, sin reintento, sin 429. El `Math.max(0, …)` está bien: TiendaNube no acepta stock negativo |
| `processOrderCreated(orderData, empresaId, puntoDeVentaId)` (`:102`) | Descuenta stock por un pedido | Ver hallazgo 6. Su guarda de idempotencia y su resolución de sucursal están escritas y comentadas; lo que falta es que sean atómicas |

### El modelo de datos

| Tabla / columna | Dónde | Estado real |
|---|---|---|
| `tiendanube_mappings` | `models/TiendanubeMapping.js`, migración `20260606-add-tiendanube-mapping.js` | **Existe y está bien formada**: `empresa_id`, `product_id`, `tiendanube_variant_id`, `tiendanube_product_id`, timestamps. **FK a `empresas` y a `products` con `ON DELETE CASCADE`**. Dos índices únicos: `uq_tn_mapping_product` (`empresa_id, product_id`) y `uq_tn_mapping_variant` (`empresa_id, tiendanube_variant_id`). La migración trae escrito el bug que la rompía —`key` en vez de `field` en `addConstraint`, que impedía crear una base nueva— y no puede volver |
| `settings` (`key`, `empresa_id`) | `models/Setting.js` | PK **compuesta**, `value` JSONB. Ahí viven `tiendanube_access_token` y `tiendanube_user_id`, **en texto plano**. Ver hallazgo 13 |
| `products.tiendanube_variant_id` | Migración `20260603-add-tiendanube-variant-id.js`, `models/Product.js:86` | **Existe, es editable y no lo lee nadie.** Ver hallazgo 8 |
| `stock_movements` con `tipo: 'tiendanube_sale'` | escrito en `tiendanubeService.js:154-167` | La referencia es `tn_order_{id}` y es lo que sostiene la idempotencia. **No hay índice único sobre `(empresa_id, referencia_id)`** que la sostenga de verdad |
| `stock.quantity` / `stock.available` | `models/Stock.js:42`, `:47` | Dos números distintos —«cant» y «disp» del sistema original—. La sincronización manda `quantity` (`controllers/tiendanube.js:190`) y el webhook descuenta **los dos** (`tiendanubeService.js:149-152`). Ver [PENDIENTE 2] |

**Migraciones nuevas que esta funcionalidad necesita**: al menos el índice
único que sostiene la idempotencia del webhook, y lo que resuelvan
[PENDIENTE 1] (el `state`) y [PENDIENTE 4] (dónde vive el registro de la última
corrida). El detalle es trabajo de `sdd-plan`.

### Variables de entorno

`.env.example:73-76`, bajo el rótulo «TiendaNube (opcional)»:

| Variable | Para qué | Notas |
|---|---|---|
| `TIENDANUBE_CLIENT_ID` | Armar la URL de autorización y el canje del token | Si falta, `getAuthUrl` responde **500 con un mensaje claro** (`controllers/tiendanube.js:12-14`). Es lo correcto |
| `TIENDANUBE_CLIENT_SECRET` | Canje del token **y** verificación de la firma HMAC del webhook | Si falta, `firmaValida` devuelve `false` y **todo webhook se rechaza en silencio** (`:73`). Un despliegue sin esta variable se ve idéntico a un despliegue atacado |
| `TIENDANUBE_CONTACT_EMAIL` | Cabecera `User-Agent` que TiendaNube exige | Tiene un valor por defecto de relleno: `contacto@tudominio.com` (`tiendanubeService.js:65`, `:83`) |

**No hay** ninguna variable para la URL base de la API, así que no se puede
apuntar a un entorno de pruebas de TiendaNube: los tres endpoints están escritos
literales en el servicio.

### La web

| Cosa | Dónde | Estado real |
|---|---|---|
| Pantalla | — | **No existe.** No hay ruta en `App.jsx` ni ítem en `components/navegacion.js` |
| Vinculación | `pages/Settings.jsx:372-403` | Una tarjeta al final de `/facturacion` (`App.jsx:290`; `/settings` redirige ahí, `:299`). Muestra «vinculada» o un botón, y nada más |
| Estado | `Settings.jsx:74-79` | `GET /tiendanube/status` → un booleano. El `catch` es `console.error` (`:78`): si la llamada falla, la tarjeta dice «no vinculada» aunque lo esté |
| Aviso post-callback | `:65-71` | Lee `?tiendanube=success|error` y muestra un toast. **El `motivo=sin_empresa` que hoy devuelve siempre el callback no se lee**: el usuario ve «Error al vincular TiendaNube» sin más |
| Textos | `:389`, `:395` | «El stock se sincroniza automáticamente mediante webhooks» y «sincronización bidireccional». **La primera es falsa hoy** (hallazgo 1) y **seguirá siendo engañosa aun arreglada**: los pedidos descuentan stock pero no registran venta |
| Mapeo, sincronización, última corrida | — | **Cero líneas.** Los tres endpoints privados que existen no los llama nadie |
| Permisos | `routes/tiendanube.js:47-51` | `config.ver` para leer, `config.editar` para escribir. Los dos existen en `seedPermissions.js:59-60`. **No hay permiso propio de TiendaNube** |

### El sistema viejo

**`legacy/index-legacy.html` no menciona TiendaNube ni una sola vez.** Se buscó
`tiendanube`, `tienda nube`, `tienda online`, `ecommerce`, `mercadolibre`: cero
coincidencias. Y `docs/MIGRACION-COMPRAFIT.md:157` lo lista entre lo que
**«nada de esto existía en Comprafit»**.

Consecuencia directa para la spec: **acá no hay una fuente sobre «qué esperan»**.
En las funcionalidades 009 a 012 el legacy fue el mejor insumo —qué columnas,
qué filtros, qué estados—; en ésta no hay contra qué comparar y todo lo que la
pantalla haga es una decisión nueva. Es el motivo por el que esta spec tiene más
`[PENDIENTE DE DEFINIR]` que la anterior, y no menos.

### La maqueta

**`docs/maqueta/AdminApp-Rediseno.dc.html` no dibuja esta pantalla.** Se buscó
`tiendanube`, `tienda nube` y `tienda-nube`: cero coincidencias. Su propio
`README.md` enumera las siete pantallas que sí dibuja —Panel, POS, Historial de
ventas, Inventario, Órdenes de compra, Configuración y el panel lateral— y
TiendaNube no está. A diferencia de Proveedores en la funcionalidad 012, **acá
ni siquiera hay un ítem de menú que caiga en `isStub`**: la pantalla no figura en
la maqueta de ninguna forma.

**Se anota como supuesto** (Assumption 2) para que la verificación no busque una
referencia que no existe. El diseño sale de tres lugares: el texto de la sección
4.10, los primitivos que la maqueta sí fijó y que `REGLAS-DISENO.md` ya extrajo
—tabla en grid, badges de estado con sus tres tonos, panel lateral de 520px,
estados vacíos, `.eyebrow`, `.num`— y la referencia viva,
`apps/web/src/pages/Comparador.jsx`.

---

## Hallazgos del relevamiento

Catorce. **Doce entran de lleno** —1 a 6 y 8 a 13—; el **7** entra solo como
advertencia visible y el **14** queda anotado con su motivo. El 7 está fuera de
orden a propósito: se lee después de los que sí se arreglan, porque es el único
cuya respuesta es «no se arregla acá, pero se dice».

### Entran

**1. El webhook está muerto: `req.rawBody` nunca se llena.**
`server.js:149` monta `express.json({ limit: '10mb' })` para toda la aplicación,
antes de `app.use('/api/tiendanube', require('./routes/tiendanube').publico)`
(`:345`). Cuando la petición llega al segundo parser —el del webhook, que sí
tiene `verify` (`routes/tiendanube.js:37-39`)— body-parser ve el cuerpo ya
parseado y sale sin ejecutarlo. `req.rawBody` queda `undefined`.

```js
// controllers/tiendanube.js:73
if (!secret || !recibida || !req.rawBody) return false;
```

**Toda petición al webhook responde 401** (`:112`). Comprobado empíricamente
montando los dos parsers en ese orden: la respuesta trae `hayRawBody: false` con
el cuerpo correctamente parseado.

Las dos consecuencias:

- **Ningún pedido de la tienda online descontó stock jamás.** `processOrderCreated`
  —con su guarda de idempotencia, su resolución de sucursal y su comentario de
  tres bugs corregidos— es código inalcanzable en producción.
- **El 401 apaga la integración del otro lado.** TiendaNube reintenta y
  deshabilita el webhook ante errores repetidos; el propio controlador lo dice
  (`:104-105`) y por eso devuelve 200 en todos los demás caminos. Éste es el
  único que devuelve un error, y es el que se ejecuta siempre.

**Por qué ninguna guardia lo vio**: `descuentoDeStock.test.js:226-251` verifica
que el servicio busque la fila de stock con una sucursal no nula y que use
`resolverSucursal`. Las tres aserciones pasan. Miran **la forma del código**, no
si alguien puede llegar a ejecutarlo. → **FR-020 a FR-024**.

**2. El OAuth no puede completarse: falta el `state`.**
`getAuthUrl` (`:15`) devuelve la URL sin `state`; `handleCallback` (`:38-42`)
exige un `state` que sea un entero y, si no, redirige a
`?tiendanube=error&motivo=sin_empresa`. `Settings.jsx:81-90` navega a esa URL tal
cual.

El rechazo **es correcto y no se toca**: la versión anterior resolvía la empresa
con `|| 1` y guardaba el token de cualquier empresa bajo la empresa 1, que en
producción es un cliente real. Lo que falta es la otra mitad, y el propio
comentario del archivo lo dice (`:26-28`). **Cómo viaja la empresa en ese `state`
es [PENDIENTE 1] y bloquea**: un `state` que sea el `empresaId` en claro es
adivinable, y entonces cualquiera puede terminar un flujo de OAuth con `state=1`
y colgarle **su** tienda a la empresa 1. → **FR-001 a FR-006**.

**3. `createMapping` escribe una fila hija bajo un padre que nadie validó.**
`controllers/tiendanube.js:157-164`:

```js
const { product_id, tiendanube_variant_id, tiendanube_product_id } = req.body;

const mapping = await TiendanubeMapping.create({
  empresa_id: req.empresaId,
  product_id,                    // ← nadie verificó de quién es este producto
  tiendanube_variant_id,
  tiendanube_product_id,
});
```

Es **exactamente** el patrón del defecto 1 de la funcionalidad 012
(`POST /api/suppliers/:id/payments`), y lo detecta lo mismo que lo detectó allá:
nada. `aislamientoEmpresas.test.js` busca `findByPk(req.params…)` y acá no hay;
`observabilidad.test.js` busca `where: { algo_id: req.params.id }` y acá no hay
un `where`, hay un `create`.

Tampoco valida que `tiendanube_variant_id` y `tiendanube_product_id` sean
números, ni que la variante exista en la tienda vinculada, ni distingue el
choque del índice único —«ese producto ya está mapeado»— de un error del
servidor: responde 500 con un texto genérico (`:169`). → **FR-030 a FR-035**.

**4. Dos empresas pueden vincular la misma tienda, y el pedido va a parar a
una sola.** `empresaDeLaTienda` (`:92-101`):

```js
const vinculadas = await Setting.findAll({ where: { key: 'tiendanube_user_id' } });
const match = vinculadas.find((s) => String(s.value) === String(storeId));
```

Es una lectura **sobre todas las empresas**, y tiene que serlo: el webhook no
tiene sesión y el `store_id` es lo único con lo que se puede resolver a quién le
corresponde. Lo que falta es la garantía del otro lado: `settings` tiene PK
`(key, empresa_id)`, así que **nada impide que dos empresas guarden el mismo
`tiendanube_user_id`**. Si eso pasa, el `.find` se queda con la primera fila que
devuelva Postgres —en un orden que nadie definió— y **el pedido de una tienda le
descuenta stock a la empresa equivocada**.

No hace falta mala fe: alcanza con una empresa de prueba y una de producción del
mismo cliente, o con reinstalar la app sin desvincular la anterior —que hoy no
se puede desvincular (hallazgo 9)—. Es la regla que este proyecto ya rompió
veintiocho veces, con una forma nueva. → **FR-036 a FR-039**.

**5. La sincronización de stock no es reintentable, no es observable, y lo que
queda a medias no queda escrito.** `syncStock` (`:173-199`):

- **Recorre todas las filas de `Stock` de la empresa** (`:183`) y manda un PUT
  por **cada fila** cuyo producto esté mapeado (`:187-191`). Con tres sucursales,
  son tres PUT a la misma variante con tres números distintos, y **gana el
  último**, en el orden que devuelva la consulta. Comprafit tiene tres
  sucursales. → esto es lo que hace que [PENDIENTE 3] bloquee.
- **Ante el primer fallo, tira.** El `catch` responde 502 (`:197`) y el `synced`
  que se venía contando **se pierde**. El usuario no sabe cuántas variantes se
  actualizaron ni cuáles faltan. Lo que quedó escrito del lado de TiendaNube es
  «las primeras N, no sé cuáles».
- **No hay reintento, ni backoff, ni tratamiento del 429.** TiendaNube limita
  por tienda. Un catálogo de varios cientos de variantes lo va a encontrar en la
  primera corrida.
- **No queda ningún registro.** Ni cuándo corrió, ni quién la disparó, ni con qué
  resultado. **El pedido nombra explícitamente «el resultado de la última
  corrida» y hoy no hay dónde leerlo.**
- **Ninguna llamada tiene `timeout`** (`tiendanubeService.js:13`, `:60`, `:77`).
  Una llamada colgada deja el request de la aplicación esperando para siempre y
  ocupa una conexión del pool. El precedente contrario está escrito y comentado
  en `afipService.js:86-89`. → **FR-040 a FR-049**.

**6. El descuento por pedido no es atómico, y su idempotencia se rompe con dos
entregas a la vez.** `processOrderCreated` (`tiendanubeService.js:102-173`):

- La guarda es un `findOne` por `referencia_id` (`:105-108`) seguido de
  escrituras **sin transacción y sin lock**. Dos entregas del mismo `order/paid`
  —que TiendaNube reintenta— pueden pasar las dos la comprobación y **descontar
  dos veces**. Es la lección que el sistema ya aprendió dos veces: el CAE y
  `POST /api/sales`, cuya mitad que de verdad sostiene la garantía es el
  `SequelizeUniqueConstraintError` y **un test secuencial no la toca nunca**
  (`CONVENCIONES.md`, cuarto nivel). Acá **no hay índice único sobre
  `(empresa_id, referencia_id)` en `stock_movements`** que pueda sostenerla.
- **El estado parcial es permanente.** Si el pedido tiene cinco ítems y el
  tercero falla, los dos primeros ya descontaron y dejaron su `StockMovement`.
  Un reintento encuentra el del primero, contesta «pedido ya procesado» (`:110`)
  y **los tres que faltan no se descuentan nunca**. El inventario queda mal y
  nada lo dice.
- **Un ítem cuya variante no está mapeada se saltea sin dejar rastro** (`:134`),
  y lo mismo un producto mapeado **sin fila de stock en esa sucursal** (`:144`).
  Se vendió, salió del depósito, y el inventario no se enteró: es exactamente el
  modo de falla que `descuentoDeStock.test.js` existe para evitar, y su
  encabezado lo dice —«lo grave no es que falle: es que **no falla**».
- `usuario_id: 'tiendanube'` (`:166`) es un literal en una columna que significa
  «id de usuario». Ya está anotado en `ProductCostHistory.js:33` y **no se
  arregla acá**; se nombra para que no se lea como un id que se pueda unir con
  `usuarios`. → **FR-025 a FR-029**.

**8. Dos mecanismos de mapeo, y el que está muerto es editable.**
`products.tiendanube_variant_id` existe desde la migración `20260603`, está en el
modelo (`Product.js:86`) y **está en `CAMPOS_EDITABLES` de
`routes/products.js:44`**: cualquiera con `products.editar` lo puede escribir
desde el panel de producto.

**No lo lee nadie.** El único mapeo que usan el webhook y la sincronización es la
tabla `tiendanube_mappings`. Una persona que complete ese campo esperando que el
stock se sincronice va a esperar para siempre, y **el sistema le va a decir que
guardó bien**. Es la misma familia de error que `sendEmail` devolviendo
`ok: true` sin enviar nada. → **FR-070 a FR-072**.

**9. No hay forma de listar, corregir ni borrar un mapeo, ni de desvincular la
tienda.** El router privado tiene cinco rutas (`routes/tiendanube.js:47-51`).
Falta:

- **`GET` de mapeos.** Sin esto la pantalla de mapeo no se puede dibujar: no hay
  forma de saber qué está mapeado.
- **`DELETE` de un mapeo.** Un mapeo equivocado —el producto correcto contra la
  variante de otro— hoy solo se corrige entrando a la base.
- **Desvincular.** No hay forma de borrar el token desde la aplicación. Es lo que
  hace posible el hallazgo 4, y es lo primero que hace falta cuando alguien
  vincula la tienda equivocada. Ajustes → AFIP **sí** tiene «Desvincular» y la
  maqueta lo dibuja (`AdminApp-Rediseno.dc.html:780-783`): el patrón ya está.
  → **FR-050 a FR-056**.

**10. `GET /api/tiendanube/products` trae solo la primera página.**
`getProducts` (`tiendanubeService.js:56-71`) pide `/v1/{user_id}/products` sin
`page` ni `per_page` y devuelve `response.data` crudo; el controlador lo pasa a
través (`:147-148`). La API de TiendaNube pagina, y el resto viene en las
cabeceras de la respuesta, que acá se descartan.

**Una tienda con más de una página muestra solo los primeros productos y el
resto no se puede mapear**, sin que nada avise: la lista se ve completa. Es la
trampa de «listas de una sola página» que `CONVENCIONES.md` nombra entre las
fixtures que dejaron pasar defectos, y acá está del lado del código.
→ **FR-057 a FR-059**.

**11. Los errores de esta integración no pasan por donde tienen que pasar.**

- `tiendanubeService.js:35` usa **`console.error`** con `error.response?.data`.
  La redacción de secretos existe y es explícita —`utils/logger.js:63-67` cubre
  `access_token` y `tiendanube_access_token`; `config/sentry.js:55` los tapa
  antes de salir a un tercero— pero **`console.error` no pasa por ninguna de las
  dos**. El único lugar donde el material sensible de esta integración podría
  llegar a un log es justamente el que esquiva el filtro.
- El controlador responde a mano en seis lugares (`:13`, `:59`, `:151`, `:169`,
  `:197`) en vez de usar `fallo(req, res, err, 'mensaje en castellano')`. No
  filtra nombres de tabla, pero tampoco deja el `requestId` con el que se
  encuentra la línea en los logs de Render (`OPERACION.md:78`).
- Un fallo de TiendaNube y un fallo de AdminApp se ven iguales para el usuario:
  «No se pudo sincronizar el stock con TiendaNube». → **FR-060 a FR-063**.

**12. `checkSubscription` exime `/api/tiendanube` entero.**
`middleware/checkSubscription.js:4-8`. Para `/callback` y `/webhook` está bien:
no tienen sesión y el prefijo es lo único que los identifica. **Para `/products`,
`/mapping` y `/sync-stock` no**: una empresa con la suscripción vencida sigue
sincronizando su tienda. Es la misma forma del paywall eludible que
`CONVENCIONES.md` cita entre los tres errores más caros del proyecto.
→ **FR-064**.

**13. No hay ítem de menú, ni ruta, ni módulo.** `components/navegacion.js` no
menciona TiendaNube en ninguno de sus cinco grupos y `App.jsx` no monta ninguna
ruta. El plan (sección 2) dice que el gateo va en los tres lados o no sirve: al
crear la pantalla hay que crear los tres. → **FR-065 a FR-069**.

### Entra solo como advertencia visible

**7. Un pedido de la tienda online baja stock y no registra ninguna venta.**
Está escrito como LIMITACIÓN CONOCIDA arriba del método
(`tiendanubeService.js:96-100`) y en `docs/ANALISIS.md`:

> baja el inventario pero **NO registra una venta**. Los pedidos de la tienda
> online no aparecen en facturación, ni en el flujo de caja, ni en los reportes:
> el stock desaparece sin ingreso asociado.

**No entra**: registrar la venta implica decidir tipo de comprobante, punto de
venta de AFIP, cliente, medio de pago y numeración, y eso es una funcionalidad
propia. Lo que **sí** entra es que la pantalla lo diga, porque hoy dice lo
contrario: «sincronización bidireccional» (`Settings.jsx:395`). Sin ese aviso, el
dueño cierra la caja con una diferencia que no puede explicar y el sistema no le
da ninguna pista. → **FR-073, FR-074**.

### Queda anotado, fuera de alcance

**14. El token está en texto plano en `settings.value`.** Es exactamente la misma
condición que la clave privada de AFIP, que tiene su propio proyecto pendiente:
`PROXIMOS-PROYECTOS.md`, sección 6 — «Está en texto plano en la base. Es material
fiscal del cliente. Quedó anotado desde la auditoría de aislamiento y sigue
pendiente».

**Ser coherente con esa decisión es no resolverlo acá.** Cifrar el token de
TiendaNube y dejar la clave de AFIP como está deja el secreto más caro sin
proteger y agrega dos mecanismos distintos para el mismo problema. Cuando se
haga, se hace para los dos, en ese proyecto.

Lo que **sí** exige esta funcionalidad, y es la parte que sí depende de ella:
**no empeorarlo**. El token no sale nunca en ninguna respuesta de la API —ni
entero, ni truncado, ni «los últimos cuatro»—, no se escribe en ningún log fuera
del logger con su redacción, y la pantalla de estado no lo muestra de ninguna
forma. Ver [PENDIENTE N6] y **FR-075 a FR-077**.

---

## Vocabulario: qué significa cada palabra acá

Sin esto, «producto» quiere decir dos cosas distintas en la misma pantalla.

| Palabra | Qué significa | Dónde vive |
|---|---|---|
| **Tienda** | La tienda de TiendaNube de **una** empresa. Se identifica con el `user_id` que devuelve el OAuth, que TiendaNube también manda como `store_id` en el webhook | `settings` clave `tiendanube_user_id` |
| **Producto** (a secas) | El del sistema. Es el que tiene costo, stock por sucursal y precio | `products` |
| **Producto de TiendaNube** | El de la tienda. **No es la unidad que tiene stock** | la API de TiendaNube |
| **Variante** | La unidad de la tienda que **sí** tiene stock y contra la que se mapea. Un producto de TiendaNube con talles o colores tiene varias | la API de TiendaNube |
| **Mapeo** | La correspondencia entre **un** producto del sistema y **una** variante de la tienda. Uno a uno en las dos direcciones, por los dos índices únicos | `tiendanube_mappings` |
| **Vinculación** | Que la empresa haya completado el OAuth y AdminApp tenga su token. Es de la **tienda**, no de un producto |
| **Sincronizar stock** | Empujar el número de AdminApp hacia TiendaNube. **Va en un solo sentido** |
| **Pedido** | Una compra hecha en la tienda online. Llega por webhook cuando se paga | evento `order/paid` |
| **Corrida** | Una ejecución de la sincronización, con su hora, su disparador y su resultado. **Hoy no existe** |
| **Cantidad** (`quantity`) | Lo que hay. «cant» del sistema original | `stock.quantity` |
| **Disponible** (`available`) | Lo que se puede vender. «disp» del sistema original | `stock.available` |

### En qué dirección va cada dato

Es lo que más caro sale de una integración si no está escrito. Esta tabla es la
regla; lo que queda ambiguo está marcado.

| Dato | Dirección | Quién manda | Estado |
|---|---|---|---|
| **Stock** | AdminApp → TiendaNube | **AdminApp.** El número de la tienda es un espejo, no una fuente: la sincronización lo pisa | Existe (`syncStock`), con los defectos del hallazgo 5 |
| **Pedidos** | TiendaNube → AdminApp | TiendaNube | Existe (`order/paid`), muerto por el hallazgo 1 |
| **Catálogo (alta de productos)** | — | Nadie | **No existe y no entra.** Los productos se crean en cada lado y después se mapean |
| **Precios** | — | Nadie | **No existe y no entra.** Ver [PENDIENTE N8] |
| **Mapeo** | AdminApp | AdminApp | Lo escribe una persona en AdminApp; TiendaNube no lo conoce |

**El conflicto que esto deja abierto, y que hay que mirar de frente:** un pedido
paga a las 10:00 y descuenta stock local; la sincronización corre a las 10:05 y
empuja el número local a TiendaNube. Los dos movimientos son consistentes **solo
si el descuento por pedido funciona**. Si el webhook falla —hoy falla siempre— la
sincronización **le devuelve a TiendaNube el stock que la tienda ya vendió**, y
la tienda vuelve a venderlo. Es decir: el hallazgo 1 y el hallazgo 5 juntos son
peores que cada uno por separado, y por eso los dos entran en el mismo hito.

Lo que sigue abierto es **cuál de los dos números se publica** ([PENDIENTE 2]) y
**de qué sucursal sale** ([PENDIENTE 3]).

---

## Qué se verifica en qué nivel

`docs/specs/CONVENCIONES.md` fija la tabla —tres niveles en `apps/web` y un
cuarto en `apps/api`—; acá se aplica caso por caso, que es donde se equivoca.
**Primero la función pura.** El navegador es el último recurso. Y **el cuarto
nivel no es opcional en esta funcionalidad**: la idempotencia y el aislamiento
ejecutado no los puede contestar un doble.

| Afirmación | Nivel | Archivo |
|---|---|---|
| El estado de un mapeo —mapeado / sin mapear / producto borrado— y el tono de su badge | **Función pura** | `utils/tiendanube.js` |
| El estado de la conexión —sin configurar / no vinculada / vinculada / vinculada con error— y su tono | **Función pura** | idem |
| El resumen legible de una corrida: cuántas se mandaron, cuántas fallaron, hace cuánto | **Función pura** | idem |
| Normalizar la respuesta de TiendaNube a filas de variante (producto + variante + SKU + stock) | **Función pura** | idem — y con una fixture que **tenga más de una página** |
| La sugerencia de mapeo por SKU coincidente | **Función pura** | idem — con SKU repetidos, vacíos y con distinta capitalización |
| Que el badge «sin mapear» esté **en la fila de la variante que corresponde** | **Test de render** | `tests/renderDeTiendanube.test.jsx` |
| Que el encabezado y las filas compartan `grid-template-columns` | **Test de render** | idem |
| Que «Sincronizar stock» quede **deshabilitado con su explicación** sin `config.editar`, y no ausente | **Test de render** | idem |
| Que un 429 o un 502 muestren un aviso legible y **no cierren** el panel ni pierdan lo escrito | **Test de render** | idem |
| Que apretar «Sincronizar» dos veces mande **una sola** llamada | **Test de render**, espiando `api.post` | idem |
| Que la pantalla diga que los pedidos no registran venta | **Test de render** | idem |
| Que `/tiendanube` esté adentro del marco y el `<body>` no desborde a 1140px | **Prueba de navegador** | `pruebas-de-navegador/marcoDeLasPantallas.navegador.js` (pasa de diecisiete rutas a dieciocho) |
| Que un nombre de variante largo no se meta en la columna de acciones | **Prueba de navegador** | idem |
| **Que el webhook reciba el cuerpo crudo**: dos entregas idénticas descuentan **una sola vez** | **Integración** | `src/tests/integracion/tiendanubeWebhook.integracion.test.js` |
| **Dos entregas en paralelo** del mismo pedido: una gana, la otra choca contra el índice único | **Integración** | idem — es la mitad que un test secuencial no toca |
| Un pedido que falla a la mitad **no queda marcado como procesado** | **Integración** | idem |
| La empresa B no ve, no crea y no borra mapeos de la A | **Integración** | `src/tests/integracion/tiendanubeAislamiento.integracion.test.js` |
| Dos empresas no pueden vincular el mismo `store_id` | **Integración** | idem — es una restricción de la base |
| Borrar un producto borra su mapeo (`ON DELETE CASCADE`) | **Integración** | idem |
| Que ningún endpoint escriba un hijo bajo un padre sin validar | **Guardia estática** | `tests/aislamientoEmpresas.test.js` — el patrón que la funcionalidad 012 introdujo |
| **Que el webhook se monte con su parser de cuerpo crudo antes que el global**, o con la exclusión que lo haga posible | **Guardia estática** | `tests/observabilidad.test.js` o una guardia propia. Es el hallazgo 1, y una guardia estática es lo único que impide que vuelva con el próximo `app.use` |
| Que ninguna llamada saliente de `tiendanubeService.js` quede sin `timeout` | **Guardia estática** | idem |

**Lo que NO baja al navegador**, aunque se pueda escribir: el color de un badge,
qué variantes entran en un filtro, el texto del resumen de la corrida. Todo eso
lo contesta una función pura.

**Y una advertencia sobre las fixtures**, que es donde este proyecto más se
equivocó: la respuesta de TiendaNube de la fixture tiene que tener **más de una
página**, **al menos un producto con varias variantes**, **una variante con SKU
vacío**, **una variante ya mapeada y otra no**, y **un producto del sistema sin
fila de stock en la sucursal**. Una fixture de tres productos de una variante
cada uno, todos mapeados, pasa con y sin la mitad de los defectos de arriba.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Vincular la tienda y ver el estado real de la conexión (Priority: P1)

Como dueño, quiero conectar mi tienda de TiendaNube desde una pantalla propia y
ver de un vistazo si está conectada, con cuál tienda y desde cuándo, para saber
si el sistema está hablando con mi tienda sin tener que probar una venta.

**Why this priority**: es el primer punto de la sección 4.10 y **hoy es
imposible**: el circuito de OAuth termina siempre en error por el hallazgo 2.
Todo lo demás de esta funcionalidad necesita una tienda vinculada.

**Independent Test**: entrar a `/tiendanube` sin tienda vinculada, completar el
OAuth y verificar que la pantalla queda mostrando la tienda vinculada. Es
verificable contra hoy, donde termina en `?tiendanube=error&motivo=sin_empresa`.

**Acceptance Scenarios**:

1. **Given** una empresa sin tienda, **When** entro a `/tiendanube`, **Then**
   veo el estado vacío con dos líneas y una acción principal «Conectar con
   TiendaNube».
2. **Given** aprieto conectar, **When** el navegador va a TiendaNube, **Then**
   la URL lleva un `state` que identifica a mi empresa **y que no es adivinable**
   ([PENDIENTE 1]).
3. **Given** vuelvo del OAuth, **When** el callback procesa el `code`, **Then**
   el token queda guardado **bajo mi empresa** y la pantalla muestra la tienda
   vinculada, sin que yo tenga que recargar.
4. **Given** un callback con un `state` que no corresponde a ninguna empresa,
   o vencido, o ya usado, **When** llega, **Then** **no se guarda ningún token**
   y el usuario ve un mensaje que dice qué pasó. Hoy dice «Error al vincular
   TiendaNube» y nada más (`Settings.jsx:69`).
5. **Given** un callback sin `code`, **When** llega, **Then** tampoco se guarda
   nada y el mensaje lo distingue del caso anterior.
6. **Given** una tienda vinculada, **When** miro el bloque de estado, **Then**
   veo **qué tienda** —su nombre y su id—, **desde cuándo** y **si la API
   contesta**. Hoy `GET /status` devuelve solo un booleano (`:53-61`).
7. **Given** una tienda vinculada, **When** miro el bloque de estado, **Then**
   **no veo el token de ninguna forma**: ni entero, ni truncado, ni sus últimos
   caracteres.
8. **Given** una tienda vinculada, **When** aprieto «Desvincular», **Then** se
   me pide confirmación que diga qué se pierde —los mapeos, o no— y al confirmar
   **el token y el id de tienda se borran de mi empresa**. Hoy no existe
   (hallazgo 9).
9. **Given** el servidor sin `TIENDANUBE_CLIENT_ID`, **When** entro, **Then** la
   pantalla dice que la integración **no está configurada en el servidor** y no
   ofrece conectar. Es un estado distinto de «no vinculada» y el endpoint ya lo
   distingue (`:12-14`).
10. **Given** que `GET /status` falla, **When** entro, **Then** la pantalla dice
    que no pudo comprobar el estado. **No dice «no vinculada»**, que es lo que
    hace hoy `Settings.jsx:78`.
11. **Given** un usuario sin permiso de edición, **When** entro, **Then**
    «Conectar» y «Desvincular» están **deshabilitados con su explicación**, y no
    ausentes.

---

### User Story 2 — El pedido de la tienda descuenta stock, una sola vez y entero (Priority: P1)

Como dueño, quiero que una venta de mi tienda online baje el inventario de
AdminApp exactamente una vez, para que el stock que veo sea el que tengo.

**Why this priority**: es el hallazgo 1 más el 6. Hoy **no descuenta nunca**, y
el error del que se descuente dos veces —o la mitad— es de los que aparecen en un
recuento físico tres meses después, cuando ya no se puede reconstruir qué pasó.
Es la primera línea del encabezado de `descuentoDeStock.test.js`.

**Independent Test**: postear un `order/paid` firmado contra la API real
levantada y verificar contra la base que el stock bajó y que hay un
`StockMovement` con `referencia_id = tn_order_{id}`. Verificable contra hoy,
donde responde 401 y no pasa nada.

**Acceptance Scenarios**:

1. **Given** un webhook con firma válida, **When** llega, **Then** `req.rawBody`
   está poblado y la firma se verifica contra el **cuerpo crudo**, byte a byte.
2. **Given** el mismo webhook con firma inválida, **When** llega, **Then** se
   rechaza y **queda registrado** con el evento y el origen.
3. **Given** un `order/paid` de una tienda vinculada, **When** llega, **Then**
   el stock de cada ítem mapeado baja en `quantity` **y** en `available`, y
   queda un `StockMovement` de tipo `tiendanube_sale` por cada uno.
4. **Given** el mismo pedido entregado **dos veces seguidas**, **When** llegan,
   **Then** el stock baja **una sola vez**.
5. **Given** el mismo pedido entregado **dos veces en paralelo**, **When**
   llegan, **Then** el stock baja **una sola vez**, y lo que lo garantiza es una
   **restricción de la base** y no el orden en que se ejecutaron. Es la mitad que
   un test secuencial no toca.
6. **Given** un pedido de cinco ítems donde el tercero falla, **When** se
   procesa, **Then** **o se descuentan los cinco o no se descuenta ninguno**, y
   el pedido **no queda marcado como procesado**. Hoy quedan dos descontados para
   siempre y el reintento dice «ya procesado».
7. **Given** un ítem cuya variante **no está mapeada**, **When** llega el pedido,
   **Then** el pedido se procesa igual **y queda registrado que ese ítem no
   descontó**, con la variante y el pedido. Hoy se saltea en silencio (`:134`).
8. **Given** un ítem mapeado a un producto **sin fila de stock en la sucursal**,
   **When** llega, **Then** vale lo mismo: se registra y se puede ver desde la
   pantalla.
9. **Given** un pedido de una tienda que **no está vinculada a ninguna empresa**,
   **When** llega, **Then** se responde 200 —para que TiendaNube no reintente— y
   queda registrado. Ya está así (`:129-133`) y no se toca.
10. **Given** cualquier camino, **When** el webhook termina, **Then** responde
    **200** salvo en el rechazo por firma. Es lo que evita que TiendaNube
    deshabilite el webhook, y es lo que el comentario del archivo ya dice
    (`:104-105`).
11. **Given** un evento que no es `order/paid`, **When** llega, **Then** se
    responde 200 sin procesar. Ya está así y **no se agrega `order/created`**:
    procesar los dos descontaba el stock dos veces por la misma venta.
12. **Given** el rate limiter de `/api/` (`server.js:253-260`), **When** una
    tienda con mucho movimiento manda muchos webhooks, **Then** **no se los
    come el límite pensado para el navegador**. Un 429 al webhook es un pedido
    que no descuenta.

---

### User Story 3 — Mapear los productos del sistema contra las variantes de la tienda (Priority: P1)

Como dueño, quiero ver mis productos y las variantes de mi tienda lado a lado y
decir cuál es cuál, para que el stock que se sincroniza sea el del producto
correcto.

**Why this priority**: es el segundo punto de la sección 4.10 y **es la
precondición de las otras dos**: sin mapeo, ni el pedido descuenta ni la
sincronización empuja nada.

**Independent Test**: con una tienda de más de una página de productos, mapear
tres variantes, recargar la pantalla y verificar que siguen mapeadas y que las
demás siguen marcadas «sin mapear».

**Acceptance Scenarios**:

1. **Given** una tienda vinculada, **When** entro al bloque de mapeo, **Then**
   veo una tabla construida con `TablaGrid` con una fila **por variante** —no por
   producto de TiendaNube—, porque la variante es la unidad que tiene stock.
2. **Given** la tabla, **When** miro el encabezado, **Then** sus etiquetas van en
   `.eyebrow` y su `grid-template-columns` es **el mismo string** que el de las
   filas.
3. **Given** una fila, **When** la miro, **Then** veo el producto y la variante
   de la tienda, su SKU, el stock que publica la tienda, el producto del sistema
   al que está mapeada —o el badge «Sin mapear»— y el stock del sistema. Los
   números van en `.num`.
4. **Given** una tienda con más productos de los que entran en una página,
   **When** miro la lista, **Then** **están todos**, paginados. Hoy solo llega la
   primera página de TiendaNube y **nada avisa** (hallazgo 10).
5. **Given** una fila sin mapear, **When** la toco, **Then** se abre un panel
   lateral de 520px donde elijo el producto del sistema con búsqueda por nombre
   y por SKU.
6. **Given** el panel, **When** hay un producto del sistema con **el mismo SKU**
   que la variante, **Then** aparece **sugerido y marcado como sugerencia**, y
   **hay que confirmarlo**. Nunca se mapea solo: un SKU repetido en dos productos
   mapearía el equivocado y nadie lo miraría.
7. **Given** que confirmo el mapeo, **When** se guarda, **Then** la fila queda
   mapeada sin recargar la página.
8. **Given** un producto del sistema que **ya está mapeado a otra variante**,
   **When** intento mapearlo de nuevo, **Then** la pantalla lo dice **nombrando
   la otra variante**, y el error llega como mensaje legible y no como un 500
   (hoy `:169`).
9. **Given** una variante **ya mapeada a otro producto**, **When** intento
   mapearla, **Then** vale lo mismo, por el otro índice único.
10. **Given** un mapeo existente, **When** aprieto «Quitar mapeo», **Then** se
    borra y la fila vuelve a «Sin mapear». Hoy no existe (hallazgo 9).
11. **Given** un mapeo cuyo producto del sistema fue **eliminado del catálogo**,
    **When** miro la lista, **Then** la variante aparece como «Sin mapear»: la FK
    es `ON DELETE CASCADE` (`20260606:31`) y el mapeo desaparece solo. La
    pantalla **no puede mostrar una fila rota**.
12. **Given** una tienda vinculada y sin productos, **When** miro, **Then** veo
    un estado vacío que lo dice, distinto del de «sin tienda vinculada».
13. **Given** un filtro que no devuelve nada —«solo sin mapear» con todo
    mapeado—, **When** lo aplico, **Then** el estado vacío dice que es el filtro
    y no que no hay productos.
14. **Given** un usuario sin `config.editar` ([PENDIENTE N1]), **When** entro,
    **Then** veo los mapeos y **no puedo cambiarlos**, con la explicación a la
    vista.
15. **Given** el archivo terminado, **When** lo reviso, **Then** no tiene ningún
    hexadecimal, ninguna regla `dark:`, ninguna clase de la paleta de Tailwind ni
    ningún `Table*`, y **está en la lista de `guardiasDeDiseno.test.js`**.

---

### User Story 4 — La tienda, el token y los mapeos son de una empresa y de una sola (Priority: P1)

Como dueño de una empresa cliente, quiero que ninguna otra empresa pueda ver mis
mapeos, crearlos sobre mis productos ni recibir los pedidos de mi tienda, porque
mi tienda es mi negocio.

**Why this priority**: es la regla que no se negocia (`CONVENCIONES.md`,
«Aislamiento entre empresas»), ya se rompió veintiocho veces, y acá aparece con
**dos formas que ninguna guardia existente detecta**: un `create` bajo un padre
sin validar (hallazgo 3) y una tienda que se puede vincular dos veces (hallazgo
4).

**Independent Test**: con dos empresas sembradas, autenticar como la B y hacer
`POST /api/tiendanube/mapping` con un `product_id` de la A. Tiene que responder
404 y no dejar ninguna fila.

**Acceptance Scenarios**:

1. **Given** un producto de la empresa A, **When** la empresa B lo manda en
   `POST /api/tiendanube/mapping`, **Then** responde **404** y **no se crea
   ningún `TiendanubeMapping`**. Verificable contra hoy, donde responde 201.
2. **Given** los mapeos de la empresa A, **When** la empresa B pide el listado,
   **Then** no ve ninguno.
3. **Given** un mapeo de la empresa A, **When** la empresa B intenta borrarlo,
   **Then** responde 404 y **la fila de A queda como estaba**. Una guardia
   estática ve que se llamó a `findScoped`; que la fila ajena siga ahí lo
   contesta el cuarto nivel.
4. **Given** una tienda ya vinculada a la empresa A, **When** la empresa B
   intenta vincular **la misma tienda**, **Then** **se rechaza**, con un mensaje
   que diga que esa tienda ya está vinculada, y la garantía es una **restricción
   de la base** y no una comprobación en el handler.
5. **Given** un webhook de una tienda vinculada, **When** se resuelve a qué
   empresa corresponde, **Then** la respuesta es **una sola empresa**, siempre, y
   no la primera fila que devuelva Postgres.
6. **Given** el código de `routes/` y `controllers/`, **When** corre la guardia
   estática, **Then** **falla si vuelve a aparecer un `Model.create({ …_id:
   req.body.… })` sin que el padre se haya resuelto con `empresa_id`**. Es el
   patrón que introdujo la funcionalidad 012 y ésta es su segunda aparición.
7. **Given** las guardias que ya existen, **When** corre la suite, **Then**
   ninguna de `aislamientoEmpresas.test.js`, `observabilidad.test.js`,
   `permisosDeRutas.test.js` ni `descuentoDeStock.test.js` empieza a fallar, y la
   excepción documentada de `routes/tiendanube.js publico`
   (`permisosDeRutas.test.js:81-85`) sigue diciendo lo mismo.

---

### User Story 5 — Sincronizar el stock y ver el resultado de la última corrida (Priority: P1)

Como dueño, quiero empujar el stock de AdminApp a mi tienda y ver cuándo fue la
última vez, cuántas variantes se actualizaron y cuáles fallaron, para no tener
que abrir TiendaNube a comprobar.

**Why this priority**: es el tercer punto de la sección 4.10, y la parte de «el
resultado de la última corrida» **no existe en ningún lado**: no hay tabla, ni
setting, ni log estructurado del que se pueda leer.

**Independent Test**: con cinco variantes mapeadas y una que falla, disparar la
sincronización y verificar que la pantalla dice «4 actualizadas, 1 con error», la
nombra, y que ese resultado **sigue ahí después de reiniciar el servidor**.

**Acceptance Scenarios**:

1. **Given** mapeos cargados, **When** aprieto «Sincronizar stock», **Then**
   cada variante mapeada recibe **exactamente un** PUT con el stock que
   corresponde. Hoy recibe uno por cada sucursal y gana el último (hallazgo 5).
2. **Given** que la corrida termina, **When** miro la pantalla, **Then** veo
   cuándo empezó, cuánto tardó, cuántas variantes se mandaron, cuántas fallaron y
   **cuáles**, con su motivo.
3. **Given** que reinicio el servidor, **When** vuelvo a la pantalla, **Then**
   **el resultado de la última corrida sigue ahí**. No vive en memoria.
4. **Given** que una variante falla, **When** sigue la corrida, **Then**
   **las demás se intentan igual** y el resultado dice cuáles entraron. Hoy la
   primera que falla corta todo y el conteo se pierde.
5. **Given** una corrida en curso, **When** aprieto «Sincronizar» otra vez,
   **Then** **no arranca una segunda**: el botón queda ocupado y la pantalla dice
   que hay una corriendo.
6. **Given** una corrida que se corta por la mitad —el proceso se cae, la red se
   corta—, **When** vuelvo, **Then** la pantalla dice **qué quedó a medias**, y
   volver a sincronizar es seguro: mandar el mismo stock dos veces deja la tienda
   igual.
7. **Given** un producto mapeado **sin fila de stock en la sucursal que se
   publica**, **When** corre, **Then** queda anotado como no sincronizado y se
   ve. **No se publica cero por omisión**: publicar cero agota una variante que
   sí tiene mercadería.
8. **Given** una variante mapeada a un producto **inactivo** (`is_active:
   false`), **When** corre, **Then** [PENDIENTE N10] decide qué pasa; sea lo que
   sea, la pantalla lo dice.
9. **Given** que no hay ningún mapeo, **When** aprieto «Sincronizar», **Then** la
   pantalla lo dice y **no manda ninguna llamada**.
10. **Given** un usuario sin permiso de edición, **When** miro el botón,
    **Then** está deshabilitado con su explicación.
11. **Given** el disparador que decida [PENDIENTE 4], **When** la sincronización
    corre sola, **Then** su resultado se ve en el mismo lugar que la manual, y se
    distingue quién la disparó.

---

### User Story 6 — Cuando TiendaNube no contesta, contesta lento o contesta 429 (Priority: P2)

Como dueño, quiero que un problema de TiendaNube se vea como un problema de
TiendaNube y no como que AdminApp está roto, y que no deje mi sistema colgado.

**Why this priority**: es lo que separa una integración de una pantalla interna.
Hoy no hay un solo `timeout`, ni un reintento, ni nada que mire un 429, y el
usuario recibe siempre el mismo texto.

**Independent Test**: con un doble de la API de TiendaNube que responda 429, 500
y que no responda nunca, verificar los tres caminos.

**Acceptance Scenarios**:

1. **Given** que TiendaNube no responde, **When** pasa el timeout, **Then** la
   llamada se corta y la pantalla lo dice. **Ninguna llamada saliente queda sin
   `timeout`**, como ya resolvió `afipService.js:86-89`.
2. **Given** un 429, **When** llega, **Then** se espera y se reintenta con
   backoff, respetando lo que diga la respuesta, y **no se pierde el resto de la
   corrida**.
3. **Given** un 401 de TiendaNube —el token dejó de valer—, **When** llega,
   **Then** la pantalla dice que **hay que volver a vincular**, que es distinto
   de «no se pudo sincronizar».
4. **Given** un 5xx de TiendaNube, **When** llega, **Then** se distingue de un
   error de AdminApp en lo que ve el usuario y en lo que queda en el log.
5. **Given** cualquiera de esos errores, **When** se registra, **Then** va por el
   **logger**, con el `requestId` y el `empresaId`, y **no por `console.error`**
   (`tiendanubeService.js:35`), que esquiva la redacción de secretos.
6. **Given** cualquier error que llegue al usuario, **When** lo lee, **Then**
   está en castellano y no trae nombres de tabla, de constraint ni el
   `err.message` crudo. `fallo` y `ErrorDeNegocio` ya resuelven las dos mitades.
7. **Given** una llamada que falla, **When** miro el estado de la conexión,
   **Then** refleja que la última comunicación falló, en vez de seguir diciendo
   «vinculada» sin más.

---

### User Story 7 — La pantalla no promete lo que el sistema no hace (Priority: P2)

Como dueño, quiero que la pantalla me diga qué hace y qué no hace la
integración, para no descubrir en el cierre de caja que las ventas de la tienda
online no están en ningún lado.

**Why this priority**: hoy la tarjeta de Ajustes dice **dos cosas falsas**
—«sincronización bidireccional» (`Settings.jsx:395`) y «El stock se sincroniza
automáticamente mediante webhooks» (`:389`)— y la segunda seguiría siendo
engañosa aun con el hallazgo 1 arreglado. Es la misma familia de error que
`sendEmail` devolviendo `ok: true` sin haber enviado nada: **el sistema informa
un éxito que no ocurrió**.

**Independent Test**: leer la pantalla con la tienda vinculada y verificar que
todo lo que afirma es cierto contra el comportamiento real.

**Acceptance Scenarios**:

1. **Given** la pantalla con tienda vinculada, **When** la leo, **Then** dice
   explícitamente que **un pedido de la tienda baja el inventario pero no
   registra una venta**, y por lo tanto no aparece en facturación, ni en caja, ni
   en reportes.
2. **Given** la pantalla, **When** la leo, **Then** **no dice «bidireccional»**
   sin aclarar qué va en cada sentido: stock hacia la tienda, pedidos hacia
   AdminApp.
3. **Given** la pantalla, **When** la leo, **Then** dice de **qué sucursal** sale
   el stock que se publica ([PENDIENTE 3]) y **qué número** se publica
   ([PENDIENTE 2]).
4. **Given** que un pedido se cancela o se devuelve en TiendaNube, **When** pasa,
   **Then** la pantalla advierte que **el stock no vuelve solo** ([PENDIENTE N5]).
5. **Given** la tarjeta de TiendaNube que hoy vive en `/facturacion`
   (`Settings.jsx:372-403`), **When** se termina esta funcionalidad, **Then**
   **no queda una segunda versión del estado de conexión en otra pantalla**: o se
   saca, o queda como un enlace a `/tiendanube`. Dos lugares que dicen el estado
   de lo mismo se separan y nada avisa.

---

### User Story 8 — El gateo de la pantalla, en los tres lados (Priority: P2)

Como operador de la plataforma, quiero que la pantalla nueva respete los tres
gates del plan, para que una empresa que no contrató la integración no la vea ni
la pueda usar por URL.

**Why this priority**: el plan (sección 2) dice que el gateo va en los tres
lados o no sirve, y una pantalla nueva es la ocasión en la que se olvida uno.
Además hay que corregir la exención de suscripción (hallazgo 12).

**Independent Test**: con el módulo apagado, verificar que el ítem no se dibuja,
que `/tiendanube` redirige y que los endpoints privados responden lo que
corresponde.

**Acceptance Scenarios**:

1. **Given** una empresa con el módulo apagado, **When** miro la barra lateral,
   **Then** el ítem no está.
2. **Given** esa empresa, **When** entro a `/tiendanube` escribiendo la URL,
   **Then** `RouteGuard` la corta, igual que hace `/ordenes-compra`.
3. **Given** un usuario sin el permiso de lectura, **When** llama a los endpoints
   privados, **Then** los rechaza la API y no solo el menú.
4. **Given** una empresa con la **suscripción vencida**, **When** llama a
   `/products`, `/mapping` o `/sync-stock`, **Then** **la corta
   `checkSubscription`**. Hoy `/api/tiendanube` está entero en la lista de
   exentos (`checkSubscription.js:4-8`) y sincroniza igual.
5. **Given** la misma empresa vencida, **When** llega un webhook o vuelve un
   callback, **Then** **siguen exentos**: no tienen sesión y cortarlos rompería
   la integración de quien sí paga al día.
6. **Given** la ruta nueva, **When** corre `tests/marcoDePantalla.test.js`,
   **Then** exige que esté envuelta en `MarcoDePantalla`, y la lista de
   `pruebas-de-navegador/marcoDeLasPantallas.navegador.js` pasa de diecisiete
   rutas a dieciocho.
7. **Given** `permisosDeRutas.test.js`, **When** corre, **Then** **cada ruta
   nueva del router privado declara su permiso**, y el router público sigue con
   su excepción documentada intacta.

---

### User Story 9 — Un solo mecanismo de mapeo (Priority: P3)

Como dueño, quiero que el campo «variante de TiendaNube» del producto no exista o
funcione, porque hoy lo puedo completar y no hace nada.

**Why this priority**: es el hallazgo 8. No rompe nada hoy porque nadie lo usa,
pero es una trampa: el sistema acepta el dato, dice que guardó, y el efecto que
la persona espera no ocurre nunca. Va en P3 porque la pantalla nueva es lo que lo
vuelve visible.

**Independent Test**: buscar en el código el único lector de
`products.tiendanube_variant_id` y verificar que después del cambio hay uno o no
existe el campo.

**Acceptance Scenarios**:

1. **Given** el catálogo, **When** reviso `routes/products.js:44`, **Then**
   `tiendanube_variant_id` **ya no se puede escribir por un camino que no hace
   nada**: o lo lee la integración, o sale de `CAMPOS_EDITABLES`.
2. **Given** una base con ese campo poblado, **When** se decide qué hacer,
   **Then** **queda escrito qué pasa con los datos que ya están**: se migran a
   `tiendanube_mappings`, o se ignoran explícitamente. Un dato que desaparece sin
   que nadie diga que desapareció es el peor de los dos.
3. **Given** la columna, **When** se decide, **Then** **la migración de borrado
   no entra en este hito si hay dudas**: dejar la columna sin escritura es
   reversible; borrarla no.

---

### Edge Cases

**La conexión**

- **Volver a vincular una tienda ya vinculada.** ¿Se pisa el token o se rechaza?
  Hoy `Setting.upsert` lo pisa en silencio (`tiendanubeService.js:22-31`).
- **Vincular una tienda distinta sobre una empresa que ya tenía otra.** Los
  mapeos existentes apuntan a variantes de la tienda vieja: quedan colgados y
  la sincronización va a fallar variante por variante.
- **Desvincular con mapeos cargados.** ¿Se borran, o quedan esperando que se
  vuelva a vincular la misma tienda? Los dos son defendibles y ninguno está
  escrito.
- **El token deja de valer** —el cliente desinstala la app desde TiendaNube—.
  Hoy toda llamada devuelve 401 de TiendaNube y la pantalla diría «vinculada».
- **`TIENDANUBE_CLIENT_SECRET` sin definir.** Todo webhook se rechaza por firma
  inválida (`:73`) y se ve **idéntico** a un intento de suplantación. Un
  despliegue mal configurado y un ataque tienen que distinguirse en el log.
- **Dos pestañas iniciando el OAuth a la vez.** Dos `state` vivos; el segundo
  callback no puede invalidar el primero de forma que rompa.

**El mapeo**

- **Producto de TiendaNube sin variantes o con una sola.** TiendaNube igual
  expone una variante por defecto; la fila es la de la variante.
- **Variante con SKU vacío o repetido.** La sugerencia por SKU no puede
  proponer nada, y menos aún algo equivocado.
- **Dos productos del sistema con el mismo SKU.** El catálogo lo permite; la
  sugerencia tiene que decir que hay más de uno en vez de elegir.
- **Mapear un producto **inactivo** del sistema.** Se puede, y hay que decidir
  qué publica la sincronización ([PENDIENTE N10]).
- **Una variante que se borró en TiendaNube.** El mapeo queda apuntando a un id
  que ya no existe; la sincronización va a fallar en esa variante y la pantalla
  tiene que poder decir «esta variante ya no está en tu tienda».
- **Un producto del sistema que se elimina.** El `ON DELETE CASCADE` se lleva el
  mapeo. La variante vuelve a «sin mapear» y **eso no es un error**.
- **Miles de variantes.** La paginación es del servidor, no del navegador
  (hallazgo 10).

**La sincronización**

- **Ningún mapeo.** No se manda nada y se dice.
- **Stock negativo.** `Math.max(0, quantity)` (`tiendanubeService.js:79`) ya lo
  resuelve y se conserva: TiendaNube no acepta negativos.
- **Producto mapeado sin fila de stock en la sucursal.** No se publica cero por
  omisión: ver US5 escenario 7.
- **La corrida se corta a la mitad.** Ver US5 escenario 6. **Qué queda escrito
  del lado de TiendaNube: las variantes que ya se mandaron, y ninguna otra.** Es
  seguro porque el PUT es idempotente —manda el número absoluto, no un delta—.
- **Dos corridas a la vez** —una manual y una automática de [PENDIENTE 4]—. No
  pueden pisarse.
- **Una corrida mientras entra un pedido.** Ver «En qué dirección va cada dato»:
  la sincronización publica el número local, que ya tiene el descuento **si el
  webhook funcionó**.

**El pedido**

- **Pedido con un ítem de cantidad cero o sin `variant_id`.** Se saltea
  (`:129`); tiene que quedar registrado.
- **Pedido de una tienda no vinculada.** 200 y registro (`:129-133`). Ya está.
- **Pedido cancelado o devuelto.** El stock **no vuelve** ([PENDIENTE N5]).
- **`order/paid` de un pedido ya pagado antes** —cambio de medio de pago—.
  La referencia `tn_order_{id}` lo cubre, y por eso el índice único importa.
- **El mismo pedido llegando después de desvincular y volver a vincular.**
  La referencia sigue siendo la misma: no se descuenta dos veces.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Vinculación y estado de la conexión

- **FR-001**: La URL de autorización DEBE llevar un `state` que identifique a la
  empresa que inició el flujo, y ese `state` **NO DEBE ser adivinable** ni
  reutilizable. Cómo se construye es [PENDIENTE 1].
- **FR-002**: `handleCallback` DEBE seguir rechazando el callback que no traiga
  un `state` resoluble, y **NO DEBE** volver a inferir la empresa por ningún otro
  medio.
- **FR-003**: Un `state` desconocido, vencido o ya usado DEBE terminar sin
  guardar ningún token, con un motivo distinguible del de «sin código».
- **FR-004**: `GET /status` DEBE devolver, además de si está vinculada: qué
  tienda, desde cuándo, y si la última comunicación con la API fue correcta.
- **FR-005**: DEBE existir una forma de **desvincular** que borre el token y el
  id de tienda de esa empresa, con confirmación que diga qué se pierde.
- **FR-006**: El estado DEBE distinguir cuatro situaciones: **sin configurar en
  el servidor** (`TIENDANUBE_CLIENT_ID` ausente), **no vinculada**, **vinculada**
  y **vinculada con la última comunicación fallida**. Un fallo de `/status` NO
  DEBE mostrarse como «no vinculada».

#### El webhook

- **FR-020**: El webhook DEBE recibir el **cuerpo crudo** y verificar la firma
  HMAC contra él. La solución DEBE contemplar que `express.json()` está montado
  globalmente en `server.js:149`.
- **FR-021**: DEBE existir una **guardia estática** que falle si el webhook
  vuelve a quedar sin acceso al cuerpo crudo. Es lo único que impide que el
  próximo `app.use` lo rompa de nuevo sin que nadie se entere.
- **FR-022**: Un webhook con firma inválida DEBE rechazarse y **registrarse** con
  el evento y el origen.
- **FR-023**: Todo otro camino del webhook DEBE responder **200**, para que
  TiendaNube no lo deshabilite.
- **FR-024**: El webhook DEBE seguir procesando **solo** `order/paid`.
- **FR-025**: El descuento de un pedido DEBE ser **atómico**: o descuentan todos
  sus ítems o ninguno, y un pedido que falló **no** queda marcado como procesado.
- **FR-026**: La idempotencia DEBE sostenerse en una **restricción de la base**
  sobre `(empresa_id, referencia_id)` de `stock_movements`, y no en un `findOne`
  previo. Dos entregas en paralelo DEBEN descontar una sola vez.
- **FR-027**: Un ítem que no descuenta —variante sin mapear, producto sin fila de
  stock— DEBE quedar registrado con su pedido y su variante, y DEBE poder verse
  desde la pantalla.
- **FR-028**: El descuento DEBE seguir bajando `quantity` **y** `available`, y la
  sucursal DEBE seguir saliendo de `resolverSucursal` (ver [PENDIENTE 3]).
- **FR-029**: Los webhooks NO DEBEN quedar sujetos al rate limiter pensado para
  el navegador (`server.js:253-260`).

#### El mapeo

- **FR-030**: `POST /mapping` DEBE verificar que el `product_id` sea de la
  empresa de la sesión **antes** de crear la fila, con `findScoped` /
  `assertEmpresaId`.
- **FR-031**: `POST /mapping` DEBE validar que los tres ids sean enteros.
- **FR-032**: El choque de cualquiera de los dos índices únicos DEBE llegar como
  **mensaje de negocio legible** que nombre con qué está mapeado, y no como 500.
- **FR-033**: DEBE existir un endpoint para **listar** los mapeos de la empresa,
  paginado, con el producto del sistema y la variante.
- **FR-034**: DEBE existir un endpoint para **borrar** un mapeo, acotado a la
  empresa.
- **FR-035**: La relación DEBE seguir siendo **uno a uno** en los dos sentidos:
  los dos índices únicos se conservan.
- **FR-036**: Una tienda (`tiendanube_user_id`) NO DEBE poder quedar vinculada a
  más de una empresa, y la garantía DEBE ser una **restricción de la base**.
- **FR-037**: La resolución de empresa desde el webhook DEBE devolver **una sola**
  empresa o ninguna, nunca «la primera que aparezca».
- **FR-038**: Ningún endpoint privado DEBE devolver mapeos, productos ni estado
  de otra empresa.
- **FR-039**: DEBE existir una guardia estática que falle ante un `create` de una
  fila hija con un id del cuerpo sin que el padre se haya resuelto con
  `empresa_id`.

#### La sincronización de stock

- **FR-040**: Cada variante mapeada DEBE recibir **exactamente un** PUT por
  corrida, con el número que corresponde a la sucursal que se publica.
- **FR-041**: Un fallo en una variante NO DEBE cortar la corrida: las demás se
  intentan y el resultado dice cuáles entraron.
- **FR-042**: La corrida DEBE dejar un registro **persistente** con: cuándo
  empezó, cuánto tardó, quién la disparó, cuántas variantes se mandaron, cuántas
  fallaron y **cuáles**, con su motivo.
- **FR-043**: El resultado de la última corrida DEBE verse en la pantalla y DEBE
  sobrevivir un reinicio del servidor.
- **FR-044**: No DEBEN correr dos sincronizaciones a la vez para la misma
  empresa.
- **FR-045**: Volver a sincronizar DEBE ser seguro: el PUT manda el número
  absoluto, así que repetirlo deja la tienda igual.
- **FR-046**: Un producto mapeado **sin fila de stock** en la sucursal que se
  publica NO DEBE publicarse como cero: se anota y se ve.
- **FR-047**: Toda llamada saliente a TiendaNube DEBE tener `timeout`, y DEBE
  haber una guardia estática que lo verifique.
- **FR-048**: Un 429 DEBE reintentarse con backoff, respetando lo que indique la
  respuesta, sin perder el resto de la corrida.
- **FR-049**: Un 401 de TiendaNube DEBE reflejarse como «hay que volver a
  vincular», distinto de un fallo genérico.

#### La pantalla

- **FR-050**: DEBE existir una ruta propia con su pantalla, envuelta en
  `MarcoDePantalla`, y DEBE entrar en `tests/marcoDePantalla.test.js` y en la
  lista de `marcoDeLasPantallas.navegador.js`.
- **FR-051**: La tabla de variantes DEBE usar `TablaGrid` / `Encabezado` /
  `Fila` / `BotonDeFila`, con el **mismo string** de `grid-template-columns` en
  el encabezado y en las filas.
- **FR-052**: La fila DEBE ser por **variante**, no por producto de TiendaNube.
- **FR-053**: El detalle y el formulario de mapeo DEBEN ir en **panel lateral**
  (`ui/sheet.jsx`), de 520px con `max-w-[92vw]`, y no en un modal.
- **FR-054**: Los badges DEBEN traer las **tres** clases juntas desde una función
  pura que nunca devuelva `undefined`.
- **FR-055**: DEBE haber cuatro estados vacíos distintos, con dos líneas cada
  uno: sin tienda, tienda sin productos, sin mapeos, filtro sin resultados.
- **FR-056**: Los archivos nuevos DEBEN entrar en la lista de
  `guardiasDeDiseno.test.js` **antes** de escribirse, y no DEBEN contener
  hexadecimales, `dark:`, clases de la paleta de Tailwind ni `Table*`.
- **FR-057**: El listado de productos de la tienda DEBE traer **todas** las
  páginas de TiendaNube, paginado desde el servidor.
- **FR-058**: La pantalla DEBE decir cuántas variantes hay en total y cuántas
  están mapeadas.
- **FR-059**: DEBE haber filtro por «solo sin mapear» y búsqueda por nombre y por
  SKU.

#### Errores y observabilidad

- **FR-060**: Ningún camino de esta integración DEBE usar `console.error`. Todo
  va por el logger, que es el que aplica la redacción de secretos.
- **FR-061**: Los handlers DEBEN usar `fallo(req, res, err, …)` y
  `ErrorDeNegocio`, en vez de armar la respuesta a mano.
- **FR-062**: Un error de TiendaNube DEBE distinguirse de un error de AdminApp en
  lo que ve el usuario y en lo que queda en el log.
- **FR-063**: Ningún mensaje al usuario DEBE traer `err.message` crudo, nombres
  de tabla ni de constraint.

#### Gateo

- **FR-064**: `/products`, `/mapping` y `/sync-stock` DEBEN quedar sujetos a
  `checkSubscription`. `/callback` y `/webhook` siguen exentos.
- **FR-065**: El ítem DEBE existir en `components/navegacion.js` con su `modulo`
  y su `permission`.
- **FR-066**: La ruta DEBE llevar `RouteGuard` con el mismo módulo.
- **FR-067**: Cada ruta nueva del router privado DEBE declarar su permiso, y
  `permisosDeRutas.test.js` DEBE seguir en verde.
- **FR-068**: La excepción documentada de `routes/tiendanube.js publico`
  (`permisosDeRutas.test.js:81-85`) DEBE seguir diciendo lo mismo o achicarse.
- **FR-069**: La pantalla NO DEBE ser `soloSuperadmin`: el plan la lista entre lo
  que **ve el cliente** (sección 1).

#### El campo muerto

- **FR-070**: `products.tiendanube_variant_id` NO DEBE quedar escribible por un
  camino que no produce ningún efecto.
- **FR-071**: DEBE quedar escrito qué pasa con los valores ya cargados en esa
  columna.
- **FR-072**: La columna NO se borra en este hito si hay dudas: sacarla de
  `CAMPOS_EDITABLES` es reversible; el `DROP COLUMN` no.

#### Lo que la pantalla tiene que decir

- **FR-073**: La pantalla DEBE decir explícitamente que un pedido de la tienda
  **baja inventario y no registra una venta**, y qué consecuencias tiene.
- **FR-074**: La pantalla NO DEBE afirmar «sincronización bidireccional» sin
  aclarar qué va en cada sentido, ni «se sincroniza automáticamente» si no hay un
  disparador automático ([PENDIENTE 4]).

#### El secreto

- **FR-075**: El token NO DEBE salir en ninguna respuesta de la API, ni entero ni
  parcial.
- **FR-076**: El token NO DEBE aparecer en ningún log fuera del logger con su
  redacción (`utils/logger.js:63-67`) ni llegar a Sentry (`config/sentry.js:55`).
- **FR-077**: Esta funcionalidad NO cifra el token en reposo, **y no puede
  agregar ningún lugar nuevo donde el token quede en claro**. El cifrado es el
  proyecto 6 de `PROXIMOS-PROYECTOS.md` y se hace para AFIP y TiendaNube juntos.

---

### Key Entities

| Entidad | Campos que importan acá |
|---|---|
| `TiendanubeMapping` | `id`, `empresa_id`, `product_id`, `tiendanube_variant_id`, `tiendanube_product_id`. Únicos: `(empresa_id, product_id)` y `(empresa_id, tiendanube_variant_id)`. FK a `empresas` y `products` con `ON DELETE CASCADE` |
| `Setting` | PK compuesta `(key, empresa_id)`, `value` JSONB. Claves de esta integración: `tiendanube_access_token`, `tiendanube_user_id` |
| `Product` | `id`, `empresa_id`, `name`, `sku`, `is_active`, `tiendanube_variant_id` (**la columna muerta**, FR-070) |
| `Stock` | `product_id`, `empresa_id`, `punto_de_venta_id`, `quantity`, `available` |
| `StockMovement` | `empresa_id`, `product_id`, `punto_de_venta_id`, `tipo` (`tiendanube_sale`), `referencia_id` (`tn_order_{id}`), las cuatro cantidades y `usuario_id` (hoy el literal `'tiendanube'`) |
| `PuntoDeVenta` | `id`, `name`, `code`, `is_active`, `empresa_id` — la sucursal que se publica es [PENDIENTE 3] |
| **Corrida de sincronización** | **No existe.** Dónde vive el registro de FR-042 es [PENDIENTE 4] |
| **`state` del OAuth** | **No existe.** Su forma es [PENDIENTE 1] |

**Migraciones**: al menos el índice único de FR-026 sobre `stock_movements`, la
restricción de FR-036 sobre la tienda vinculada, y lo que resuelvan
[PENDIENTE 1] y [PENDIENTE 4]. El detalle es trabajo de `sdd-plan`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. Se puede vincular una tienda de punta a punta y el token queda bajo la empresa
   correcta. Verificable contra hoy, donde el circuito termina siempre en
   `?tiendanube=error&motivo=sin_empresa`.
2. Un `order/paid` firmado descuenta stock. Verificable contra hoy, donde
   responde 401 y no descuenta nada.
3. El mismo pedido entregado dos veces **en paralelo** descuenta una sola vez, y
   lo que lo garantiza es una restricción de la base.
4. Un pedido que falla a la mitad no deja stock descontado parcialmente ni queda
   marcado como procesado.
5. Un ítem que no descontó —variante sin mapear, producto sin stock en la
   sucursal— se puede ver desde la pantalla. Hoy se saltea en silencio.
6. La empresa B no puede crear un mapeo sobre un producto de la A: responde 404 y
   no queda ninguna fila. Verificable contra hoy, donde responde 201.
7. Dos empresas no pueden vincular la misma tienda.
8. Se pueden listar, crear y borrar mapeos desde la pantalla, y un mapeo repetido
   se explica nombrando con qué choca en vez de responder 500.
9. Una tienda con más de una página de productos muestra **todos** sus productos.
   Verificable contra hoy, donde muestra la primera página y nada avisa.
10. Cada variante mapeada recibe un solo PUT por corrida. Verificable contra hoy,
    donde recibe uno por sucursal y gana el último.
11. Una corrida con una variante que falla informa «N actualizadas, 1 con error»
    nombrándola, y las demás se intentaron. Verificable contra hoy, donde la
    primera que falla se lleva el conteo.
12. El resultado de la última corrida sigue visible después de reiniciar el
    servidor.
13. Ninguna llamada saliente queda sin `timeout`, y hay una guardia que lo
    verifica.
14. Un 429 se reintenta con backoff y no pierde el resto de la corrida.
15. No queda un solo `console.error` en el camino de esta integración.
16. La pantalla dice que los pedidos no registran venta, y no afirma nada que el
    sistema no haga.
17. Una empresa con la suscripción vencida no puede sincronizar. Verificable
    contra hoy, donde puede.
18. El ítem, la ruta y los endpoints respetan el mismo módulo y el mismo permiso.
19. `products.tiendanube_variant_id` no se puede escribir por un camino que no
    hace nada.
20. El token no aparece en ninguna respuesta de la API ni en ningún log fuera del
    logger con su redacción.
21. La pantalla nueva está en la lista de `guardiasDeDiseno.test.js`, no tiene
    hexadecimales, `dark:`, clases de la paleta ni `Table*`, y su tabla comparte
    `grid-template-columns` entre encabezado y filas.
22. `/tiendanube` está adentro del marco de 1320px y el `<body>` no desborda a lo
    ancho a 1140px, verificado en navegador.
23. **TiendaNube pasa de cero tests a tener los tres niveles que le
    corresponden**: funciones puras, render, y los dos archivos de integración
    contra Postgres. Hoy no tiene ninguno de comportamiento.
24. `npm run test:api`, `npm run test:web`, `npm --prefix apps/api run
    test:integracion` y `npm run build` pasan, y las guardias de aislamiento,
    observabilidad, permisos de rutas, descuento de stock y diseño siguen
    limpias.
25. Cada criterio de aceptación tiene al menos un test que **falla** si se
    revierte el cambio que lo implementa.

---

## Fuera de alcance

Explícito, para que no se discuta después si estaba incluido.

- **Registrar una venta por cada pedido de la tienda online.** Es el hallazgo 7 y
  es una funcionalidad propia: implica decidir tipo de comprobante, punto de
  venta de AFIP, cliente, medio de pago y numeración. Acá **solo se advierte**.
- **Facturar los pedidos de la tienda online ante AFIP.** Consecuencia del punto
  anterior.
- **Cifrar el token en reposo.** Es el proyecto 6 de `PROXIMOS-PROYECTOS.md` y se
  hace junto con la clave privada de AFIP, o no se hace.
- **Reponer stock cuando un pedido se cancela o se devuelve.** [PENDIENTE N5], y
  por defecto no entra: la pantalla lo advierte.
- **Sincronizar precios** en cualquier dirección. [PENDIENTE N8].
- **Dar de alta productos** en TiendaNube desde AdminApp, o al revés.
- **Sincronizar imágenes, descripciones, categorías o atributos.**
- **Publicar stock de más de una sucursal** —TiendaNube tiene una sola cifra por
  variante—. Cuál se publica es [PENDIENTE 3].
- **Mapear un producto a varias variantes** o viceversa. Los dos índices únicos
  se conservan.
- **Un entorno de pruebas de TiendaNube.** Las URL están literales en el servicio
  y no hay variable para moverlas; ponerla es trabajo, no un renglón.
- **Otros marketplaces** —Mercado Libre, Shopify—. La sección 4.10 nombra
  TiendaNube y nada más.
- **Rediseñar la pantalla de Ajustes / Facturación AFIP.** Es el hito 8. Lo único
  que esta funcionalidad toca ahí es no dejar dos versiones del estado de
  conexión (US7 escenario 5).
- **Vista mobile o para tablet.** La pantalla es de escritorio, como las demás.
- **Migrar datos del legacy.** El sistema viejo no tenía nada de TiendaNube.

---

## Lo que falta decidir

Marcado tal cual se pide: lo que **cambia el resultado** y no está claro en el
pedido, en el plan ni en la maqueta. **Ninguno tiene una respuesta inventada.**

Esta funcionalidad tiene más pendientes que la anterior por un motivo que no es
descuido: **es la única sin las dos fuentes que las otras tuvieron.** El legacy
no tenía TiendaNube y la maqueta no la dibuja. Todo lo que la pantalla haga es
una decisión nueva.

El planteo completo de cada pregunta se conserva abajo, con las opciones
descartadas: el motivo sigue valiendo cuando alguien pregunte, dentro de un año,
por qué se publica un número y no el otro.

---

## Lo que faltaba decidir · **resuelto**

| # | Decisión | Quién decidió |
|---|---|---|
| 1 | **Token opaco de un solo uso** para el `state` del OAuth (opción a), guardado del lado del servidor con su empresa, su usuario y su vencimiento; el callback lo consume y lo invalida. Se eligió sobre el HMAC firmado porque éste no protege contra reusar el mismo `state` dentro de su ventana | Usuario |
| 2 | **Se publica `available`**, no `quantity`. Un producto con 10 en depósito y 3 comprometidos publica **7**. Puede subvender; lo que no puede es vender algo ya reservado para otro | Usuario |
| 3 | **Una sucursal designada «la de la tienda online»**: de ahí sale lo que se publica **y** ahí se descuenta el pedido. Las dos mitades coinciden **por construcción**, que es exactamente lo que hoy no pasa —se publica el stock de una, elegida por el orden de las filas, y se descuenta de la que sea el punto de venta por defecto— | Usuario |
| 4 | **Se sincroniza ante cada movimiento de stock**: cada venta, recepción o ajuste actualiza ese producto en la tienda. Es la que mantiene la tienda al día, y la que más rápido choca contra el límite de la API | Usuario |

### La decisión 4 necesita una red, y no es una segunda decisión

Empujar en cada movimiento **y nada más** tiene un modo de falla que las otras
dos opciones no tienen: si un empujón falla —la API caída, un 429, un token
vencido— **esa variante queda desfasada en silencio y para siempre**. No hay
nada que la vuelva a intentar, porque el disparador ya ocurrió.

Por eso la implementación lleva, además del empujón:

- **Cola con reintento** para el empujón que falla, con espera creciente. Un 429
  no es un error: es «más despacio».
- **Reconciliación periódica de respaldo**, que compara y **solo corrige lo que
  quedó desfasado**. No es la opción «cada N minutos» descartada: aquella era el
  mecanismo principal, ésta es la red que atrapa lo que el principal perdió.
- **Agrupar los empujones**: una importación de lista o un masivo de precios
  genera cientos de movimientos en segundos, y son cientos de llamadas a una API
  con límite. Se agrupan por producto en una ventana corta.

Esto **no cambia** la decisión: la hace sobrevivir a un error de red. Sin la red,
la respuesta honesta a «¿el stock de la tienda está bien?» sería «probablemente,
salvo que alguna vez haya fallado una llamada, y no hay forma de saberlo».

---

## El planteo completo de cada pregunta

### Bloqueaban

**[PENDIENTE DE DEFINIR 1] — ¿Cómo viaja la empresa en el `state` del OAuth, y
qué lo protege?**

Sin esto **no se puede vincular ninguna tienda** (hallazgo 2). El `state` de
OAuth cumple dos funciones a la vez: decir a qué empresa vuelve el token y
**evitar que un tercero complete el flujo**. Tres opciones:

- **(a) Token opaco de un solo uso, guardado del lado del servidor** con su
  empresa, su usuario y su vencimiento; el callback lo consume y lo invalida.
  Es lo más sólido y pide una tabla o una fila de `settings`.
- **(b) `empresaId` firmado con HMAC y con vencimiento**, sin fila nueva. No hay
  estado que limpiar; no protege contra reusar el mismo `state` dos veces dentro
  de su ventana.
- **(c) `empresaId` en claro.** **Es lo que hay que no hacer**: cualquiera puede
  completar un OAuth con `state=1` y colgarle **su** tienda a la empresa 1, que
  en producción es un cliente real. Es la misma familia del `|| 1` que este
  código ya tuvo y que su comentario documenta (`controllers/tiendanube.js:26-28`).

**Bloquea** porque cambia el modelo de datos y el contrato de dos endpoints.

**[PENDIENTE DE DEFINIR 2] — ¿Qué número se publica en TiendaNube: `quantity` o
`available`?**

Hoy se manda `quantity` (`controllers/tiendanube.js:190`). Son dos números
distintos y están así desde el sistema original: `quantity` es «cant» —lo que
hay— y `available` es «disp» —lo que se puede vender— (`models/Stock.js:42`,
`:47`). Un producto con 10 en depósito y 3 comprometidos publica 10 y la tienda
puede vender 3 que no van a estar. Publicar `available` es más conservador y
puede subvender.

Nada en el pedido, en el plan ni en la maqueta lo dice. **Bloquea** porque es el
número que ve el comprador y define si la tienda puede sobrevender.

**[PENDIENTE DE DEFINIR 3] — ¿De qué sucursal sale el stock que se publica, y a
cuál se le descuenta un pedido?**

Comprafit tiene tres sucursales y TiendaNube tiene **una sola cifra por
variante**. Hoy:

- La sincronización recorre **todas** las filas de stock de la empresa y **gana
  la última** (`controllers/tiendanube.js:183-192`), en un orden que nadie
  definió.
- El descuento por pedido cae en la sucursal **por defecto de la empresa**,
  porque el webhook llama a `processOrderCreated(..., null)`
  (`controllers/tiendanube.js:136`) y `resolverSucursal` sin id cae al escalón
  por defecto.

Las dos mitades pueden no coincidir: se publica el stock de una sucursal y se
descuenta de otra. Opciones: **una sucursal designada «la de la tienda online»**
(la más simple y la que hace coincidir las dos mitades); **la suma de todas** (lo
que más vende y lo que peor descuenta); **elegirla en cada corrida** (deja el
descuento sin resolver igual).

**Bloquea**: es la diferencia entre publicar 40 y publicar 12, y entre
descontarle a Ortiz lo que salió de Mayo.

**[PENDIENTE DE DEFINIR 4] — ¿Con qué disparador corre la sincronización, y
dónde vive el registro de la corrida?**

El pedido dice «Sincronización de stock, **con el resultado de la última
corrida**», lo que implica que corre sola: si fuera solo a mano, «la última
corrida» sería «la última vez que apreté el botón». Hoy solo existe el endpoint
manual y **no hay ningún registro** (hallazgo 5).

Opciones de disparador: **solo a mano**; **a mano más una automática cada N
minutos**; **automática ante cada movimiento de stock**. La tercera es la que
mantiene la tienda al día y la que más rápido choca contra el límite de la API.

El repositorio ya tiene la forma para la segunda y **también la trampa**:
`services/subscriptionCron.js` corre con `setInterval` dentro del proceso, y
`server.js:198-204` explica que en el free tier de Render el servicio **duerme a
los 15 minutos sin tráfico** y `setInterval` no corre; por eso existe el endpoint
con `x-cron-secret` (`:219`) que dispara un cron externo. Una sincronización
automática que dependa de `setInterval` **no va a correr de noche**, que es
justamente cuando la tienda online vende sin que haya nadie.

**Bloquea** porque cambia qué hay que construir —un job, un endpoint, una tabla o
una fila de `settings`— y qué significa exactamente «la última corrida».

### No bloqueaban

Tienen un valor por defecto propuesto. Si nadie dice lo contrario, se toma ese.

**[PENDIENTE N1] — ¿Permiso propio o se reusa `config.*`?** Hoy las rutas exigen
`config.ver` y `config.editar` (`routes/tiendanube.js:47-51`), que existen
(`seedPermissions.js:59-60`). «Ver la configuración de la empresa» y «operar la
tienda online» no son lo mismo, pero un permiso nuevo hay que sembrarlo y
repartirlo por rol. **Por defecto: se reusan `config.ver` y `config.editar`**, y
queda anotado que si alguien quiere que el encargado de depósito sincronice sin
ver el CUIT, ahí hace falta el permiso propio.

**[PENDIENTE N2] — ¿Qué granularidad tiene «el resultado de la última corrida»?**
**Por defecto**: cuándo empezó, cuánto tardó, quién la disparó, cuántas variantes
se mandaron, cuántas fallaron y **la lista de las que fallaron con su motivo**.
No el detalle de las que salieron bien: con un catálogo grande son cientos de
filas que nadie lee.

**[PENDIENTE N3] — ¿Hay mapeo masivo por SKU?** **Por defecto: hay una
sugerencia, no un mapeo automático.** El sistema propone el producto con SKU
coincidente y **hay que confirmarlo**. Mapear solo por SKU es exactamente cómo se
mapea el producto equivocado sin que nadie lo mire: dos productos con el mismo
SKU no son imposibles en este catálogo.

**[PENDIENTE N4] — ¿Un producto puede mapearse a varias variantes?** Hoy los dos
índices únicos lo prohíben (`TiendanubeMapping.js:14-17`). **Por defecto: se
conserva uno a uno.** Un producto del sistema que fuera dos variantes de la
tienda haría que la sincronización publicara el mismo stock dos veces y que la
tienda pudiera vender el doble de lo que hay.

**[PENDIENTE N5] — ¿Se escucha `order/cancelled` o las devoluciones?** Hoy no
(`controllers/tiendanube.js:122`): cancelar un pedido en TiendaNube deja el
inventario descontado para siempre. **Por defecto: no entra en este hito y la
pantalla lo advierte**, con la misma disciplina que el hallazgo 7. Es el primer
candidato a entrar si alguien lo pide: hace falta su propia guarda de
idempotencia —reponer dos veces es tan malo como descontar dos veces— y esa
guarda no se puede improvisar.

**[PENDIENTE N6] — ¿Se cifra el token acá?** **Por defecto: no.** Es la sección 6
de `PROXIMOS-PROYECTOS.md` y ahí está planteada para la clave privada de AFIP,
que es material fiscal y el secreto más caro de los dos. Cifrar el de TiendaNube
solo dejaría el peor sin proteger y dos mecanismos para el mismo problema. Lo que
**sí** entra es FR-075 a FR-077: no empeorarlo.

**[PENDIENTE N7] — ¿Qué muestra exactamente el bloque de estado?** **Por
defecto**: el nombre de la tienda y su id, cuándo se vinculó, y cuándo fue la
última comunicación correcta con la API. **Nunca el token**, ni truncado, ni sus
últimos caracteres: mostrar «los últimos cuatro» de un secreto es una costumbre
de tarjetas de crédito que acá no aporta nada y filtra.

**[PENDIENTE N8] — ¿Se sincronizan precios?** **Por defecto: no.** Nada del
pedido lo menciona, y el modelo de precios de AdminApp —`price_override`,
`margin_override`, precio mayorista y los tres niveles de precio del POS— no
tiene un equivalente único que mandar.

**[PENDIENTE N9] — ¿Desvincular borra los mapeos?** **Por defecto: no los
borra**, y la confirmación lo dice. Volver a vincular la misma tienda los
encuentra intactos; vincular **otra** tienda los deja apuntando a variantes que
ya no existen, y eso la pantalla lo tiene que poder mostrar. Borrarlos es la
opción destructiva y no hace falta tomarla ahora.

**[PENDIENTE N10] — ¿Qué publica un producto mapeado que está inactivo
(`is_active: false`)?** **Por defecto: se publica igual el stock que tiene**, y
la pantalla marca la fila. Publicar cero por estar inactivo agota una variante
que la tienda podría estar vendiendo; dejar de publicarla la congela en el último
número. Las dos son peores que decir la verdad y marcarlo.

**[PENDIENTE N11] — ¿Dónde queda la tarjeta de TiendaNube que hoy vive en
`/facturacion`?** **Por defecto: se saca y en su lugar queda un enlace a la
pantalla nueva.** Dos lugares que muestran el estado de lo mismo se separan y
nada avisa; ya pasó con las listas de estados de orden que la funcionalidad 012
encontró duplicadas.

---

## Assumptions

1. **La pantalla es nueva y entra en el marco de 1320px.** No necesita la
   excepción del POS: no tiene dos zonas de scroll independientes ni pide el alto
   completo. La ruta se envuelve en `MarcoDePantalla` y pasa a ser la
   decimoctava de `marcoDeLasPantallas.navegador.js`.
2. **La maqueta NO dibuja esta pantalla.** Se verificó: cero coincidencias de
   `tiendanube`, `tienda nube` y `tienda-nube` en
   `docs/maqueta/AdminApp-Rediseno.dc.html`, y su `README.md` enumera las siete
   pantallas que sí dibuja sin incluirla. A diferencia de Proveedores en la
   funcionalidad 012, **acá ni siquiera hay un ítem de menú que caiga en un
   stub**. Cualquier cosa que `sdd-verify` quiera comparar contra la maqueta para
   esta pantalla **no tiene contra qué**: el diseño sale del texto de la sección
   4.10, de `REGLAS-DISENO.md` y de la referencia viva, `pages/Comparador.jsx`.
3. **El sistema viejo no tenía TiendaNube.** Cero coincidencias en
   `legacy/index-legacy.html`, y `MIGRACION-COMPRAFIT.md:157` lo lista entre lo
   que no existía. **No hay una fuente sobre qué espera Comprafit**, y por eso
   esta spec tiene más pendientes que la anterior.
4. **El modelo `TiendanubeMapping` y su migración se conservan tal cual.** Los
   dos índices únicos, las dos FK con `ON DELETE CASCADE` y el bug documentado de
   `addConstraint` no se tocan.
5. **La separación en dos routers se conserva.** `publico` para lo que llama
   TiendaNube y `privado` para lo que llama la app, montados como están
   (`server.js:344-346`), con su excepción documentada en
   `permisosDeRutas.test.js:81-85`.
6. **Solo se procesa `order/paid`.** Procesar además `order/created` descontaba
   el stock dos veces por la misma venta, está corregido y documentado
   (`controllers/tiendanube.js:118-122`), y no se reabre.
7. **La firma HMAC se conserva como está**: SHA-256 sobre el cuerpo crudo con
   `timingSafeEqual` y chequeo de longitud previo (`:69-84`). Lo único que hay
   que arreglar es que le llegue el cuerpo crudo.
8. **AdminApp es la fuente de verdad del stock.** El número de TiendaNube es un
   espejo y la sincronización lo pisa. Es lo que el código ya hace y lo que hace
   que repetir una corrida sea seguro.
9. **La sincronización va en un solo sentido.** No se lee el stock de TiendaNube
   para escribirlo en AdminApp, así que **no hay conflicto de escritura que
   resolver**: lo que hay es una ventana en la que la tienda tiene un número
   viejo, y eso se acorta con el disparador de [PENDIENTE 4].
10. **La API de TiendaNube pagina y tiene límite de requests por tienda.** Es lo
    que hace necesarios FR-057 y FR-048. Los valores exactos —tamaño de página,
    cuota— los confirma `sdd-plan` contra la documentación vigente; la spec no
    los fija.
11. **No hay entorno de pruebas de TiendaNube.** Las tres URL están escritas
    literales en el servicio. Los tests de integración ejercitan **el lado de
    AdminApp** —el webhook entrando, la base, el aislamiento— con la API de
    TiendaNube doblada.
12. **El token sigue en `settings` en texto plano.** Es la misma condición que la
    clave de AFIP y su propio proyecto pendiente. Esta funcionalidad no lo
    resuelve y no lo empeora.
13. **Los pedidos de la tienda online siguen sin registrar una venta.** Es una
    funcionalidad propia. Lo único que cambia acá es que **deja de estar
    escondido**.
14. **La empresa opera una sola tienda.** Nada en el modelo contempla dos
    tiendas por empresa: `tiendanube_user_id` es una fila de `settings` por
    empresa.
