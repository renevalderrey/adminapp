# Feature Specification: Catálogo de ventas online — etapas 0, 1 y 2

**Feature Branch**: `015-catalogo-de-ventas-online`
**Created**: 9 de agosto de 2026
**Status**: Aprobada, y **corregida con los hallazgos del diseño técnico** ([plan.md](./plan.md), «Lo que la spec pide y hay que ajustar»). Los doce puntos abiertos quedaron cerrados en «Decisiones de la revisión», más la decisión 13 tomada después. Las **seis correcciones incorporadas**: (1) el limitador propio del prefijo público **no basta** — hace falta eximirlo del limitador global con un `skip`, y una guardia que ate las dos líneas (FR-113, FR-113a, FR-113b, FR-115); (2) el handler de `/c/:slug` **no puede leer el `index.html` del disco** y lo pide por la red interna del compose, con marcador y caché (FR-117c); (3) la clave de `catalogo_visitas` pasa a **cuatro columnas** con `estado_catalogo`, sin la cual US20 escenario 7 no se puede cumplir (FR-200a); (4) nace **`packages/pedido`**, porque ni `apps/api` ni `apps/tienda` pueden importar de `apps/web/src` (FR-006c, FR-144, FR-184); (5) `precios.test.js` tiene **21 casos y no doce** (FR-003); (6) el pedido mínimo se precisa: **nombre y teléfono son del comprador**, y entrega y medio de pago son **siempre obligatorios** porque el checkout los resuelve (FR-149b).
**Input**:

> Hito 10 del plan (`docs/PLAN-CATALOGO-PUBLICO.md`), textual:
>
> «Una empresa de Favalio publica un catálogo de productos en una URL propia. Un
> QR pegado en el local de un socio lleva a esa URL. El visitante ve el catálogo
> con el precio que la empresa definió **para ese catálogo**, arma un pedido y lo
> paga —o lo coordina—. El pedido cae en el panel de la empresa.»
>
> **Primer caso real**: Comprafit (suplementos deportivos) asociada al gimnasio
> Fitnet. El QR vive en el gimnasio, el catálogo se llama «Comprafit / Fitnet» y
> los socios ven precio preferencial.
>
> La dirección de la tienda es **`tienda.favalio.com/c/<slug>`**.
>
> **Esta spec cubre las etapas 0, 1 y 2** del cuadro de orden de ejecución del
> plan: cimientos, catálogo visible y pedido. La etapa 3 —Mercado Pago
> Marketplace y «cobrado» → `Sale` con descuento de stock— es su propia spec, y
> la 4 —reserva de stock, padrón de socios, mínimo de compra, destacados,
> horarios y cupones— está fuera de alcance de la v1.
>
> Fuentes: `docs/PLAN-CATALOGO-PUBLICO.md` (las trece decisiones ya tomadas con
> el dueño del producto, que **no se reabren**) y
> `docs/maqueta/Catalogo-de-ventas-online.dc.html` (el diseño, pantalla por
> pantalla, que es la fuente de verdad de la interfaz).

---

## Un aviso antes de empezar

**Esto no es una pantalla más: es el primer pedazo de Favalio que le contesta a
alguien que no inició sesión.** Y todo el aislamiento entre empresas de este
repositorio está escrito sobre el supuesto contrario.

Las tres consecuencias, verificadas archivo por archivo:

1. **`empresa_id` sale siempre de `req.usuario`.** `loadEmpresaContext`
   (`apps/api/src/middleware/auth.js:101-353`) resuelve la empresa desde el JWT y
   `assertEmpresaId` (`apps/api/src/utils/tenantScope.js:110-118`) **tira un 500**
   si no hay empresa resuelta. Un endpoint público tiene que resolver la empresa
   desde el slug **antes** de tocar cualquier modelo, y no puede reusar
   `loadEmpresaContext`: esa función tiene la rama del superadmin que entra a
   cualquier empresa por `X-Empresa-Id` sin membresía (`auth.js:172-200`).

2. **Ningún test de ejecución puede ver el problema.** Los ~1400 tests corren con
   `BYPASS_AUTH=true` (`apps/api/src/tests/setup.js:13`), que clava
   `req.empresaId = 1` (`server.js:324-372`), **saltea `checkSubscription`**
   (`server.js:407`) y hace que `checkPermission` llame a `next()` sin mirar nada
   (`checkPermission.js:31-37`). O sea: con la suite rápida, un endpoint público
   que filtre datos de otra empresa **pasa en verde**. La red que sí sirve es
   estática (`aislamientoEmpresas.test.js`, `permisosDeRutas.test.js`,
   `montajeDeRouters.test.js`, `observabilidad.test.js`) más el cuarto nivel:
   integración contra Postgres con dos empresas
   (`src/tests/integracion/fixtures.js:80`).

3. **Un pedido público recibe, por definición, identificadores de un
   desconocido.** El detector de «padre ajeno» de
   `aislamientoEmpresas.test.js:867-1044` marca todo `create` con un `<algo>_id`
   que viene del cliente sin `findScoped` previo. Acá eso no es una guardia
   molesta: es exactamente el defecto que hay que evitar.

**Y una cuarta cosa, que es de producto y no de código.** La maqueta dibuja tres
textos que prometen lo que esta spec **no hace**:

- La bandeja: «Marcar un pedido como cobrado **descuenta stock y registra la
  venta** en Favalio» (`Catalogo-de-ventas-online.dc.html:1080`).
- La confirmación: «Marcar cobrado el pedido A-1042 **descuenta el stock de sus
  2 productos y registra la venta** en Favalio» (`:1178`).
- El checkout de transferencia: «El pedido queda **reservado 24 horas**»
  (`:375`, y otra vez en `:1325`).

Las tres son falsas en las etapas 0-2. La regla del plan es «si toca stock, tiene
que generar venta; si no genera venta, no toca stock», y las dos mitades van
juntas en la etapa 3. **Acá «Marcar cobrado» solo cambia el estado del pedido**,
y no hay reserva de ningún tipo. Copiar el texto de la maqueta sería repetir
exactamente el defecto que la spec 013 encontró en TiendaNube: una pantalla que
afirma algo que el sistema no hace. **Los tres textos de reemplazo están
aprobados** en la decisión 4.

---

## El sistema viejo no tiene nada de esto

Se revisó `legacy/index-legacy.html` (10.628 líneas). Las palabras que parecen
del caso no lo son:

- «tienda» aparece tres veces y significa **sucursal física**: «Tienda 1 · Ortiz
  de Ocampo», «Tienda 2 · 25 de Mayo», «ambas tiendas» (`legacy:2986`, `:3011`,
  `:3017`).
- «carrito» aparece ochenta veces y es **el ticket del punto de venta**, no un
  carrito de compras de un visitante.

**Comprafit nunca tuvo catálogo público, ni pedidos online, ni una URL para
compartir.** Es la misma situación que la funcionalidad 013: no hay «cómo lo
resolvían antes» que consultar, así que **todo lo que esta funcionalidad haga es
una decisión nueva**, y por eso los pendientes se resuelven con el dueño del
producto y no leyendo el legacy.

---

## Qué entra y qué no, por etapa

El plan ordena el trabajo en cinco etapas. **Esta spec cubre las tres primeras.**

| Etapa | Qué entra | Dónde está |
|---|---|---|
| **0 · Cimientos** | Monorepo en **workspaces de npm** y **`packages/precios`** —el cálculo de precios en el servidor— · subida de imágenes con redimensionado, servidas por Caddy, **y el respaldo de ese volumen** · `products.publicable` | US1, US2, US3 |
| **1 · Catálogo visible** | `catalogos`, `catalogo_productos`, `catalogo_reglas_precio` · resolvedor de tenant por slug · router público de lectura con proyección explícita · `apps/tienda` (catálogo, buscador, categorías, ficha) y sus estados · panel: pantalla Catálogos con las cinco pestañas · QR y enlace | US4 a US12 |
| **2 · Pedido** | `pedidos` —con **`origen`**—, `pedido_items` · **`packages/pedido`**, el segundo paquete compartido (FR-006c) · carrito y checkout de tres pasos · confirmación · bandeja de pedidos en el panel con panel lateral, **columna «Canal»** y confirmación · aviso por email y WhatsApp · permisos nuevos | US13 a US20 |
| **3 · Cobro** | **Fuera de alcance.** Mercado Pago Marketplace y «cobrado» → `Sale` con descuento de stock | «Fuera de alcance» |
| **4 · Después** | **Fuera de alcance.** Reserva de stock, padrón de socios, mínimo de compra, destacados, horarios, cupones | «Fuera de alcance» |

### Las siete cosas que agregó el diseño, decididas una por una

El plan las dejó anotadas como «hay que decidir si entran»
(`PLAN-CATALOGO-PUBLICO.md`, «Lo que agregó el diseño»). **Acá quedan
decididas**, con el motivo escrito, porque un botón dibujado que no hace nada es
el defecto que este repositorio viene marcando desde el hito 7.

| Lo que dibuja la maqueta | Decisión | Motivo |
|---|---|---|
| **Escaneos (30 d), pedidos y conversión** en la pestaña del QR (`:1044-1048`) | **Entra**, como **visitas** y no como «escaneos» | Sin esto la pestaña muestra tres números inventados. Se cuenta del lado del servidor, agregado por día y por catálogo, sin cookie y sin IP. **Y el rótulo cambia**: el servidor no puede distinguir un escaneo de alguien que abrió el enlace que le pasaron por WhatsApp — decirle «escaneos» a eso es mentir con una métrica. Ver US20 y FR-200 a FR-203 |
| **Cartel A4 para imprimir** (`:1039`) | **Entra**, resuelto en el navegador | `window.print()` sobre una hoja A4 maquetada en HTML, con el QR que ya dibuja `qrcode` (instalado, molde en `printInvoice.js:1,48-75`). Cero dependencias nuevas y cero endpoint. La alternativa —componer un PDF en el servidor— es un proyecto propio |
| **Duplicar catálogo** (`:769`) | **Sale** | Es una copia profunda de reglas y de selección de productos, y el slug es único global, así que además hay que pedir uno nuevo. Con **un** catálogo real (Comprafit / Fitnet) no ahorra nada, y una copia que se lleva las reglas a medias deja precios equivocados en una página pública. **El botón no se dibuja** |
| **Exportar pedidos** (`:1082`) | **Sale** | Hay precedente (`utils/exportVentas.js`) pero no hay pedido: con la bandeja recién nacida no existe todavía la pregunta que la exportación contesta. **El botón no se dibuja** |
| **«Gana en N de M» por regla** (`:942`) | **Entra** | Es lo que hace entendible «gana la más específica». El motor de precios devuelve **cobertura**, no solo el precio final. Ver US5 |
| **Precio de lista tachado** (`:138-140`, prop `mostrarPrecioLista`) | **Entra**, como **interruptor por catálogo** | Publicar el precio de lista publica el tamaño del descuento a cualquiera con el enlace: es una decisión de negocio y tiene que poder apagarse. **El valor por defecto es apagado** (decisión 8, supuesto revisable) |
| **Selección múltiple con «Publicar» y «Quitar»** (`:987-992`) | **Entra** | Sin acciones masivas, publicar 62 productos son 62 clics, y ese es el trabajo real del primer día |

---

## Qué patrones ya están fijados, y cuáles aplican acá

Las funcionalidades 009 a 014 dejaron el patrón escrito en componentes
compartidos y en guardias. **El panel no inventa nada que ya exista; la tienda
pública casi no puede usar nada de eso**, y esa asimetría es el punto de esta
tabla.

| Patrón | ¿Aplica al **panel**? | ¿Aplica a la **tienda**? | Dónde y por qué |
|---|---|---|---|
| `MarcoDePantalla` (`components/MarcoDePantalla.jsx:46`) | **Sí** | **No** | Catálogos y Pedidos son dos rutas nuevas de `apps/web` y se envuelven en el marco, con su entrada en `CON_MARCO` de `pruebas-de-navegador/marcoDeLasPantallas.navegador.js:56-61`, que hoy tiene dieciocho rutas escritas a mano y pasa a tener veinte. La tienda no tiene shell de Favalio |
| `TablaGrid` / `Encabezado` / `Fila` / `BotonDeFila` (`components/TablaGrid.jsx:47,63,107,162`) | **Sí, cuatro veces** | **No** | Lista de catálogos, tabla de reglas, previsualización de precios, selección de productos y bandeja de pedidos son cinco tablas. Encabezado y filas comparten **el mismo string** de `grid-template-columns`, escrito una vez |
| `ui/sheet.jsx` (`components/ui/sheet.jsx:131-140`) | **Sí** | **No** | El detalle del pedido es un panel lateral de 520px, como lo dibuja la maqueta (`:1119`) y como `PanelProducto.jsx` y `PanelOrdenDeCompra.jsx`. **No un modal**: el pedido se lee mirando la bandeja, no tapándola |
| `PageHeader` (`components/PageHeader.jsx:14`) | **Sí** | **No** | Título, descripción y acción principal. En Catálogos la acción es «Nuevo catálogo»; en Pedidos no hay acción principal, y por eso el encabezado no lleva botón primario |
| `EstadoVacio` (`components/EstadoVacio.jsx`) | **Sí, tres veces** | **No, seis veces distintas** | En el panel: sin catálogos, catálogo sin productos publicados, bandeja sin pedidos. En la tienda los seis estados **son pantallas completas dibujadas** (`:477-624`) y no un componente compartido: cada una tiene su propio texto y su propia salida |
| `PieDeTabla` + `Pagination` (`components/Pagination.jsx`) | **Sí** | **No** | 62 productos no entran en una pantalla, y la maqueta ya dibuja «Mostrando 10 de 62» (`:1011`). La tienda pagina con scroll infinito o con «ver más», que es otra cosa |
| Tokens de `index.css:38-196`, cero hex, cero `dark:`, cero clases de la paleta de Tailwind, cero `Table*` | **Sí, sin excepción** | **No, y es deliberado** | Las pantallas nuevas del panel **entran a `NOMBRES` de `guardiasDeDiseno.test.js:171-215` antes de escribirse**, y el ancla `toHaveLength(32)` de `:473` sube. La tienda tiene **un** color configurable por catálogo (`color_marca`) y su propio contraste calculado; el sistema de Favalio declara mínimo 1280px y su marca es la de Favalio, no la del comercio |
| Badge de estado con las tres clases juntas (`REGLAS-DISENO.md`, «Badge de estado») | **Sí** | **No** | Los estados del catálogo (borrador/publicado/pausado) y los seis del pedido salen de una función pura que nunca devuelve `undefined`. La maqueta ya trae el mapa completo en `TONOS` (`:1478-1488`) |
| El selector de sucursal (`REGLAS-DISENO.md`, «El selector de sucursal») | **Sí, con `alcance: 'empresa'`** | — | Un catálogo declara **su** punto de venta adentro; cambiar la sucursal de arriba no cambia nada en estas dos pantallas. Sin `alcance: 'empresa'` el control se dibuja y no hace nada, que es justo lo que el hito 9 corrigió en ocho pantallas |
| `findScoped` / `scoped` / `assertEmpresaId` (`utils/tenantScope.js:29,98,110`) | **Sí** | **Sí, y es el punto entero** | En el privado, como siempre. En el público, **con el `empresaId` que devuelve el resolvedor de slug**, nunca el de una sesión que no existe |
| `fallo(req, res, err, 'mensaje en castellano')` y `ErrorDeNegocio` (`utils/errores.js:60,126`) | **Sí** | **Sí** | Ningún `catch` responde 500 con `err.message`. Y en el público hay un motivo extra: `err.message` de Sequelize nombra tablas y restricciones, y acá el que lee es cualquiera |
| `resolverSucursal` / `ubicacionDeStock` (`utils/sucursalDeStock.js:114,185`) | **Sí** | **Sí, para leer stock** | El catálogo lee stock de **un** punto de venta, el suyo. Ninguna consulta de stock arma su propio ternario |
| El cuarto nivel: integración contra Postgres (`CONVENCIONES.md`, «El cuarto nivel») | **Sí** | **Sí, y es imprescindible** | El aislamiento **ejecutado** con dos empresas es lo único que contesta «¿el catálogo de B da 404 desde el enlace de A?». Una guardia estática ve que se llamó a `findScoped`; no ve que la fila ajena haya quedado como estaba |
| Los tres gates (`soloSuperadmin` / `modulo` / `permission`) | **Sí, en los tres lados** | — | Barra lateral (`components/navegacion.js:212-228`), `RouteGuard` (`App.jsx:38-68`) y API. Ver US19 y el hallazgo H12: **el gate de `enabled_modules` hoy solo existe en el navegador** |

---

## Contexto: qué existe hoy

Relevado archivo por archivo. **La spec no puede pedir lo que ya existe ni dar
por hecho lo que no.**

### El cálculo de precios

`calcularPrecios` vive en `apps/web/src/utils/precios.js:98-131`, del lado del
navegador, y **es la única cuenta de precio de venta del sistema**. Devuelve
`{ cashPrice, cardPrice, alliancePrice, sinCosto, usaPrecioManual }`. La
convención está documentada arriba del archivo (`:1-17`): «margen 50%» es
**recargo sobre el costo**, `costo × 1,5`, y no margen sobre la venta.

Lo consumen **cinco archivos de producción**:

| Archivo | Import | Uso |
|---|---|---|
| `apps/web/src/pages/Inventory.jsx` | `:5` | `:1095` — una llamada por fila de la tabla |
| `apps/web/src/components/PanelProducto.jsx` | `:4` | `:203` — dentro de un `useMemo`, **en vivo mientras se escribe el costo** |
| `apps/web/src/utils/exportarInventario.js` | `:2` | `:126` |
| `apps/web/src/utils/impresionInventario.js` | `:1` | `:106` |
| `apps/web/src/store/useStore.js` | `:3` | `:197` — `calculatePrices`, que es de donde sale el precio de cada línea del punto de venta (`:205`) |

**En `apps/api` no existe ninguna cuenta equivalente.** `apps/api/src/routes/precios.js`
es otra cosa: actualización masiva de precios e historial, con
`services/preciosService.js` detrás. Y `POST /api/sales` (`routes/sales.js:311-630`)
**acepta el precio unitario que manda el cliente** y solo verifica que el total
cierre contra las líneas.

**Los tres ajustes de empresa que alimentan la cuenta** —`margin_efectivo`,
`recargo_tarjeta`, `descuento_alianza`— se siembran en el onboarding
(`routes/empresas.js:103-105`, `setup.js:23-25`) y viven en `empresa.settings`
(JSONB) o en filas de la tabla `settings`, con PK compuesta `(key, empresa_id)`
(`models/Setting.js`). `GET /api/settings` (`routes/general.js:518`) los mezcla:
el JSON de la empresa son los valores por defecto y las filas son lo que el
usuario cambió (`:527-546`).

### El montaje de routers y la cadena de autenticación

`apps/api/src/server.js`, en orden:

| Línea | Qué |
|---|---|
| `:182` | `app.use('/api/tiendanube', require('./routes/tiendanube').publico)` — **el único router público que escribe hoy**, montado arriba de todo porque el webhook necesita el cuerpo crudo |
| `:184` | `app.use(express.json({ limit: '10mb' }))` — el parser **global** |
| `:319` | `app.use('/api/', limiter)` — 600 peticiones cada 15 minutos, **por IP**, en producción |
| `:323-373` | `authMiddleware` — `[checkJwt, extractUser, loadEmpresaContext]`, o el bloque de `BYPASS_AUTH` |
| `:396` | se le empuja `registrarSesion` |
| `:407-409` | `authEmpresa = [...authMiddleware, requireEmpresa, checkSubscription]` |
| `:456-458` | `/api/auth` público, `/api/auth` privado, `/api/empresas` |
| `:464` | `app.use('/api', ...authEmpresa, require('./routes/general'))` — **el genérico** |

Dos guardias fijan esa forma y las dos importan acá:

- **`montajeDeRouters.test.js:163-188`**: todo `app.use('/api/…', …, require('./routes/…'))`
  que quede **debajo** del genérico y cuya cadena **no incluya `requireEmpresa`**
  es un hallazgo. Un router público montado abajo del `:464` la pone en rojo.
  Y `:98-109`: montar un router con `app.get`/`app.post` en vez de `app.use` es
  otro hallazgo, porque a un Router se le pasa la URL entera como punto de
  montaje y adentro busca `/` — el defecto que dejó `/api/auth` respondiendo 404
  siempre.
- **`observabilidad.test.js:394-536`**: verifica que el público de TiendaNube esté
  arriba del `express.json` global (`:452-460`) **y arriba del limitador**
  (`:515-527`). Es el molde exacto de la guardia que hay que escribir para el
  router del catálogo, con el signo cambiado: el catálogo tiene que quedar
  **debajo** del parser y del limitador global, y **arriba** del genérico. Y con
  una aserción más que TiendaNube no necesita: que el limitador global **exima**
  el prefijo público por `skip` y que ese `skip` no pueda quedar sin el limitador
  propio (FR-113b).

**`checkSubscription`** (`middleware/checkSubscription.js`) exime por prefijo de
`req.originalUrl` con `startsWith` (`:30-36`): `/api/empresas`, `/api/auth`,
`/api/ping`, `/api/tiendanube/callback`, `/api/tiendanube/webhook`. Bloquea con
**402** si no hay fila de suscripción (`SIN_SUSCRIPCION`, `:61-71`) o si el
estado está vencido y la gracia también (`SUBSCRIPTION_EXPIRED`, `:85-124`). Un
`catch` de base **no bloquea** (`:127-130`). Y lo que importa acá: **un router
montado sin `authEmpresa` nunca pasa por este middleware**.

### Los permisos

`apps/api/src/seedPermissions.js` —en la raíz de `src/`, no en `src/scripts/`—
tiene **50 permisos** en `PERMISOS` (`:6-80`), con la forma
`{ codigo: 'familia.accion', nombre: 'en castellano', modulo: 'agrupacion' }`, y
`ROLE_PERMISOS` (`:82-119`) reparte por rol: `admin` recibe el catálogo entero
(`:83`), y después `gerente`, `vendedor`, `produccion` y `compras`.

`permisosDeRutas.test.js` es la guardia que hay que alimentar, y compara por
**igualdad exacta** en cuatro listas escritas a mano:

- `ROUTERS_SIN_SESION` (`:73-87`) — hoy dos entradas (`routes/auth.js publico`,
  `routes/tiendanube.js publico`), cada una con su motivo escrito.
- `SIN_PERMISO_A_PROPOSITO` (`:103-124`) — exactamente cuatro.
- `RUTAS_INLINE_DE_SERVER` (`:155-167`) — tres.
- La lista literal de los **19 archivos de `routes/`** (`:549-565`), con
  `expect(montados).toEqual(nombres)`: todo archivo de `routes/` tiene que estar
  montado en `server.js` y viceversa.

Y `:674-693`: todo código que aparezca en un `checkPermission('…')` **tiene que
existir en `seedPermissions.js`**, con el catálogo anclado en `> 40`.

### Los datos

| Modelo | Archivo | Lo que importa acá |
|---|---|---|
| `Product` | `models/Product.js` | `cost` DECIMAL(12,2) NOT NULL default 0 (`:31`), `brand_id` (`:36`), `supplier_id` (`:40`), `margin_override` (`:44`), `price_override` (`:48`), `wholesale_margin` (`:52`), `wholesale_price` (`:56`), **`category` STRING(50) default `'otro'` — texto libre, sin tabla de categorías y sin CHECK** (`:60`), `image_url` **TEXT, ya existe** (`:78`), `is_active` (`:82`). Único `(empresa_id, sku)` (`:99`) |
| `Brand` | `models/Brand.js` | `id`, `empresa_id`, `name` STRING(100), `color` STRING(7). Único `(empresa_id, name)` |
| `Stock` | `models/Stock.js` | `punto_de_venta_id` **NOT NULL** con FK a `puntos_de_venta` (`:38-42`), `quantity` (`:43`), `available` (`:48`), único `(product_id, punto_de_venta_id)` (`:84`). `location` es **espejo** del `code`, lo escribe siempre el servidor (`:26-34`) |
| `PuntoDeVenta` | `models/PuntoDeVenta.js` | Tabla `puntos_de_venta`. `name`, `code` STRING(30), `is_active`. Único `(empresa_id, code)` |
| `Customer` | `models/Customer.js` | `name` NOT NULL, `tax_id`, `email`, `phone`, `address`, `tax_condition` default `'consumidor_final'`, `is_active`. ⚠ **No tiene índice por `empresa_id`** (`:51-52`) |
| `Sale` / `SaleItem` | `models/Sale.js` | `Sale.id` es **STRING(40)**, `payment_method` STRING(20) **sin validación** (`:38-42`), `total` es el único campo de totales del encabezado (`:33`). No se toca en esta spec |
| `StockMovement` | `models/StockMovement.js` | `tipo` es **STRING(30), texto libre** (`:22-25`), con cuatro valores en uso: `manual`, `sale`, `sale_void`, `tiendanube_sale`. No se escribe en esta spec |
| `Setting` | `models/Setting.js` | PK compuesta `(key, empresa_id)`, `value` JSONB |
| `Invitacion` | `models/Invitacion.js:24-29` | El molde del token opaco: `crypto.randomBytes(32).toString('hex')` como `defaultValue`, `unique: true`, más `expires_at` con default calculado (`:39-47`) |

**Las migraciones** viven en `apps/api/src/migrations/`, con formato
sequelize-cli (`module.exports = { up, down }`) y nombre
`YYYYMMDD-descripcion-en-kebab-case.js`. La última es
`20260813-gastos-fijos-a-su-sucursal.js`. Se corren con
`apps/api/scripts/migrar.js`, que toma un advisory lock de Postgres
(`LOCK_ID = 947213`, `:41`).

⚠ **Un modelo nuevo tiene que exportarse desde `models/index.js`** o
`scripts/verificar-esquema.js` no lo mira: ese script hace un `findOne` real
**por cada modelo exportado** (`:278-314`) y compara tipos contra
`information_schema` (`:317-344`). Corre en el job «API — la imagen arranca y
migra» del CI (`.github/workflows/ci.yml:352-359`).

⚠⚠ Y una trampa escrita en el propio archivo: los cinco modelos de TiendaNube
**se exportan pero no declaran ninguna asociación a propósito**
(`models/index.js:39-48`), porque `aislamientoEmpresas.test.js` ancla el conteo
de includes de hijos. Declarar asociaciones nuevas con `empresa_id` mueve ese
ancla (`aislamientoEmpresas.test.js:1136`) y **hay que actualizarla con el motivo
escrito al lado, nunca rodearla**.

### La infraestructura

Desde `c1013e8` la plataforma corre en un VPS de Hostinger con
`docker-compose.produccion.yml`: cinco servicios —`caddy`, `postgres`, `api`,
`web`, `landing`—, con Caddy como único puerto expuesto.

- **`ALLOWED_ORIGINS`** se arma por interpolación en `:89`:
  `https://${DOMINIO},https://www.${DOMINIO},https://app.${DOMINIO}`. Hay que
  sumar `https://tienda.${DOMINIO}` **ahí**, no en un `.env` suelto.
- **Las `VITE_*` son `build.args`**, no `environment` (`:122-128` para `web`,
  `:135-137` para `landing`), con la advertencia escrita en la cabecera
  (`:18-19`): cambiar una en el `.env` no tiene efecto hasta `up -d --build`.
- **`deploy/Caddyfile`** tiene cuatro bloques de sitio: `{$DOMINIO}` → `landing`
  (`:20-27`), `www` → redirect (`:32-34`), `app.{$DOMINIO}` → `web` (`:37-41`),
  `api.{$DOMINIO}` → `api` (`:46-50`). **No hay `file_server`, no hay
  `handle_path`, no hay ningún bloque que sirva archivos estáticos.**
- **`deploy/respaldo.sh`** (54 líneas) hace **una sola cosa**:
  `pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$ARCHIVO"` (`:42`), con
  rotación a 14 días (`:51`). **No respalda ningún volumen de Docker, ni
  `apps/api/uploads/`, ni ningún archivo subido.** Y la copia queda en el mismo
  disco que la base (advertido en `:22-23`).
- **`.github/workflows/ci.yml`** tiene cinco jobs: «API — tests», «Web — tests y
  build», «Web — pruebas de navegador», «Landing — build» y «API — la imagen
  arranca y migra».
- **`apps/landing`** es el molde de una app nueva: `Dockerfile` multi-stage
  (`node:22-alpine` → `nginx:alpine`) con las `VITE_*` como `ARG` (`:14-16`),
  `nginx.conf` con `try_files … /index.html`, y `vite.config.ts` con
  `server: { port: 5174, strictPort: true }`.
- ⚠ **El monorepo no tiene workspaces de npm.** El `package.json` de la raíz
  orquesta con `npm --prefix apps/X` (`:10-24`). No existe paquete compartido, y
  eso es exactamente lo que ya obligó a duplicar la lista de medios de pago entre
  `apps/web/src/utils/mediosDePago.js:48-58` y
  `apps/api/src/utils/exportVentas.js:42-54`, con un test que las mantiene
  sincronizadas (`apps/web/src/tests/mediosDePago.test.js:46`).
  **La decisión 1 lo cambia**: esta funcionalidad introduce **workspaces de npm**
  y **dos** paquetes compartidos: `packages/precios` en la etapa 0 y
  **`packages/pedido` en la etapa 2** (FR-006c, FR-006d).
- ⚠ **`apps/api` y `apps/tienda` van a ser dos imágenes de Docker distintas**, y
  eso tiene una consecuencia que es fácil no ver: `apps/api/Dockerfile` copia
  `src/` y `scripts/`, así que **el `index.html` de la tienda no está en la imagen
  de la API** —y su `<script src="/assets/index-<hash>.js">` cambia de hash en
  cada build—. El handler de `/c/:slug` **no lo puede leer del disco**: se lo pide
  al servicio `tienda` por la red interna del compose (FR-117c). Por la misma
  razón, `apps/api` **no puede importar nada de `apps/web/src`** (FR-006c).

### Subida de imágenes: qué hay y qué no

**No hay `sharp` en ningún `package.json` del repositorio.** Sí hay `multer`
(`apps/api/package.json:44`), con dos usos y ninguno sirve de molde completo:

1. **El logo de la empresa** (`routes/empresas.js:37-51`): `memoryStorage`, y el
   archivo se guarda como **data URI base64 en la base**
   (`fileToDataUri`, `:47-51`). No toca el disco. Un catálogo de suplementos con
   fotos de producto por este camino infla la base y el `pg_dump`.
2. **La importación de CSV/Excel** (`routes/import.js:15-23`): `dest` a
   `apps/api/uploads`, que **no se sirve, no se respalda y no está en ningún
   volumen del compose**. Y la columna `imagen` del importador mapea a
   `image_url` como **string** (`:55-56`, `:361`): hoy la foto de un producto es
   una URL que alguien escribió, nunca un archivo.

O sea: **no existe pipeline de imágenes** —ni resize, ni miniaturas, ni
almacenamiento persistente, ni endpoint que las sirva, ni bloque de Caddy, ni
respaldo—. La etapa 0 lo construye entero.

### La maqueta

`docs/maqueta/Catalogo-de-ventas-online.dc.html` (1.680 líneas). **Dos
superficies con reglas distintas**, y el archivo las separa en dos secciones.

**A · La tienda pública** (`<section id="tienda">`, `:64-628`) — 390px, un solo
color configurable (`--marca`, con `--marca-texto` calculado por contraste en
`textoSobre()`, `:1211-1218`).

| Pantalla | Dónde |
|---|---|
| Catálogo con portada, logo, buscador y píldoras de categoría | `esCatalogo`, `:89-158` |
| Ficha de producto con cantidad | `esProducto`, `:160-197` |
| Carrito | `esCarrito`, `:199-255` |
| Checkout de tres pasos con barra de progreso | `esCheckout` / `esDatos` / `esEntrega` / `esPago`, `:257-389` |
| Pedido confirmado | `esConfirmado`, `:391-429` |
| Pie «powered by favalio» | `:443-447` |
| Escritorio: **no se abre a una grilla ancha**, sube a tres columnas dentro de los mismos 720px | `:449-464` |
| **Los seis estados**: cargando, catálogo pausado, búsqueda sin resultados, carrito vacío, pago rechazado y «se agotó mientras compraba» | `:477-624` |

**B · El panel** (`<section id="panel">`, `:631-1193`) — 1560×940, adentro del
shell de Favalio, con los tokens del sistema y modo claro y oscuro.

| Pantalla | Dónde |
|---|---|
| Grupo nuevo **«Venta online»** en la barra lateral, con «Catálogos» y «Pedidos» | `:656-660` |
| Lista de catálogos | `esCatalogos`, `:720-757`; datos en `CATALOGOS`, `:1578-1591` |
| Detalle · Identidad, con previsualización en vivo del color | `tabIdentidad`, `:779-840` |
| Detalle · Entrega y pago | `tabEntrega`, `:842-910` |
| Detalle · **Reglas de precio**, con sangría, «Gana en» y previsualización sobre productos reales | `tabReglas`, `:912-976`; datos en `REGLAS` `:1524-1541` y `PREVIEW` `:1543-1550` |
| Detalle · Productos, con selección múltiple | `tabProductos`, `:978-1013`; datos en `PRODUCTOS_PANEL`, `:1552-1576` |
| Detalle · QR y enlace | `tabQr`, `:1015-1070` |
| Bandeja de pedidos, con filtros por estado | `esPedidos`, `:1073-1110`; datos en `PEDIDOS`, `:1498-1507` |
| Panel lateral del pedido | `hayPedido`, `:1117-1172` |
| Confirmación de «Marcar cobrado» | `hayConfirmacion`, `:1174-1185` |

**Tres cosas del archivo que son decisiones y no adorno**, escritas en
`docs/maqueta/README.md:65-72`:

1. **El color de marca aparece solo en lo que se toca.** Nunca como fondo de una
   zona grande. Por eso la tienda se ve igual de sobria con turquesa que con
   negro, y por eso el archivo trae los cuatro colores de prueba arriba (`:55-58`).
2. La confirmación de «Marcar cobrado» **dice qué toca**. El texto es parte del
   diseño, no un `confirm()` genérico. En esta etapa el texto tiene que decir
   **otra cosa**, porque lo que toca es menos. El texto aprobado está en la
   decisión 4.
3. El pie dice **«powered by favalio»** en todas las pantallas de la tienda.

**Y una divergencia que el pedido ya resolvió**: la maqueta escribe la dirección
como `comprafit.favalio.com/c/comprafit-fitnet` (`:746`, `:1026`), un subdominio
**por empresa**. Esta spec toma `tienda.favalio.com/c/<slug>`. Ver Assumptions.

---
## Hallazgos del relevamiento

Lo que apareció al mirar el código y que **no estaba en el pedido ni en el
plan**. Cada uno dice si entra, y por qué.

### H1 · Mover `calcularPrecios` al servidor no tiene un lugar obvio donde ponerlo

**Entra, y es lo primero que hay que decidir.** El plan dice «mover
`calcularPrecios` a la API y que el POS consuma el mismo cálculo, en el mismo
cambio. Dos copias de la misma regla es el defecto ya documentado de
`mediosDePago.js`». El problema es que **el monorepo no tiene workspaces**
(`package.json:10-24` orquesta con `npm --prefix`), así que «una sola copia» no
tiene dónde vivir hoy.

Y hay un consumidor que no se puede resolver con una llamada HTTP:
`PanelProducto.jsx:203` calcula **en vivo, dentro de un `useMemo`, mientras el
usuario escribe el costo**. Una vuelta al servidor por tecla no es una opción.

**La decisión 1 lo resuelve**: el cálculo vive en **`packages/precios`**, un
paquete compartido con workspaces de npm, que `apps/web` y `apps/api` consumen.
El panel conserva el cálculo instantáneo y no hace falta ningún
`POST /api/precios/simular`. Lo que **no** es negociable: la tienda pública y el
pedido **no pueden** calcular el precio en el navegador, porque ahí el navegador
es el del comprador — el precio del catálogo y el del pedido los pone el
servidor, aunque la función sea la misma.

### H2 · `apps/tienda` sería la tercera copia de todo

**Entra como advertencia, y es parte de lo que sostiene la decisión 1.** La lista de medios de pago
ya está duplicada entre `apps/web/src/utils/mediosDePago.js:48-58` y
`apps/api/src/utils/exportVentas.js:42-54`, con un test que las mantiene
sincronizadas leyendo el archivo del otro paquete como texto
(`apps/web/src/tests/mediosDePago.test.js:46`). El motivo está escrito:
«son dos paquetes y el monorepo no tiene todavía uno compartido».

Una tercera app agrega una tercera copia de todo lo que las tres necesiten:
formato de importes argentinos, etiquetas de estado, normalización de teléfono.
**La tienda tiene que consumir del servidor todo lo que sea una regla** —precio,
estado, disponibilidad— y quedarse solo con dibujar. Y a partir de la decisión 1
**hay dónde poner lo que igual se comparta**: `packages/` deja de ser un lugar
que no existe.

**Y esta advertencia ya se cobró una pieza.** La normalización del teléfono
argentino y el armado del texto del pedido viven hoy en
`apps/web/src/utils/pedidoWhatsapp.js`, y las necesitan el **servidor** —al
guardar el pedido y para armar el `whatsapp_url` de la respuesta— y la
**tienda**: dos apps que **no pueden importar de `apps/web/src`**. Por eso nace
el **segundo paquete compartido, `packages/pedido`** (FR-006c), en vez de una
tercera copia. Que el texto del pedido lo arme el servidor y no la tienda es la
misma advertencia aplicada: si lo armara la tienda, el formato de importes
argentinos tendría su tercera implementación.

### H3 · El gate de `enabled_modules` hoy vive solamente en el navegador

**Entra.** El plan dice «el módulo se libera por `enabled_modules` como
`tiendanube`». Eso es cierto del lado de la interfaz y **falso del lado de la
API**: el único lugar del servidor que toca `enabled_modules` es
`middleware/auth.js:223-225`, que lo expone como `req.empresaSettings`, y
**nadie más en `src/` lo lee**. El gate real de la API es el permiso, y para
TiendaNube son `config.ver` / `config.editar`.

Consecuencia para esta funcionalidad: si el módulo `catalogo` solo se gatea en
`navegacion.js` y en `RouteGuard`, una empresa sin el módulo **igual puede llamar
a los endpoints privados** si tiene el permiso. Y peor: **el catálogo público no
tiene navegador que gatear**. Lo que corta ahí es el estado del catálogo y la
suscripción, no el módulo. Ver FR-160 y FR-161.

### H4 · «Precio de socio» es una promesa que el sistema no puede cumplir

**Entra, y es el hallazgo de producto más caro.** La maqueta pone, debajo del
campo «N° de socio de Fitnet» (`:295`):

> «Es el número de tu carnet. **Con eso aplicamos el precio de socio.**»

No es lo que pasa. Las reglas de precio son **por catálogo** (decisión 3 del
plan) y el N° de socio es **declarativo, sin validar** (decisión 5). O sea que el
precio ya está aplicado desde que se abre la página, **para cualquiera que tenga
el enlace, tenga carnet o no**, y el número que se escribe no cambia un peso.

Las dos salidas son incompatibles con lo que ya está decidido:

- Condicionar el precio al número exige el **padrón del gimnasio**, que el
  pedido pone explícitamente fuera de alcance.
- Dejar el texto es afirmar algo falso en una página pública, con un dato
  personal de por medio.

**La decisión 3 corrige el texto.** El aprobado, exacto, es: «Nos ayuda a
identificarte cuando retirás el pedido.» El precio sigue siendo del catálogo.

### H5 · Un catálogo publicado hoy publicaría 376 productos a $0

**Entra como regla, no como advertencia.** Los números del plan: si hoy se
migrara, serían 431 productos, **96 % sin marca, ninguno con foto, ninguno con
descripción y 376 con costo $0**. Y `calcularPrecios` ya tiene la bandera:
`sinCosto` es `true` cuando `cost <= 0` y no hay `price_override`
(`precios.js:128`), justamente porque «un producto sin costo y sin precio manual
sale a $0 en el POS y se puede vender gratis sin que nada avise».

En el POS eso lo mira una persona. En una página pública, no: **un producto a $0
es una oferta**, y alguien la va a tomar. La regla es que un producto sin precio
resoluble **no sale al catálogo**, aunque esté marcado publicable, y el panel
diga cuántos son y cuáles. Ver FR-071 y FR-072.

### H6 · `products.image_url` ya existe, y hoy puede apuntar a cualquier lado

**Entra.** La columna es `TEXT` (`Product.js:78`) y el importador la llena desde
una columna del CSV llamada `imagen` (`import.js:55-56`, `:361`). O sea que en la
base puede haber la URL de la foto en el hosting de un tercero.

Si la tienda pública dibuja esa URL tal cual: (a) cada visita le cuenta una
visita al tercero y le manda el `Referer` con el slug del catálogo, (b) el día
que el tercero borre el archivo la página muestra fotos rotas, y (c) el respaldo
del volumen propio —que esta etapa construye— no la cubre. La regla es que la
tienda **solo publica imágenes del volumen propio**. Ver FR-045.

### H7 · Contar visitas es una escritura por cada lectura pública

**Entra, con la forma que lo hace barato.** La pestaña del QR muestra tres
números (`:1044-1048`) y no hay dónde sacarlos. Un contador ingenuo —una fila por
visita— convierte el endpoint más leído del sistema en el que más escribe.

Se cuenta **agregado por día y por catálogo**, con un `INSERT … ON CONFLICT DO
UPDATE` sobre **`(catalogo_id, fecha, origen, estado_catalogo)`**, sin IP y sin
cookie. Es una fila por día, por catálogo, por origen y por estado, no una por
visita. Ver US20.

**La cuarta columna es del diseño técnico y no del borrador**: con la clave de
tres, la fila no guarda en qué estado estaba el catálogo cuando entró la visita,
y US20 escenario 7 —separar las visitas que ocurrieron con el catálogo pausado—
queda sin poder contestarse. Guardar el estado no agrega nada del visitante y a
lo sumo triplica las filas, que en la práctica es una sola por día porque un
catálogo no cambia de estado todos los días.

Y el rótulo tiene que decir la verdad: el servidor **no puede distinguir un
escaneo de QR de alguien que abrió el enlace que le pasaron**, salvo que el QR
codifique un parámetro propio. Lo codifica (`?f=qr`), y aun así alguien que
comparta la URL desde su navegador la comparte con el parámetro puesto. Por eso
el número se llama **visitas** y el desglose por origen es una ayuda, no una
verdad. Ver FR-202.

### H8 · La confirmación del pedido promete un email que puede no salir

**Entra.** La maqueta escribe «Te mandamos el detalle por email a
martina.olivera@gmail.com» (`:399`) como un hecho ya ocurrido. `sendEmail`
(`services/email.js:34`) devuelve `ok: false` cuando no hay `RESEND_API_KEY` —lo
verifica `observabilidad.test.js:125-144`—, y ese es exactamente el defecto que
`CONVENCIONES.md` pone como ejemplo de por qué existe este método:
«`sendEmail` devolvía `ok: true` sin haber enviado nada».

El pedido **no depende** del email: se crea igual. Lo que no puede pasar es que
la pantalla afirme un envío que no ocurrió. Ver FR-142.

### H9 · La bandeja arranca sin decir que el stock no baja

**Entra.** Es el mismo hallazgo que la spec 013 marcó en TiendaNube (US7 de
aquella): una pantalla que no advierte que los pedidos no tocan el inventario.
Acá es peor, porque la maqueta afirma lo contrario (`:1080`).

Con las etapas 0-2 en producción, un comercio que reciba treinta pedidos por
semana va a tener el stock inflado en treinta pedidos, y lo va a descubrir en un
recuento físico. La bandeja **tiene que decirlo, arriba y todo el tiempo**, hasta
que la etapa 3 lo cambie. Ver FR-181.

### H10 · El límite de peticiones puede cortar la caja del comercio

**Entra.** El limitador global es 600 peticiones cada 15 minutos **por IP**
(`server.js:312-319`) y corre antes de la autenticación, con el motivo escrito
(`:307-311`). Un gimnasio entero sale a internet por un router: cincuenta socios
escaneando el QR comparten cupo con las cajas del comercio si están en la misma
red, y **con la red de cualquier otro cliente detrás del mismo NAT**.

Hacen falta **dos cosas, y las dos**: un limitador propio para el prefijo
público, por slug además de por IP, **y eximir ese prefijo del limitador global**
con un `skip`. **Un limitador propio solo no alcanza**, y esto es lo que el
diseño técnico corrigió de la primera versión de esta spec: el router público se
monta **debajo** de `app.use('/api/', limiter)` (FR-090), así que cada visita
igual consume el cupo global; agregarle un segundo límite le pone dos límites al
catálogo y le sigue comiendo el del comercio. Recién con el `skip` el cupo de las
cajas vuelve a ser de las cajas.

Y **medir cuántas llamadas hace una visita antes de publicar**: si abrir el
catálogo dispara cuatro llamadas, 600/15min son 150 visitas cada quince minutos
para toda la IP. Ver US10 y FR-113 a FR-115.

### H11 · `Customer` no tiene índice por `empresa_id`

**Entra como nota para el plan, no como historia.** `models/Customer.js:51-52`
declara índices por `name` y `tax_id` y **ninguno por `empresa_id`**. El pedido
crea o actualiza un `Customer` por comprador (decisión 5 del plan): con el
catálogo andando, esa tabla pasa a recibir escrituras de gente que no es cliente
del comercio todavía, y toda búsqueda scopeada va a barrer la tabla entera.

No cambia el comportamiento y por eso no tiene historia propia; sí tiene FR
(FR-151) porque la migración es de esta funcionalidad.

### H12 · `POST /api/sales` acepta el precio unitario del cliente

**Se advierte, no se corrige acá.** `routes/sales.js:311-630` toma el
`unit_price` de cada línea y solo verifica que el total cierre. El pedido público
**nunca** manda precio (FR-130) y el servidor lo resuelve, así que esta
funcionalidad no lo empeora. Pero mover el cálculo al servidor (US1) deja el
camino abierto para cerrarlo, y hacerlo en el mismo cambio significaría tocar el
punto de venta —el camino más caliente del sistema— en una funcionalidad que no
es del punto de venta. Queda anotado en «Fuera de alcance».

### H13 · Un catálogo publicado puede quedar apuntando a una sucursal apagada

**Entra.** El catálogo declara su `punto_de_venta_id` y de ahí sale el stock que
se lee. Nada impide hoy desactivar ese punto de venta
(`PuntoDeVenta.is_active`): el catálogo quedaría publicado, leyendo stock de una
sucursal que la empresa dio de baja, sin que nada avise. Ver FR-059.

---

## Vocabulario: qué significa cada palabra acá

Cinco palabras de esta funcionalidad ya significan otra cosa en el repositorio.
Escribirlo evita la discusión de la semana que viene.

| Palabra | Qué significa **acá** | Con qué se confunde |
|---|---|---|
| **Tienda** | La app pública `apps/tienda`, servida en `tienda.favalio.com` | En el legacy «tienda» es **sucursal física** (`legacy:3011`). En Favalio la sucursal es `PuntoDeVenta` |
| **Catálogo** | Una fila de `catalogos`: un slug, una cara, unas reglas de precio y una selección de productos. Una empresa puede tener varios | El «catálogo» de productos del punto de venta (`components/pos/CatalogoDelPos.jsx`) es la grilla de búsqueda de la caja |
| **Pedido** | Una fila de `pedidos`: lo que arma un visitante en la tienda pública. **No es una venta** y en estas etapas **no genera ninguna** | «Orden de compra» (`SupplierOrder`) es lo que la empresa le pide a un proveedor, y va al revés. `TiendanubePedido` es un pedido de TiendaNube, que sí descuenta stock |
| **Precio de lista** | El precio de venta de la empresa **antes** de las reglas del catálogo: el `cashPrice` de `calcularPrecios`. Es el número tachado de la tienda y la columna «Precio de lista» de la previsualización (`:960`) | `products.price_override`, que es un campo de entrada y no un resultado |
| **Precio del catálogo** | El resultado de aplicar al precio de lista la regla que gana | El `alliancePrice` de `calcularPrecios`, que es el descuento de alianza del POS y no tiene nada que ver |
| **Publicable** | `products.publicable`: el producto **puede** salir a una tienda pública. Es una decisión del inventario | `products.is_active`: el producto existe para el ABM interno y para el POS. Sin una bandera propia, publicar un catálogo publicaría todo lo del punto de venta |
| **Visitas** | Aperturas del catálogo público contadas del lado del servidor, agregadas por día | «Escaneos», que es lo que dice la maqueta y lo que el servidor **no puede** medir (H7) |

---

## Qué se verifica en qué nivel

`CONVENCIONES.md` fija la escalera —tres niveles en `apps/web`, cuatro en
`apps/api`—. Acá se aplica caso por caso, que es donde se equivoca. **Primero la
función pura.** El navegador es el último recurso.

**Y el cuarto nivel no es opcional en esta funcionalidad, es la mitad del
trabajo**: con `BYPASS_AUTH=true` la suite rápida **no puede** distinguir un
endpoint público bien aislado de uno que filtra todo.

### Etapa 0 · precios, imágenes y `publicable`

| Afirmación | Nivel | Archivo |
|---|---|---|
| Los tres precios de un producto, con costo cero, margen cero, precio manual, recargo del 100 % y `cost` que vuelve como string | **Función pura** | Los **21 casos** de `apps/web/src/utils/precios.test.js` —contados sobre el archivo, no estimados— **se mudan con la función** y tienen que seguir pasando **sin cambios**, estén donde estén |
| Que el POS y el catálogo den **el mismo número** para el mismo producto | **Función pura**, sobre la única copia | El test vive **en `packages/precios`** (decisión 1), y el CI tiene que correrlo: es trabajo del plan decidir si va en un job propio o adentro de los que ya hay |
| Que `apps/web` y `apps/api` consuman `packages/precios` y ninguno tenga su propia copia de la fórmula | **Guardia estática** | El molde es `guardiaDelArnes.test.js`, que ya lee `ci.yml` y `package.json` como texto |
| Que un producto con `sinCosto` no salga al catálogo | **Función pura** | `apps/api/src/tests/` (nunca `utils/*.test.js`: jest no lo levanta) |
| Que la imagen subida se redimensione a las medidas declaradas y no más grande | **Integración** o test de servicio con un archivo real | `apps/api/src/tests/` |
| Que un archivo que no es imagen, o que miente el `Content-Type`, se rechace | **Integración** | idem |
| Que `deploy/respaldo.sh` incluya el volumen de imágenes | **Guardia estática** sobre el `.sh` | El molde es `guardiaDelArnes.test.js`, que lee `ci.yml` y `package.json` como texto |
| Que `products.publicable` no se pueda escribir desde un endpoint público | **Guardia estática** | `permisosDeRutas.test.js` |

### Etapa 1 · catálogo, reglas y aislamiento

| Afirmación | Nivel | Archivo |
|---|---|---|
| **Qué regla gana** para un producto dado, con las cuatro combinaciones de ámbito y las tres de tipo | **Función pura** | `apps/api/src/utils/reglasDePrecio.js` + su test en `src/tests/` |
| **La cobertura**: cuántos productos alcanza cada regla y en cuántos gana | **Función pura** | idem — es lo que dibuja «Gana en 2 de 4» (`:942`) |
| Que dos reglas del mismo ámbito y el mismo valor no puedan coexistir | **Integración** | el único que la garantiza es el índice de la base |
| Que un `%` de descuento del 100 % dé cero y no negativo; que un monto mayor que el precio dé cero; que un precio fijo de $0 se rechace | **Función pura** | idem |
| El slug: qué se acepta, cómo se normaliza, qué pasa con acentos y mayúsculas | **Función pura** | `apps/api/src/utils/slugDeCatalogo.js` |
| **Que el catálogo de B dé 404 desde el enlace de A** | **Integración con dos empresas** | `src/tests/integracion/catalogoPublico.integracion.test.js` — es el criterio 6 |
| **Que ninguna respuesta pública lleve `cost`, `margin_override`, `wholesale_*`, `supplier_id` ni un `empresa_id` ajeno** | **Guardia estática** *(la red)* **+ integración** *(la prueba)* | Guardia nueva sobre el serializador público + el test de integración que mira el JSON entero |
| Que un slug inexistente y un catálogo en borrador den **el mismo** 404 | **Integración** | idem |
| Que la empresa con la suscripción vencida devuelva 402 en el catálogo público | **Integración** | idem — y **solo** ahí se puede probar: `BYPASS_AUTH` saltea `checkSubscription` en la cadena privada (`server.js:407`) |
| Que el router público esté montado **debajo** del parser y del limitador y **arriba** del genérico | **Guardia estática** | `observabilidad.test.js`, con `:394-536` de molde |
| Que el limitador global **exima** el prefijo público, y que el `skip` no pueda quedar sin el limitador propio | **Guardia estática**, con la **atadura** entre las dos líneas | idem — es FR-113b, y es la única red posible: borrar el `skip` no rompe nada que se vea, y ninguna suite de ejecución distingue «el catálogo consume el cupo del comercio» de «no lo consume» |
| Que la tienda entre a 390px sin desbordar el `<body>` | **Prueba de navegador** | `apps/tienda` necesita su propio arnés, o se mide desde el de `apps/web` |
| El tono del badge de estado del catálogo | **Función pura** | `apps/web/src/utils/catalogos.js` |
| Que encabezado y filas de las cuatro tablas nuevas compartan `grid-template-columns` | **Test de render** | `apps/web/src/tests/renderDeCatalogos.test.jsx` |
| Que las pantallas nuevas no tengan hex, `dark:`, `Table*` ni clases de la paleta | **Guardia estática** | `guardiasDeDiseno.test.js`, subiendo `NOMBRES` y su `toHaveLength` |

### Etapa 2 · pedido

| Afirmación | Nivel | Archivo |
|---|---|---|
| El total del pedido a partir de las líneas y el envío, con cantidad cero, un producto repetido y el umbral de envío gratis justo | **Función pura** | `apps/api/src/utils/totalDePedido.js` + test |
| Que el servidor ignore cualquier precio que venga en el cuerpo | **Integración** | `src/tests/integracion/pedidoPublico.integracion.test.js` |
| **Que un `product_id` de otra empresa no cree ninguna fila** | **Integración con dos empresas** | idem — y la guardia estática de `aislamientoEmpresas.test.js:867-1044` tiene que verlo también |
| Que el mismo pedido enviado **dos veces en paralelo** cree uno solo, y que lo garantice el `UNIQUE` de `idempotency_key` | **Integración** | idem. Un test secuencial no toca esa mitad (`CONVENCIONES.md`, «El cuarto nivel») |
| Que la numeración no se repita con dos pedidos simultáneos de la misma empresa | **Integración** | idem |
| Que con la puerta cerrada **no se dibujen** el DNI ni la casilla de marketing, y que el servidor los **ignore** aunque vengan en el cuerpo | **Test de render** + **integración** | el render prueba el dibujo; la integración, que la fila no guardó ni el DNI ni el consentimiento |
| Que con la puerta abierta la casilla arranque **desmarcada** y que sin marcarla no se guarde el dato para marketing | **Test de render** + **integración** | idem |
| Que el checkout se pueda mandar **sin más datos del comprador que nombre y teléfono** —con la entrega y el medio de pago elegidos, que siempre lo están—, y que sin dirección con envío a domicilio se rechace | **Función pura** *(la regla de obligatoriedad)* + **integración** | la función pura decide qué falta; la integración, que el servidor no la esquiva. Ver FR-149 y FR-149b |
| Que un pedido **sin entrega o sin medio de pago** se rechace en el servidor | **Integración** | son ENUM `NOT NULL` y FR-141 los revalida: el borde que la frase «el pedido mínimo es nombre y teléfono» dejaba ambiguo |
| Que un producto publicable nuevo **no aparezca** en un catálogo hasta que lo agreguen | **Integración** | `catalogoPublico.integracion.test.js` — es la decisión 9 y no se puede probar con una función pura |
| Que el aviso de la bandeja **no tenga** botón de cerrar | **Test de render** | `apps/web/src/tests/renderDePedidos.test.jsx` |
| Que un producto agotado devuelva su línea quitada y el total nuevo | **Integración** | idem |
| Que «Marcar cobrado» **no** escriba en `stock` ni cree una `Sale` | **Integración**, afirmando lo que **no** pasó | es la mitad que se olvida: el test tiene que mirar las dos tablas |
| Que el estado del pedido solo avance por las transiciones permitidas | **Función pura** | `apps/api/src/utils/estadoDePedido.js` |
| Que la bandeja diga que el stock no baja | **Test de render** | `apps/web/src/tests/renderDePedidos.test.jsx` |

**Advertencia sobre la fixture**, que es donde este proyecto más se equivocó
(`fixtures.js:22-48`): la de esta funcionalidad necesita **dos empresas con un
catálogo publicado cada una**, **un producto con costo $0**, **un producto sin
marca**, **un producto con `available = 0` y `quantity > 0`**, **una regla de cada
ámbito sobre el mismo producto** —si no, no se puede ver cuál gana—, **importes
que dejen centavos** —los redondos cierran igual con y sin redondeo—, **un
subtotal exactamente igual al umbral de envío gratis**, y **dos catálogos de la
misma empresa** para que «el pedido cayó en el catálogo equivocado» sea
detectable.

---
## User Scenarios & Testing *(mandatory)*

Veinte historias, agrupadas por etapa. Las de la etapa 0 no se ven en ninguna
pantalla y **son las que sostienen todo lo demás**.

---

## Etapa 0 · Cimientos

### User Story 1 — El precio de venta lo calcula el servidor, y el punto de venta usa esa misma cuenta (Priority: P1)

Como dueño, quiero que el precio que ve un desconocido en mi catálogo salga de la
misma cuenta que el precio de mi caja, para que no existan dos verdades sobre
cuánto sale un producto.

**Why this priority**: es la etapa 0 y no hay forma de saltearla. El precio no se
puede calcular en el navegador del comprador —ahí es donde vive el costo, el
margen y el precio mayorista—, y tener una segunda cuenta en el servidor es
exactamente el defecto que `mediosDePago.js` documenta desde el hito 6: dos
copias empiezan iguales y terminan distintas.

**Independent Test**: pedirle al servidor el precio de un producto conocido y
compararlo, número contra número, con el que muestra el punto de venta para ese
mismo producto y esa misma empresa. Verificable contra hoy, donde el servidor no
sabe calcular ningún precio.

**Acceptance Scenarios**:

1. **Given** un producto con costo $100 y la empresa con `margin_efectivo: 50`,
   **When** le pido el precio al servidor, **Then** devuelve $150 —recargo sobre
   el costo, la convención escrita en `precios.js:1-17`— y no $200.
2. **Given** el mismo producto, **When** miro el punto de venta, **Then** muestra
   $150, y el número **sale de la misma cuenta**, no de una segunda escrita en
   otro archivo.
3. **Given** un producto con `price_override` cargado, **When** se calcula,
   **Then** gana el precio manual sobre el costo por el margen.
4. **Given** un producto con costo $0 y sin precio manual, **When** se calcula,
   **Then** el resultado viene marcado como **sin precio resoluble**, y no como
   «$0».
5. **Given** una empresa con `recargo_tarjeta: 100` y modo `compensa_comision`,
   **When** se calcula el precio con tarjeta, **Then** devuelve «no aplicable» y
   no `Infinity`. Es el caso que `precios.js:63-65` ya resuelve y que no se puede
   perder en la mudanza.
6. **Given** `cost` que vuelve del driver como el string `'100.00'`, **When** se
   calcula, **Then** el resultado es el mismo que con el número 100.
7. **Given** que edito el costo de un producto en el panel lateral, **When**
   escribo, **Then** la previsualización del precio **sigue actualizándose
   mientras escribo** y no una vez por segundo ni al salir del campo.
8. **Given** los **21 casos** de `apps/web/src/utils/precios.test.js` —contados
   sobre el archivo—, **When** la función se muda, **Then** **los 21 siguen
   corriendo y siguen pasando, sin que se toque ninguna aserción**, en el lugar
   que le corresponda a la nueva ubicación. Que pasen **sin cambios** es lo que
   prueba que la mudanza no cambió ningún resultado: un caso reescrito para que
   pase deja de decir nada sobre la fórmula, y un total menor que 21 es una
   mudanza que perdió casos sin que nada falle.
9. **Given** la funcionalidad terminada, **When** busco la fórmula en el
   repositorio, **Then** aparece **una sola vez**, en **`packages/precios`**, y
   `apps/web` y `apps/api` la importan de ahí. Una segunda copia es un hallazgo,
   y hay una guardia estática que falla si alguna de las dos apps vuelve a
   escribir la fórmula por su cuenta.
10. **Given** el monorepo con workspaces, **When** corre el CI, **Then** los
    los jobs del CI siguen pasando con la nueva forma —`package.json` raíz,
    `package.json` de las cuatro apps y Dockerfiles incluidos—, y el paquete se
    construye antes que las apps que lo consumen.

---

### User Story 2 — Subir la foto de un producto, y que esa foto siga estando después de un respaldo (Priority: P1)

Como dueño, quiero cargar la foto de un producto desde el panel y que se vea en
mi catálogo, para que la página que ve un socio no sea una lista de nombres.

**Why this priority**: decisión 10 del plan, «un catálogo de suplementos sin foto
es medio catálogo». Y la segunda mitad del título no es un agregado: hoy
`deploy/respaldo.sh:42` vuelca **solo Postgres**. Un volumen de imágenes que no
se respalda es un volumen que se pierde con el disco, y las fotos de producto son
trabajo humano que no se puede volver a generar desde un `pg_dump`.

**Independent Test**: subir una foto de 4 MB, verificar que se sirve
redimensionada desde `tienda.favalio.com`, correr `deploy/respaldo.sh` y
verificar que el archivo está adentro del respaldo. Verificable contra hoy, donde
no hay endpoint de subida y el respaldo no mira el disco.

**Acceptance Scenarios**:

1. **Given** un producto sin foto, **When** subo un JPEG de 4000×3000, **Then**
   queda guardada en el volumen y se sirve en las medidas declaradas, no en las
   originales.
2. **Given** la foto guardada, **When** la pide la tienda, **Then** la sirve
   **Caddy** desde el volumen y no la API: una API que sirve archivos estáticos
   compite con las cajas del comercio por el mismo proceso.
3. **Given** un archivo que no es una imagen renombrado a `.jpg`, **When** lo
   subo, **Then** se rechaza con un mensaje en castellano, y el rechazo mira **el
   contenido**, no la extensión ni el `Content-Type` que mandó el cliente.
4. **Given** un archivo más grande que el límite, **When** lo subo, **Then** se
   rechaza diciendo cuál es el límite. Un error de multer sin manejar responde un
   500 con el nombre del campo (`routes/empresas.js:178-180` es el molde de cómo
   se maneja).
5. **Given** una foto subida, **When** la borro, **Then** desaparece del volumen
   **y** de `products.image_url`, y el catálogo deja de mostrarla.
6. **Given** dos empresas, **When** la B pide la foto de un producto de la A por
   su URL, **Then** **la imagen se sirve**: las fotos de producto **son públicas
   por URL y eso se acepta**, porque son fotos de catálogo pensadas para una
   página pública, no documentos. Lo que **no** se acepta es que la URL sea
   **adivinable**: el nombre del archivo es **aleatorio**, con el molde de
   `Invitacion.js:24-29`, para que nadie pueda recorrer el catálogo entero de
   todas las empresas incrementando un número. O sea: **público sí, enumerable
   no**, y Caddy sirve el volumen sin consultar permisos.
7. **Given** un producto con una `image_url` que apunta afuera —cargada por el
   importador de CSV—, **When** el catálogo lo publica, **Then** **no se dibuja
   esa imagen**, y la pestaña Productos del panel marca ese producto como «foto
   externa, no se publica» con la explicación.
8. **Given** el volumen con imágenes, **When** corre `deploy/respaldo.sh`,
   **Then** el respaldo incluye el volumen, verifica que no quedó vacío —como ya
   hace con el `.sql.gz` en `:46-49`— y rota igual que la base.
9. **Given** un respaldo hecho, **When** se restaura en una máquina limpia,
   **Then** las fotos vuelven a verse. **Es un paso manual y va escrito en
   `OPERACION.md`**: un respaldo que nunca se restauró no es un respaldo.
10. **Given** un usuario sin permiso de edición de productos, **When** entra a la
    ficha, **Then** el botón de subir está **deshabilitado con su explicación**, y
    no ausente.

---

### User Story 3 — Decir qué productos pueden salir a una tienda pública (Priority: P1)

Como dueño, quiero marcar qué productos pueden aparecer en un catálogo público,
para que publicar una tienda no publique todo lo que tengo cargado en el sistema.

**Why this priority**: sin una bandera propia, `is_active` —que es el flag del
ABM interno y del punto de venta— pasa a significar dos cosas a la vez, y la
primera vez que alguien reactiva un producto viejo lo publica en internet sin
saberlo.

**Independent Test**: marcar tres productos como publicables de sesenta y dos,
publicar un catálogo y verificar que solo se ven esos tres. Verificable contra
hoy, donde la columna no existe.

**Acceptance Scenarios**:

1. **Given** la migración corrida, **When** miro cualquier producto existente,
   **Then** `publicable` es **`false`**. El default seguro es no publicar: la
   migración no puede dejar 431 productos publicados esperando a que alguien cree
   el primer catálogo.
2. **Given** un producto publicable, **When** lo desactivo (`is_active = false`),
   **Then** deja de salir en el catálogo aunque siga marcado publicable. Un
   producto que no existe para la caja no puede existir para la tienda.
3. **Given** un producto no publicable, **When** lo agrego a mano a un catálogo,
   **Then** el sistema lo rechaza y dice por qué. Las dos banderas son un `Y`, no
   un `O`.
4. **Given** la pestaña Productos del catálogo, **When** selecciono varios y
   aprieto «Publicar», **Then** los marca a todos y el contador de arriba —«8
   publicados de 62 del inventario» (`:985`)— se actualiza.
5. **Given** un producto sin precio resoluble (H5), **When** lo marco publicable,
   **Then** se marca igual pero la fila queda señalada: **no va a salir al
   catálogo hasta que tenga costo o precio**, y la pantalla lo dice sin que haya
   que buscarlo.
6. **Given** un endpoint público cualquiera, **When** intento escribir
   `publicable`, **Then** no existe camino: la columna solo se escribe desde la
   API privada, con permiso.
7. **Given** un catálogo ya publicado, **When** doy de alta un producto nuevo y
   lo marco publicable, **Then** **no aparece en ese catálogo ni en ningún otro**
   hasta que alguien lo agregue explícitamente (decisión 9). `publicable` habilita
   que **pueda** publicarse; no publica nada por sí solo.
8. **Given** una importación de CSV con cincuenta productos, **When** termina,
   **Then** **ningún catálogo cambió**: la selección de cada catálogo es una lista
   de inclusión y nadie la tocó.
9. **Given** un producto que está en un catálogo, **When** lo quito desde la
   pestaña Productos, **Then** **se borra su fila de `catalogo_productos`** y deja
   de verse. No queda marcado como «no visible»: no existe esa bandera.

---

## Etapa 1 · Catálogo visible

### User Story 4 — Crear un catálogo, ponerle cara y publicarlo (Priority: P1)

Como dueño, quiero crear un catálogo con su nombre, su color, su logo, su portada
y su dirección web, y publicarlo cuando esté listo, para tener una página que
mostrar sin depender de nadie.

**Why this priority**: es la fila de la base sobre la que se cuelga todo lo
demás, y es la primera pantalla que el cliente ve de esta funcionalidad.

**Independent Test**: crear el catálogo «Comprafit / Fitnet» con slug
`comprafit-fitnet`, publicarlo y abrir `tienda.favalio.com/c/comprafit-fitnet`
en un navegador sin sesión.

**Acceptance Scenarios**:

1. **Given** una empresa sin catálogos, **When** entro a Catálogos, **Then** veo
   el estado vacío con dos líneas y una acción principal «Nuevo catálogo».
2. **Given** que creo uno, **When** escribo el nombre visible, **Then** se propone
   un slug derivado —minúsculas, sin acentos, `[a-z0-9-]`— y **lo puedo cambiar**.
3. **Given** un slug ya tomado por **otra empresa**, **When** lo guardo, **Then**
   se rechaza con un mensaje que dice que ese nombre no está disponible **y no
   dice de quién es**. El slug es único global (supuesto del plan) y quién lo tiene
   no es asunto de quien pregunta.
4. **Given** un slug con mayúsculas, acentos o espacios, **When** lo guardo,
   **Then** se normaliza antes de guardar, y la normalización es la misma que
   propuso el formulario.
5. **Given** un slug reservado —`admin`, `api`, `assets`, `c`, `robots.txt`—,
   **When** lo guardo, **Then** se rechaza. Un catálogo que se llame como una
   ruta de la app rompe la app.
6. **Given** un catálogo nuevo, **When** lo miro, **Then** está en **borrador** y
   su URL pública responde **404**, igual que un slug que no existe y por el mismo
   motivo: quien prueba direcciones no debe poder distinguir «existe pero no está
   publicado» de «no existe».
7. **Given** un catálogo en borrador, **When** aprieto «Publicar», **Then** solo
   se publica si tiene nombre visible, slug, punto de venta activo y **al menos un
   producto que salga** (publicable, activo y con precio resoluble). Si falta algo,
   la pantalla **dice qué falta**, uno por uno.
8. **Given** un catálogo publicado, **When** aprieto «Pausar», **Then** la URL
   sigue respondiendo y muestra la pantalla de pausa que dibuja la maqueta
   (`:500-513`): la portada apagada, el nombre, y el botón de WhatsApp. **No un
   404**: el socio tiene que reconocer que llegó al lugar correcto.
9. **Given** el color de marca, **When** lo cambio, **Then** la previsualización
   de la derecha (`:826-838`) se actualiza en vivo, y usa el color **en los mismos
   dos lugares que la tienda real**: la portada y el botón. Nunca de fondo de una
   zona grande.
10. **Given** un color de marca muy claro, **When** se dibuja el botón, **Then**
    el texto encima es oscuro y no blanco. El contraste se calcula, no se elige:
    la maqueta ya trae la función (`textoSobre`, `:1211-1218`) y los cuatro colores
    de prueba (`:55-58`).
11. **Given** el logo y la portada, **When** los subo, **Then** valen las mismas
    reglas que US2, y la pantalla dice las medidas que espera: 1200×480 la portada
    (`:812`), y el logo con fondo transparente (`:804`).
12. **Given** un usuario sin `catalogo.editar`, **When** entro, **Then** veo todo
    y **no puedo tocar nada**: los campos y los botones están deshabilitados con
    su explicación, no ausentes.
13. **Given** el punto de venta del catálogo, **When** alguien intenta
    desactivarlo desde Sucursales, **Then** se rechaza nombrando el catálogo que
    lo usa (H13).
14. **Given** el formulario del catálogo, **When** lo completo, **Then** hay un
    campo de **casilla de correo para los avisos de pedido nuevo**, al lado del
    WhatsApp de destino y con el mismo alcance: **por catálogo** (decisión 7).
    Vacío es válido, y la pantalla avisa que así nadie se entera por correo.
15. **Given** el interruptor «mostrar precio de lista», **When** creo un catálogo
    nuevo, **Then** está **apagado**: el default seguro es no publicar el margen,
    y encenderlo es una decisión del comercio (decisión 8).
16. **Given** un catálogo publicado, **When** cambio su slug, **Then** la pantalla
    avisa **antes de guardar** que los QR y carteles impresos dejan de funcionar y
    pide confirmación; el slug viejo **muere** y no redirige (decisión 11).
17. **Given** un catálogo **con pedidos**, **When** intento borrarlo, **Then**
    **se rechaza** y la pantalla ofrece **pausarlo** en su lugar, explicando que
    un pedido que apunta a un catálogo inexistente es un pedido que la bandeja no
    puede explicar (decisión 11). Un catálogo **sin** pedidos sí se borra.

---

### User Story 5 — Poner precios por catálogo con reglas, y ver dónde manda cada una (Priority: P1)

Como dueño, quiero definir el precio de mi catálogo con reglas —todo el catálogo,
una categoría, una marca o un producto— y ver antes de publicar qué precio le
queda a cada producto, para no descubrir el error en la calle.

**Why this priority**: es la decisión 3 del plan y es la razón de ser del
producto: «el visitante ve el catálogo con el precio que la empresa definió
**para ese catálogo**». Y es donde un error es más caro: una regla mal puesta
publica un precio equivocado a cualquiera con el enlace.

**Independent Test**: cargar las cuatro reglas que dibuja la maqueta —producto,
marca ENA, categoría Proteínas y todo el catálogo— y verificar que la
previsualización devuelve los seis precios de `PREVIEW` (`:1543-1550`) y las
coberturas de `REGLAS` (`:1524-1541`).

**Acceptance Scenarios**:

1. **Given** el motor de reglas, **When** un producto está alcanzado por varias,
   **Then** gana **una sola**, la más específica: producto → marca → categoría →
   catálogo. **No se acumulan.**
2. **Given** un producto con regla propia y regla de marca, **When** se calcula,
   **Then** el resultado es el de la regla de producto, y la previsualización
   **muestra tachada** la que quedó pisada (`:969`), con su nombre.
3. **Given** las cuatro reglas de la maqueta sobre ocho productos, **When** miro
   la tabla, **Then** cada fila dice «gana en N de M»: 1 de 1, 2 de 2, 1 de 2 y
   4 de 8 (`:1525-1528`). El motor devuelve **cobertura**, no solo el precio final.
4. **Given** una regla que no gana en ningún producto, **When** la miro, **Then**
   la fila está atenuada y dice «0 de N». Una regla que no hace nada tiene que
   verse que no hace nada.
5. **Given** los tres tipos, **When** los aplico sobre un precio de lista de
   $10.000, **Then**: porcentaje 12 % da $8.800; monto $1.500 da $8.500; precio
   fijo $7.900 da $7.900.
6. **Given** un porcentaje de descuento de 100, **When** se aplica, **Then** el
   precio es **cero** y no negativo. Es la misma guarda que `precioConDescuento`
   ya tiene (`precios.js:80`).
7. **Given** un porcentaje mayor que 100 o negativo, **When** lo guardo, **Then**
   se rechaza al escribirlo, no al aplicarlo.
8. **Given** un monto de descuento mayor que el precio de lista, **When** se
   aplica, **Then** el precio es cero, **y la previsualización lo marca**: un
   producto a $0 en una página pública es una oferta que alguien va a tomar.
9. **Given** un precio fijo de $0, **When** lo guardo, **Then** se rechaza.
10. **Given** que `products.category` es texto libre (`Product.js:60`), **When**
    creo una regla de ámbito categoría, **Then** elijo entre **las categorías que
    existen hoy en los productos publicables de este catálogo**, no de una lista
    fija, y la comparación es la misma que usa la búsqueda del catálogo.
11. **Given** una regla de categoría sobre `Proteínas`, **When** alguien renombra
    esa categoría en un producto, **Then** ese producto deja de estar alcanzado, y
    la cobertura de la regla baja **en la próxima vez que se mire**. La regla no
    se rompe: deja de alcanzar.
12. **Given** dos reglas del mismo ámbito y el mismo objetivo, **When** guardo la
    segunda, **Then** se rechaza con un mensaje que nombra la que ya está. Lo
    garantiza un índice **único de la base**, no un `findOne` previo.
13. **Given** una regla de producto sobre un producto de **otra empresa**,
    **When** la guardo, **Then** responde 404 y **no queda ninguna fila**.
14. **Given** una regla desactivada, **When** se calculan los precios, **Then**
    se comporta como si no existiera, y la fila lo muestra.
15. **Given** la previsualización, **When** la miro, **Then** muestra el precio de
    lista tachado, la regla que gana, las que quedaron pisadas y el precio final
    (`:959-973`) — que son las mismas cinco columnas de la maqueta.
16. **Given** un catálogo sin ninguna regla, **When** lo publico, **Then** los
    precios son los de lista, sin descuento, y nada se rompe.

---

### User Story 6 — Abrir el enlace y ver el catálogo de esa empresa, y de ninguna otra (Priority: P1)

Como visitante, quiero abrir `tienda.favalio.com/c/comprafit-fitnet` y ver el
catálogo de Comprafit, para poder comprar sin registrarme en nada.

**Why this priority**: es el riesgo 1 del plan escrito como historia. Todo el
aislamiento del repositorio supone `req.usuario`, y acá no hay usuario. Si esto
sale mal, sale mal en silencio y en una página pública.

**Independent Test**: con dos empresas sembradas y un catálogo publicado en cada
una, pedir el catálogo de la B y verificar que **todo** lo que vuelve es de la B,
y que ningún identificador de la A aparece por ningún camino. Es
`src/tests/integracion/catalogoPublico.integracion.test.js`.

**Acceptance Scenarios**:

1. **Given** un slug publicado, **When** lo pido sin ninguna cabecera de sesión,
   **Then** responde 200 con la marca, la entrega, los medios de pago y las
   categorías de **esa** empresa.
2. **Given** el mismo pedido con una cabecera `X-Empresa-Id` de otra empresa,
   **When** llega, **Then** **la cabecera se ignora por completo**. La empresa
   sale del slug y de ningún otro lado. `loadEmpresaContext` no corre acá, y no se
   reutiliza: tiene la rama del superadmin (`auth.js:172-200`).
3. **Given** un slug que no existe, **When** lo pido, **Then** 404.
4. **Given** un slug en **borrador**, **When** lo pido, **Then** 404, **con el
   mismo cuerpo** que el anterior.
5. **Given** un slug **pausado**, **When** lo pido, **Then** 200 con el estado
   «pausado» y solo lo necesario para dibujar la pantalla de pausa: nombre, logo,
   portada, color y el WhatsApp. **No la lista de productos ni los precios.**
6. **Given** un producto de la empresa A, **When** lo pido por su id contra el
   slug de la empresa B, **Then** 404. Es el caso que un `findByPk` haría pasar.
7. **Given** cualquier respuesta pública, **When** la miro entera, **Then** **no
   hay** `cost`, `margin_override`, `wholesale_margin`, `wholesale_price`,
   `supplier_id`, `empresa_id`, `punto_de_venta_id`, `barcode`, `is_active` ni
   `publicable`, ni ningún campo que no esté en la lista explícita.
8. **Given** el código del router público, **When** corre la guardia estática,
   **Then** falla si alguna respuesta se arma con un objeto de modelo, con un
   spread o con `attributes: { exclude: … }`. **Solo lista blanca**: una lista
   negra deja pasar la columna que se agregue mañana.
9. **Given** el router público, **When** corre `montajeDeRouters.test.js`,
   **Then** está montado con `app.use`, **arriba** de `app.use('/api', …)` de
   `server.js:464` y **debajo** del limitador de `:319` y del `express.json` de
   `:184`. Que esté **debajo** del limitador de `:319` no significa que consuma
   su cupo: el limitador lo **exime** por `skip` (FR-113a), y la guardia de
   posición verifica también esa exención y su atadura con el limitador propio.
10. **Given** `permisosDeRutas.test.js`, **When** corre, **Then** el router nuevo
    está declarado en `ROUTERS_SIN_SESION` (`:73-87`) **con su motivo escrito**, y
    en la lista literal de archivos de `routes/` (`:549-565`).
11. **Given** un endpoint público, **When** algo falla, **Then** el mensaje que
    llega es genérico y en castellano, sin nombres de tabla ni de restricción, y
    el detalle queda en el log con su `requestId`.

---

### User Story 7 — Una respuesta pública no lleva costo, margen, proveedor ni precio mayorista (Priority: P1)

Como dueño, quiero estar seguro de que mi costo y mi margen no salen a internet
por accidente, para poder publicar el catálogo sin revisarlo campo por campo cada
vez que alguien toca el código.

**Why this priority**: es la mitad de US6 que **no se puede probar una vez y
olvidar**. Un campo nuevo en `Product` —el próximo hito agrega uno— entra solo a
cualquier respuesta armada con un spread, y nadie se entera. Va como historia
propia porque lo que la sostiene es una **guardia estática nueva**, que es un
entregable, no un efecto secundario.

**Independent Test**: agregar a mano un campo `secreto` al modelo `Product`,
correr la guardia, y verificar que la respuesta pública no lo lleva. Después
revertir.

**Acceptance Scenarios**:

1. **Given** la guardia nueva, **When** alguien escribe `res.json(producto)` con
   una instancia de modelo en el router público, **Then** falla.
2. **Given** la guardia, **When** alguien escribe `{ ...producto.toJSON() }`,
   **Then** falla.
3. **Given** la guardia, **When** alguien usa `attributes: { exclude: [...] }`
   en una consulta del router público, **Then** falla: la exclusión es una lista
   negra y las listas negras envejecen mal.
4. **Given** la guardia, **When** el serializador público menciona `cost`,
   `margin_override`, `wholesale_margin`, `wholesale_price` o `supplier_id`,
   **Then** falla.
5. **Given** una respuesta pública real, **When** el test de integración recorre
   el JSON entero —incluidos los objetos anidados y los arreglos—, **Then** no
   encuentra ninguna de esas claves ni ningún `empresa_id`.
6. **Given** que la guardia se agrega, **When** se corre por primera vez sobre el
   código que existe hoy, **Then** **da al menos un hallazgo** antes de escribir
   el router nuevo. Una guardia que nace en verde es una guardia que no se sabe
   si mira. Es el mismo protocolo de `guardiasDeDiseno.test.js:419-426`.

---

### User Story 8 — Buscar, filtrar por categoría y abrir la ficha del producto (Priority: P1)

Como visitante, quiero buscar por nombre o marca, filtrar por categoría y abrir
un producto para leer de qué se trata, para encontrar lo que vine a buscar sin
recorrer sesenta tarjetas.

**Why this priority**: es la decisión 12 del plan, «v1 = buscador + categorías +
ficha de producto». Sin buscador, un catálogo de sesenta productos en 390px es
una lista que nadie recorre.

**Independent Test**: con los ocho productos de la maqueta cargados, buscar
«ena», filtrar «Proteínas», abrir la ficha del whey y volver.

**Acceptance Scenarios**:

1. **Given** el catálogo, **When** escribo en el buscador, **Then** filtra por
   **nombre y marca**, sin distinguir mayúsculas ni acentos: «proteina» encuentra
   «Whey Protein» y «Proteínas».
2. **Given** el buscador, **When** escribo, **Then** el filtrado no dispara una
   llamada por tecla.
3. **Given** una búsqueda sin resultados, **When** termina, **Then** veo el estado
   de la maqueta (`:515-539`): el término entre comillas, una sugerencia de la
   categoría más parecida, y **dos** salidas —«Limpiar» y «Ver Creatinas»—. El
   vacío no termina en un cartel.
4. **Given** las píldoras de categoría, **When** miro, **Then** son **las
   categorías que existen en este catálogo**, con «Todos» primera, y la elegida se
   pinta con el color de marca (`:1375-1385`).
5. **Given** una categoría elegida y una búsqueda escrita, **When** las combino,
   **Then** se aplican las dos, como en `:1249-1251`.
6. **Given** un producto sin marca —el 96 % de los migrables—, **When** se dibuja
   la tarjeta, **Then** el renglón de la marca **no queda vacío ni dice
   `undefined`**: no se dibuja, y el nombre sube.
7. **Given** un producto sin descripción, **When** abro la ficha, **Then** el
   bloque de descripción no se dibuja, y la ficha no queda con un hueco.
8. **Given** un producto sin foto, **When** se dibuja, **Then** hay un marcador
   neutro del mismo tamaño que una foto, para que la grilla no se descuadre.
9. **Given** la ficha, **When** la miro, **Then** veo marca, nombre, precio,
   precio de lista tachado —si el catálogo lo tiene encendido—, el ahorro en
   porcentaje, la descripción y el control de cantidad (`:171-192`).
10. **Given** el precio final igual al de lista —porque ninguna regla lo bajó—,
    **When** se dibuja, **Then** **no se muestra el tachado ni el ahorro**. Tachar
    el mismo número dos veces es ruido, y un «-0 %» es peor.
11. **Given** el catálogo abierto en una computadora, **When** miro, **Then**
    sube a tres columnas dentro de los mismos 720px y el carrito deja de ser barra
    fija (`:449-464`). **No se abre a una grilla ancha.**
12. **Given** 390px de ancho, **When** recorro catálogo, ficha y carrito,
    **Then** el `<body>` **no desborda a lo ancho** en ninguna de las tres. Es una
    prueba de navegador: jsdom devuelve cero en todas las medidas.

---

### User Story 9 — Lo que se ve cuando no hay nada que ver (Priority: P2)

Como visitante, quiero que la página me diga qué está pasando cuando algo no
está, para no quedarme mirando una pantalla en blanco preguntándome si escaneé
mal.

**Why this priority**: la maqueta les dedica seis pantallas completas
(`:470-627`) bajo el título «los estados que casi nadie diseña». Es P2 porque el
camino feliz tiene que existir primero, pero **son seis pantallas dibujadas y no
un `if` suelto**.

**Independent Test**: forzar los seis estados uno por uno y compararlos con las
seis tarjetas de 330px de la maqueta.

**Acceptance Scenarios**:

1. **Given** que el catálogo está cargando, **When** miro, **Then** veo la
   **silueta del catálogo real** —portada, logo, título, buscador, píldoras y dos
   tarjetas— y no un spinner (`:477-498`).
2. **Given** el catálogo pausado, **When** entro, **Then** veo la portada apagada
   en escala de grises, «El catálogo está en pausa», quién lo despausa y el botón
   de WhatsApp (`:500-513`). El pie sigue diciendo «powered by favalio».
3. **Given** una búsqueda sin resultados, **When** termina, **Then** el estado de
   US8 escenario 3.
4. **Given** el carrito vacío, **When** entro, **Then** veo «Tu pedido está
   vacío», el texto de la maqueta y **una sola salida**: «Ver el catálogo». **Y no
   hay barra inferior**: no hay total que mostrar (`:541-558`).
5. **Given** un pago rechazado, **When** vuelvo, **Then** lo primero que se lee es
   **que no se cobró nada y que el pedido no se perdió**, con su número; recién
   después las alternativas (`:560-584`). En estas etapas no hay pasarela, así que
   la pantalla existe **sin el camino de Mercado Pago**: ver «Fuera de alcance».
6. **Given** que un producto del carrito se agotó mientras compraba, **When**
   sigo, **Then** la línea **queda tachada arriba del total nuevo**, con «Sin
   stock · quitado del pedido», y el botón dice «Seguir con el resto»
   (`:586-624`). **La línea no desaparece**: el cambio de importe tiene que tener
   una causa visible.
7. **Given** que **todas** las líneas se agotaron, **When** sigo, **Then** no se
   crea ningún pedido y vuelvo al carrito vacío con el aviso.
8. **Given** cualquiera de los seis estados, **When** lo miro, **Then** usa el
   color de marca del catálogo y **solo en lo que se toca**.

---

### User Story 10 — La suscripción vencida apaga el catálogo, y el catálogo no tumba las cajas (Priority: P1)

Como operador de la plataforma, quiero que una empresa con la cuota vencida deje
de vender por su catálogo, y que la gente escaneando el QR no deje sin sistema al
comercio, para que el paywall y el límite de peticiones sigan significando algo
con endpoints públicos en el medio.

**Why this priority**: son los dos riesgos del plan que **el diseño del sistema
hace fáciles de olvidar**, porque los dos middlewares que los resuelven quedan
fuera del camino del router público por construcción.

**Independent Test**: poner la suscripción de la empresa en `expired` con la
gracia vencida y pedir el catálogo público. Y medir cuántas llamadas dispara una
visita antes de publicar el QR.

**Acceptance Scenarios**:

1. **Given** una empresa con la suscripción vencida, **When** alguien abre su
   catálogo, **Then** **no ve productos ni precios**, y ve un estado propio que no
   culpa al visitante ni expone que es un problema de pago del comercio.
2. **Given** la misma empresa, **When** alguien intenta crear un pedido, **Then**
   se rechaza y **no queda ninguna fila**.
3. **Given** que `checkSubscription` no corre en el router público —porque no
   está en la cadena `authEmpresa`—, **When** se implementa, **Then** el estado se
   verifica **dentro del handler**, con la misma función y los mismos estados que
   `checkSubscription.js:85-115`, y no con una segunda lista de estados escrita
   al lado.
4. **Given** el prefijo del router público, **When** se elige, **Then** **no
   empieza con `/api/empresas`, `/api/auth` ni `/api/ping`**: heredaría la
   exención de `checkSubscription.js:30-36` sin que nadie lo note.
5. **Given** una empresa en período de gracia, **When** alguien abre su catálogo,
   **Then** sigue funcionando. La gracia es gracia también acá.
6. **Given** un error de base al consultar la suscripción, **When** ocurre,
   **Then** **el catálogo público cierra**: responde **503** con el estado «no
   disponible por un momento, reintentá», **no** muestra productos y **no** deja
   armar ni mandar un pedido. El error queda **registrado con el slug y la
   empresa**, para que no sea un apagón silencioso.

   El motivo, escrito: `checkSubscription.js:127-130` hoy **deja pasar** ante un
   error de base, y para la cadena privada eso está bien —un hipo de base no
   puede tumbar la caja de un comercio que ya pagó—. **En una superficie pública
   el mismo criterio significa vender en nombre de una empresa que quizá está
   vencida**, y cobrar por ella. Ante la duda, en público **se cierra, no se
   abre**: un catálogo caído unos minutos se explica; un pedido tomado por una
   empresa dada de baja, no. **La cadena privada no cambia**: sigue dejando pasar,
   y la asimetría es deliberada.

   Se responde **503 y no 402** a propósito: 402 afirmaría que la suscripción
   está vencida, y lo que pasó es que **no se pudo saber**.
7. **Given** el prefijo público, **When** se monta, **Then** tiene su **propio
   limitador**, que cuenta por **IP y slug** a la vez, distinto del global de
   `:319`.
7a. **Given** el limitador global de `:319`, **When** se implementa el catálogo,
   **Then** lleva un **`skip` que exime el prefijo público**, con su motivo
   escrito al lado. Sin ese `skip` el escenario 9 **no se cumple** aunque el
   limitador propio esté puesto: el montaje público queda debajo del global
   (FR-090), así que cada visita seguiría consumiendo el cupo de 600 por IP que
   comparten las cajas del comercio. Un segundo limitador no le devuelve el cupo
   a nadie.
7b. **Given** el `skip` puesto, **When** alguien borra esa línea, **Then** **una
   guardia estática falla**, porque el síntoma real no se ve: el catálogo sigue
   andando y las cajas empiezan a recibir 429 los sábados a la tarde. Y **Given**
   el `skip` puesto y el limitador propio borrado, **When** corre la misma
   guardia, **Then** también falla: un prefijo eximido del límite global y sin
   límite propio es la superficie pública sin ningún límite.
8. **Given** una visita completa al catálogo, **When** se mide, **Then** se sabe
   **cuántas llamadas dispara**, y el límite se elige a partir de ese número. El
   número medido va escrito en el plan y en `OPERACION.md`.
9. **Given** cincuenta personas escaneando el QR desde la red del gimnasio,
   **When** el limitador actúa, **Then** **el punto de venta del comercio no
   recibe un 429**, porque el prefijo público **no consume el cupo global** y
   tiene el suyo. Que las dos cosas compartan cupo por IP es el riesgo, y la
   verificación es que no lo compartan.
10. **Given** un 429 en el catálogo, **When** ocurre, **Then** la tienda muestra
    un estado que invita a reintentar, y no una pantalla en blanco.

---
### User Story 11 — El QR, el enlace y el cartel que se pega en la recepción (Priority: P2)

Como dueño, quiero descargar el QR de mi catálogo y un cartel listo para
imprimir, para pegarlo en el gimnasio sin tener que armarlo yo.

**Why this priority**: es lo que convierte el catálogo en un negocio, pero el
catálogo tiene que existir primero. Y el plan es explícito: **la publicación del
QR está bloqueada** hasta que los datos estén cargados y revisados, así que esta
historia se construye antes de que se use.

**Independent Test**: descargar el PNG, escanearlo con un teléfono y verificar
que abre el catálogo correcto.

**Acceptance Scenarios**:

1. **Given** un catálogo, **When** entro a la pestaña «QR y enlace», **Then** veo
   la dirección completa, un botón de copiar, la vista previa del QR y tres
   descargas: PNG, SVG y cartel A4 (`:1015-1049`).
2. **Given** el enlace, **When** lo copio, **Then** es
   `https://tienda.favalio.com/c/<slug>` completo, con protocolo, listo para
   pegar en WhatsApp.
3. **Given** el QR, **When** se genera, **Then** se genera **en el navegador** con
   `qrcode`, que ya está instalado (`printInvoice.js:1,48-75`). Cero endpoint
   nuevo.
4. **Given** el cartel A4, **When** lo pido, **Then** se arma como una hoja A4
   maquetada en HTML y sale por `window.print()`, con el logo del catálogo, el
   nombre y la leyenda «escaneá con la cámara» (`:1042`). Imprimir el QR solo, sin
   contexto, baja el escaneo.
5. **Given** un catálogo **en borrador**, **When** entro a la pestaña, **Then**
   el QR está y **dice que todavía no lleva a ningún lado**. Un QR impreso de un
   catálogo sin publicar es un cartel que manda a un 404.
6. **Given** que cambio el slug de un catálogo publicado, **When** guardo,
   **Then** la pantalla avisa, **antes de guardar**, que los QR y carteles ya
   impresos **dejan de funcionar**, y pide confirmación explícita.
7. **Given** el slug cambiado, **When** alguien abre el enlace viejo, **Then**
   recibe el **404 público** del catálogo inexistente: **el slug viejo muere**,
   no redirige y no queda reservado (decisión 11). El slug liberado vuelve al
   espacio de nombres global y otra empresa puede tomarlo.
8. **Given** el QR descargado, **When** lo escaneo, **Then** la URL lleva el
   parámetro que permite contar el origen (H7), y **el catálogo se ve igual con
   el parámetro y sin él**.

---

### User Story 12 — El catálogo no se indexa, y se comparte bien (Priority: P2)

Como dueño, quiero que mi precio preferencial no termine en Google pero que el
enlace se vea bien cuando alguien lo pega en WhatsApp, para controlar quién ve
qué.

**Why this priority**: es la decisión 11 del plan —«URL con slug legible +
`noindex`»— y la primera mitad es la que protege el negocio: el precio de socio
indexado deja de ser de socio.

**Independent Test**: pedir la página y verificar la etiqueta `noindex`; pedir
`/robots.txt`; pegar el enlace en un cliente de mensajería y ver la tarjeta.

**Acceptance Scenarios**:

1. **Given** cualquier catálogo publicado, **When** un buscador pide la página,
   **Then** hay `noindex, nofollow` **y** un `X-Robots-Tag` en la respuesta. La
   etiqueta sola no alcanza para lo que no es HTML.
2. **Given** `tienda.favalio.com/robots.txt`, **When** se pide, **Then** existe y
   no permite recorrer `/c/`.
3. **Given** un enlace pegado en WhatsApp, **When** se previsualiza, **Then** el
   `og:title` es el nombre visible del catálogo, el `og:description` su
   descripción y el `og:image` su portada, **por catálogo** y no de Favalio.
4. **Given** que los metadatos son por catálogo, **When** se sirven, **Then**
   los sirve **un handler de la API**: `/c/:slug` devuelve el HTML con
   `og:title`, `og:description` y `og:image` **de ese catálogo ya puestos**, y el
   resto del documento —el bundle de `apps/tienda`— sale sin cambios (decisión
   12). El Caddyfile enruta `/c/:slug` al handler y el resto de las rutas al
   estático. Los metadatos **no** se ponen desde React: el lector de
   previsualizaciones no ejecuta JavaScript.
4a. **Given** que `apps/api` y `apps/tienda` son **dos imágenes de Docker
   distintas**, **When** el handler necesita el HTML, **Then** **se lo pide al
   servicio `tienda` por la red interna del compose** —con `timeout` y con caché
   en memoria de 60 segundos—, y **no** lo lee del disco: el `index.html` no está
   en la imagen de la API, y su `<script src="/assets/index-<hash>.js">` cambia
   de hash en cada build (FR-117c).
4b. **Given** el marcador `<!--FAVALIO_META-->` del `<head>` de
   `apps/tienda/index.html`, **When** el handler arma la respuesta, **Then**
   reemplaza **esa línea** por las etiquetas. **And Given** que el marcador no
   está, **Then** sirve el HTML **sin** metadatos y lo registra, en vez de servir
   un documento roto.
4c. **Given** el servicio `tienda` caído, **When** alguien abre `/c/:slug`,
   **Then** la respuesta es **503** con una página propia mínima y un error
   registrado, y **no** un HTML inventado sin el `<script>` del bundle, que sería
   una página en blanco sin explicación.
5. **Given** un catálogo en borrador o de una empresa vencida, **When** se pide,
   **Then** tampoco se indexa ni se previsualiza con datos reales.
6. **Given** la tienda, **When** miro el pie en cualquier pantalla, **Then** dice
   el nombre del comercio, su CUIT, un teléfono de contacto y **«powered by
   favalio»** (`:443-447`).

---

## Etapa 2 · Pedido

### User Story 13 — Armar el pedido y mandarlo, con el precio que pone el servidor (Priority: P1)

Como visitante, quiero agregar productos, revisar mi pedido, dejar mis datos,
elegir cómo lo recibo y mandarlo, para comprar sin registrarme.

**Why this priority**: es la etapa 2 entera y es lo que convierte una página en
un negocio. Y trae el riesgo más caro del plan: **el pedido manda producto y
cantidad, nunca precio.**

**Independent Test**: armar un pedido de dos líneas, mandarlo, y verificar contra
la base que el total lo calculó el servidor y que los precios unitarios quedaron
congelados en `pedido_items`.

**Acceptance Scenarios**:

1. **Given** el catálogo, **When** agrego un producto, **Then** la barra inferior
   muestra la cantidad de productos y el total, y el botón de la tarjeta pasa a
   decir «Agregado · N» (`:1269`).
2. **Given** el carrito, **When** cambio cantidades o elimino una línea, **Then**
   el subtotal se recalcula y llegar a cero **elimina la línea**.
3. **Given** el checkout, **When** avanzo, **Then** son **tres pasos** —datos,
   entrega, pago— con la barra de progreso y «Paso N de 3» (`:257-389`), y el
   botón de atrás vuelve al paso anterior sin perder lo escrito.
4. **Given** el paso de entrega, **When** lo miro, **Then** veo **solo** las
   opciones que el catálogo tiene encendidas, con su detalle y su costo
   (`:1316-1321`). Un catálogo sin envío no muestra envío.
5. **Given** que elijo envío a domicilio, **When** se despliega, **Then** aparecen
   dirección, localidad y CP, y el texto dice cuánto falta para el envío gratis
   (`:1395-1397`).
6. **Given** un subtotal **exactamente igual** al umbral de envío gratis,
   **When** se calcula, **Then** el envío es gratis. El borde se prueba en el
   borde.
7. **Given** el paso de pago, **When** elijo transferencia, **Then** veo titular,
   CBU y alias del catálogo, con botones de copiar (`:355-377`).
8. **Given** que mando el pedido, **When** el servidor lo recibe, **Then** el
   cuerpo lleva **`product_id` y `cantidad`, y nada más**: cualquier precio,
   subtotal o total que venga en el cuerpo **se ignora**.
9. **Given** el pedido creado, **When** miro `pedido_items`, **Then** cada línea
   tiene el nombre y el precio unitario **congelados**. Si mañana cambia la regla,
   el pedido de ayer no cambia.
10. **Given** un `product_id` de **otra empresa**, o de un producto que no está
    en este catálogo, o no publicable, **When** llega el pedido, **Then** se
    rechaza y **no queda ninguna fila**: ni el pedido, ni sus líneas. Todos los
    productos se validan **antes** de crear nada.
11. **Given** una cantidad cero, negativa o no entera, **When** llega, **Then**
    se rechaza.
12. **Given** un pedido sin ninguna línea, **When** llega, **Then** se rechaza.
13. **Given** el mismo producto dos veces en el cuerpo, **When** llega, **Then**
    se consolida en una línea con la suma de las cantidades, y no en dos.
14. **Given** el mismo pedido enviado **dos veces en paralelo** —el botón apretado
    dos veces, la conexión que reintenta—, **When** llegan, **Then** se crea **uno
    solo**, y lo garantiza el `UNIQUE` de `idempotency_key` en la base, no el
    orden de ejecución. Es la mitad que un test secuencial no toca.
15. **Given** dos pedidos simultáneos de la misma empresa, **When** se numeran,
    **Then** **no reciben el mismo número**: el correlativo se toma **dentro de
    la transacción que crea el pedido**, bajo un candado por empresa, y
    `UNIQUE (empresa_id, numero)` es la red. Nunca un `SELECT MAX(numero) + 1`
    leído fuera de esa transacción (decisión 10).
16. **Given** el primer pedido de una empresa, **When** se numera, **Then** es el
    **1**, y en pantalla se ve **`#1`**. No hay letra, no hay prefijo guardado y
    no se reinicia nunca — ni por año, ni por catálogo.
17. **Given** el pedido creado, **When** vuelve la respuesta, **Then** trae el
    número, el resumen y el enlace de WhatsApp, y **nada del interior**: ni ids de
    producto, ni `empresa_id`, ni `punto_de_venta_id`.
18. **Given** la pantalla de confirmación, **When** la miro, **Then** veo el
    número grande **con el formato `#1042`** (`:398`), el resumen línea por línea,
    el envío si lo hay, el total y el bloque «Qué pasa ahora» **con el texto que
    corresponde a la entrega elegida** (`:1398-1403`), no uno genérico.

---

### User Story 14 — Sin stock: lo agotado no se vende, y lo que se agota mientras compra se avisa (Priority: P1)

Como dueño, quiero que un producto sin stock no se pueda pedir, y que si se agota
mientras alguien compraba se lo diga con claridad, para no tener que llamar a un
socio a explicarle que su pedido no existe.

**Why this priority**: es el riesgo «Sobreventa» del plan. **No hay reserva de
stock en esta etapa** —es etapa 4— así que la pregunta no es si puede pasar sino
qué se ve cuando pasa.

**Independent Test**: poner un producto en `available = 0`, verificar que el
catálogo lo muestra agotado con el botón inerte, y crear un pedido que lo incluya
para ver la línea quitada.

**Acceptance Scenarios**:

1. **Given** un producto con stock cero, **When** lo miro en el catálogo,
   **Then** la foto está atenuada, hay una etiqueta «Agotado» arriba a la
   izquierda y el botón dice «Sin stock», gris y **sin efecto al apretarlo**
   (`:129-131`, `:1262-1270`). No está oculto: el socio tiene que poder ver que
   ese producto existe.
2. **Given** el stock que se lee, **When** se decide si está agotado, **Then**
   se lee **`available`**, no `quantity`, y **solo del punto de venta del
   catálogo**. Es la misma decisión que la spec 013 tomó para TiendaNube: puede
   subvender; lo que no puede es vender algo ya comprometido.
3. **Given** la ficha de un producto agotado, **When** la abro, **Then** también
   dice «Sin stock» y el botón principal no agrega nada.
4. **Given** un producto que estaba disponible cuando se agregó al carrito y se
   agotó antes de mandar el pedido, **When** mando, **Then** el servidor
   **revalida**, quita esa línea, recalcula el total y devuelve la pantalla de
   «Se agotó mientras compraba» con la línea tachada arriba del total nuevo
   (`:586-624`).
5. **Given** esa pantalla, **When** aprieto «Seguir con el resto», **Then** el
   pedido se crea **con las líneas que quedan** y con el total nuevo.
6. **Given** que **todas** las líneas se agotaron, **When** mando, **Then** **no
   se crea ningún pedido** y vuelvo al carrito con el aviso.
7. **Given** una cantidad mayor que el stock disponible —pedí 5 y hay 2—,
   **When** mando, **Then** **la línea se recorta a 2 y se avisa**: no se quita
   entera, porque el socio quiere las 2 que hay. El aviso usa **el mismo
   tratamiento visual de la línea tachada** del estado «se agotó» (`:598-605`),
   con la cantidad pedida tachada al lado de la nueva, y el total se recalcula
   antes de confirmar.
8. **Given** dos personas pidiendo **la última unidad al mismo tiempo**, **When**
   las dos mandan, **Then** **las dos pasan la revalidación y los dos pedidos se
   crean**. Sin reserva, esto es lo que pasa, y la spec lo dice en vez de
   simularlo: no hay lock, no hay «comprometido», y el stock no se toca. **El
   comercio resuelve el conflicto por WhatsApp**, y la bandeja tiene que dejarlo
   ver — ver FR-138.
9. **Given** que el stock no se descuenta en ninguna de estas etapas, **When**
   un producto se queda sin unidades por pedidos que no se cobraron, **Then** el
   catálogo lo sigue mostrando disponible. Es consecuencia directa de no reservar
   y **está advertido en la bandeja** (US17).

---

### User Story 15 — Los datos del comprador se piden con consentimiento, y se guardan una sola vez (Priority: P1)

Como visitante, quiero saber qué datos míos se guardan y para qué, y poder
comprar sin aceptar recibir publicidad, para no tener que elegir entre el pedido
y mi casilla de correo.

**Why this priority**: es el riesgo «Datos personales» del plan. Guardar nombre,
teléfono, email, DNI y N° de socio para marketing **exige consentimiento
explícito y Términos y Política de Privacidad publicados, que hoy no existen**
(`docs/ANALISIS.md:345`, `docs/AUDITORIA-SUSCRIPCIONES.md:147`).

**La puerta de la decisión 2, escrita como condición y no como nota**: los dos
documentos **son de Favalio** —la plataforma los redacta y los publica, y cada
tienda los enlaza en su pie—. **Mientras no estén publicados, el checkout no pide
DNI y no ofrece la casilla de marketing**: el pedido funciona con **nombre,
teléfono y email**. `pide_dni` y el consentimiento quedan **modelados en la base
pero apagados y sin exponerse**.

**Independent Test**: con la puerta cerrada, completar un pedido y verificar que
la respuesta pública del catálogo no trae `pide_dni` en `true`, que el formulario
no dibuja ni el DNI ni la casilla, y que la fila del pedido queda con el
consentimiento en `false`.

**Acceptance Scenarios**:

1. **Given** que los documentos **no** están publicados, **When** abro el paso de
   datos, **Then** **no se dibuja el campo del DNI ni la casilla de marketing**,
   aunque el catálogo tenga `pide_dni` en `true` en la base: la puerta gana sobre
   la configuración del comercio.
2. **Given** la puerta cerrada, **When** mando un pedido con `dni` y con el
   consentimiento en `true` **en el cuerpo de la petición**, **Then** el servidor
   **los ignora**: no guarda el DNI, deja `acepta_comunicaciones` en `false` y el
   pedido se crea igual. La puerta se verifica **en el servidor**, no solo en el
   dibujo.
3. **Given** los dos documentos publicados y enlazados, **When** se abre la
   puerta, **Then** `pide_dni` pasa a poder encenderse por catálogo y la casilla
   de marketing aparece **desmarcada** (`:1229`, `estiloCasilla` en `:1433-1437`).
   Una casilla preseleccionada no es consentimiento.
4. **Given** la puerta abierta y la casilla sin marcar, **When** mando el pedido,
   **Then** el pedido se crea igual y `acepta_comunicaciones` queda en `false`.
   **El consentimiento no es condición para comprar.**
5. **Given** la puerta abierta y la casilla marcada, **When** se guarda, **Then**
   queda registrado **qué se aceptó y cuándo**, y no solo un booleano suelto.
6. **Given** cualquier pantalla de la tienda, **When** miro el pie, **Then**
   **enlaza los Términos y la Política de Privacidad de Favalio** —los mismos
   para todas las tiendas— en cuanto existan. Antes de que existan, el pie no
   enlaza documentos que no están.
7. **Given** los campos, **When** los completo, **Then** el catálogo pide **solo
   los que tiene configurados y la puerta permite**: `pide_dni` y `pide_nro_socio`
   son interruptores por catálogo, un catálogo que no los pide no los dibuja, y
   `pide_dni` está apagado en toda la plataforma hasta que la puerta se abra.
8. **Given** los campos **de mis datos**, **When** los dejo vacíos, **Then**
   **solo bloquean el envío el nombre y el teléfono** (decisión 5). El email, el
   DNI y el N° de socio son **opcionales aunque el catálogo los pida**; la
   dirección, la localidad y el CP son obligatorios **solo si elegí envío a
   domicilio**.
8a. **Given** el pedido completo, **When** el servidor lo valida, **Then** exige
   además **forma de entrega y medio de pago**, que son de los pasos 2 y 3 del
   checkout y **siempre están elegidos** —el paso no se puede saltear—. No son
   «campos que el comprador puede dejar vacíos»: son columnas `NOT NULL` del
   pedido y se revalidan contra lo que el catálogo tiene encendido (FR-141,
   FR-149b). El pedido mínimo válido es **nombre + teléfono + entrega + medio de
   pago**, más al menos una línea con stock.
9. **Given** que no dejé email, **When** el pedido se confirma, **Then** la
   pantalla de confirmación **no promete ningún email**: dice lo que va a pasar
   por WhatsApp y nada más.
10. **Given** un teléfono argentino escrito de cualquier forma —con 15, con 011,
    con espacios—, **When** **el servidor** lo guarda, **Then** se normaliza con
    `normalizarTelefono` de **`packages/pedido`** (FR-006c): la misma lógica que
    hoy vive en `apps/web/src/utils/pedidoWhatsapp.js:32-76` y ya está probada,
    **mudada al paquete** porque `apps/api` no puede importar de `apps/web/src`.
11. **Given** un email mal escrito, **When** lo mando, **Then** se rechaza en el
    momento, no después. Que sea opcional no lo exime de estar bien escrito si lo
    escribí.
12. **Given** el N° de socio y el DNI, **When** se guardan, **Then** se guardan
    **declarativos, sin validar contra ningún padrón** (decisión 5 del plan), y
    debajo del campo del N° de socio la pantalla dice exactamente **«Nos ayuda a
    identificarte cuando retirás el pedido.»** — nunca «con eso aplicamos el
    precio de socio», que es falso (decisión 3).
13. **Given** un comprador que ya pidió antes con el mismo teléfono, **When**
    manda otro pedido, **Then** se actualiza su `Customer` en vez de crear uno
    nuevo, **acotado a la empresa del catálogo**.
14. **Given** que el `Customer` se crea desde un endpoint público, **When** se
    crea, **Then** lleva el `empresa_id` que resolvió el slug, y **nunca** uno que
    haya venido en el cuerpo.
15. **Given** los datos guardados, **When** se miran desde el panel, **Then**
    solo los ve quien tenga `pedidos.ver`.

---

### User Story 16 — El pedido cae en la bandeja y se opera desde ahí (Priority: P1)

Como dueño, quiero ver todos los pedidos que entraron por mis catálogos, abrir
uno, ver el detalle y moverlo de estado, para poder trabajar sin salir del
sistema.

**Why this priority**: es la mitad del pedido que le sirve al comercio. Sin
bandeja, el pedido existe en la base y no lo ve nadie.

**Independent Test**: crear tres pedidos desde la tienda, entrar a la bandeja,
abrir uno y moverlo a «En preparación».

**Acceptance Scenarios**:

1. **Given** pedidos de dos catálogos, **When** entro a la bandeja, **Then** veo
   una tabla con número, fecha, comprador con su N° de socio, catálogo,
   **canal**, total, medio de pago y estado (`:1094-1108`).
1a. **Given** la columna **«Canal»**, **When** la miro hoy, **Then** todas las
   filas dicen **«Catálogo»**, porque `pedidos.origen` tiene **un solo valor por
   ahora**. Una columna con un solo valor parece decoración y no lo es: es una
   decisión del dueño del producto, tomada **después** de aprobar esta spec, para
   que **todo lo que entre por la web se trabaje en una sola bandeja** a futuro.
   Agregar `origen` después significa una migración con backfill sobre pedidos
   reales y una columna que la bandeja no sabía dibujar; agregarla ahora no
   cuesta nada. Ver FR-160a y la decisión 13.
2. **Given** los filtros, **When** elijo uno, **Then** filtra por estado —los
   siete botones de `:1593`—, por catálogo **y por canal**, y el contador de
   abajo dice cuántos quedaron.
2a. **Given** los pedidos de **TiendaNube**, **When** miro esta bandeja, **Then**
   **no aparecen**, y eso es deliberado: `tiendanube_pedidos` **no es una
   bandeja**, es el **libro de idempotencia del webhook de stock**. No tiene
   comprador, ni total, ni estado operable, ni entrega, ni medio de pago; sus
   filas se escriben **una sola vez, dentro de la transacción que descuenta**, y
   **no se borran nunca** —borrar una deja que un webhook reintentado descuente
   dos veces, y TiendaNube reintenta—. Unificarlas hoy daría una tabla donde media
   docena de filas tienen todo y las demás tienen guiones en seis columnas, y una
   fila con guiones no es un pedido que alguien pueda operar: no se le cambia el
   estado, no se lo marca cobrado, no se sabe a quién llamar. **Dos pantallas
   honestas antes que una que promete una bandeja y entrega una lista.**
3. **Given** un pedido cancelado, **When** lo miro en la lista, **Then** la fila
   está atenuada (`:1517`).
4. **Given** que abro un pedido, **When** se abre, **Then** es un **panel lateral
   de 520px** —no un modal— con comprador, teléfono, N° de socio, medio de pago,
   entrega, el detalle línea por línea y el total (`:1117-1172`).
5. **Given** el panel abierto, **When** miro el detalle, **Then** los precios
   unitarios son **los congelados del pedido**, no los actuales del catálogo.
6. **Given** un pedido, **When** cambio su estado, **Then** solo se permiten las
   transiciones que tienen sentido, y la regla es una **función pura**: un pedido
   entregado no vuelve a «pendiente de pago».
7. **Given** un pedido cancelado, **When** intento moverlo, **Then** no se puede.
   Cancelar es terminal.
8. **Given** un pedido de **otra empresa**, **When** pido su detalle o intento
   cambiarle el estado, **Then** 404 y **nada cambia**.
9. **Given** un usuario con `pedidos.ver` pero sin `pedidos.gestionar`, **When**
   entra, **Then** ve todo y los botones de acción están **deshabilitados con su
   explicación**.
10. **Given** que la bandeja no tiene pedidos, **When** entro, **Then** veo un
    estado vacío que **distingue** «todavía no entró ninguno» de «el filtro no
    devolvió nada». Son dos textos distintos.
11. **Given** un pedido con un producto que después se borró del sistema,
    **When** lo abro, **Then** la línea se sigue viendo con su nombre congelado y
    no rompe la pantalla.

---

### User Story 17 — «Marcar cobrado» dice exactamente lo que hace, que en esta etapa es menos (Priority: P1)

Como dueño, quiero que la pantalla no me prometa que algo se descontó del stock
cuando no se descontó, para no descubrirlo en un recuento físico tres meses
después.

**Why this priority**: es el hallazgo H9 y es el mismo defecto que la spec 013
encontró en TiendaNube. **La maqueta afirma dos veces algo que estas etapas no
hacen** (`:1080`, `:1178`), y copiar ese texto sería construir la mentira a
propósito.

**Independent Test**: marcar un pedido como cobrado y verificar contra la base
que **no** se escribió en `stock`, que **no** hay `StockMovement` nuevo y que
**no** se creó ninguna `Sale`. Es un test que afirma lo que **no** pasó.

**Acceptance Scenarios**:

1. **Given** un pedido pendiente, **When** aprieto «Marcar cobrado» y confirmo,
   **Then** el estado pasa a **pagado** y **eso es todo lo que pasa**.
2. **Given** la confirmación, **When** la leo, **Then** dice **qué hace y qué no
   hace**, con el texto exacto aprobado (decisión 4): **«Marcar cobrado el pedido
   #1042 solo cambia su estado. El stock no baja y no se registra ninguna venta:
   si ya lo entregaste, cargalo en el punto de venta.»**
3. **Given** la bandeja, **When** entro, **Then** hay un aviso visible con el
   texto aprobado (decisión 4): **«Marcar un pedido como cobrado cambia su
   estado. Por ahora no descuenta stock ni registra la venta: eso se hace a mano
   desde el punto de venta.»** **El aviso es permanente hasta la etapa 3**: no
   tiene botón de cerrar, no guarda ninguna preferencia y vuelve a estar ahí en
   cada visita. No es un `tooltip` ni una nota al pie.
4. **Given** «Marcar cobrado», **When** se ejecuta, **Then** **no toca `stock`,
   ni `stock_movements`, ni `sales`, ni `sale_items`, ni la caja**. La regla del
   plan es «si toca stock, tiene que generar venta; si no genera venta, no toca
   stock», y acá no genera venta.
5. **Given** un pedido ya cobrado, **When** aprieto de nuevo, **Then** no pasa
   nada dos veces.
6. **Given** el mismo pedido cobrado **dos veces en paralelo**, **When** llegan,
   **Then** el resultado es el mismo que una sola vez.
7. **Given** el checkout de transferencia, **When** lo leo, **Then** **no dice
   que el pedido queda reservado 24 horas** (`:375`, `:1325`), porque no hay
   reserva de ningún tipo. El texto aprobado (decisión 4) es: **«Después de
   transferir, mandanos el comprobante por WhatsApp.»**
8. **Given** un pedido en «pendiente de pago» que nadie toca, **When** pasa el
   tiempo, **Then** **no le pasa nada: nada vence solo** (decisión 6). El pedido
   queda en «pendiente de pago» **hasta que el comercio lo cancele desde la
   bandeja**. No hay tarea programada, no hay plazo configurable y **ninguna
   pantalla nombra un plazo**: sin reserva de stock, un vencimiento automático no
   guardaría nada.
9. **Given** un pedido viejo sin tocar, **When** el comercio lo cancela desde la
   bandeja, **Then** pasa a cancelado, que es terminal, y **tampoco toca stock ni
   ventas**.

---

### User Story 18 — Enterarse del pedido sin estar mirando la pantalla (Priority: P2)

Como dueño, quiero que me llegue un aviso cuando entra un pedido, y que el
comprador pueda mandarme el detalle por WhatsApp, para no tener que refrescar la
bandeja.

**Why this priority**: es la decisión 2 del plan —«el pedido llega por los tres
caminos»— y sin aviso la bandeja hay que mirarla, que es justo lo que un comercio
chico no hace. Es P2 porque el pedido ya existe en la base sin esto.

**Independent Test**: crear un pedido con `RESEND_API_KEY` puesta y sin ponerla,
y verificar que en los dos casos el pedido se crea y que la pantalla dice la
verdad sobre el email.

**Acceptance Scenarios**:

1. **Given** un pedido creado, **When** los avisos salen, **Then** usan
   `services/email.js` con `plantillaBase` (`:160`), y son **dos plantillas
   nuevas**: una para el comercio y **una para el comprador** (decisión 7).
2. **Given** que el email falla o no está configurado, **When** ocurre, **Then**
   **el pedido igual se crea**: avisar es un efecto, no una condición.
3. **Given** que el email no salió, **When** el comprador ve la confirmación,
   **Then** la pantalla **no dice «te mandamos el detalle por email»** (`:399`).
   Es el defecto que `CONVENCIONES.md` pone de ejemplo.
4. **Given** un comprador que no dejó email —es opcional, decisión 5—, **When**
   ve la confirmación, **Then** tampoco lo dice.
5. **Given** un comprador que **sí** dejó email, **When** el pedido se crea,
   **Then** **recibe un email de confirmación** con el número de pedido, el
   detalle línea por línea con los precios congelados, el total, cómo lo recibe y
   cómo pagarlo. **La frase de la maqueta «te mandamos el detalle por email» se
   queda, y esta es la parte que la cumple.**
6. **Given** el aviso al comercio, **When** sale, **Then** va a **una casilla de
   correo configurable por catálogo** —un campo más en el formulario del
   catálogo, coherente con `whatsapp_destino`—. **No** se avisa a todos los
   usuarios de la empresa con `pedidos.ver`, ni se usa el email de la empresa
   (decisión 7).
7. **Given** un catálogo **sin** casilla de aviso cargada, **When** entra un
   pedido, **Then** el pedido se crea igual, no sale ningún email al comercio, y
   la pantalla del catálogo en el panel **avisa que nadie va a enterarse por
   correo** mientras el campo esté vacío.
8. **Given** la confirmación, **When** aprieto «Mandar el detalle por WhatsApp»,
   **Then** se abre `wa.me` con el texto del pedido **ya armado por el servidor**
   con `armarTextoPedido` de **`packages/pedido`** (FR-006c) —la lógica de
   `pedidoWhatsapp.js:88-138`, mudada al paquete—, y la tienda solo abre el
   enlace que vino en la respuesta. El texto lo arma el servidor porque es el que
   tiene los nombres y los precios **congelados**; que lo armara la tienda sería
   una tercera copia del formato de importes (H2).
9. **Given** el WhatsApp de destino, **When** se arma el enlace, **Then** sale
   del catálogo (`whatsapp_destino`) y no de un valor global: cada catálogo puede
   atender por un número distinto.
10. **Given** que el WhatsApp no se manda, **When** ocurre, **Then** **el pedido
    ya existe igual** (decisión 2 del plan).

---

### User Story 19 — Permisos propios, en los tres lados, sin heredar `config.*` (Priority: P2)

Como administrador, quiero poder darle a alguien acceso a los pedidos sin darle
acceso a la configuración de la empresa, para que el que prepara los pedidos no
vea el certificado de AFIP.

**Why this priority**: el plan es explícito —«no reusar `config.*`, TiendaNube ya
arrastra el pendiente 12b por eso»—. Es P2 porque la funcionalidad anda con
permisos prestados; lo que no anda es el reparto de responsabilidades.

**Independent Test**: crear un rol con `pedidos.ver` y sin `config.ver`, y
verificar que entra a Pedidos y no a Configuración.

**Acceptance Scenarios**:

1. **Given** `seedPermissions.js`, **When** se agregan los permisos, **Then**
   son cuatro: `catalogo.ver`, `catalogo.editar`, `pedidos.ver`,
   `pedidos.gestionar`, con su `nombre` en castellano y su `modulo`, en el mismo
   formato que los 50 que ya están (`:6-80`).
2. **Given** `ROLE_PERMISOS` (`:82-119`), **When** se reparten, **Then** queda
   así (decisión 8): **`admin`** los cuatro, por el catálogo entero de `:83`;
   **`gerente`** los cuatro, explícitos; **`vendedor`** solo `pedidos.ver` y
   `pedidos.gestionar` —prepara y entrega— y **ninguno de `catalogo.*`**, porque
   los precios del catálogo son una decisión de negocio; **`produccion`** y
   **`compras`**, ninguno de los cuatro.
3. **Given** los endpoints privados, **When** se declaran, **Then** cada uno
   lleva su `checkPermission`, y `permisosDeRutas.test.js:674-693` lo verifica
   contra `seedPermissions.js`.
4. **Given** las dos rutas nuevas de `apps/web`, **When** se agregan, **Then**
   están en `components/navegacion.js` en un grupo **«Venta online»** —como lo
   dibuja la maqueta (`:656-660`)—, con su `permission` y con
   `alcance: 'empresa'`.
5. **Given** las dos rutas, **When** se agregan a `App.jsx`, **Then** están
   envueltas en `RouteGuard` con el mismo permiso que exige la API, y en
   `MarcoDePantalla`.
6. **Given** las guardias de `apps/web`, **When** corren, **Then** las dos rutas
   están en `PANTALLA_DE_LA_RUTA` y `PANTALLAS` de `guardiasDeSrc.test.js`
   (`:598-612`, `:702-714`), en `NOMBRES` de `guardiasDeDiseno.test.js:171-215`
   —con el ancla `toHaveLength(32)` de `:473` actualizada— y en `CON_MARCO` de
   `marcoDeLasPantallas.navegador.js:56-61`, que pasa de dieciocho a veinte.
7. **Given** el gate de módulo, **When** se implementa, **Then** **también está
   en la API** y no solo en el navegador. Hoy `enabled_modules` se lee en un solo
   lugar del servidor y no gatea nada (H3): si el módulo va a significar algo,
   tiene que significarlo en los tres lados.
8. **Given** el router público, **When** se lo mira desde los permisos, **Then**
   **no tiene ninguno**, por construcción, y por eso está declarado en
   `ROUTERS_SIN_SESION` **con su motivo escrito** (`permisosDeRutas.test.js:73-87`).

---

### User Story 20 — Saber si el QR sirve: visitas, pedidos y conversión (Priority: P3)

Como dueño, quiero ver cuánta gente abrió mi catálogo y cuántos terminaron
pidiendo, para saber si vale la pena mantener el acuerdo con el gimnasio.

**Why this priority**: es lo último que se necesita y lo primero que se pregunta
cuando el catálogo lleva un mes. La maqueta ya lo dibuja (`:1044-1048`), así que
la alternativa a construirlo es borrar tres números de la pantalla.

**Independent Test**: abrir el catálogo diez veces, hacer un pedido, y verificar
que la pestaña dice 10 visitas, 1 pedido y 10 % de conversión.

**Acceptance Scenarios**:

1. **Given** que alguien abre el catálogo, **When** ocurre, **Then** se cuenta
   **una visita**, agregada por día, por catálogo, **por origen y por el estado
   que tenía el catálogo en ese momento**, con un `INSERT … ON CONFLICT DO
   UPDATE` sobre esas cuatro columnas: una fila por día y por estado, no una por
   visita.
2. **Given** el conteo, **When** se guarda, **Then** **no guarda IP, ni cookie,
   ni identificador de dispositivo**. Contar no es rastrear.
3. **Given** la pestaña del QR, **When** la miro, **Then** dice **«Visitas
   (30 d)»** y no «Escaneos», porque el servidor no puede distinguir un escaneo de
   alguien que abrió el enlace que le pasaron (H7).
4. **Given** el QR generado, **When** codifica la URL, **Then** lleva un
   parámetro de origen, y la pestaña muestra el desglose como **una ayuda, no como
   una verdad**: quien comparta la URL desde su navegador la comparte con el
   parámetro puesto.
5. **Given** la conversión, **When** se calcula, **Then** es pedidos sobre
   visitas del mismo período, y **con cero visitas muestra un guion, no `NaN` ni
   `0 %`**.
6. **Given** un catálogo recién creado, **When** miro los números, **Then** dicen
   cero y no rompen la pantalla.
7. **Given** el conteo de visitas, **When** el catálogo está pausado o la empresa
   vencida, **Then** **la visita se cuenta igual**: saber cuánta gente llegó a
   una tienda pausada es información útil, y es exactamente la que explica por
   qué no hubo pedidos. La pestaña **distingue** ese período —visitas con el
   catálogo pausado— para que la conversión en cero no se lea como un problema de
   la tienda.

   **Y esto exige que la fila guarde el estado**, que es lo que el diseño técnico
   corrigió: la clave de `catalogo_visitas` es **`(catalogo_id, fecha, origen,
   estado_catalogo)`** y no `(catalogo_id, fecha, origen)`. Sin `estado_catalogo`
   guardado **en el momento de la visita**, este escenario **no se puede
   cumplir**: cuando alguien abra la pestaña, el catálogo ya va a estar en otro
   estado y no hay de dónde deducir en cuál estaba cada día. Sigue sin guardar IP
   ni cookie: `estado_catalogo` es un dato del catálogo, no del visitante.

---
### Edge Cases

Lo que pasa cuando los datos son raros. **Es la mitad del valor de esta spec**:
un catálogo público lo abre cualquiera, con cualquier dato cargado atrás.

#### El catálogo y su slug

- **Slug con acentos, mayúsculas o espacios** → se normaliza antes de guardar, y
  la normalización es la que el formulario ya mostró. Nunca dos normalizaciones
  distintas.
- **Slug de una sola letra, o de doscientos caracteres** → hay mínimo y máximo, y
  el formulario los dice antes de guardar.
- **Slug que choca con una ruta de la app** (`c`, `api`, `assets`, `robots.txt`)
  → se rechaza.
- **Dos empresas piden el mismo slug al mismo tiempo** → una gana y la otra
  recibe un mensaje legible. Lo garantiza el índice único de la base, no un
  `findOne` previo.
- **El slug cambia con QR ya impresos** → la pantalla avisa **antes** de guardar
  y pide confirmación. **El slug viejo muere**: no redirige, no queda reservado y
  el enlace anterior devuelve el 404 público (decisión 11).
- **Se intenta borrar un catálogo que ya tiene pedidos** → **se rechaza el
  borrado** y se ofrece **pausarlo**: un pedido que apunta a un catálogo que no
  existe es un pedido que la bandeja no puede explicar (decisión 11).
- **Catálogo publicado y después despublicado a borrador** → responde 404, no la
  pantalla de pausa. Borrador y pausado son estados distintos con salidas
  distintas.
- **El punto de venta del catálogo se desactiva** → se rechaza nombrando el
  catálogo (H13).
- **La empresa se desactiva o pierde el módulo** → el catálogo deja de responder,
  por el mismo camino que la suscripción vencida.

#### Los precios y las reglas

- **Producto con costo $0 y sin `price_override`** → **no sale al catálogo**,
  aunque esté marcado publicable, y el panel dice cuántos son (H5).
- **Producto con `price_override` y costo $0** → sale: el precio manual gana.
- **Regla de porcentaje del 100 %** → precio cero, no negativo. Y la
  previsualización lo marca en rojo: un producto a $0 en una página pública es
  una oferta.
- **Regla de monto mayor que el precio de lista** → precio cero, marcado igual.
- **Regla de precio fijo de $0** → se rechaza al guardarla.
- **Regla de porcentaje negativa, o mayor que 100** → se rechaza al guardarla.
- **Regla de precio fijo mayor que el precio de lista** → se acepta: un catálogo
  puede vender más caro que el mostrador. Pero el tachado **no se dibuja al
  revés**: si el final es mayor que el de lista, no hay tachado ni ahorro.
- **Producto sin marca** (el 96 % de los migrables) → las reglas de ámbito marca
  no lo alcanzan, y el renglón de la marca no se dibuja en la tarjeta.
- **Producto en la categoría `otro`** (99 de 392 hoy) → es una categoría como
  cualquier otra y aparece en las píldoras si hay productos publicados en ella.
- **Categoría escrita distinto en dos productos** (`Nutremax` / `NUTREMAX`) →
  la comparación de la regla y la del filtro del catálogo son **la misma
  función**, o el mismo producto sale filtrado de una y no de la otra.
- **Se borra la marca a la que apunta una regla** → la regla queda sin alcanzar
  a nadie y la fila muestra «0 de 0», atenuada. No se borra sola.
- **Se borra el producto al que apunta una regla de producto** → la fila se borra
  con él (`ON DELETE CASCADE`), porque no hay nada que la regla pueda significar.
- **Ninguna regla** → los precios son los de lista y nada se rompe.
- **Todas las reglas desactivadas** → lo mismo.
- **`cost` vuelve del driver como string `'100.00'`** → el cálculo da lo mismo
  que con el número. `'0.00' <= 0` es `true` y `'0.00' === 0` es `false`
  (`CONVENCIONES.md`, «El cuarto nivel»).

#### El carrito y el pedido

- **Cantidad cero** → la línea se elimina del carrito; en el cuerpo del pedido,
  se rechaza.
- **Cantidad negativa, decimal o no numérica** → se rechaza.
- **Cantidad absurda** (999.999) → hay un máximo por línea, y el mensaje lo dice.
- **El mismo producto dos veces en el cuerpo** → se consolida en una línea con la
  suma.
- **Pedido sin líneas** → se rechaza.
- **Pedido con un `product_id` que no existe** → se rechaza entero, y no se crea
  nada.
- **Pedido con un `product_id` de otra empresa** → 404, y **no queda ninguna
  fila**. Es el caso que el detector de `aislamientoEmpresas.test.js:867-1044`
  tiene que ver.
- **Pedido con un producto que está en el sistema pero no en este catálogo** →
  se rechaza.
- **Pedido con precio, subtotal o total en el cuerpo** → los campos se **ignoran**
  en silencio; el servidor calcula todo.
- **El botón de mandar apretado dos veces** → un solo pedido, por el `UNIQUE` de
  `idempotency_key`.
- **Dos pedidos simultáneos de la misma empresa** → no comparten número.
- **La regla de precio cambia entre que se arma el carrito y se manda el pedido**
  → **gana el precio del momento de crear el pedido**, y queda congelado. El
  carrito vive en el navegador y no es una promesa.
- **El precio subió respecto de lo que mostraba el carrito** → **se avisa antes
  de confirmar**, con el mismo tratamiento visual que la línea agotada, y el
  comprador decide si sigue. Nunca se cobra en silencio un número distinto del
  que se mostró.
- **Envío elegido y después el catálogo apaga el envío** → al crear el pedido se
  revalida contra la configuración actual del catálogo; si la opción ya no está,
  se rechaza con el motivo.
- **Subtotal exactamente igual al umbral de envío gratis** → **gratis**.
- **Envío gratis configurado en cero o vacío** → significa «no hay envío gratis»,
  no «todo gratis».
- **Efectivo al retirar con envío a domicilio** → se rechaza: la maqueta ya lo
  dice, «solo con retiro en el gimnasio o en el local» (`:904`).
- **Nombre con emojis, o de 500 caracteres** → hay máximo, y no rompe el email ni
  el WhatsApp.
- **Dirección vacía con envío elegido** → se rechaza.

#### El stock

- **`available = 0` y `quantity > 0`** → agotado. Se lee `available`.
- **`available` negativo** → se trata como cero, y queda registrado: es un dato
  inconsistente del inventario, no del catálogo.
- **Producto sin fila de stock en el punto de venta del catálogo** → agotado. No
  es un error.
- **Se agota entre el carrito y el pedido** → línea quitada, total nuevo, pantalla
  de «Se agotó mientras compraba».
- **Se agotan todas** → no se crea pedido.
- **Se pidieron 5 y hay 2** → **la línea se recorta a 2 y se avisa**, con el
  tratamiento visual de la línea tachada. No se quita la línea entera.
- **Un pedido «pendiente de pago» que nadie toca durante semanas** → **queda
  ahí**: nada vence solo, y solo el comercio lo cancela desde la bandeja.
- **Dos personas piden la última unidad al mismo tiempo** → **los dos pedidos se
  crean**. No hay reserva. Está escrito, no simulado (US14 escenario 8).

#### El aislamiento y el mundo hostil

- **`X-Empresa-Id` en un endpoint público** → se ignora por completo.
- **Un `Authorization` cualquiera en un endpoint público** → se ignora: el
  router público no tiene cadena de auth.
- **Cabecera `Origin` de otro dominio** → CORS decide, y `tienda.favalio.com`
  tiene que estar en `ALLOWED_ORIGINS` (`docker-compose.produccion.yml:89`) o el
  navegador corta todo sin decir por qué.
- **Un id enorme, negativo o no numérico en una ruta pública** → 404, sin que el
  mensaje diga si el id existía.
- **Un `q` de búsqueda de 10.000 caracteres, o con comodines de SQL** → se acota
  y se parametriza.
- **`page` negativo o gigante** → se acota; una página vacía es 200 con lista
  vacía, no un error.
- **Cincuenta personas escaneando desde la misma IP** → el limitador propio del
  prefijo público actúa, **y el punto de venta del comercio no recibe 429** (H10)
  — porque además de tener su limitador, el prefijo público está **eximido del
  limitador global** (FR-113a). Con una sola de las dos piezas, las cajas reciben
  429 igual.
- **Alguien borra el `skip` del limitador global en una limpieza** → una guardia
  estática falla (FR-113b). En ejecución no se vería nada: el catálogo sigue
  andando y el síntoma —429 en las cajas— llega días después.

#### Las imágenes

- **Archivo que no es imagen renombrado a `.jpg`** → se rechaza mirando el
  contenido.
- **Imagen más grande que el límite** → se rechaza diciendo el límite, con un
  mensaje de negocio y no un 500 de multer.
- **Imagen corrupta a la mitad** → se rechaza y no queda un archivo a medias en
  el volumen.
- **`image_url` que apunta a un tercero** (cargada por el importador) → **no se
  publica**, y la pestaña Productos lo señala (H6).
- **Producto sin foto** → marcador neutro del mismo tamaño, para que la grilla no
  se descuadre.
- **Se borra el producto** → **su imagen se borra en el mismo camino que borra el
  producto**, para que el volumen no acumule archivos que ya no referencia nadie
  y el respaldo no los arrastre.
- **El volumen se llena** → la subida falla con un mensaje legible, y queda
  registrado. No hay cuota por empresa en esta etapa: ver «Fuera de alcance».

#### Los estados y la operación

- **La empresa vence la suscripción con pedidos pendientes** → los pedidos siguen
  en la base y se ven al volver; lo que se corta es el catálogo público.
- **Un pedido de un catálogo que después se borra** → **no puede pasar**: el
  borrado de un catálogo con pedidos **se rechaza** y la pantalla ofrece pausarlo
  (decisión 11). Un catálogo sin pedidos sí se borra.
- **Un pedido cuyo comprador pide que borren sus datos** → fuera de alcance,
  anotado.
- **Se cambia el estado del mismo pedido desde dos pestañas a la vez** → gana el
  último y no queda en un estado imposible; la transición se valida contra el
  estado real de la base, no contra el que la pantalla tenía cargado.
- **`RESEND_API_KEY` sin configurar** → el pedido se crea, el email no sale, y
  **la pantalla no dice que salió** (H8).

---
## Requirements *(mandatory)*

### Functional Requirements

#### Etapa 0 · El cálculo de precios

- **FR-001**: DEBE existir **una sola** implementación de la regla de precio de
  venta en el repositorio, y DEBE vivir en **`packages/precios`**, un paquete
  compartido del monorepo (decisión 1).
- **FR-002**: Esa implementación DEBE conservar la convención documentada en
  `precios.js:1-17` —«margen 50 %» es recargo sobre el costo, `costo × 1,5`— y
  los dos modos de recargo por tarjeta (`MODO_RECARGO`).
- **FR-003**: Los **21 casos** de `apps/web/src/utils/precios.test.js` DEBEN
  seguir corriendo y pasando después de la mudanza, **sin que se modifique
  ninguna aserción**, incluidos el recargo del 100 % que devolvía `Infinity`
  (`:63-65`), el descuento del 100 % que devolvía negativo (`:80`) y el `cost`
  que vuelve como string. **Son 21, contados sobre el archivo**: el borrador de
  esta spec decía «doce» y el diseño técnico lo corrigió contándolos. Que los 21
  pasen **sin cambios** es lo que prueba que mudar el cálculo a
  `packages/precios` no cambió ningún resultado; si el total baja de 21, la
  mudanza perdió casos y nada más lo va a avisar.
- **FR-004**: El servidor DEBE poder resolver el precio de venta de un producto
  a partir del producto y de los ajustes de la empresa, sin pedirle nada al
  cliente.
- **FR-005**: El punto de venta DEBE obtener su precio de esa misma cuenta. **NO
  DEBE** existir una segunda fórmula escrita en `apps/web`.
- **FR-006**: DEBE existir el paquete **`packages/precios`** como **único** lugar
  donde vive la fórmula, y **`apps/web` y `apps/api` DEBEN consumirlo** como
  dependencia de workspace. **NO DEBE** existir ninguna copia del texto de la
  fórmula en ninguna de las dos apps, y una guardia estática DEBE fallar si
  aparece. *(Este requisito reemplaza al «test que ata dos copias» del borrador:
  con la decisión 1 no hay dos copias que atar.)*
- **FR-006a**: El monorepo DEBE pasar a **workspaces de npm**, y el cambio DEBE
  alcanzar en el mismo paso al `package.json` raíz, a los `package.json` de las
  **cuatro** apps, a los **Dockerfiles** y a los **jobs** de
  `.github/workflows/ci.yml`. Los cinco DEBEN seguir pasando, y los tests de
  `packages/precios` DEBEN correr en el CI —en un job propio o adentro de los que
  ya hay, eso lo decide el plan—.
- **FR-006b**: `packages/precios` DEBE poder ejecutarse **en el navegador y en el
  servidor** sin adaptadores: es lo que sostiene a la vez el cálculo instantáneo
  de `PanelProducto.jsx:203` y el cálculo autoritativo del catálogo público.
- **FR-006c**: DEBE construirse un **segundo paquete compartido,
  `packages/pedido`**, con `normalizarTelefono` y `armarTextoPedido` —las dos
  **puras**— mudadas de `apps/web/src/utils/pedidoWhatsapp.js` (`:32-76` y
  `:88-138`). **`apps/api` y `apps/tienda` DEBEN consumirlo** como dependencia de
  workspace, igual que `packages/precios`. Sin él, FR-144 y FR-184 **no se pueden
  construir como estaban escritos**: los dos pedían reusar un archivo de
  `apps/web/src`, y **ninguna de las dos apps que lo necesitan puede importar de
  ahí** —son paquetes de npm distintos, ninguno declara al otro, y la única vía
  sería una ruta relativa `../../web/src/utils/…` que además rompe la imagen de
  Docker de la API—. Las tres salidas descartadas: **copiar la función** —es el
  defecto de `mediosDePago.js` que FR-006 vino a cerrar—; **que el enlace lo arme
  la tienda** —obligaría a mandarle el detalle otra vez y a formatear importes
  por tercera vez, que es exactamente lo que H2 advierte—; y **no reusar nada**.
  Con workspaces ya puestos, el paquete cuesta un `package.json` y una línea en
  dos `dependencies`.
- **FR-006d**: `packages/pedido` DEBE crearse **en la etapa 2**, junto con
  `pedidos` y `pedido_items`, y **no** en el corte de workspaces: ese corte toca
  las cuatro apps a la vez y es el más peligroso del hito; sumarle un segundo
  paquete que la etapa 0 no usa lo engorda sin ganar nada. `packages/precios`, en
  cambio, **sí** es de la etapa 0, porque FR-076 lo necesita del lado del
  servidor desde la previsualización.
- **FR-007**: El resultado DEBE distinguir **«precio $0»** de **«sin precio
  resoluble»**, con la bandera que `precios.js:128` ya devuelve como `sinCosto`.
- **FR-008**: La previsualización del precio mientras se edita el costo
  (`PanelProducto.jsx:203`) DEBE seguir actualizándose sin latencia perceptible.
- **FR-009**: Los ajustes que alimentan la cuenta —`margin_efectivo`,
  `recargo_tarjeta`, `descuento_alianza`, `recargo_modo`— DEBEN leerse por
  empresa, respetando la mezcla de `empresa.settings` con la tabla `settings` que
  ya hace `routes/general.js:527-546`.

#### Etapa 0 · Imágenes

- **FR-020**: DEBE existir un endpoint privado, con permiso, para subir la imagen
  de un producto, y otro para el logo y la portada de un catálogo.
- **FR-021**: La imagen DEBE redimensionarse en el servidor antes de guardarse, a
  las medidas declaradas para cada uso. **NO DEBE** guardarse el original tal
  como llegó.
- **FR-022**: Las imágenes DEBEN guardarse en un **volumen persistente** montado
  en la API, no en la base de datos. El camino de `routes/empresas.js:47-51`
  —data URI base64 en una columna— **NO** se reusa para fotos de producto: infla
  la base y el `pg_dump`.
- **FR-023**: Las imágenes DEBEN servirse por **Caddy** desde ese volumen, con su
  bloque en `deploy/Caddyfile`, y no por la API.
- **FR-024**: La validación DEBE mirar el **contenido** del archivo, no la
  extensión ni el `Content-Type` declarado.
- **FR-025**: DEBE haber un límite de tamaño, y superarlo DEBE devolver un
  mensaje de negocio en castellano, no un 500 de multer.
- **FR-026**: El nombre del archivo guardado DEBE ser **aleatorio** y no
  derivable del id del producto ni de la empresa, con el molde de
  `Invitacion.js:24-29`.
- **FR-026a**: Las imágenes de producto **SON públicas por URL y eso se acepta**:
  son fotos de catálogo, no documentos, y Caddy las sirve del volumen sin
  consultar permisos. Lo que **NO DEBE** ser es **enumerable**: por FR-026 nadie
  puede recorrer el catálogo entero de todas las empresas incrementando un
  número.
- **FR-027**: `deploy/respaldo.sh` DEBE respaldar el volumen de imágenes **en el
  mismo cambio que lo crea**, verificar que el respaldo no quedó vacío —como ya
  hace con el `.sql.gz` en `:46-49`— y rotar con el mismo criterio.
- **FR-028**: El procedimiento de restauración de las imágenes DEBE quedar
  escrito en `docs/OPERACION.md`.
- **FR-029**: Borrar la imagen de un producto DEBE borrarla del volumen **y** de
  `products.image_url`.
- **FR-030**: Una `image_url` que apunte fuera de la plataforma **NO DEBE**
  publicarse en la tienda, y el panel DEBE señalar esos productos con la
  explicación (H6).

#### Etapa 0 · `products.publicable`

- **FR-040**: DEBE agregarse `products.publicable` BOOLEAN NOT NULL DEFAULT
  `false`, y la migración DEBE dejar en `false` **todos** los productos
  existentes.
- **FR-041**: Un producto sale a un catálogo solo si es `publicable` **Y**
  `is_active` **Y** tiene precio resoluble. Son tres condiciones con `Y`, no con
  `O`.
- **FR-042**: `publicable` **NO DEBE** poder escribirse desde ningún endpoint sin
  sesión.
- **FR-043**: DEBE existir una acción masiva para marcar y desmarcar `publicable`
  sobre una selección de productos.

#### Etapa 1 · El catálogo y su slug

- **FR-050**: El slug DEBE ser **único global**, no por empresa, y la garantía
  DEBE ser un índice único de la base.
- **FR-051**: El slug DEBE normalizarse a minúsculas, sin acentos y con
  `[a-z0-9-]`, con una **función pura** que use el formulario y el servidor.
- **FR-052**: DEBE existir una lista de slugs reservados que incluya al menos
  `c`, `api`, `assets`, `admin`, `robots.txt` y `favicon.ico`.
- **FR-053**: El choque de slug DEBE llegar como mensaje de negocio legible que
  **no diga de quién es** el slug tomado.
- **FR-054**: Un catálogo DEBE tener exactamente tres estados: `borrador`,
  `publicado`, `pausado`.
- **FR-055**: Un catálogo en `borrador` DEBE responder **404** en su URL pública,
  con **el mismo cuerpo** que un slug inexistente.
- **FR-056**: Un catálogo `pausado` DEBE responder 200 con **solo** lo necesario
  para dibujar la pantalla de pausa: nombre, descripción, logo, portada, color y
  WhatsApp. **NO DEBE** devolver productos ni precios.
- **FR-057**: Publicar DEBE exigir nombre visible, slug, punto de venta **activo**
  y al menos un producto que salga; y si falta algo, la pantalla DEBE decir qué
  falta, uno por uno.
- **FR-058**: El catálogo DEBE declarar **su** punto de venta, y el stock que lee
  DEBE salir **solo** de ese punto de venta, resuelto con
  `utils/sucursalDeStock.js`.
- **FR-059**: Desactivar un punto de venta usado por un catálogo publicado DEBE
  rechazarse nombrando el catálogo (H13).
- **FR-060**: El color de marca DEBE guardarse como un solo valor por catálogo, y
  el color del texto encima DEBE **calcularse por contraste**, no elegirse
  (`textoSobre`, `:1211-1218`).
- **FR-061**: `mostrarPrecioLista` DEBE ser un interruptor **por catálogo**, y su
  valor por defecto DEBE ser **apagado** (decisión 8): el default seguro es no
  publicar el margen. *(Supuesto revisable de la spec, no decisión del dueño del
  producto.)*
- **FR-062**: El precio de lista tachado y el ahorro **NO DEBEN** dibujarse
  cuando el precio del catálogo es mayor o igual que el de lista.
- **FR-063**: Los productos de un catálogo DEBEN elegirse **uno por uno**:
  `catalogo_productos` es una **lista de inclusión** y estar en la tabla **es**
  estar en el catálogo (decisión 9). **NO DEBE** existir
  `catalogos.incluye_todos`, ni ninguna forma de «todos los publicables menos
  excepciones».
- **FR-064**: Un producto publicable nuevo **NO DEBE** aparecer en ningún
  catálogo hasta que alguien lo agregue a ese catálogo. Ni un alta suelta ni una
  importación de CSV publican nada por su cuenta.
- **FR-065**: `catalogo_productos` **NO DEBE** tener columna `visible`: sería una
  tercera bandera además de `publicable` e `is_active` para decir lo mismo que
  decir que la fila no exista. Quitar un producto del catálogo **es borrar su
  fila**.
- **FR-066**: La pestaña Productos DEBE ofrecer **selección múltiple con
  «Publicar» y «Quitar»** (`:987-992`) y el contador «N publicados de M del
  inventario» (`:985`). Sin acciones masivas, armar el catálogo el primer día son
  62 clics.
- **FR-067**: Cambiar el slug DEBE **matar el slug viejo** (decisión 11): **NO
  DEBE** existir tabla de alias, redirección ni reserva del nombre anterior. El
  enlace viejo DEBE responder el mismo 404 público que un slug inexistente, y el
  nombre liberado vuelve al espacio de nombres global.
- **FR-068**: La pantalla DEBE avisar **antes de guardar** el cambio de slug que
  los QR y carteles ya impresos dejan de funcionar, y DEBE pedir confirmación
  explícita. El aviso es parte del cambio, no un texto de ayuda.
- **FR-069**: Borrar un catálogo **que tiene pedidos** DEBE **rechazarse**, y la
  pantalla DEBE ofrecer **pausarlo**. Un catálogo sin pedidos DEBE poder
  borrarse.

#### Etapa 1 · Las reglas de precio

- **FR-070**: Los ámbitos DEBEN ser cuatro: `catalogo`, `categoria`, `marca`,
  `producto`. Los tipos, tres: `porcentaje_descuento`, `monto_descuento`,
  `precio_fijo`.
- **FR-071**: **Gana la más específica**: producto → marca → categoría →
  catálogo. Las reglas **NO se acumulan**.
- **FR-072**: El motor DEBE devolver, además del precio final, **la regla que
  gana**, **las que quedaron pisadas** y **la cobertura** de cada regla: a cuántos
  productos alcanza y en cuántos gana. Es lo que dibuja «Gana en 2 de 4» (`:942`)
  y la columna de pisadas (`:969`).
- **FR-073**: El motor DEBE ser una **función pura**, testeable sin base.
- **FR-074**: Un descuento que deje el precio en negativo DEBE dar **cero**.
- **FR-075**: Un porcentaje fuera de `(0, 100]` y un precio fijo de $0 DEBEN
  rechazarse **al guardar la regla**, no al aplicarla.
- **FR-076**: Un producto **sin precio resoluble** —`sinCosto`— **NO DEBE** salir
  al catálogo, y el panel DEBE decir cuántos son y cuáles (H5).
- **FR-077**: Un producto que quede en $0 por una regla DEBE marcarse en la
  previsualización, con la explicación.
- **FR-078**: El ámbito `categoria` DEBE ofrecer **las categorías que existen
  hoy** en los productos publicables del catálogo, porque `products.category` es
  texto libre (`Product.js:60`) y no hay tabla de categorías.
- **FR-079**: La comparación de categoría de la regla y la del filtro de la tienda
  DEBEN ser **la misma función**.
- **FR-080**: Dos reglas del mismo ámbito y el mismo objetivo DEBEN chocar contra
  un **índice único de la base**, y el choque DEBE llegar como mensaje legible que
  nombre la regla existente.
- **FR-081**: Una regla sobre una marca o un producto de **otra empresa** DEBE
  responder 404 y **no dejar ninguna fila**, con `findScoped`.
- **FR-082**: Una regla desactivada DEBE comportarse como si no existiera.
- **FR-083**: Borrar el producto al que apunta una regla de ámbito producto DEBE
  borrar la regla (`ON DELETE CASCADE`).

#### Etapa 1 · El router público y el aislamiento

- **FR-090**: DEBE existir un router público exportado aparte del privado y
  montado con **`app.use`**, **arriba** de `app.use('/api', ...authEmpresa,
  general)` (`server.js:464`) y **debajo** del `express.json` (`:184`) y del
  limitador global (`:319`). Estar **debajo** del limitador global es la posición,
  no el régimen: el prefijo queda igual eximido de ese limitador por el `skip` de
  FR-113. Las dos cosas conviven a propósito —la exención se escribe en el
  limitador, no se obtiene del orden de montaje— y ver FR-113a.
- **FR-091**: El prefijo público **NO DEBE** empezar con `/api/empresas`,
  `/api/auth` ni `/api/ping`: heredaría la exención de
  `checkSubscription.js:30-36`.
- **FR-092**: DEBE existir un **resolvedor de tenant sin sesión** que, a partir
  del slug, devuelva `{ empresaId, catalogoId, puntoDeVentaId }` y **nada más**.
- **FR-093**: Ese resolvedor **NO DEBE** reutilizar `loadEmpresaContext`, que
  tiene la rama del superadmin por `X-Empresa-Id` (`auth.js:172-200`).
- **FR-094**: Toda consulta del router público DEBE filtrar por el `empresa_id`
  que devolvió el resolvedor, con `findScoped` / `scoped`. **Nunca
  `Model.findByPk(req.params.id)`.**
- **FR-095**: Toda respuesta pública DEBE armarse con **lista blanca explícita**
  de campos. **NO DEBE** devolverse una instancia de modelo, ni un spread, ni una
  consulta con `attributes: { exclude: … }`.
- **FR-096**: Ninguna respuesta pública DEBE contener `cost`, `margin_override`,
  `wholesale_margin`, `wholesale_price`, `supplier_id`, `barcode`, `is_active`,
  `publicable`, `empresa_id` ni `punto_de_venta_id`.
- **FR-097**: DEBE existir una **guardia estática nueva** que falle ante
  cualquiera de los patrones de FR-095 y FR-096 en el router público y su
  serializador. La guardia DEBE dar **al menos un hallazgo la primera vez que se
  corre**, antes de escribir el código nuevo: una guardia que nace en verde no se
  sabe si mira (molde: `guardiasDeDiseno.test.js:419-426`).
- **FR-098**: DEBE existir un **test de integración con dos empresas** contra los
  endpoints públicos, en `apps/api/src/tests/integracion/`, que verifique que el
  catálogo de B da 404 desde el enlace de A y que ningún dato de A aparece en una
  respuesta de B.
- **FR-099**: El router público DEBE declararse en `ROUTERS_SIN_SESION` de
  `permisosDeRutas.test.js:73-87` **con su motivo escrito**, y el archivo nuevo de
  `routes/` DEBE entrar en la lista literal de `:549-565`.
- **FR-100**: DEBE existir una guardia estática que verifique la **posición** del
  montaje —debajo del parser, debajo del limitador global y arriba del genérico—,
  con `observabilidad.test.js:394-536` de molde. Esa misma guardia DEBE verificar
  la **exención y su atadura** de FR-113b: que el limitador global nombre el
  prefijo público en su `skip`, y que exista el limitador propio aplicado en la
  línea del montaje. Y DEBE **fallar cuando no encuentra alguna de las líneas**
  que dice mirar, en vez de pasar por no haber encontrado nada.
- **FR-101**: Ninguna respuesta pública DEBE llevar `err.message`, nombres de
  tabla ni de restricción. Todo `catch` usa `fallo(req, res, err, '…')`.
- **FR-102**: El router público DEBE ignorar `X-Empresa-Id`, `Authorization` y
  `X-Sesion-Id` si vienen.

#### Etapa 1 · Suscripción, límites y descubrimiento

- **FR-110**: El estado de la suscripción DEBE verificarse **dentro del handler**
  público, con la misma función y los mismos estados que
  `checkSubscription.js:85-115`. **NO DEBE** escribirse una segunda lista de
  estados.
- **FR-111**: Una empresa con la suscripción vencida y la gracia agotada **NO
  DEBE** mostrar productos ni precios, ni permitir crear pedidos.
- **FR-112**: Una empresa en período de gracia DEBE seguir funcionando.
- **FR-112a**: Ante un **error al consultar la suscripción**, el catálogo público
  **DEBE cerrar**: responder **503** con el estado «no disponible por un momento»,
  sin productos y sin permitir crear pedidos, y **registrar el error con el slug y
  la empresa**. **NO DEBE** copiarse el criterio de `checkSubscription.js:127-130`,
  que deja pasar: en una superficie pública, dejar pasar significa vender en
  nombre de una empresa que quizá está vencida. **La cadena privada no cambia** y
  sigue dejando pasar — la asimetría es deliberada. Se responde 503 y **no 402**
  porque 402 afirmaría que la suscripción venció, y lo que pasó es que no se pudo
  saber.
- **FR-113**: El prefijo público DEBE quedar gobernado **únicamente** por un
  limitador **propio**, que cuente por **IP y slug** a la vez, distinto del global
  de `server.js:312-319`. Dos requisitos, y hacen falta **los dos**:
  1. **El limitador propio DEBE existir**, con su ventana y su tope propios, y su
     clave DEBE combinar la IP con el slug del camino. Sin el slug, un catálogo
     con mucho tráfico apaga a todos los demás que salen por la misma IP; sin la
     IP, un solo visitante apaga un catálogo entero para todo el mundo.
  2. **El limitador global de `server.js:312-319` DEBE eximir el prefijo público**
     mediante un `skip`, con el motivo escrito al lado.
- **FR-113a**: La exención del limitador global (`skip`) **NO es opcional ni una
  optimización**: sin ella FR-115 **no se cumple**. El montaje del router público
  queda **debajo** de `app.use('/api/', limiter)` porque FR-090 lo exige, así que
  cada visita al catálogo también consume el cupo global de 600 peticiones cada
  15 minutos **por IP** — el mismo cupo que consumen las cajas del comercio si
  comparten NAT con el gimnasio, y el de cualquier otro cliente detrás de ese
  NAT. Agregar solo el limitador propio **no le devuelve el cupo a nadie**: le
  pone **dos** límites al catálogo y le sigue comiendo el del comercio. La
  exención DEBE escribirse **en el limitador que exime** —no resolverse montando
  el router por encima del limitador—, porque un router que quedó sin límite «por
  el orden» es un router que nadie sabe que está sin límite.
- **FR-113b**: DEBE existir una **guardia estática que ate el `skip` al limitador
  propio**: si el `skip` del prefijo público está presente, el limitador propio
  DEBE existir y DEBE estar aplicado en la línea del montaje público. El motivo
  es que **el `skip` es una línea que, borrada, no rompe nada visible**: el
  catálogo sigue andando y las cajas del comercio empiezan a recibir 429 los
  sábados a la tarde, que es un síntoma que nadie relaciona con una línea de
  `server.js`. Y al revés: un prefijo eximido del límite global y **sin** límite
  propio es una superficie pública sin ningún límite. La guardia DEBE fallar en
  los dos sentidos.
- **FR-114**: DEBE medirse cuántas llamadas dispara una visita completa **antes
  de publicar el QR**, y el número medido DEBE quedar escrito en el plan y en
  `docs/OPERACION.md`. El tope del limitador propio DEBE elegirse a partir de ese
  número, y **recontarse** si la tienda termina pidiendo más llamadas de las
  medidas.
- **FR-115**: El tráfico del catálogo **NO DEBE** poder provocar un 429 en el
  punto de venta del comercio. Este requisito es **producido por FR-113**: se
  cumple porque el prefijo público está eximido del limitador global **y** tiene
  el suyo propio. Cualquiera de las dos mitades sola lo deja sin cumplir.
- **FR-116**: La tienda DEBE servir `noindex, nofollow` **y** un `X-Robots-Tag`,
  y un `robots.txt` que no permita recorrer `/c/`.
- **FR-117**: Los metadatos Open Graph —`og:title`, `og:description`, `og:image`,
  `og:url`— DEBEN ser **por catálogo**, y DEBE servirlos **un handler de la API**
  que devuelva el HTML de `/c/:slug` con las etiquetas ya puestas; el resto del
  documento sale del bundle de `apps/tienda` (decisión 12). **NO DEBEN** ponerse
  desde React: el lector de previsualizaciones no ejecuta JavaScript.
- **FR-117a**: `deploy/Caddyfile` DEBE enrutar `/c/:slug` a ese handler y el
  resto de las rutas de `tienda.${DOMINIO}` al estático, sin que el Caddyfile
  consulte la API ni arme plantillas.
- **FR-117b**: El handler DEBE responder con las mismas reglas de visibilidad que
  el resto del router público: un catálogo en borrador, pausado o de una empresa
  vencida **NO DEBE** previsualizarse con datos reales.
- **FR-117c**: El handler **NO PUEDE leer el `index.html` de `apps/tienda` del
  disco**, y esto es infraestructura que hay que presupuestar, no un detalle de
  implementación. `apps/api` y `apps/tienda` son **dos imágenes de Docker
  distintas**: la imagen de la API copia `src/` y `scripts/`, y el `index.html`
  con su `<script src="/assets/index-<hash>.js">` vive dentro de la imagen de la
  tienda, con un hash que cambia en cada build. Por lo tanto:
  1. El handler DEBE **pedirle el HTML al servicio `tienda` por la red interna
     del compose**, y esa llamada saliente DEBE llevar **`timeout`**, como toda
     llamada saliente del repositorio.
  2. La respuesta DEBE **cachearse en memoria con un TTL de 60 segundos**, para
     que una visita normal no cueste ninguna petición extra y un deploy de la
     tienda tarde a lo sumo un minuto en verse.
  3. `apps/tienda/index.html` DEBE llevar el marcador **`<!--FAVALIO_META-->`** en
     el `<head>`, y el handler DEBE **reemplazar esa línea** por las etiquetas.
     Un marcador y **no** una expresión regular sobre `<head>`.
  4. Si el marcador **no está**, el handler DEBE servir el HTML **sin** metadatos
     y **registrarlo**, en vez de romper o de servir un documento a medias.
  5. Si el servicio `tienda` **no responde**, el handler DEBE responder **503**
     con una página propia mínima y registrar el error. **NO DEBE** inventar un
     HTML sin el `<script>` del bundle: eso sería una página en blanco sin
     explicación.

  Quedan **descartadas** las tres alternativas: que la API guarde su propia copia
  del `index.html` —dos archivos que hay que mantener sincronizados, y el que se
  desincroniza apunta a un `assets/index-<hash>.js` que ya no existe: página en
  blanco, sin error—; un **volumen compartido** con el `dist/` de la tienda —acopla
  el ciclo de vida de las dos imágenes: durante la ventana del deploy la API lee
  el build anterior—; y que **Caddy inyecte** las etiquetas, que FR-117a prohíbe.
- **FR-118**: `https://tienda.${DOMINIO}` DEBE agregarse a `ALLOWED_ORIGINS` en
  `docker-compose.produccion.yml:89`, **por interpolación en el compose** y no en
  un `.env` suelto.
- **FR-119**: `apps/tienda` DEBE ser el sexto servicio del compose (hoy hay cinco: `caddy`, `postgres`, `api`, `web` y `landing`), con su
  bloque en `deploy/Caddyfile` y su job en `.github/workflows/ci.yml`, que hoy
  tiene cinco.
- **FR-120**: `apps/tienda` **NO DEBE** incluir Auth0, ni cabecera
  `Authorization`, ni `X-Sesion-Id`, ni el interceptor de 401 que dispara el
  logout (`apps/web/src/services/api.js:150-167`, `:258`).
- **FR-121**: La tienda DEBE dibujarse **mobile-first a 390px** y **no DEBE**
  desbordar el `<body>` a lo ancho en ninguna de sus pantallas. En escritorio sube
  a tres columnas dentro de 720px, y no se abre a una grilla ancha (`:449-464`).
- **FR-122**: Toda pantalla de la tienda DEBE llevar el pie con
  **«powered by favalio»**.
- **FR-123**: El color de marca DEBE aparecer **solo en lo que se toca**, nunca
  como fondo de una zona grande.

#### Etapa 2 · El pedido

- **FR-130**: El cuerpo del pedido DEBE llevar **`product_id` y cantidad, y nada
  más** por línea. Cualquier precio, subtotal o total que venga **DEBE
  ignorarse**.
- **FR-131**: El servidor DEBE resolver el precio de cada línea con el motor de
  reglas y **congelarlo** en `pedido_items`, junto con el nombre del producto.
- **FR-132**: **Todos** los productos del pedido DEBEN validarse contra el
  catálogo publicado —misma empresa, en el catálogo, publicable, activo, con
  precio— **antes de crear nada**. Un producto inválido rechaza el pedido entero.
- **FR-133**: El total DEBE calcularlo el servidor a partir de las líneas y del
  envío. **Nunca se guarda un total que mandó el cliente**
  (`CONVENCIONES.md`, «Dinero»).
- **FR-134**: Cantidades cero, negativas, decimales, no numéricas o por encima
  del máximo DEBEN rechazarse. Un pedido sin líneas también.
- **FR-135**: El mismo producto repetido en el cuerpo DEBE consolidarse en una
  línea.
- **FR-136**: La idempotencia DEBE sostenerse en un **`UNIQUE` de la base** sobre
  `idempotency_key`, no en el orden de ejecución. Molde: `uq_tn_pedido`.
- **FR-137**: El número del pedido DEBE ser un **entero correlativo por empresa**,
  que **arranca en 1**, **sin letra ni prefijo guardado** y que **nunca se
  reinicia** —ni por año, ni por catálogo, ni por punto de venta— con
  `UNIQUE (empresa_id, numero)` (decisión 10).
- **FR-137a**: El número DEBE asignarse **dentro de la misma transacción que crea
  el pedido**, tomando el siguiente valor bajo **un candado por empresa**
  —bloqueo de la fila de la empresa o secuencia equivalente—. **NO DEBE**
  calcularse con un `SELECT MAX(numero) + 1` leído fuera de esa transacción. El
  `UNIQUE (empresa_id, numero)` es la red: ante colisión la escritura falla y se
  reintenta, y **nunca se emite un número repetido**. Dos empresas distintas
  pueden tener el pedido `#1` a la vez, y eso es correcto.
- **FR-137b**: En pantalla el número DEBE mostrarse como **`#1042`** —el numeral
  es de presentación y no se guarda— y con **el mismo formato en todas las
  superficies**: confirmación (`:398`), bandeja, panel lateral, los dos emails y
  el mensaje de WhatsApp. La letra de la maqueta (`#A-1042`) **se descarta**: los
  ocho ejemplos comparten la `A` siendo de dos catálogos distintos, así que no
  significaba nada.
- **FR-138**: La disponibilidad DEBE leerse de **`available`** del punto de venta
  del catálogo, y revalidarse al crear el pedido. Una línea agotada DEBE quitarse,
  el total recalcularse y la tienda mostrar la pantalla de «Se agotó mientras
  compraba» con la línea **tachada**, no desaparecida (`:586-624`).
- **FR-139**: Si **todas** las líneas quedan agotadas, **NO DEBE** crearse
  pedido.
- **FR-140**: **NO DEBE** existir reserva de stock, ni columna «comprometido», ni
  lock al crear el pedido. Dos pedidos simultáneos por la última unidad **se
  crean los dos**, y la spec lo dice en vez de simular una garantía que no hay.
- **FR-141**: Las opciones de entrega y de pago que ofrece el checkout DEBEN ser
  **solo** las que el catálogo tiene encendidas, y revalidarse al crear el pedido.
- **FR-142**: «Efectivo al retirar» **NO DEBE** ofrecerse con envío a domicilio
  (`:904`).
- **FR-143**: El envío DEBE ser gratis cuando el subtotal es **mayor o igual** al
  umbral. Un umbral vacío o cero significa «no hay envío gratis».
- **FR-144**: El teléfono DEBE normalizarse **en el servidor**, al guardar el
  `Customer` y el pedido, con `normalizarTelefono` de **`packages/pedido`** —el
  segundo paquete compartido del monorepo (FR-006c)—. La lógica es la que hoy
  vive en `apps/web/src/utils/pedidoWhatsapp.js:32-76`, que ya resuelve el
  formato argentino y está probada: **se muda al paquete, no se copia**. **NO
  DEBE** importarse desde `apps/web/src`: `apps/api` no puede: son dos paquetes
  de npm distintos, ninguno declara al otro, y la imagen de Docker de la API
  copia solamente `apps/api/`.
- **FR-145**: La casilla de consentimiento DEBE arrancar **desmarcada**, y **NO
  DEBE** ser condición para comprar.
- **FR-146**: El consentimiento DEBE guardarse con **qué se aceptó y cuándo**, no
  como un booleano suelto.
- **FR-147**: Los Términos y Condiciones y la Política de Privacidad **SON DE
  FAVALIO**: los redacta y los publica la plataforma, y **cada tienda DEBE
  enlazarlos en su pie** (decisión 2).
- **FR-147a**: **Mientras esos dos documentos no estén publicados, el checkout
  NO DEBE pedir el DNI ni ofrecer la casilla de marketing.** El pedido DEBE
  funcionar con **nombre, teléfono y email**. `pide_dni` y el consentimiento
  DEBEN quedar **modelados en la base pero apagados y sin exponerse**: el campo no
  se dibuja, la respuesta pública del catálogo no lo anuncia y **el servidor
  ignora el valor aunque venga en el cuerpo**. Es una **puerta**, no una nota al
  pie: la única condición para abrirla es que los dos documentos estén publicados
  y enlazados.
- **FR-148**: El N° de socio y el DNI DEBEN guardarse **declarativos, sin
  validar** (H4), y debajo del campo del N° de socio la pantalla DEBE decir
  exactamente **«Nos ayuda a identificarte cuando retirás el pedido.»**. El texto
  de la maqueta (`:295`) **NO se copia**: el precio es del catálogo y el número no
  cambia un peso (decisión 3).
- **FR-149**: De los **datos del comprador**, los campos obligatorios del checkout
  DEBEN ser **el nombre y el teléfono**, y ninguno más (decisión 5). El **email**,
  el **DNI** y el **N° de socio** DEBEN ser **opcionales aunque el catálogo los
  pida**. La **dirección**, la **localidad** y el **CP** DEBEN ser obligatorios
  **solo con envío a domicilio**.
- **FR-149b**: Además de esos datos del comprador, **el pedido DEBE llevar
  siempre forma de entrega y medio de pago**: son columnas `NOT NULL` y FR-141
  exige revalidarlas en el servidor contra lo que el catálogo tiene encendido. Un
  pedido sin ellas **NO DEBE** poder crearse. Esto **no** contradice a FR-149:
  son los **pasos 2 y 3 del checkout**, el comprador siempre elige uno de cada
  uno y el paso no se puede saltear. Se escribe porque «el pedido mínimo es
  nombre y teléfono», leído literalmente, habilitaría un pedido que no dice cómo
  se recibe ni cómo se paga, y eso **el comercio no lo puede completar por el
  comprador**. **El pedido mínimo válido es, entonces**: nombre + teléfono +
  entrega + medio de pago, más al menos una línea con stock (FR-139).
- **FR-149a**: Si el comprador no dejó email, la pantalla de confirmación **NO
  DEBE** prometer ningún email, y **no DEBE** salir ningún email al comprador.
- **FR-150**: El `Customer` DEBE crearse o actualizarse **con el `empresa_id` del
  resolvedor**, nunca con uno del cuerpo, y buscarse acotado a esa empresa.
- **FR-151**: DEBE agregarse un índice por `empresa_id` a `customers`
  (`models/Customer.js:51-52`), en la migración de esta funcionalidad (H11).
- **FR-152**: La respuesta del pedido DEBE traer **solo** número, resumen y
  enlace de WhatsApp. Ningún id interno.

#### Etapa 2 · La bandeja y el estado

- **FR-160**: DEBE existir una bandeja que liste los pedidos de la empresa, con
  filtro por estado, por catálogo **y por canal**, y un panel lateral de 520px
  con el detalle.
- **FR-160a**: `pedidos` DEBE llevar una columna **`origen`** ENUM, con **un solo
  valor por ahora: `catalogo`**, y la bandeja DEBE dibujar una columna
  **«Canal»**. Es una decisión del dueño del producto tomada **después** de
  aprobar esta spec: quiere que a futuro **todo lo que entre por la web se
  trabaje en una sola bandeja**. Se crea ahora, con un solo valor, porque
  agregarla después obliga a una **migración con backfill sobre pedidos reales** y
  a una pantalla que no sabía dibujar la columna; creada hoy, el día que entre un
  segundo canal **no hay que migrar datos ni tocar la bandeja**. DEBE haber un
  índice `(empresa_id, origen, created_at DESC)` para que filtrar por canal no
  barra la tabla cuando exista ese segundo valor.
- **FR-160b**: Los pedidos de **TiendaNube NO entran** en esta bandeja, y el
  motivo DEBE quedar escrito: `tiendanube_pedidos` **no es una bandeja**, es el
  **libro de idempotencia del webhook de stock**. No tiene comprador, ni total,
  ni estado operable, ni entrega, ni medio de pago; lo que tiene es
  `tiendanube_order_id`, `numero` y el JSONB de lo que descontó. Sus filas son
  **inmutables por diseño** —se escriben una vez, dentro de la transacción que
  descuenta— y **no se borran nunca**, porque borrar una deja que un webhook
  reintentado descuente dos veces. Las dos propiedades chocan de frente con las
  de una bandeja, donde un pedido cambia de estado seis veces y se puede
  cancelar y archivar. Unificar exige primero que un pedido de TiendaNube
  **tenga** comprador, total y estado, que es el **pendiente 12c de
  `PROXIMOS-PROYECTOS.md`** —cuyo primer paso es decidir cliente, medio de pago,
  punto de venta y numeración— y **no entra en esta spec**. Cuando eso exista, el
  camino es: filas en `pedidos` con `origen = 'tiendanube'`, `tiendanube_pedidos`
  **se queda** como libro de idempotencia —no se borra ni se fusiona— y las dos
  se relacionan por un `tiendanube_pedido_id` anulable. La columna `origen` que
  se crea ahora es lo que hace que ese día no haya que migrar nada.
- **FR-161**: Los estados del pedido DEBEN ser los seis de la maqueta:
  `pendiente_pago`, `pagado`, `en_preparacion`, `listo`, `entregado`,
  `cancelado` (`:1478-1487`).
- **FR-162**: Las transiciones permitidas DEBEN ser una **función pura**, y
  validarse contra el estado real de la base, no contra el que tenía cargado la
  pantalla.
- **FR-163**: `cancelado` DEBE ser terminal.
- **FR-164**: **«Marcar cobrado» DEBE cambiar únicamente el estado del pedido.**
  **NO DEBE** escribir en `stock`, `stock_movements`, `sales`, `sale_items` ni en
  la caja.
- **FR-165**: DEBE existir un test de integración que afirme **lo que no pasó**:
  que después de «Marcar cobrado» esas cinco tablas quedaron como estaban.
- **FR-166**: La confirmación de «Marcar cobrado» DEBE decir qué hace **y qué no
  hace**, con este texto exacto (decisión 4): **«Marcar cobrado el pedido #1042
  solo cambia su estado. El stock no baja y no se registra ninguna venta: si ya
  lo entregaste, cargalo en el punto de venta.»** El texto de la maqueta
  (`:1178`) **NO se copia**: afirma lo contrario.
- **FR-167**: La bandeja DEBE llevar un aviso visible con este texto exacto
  (decisión 4): **«Marcar un pedido como cobrado cambia su estado. Por ahora no
  descuenta stock ni registra la venta: eso se hace a mano desde el punto de
  venta.»** La descripción de la maqueta (`:1080`) **NO se copia**.
- **FR-167a**: Ese aviso DEBE ser **permanente hasta la etapa 3**: **NO DEBE**
  tener botón de cerrar, **NO DEBE** guardar preferencia de ocultamiento y DEBE
  volver a mostrarse en cada visita. Un aviso que se cierra es un aviso que se
  cierra el primer día.
- **FR-168**: El checkout de transferencia **NO DEBE** decir que el pedido queda
  reservado 24 horas (`:375`, `:1325`), y DEBE decir en su lugar: **«Después de
  transferir, mandanos el comprobante por WhatsApp.»**
- **FR-168a**: **Ningún pedido DEBE vencer solo.** **NO DEBE** existir tarea
  programada, plazo configurable ni caducidad automática de un pedido en
  `pendiente_pago`: queda hasta que el comercio lo cancele desde la bandeja
  (decisión 6). Ninguna pantalla DEBE nombrar un plazo.
- **FR-169**: Marcar cobrado dos veces —o dos veces en paralelo— DEBE dar el
  mismo resultado que una.
- **FR-170**: Un pedido de otra empresa DEBE responder 404 en el detalle y en el
  cambio de estado, y **nada DEBE** cambiar.
- **FR-171**: El detalle DEBE mostrar los precios **congelados** del pedido, no
  los actuales del catálogo.
- **FR-172**: El estado vacío de la bandeja DEBE distinguir «todavía no entró
  ninguno» de «el filtro no devolvió nada».

#### Etapa 2 · Avisos

- **FR-180**: El aviso por email DEBE usar `services/email.js` con
  `plantillaBase` (`:160`).
- **FR-181**: Un fallo del email **NO DEBE** impedir que el pedido se cree.
- **FR-182**: La pantalla de confirmación **NO DEBE** decir que se mandó un email
  si `sendEmail` devolvió `ok: false` o si el comprador no dejó email (H8).
- **FR-183**: El aviso de pedido nuevo DEBE ir a **una casilla de correo
  configurable por catálogo** —un campo más en el formulario del catálogo,
  coherente con `whatsapp_destino`— (decisión 7). **NO DEBE** avisarse a todos los
  usuarios de la empresa con `pedidos.ver`, ni usarse el email de la empresa.
- **FR-183a**: Un catálogo **sin** casilla cargada **NO DEBE** impedir que entre
  el pedido, y la pantalla del catálogo en el panel DEBE avisar que nadie va a
  enterarse por correo mientras el campo esté vacío.
- **FR-183b**: El **comprador** DEBE recibir un **email de confirmación** cuando
  dejó email, con número de pedido, detalle línea por línea con los precios
  congelados, total, forma de entrega y forma de pago. Requiere **una plantilla
  nueva de Resend**, distinta de la del comercio. La frase de la maqueta «te
  mandamos el detalle por email» (`:399`) **se queda**, y este requisito es el que
  la vuelve verdadera.
- **FR-184**: El texto del pedido DEBE armarse con `armarTextoPedido` de
  **`packages/pedido`** (FR-006c) —la lógica que hoy vive en
  `apps/web/src/utils/pedidoWhatsapp.js:88-138`, **mudada, no copiada**—, y el
  número de destino DEBE salir del catálogo (`whatsapp_destino`). El
  `whatsapp_url` lo arma **el servidor** y viaja en la respuesta del pedido
  (FR-152): el texto lleva los nombres y los precios **congelados**, que el
  servidor tiene y la tienda no. `apps/tienda` **tampoco** puede importar de
  `apps/web/src`, así que **NO DEBE** apuntarse a esa ruta desde ninguna de las
  dos apps.
- **FR-184a**: `enviarPedidoPorWhatsapp` (`pedidoWhatsapp.js:148-159`) **NO se
  muda** al paquete: toca `window`, así que no es pura y no puede correr en el
  servidor. Se queda en `apps/web`, y `apps/tienda` escribe la suya —abrir
  `wa.me` con el `whatsapp_url` que ya vino armado— que son tres líneas y no
  duplican ninguna regla.
- **FR-185**: Que el WhatsApp no se mande **NO DEBE** afectar al pedido, que ya
  existe en la base (decisión 2 del plan).

#### Permisos, módulo y guardias de la web

- **FR-190**: DEBEN agregarse cuatro permisos a `seedPermissions.js`:
  `catalogo.ver`, `catalogo.editar`, `pedidos.ver`, `pedidos.gestionar`, con el
  formato de los 50 existentes (`:6-80`). **NO DEBEN** reusarse `config.ver` /
  `config.editar`.
- **FR-191**: El reparto en `ROLE_PERMISOS` (`:82-119`) DEBE ser (decisión 8):
  **`admin`** los cuatro —por el catálogo entero de `:83`—; **`gerente`** los
  cuatro; **`vendedor`** solo `pedidos.ver` y `pedidos.gestionar`, y **ninguno de
  `catalogo.*`**; **`produccion`** y **`compras`**, ninguno.
- **FR-192**: Cada endpoint privado DEBE llevar su `checkPermission`, verificado
  por `permisosDeRutas.test.js:674-693`.
- **FR-193**: El gate de módulo DEBE estar **en los tres lados**: barra lateral,
  `RouteGuard` y **API**. Hoy `enabled_modules` no gatea nada en el servidor
  (H3), y si el módulo va a significar algo tiene que significarlo en los tres.
- **FR-194**: Las dos rutas nuevas DEBEN entrar en `components/navegacion.js`, en
  un grupo **«Venta online»**, con `alcance: 'empresa'` para que el selector de
  sucursal no se dibuje donde no hace nada.
- **FR-195**: Las dos pantallas nuevas DEBEN entrar en `PANTALLA_DE_LA_RUTA` y
  `PANTALLAS` de `guardiasDeSrc.test.js` (`:598-612`, `:702-714`), en `NOMBRES` de
  `guardiasDeDiseno.test.js:171-215` con su `toHaveLength` actualizado (`:473`), y
  en `CON_MARCO` de `marcoDeLasPantallas.navegador.js:56-61`, que pasa de
  dieciocho rutas a veinte.
- **FR-196**: Las pantallas nuevas **NO DEBEN** tener hexadecimales, `dark:`,
  clases de la paleta de Tailwind ni componentes `Table*`; encabezado y filas de
  cada tabla comparten **el mismo string** de `grid-template-columns`.

#### Visitas

- **FR-200**: DEBE contarse una visita por apertura del catálogo público,
  **agregada por día, por catálogo, por origen y por el estado que tenía el
  catálogo en ese momento**, con `INSERT … ON CONFLICT DO UPDATE` sobre esas
  **cuatro** columnas. Una fila por día y por estado, no una por visita.
- **FR-200a**: La fila DEBE guardar **`estado_catalogo`**: el estado que tenía el
  catálogo cuando entró la visita. Sin esa columna, US20 escenario 7 —distinguir
  las visitas que ocurrieron con el catálogo pausado, para que la conversión en
  cero no se lea como un problema de la tienda— **no se puede cumplir**, porque
  cuando alguien mire la pestaña el catálogo ya va a estar en otro estado y el
  dato no se puede reconstruir. La clave única de `catalogo_visitas` es, por eso,
  de **cuatro** columnas.
- **FR-201**: El conteo **NO DEBE** guardar IP, cookie ni identificador de
  dispositivo. `estado_catalogo` no rompe este requisito: es un dato **del
  catálogo**, no del visitante.
- **FR-202**: La pestaña DEBE decir **«Visitas»**, no «Escaneos»: el servidor no
  puede distinguir un escaneo de un enlace compartido (H7). El desglose por origen
  se presenta como aproximación.
- **FR-203**: La conversión DEBE ser pedidos sobre visitas del mismo período, y
  con cero visitas DEBE mostrar un guion, no `NaN` ni `0 %`.

#### Migraciones y esquema

- **FR-210**: Cada cambio de esquema DEBE ir en **su propia migración**, con el
  formato de `apps/api/src/migrations/` (`module.exports = { up, down }`, nombre
  `YYYYMMDD-descripcion-en-kebab-case.js`).
- **FR-211**: Los índices declarados en los modelos DEBEN tener el **mismo
  `name`** que los de la migración, o `scripts/verificar-esquema.js` los reporta
  como faltantes.
- **FR-212**: Cada modelo nuevo DEBE exportarse desde `models/index.js`, o
  `verificar-esquema.js` no lo mira (`:278-344`).
- **FR-213**: Si se declaran asociaciones con `empresa_id`, el ancla de conteo de
  `aislamientoEmpresas.test.js:1136` DEBE actualizarse **con el motivo escrito al
  lado**, nunca rodearse. Es la trampa que `models/index.js:39-48` ya documenta.
- **FR-214**: El job «API — la imagen arranca y migra» del CI DEBE seguir pasando.

---
### Key Entities

El plan trae un borrador de columnas. Acá va **refinado**, con los cambios
marcados y su motivo. El detalle final —tipos exactos, nombres de índice— es
trabajo de `sdd-plan` y de `data-model.md`.

#### Tablas nuevas

| Entidad | Campos que importan, y qué cambia respecto del borrador del plan |
|---|---|
| **`catalogos`** | `id`, `empresa_id` NOT NULL, `punto_de_venta_id` NOT NULL FK, `slug` UNIQUE **global**, `nombre_visible`, `descripcion`, `logo_url`, `portada_url`, `color_marca` STRING(7), `whatsapp_destino`, `datos_transferencia` JSONB (titular, cbu, alias, banco), `retiro_socio` + `retiro_socio_direccion`, `retiro_local`, `envio` + `envio_costo` + `envio_gratis_desde` NULL, `coordinar_whatsapp`, `pide_nro_socio`, `pide_dni`, `mp_habilitado`, `estado` ENUM(`borrador`,`publicado`,`pausado`), `publicado_en`. **Se agrega `mostrar_precio_lista` BOOL, DEFAULT `false`** (FR-061, no estaba en el borrador). **Se agrega `email_avisos` STRING NULL** (FR-183: la casilla que recibe el aviso de pedido nuevo). **`incluye_todos` NO se crea**: con selección explícita (decisión 9) no tiene nada que decir. **`pide_dni` se crea pero queda apagado y sin exponerse** hasta que existan los documentos de FR-147a. **`mp_habilitado` se conserva pero queda siempre en `false`**: la pasarela es etapa 3 |
| **`catalogo_productos`** | `catalogo_id`, `product_id`, `orden` INT, UNIQUE `(catalogo_id, product_id)`. Es una **lista de inclusión**: estar en la tabla **es** estar en el catálogo (decisión 9). **`visible BOOL` no se crea**: sería una tercera bandera además de `publicable` e `is_active` para decir lo mismo que decir que la fila no exista |
| **`catalogo_reglas_precio`** | `id`, `empresa_id`, `catalogo_id`, `ambito` ENUM, `tipo` ENUM, `valor` DECIMAL(12,2), `activo`. **`ambito_valor STRING(100)` se reemplaza por tres columnas anulables**: `categoria` STRING(50), `brand_id` FK, `product_id` FK, con un CHECK que exige exactamente la que corresponde al ámbito. Motivo: una columna polimórfica que guarda «texto de categoría o `brand_id` o `product_id`» **no puede tener FK**, así que borrar una marca deja una regla apuntando a un número que ya no existe, y el `ON DELETE CASCADE` de FR-083 no se puede escribir. El índice único pasa a ser uno por ámbito |
| **`pedidos`** | `id` UUID, `empresa_id`, `catalogo_id`, `punto_de_venta_id`, **`numero` INT correlativo por empresa desde 1, sin letra ni prefijo guardado** (decisión 10), con UNIQUE `(empresa_id, numero)`, `estado` ENUM de seis valores, `comprador_nombre`, `comprador_telefono`, `comprador_email`, `comprador_dni`, `comprador_nro_socio`, `customer_id` FK NULL, `acepta_comunicaciones` BOOL, `entrega` ENUM, `envio_direccion`, `envio_localidad`, `envio_cp`, `subtotal`, `envio_costo`, `total`, `medio_pago` ENUM, `notas`, `idempotency_key` UNIQUE. **`entrega` y `medio_pago` son ENUM `NOT NULL`**: son los pasos 2 y 3 del checkout y un pedido no puede existir sin ellos (FR-149b). **Se agrega `origen` ENUM con un único valor por ahora, `catalogo`**, más el índice `(empresa_id, origen, created_at DESC)` (FR-160a): es lo que hace que el día que entre un segundo canal por la web no haya que migrar datos ni tocar la bandeja. **Se agrega `consentimiento_en` TIMESTAMP NULL** (FR-146: un booleano no dice cuándo). **`comprador_dni` y `acepta_comunicaciones` se crean pero quedan sin escribirse** hasta que se abra la puerta de FR-147a: la columna existe, el checkout no la llena. **`sale_id` se conserva, siempre NULL en estas etapas**, y la columna existe para que la etapa 3 no tenga que migrar. **`mp_preference_id`, `mp_payment_id`, `mp_estado` NO se crean todavía**: son de la etapa 3 y una columna que nadie escribe es una columna que nadie sabe si funciona |
| **`pedido_items`** | `id`, `pedido_id`, `product_id`, `nombre`, `precio_unitario`, `cantidad`, `subtotal` — **todo congelado**. Se agrega **`precio_lista`** y **`regla_id` NULL**: sin eso no se puede contestar «¿por qué este pedido salió a este precio?» seis meses después, que es la pregunta que un descuento mal puesto genera |
| **`catalogo_visitas`** | `catalogo_id`, `fecha` DATE, `origen` STRING(20), **`estado_catalogo`** —el estado que tenía el catálogo cuando entró la visita—, `cantidad` INT, UNIQUE **`(catalogo_id, fecha, origen, estado_catalogo)`**. **Nueva, no estaba en el plan.** Sin IP y sin cookie (FR-201). **La clave son cuatro columnas y no tres**, y esto lo corrigió el diseño técnico: con `(catalogo_id, fecha, origen)` la fila **no guarda el estado del catálogo en el momento de la visita**, así que US20 escenario 7 —«la pestaña distingue las visitas que ocurrieron con el catálogo pausado»— **no se puede contestar**: cuando alguien mire la pestaña, el catálogo ya va a estar en otro estado. Sigue siendo una fila por día, por catálogo, por origen y por estado —a lo sumo tres veces más filas que la versión de tres columnas, y en la práctica una, porque un catálogo no cambia de estado todos los días— |

#### Tablas existentes que cambian

| Tabla | Cambio |
|---|---|
| `products` | **`publicable` BOOLEAN NOT NULL DEFAULT `false`** (FR-040) |
| `customers` | **índice por `empresa_id`** (FR-151, H11) |

#### Tablas que **no** se crean en esta spec

| Tabla | Por qué |
|---|---|
| `empresa_mercadopago` | Es la etapa 3 entera: OAuth, token cifrado, `marketplace_fee_pct` |
| Cualquier tabla de reserva de stock | Es la etapa 4, y arregla los cinco escritores que hoy pisan `available` en el mismo cambio |
| Ninguna tabla que **unifique** `pedidos` con `tiendanube_pedidos` | `tiendanube_pedidos` es el **libro de idempotencia** del webhook de stock, con filas inmutables y que no se borran nunca, y sin comprador, total ni estado. Unificar exige primero el **pendiente 12c de `PROXIMOS-PROYECTOS.md`**. Lo único que esta spec hace por ese futuro es crear `pedidos.origen` (FR-160a, FR-160b, decisión 13) |
| Tabla de categorías | `products.category` sigue siendo texto libre. Normalizarla es un proyecto propio y esta funcionalidad **no lo empieza** |

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. **El precio de venta se calcula en un solo lugar del repositorio —
   `packages/precios`—**, y el punto de venta y el catálogo devuelven el mismo
   número para el mismo producto. Verificable contra hoy, donde el servidor no
   sabe calcular ningún precio y el monorepo no tiene workspaces.
2. Los **21 casos** de `precios.test.js` siguen pasando después de la mudanza
   **sin que se toque ninguna aserción**, incluidos el recargo del 100 % y el
   descuento del 100 %. Son 21 contados sobre el archivo, y que pasen sin
   cambios es lo que prueba que la mudanza no cambió ningún resultado.
2a. **El teléfono se normaliza y el texto del pedido se arma en un solo lugar del
   repositorio — `packages/pedido`—**, consumido por `apps/api` y `apps/tienda`,
   y **ninguna de las dos importa de `apps/web/src`**. Verificable contra el
   borrador de esta spec, que pedía reusar un archivo que ninguna de las dos
   podía importar.
3. Se sube la foto de un producto, se ve en el catálogo redimensionada y
   servida por Caddy, y **está adentro del respaldo**. Verificable contra hoy,
   donde `deploy/respaldo.sh:42` solo vuelca Postgres.
4. Una restauración del respaldo en una máquina limpia devuelve las fotos, y el
   procedimiento está escrito en `OPERACION.md`.
5. Después de la migración, **los 431 productos quedan en `publicable = false`**:
   crear un catálogo no publica nada que nadie eligió.
6. **El catálogo de la empresa B da 404 desde el enlace de la A**, y ningún dato
   de A aparece en ninguna respuesta de B. Verificado con dos empresas contra
   Postgres.
7. **Ninguna respuesta pública contiene `cost`, `margin_override`,
   `wholesale_*`, `supplier_id` ni un `empresa_id`**, y hay una guardia estática
   que falla si aparecen. La guardia **dio al menos un hallazgo la primera vez que
   se corrió**.
8. Un slug en borrador y un slug inexistente devuelven **la misma** respuesta:
   quien prueba direcciones no puede distinguirlos.
9. Un catálogo pausado muestra la pantalla de pausa con su marca, y **no**
   devuelve productos ni precios.
10. Un producto con costo $0 **no sale al catálogo**, y el panel dice cuántos son
    y cuáles. Verificable contra los 376 productos a $0 del relevamiento.
11. Un producto alcanzado por cuatro reglas termina con **una sola**, y la
    previsualización nombra la que gana y tacha las tres pisadas.
12. La tabla de reglas dice «gana en N de M» por regla, y los números coinciden
    con los precios que muestra la previsualización.
13. Una regla sobre un producto de otra empresa responde 404 y **no deja
    ninguna fila**.
14. Dos reglas del mismo ámbito y objetivo chocan contra un índice de la base, y
    el mensaje nombra la que ya estaba.
15. Una empresa con la suscripción vencida **no vende por su catálogo**.
    Verificable contra hoy, donde `checkSubscription` no correría en un router
    público.
16. El tráfico del catálogo **no provoca un 429 en el punto de venta del
    comercio**: el prefijo público está **eximido del limitador global** y tiene
    el suyo por IP y slug, hay una guardia que **ata las dos líneas**, y el
    número de llamadas por visita está medido y escrito.
17. La tienda entra a **390px** sin desbordar el `<body>` en catálogo, ficha,
    carrito y los tres pasos del checkout, medido en navegador.
18. **Los seis estados de la maqueta existen y son distinguibles entre sí**, cada
    uno con su propia salida.
19. Un pedido con un precio en el cuerpo se crea igual, **con el precio del
    servidor**, y el del cuerpo se descarta.
20. Un pedido con un `product_id` de otra empresa **no crea ninguna fila**: ni el
    pedido ni sus líneas.
21. El mismo pedido mandado **dos veces en paralelo** crea uno solo, y lo
    garantiza el `UNIQUE` de la base.
22. Dos pedidos simultáneos de la misma empresa **no comparten número**.
23. Un producto agotado entre el carrito y el envío deja el pedido con la línea
    quitada, el total recalculado y la línea **tachada** en la pantalla.
24. **«Marcar cobrado» no escribe en `stock`, `stock_movements`, `sales`,
    `sale_items` ni en la caja**, y hay un test que lo afirma mirando las cinco
    tablas.
24a. **La bandeja dibuja la columna «Canal»** y `pedidos.origen` existe con su
    único valor `catalogo`, así que el día que entre un segundo canal por la web
    **no hay migración con backfill ni cambio de pantalla**. Los pedidos de
    TiendaNube **no aparecen** en esta bandeja, y el motivo está escrito
    (decisión 13).
25. **Ningún texto de la interfaz afirma que el pedido descuenta stock o registra
    venta**, y la bandeja lo advierte de forma visible y permanente.
26. **Ningún texto afirma que el pedido queda reservado**, porque no hay reserva.
27. La casilla de consentimiento arranca desmarcada, no marcarla **no impide
    comprar**, y sin marcarla no queda nada guardado para marketing.
28. La pantalla de confirmación **no dice que mandó un email** cuando no lo
    mandó.
29. Un rol con `pedidos.ver` y sin `config.ver` entra a Pedidos y no a
    Configuración. Verificable contra TiendaNube, que hoy exige `config.*`.
30. El catálogo no se indexa —`noindex` más `X-Robots-Tag` más `robots.txt`— y el
    enlace pegado en un mensajero muestra el nombre, la descripción y la portada
    **del catálogo**, no de Favalio.
30a. **El HTML de `/c/:slug` se lo pide la API al servicio `tienda` por la red
    interna**, con `timeout` y caché de 60 segundos, y el marcador
    `<!--FAVALIO_META-->` es lo que se reemplaza. Sin marcador, la página sale
    **sin** metadatos y queda registrado; con el servicio caído, sale **503** con
    una página propia. Verificable contra el borrador de esta spec, que no decía
    de dónde salía el HTML y daba por sentado un disco compartido que no existe.
31. La pestaña del QR muestra **visitas** —no «escaneos»—, pedidos y conversión,
    y con cero visitas muestra un guion.
31a. **La pestaña distingue las visitas que ocurrieron con el catálogo pausado**,
    porque la fila de `catalogo_visitas` guarda `estado_catalogo` y la clave
    única es de cuatro columnas. Verificable contra el borrador de esta spec,
    cuya clave de tres columnas no podía contestarlo.
32. Las dos pantallas nuevas están en las cuatro listas de guardias de `apps/web`
    y no tienen hexadecimales, `dark:`, `Table*` ni clases de la paleta.
33. `npm run test:api`, `npm run test:web`,
    `npm --prefix apps/api run test:integracion` y `npm run build` pasan, y las
    guardias de aislamiento, observabilidad, permisos de rutas, montaje de routers
    y diseño siguen limpias.
34. **Todos los jobs del CI pasan con el monorepo en workspaces**, y ni `apps/web`
    ni `apps/api` tienen una copia de la fórmula de precios: hay una guardia
    estática que falla si vuelve a aparecer.
35. **Un producto publicable nuevo no aparece en ningún catálogo** hasta que
    alguien lo agrega, y una importación de CSV no cambia ningún catálogo.
    Verificable contra el borrador del plan, que traía `incluye_todos`.
36. **Los números de pedido de una empresa son 1, 2, 3…**, se ven como `#1042` en
    las seis superficies, y dos pedidos simultáneos nunca reciben el mismo, con
    `UNIQUE (empresa_id, numero)` de red.
37. **El checkout publicado no pide DNI ni ofrece la casilla de marketing**
    mientras los documentos de Favalio no existan, y mandarlos en el cuerpo no
    los guarda.
38. **Un comprador que dejó email recibe su email de confirmación**, y el comercio
    recibe el aviso **en la casilla del catálogo** y en ninguna otra.
39. **El enlace viejo de un slug cambiado da 404**, la pantalla lo avisó antes de
    guardar, y **borrar un catálogo con pedidos se rechaza** ofreciendo pausarlo.
40. **Ante un error al consultar la suscripción, el catálogo público cierra**
    —503, sin productos y sin pedidos— mientras la cadena privada sigue dejando
    pasar. Las dos mitades tienen su test.
41. **Cada criterio de aceptación tiene al menos un test que falla si se revierte
    el cambio que lo implementa**, comprobado revirtiendo.

---

## Fuera de alcance

Explícito, para que no se discuta después si estaba incluido.

### Lo que queda para la etapa 3

- **Mercado Pago Marketplace**: OAuth de onboarding, preferencia de pago,
  webhook con firma, `marketplace_fee`, y la tabla `empresa_mercadopago`. El
  checkout ofrece transferencia y efectivo; **Mercado Pago no se ofrece**, y el
  interruptor del panel queda apagado y explicado.
- **La creación de la `Sale` y el descuento de stock al marcar cobrado.** Acá
  «Marcar cobrado» **solo cambia el estado**. La regla del plan es «si toca stock,
  tiene que generar venta; si no genera venta, no toca stock», y las dos mitades
  van juntas: partirlas deja el inventario mintiendo o la caja sin respaldo.
- **Agregar `mp` a `mediosDePago.js` y a los segmentos de los reportes.**
  `Sale.payment_method` es `STRING(20)` sin validación (`models/Sale.js:38-42`):
  un código nuevo ensucia los reportes en silencio. Entra con la pasarela, no
  antes.
- **La pantalla de «pago rechazado»** existe como estado dibujado, pero **sin el
  camino de Mercado Pago detrás**: no hay pago que rechazar todavía.

### Lo que queda para la etapa 4

- **Reserva de stock** («comprometido»). Y no es solo una columna: cinco caminos
  existentes la borrarían asignando `available = quantity`
  (`productionService.js:357` y `:380`, `import.js:438`, `products.js:344` y
  `:350`, `general.js:265` y `:271`). **Los cinco se arreglan en el mismo commit
  que la reserva**, o la reserva dura hasta la primera importación.
- **El padrón de socios del gimnasio.** El N° de socio se pide y se guarda
  **declarativo, sin validar contra nada**; el DNI ni siquiera se pide hasta que
  se abra la puerta de FR-147a.
- **Mínimo de compra, destacados, horarios de atención y cupones.** Decisión 12
  del plan.

### Lo que no entra en ninguna de estas etapas

- **El subdominio por empresa con certificado comodín.** La maqueta escribe
  `comprafit.favalio.com/c/...` (`:746`, `:1026`); esta spec usa
  `tienda.favalio.com/c/<slug>`. Un comodín exige el desafío DNS con un token de
  la API de Hostinger, un registro `A` comodín y un plugin en la imagen de Caddy.
  **El slug ya es único global**, así que mudarse después es un cambio de DNS y de
  Caddyfile, no de datos.
- **Duplicar un catálogo.** Copia profunda de reglas y de selección, más un slug
  nuevo. Con un catálogo real no ahorra nada y una copia a medias publica precios
  equivocados. **El botón no se dibuja.**
- **Tabla de alias de slug y redirección del slug viejo.** El slug viejo muere
  (decisión 11): un alias exige decidir por cuánto tiempo vive y sigue ocupando el
  espacio de nombres global.
- **Vencimiento automático de pedidos.** Nada vence solo (decisión 6): sin reserva
  de stock, un plazo no guarda nada. Ni tarea programada, ni columna de
  caducidad.
- **`catalogos.incluye_todos` y cualquier forma de «todos los publicables menos
  excepciones».** Gana la selección explícita (decisión 9); la columna del
  borrador del plan no se crea.
- **Exportar pedidos.** Hay molde (`utils/exportVentas.js`) y no hay pregunta que
  contestar todavía. **El botón no se dibuja.**
- **Cerrar el precio unitario que `POST /api/sales` acepta del cliente**
  (`routes/sales.js:311-630`, H12). Mover el cálculo al servidor deja el camino
  abierto, pero hacerlo acá significa tocar el punto de venta —el camino más
  caliente del sistema— en una funcionalidad que no es del punto de venta. Queda
  anotado.
- **Normalizar `products.category` a una tabla**, y normalizar las marcas
  (`Nutremax`/`NUTREMAX`, `Gold Nutrition`/`Gold Nutricion`). El catálogo trabaja
  con lo que hay.
- **Cuota de espacio de imágenes por empresa.** El volumen se comparte; que se
  llene devuelve un mensaje legible y queda registrado.
- **Miniaturas múltiples, `srcset`, WebP negociado, CDN.** Una medida por uso.
- **Varias fotos por producto.** `products.image_url` es una sola.
- **Borrado de datos personales a pedido del comprador.** Es un procedimiento y
  una pantalla, y depende de que Favalio publique la Política de Privacidad
  (decisión 2).
- **Analítica de terceros** —Google Analytics, píxeles, mapas de calor—. Contar
  visitas del lado del servidor es lo que entra; rastrear no.
- **Buscador con tolerancia a errores de tipeo.** La maqueta dibuja «No
  encontramos "creatnia"» y ofrece la categoría más parecida (`:530-534`), que es
  una sugerencia por categoría, no una búsqueda difusa.
- **Traducciones.** La tienda es en castellano.
- **Migrar los datos de Comprafit.** Sigue bloqueada por el acceso al hosting
  viejo (`PLAN-COMPRAFIT.md:325-343`), y el primer paso cuando se destrabe es
  **rotar la contraseña de la base y el token**, que están en el historial de git.
- **Publicar el QR.** El desarrollo arranca; la publicación no. Ver
  «Dependencias».

---

## Dependencias

Cosas que **no dependen de esta spec** y sin las cuales no se puede publicar.
Separadas de «Fuera de alcance» a propósito: aquello son cosas que decidimos no
hacer; esto son cosas que hay que hacer y no las hace esta funcionalidad.

| Dependencia | Estado hoy | Bloquea |
|---|---|---|
| **Términos y Condiciones y Política de Privacidad, redactados y publicados por Favalio** | **No existen.** Anotado en `ANALISIS.md:345`, `AUDITORIA-SUSCRIPCIONES.md:147`, `PLAN-COMPRAFIT.md:351` y `PROXIMOS-PROYECTOS.md:367` | **Pedir el DNI y ofrecer la casilla de marketing** — nada más. El checkout se publica igual con nombre, teléfono y email (decisión 2, FR-147a). **No bloquea el desarrollo ni la publicación del catálogo.** Sí bloquea la etapa 3: son requisito de cualquier pasarela |
| **Registro DNS `tienda.favalio.com`** | No existe. `favalio.com` está comprado y apuntado | Que el QR lleve a algún lado. Es un registro `A` a la misma IP más un bloque de tres líneas en `deploy/Caddyfile` |
| **`ALLOWED_ORIGINS` con `https://tienda.${DOMINIO}`** | No está (`docker-compose.produccion.yml:89`) | Que el navegador deje hablar a la tienda con la API. Sin esto **falla en silencio**, del lado del navegador |
| **El cron de `deploy/respaldo.sh` corriendo, y una restauración probada** | El script existe; que el cron esté puesto **no lo verifica nada**, y la copia queda en el mismo disco que la base (`:22-23`) | **Que entre un pedido con plata real.** Es la advertencia del plan, y ahora además hay un volumen de imágenes que perder |
| **Datos cargados y revisados** | 431 productos: 96 % sin marca, ninguno con foto, ninguno con descripción, **376 con costo $0** | **Pegar el QR.** Un producto sin foto y a $0 en una página pública es peor que no tener página. FR-076 impide que salgan, lo que significa que hoy el catálogo saldría casi vacío |
| **Acceso al hosting viejo de Comprafit** | Bloqueado (`PLAN-COMPRAFIT.md:325-343`) | La migración real. El primer paso al destrabarse es **rotar la contraseña de la base y el token**, que están en el historial de git |
| **Medir el consumo de RAM del sexto contenedor** | El VPS es de 4 GB con swap y «ya está justito» | Nada, pero se mide al agregarlo |
| **El servicio `tienda` alcanzable desde la API por la red interna del compose** | No existe: hoy no hay servicio `tienda`, y `apps/api` y `apps/tienda` van a ser **dos imágenes distintas** | **Que `/c/:slug` sirva metadatos por catálogo.** El handler no puede leer el `index.html` del disco y se lo pide al servicio por la red interna (FR-117c). Es **infraestructura que hay que presupuestar**, no plomería: una llamada entre servicios con `timeout`, una caché de 60 segundos y un modo de falla propio —con el contenedor de la tienda caído, `/c/:slug` responde 503 aunque el bundle esté en el caché del navegador de todo el mundo—, más el marcador `<!--FAVALIO_META-->` en el HTML de la tienda, que nadie puede borrar sin que la previsualización deje de tener metadatos |

---
## Assumptions

Lo que se da por cierto sin haberlo preguntado, porque el pedido, el plan o el
código ya lo fijan. **Si alguno es falso, cambia la funcionalidad.**

1. **Las trece decisiones del plan están tomadas y no se reabren**
   (`PLAN-CATALOGO-PUBLICO.md`, «Las trece decisiones tomadas»). Esta spec las
   aplica; no las discute.
2. **La dirección es `tienda.favalio.com/c/<slug>`**, un solo nombre para todas
   las empresas. La maqueta escribe `comprafit.favalio.com/c/...` (`:746`,
   `:1026`) y **esa parte de la maqueta no se sigue**: el subdominio por empresa
   exige certificado comodín y desafío DNS con token de Hostinger. El slug ya es
   único global, así que mudarse después es DNS y Caddyfile, no datos.
3. **El slug es único global, no por empresa**, porque la URL es global (supuesto
   del plan).
4. **Las reglas de precio no se acumulan** y gana la más específica (supuesto del
   plan). Es predecible; acumular no lo es.
5. **El precio se congela en la línea del pedido al crearlo** (supuesto del plan).
6. **Transferencia y efectivo no crean la venta solos** (supuesto del plan). En
   estas etapas **no la crea nadie**.
7. **La suscripción vencida corta el catálogo público** (supuesto del plan), y se
   verifica dentro del handler porque `checkSubscription` no corre en un router
   sin cadena de auth.
8. **El sistema viejo no tiene nada de esto.** Verificado en
   `legacy/index-legacy.html`: «tienda» es sucursal física (`:3011`) y «carrito»
   es el ticket del POS. **No hay un «cómo lo resolvían antes» que consultar.**
9. **La maqueta es la fuente de verdad de la interfaz**, salvo en los **seis**
   puntos donde afirma algo que el sistema no hace, no hará, o que no significa
   nada: la dirección (supuesto 2), el descuento de stock (`:1080`, `:1178`), la
   reserva de 24 horas (`:375`, `:1325`), el precio de socio (`:295`), **la letra
   del número de pedido** (`#A-1042`, descartada por la decisión 10 porque los
   ocho ejemplos comparten la `A` siendo de dos catálogos distintos) y **el
   interruptor de precio de lista encendido** (`:1246`, que arranca apagado por la
   decisión 8). **Que la maqueta lo diga no es evidencia de que el sistema lo
   haga** — es la misma advertencia que la spec 014 dejó escrita sobre el material
   fiscal.
10. **El precio publicado es el mismo que se cobra en el mostrador**: final, en
    pesos, con IVA incluido. `calcularPrecios` no separa impuestos y el POS cobra
    ese número. Publicar un precio a consumidor final sin IVA sería otra
    funcionalidad **y sería ilegal**.
11. **El módulo se libera con `enabled_modules`, como `tiendanube`** — pero eso
    hoy **solo gatea el navegador** (H3), y por eso FR-193 pide cerrarlo en la
    API. El catálogo público no tiene navegador que gatear: ahí lo que corta es el
    estado del catálogo y la suscripción.
12. **Comprafit es la única empresa con el módulo liberado**, y **el aislamiento
    se prueba igual con dos empresas** desde el día uno (decisión 1 del plan). Que
    hoy haya un solo cliente no es una garantía: es la razón por la que un error
    de aislamiento pasaría desapercibido.
13. **`apps/tienda` no comparte nada de `apps/web`**: ni el sistema de diseño
    —declara mínimo 1280px y su marca es la de Favalio—, ni Auth0, ni el cliente
    HTTP con sus interceptores (`services/api.js:150-167`, `:258`). Comparte el
    monorepo y nada más, y por eso **todo lo que sea una regla lo resuelve el
    servidor** (H2).
14. **El carrito vive en el navegador del comprador** y no se guarda en el
    servidor. Cerrar la pestaña pierde el carrito, y eso es aceptable en la v1.
15. **El pedido no requiere que el comprador tenga cuenta.** No hay registro, no
    hay login, no hay «mis pedidos». El número del pedido es lo único que tiene.
16. **`services/email.js` no se toca.** Ya devuelve `ok: false` cuando no envía y
    tiene su test (`observabilidad.test.js:125-144`). Lo que falta está del lado de
    la pantalla que lo afirma (H8).
17. **La lógica de `utils/pedidoWhatsapp.js` no se reescribe, pero sí se muda.**
    La normalización del teléfono argentino (`:32-76`) y el armado del texto
    (`:88-138`) ya están escritos y probados; se **mudan a `packages/pedido`** y
    se reusan desde ahí. **El supuesto de que se podían reusar en el lugar donde
    están era falso** y el diseño técnico lo corrigió: las dos las necesita el
    **servidor** —el teléfono se normaliza al guardar, el `whatsapp_url` viaja en
    la respuesta (FR-152)— y **`apps/api` no puede importar de `apps/web/src`**;
    `apps/tienda` tampoco. Ver FR-006c, FR-144 y FR-184.
    `enviarPedidoPorWhatsapp` (`:148-159`) **no se muda**: toca `window`.
18. **`qrcode` ya está instalado** y genera el QR en el navegador
    (`printInvoice.js:1,48-75`). No hace falta un endpoint.
19. **El QR se imprime una vez y vive en una pared.** Por eso el slug es una
    decisión con consecuencias físicas, y por eso cambiarlo avisa antes.
20. **El respaldo de imágenes se hace en el mismo cambio que crea el volumen.**
    No es una tarea posterior: un volumen sin respaldo entre un deploy y el
    siguiente es exactamente el intervalo en el que se pierde un disco.
21. **`Sale`, `SaleItem`, `Stock`, `StockMovement` y la caja no se tocan en
    ninguna de estas tres etapas.** Es la garantía que hace revertible todo lo
    demás.
22. **`mostrar_precio_lista` arranca apagado.** Es el único punto de las doce
    decisiones que **no se preguntó**: es la propuesta de la spec, apartándose de
    la maqueta, que lo trae encendido (`:1246`). El motivo es que el default
    seguro es no publicar el margen, y encenderlo tiene que ser una decisión
    consciente del comercio. **Es revisable**: si el dueño del producto lo
    revierte, el cambio es el valor por defecto de una columna y no arrastra nada
    más.
23. **Las fotos de producto son públicas por URL, y eso se acepta.** Son fotos de
    catálogo pensadas para una página pública, no documentos, y Caddy las sirve
    del volumen sin consultar permisos. Lo que **no** se acepta es que la URL sea
    adivinable: el nombre del archivo es aleatorio (FR-026), para que nadie pueda
    recorrer el catálogo entero de todas las empresas incrementando un número.

---

## Decisiones de la revisión

El dueño del producto revisó esta spec y **cerró los doce puntos abiertos**. Lo
que sigue es la decisión de cada uno, con el motivo. **Ninguna queda a criterio
de quien implemente**, y cada decisión ya está bajada al criterio de aceptación y
al requisito que la usan.

**Y hay una decimotercera, tomada después**: `pedidos.origen` y la columna
«Canal» (decisión 13). No estaba entre los doce puntos abiertos porque nació
después de aprobar la spec.

Las trece, en una línea cada una:

| # | Qué se decidió |
|---|---|
| 1 | El cálculo de precios vive en **`packages/precios`**, un paquete compartido con workspaces de npm |
| 2 | Términos y Política de Privacidad **son de Favalio**; hasta que existan, el checkout **no pide DNI ni ofrece marketing** |
| 3 | El texto del N° de socio **se corrige**: «Nos ayuda a identificarte cuando retirás el pedido.» |
| 4 | Los tres textos de reemplazo **se aprueban tal cual**, y el aviso de la bandeja es **permanente** |
| 5 | Obligatorios: **nombre y teléfono**; email, DNI y N° de socio opcionales; dirección solo con envío |
| 6 | Se **recorta a lo que hay y se avisa**; **nada vence solo**: cancela el comercio |
| 7 | Aviso a una **casilla configurable por catálogo**, y el comprador **sí** recibe email de confirmación |
| 8 | `gerente` los cuatro; `vendedor` los dos de pedidos; `produccion` y `compras` ninguno |
| 9 | **Selección explícita**: `incluye_todos` **desaparece** y `visible` no se agrega |
| 10 | Número **correlativo por empresa**, desde 1, **sin letra**, nunca se reinicia |
| 11 | El **slug viejo muere**, con aviso antes de guardar; un catálogo con pedidos **no se borra** |
| 12 | Un **handler de la API** sirve el HTML de `/c/:slug` con las etiquetas Open Graph puestas — **pidiéndoselo al servicio `tienda` por la red interna**, ver la corrección 2 |
| 13 | **`pedidos.origen` y la columna «Canal»**: una sola bandeja para lo que entra por la web **a futuro**, y **dos pantallas honestas** hoy — TiendaNube no se unifica hasta el pendiente 12c. **Tomada después de aprobar la spec** |

---

### Decisión 1 · El cálculo de precios vive en `packages/precios`

**Se elige el paquete compartido con workspaces de npm.** El monorepo hoy no
tiene workspaces (`package.json:10-24` orquesta con `npm --prefix`), así que la
decisión **cambia la forma del monorepo**: el `package.json` raíz, los
`package.json` de las cuatro apps, los Dockerfiles y **los jobs del CI** (el plan los lleva de cinco a siete).

Se gana una sola copia **y** cálculo instantáneo en el navegador, que es lo que
`PanelProducto.jsx:203` necesita —calcula en vivo mientras se escribe el costo, y
no tolera una llamada HTTP con *debounce*—. Resuelve además el problema de
`mediosDePago` (`apps/web/src/tests/mediosDePago.test.js:46`) y el que iba a
traer `apps/tienda` como tercera copia (H2).

Se descartan los otros dos caminos: «la API es la única autoridad» rompe el
precio instantáneo del panel, y «dos copias con un test que las ata» es
exactamente el defecto que el plan nombra para no repetirlo.

**Consecuencia sobre los requisitos**: **FR-006 ya no aplica** en su forma
original —no hay dos copias que atar con un test—. Se reemplaza por el requisito
de que **exista un único paquete** y que `apps/web` y `apps/api` lo consuman.

**Esto habilita la etapa 0**, y las etapas 1 y 2 dependen de la etapa 0.

---

### Decisión 2 · Términos y Política de Privacidad son de Favalio, y hasta que existan el checkout pide menos

**Los dos documentos son de Favalio**: los **redacta y los publica la
plataforma**, y **cada tienda los enlaza en su pie**. No son del comercio, y el
comercio no redacta nada.

Hoy **no existen** (`ANALISIS.md:345`, `AUDITORIA-SUSCRIPCIONES.md:147`,
`PLAN-COMPRAFIT.md:351`, `PROXIMOS-PROYECTOS.md:367`). Por eso la decisión trae
una **puerta explícita**, que no es una nota al pie:

> **Mientras los documentos no estén publicados, el checkout NO pide DNI y NO
> ofrece la casilla de marketing.** El pedido funciona con **nombre, teléfono y
> email**. `pide_dni` y el consentimiento de marketing quedan **modelados en la
> base pero apagados y sin exponerse**: el campo no se dibuja, el formulario no
> lo acepta y la API lo ignora aunque venga en el cuerpo.

Cuando los dos documentos estén publicados y enlazados en el pie, la puerta se
abre y `pide_dni` pasa a poder encenderse por catálogo. **Ese es el único
requisito para abrirla**, y está escrito como criterio verificable en US15 y en
FR-148.

**No bloquea el desarrollo de ninguna etapa**: bloquea únicamente que el checkout
publicado pida un DNI. Los documentos siguen siendo requisito de cualquier
pasarela, o sea que la etapa 3 no arranca sin ellos.

---

### Decisión 3 · El texto del N° de socio se corrige, con este texto exacto

La maqueta pone debajo del campo del N° de socio (`:295`): «Es el número de tu
carnet. **Con eso aplicamos el precio de socio.**» **No es lo que pasa**: las
reglas de precio son por catálogo, el N° de socio es declarativo y sin validar, y
el precio ya está aplicado desde que se abre la página para cualquiera con el
enlace.

**Se corrige el texto.** El texto exacto aprobado, que va tal cual en la pantalla
pública, es:

> **«Nos ayuda a identificarte cuando retirás el pedido.»**

**El precio sigue siendo del catálogo**, que es lo decidido. Se descarta
condicionar el precio al número —exige el padrón del gimnasio, explícitamente
fuera de alcance— y se descarta dejarlo como está.

---

### Decisión 4 · Los tres textos de reemplazo se aprueban tal cual, y el aviso de la bandeja es permanente

**Las tres propuestas quedan aprobadas con la redacción exacta que ya traía la
spec.** Son las que van en pantalla:

| Dónde | Lo que decía la maqueta | Texto aprobado |
|---|---|---|
| Descripción de la bandeja (`:1080`) | «Marcar un pedido como cobrado **descuenta stock y registra la venta** en Favalio» | «Marcar un pedido como cobrado **cambia su estado**. Por ahora **no descuenta stock ni registra la venta**: eso se hace a mano desde el punto de venta» |
| Confirmación de «Marcar cobrado» (`:1178`) | «…descuenta el stock de sus 2 productos y registra la venta en Favalio. La venta queda en el historial y el stock no se repone solo» | «Marcar cobrado el pedido #1042 **solo cambia su estado**. **El stock no baja y no se registra ninguna venta**: si ya lo entregaste, cargalo en el punto de venta» |
| Checkout de transferencia (`:375`, `:1325`) | «El pedido queda **reservado 24 horas**» | «Después de transferir, mandanos el comprobante por WhatsApp» — **sin la promesa de reserva**, porque no hay reserva |

**El aviso de la bandeja es permanente**: **no se puede cerrar hasta la etapa
3**. No lleva botón de cerrar, no guarda preferencia y no se oculta al recargar.
Un aviso que se cierra es un aviso que se cierra el primer día.

> El número del ejemplo pasa de `A-1042` a `#1042` por la **decisión 10**, que
> descarta la letra.

---

### Decisión 5 · Qué campos del checkout son obligatorios

**Esta decisión es sobre los campos de datos del comprador**, y solo sobre esos.
El catálogo configura **si se piden** el DNI y el N° de socio (`pide_dni`,
`pide_nro_socio`), pero «se pide» no es «es obligatorio». Campo por campo, ya
decidido:

| Campo **del comprador** | Decisión |
|---|---|
| Nombre y apellido | **Obligatorio** |
| Teléfono | **Obligatorio** — es el único canal por el que el comercio puede avisar algo |
| Email | **Opcional**, y si falta, **la confirmación no promete ningún email** |
| DNI | **Opcional aunque el catálogo lo pida** (y hoy ni se pide: ver decisión 2) |
| N° de socio | **Opcional aunque el catálogo lo pida**: no valida nada (decisión 3) |
| Dirección, localidad y CP | **Obligatorios solo con envío a domicilio**; con retiro no se piden |

O sea que **de los datos del comprador, los obligatorios son nombre + teléfono**,
y ninguno más. Cada campo obligatorio de más es un pedido menos; cada uno de
menos es un pedido que el comercio no puede completar.

**Y hay dos campos que no son del comprador y son obligatorios siempre**, que es
la precisión que trajo el diseño técnico. La **forma de entrega** y el **medio de
pago** son columnas `NOT NULL` del pedido y FR-141 exige que se revaliden en el
servidor contra lo que el catálogo tiene encendido. Un pedido **no puede existir**
sin ellos.

No contradice nada de lo anterior: **son los pasos 2 y 3 del checkout**, el
comprador siempre elige uno de cada uno —el paso no se puede saltear— y no hay
nada que «completar» después. Se escribe porque la frase «el pedido mínimo válido
es nombre + teléfono», leída al pie de la letra, habilitaba a mandar un pedido
sin decir **cómo lo recibe ni cómo lo paga**, y eso el comercio no lo puede
resolver por el comprador.

**El pedido mínimo válido, entonces**: nombre + teléfono (**del comprador**) +
entrega + medio de pago (**del pedido**), más al menos una línea con stock.

---

### Decisión 6 · Se recorta a lo que hay y se avisa, y nada vence solo

**a · Pedí 5 y hay 2 → se recorta a 2 y se avisa.** No se quita la línea entera:
el socio quiere las 2 que hay. El aviso usa **el mismo tratamiento visual de la
línea tachada del estado «se agotó»** (`:598-605`), para que sea el mismo
lenguaje visual y no un cartel nuevo.

**b · Un pedido «pendiente de pago» que nadie toca → nada vence solo.** El pedido
**queda hasta que el comercio lo cancele desde la bandeja**. No hay tarea
programada, no hay plazo y la pantalla no nombra ninguno.

El motivo es el mismo que sostiene la decisión 4: **sin reserva de stock, un
vencimiento automático no guarda nada**. Solo movería el estado de un pedido que
igual nadie estaba guardando, y obligaría a la pantalla a nombrar un plazo que el
sistema no sostiene. La reserva es la etapa 4.

---

### Decisión 7 · Una casilla por catálogo para el comercio, y email de confirmación para el comprador

**El aviso de pedido nuevo va a una casilla de correo configurable por
catálogo**: un campo más en el formulario del catálogo, coherente con
`whatsapp_destino`, que ya es por catálogo. **No** se avisa a todos los usuarios
de la empresa con `pedidos.ver` —en una empresa de ocho personas serían ocho
mails por pedido— y no se usa el email de la empresa.

**Y el comprador recibe un email de confirmación.** La maqueta lo afirma
(`:399`) y **la frase se queda**, así que hay que cumplirla: hace falta **una
plantilla nueva de Resend** para el comprador, además de la del comercio. Si el
comprador no dejó email —es opcional por la decisión 5—, la confirmación en
pantalla **no promete ningún email**.

---

### Decisión 8 · Qué roles reciben los cuatro permisos nuevos

| Rol | Permisos |
|---|---|
| `admin` | **Los cuatro**, por `seedPermissions.js:83` (recibe el catálogo entero) |
| `gerente` | **Los cuatro** |
| `vendedor` | **`pedidos.ver` y `pedidos.gestionar`** — es quien prepara y entrega — y **ninguno de `catalogo.*`**, porque los precios del catálogo son una decisión de negocio |
| `produccion` | **Ninguno** |
| `compras` | **Ninguno** |

**Atado, y con distinto peso: `mostrar_precio_lista` arranca apagado por
defecto.** El default seguro es no publicar el margen, y encenderlo es una
decisión consciente del comercio. La maqueta lo trae encendido (`:1246`) y se
aparta de la maqueta a propósito.

> **Esto es un supuesto revisable, no una decisión del dueño del producto**: es
> la propuesta de la spec y **no se preguntó**. Si el dueño del producto lo
> revierte, el cambio es de una línea en el modelo y no arrastra nada más.

---

### Decisión 9 · Selección explícita de productos

**Gana la selección explícita**, que es lo que dibuja la maqueta: una pestaña
Productos con casillas y el contador «**8** publicados de 62 del inventario»
(`:985`).

**Un producto publicable nuevo NO aparece** en ningún catálogo hasta que alguien
lo agrega a ese catálogo. Más trabajo el primer día —para eso están las acciones
masivas de `:987-992`— y cero sorpresas en una página pública: ni una importación
de CSV ni un alta suelta publican nada por su cuenta.

Consecuencias sobre el modelo, que arrastran a `Key Entities` y a los
requisitos:

- **`catalogos.incluye_todos` desaparece del modelo.** No se crea la columna y no
  se nombra en ningún requisito.
- **`catalogo_productos` es una lista de inclusión**: estar en la tabla **es**
  estar en el catálogo.
- **La columna `visible` no hace falta** y no se agrega. Una fila con
  `visible=false` sería una tercera bandera además de `publicable` e `is_active`,
  para decir lo mismo que decir que la fila no exista.

---

### Decisión 10 · El número de pedido es un correlativo por empresa, sin letra

**La letra se descarta explícitamente.** La maqueta muestra `#A-1042` y los ocho
pedidos de ejemplo (`:1499-1506`) comparten la serie `A-` **aunque sean de dos
catálogos distintos** («Comprafit / Fitnet» y «Verano 2026»): la letra no
significaba nada, y un prefijo que no distingue nada solo agrega algo que
explicar por teléfono.

- **Secuencial por empresa**, con `UNIQUE (empresa_id, numero)`.
- **Arranca en 1.**
- **Nunca se reinicia**: ni por año, ni por catálogo, ni por punto de venta.
- **Sin letra ni prefijo guardado**: `numero` es un entero.

**Cómo se ve en pantalla**: **`#1042`**. El numeral es de presentación —lo pone la
interfaz— y no se guarda en la base. Va así en la confirmación en 38px (`:398`),
en la bandeja, en el panel lateral, en los dos emails y en el mensaje de
WhatsApp: **un solo formato en todas las superficies**.

**Cómo se genera sin carrera de concurrencia**, que es lo que importa: el número
**no** se calcula con un `SELECT MAX(numero) + 1` leído fuera de la transacción
que inserta —dos pedidos simultáneos de la misma empresa leerían el mismo máximo—.
Se asigna **dentro de la misma transacción que crea el pedido**, tomando el
siguiente valor bajo **un candado por empresa** (bloqueo de la fila de la empresa,
o secuencia equivalente), y **`UNIQUE (empresa_id, numero)` es la red que
garantiza que no haya dos**: si aun así hubiera colisión, la escritura falla y se
reintenta, nunca se emite un número repetido. Que dos empresas distintas tengan el
pedido `#1` al mismo tiempo es correcto y esperado.

---

### Decisión 11 · El slug viejo muere, y un catálogo con pedidos no se borra

**El slug viejo muere.** No hay tabla de alias ni redirección: el enlace anterior
devuelve el 404 público del catálogo inexistente. Se evita así una tabla de alias
con una política de caducidad que decidir, y que los alias sigan ocupando el
espacio de nombres global.

**La pantalla avisa antes de guardar** que los QR y los carteles ya impresos
**dejan de funcionar**, y el comercio confirma sabiendo que tiene que reimprimir.
El aviso es parte del cambio de slug, no un texto de ayuda.

**Un catálogo con pedidos no se puede borrar.** El borrado **se rechaza** y la
pantalla **ofrece pausarlo**, que es lo que el comercio casi siempre quería. Un
pedido que apunta a un catálogo que no existe es un pedido que la bandeja no
puede explicar.

---

### Decisión 12 · Un handler de la API sirve el HTML de `/c/:slug` con las etiquetas puestas

`apps/tienda` es una app de Vite: un `index.html` estático con un
`<div id="root">`. Los metadatos que WhatsApp lee **no se pueden poner desde
React**, porque el lector de previsualizaciones no ejecuta JavaScript.

**Se elige el handler en la API**: un endpoint sirve el HTML de `/c/:slug` con
**`og:title`, `og:description` y `og:image` de ese catálogo ya puestos**, y **el
resto del documento sale del bundle de `apps/tienda`** sin cambios.

**De dónde saca la API ese HTML, que el borrador de esta decisión no decía.** El
diseño técnico lo corrigió: `apps/api` y `apps/tienda` son **dos imágenes de
Docker distintas**, así que **el handler no puede leer el `index.html` del
disco** —no está en su imagen, y su `<script src="/assets/index-<hash>.js">`
cambia de hash en cada build—. **El handler se lo pide al servicio `tienda` por
la red interna del compose**, con `timeout`, y lo **cachea en memoria 60
segundos**. `apps/tienda/index.html` lleva el marcador **`<!--FAVALIO_META-->`**
en el `<head>` y el handler reemplaza esa línea; si el marcador no está, sirve el
HTML **sin** metadatos y lo registra, en vez de romper. Ver FR-117c.

Eso es lo que hay que **presupuestar en el plan técnico**: no es «un endpoint y
un poco de plomería en el Caddyfile», es además **una llamada entre servicios con
su timeout, su caché y su modo de falla** —si el contenedor de la tienda está
caído, `/c/:slug` responde 503 aunque el bundle esté en el caché del navegador de
todo el mundo—, y un marcador en el HTML de la tienda que nadie puede borrar sin
que la previsualización deje de tener metadatos.

Se descartan los metadatos genéricos de Favalio —el enlace se vería igual para
todos los comercios, exactamente lo contrario de lo que el producto vende—, la
inyección desde Caddy, que obligaría al Caddyfile a consultar la API, la copia
del `index.html` dentro de la imagen de la API —se desincroniza y deja una página
en blanco sin error— y el volumen compartido con el `dist/` de la tienda, que
acopla el ciclo de vida de las dos imágenes.

Importa porque el enlace compartido por WhatsApp **es** el segundo canal de
distribución después del QR.

---

### Decisión 13 · `pedidos.origen` y la columna «Canal»: dos bandejas honestas antes que una mentirosa

**Esta decisión es del dueño del producto y se tomó después de aprobar la spec**,
así que no estaba en las doce anteriores. Lo que pidió: que a futuro **todo lo
que entre por la web se trabaje en una sola bandeja**.

**Lo que entra ahora**: `pedidos` lleva **`origen`** ENUM con **un solo valor,
`catalogo`**, la bandeja dibuja una columna **«Canal»** al lado del filtro
«Catálogo: todos» que la maqueta ya trae (`:1085`), y hay un índice
`(empresa_id, origen, created_at DESC)` para que filtrar por canal no barra la
tabla el día que haya un segundo valor.

Una columna con un solo valor parece decoración y no lo es: es lo que hace que el
día que entre un segundo canal **no haya que migrar datos ni tocar la pantalla**.
Agregar `origen` después significa una migración con backfill sobre pedidos
reales y una columna que la bandeja no sabía dibujar.

**Lo que NO entra, y por qué**: una bandeja única desde el día uno, que traiga
también los pedidos de TiendaNube. **`tiendanube_pedidos` no es una bandeja**: es
el **libro de idempotencia del webhook de stock**, y su propio encabezado lo dice
(`models/TiendanubePedido.js`). La fila se inserta *dentro* de la transacción que
descuenta, el `SequelizeUniqueConstraintError` de `uq_tn_pedido` es lo que
sostiene la garantía cuando llegan dos entregas del mismo webhook a la vez, y
**esas filas no se borran nunca**, porque un pedido borrado es un pedido que se
puede volver a descontar.

Le faltan **seis cosas** que la bandeja necesita para poder operar una fila:
**comprador** (nombre, teléfono, email), **total**, **estado** operable,
**entrega**, **medio de pago** y **líneas con precio congelado**. Lo que tiene es
`tiendanube_order_id`, `numero`, el JSONB de `items` con lo que se descontó e
`items_sin_descontar` — o sea, el registro de qué hizo el webhook con el stock.

Y hay **dos propiedades suyas que chocan de frente** con las de una bandeja:

1. **Sus filas son inmutables por diseño.** Un pedido de la bandeja cambia de
   estado seis veces; una fila de `tiendanube_pedidos` se escribe una vez y no se
   toca más.
2. **Sus filas no se borran nunca.** Un pedido de la bandeja, en cambio, se
   cancela y se puede archivar.

Unificarlas hoy daría una tabla donde media docena de filas tienen todo y las
otras tienen guiones en seis columnas — y **una fila con guiones no es un pedido
que alguien pueda operar**: no se le puede cambiar el estado, no se lo puede
marcar cobrado, no se sabe a quién llamar. **Dos pantallas honestas antes que una
que promete una bandeja y entrega una lista.**

**Qué haría falta para unificar**, escrito acá para que la pregunta no vuelva sin
respuesta: primero, que un pedido de TiendaNube **tenga** comprador, total y
estado. Eso es el **pendiente 12c de `PROXIMOS-PROYECTOS.md`** —«un pedido de la
tienda no registra ninguna venta», cuyo primer paso es justamente decidir
cliente, medio de pago, punto de venta y numeración— y **no entra en esta spec**.
Cuando eso exista, el camino es: filas en `pedidos` con
`origen = 'tiendanube'`, `tiendanube_pedidos` **se queda** como libro de
idempotencia del webhook —no se borra ni se fusiona— y las dos se relacionan por
un `tiendanube_pedido_id` anulable. La columna `origen` que se crea ahora es lo
que hace que ese día no haya que migrar nada. Ver FR-160a y FR-160b.

---

**Y una última cosa que no es una decisión sino la advertencia que las une**: la
decisión 6b y la decisión 4 son la misma conversación. Sin reserva de stock,
cualquier promesa de plazo —«reservado 24 horas», «vence en 48»— es una promesa
que el sistema no puede sostener. **La reserva es la etapa 4.** Hasta entonces,
lo único honesto que la tienda puede decir es qué hace el comercio, no qué hace
el sistema.
