# Implementation Plan: Catálogo de ventas online — etapas 0, 1 y 2

**Spec**: [spec.md](./spec.md) · **Modelo de datos**: [data-model.md](./data-model.md) ·
**Contratos**: [contracts/api-endpoints.md](./contracts/api-endpoints.md)

## Summary

El primer pedazo de Favalio que le contesta a alguien que no inició sesión. Sale
en **tres etapas y diecisiete cortes**, y el primero no tiene nada que ver con
catálogos: convierte el monorepo en **workspaces de npm** y crea
`packages/precios`, porque sin una sola copia de la fórmula el precio de una
página pública y el de la caja son dos números distintos que empiezan iguales.

Después: una tabla de catálogos con su slug único global, un **resolvedor de
tenant que no mira ninguna sesión**, un router público montado en un lugar
exacto —y **excluido del limitador global**, que es lo que la spec no pidió y
sin lo cual el QR del gimnasio puede tumbar la caja del comercio—, una app nueva
`apps/tienda` de 390px, y un pedido que valida cada `product_id` contra la lista
de inclusión del catálogo antes de crear una sola fila.

Hay **seis migraciones**, **cuatro permisos**, **dos paquetes compartidos**,
**dos servicios de CI nuevos** y **once anclas de guardias que se mueven**, cada
una con su motivo escrito.

Y hay **seis cosas que la spec da por sentadas y no son ciertas**. Están en «Lo
que la spec pide y hay que ajustar», antes de las decisiones, porque cuatro de
ellas cambian qué se construye.

---

## Technical Context

### Qué existe hoy, y qué le pasa a cada pieza

Todo verificado abriendo el archivo, no de memoria.

| Pieza | Hoy | Qué le pasa acá |
|---|---|---|
| `package.json` raíz (`:9-23`) | Orquesta con `npm --prefix apps/X`. **Tres** `package-lock.json` (api, web, landing). Cero workspaces | **Workspaces.** Los tres lock se borran y nace uno en la raíz. Es el corte más peligroso del hito y va solo (decisión 1) |
| `apps/web/src/utils/precios.js:98-131` | La **única** cuenta de precio de venta del sistema, del lado del navegador. **21 casos** en su test, no 12 | Se muda entera a `packages/precios`. Los cinco consumidores cambian el import y nada más |
| `apps/api` | CommonJS + jest. **No sabe calcular ningún precio** | `require('@favalio/precios')`. Sin transpilación, sin adaptador (decisión 1) |
| `server.js:182` | `app.use('/api/tiendanube', …publico)` **arriba** del `express.json` global | No se toca. El catálogo **no** va acá, y por qué está en la decisión 2 |
| `server.js:184` | `app.use(express.json({ limit:'10mb' }))` | No se toca. El router del catálogo va **debajo**: necesita el cuerpo parseado |
| `server.js:312-319` | `app.use('/api/', limiter)` — 600 req/15 min **por IP** | **Se le agrega un `skip`** para el prefijo público. Es el hallazgo 1 |
| `server.js:456-458` | `/api/auth` público, `/api/auth` privado, `/api/empresas` — los tres **arriba** del genérico | El montaje público del catálogo entra **justo después de `:458`** |
| `server.js:464` | `app.use('/api', ...authEmpresa, require('./routes/general'))` — el genérico | No se toca. Es la línea contra la que se mide todo (decisión 2) |
| `server.js:49` | `app.set('trust proxy', 1)` | Ya está, y es lo que hace que el limitador por IP signifique algo detrás de Caddy. Se verifica, no se agrega |
| `middleware/auth.js:101-353` — `loadEmpresaContext` | Resuelve la empresa del JWT, **con la rama del superadmin por `X-Empresa-Id` sin membresía** (`:172-200`) | **No se reusa.** El público tiene su propio resolvedor (decisión 3) |
| `middleware/auth.js:224` | `req.empresaSettings = ue.empresa.settings` | Es la **única** línea de `apps/api/src` que toca los settings de la empresa. `enabled_modules` tiene **cero apariciones** en todo `apps/api/src` — verificado con grep. Ver decisión 11 |
| `middleware/checkSubscription.js:85-115` | El `switch` de los cinco estados, adentro del middleware | El `switch` **se extrae a una función pura** que importan los dos caminos. El middleware no cambia de comportamiento (decisión 4) |
| `middleware/checkSubscription.js:127-130` | Un error de base **deja pasar** | **La cadena privada no cambia.** El camino público cierra con 503 (FR-112a) |
| `utils/tenantScope.js:110-118` — `assertEmpresaId` | Tira **500** si el `empresaId` no es un entero > 0 | Es lo que hace que un handler público que se olvide del filtro **falle fuerte**. Se aprovecha (decisión 3) |
| `routes/sales.js:311-630` | El molde de escritura segura: transacción, total recalculado, idempotencia por `UNIQUE`, `Stock.findOne` con `lock` | Se copia entero para el pedido, **menos el `lock`**: no hay reserva (FR-140) |
| `utils/sucursalDeStock.js:114,185` | `resolverSucursal` / `ubicacionDeStock` | El catálogo **no resuelve** sucursal: la declara. Se usa `elegirPorDefecto` solo en la validación del alta |
| `routes/empresas.js:37-51` | `multer` con `memoryStorage` → **data URI base64 en la base** | **No se reusa** para fotos de producto (FR-022). Sí se copia el manejo del error de multer (`:178-180`) |
| `routes/import.js:15-23,55-56,361` | `multer` a `apps/api/uploads`, y `imagen` del CSV a `image_url` como string | No se toca. Es de donde salen las `image_url` externas que **no se publican** (FR-030) |
| `models/index.js:39-48` | Los cinco de TiendaNube se exportan **sin asociaciones**, a propósito, para no mover el ancla de includes | Se copia el patrón para `Catalogo`, `CatalogoProducto` y `CatalogoReglaPrecio` (decisión 12) |
| `apps/web/src/utils/pedidoWhatsapp.js:32-76,88-138` | Normalización de teléfono argentino y armado del texto. **Vive en `apps/web`** | `apps/api` **no lo puede importar**. Es el hallazgo 4 |
| `deploy/Caddyfile` | Cuatro bloques. **Sin `file_server`, sin `handle_path`, sin un solo archivo estático** | Un quinto bloque, con tres `handle` adentro (decisión 8) |
| `deploy/respaldo.sh:42` | `pg_dump | gzip`. **Nada más** | Se le agrega el volumen, con la misma verificación y la misma rotación (decisión 9) |
| `.github/workflows/ci.yml` | Cinco jobs, cada uno con su `npm ci` y su `cache-dependency-path` | **Siete**, y los cinco cambian de raíz de instalación (decisión 1) |
| `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/landing/Dockerfile` | `COPY package.json package-lock.json*` con el contexto en la carpeta de la app | Los tres cambian de contexto a la raíz del repositorio, y nace un `.dockerignore` de la raíz |

### Qué se reusa tal cual, sin escribir nada nuevo

Cada línea de acá es una decisión que **no** hay que tomar.

| Se necesita | Ya existe | Dónde |
|---|---|---|
| Filtrar por empresa un id que vino del cliente | `findScoped`, `scoped`, `assertEmpresaId` | `utils/tenantScope.js:29,98,110` |
| Un error que sí es para el usuario | `ErrorDeNegocio` (lleva `publico: true` y su `status`) | `utils/errores.js` |
| Un `catch` que no filtra nombres de tabla | `fallo(req, res, err, 'mensaje')` | `utils/errores.js:60` |
| Un token opaco imposible de adivinar | `crypto.randomBytes(32).toString('hex')` como `defaultValue` | `models/Invitacion.js:24-29` |
| Idempotencia que aguanta dos requests a la vez | `findOne` rápido + `SequelizeUniqueConstraintError` + relectura | `routes/sales.js:427-435`, `:599-624` |
| Un candado de Postgres que no bloquea filas de negocio | Advisory lock (`LOCK_ID = 947213`) | `apps/api/scripts/migrar.js:41` |
| Recalcular el total en el servidor y rechazar el del cliente | `verificarTotal` | `utils/calculosVenta.js`, usado en `routes/sales.js:355` |
| Un router público exportado aparte del privado | `module.exports = { publico, privado }` | `routes/tiendanube.js:1473` |
| Mandar un mail sin mentir cuando no salió | `sendEmail` devuelve `ok:false`, con su test | `services/email.js:34`, `observabilidad.test.js:125-144` |
| La plantilla HTML de los mails | `plantillaBase` | `services/email.js:160` |
| Generar un QR en el navegador | `qrcode`, ya instalado | `apps/web` `package.json:31`, molde en `printInvoice.js:1,48-75` |
| Tabla en grid, panel lateral, encabezado, vacío, paginación | `TablaGrid`/`Encabezado`/`Fila`/`BotonDeFila`, `ui/sheet`, `PageHeader`, `EstadoVacio`, `Pagination` | `apps/web/src/components/` |
| El arnés con dos empresas contra Postgres | `baseDePruebas.js` + `sembrarDosEmpresas()` | `src/tests/integracion/fixtures.js:80` |
| Contar consultas de un request | `capturarConsultas(sequelize, accion)` | `src/tests/integracion/espiaDeConsultas.js` |
| El molde de una guardia de **posición** de montaje | `montajePublicoAntesDelJson` + sus muestras sintéticas + el `null` cuando no encuentra qué mirar | `observabilidad.test.js:394-536` |
| El protocolo de «una guardia no nace en verde» | La lista de archivos que todavía no existen da el hallazgo «el archivo NO existe» | `guardiasDeDiseno.test.js:217-238`, `:473-483` |

### Los tres gates, y por qué acá son tres y medio

`CONVENCIONES.md` pide decir dónde van los tres. Acá:

- **`soloSuperadmin`**: **ninguno**. Catálogos y Pedidos son del cliente, igual
  que TiendaNube. No entran en la lista de módulos no liberados de
  `server.js:472-486`.
- **`modulo: 'catalogo'`**: en los **tres** lados, y esto es trabajo nuevo.
  - Barra lateral: los dos ítems del grupo «Venta online» de
    `components/navegacion.js`, que ya sabe filtrar por módulo
    (`gruposVisibles`, `:212-228`).
  - `RouteGuard` de `App.jsx:38-68`, con `requiredModule="catalogo"`, que además
    es lo que exige `src/tests/marcoDePantalla.test.js`.
  - **API**: `middleware/requireModulo.js`, **que hoy no existe**.
    `enabled_modules` tiene **cero apariciones en `apps/api/src`** —verificado— y
    `req.empresaSettings` se escribe en `auth.js:224` y no lo lee nadie. Ver la
    decisión 11, que explica por qué el catálogo lo arregla **solo para sí
    mismo**.
- **`permission`**: cuatro permisos nuevos —`catalogo.ver`, `catalogo.editar`,
  `pedidos.ver`, `pedidos.gestionar`— en `seedPermissions.js`, en los dos ítems
  del menú, en el `RouteGuard` y en cada endpoint privado.
- **Y el medio**: el router **público** no tiene ninguno de los tres, por
  construcción. Lo que corta ahí es el **estado del catálogo** y la
  **suscripción**, y por eso el archivo va declarado en `ROUTERS_SIN_SESION` con
  su motivo escrito.

---

## Lo que la spec pide y hay que ajustar

Seis. Los cuatro primeros cambian qué se construye; los seis se verificaron
abriendo el archivo citado.

### 1. FR-113 no alcanza para FR-115: el limitador propio no evita el 429 en la caja

FR-113 pide «un limitador propio para el prefijo público». FR-115 pide que «el
tráfico del catálogo **no pueda provocar un 429 en el punto de venta**». **Lo
primero no produce lo segundo**, y esto es lo que hay que mirar:

```js
// server.js:319 — corre para TODO lo que empiece con /api/
app.use('/api/', limiter);   // 600 req cada 15 min, por IP
```

Un router montado en `/api/publico` queda **debajo** de esa línea, que es lo que
FR-090 pide. Entonces cada visita al catálogo **también** consume el cupo global
de 600 por IP —el mismo que consumen las tres cajas del comercio si comparten
NAT con el gimnasio, y el de **cualquier otro cliente detrás del mismo NAT**—.
Agregarle un segundo limitador propio no le devuelve el cupo a nadie: le pone
**dos** límites al catálogo y le sigue comiendo el del comercio.

**Qué se hace**: al limitador global de `:319` se le agrega un `skip` que
excluye el prefijo público, con el motivo escrito al lado, y el prefijo público
queda gobernado **únicamente** por su limitador, que cuenta por **IP + slug**.
Ver decisión 2. Y hay una guardia estática que ata las dos líneas: si alguien
saca el limitador propio y deja el `skip`, el prefijo queda sin ningún límite y
la guardia lo dice.

**Por qué no se resuelve montando el router arriba del limitador**, que sería lo
obvio: porque entonces la exención deja de estar escrita en ningún lado. Un
router que quedó arriba del limitador «por el orden» es un router que nadie sabe
que está sin límite, y el día que alguien le saque el suyo la superficie pública
queda desnuda sin que se mueva una línea del archivo del limitador. Con el
`skip`, la exención vive **al lado del limitador que exime**.

### 2. El handler de `/c/:slug` necesita el HTML de `apps/tienda`, y la API no lo tiene

La decisión 12 de la spec dice que un handler de la API sirve el HTML de
`/c/:slug` con las etiquetas Open Graph puestas, y que «el resto del
documento —el bundle de `apps/tienda`— sale sin cambios». **No dice de dónde lo
saca la API**, y ahí está el problema: son **dos imágenes de Docker distintas**.
`apps/api/Dockerfile` copia `src/` y `scripts/`; el `index.html` con el `<script
src="/assets/index-<hash>.js">` vive dentro de la imagen de `tienda`, y el hash
cambia en cada build.

Las cuatro salidas y por qué tres no sirven:

| Salida | Por qué no |
|---|---|
| La API guarda una copia de `index.html` | Dos archivos que hay que mantener sincronizados, y el que se desincroniza apunta a un `assets/index-<hash>.js` que ya no existe: **página en blanco**, sin error |
| Un volumen compartido con el `dist/` de la tienda | Acopla el ciclo de vida de las dos imágenes: un `up -d --build tienda` deja a la API leyendo el archivo del build anterior durante la ventana del deploy |
| Caddy inyecta las etiquetas | FR-117a lo prohíbe explícitamente, y con razón: obliga al Caddyfile a consultar la API |
| **La API le pide el HTML al servicio `tienda`** por la red interna del compose y lo cachea | Es la que se elige. Ver decisión 8 |

**Qué se hace**: el handler pide `GET http://tienda/index.html` con `timeout`
—hay una guardia de `observabilidad.test.js` que exige `timeout` en toda llamada
saliente— y lo guarda en memoria 60 segundos. `apps/tienda/index.html` lleva un
marcador `<!--FAVALIO_META-->` en el `<head>` y el handler reemplaza esa línea.
Si el marcador no está, sirve el HTML **sin** metadatos y lo registra, en vez de
romper.

### 3. `catalogo_visitas` con la clave de Key Entities no puede contestar US20 escenario 7

Key Entities define `catalogo_visitas` con `UNIQUE (catalogo_id, fecha, origen)`.
US20 escenario 7 pide que la pestaña **distinga** las visitas que ocurrieron con
el catálogo pausado, «para que la conversión en cero no se lea como un problema
de la tienda».

Con esa clave **no se puede**: la fila no guarda el estado del catálogo en el
momento de la visita, y cuando alguien mire la pestaña el catálogo ya va a estar
en otro estado.

**Qué se hace**: la clave pasa a **`UNIQUE (catalogo_id, fecha, origen,
estado_catalogo)`**, con `estado_catalogo` guardando el estado que tenía el
catálogo cuando entró la visita. Sigue siendo una fila por día, por catálogo,
por origen y por estado —a lo sumo tres veces más filas que la versión original,
y en la práctica una, porque un catálogo no cambia de estado todos los días—.
No guarda IP, ni cookie, ni nada del visitante (FR-201 intacto).

### 4. FR-144 y FR-184 piden reusar una función que vive en la app equivocada

FR-144: «el teléfono DEBE normalizarse con
`apps/web/src/utils/pedidoWhatsapp.js:32-76`». FR-184: «el enlace de WhatsApp
DEBE armarse con `:88-138`». Las dos cosas las tiene que hacer el **servidor**
—el teléfono se normaliza al guardar el `Customer` y el pedido, y el
`whatsapp_url` viaja en la respuesta del pedido (FR-152)—.

**`apps/api` no puede importar nada de `apps/web/src`.** Son dos paquetes de
npm distintos y ninguno declara al otro; el único camino sería una ruta relativa
`../../web/src/utils/…`, que además rompería la imagen de Docker de la API, que
copia solamente `apps/api/src`.

Las tres salidas:

1. **Copiarla.** Es el defecto de `mediosDePago.js` que la decisión 1 vino a
   cerrar. Descartada por definición.
2. **Que el enlace lo arme la tienda.** El texto del pedido lo tiene el
   servidor —nombres y precios congelados—, así que la tienda tendría que
   recibir el detalle otra vez y volver a formatear importes: una tercera copia
   del formato argentino, que es exactamente lo que H2 advierte.
3. **Un segundo paquete.** Con workspaces ya puestos cuesta un `package.json` y
   una línea en dos `dependencies`.

**Qué se hace**: `packages/pedido`, con `normalizarTelefono` y
`armarTextoPedido` —las dos puras—, creado en la **etapa 2** y no en el corte de
workspaces, para no engordar el commit más peligroso del hito.
`enviarPedidoPorWhatsapp` (`:148-159`) **no se muda**: toca `window`, así que se
queda en `apps/web`, y `apps/tienda` escribe la suya de tres líneas.

### 5. `precios.test.js` tiene 21 casos, no 12

FR-003 y el criterio 2 hablan de «los doce casos de
`apps/web/src/utils/precios.test.js`». Contados: **21**. No cambia nada del
diseño —los 21 se mudan y los 21 tienen que seguir pasando— pero el número va
corregido acá para que `tasks.md` no verifique contra un total equivocado y
alguien dé por buena una mudanza que perdió nueve casos.

### 6. «El pedido mínimo válido es nombre + teléfono» no es literal

La decisión 5 dice que los obligatorios son nombre y teléfono «y ninguno más».
FR-141 exige que la entrega y el medio de pago sean **de los que el catálogo
tiene encendidos**, y las dos columnas son ENUM `NOT NULL`. O sea que el pedido
mínimo real es **nombre + teléfono + entrega + medio de pago**, y los dos
últimos los elige el comprador en los pasos 2 y 3 del checkout.

No es una contradicción: la decisión 5 habla de los **campos de datos del
comprador**. Se aclara porque leída al pie de la letra habilita a mandar un
pedido sin decir cómo lo recibe ni cómo lo paga, y el comercio no puede
completar eso por él.

---

## Decisiones

### 1 · `packages/precios` es CommonJS sin paso de build, y el monorepo entero pasa a workspaces

**Se eligió**: un paquete **sin `dist/`, sin bundler y sin paso de build**.

```
packages/precios/
  package.json      { "name": "@favalio/precios", "private": true,
                      "version": "0.0.0", "main": "index.js",
                      "scripts": { "test": "vitest run" } }
  index.js          module.exports = { MODO_RECARGO, precioConRecargo,
                                       precioConDescuento, calcularPrecios }
  index.test.js     los 21 casos que hoy están en apps/web/src/utils/precios.test.js
  vitest.config.js  { test: { environment: 'node' } }
```

Sin `"type": "module"`, o sea **CommonJS**. `apps/api` hace
`require('@favalio/precios')` y funciona sin transpilación, sin
`--experimental-vm-modules` en jest y sin `exports` condicionales. `apps/web`
hace `import { calcularPrecios } from '@favalio/precios'` y Vite lo interopera,
con **una línea** de configuración:

```js
// apps/web/vite.config.js
optimizeDeps: { include: ['@favalio/precios'] },
```

Esa línea no es opcional y hay que escribirla con su motivo: Vite pre-empaqueta
las dependencias de `node_modules` para convertir CommonJS a ESM, pero **excluye
las que están enlazadas por workspace** —supone que son código fuente ESM—. Sin
`include`, el `import` con nombres de un paquete CJS enlazado falla en el
servidor de desarrollo y anda en el build, que es la peor combinación posible.

**Alternativas descartadas**:

- **Paquete ESM con `dist/` dual (`index.mjs` + `index.cjs`) construido por
  esbuild**, que es la forma «de manual», **porque** obliga a que
  `npm run build -w packages/precios` corra **antes** de: `npm test -w apps/api`,
  `npm test -w apps/web`, `npm run dev`, los tres `docker build` y siete jobs de
  CI. Son doce lugares que tienen que acordarse, y el modo de falla es
  **silencioso**: consumir un `dist/` viejo da un precio distinto y no falla
  nada. Un paquete que no se construye no se puede construir mal.
- **Paquete ESM puro, sin build**, **porque** `apps/api` es CommonJS y jest 30
  necesita `--experimental-vm-modules` para cargar ESM. `require(esm)` recién es
  estable desde Node 22.12 y los `engines` dicen `>=22`: una máquina con 22.4
  rompería la API entera por una función de precios.
- **«La API es la única autoridad», con `POST /api/precios/simular`**, **porque**
  `PanelProducto.jsx:203` calcula dentro de un `useMemo` **mientras se escribe el
  costo**. Una vuelta al servidor por tecla, aunque tenga rebote, es un número
  que aparece medio segundo después de dejar de escribir. Ya está descartada por
  la decisión 1 de la spec; se repite acá porque es la que alguien va a proponer
  de nuevo cuando vea la línea de `optimizeDeps`.

**Los cinco consumidores** cambian una línea cada uno:
`Inventory.jsx:5`, `PanelProducto.jsx:4`, `exportarInventario.js:2`,
`impresionInventario.js:1`, `useStore.js:3`. `apps/web/src/utils/precios.js` y
`precios.test.js` **se borran**.

**La guardia que sostiene FR-006** (`apps/api/src/tests/paqueteDePrecios.test.js`,
porque es donde ya viven las guardias que leen archivos de todo el repositorio):

1. `package.json` de la raíz declara `"workspaces": ["apps/*", "packages/*"]`.
2. `apps/api/package.json` y `apps/web/package.json` declaran
   `"@favalio/precios": "*"` en `dependencies`.
3. **No existe** `apps/web/src/utils/precios.js`.
4. Ningún archivo de `apps/api/src` ni de `apps/web/src` contiene los tres
   marcadores de la fórmula: `1 + aNumero(margen)`, `MODO_RECARGO = {`,
   `function calcularPrecios`. Las tres son cadenas literales, no expresiones
   regulares laxas: una guardia que se pone en rojo por una variable que se llama
   parecido es una que alguien afloja.
5. **El ancla**: la guardia leyó los cuatro `package.json` y encontró los tres
   marcadores **dentro de `packages/precios/index.js`**. Sin esto, un renombre
   del paquete la dejaría revisando archivos que no existen y pasando en verde.

### 1b · Qué cambia exactamente al pasar a workspaces

**Raíz**:

```json
"workspaces": ["apps/*", "packages/*"],
"scripts": {
  "dev":        "concurrently -n api,web,landing,tienda …",
  "dev:api":    "npm run dev -w apps/api",
  "build":      "npm run build -w apps/web && npm run build -w apps/landing && npm run build -w apps/tienda",
  "test":       "npm test -w packages/precios && npm test -w apps/api && npm test -w apps/web && npm test -w apps/tienda"
}
```

`install:all` **desaparece**: lo reemplaza `npm ci` a secas. Los tres
`package-lock.json` de `apps/*` se **borran** y nace uno solo en la raíz.

**`apps/landing` entra al workspace aunque no consuma nada**, y es deliberado:
dos árboles de instalación conviviendo en el mismo repositorio —uno con
workspaces y otro con `npm --prefix`— es el estado en el que un `npm ci` de la
raíz borra el `node_modules` de landing y nadie entiende por qué el build dejó
de andar. Todo o nada. Su `eslint ^10` contra el `^9` de `apps/web` no es
problema: npm anida el conflicto en `apps/landing/node_modules`.

**Dockerfiles**. Los tres —más el de `apps/tienda`— cambian de contexto a la
raíz. El de la API queda así:

```dockerfile
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/precios/package.json ./packages/precios/
COPY apps/api/package.json ./apps/api/
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root
COPY packages/precios/ ./packages/precios/
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/scripts/ ./apps/api/scripts/
COPY apps/api/.sequelizerc ./apps/api/
WORKDIR /app/apps/api
CMD ["sh", "-c", "node scripts/migrar.js && node src/server.js"]
```

Dos detalles que no son estilo:

- **El `package.json` de `packages/precios` se copia antes del `npm ci`.** npm
  crea el enlace simbólico del workspace durante la instalación; si el directorio
  no existe todavía, el enlace queda colgado y el `require` falla **al arrancar
  en producción**, no en el build.
- **`--workspace apps/api`** y no un `npm ci` pelado: sin eso la imagen de la API
  se lleva las `dependencies` de `apps/web` —React, Tailwind, xlsx— que no usa.
  Si esa bandera diera problemas con la versión de npm de la imagen, el respaldo
  es `npm ci --omit=dev` a secas: es **correcto**, solo más gordo, y eso se ve en
  el tamaño de la imagen y no en un error raro.

**`.dockerignore`**: los tres de `apps/*` se borran y nace **uno en la raíz**,
que es lo que aplica cuando el contexto es la raíz. Excluye `**/node_modules`,
`**/dist`, `.git`, `**/.env*`, `legacy/`, `docs/`, `.claude/`. Sin él, cada
`docker build` sube el repositorio entero al demonio: en el VPS de 4 GB eso es
la diferencia entre segundos y minutos.

**`docker-compose.produccion.yml`**: los cuatro servicios de build pasan de
`context: ./apps/X` a `context: .` + `dockerfile: apps/X/Dockerfile`.

**CI**: los cinco jobs cambian `cache-dependency-path` a `package-lock.json` de
la raíz y su `npm ci` pasa a correr en la raíz (`working-directory` fuera, o
`.`), dejando los pasos de test con su `working-directory` como está. El job
`contenedor` pasa de `docker build -t favalio-api:ci .` con
`working-directory: apps/api` a `docker build -f apps/api/Dockerfile -t favalio-api:ci .`
en la raíz. Y aparecen **dos jobs nuevos**:

| Job | Qué corre | Por qué propio |
|---|---|---|
| **Paquetes — tests** | `npm test -w packages/precios` | Colgado del job `web`, una regresión de la fórmula que rompe **el catálogo público** se reportaría como «Web — tests». El nombre del job es la mitad del valor de un CI |
| **Tienda — tests y build** | `build`, tests de render y la prueba de navegador a 390px | Gemelo del job `navegador`, con su Postgres y su API. Ver decisión 10 |

Siete jobs. El costo es un `npm ci` de la raíz más pesado en cada uno —instala
las cuatro apps— y un segundo Chromium. La alternativa, `npm ci --workspace`
por job, se prueba en el corte F0.1 y se adopta si funciona; **no se da por
hecha**, porque el comportamiento de `npm ci` con `--workspace` cambió entre
versiones de npm y un job que instala de menos falla con un `MODULE_NOT_FOUND`
que no nombra la causa.

### 2 · El router público se monta en `server.js:459`, y el limitador global lo exime

**Se eligió**: una línea, **inmediatamente después de
`app.use('/api/empresas', ...authSinEmpresa, …)` (`:458`)** y antes de
`app.use('/api/products', …)` (`:460`):

```js
// ── El catálogo público: sin sesión, con su propio límite ──
//
// ARRIBA del app.use('/api', ...authEmpresa, general) de más abajo: los
// middlewares de ese montaje corren para TODO lo que empiece con /api, así que
// desde acá para abajo un visitante sin token recibe el 401 de checkJwt antes
// de llegar a ningún handler.
//
// DEBAJO del express.json de :184, que es lo contrario del público de
// TiendaNube: acá no hay firma HMAC que verificar contra el cuerpo crudo, y
// POST /pedidos necesita el cuerpo parseado.
//
// DEBAJO del limitador de :319 —al que se le agregó un `skip` para este mismo
// prefijo— y con el suyo propio, que cuenta por IP + slug. Ver el comentario
// del limitador.
app.use('/api/publico', limitadorPublico, require('./routes/catalogoPublico').publico);

// El HTML de la tienda con las etiquetas Open Graph del catálogo. NO cuelga de
// /api a propósito: es una página, no una API, y por eso ni el limitador global
// ni checkSubscription la ven. Su límite es el mismo limitadorPublico.
app.use('/c', limitadorPublico, require('./routes/catalogoPublico').paginas);
```

**Por qué las otras dos formas fallan**, cada una por su lado:

1. **Arriba del `express.json` global (`:184`), al lado del público de
   TiendaNube.** Es donde uno lo pondría por analogía —«los dos son públicos»— y
   falla por **dos** motivos a la vez. Primero: `POST …/pedidos` nacería **sin
   cuerpo parseado**, porque `express.json` es el de la línea 184 y el router
   estaría por encima; habría que montarle uno propio, que es lo que hace
   TiendaNube y **solo** porque necesita `req.rawBody` para verificar el HMAC.
   Acá no hay firma. Segundo, y peor: quedaría **arriba del limitador de `:319`**,
   o sea sin ningún límite, en la única superficie del sistema que cualquiera
   puede golpear sin credenciales.
2. **Debajo del `/api` genérico de `:464`**, al lado del montaje privado, que es
   donde queda si uno agrupa por funcionalidad. Los middlewares de
   `app.use('/api', ...authEmpresa, …)` corren para todo lo que empiece con
   `/api`, matchee o no el router de atrás: un visitante sin `Authorization`
   recibiría **401 de `checkJwt`** y nunca llegaría al handler. Y no hay que
   descubrirlo probando: `montajeDeRouters.test.js:163-188` lo marca como
   hallazgo, porque la cadena del montaje no incluye `requireEmpresa`. Es
   exactamente el defecto que dejó `POST /api/auth/accept-invite` respondiendo
   403 durante meses.

**El `skip` del limitador global** (hallazgo 1), en `:312-319`:

```js
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 10000 : 600,
  // ⚠ El prefijo público del catálogo NO consume este cupo, y sacar esta línea
  // devuelve el problema sin que nada falle: el catálogo seguiría andando y las
  // cajas del comercio empezarían a recibir 429 los sábados a la tarde.
  //
  // Los 600 por IP están pensados para el navegador de una caja. Un gimnasio
  // entero sale por un router: cincuenta socios escaneando el QR comparten cupo
  // con el punto de venta si están en la misma red —y con el de cualquier otro
  // cliente detrás del mismo NAT—. El prefijo público tiene su propio limitador,
  // que cuenta por IP **y slug**, así que un catálogo saturado no apaga a otro.
  skip: (req) => req.path.startsWith('/publico/'),
  …
});
```

`req.path` dentro de un `app.use('/api/', …)` viene relativo al punto de
montaje, así que la comparación es `'/publico/'` y no `'/api/publico/'`. Es
justo la clase de detalle que se escribe mal una vez: hay un caso de prueba
sintético que lo fija.

**`limitadorPublico`**, declarado al lado del global:

```js
const limitadorPublico = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 10000 : 120,
  // Por IP **y** slug. Sin el slug, un catálogo con mucho tráfico apagaría a
  // todos los demás desde la misma IP de salida; sin la IP, un solo visitante
  // podría apagar un catálogo entero para todos.
  keyGenerator: (req) => `${ipKeyGenerator(req)}|${slugDeLaRuta(req.path) || '-'}`,
  message: { ok: false, error: 'DEMASIADAS_PETICIONES', … },
});
```

`slugDeLaRuta(path)` es una **función pura** exportada de
`utils/slugDeCatalogo.js` y con su test: en el punto de montaje los `req.params`
todavía no existen, así que el slug se saca del camino. `ipKeyGenerator` es el
ayudante de `express-rate-limit` v8 —sin él, el conteo por IPv6 agrupa redes
enteras—.

**El número**: 120 por minuto por (IP, slug). Sale de contar las llamadas de una
visita, que el diseño de los endpoints fija en **cuatro como máximo** y que
FR-114 obliga a **medir** antes de publicar el QR:

| Momento | Llamadas |
|---|---|
| Abrir `tienda.favalio.com/c/<slug>` | 1 al handler de `/c/:slug` (HTML) |
| Dibujar el catálogo | 1 a `GET /api/publico/c/:slug` — marca, entrega, pagos, categorías **y la primera página de productos, embebida** |
| Buscar o cambiar de categoría | **0**: se filtra en el navegador sobre la primera página; solo se pide otra si el visitante pide «ver más» |
| Abrir una ficha | 1 |
| Mandar el pedido | 1 |

O sea: mirar y no comprar son **2**; mirar tres fichas y comprar son **6**. Con
120/min una IP sostiene **veinte visitas completas por minuto** sobre el mismo
catálogo, que es más de lo que entra por una puerta de gimnasio. El número
medido va a `docs/OPERACION.md` (FR-114) y se recuenta en el corte que cierra la
etapa 1: si la tienda termina pidiendo más de cuatro, el límite sube en el mismo
commit.

**La guardia** (`observabilidad.test.js`, molde `:394-536`) verifica **cuatro
posiciones y una atadura**, y devuelve `null` —o sea falla— si no encuentra
alguna de las líneas:

1. el montaje de `/api/publico` está **después** de `app.use(express.json(`;
2. está **después** de `app.use('/api/', limiter)`;
3. está **antes** de `app.use('/api', ...authEmpresa`;
4. la declaración de `limiter` contiene un `skip` que nombra `'/publico/'`;
5. **la atadura**: si existe el `skip`, existe `limitadorPublico` y está en la
   línea del montaje. Un prefijo eximido del límite global y sin límite propio es
   la superficie abierta que esta guardia existe para impedir.

### 3 · El resolvedor de tenant devuelve `req.publico`, y `req.empresaId` queda sin definir a propósito

**Se eligió**: `apps/api/src/utils/tenantDeSlug.js`, con una sola función:

```js
/**
 * Slug → { empresaId, catalogoId, puntoDeVentaId, estado } | null
 *
 * Cuatro columnas y ninguna más: la lista de `attributes` es la primera
 * proyección explícita del camino público, y la que garantiza que nada de la
 * fila del catálogo salga de acá por accidente.
 */
async function resolverCatalogoPorSlug(slug, { transaction } = {})
```

Adentro: `normalizarSlug(slug)` —la **misma** función pura que usa el formulario
del panel y la validación del alta— y un
`Catalogo.findOne({ where: { slug }, attributes: ['id','empresa_id','punto_de_venta_id','estado'] })`.
No mira `req`, no recibe `req`, y **no puede** leer una cabecera aunque alguien
quiera: no tiene acceso a ninguna.

Encima va el middleware `contextoPublico`, en el propio router:

```js
req.publico = { slug, empresaId, catalogoId, puntoDeVentaId, catalogo };
```

**`req.empresaId` se deja sin definir, y eso es la decisión.** Cada consulta del
router público escribe `req.publico.empresaId` explícitamente.

**Alternativa descartada**: setear `req.empresaId` en el middleware, que haría
que `scoped(where, req.empresaId)` y `findScoped(M, id, req.empresaId)`
funcionaran igual que en cualquier ruta privada — **porque** entonces una copia
de un handler privado **compila y anda**, y la diferencia entre «la empresa la
resolvió el slug» y «la empresa la resolvió el JWT» deja de verse en el código.
Con `req.publico`, una consulta copiada de otro lado **tira 500 en el primer
request** por `assertEmpresaId` (`tenantScope.js:110-118`), que es exactamente
el comportamiento que se quiere: fallar fuerte y temprano. Y además le da a la
guardia estática algo que exigir por nombre: **todo `findScoped`/`scoped` de
`routes/catalogoPublico.js` recibe `req.publico.empresaId` y ninguna otra cosa.**

**Por qué no se reusa `loadEmpresaContext`** (FR-093), con los dos motivos:

1. **Tiene la rama del superadmin** (`auth.js:172-200`): con `X-Empresa-Id` y un
   usuario marcado `es_superadmin`, entra a cualquier empresa **sin membresía**.
   En una superficie sin sesión esa rama no tendría cómo dispararse hoy —no hay
   `req.usuario`— pero la función es de 250 líneas y la siguiente persona que la
   toque no va a saber que además la usa un endpoint público.
2. **Necesita `req.userId` y cuesta cuatro o cinco consultas** por request,
   incluida la carga de permisos. El público resuelve con **una**, y de cuatro
   columnas.

### 4 · El `switch` de la suscripción se extrae a una función pura, y el camino público cierra ante un error

**Se eligió**: sacar el `switch` de `checkSubscription.js:85-115` a
`apps/api/src/utils/estadoDeSuscripcion.js`:

```js
/** @returns {{ bloqueado: boolean, motivo: string|null }} */
function evaluarSuscripcion(sub, ahora = new Date())
```

Lo importan **los dos** caminos. `checkSubscription.js` queda igual por fuera
—mismos 402, mismos mensajes, mismo `catch` que deja pasar— y por dentro
delega. Eso es lo que hace verificable FR-110: no hay una segunda lista de
estados, hay **una**, y su test de función pura cubre los cinco casos del enum
más el desconocido.

**Alternativa descartada**: llamar a `checkSubscription` desde el handler
público como un middleware más, **porque** responde 402 con un `message` que
nombra el problema de pago del comercio —«Tu suscripción venció. Escribinos para
reactivar la cuenta.»— y eso, servido a un socio del gimnasio, le cuenta a un
desconocido que el comercio está en mora. Y porque su `catch` deja pasar, que es
justo lo contrario de lo que el público necesita.

**Cómo responde cada caso** en el camino público:

| Situación | Lectura del catálogo | Crear un pedido |
|---|---|---|
| Suscripción vigente o en gracia | 200, normal | 201 |
| Vencida y la gracia también, o sin fila de suscripción | **200** con `estado: 'no_disponible'` y **sin productos ni precios** | **409 `CATALOGO_NO_DISPONIBLE`**, sin ninguna fila |
| **Error de base al consultar la suscripción** | **503** `NO_DISPONIBLE_POR_UN_MOMENTO` | **503**, sin ninguna fila |

Los dos matices:

- **Vencida devuelve 200 y no 402.** El 402 es un contrato entre la API y
  `apps/web`, que lo intercepta y muestra el aviso de renovación
  (`services/api.js:171-177`). En la tienda no hay nada que renovar y el
  visitante no es el moroso: la tienda dibuja un estado neutro y el cuerpo trae
  el mismo `estado` con el que dibuja «pausado». Un solo camino de dibujo, tres
  estados.
- **El error de base devuelve 503 y no 402** (FR-112a): 402 afirmaría que la
  suscripción venció, y lo que pasó es que **no se pudo saber**. Y se cierra en
  vez de abrir, al revés que la cadena privada: un catálogo caído unos minutos se
  explica; un pedido tomado en nombre de una empresa dada de baja, no. El
  `logger.error` lleva **el slug y la empresa** (FR-112a), para que no sea un
  apagón silencioso.

La asimetría queda escrita en los dos archivos, cada uno nombrando al otro. Un
comentario suelto en uno solo es el que alguien «unifica» seis meses después.

### 5 · La proyección pública es un módulo de objetos literales, y la guardia mira la forma, no los nombres

**Se eligió**: `apps/api/src/utils/vistaPublica.js`, con funciones puras que
arman **objetos literales campo por campo**:

```js
function catalogoPublico(catalogo)                      // marca, entrega, pagos
function productoPublico(fila, precio, opciones)        // la tarjeta y la ficha
function pedidoPublico(pedido, items, whatsappUrl)      // la confirmación
```

Ninguna recibe una instancia de modelo completa por accidente: las consultas del
router traen `attributes: [...]` **como arreglo literal**, así que lo que llega
ya viene recortado, y la proyección es el segundo filtro.

**Alternativa descartada**: `attributes: { exclude: ['cost', 'margin_override', …] }`,
que es más corto de escribir, **porque** es una lista **negra**: el campo que
`Product` gane el mes que viene entra solo a toda respuesta pública y nadie se
entera. Es el mismo motivo por el que se descarta `{ ...producto.toJSON() }`.

**La guardia** (`apps/api/src/tests/proyeccionPublica.test.js`), en tres reglas
y un ancla:

- **Regla A, sobre `utils/vistaPublica.js`**: el archivo **no menciona** ninguno
  de los diez nombres prohibidos —`cost`, `margin_override`, `wholesale_margin`,
  `wholesale_price`, `supplier_id`, `barcode`, `is_active`, `publicable`,
  `empresa_id`, `punto_de_venta_id`— y **no contiene** `...`, `Object.assign`,
  `toJSON`, `Object.keys` ni `for (const k in`. Todo lo que devuelve es un
  literal.
- **Regla B, sobre `routes/catalogoPublico.js`**: todo `res.json(` recibe un
  objeto literal cuyas hojas son llamadas a `vistaPublica.*`, o una llamada a
  `vistaPublica.*` directa. Y todo `attributes:` de ese archivo es un **arreglo
  literal**: `{ exclude:` es un hallazgo.
- **Regla C, las muestras sintéticas**: cuatro fragmentos que la guardia
  **tiene** que marcar (`res.json(producto)`, `{ ...p.toJSON() }`,
  `attributes: { exclude: ['cost'] }`, un `vistaPublica` que nombra `cost`) y dos
  que tiene que dejar pasar. Son lo que sostiene la guardia el día que el
  repositorio ya no tenga el defecto.
- **El ancla**: la guardia encontró al menos N `res.json(` y M `attributes:` en
  el router. Si el número se desploma, el detector dejó de entender la forma y
  las tres reglas estarían pasando sin mirar nada.

**Y el requisito de que no nazca en verde** (FR-097): la guardia se escribe en
el corte **anterior** al del router, con los dos archivos en su lista y **sin que
existan todavía**. Su primera corrida da dos hallazgos, «el archivo NO existe: la
guardia no miró nada», que es el protocolo de `guardiasDeDiseno.test.js:217-238`.
Una guardia que nace en verde es una guardia que no se sabe si mira.

El test de integración recorre **el JSON entero** —objetos anidados y arreglos—
buscando las diez claves, que es la mitad que la guardia estática no puede
contestar (FR-098, criterio 7).

### 6 · El motor de reglas indexa las candidatas una vez, y la cobertura sale de la misma pasada

**Se eligió**: `apps/api/src/utils/reglasDePrecio.js`, función pura, sin base.

**Cómo gana la más específica.** El índice único de la base garantiza **una sola
regla por (catálogo, ámbito, objetivo)**, así que un producto tiene **como mucho
cuatro** candidatas: la suya, la de su marca, la de su categoría y la del
catálogo. «La más específica» es entonces un máximo sobre cuatro elementos con
una escala fija —`producto 4 > marca 3 > categoría 2 > catálogo 1`— y **no hay
empate posible que haya que desempatar inventando una regla**. Las otras tres son
las «pisadas» que la previsualización tacha (`:969`).

**Cómo se calcula la cobertura sin recorrer el catálogo por regla.** Lo ingenuo
es, por cada regla, recorrer los productos para contar a cuántos alcanza: eso es
`O(R × P)` y además obliga a repetir el recorrido en cada pedido de pantalla. En
su lugar:

1. **Una pasada sobre las reglas** arma el índice:
   `{ porProducto: Map<product_id, regla>, porMarca: Map<brand_id, regla>, porCategoria: Map<categoríaNormalizada, regla>, deCatalogo: regla|null }` — `O(R)`.
2. **Una pasada sobre los productos.** Para cada uno, cuatro búsquedas en `Map`
   —`O(1)`— dan sus candidatas; la de mayor especificidad gana. En el mismo paso
   se incrementan **dos contadores por regla**: `alcanza++` en cada candidata y
   `gana++` en la ganadora — `O(P)`.

Total **`O(R + P)`, una sola pasada**, y la cobertura sale **gratis** del mismo
recorrido que la previsualización ya tiene que hacer para calcular los precios.
`resolverPrecios` devuelve `{ porProducto, cobertura }`, y `cobertura` es
`Map<reglaId, { alcanza, gana }>` — que es literalmente «gana en 2 de 4»
(`:942`).

**El universo de la cobertura son los productos del catálogo**, o sea las filas
de `catalogo_productos`, no el inventario entero. Es lo que hace que los números
de la tabla de reglas coincidan con los de la previsualización (criterio 12): si
`M` contara productos que la previsualización no muestra, las dos pantallas
dirían cosas distintas sobre lo mismo.

**La comparación de categoría es una sola función** (FR-079):
`normalizarTexto(s)` en `apps/api/src/utils/textoDeBusqueda.js` —minúsculas, sin
acentos, sin espacios de los bordes—. La usan tres consumidores: el índice de
reglas de categoría, las píldoras de categoría de la tienda y el buscador. Con
dos funciones, `Nutremax` y `NUTREMAX` salen filtrados de una y no de la otra, y
el mismo producto aparece en el catálogo con un precio y en la previsualización
con otro.

**Validación al guardar y no al aplicar** (FR-075): `validarRegla(regla)` es
otra función pura del mismo archivo. Porcentaje fuera de `(0, 100]` y precio fijo
de `$0` se rechazan al escribir. Al **aplicar**, la única guarda que queda es
`Math.max(0, …)`: un descuento que deja el precio en negativo da **cero**, con la
misma forma que `precioConDescuento` (`precios.js:80`).

### 7 · El pedido: doce pasos en un orden que no es negociable

**Se eligió** el molde de `routes/sales.js:311-630`, con dos diferencias
declaradas. El handler vive en `routes/catalogoPublico.js` y **el `Pedido.create`
se queda ahí**: no se muda a un servicio. Es una restricción de arquitectura, no
de estilo — el detector de «padre ajeno» de `aislamientoEmpresas.test.js:867-1044`
recorre `routes/` y `services/` y da por validado el `create` cuando encuentra un
`findScoped` **antes, en el mismo handler**. Mover el create parte el ámbito y
lo deja sin validar a los ojos de la guardia, que es el mismo motivo por el que
el `SupplierMovement.create` del pago sigue en `routes/suppliers.js` (`:1015-1039`).

El orden:

1. **`contextoPublico`** ya resolvió `{empresaId, catalogoId, puntoDeVentaId}`,
   verificó la suscripción y verificó que el estado sea `publicado`. Un catálogo
   en `borrador` da 404; en `pausado` o con la empresa vencida, 409.
2. **Normalizar el cuerpo**, con `utils/pedidoPublico.js` (pura):
   `consolidarLineas(items)` suma el mismo `product_id` repetido (FR-135) y
   rechaza cantidad `≤ 0`, no entera, o mayor que el máximo por línea (999).
   Cualquier `precio`, `subtotal` o `total` que venga en el cuerpo **se descarta
   acá**: la función devuelve `[{ product_id, cantidad }]` y nada más, así que
   el resto del handler no tiene desde dónde leerlos (FR-130).
3. **`t = await sequelize.transaction()`.**
4. **Idempotencia, camino rápido**: `Pedido.findOne({ where: scoped({ idempotency_key }, empresaId), transaction: t })`.
   Si está, `rollback` y se devuelve el mismo cuerpo. Es el camino normal; la
   garantía está en el paso 11.
5. **Validar TODOS los productos, antes de crear nada**, en un bucle explícito
   dentro del handler:
   `findScoped(Product, linea.product_id, req.publico.empresaId, { transaction: t })`
   más una lectura de `catalogo_productos` para ese `(catalogo_id, product_id)`,
   más `is_active`, más `publicable`, más precio resoluble. Cualquiera que falle
   **rechaza el pedido entero** y no deja ninguna fila (FR-132). Un `product_id`
   de otra empresa no resuelve en el `findScoped` y da 404 sin decir si existía.
6. **Resolver el precio de cada línea**: `calcularPrecios` de
   `@favalio/precios` con los ajustes de la empresa —leídos **una vez**, con la
   mezcla de `empresa.settings` y la tabla `settings` que ya hace
   `routes/general.js:527-546`— y después `resolverPrecios` con las reglas
   activas del catálogo, leídas **una vez**. Se congela `precio_unitario`,
   `precio_lista`, `regla_id` y `nombre` (FR-131).
7. **Revalidar stock**, leyendo `available` del punto de venta **del catálogo**:
   `Stock.findOne({ where: { product_id, empresa_id, punto_de_venta_id }, transaction: t })`,
   **sin `lock`**. Línea con `available <= 0` → se quita; con
   `available < cantidad` → **se recorta a lo que hay** (decisión 6a de la spec).
   Sin fila de stock → agotado, y no es un error. `available` negativo → se trata
   como cero y se registra.
8. **Si quedaron cero líneas**: `rollback`, **no se crea ningún pedido**
   (FR-139), y se responde 409 con el detalle de lo que se cayó, para que la
   tienda dibuje «se agotó mientras compraba» con las líneas tachadas.
9. **Total**: `utils/totalDePedido.js` (pura). Subtotal de las líneas, envío
   según la configuración del catálogo, **gratis con `subtotal >= umbral`** —el
   borde se prueba en el borde (FR-143)— y umbral vacío o cero significa «no hay
   envío gratis».
10. **`Customer`**: se busca por teléfono normalizado, `scoped` a la empresa del
    **resolvedor**, y se crea o actualiza con ese `empresa_id` y nunca con uno
    del cuerpo (FR-150).
11. **Número y `Pedido.create`**, en esta transacción. Ver más abajo.
12. **`commit`**, y **después** los avisos, fuera de la transacción.

**Los dos apartamientos del molde de `sales.js`**, escritos:

- **Sin `lock` en la lectura de stock.** `sales.js:518-526` toma
  `lock: t.LOCK.UPDATE` porque va a descontar. Acá no se descuenta nada
  (FR-140), así que el lock solo serviría para hacer esperar a dos compradores
  por una fila que ninguno va a modificar. **Consecuencia dicha en voz alta**:
  dos personas piden la última unidad al mismo tiempo y **los dos pedidos se
  crean**. Está en la spec (US14 escenario 8) y el comercio lo resuelve por
  WhatsApp.
- **El total no se compara contra un declarado.** `sales.js:355` verifica el
  total que manda el cliente y rechaza si no cierra. Acá el cliente **no manda
  ninguno**: el paso 2 lo tira. No hay nada contra qué comparar, y una
  comparación con un campo opcional sería una puerta para fijar el precio desde
  afuera.

**La numeración** (FR-137, FR-137a), dentro de la misma transacción:

```sql
SELECT pg_advisory_xact_lock(947214, :empresaId);
SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM pedidos WHERE empresa_id = :empresaId;
```

**Se eligió el advisory lock de transacción**, no una fila bloqueada.
`pg_advisory_xact_lock` se libera solo al commit o al rollback —no hay forma de
olvidarse de soltarlo— y **no toca ninguna fila de negocio**. La técnica ya está
en el repositorio: `apps/api/scripts/migrar.js:41` toma un advisory lock con
`LOCK_ID = 947213`; acá es el `947214`, el siguiente, para que los dos números
se busquen juntos el día que alguien se pregunte de dónde salieron.

**Alternativas descartadas**:
- `SELECT … FROM empresas WHERE id = :id FOR UPDATE`, **porque** bloquea la fila
  de una tabla que otras escrituras podrían querer tocar, y ata la numeración de
  los pedidos a la vida de una fila que no tiene nada que ver con pedidos.
- **Una secuencia de Postgres por empresa**, **porque** exige DDL en tiempo de
  ejecución —crear una secuencia al crear cada empresa— y deja huecos ante un
  rollback. FR-137 pide 1, 2, 3, no «los que salieron».
- **`SELECT MAX(numero) + 1` sin candado**, que es lo que uno escribe primero,
  **porque** dos pedidos simultáneos de la misma empresa leen el mismo máximo,
  y el segundo choca contra el `UNIQUE (empresa_id, numero)` y el comprador ve un
  error después de haber apretado «Confirmar». La spec lo prohíbe explícitamente.

`UNIQUE (empresa_id, numero)` es la **red**, no el mecanismo: ante colisión —que
con el candado no debería ocurrir— se reintenta **una vez** y, si vuelve a
chocar, sale por `fallo()`. Nunca se emite un número repetido. Dos empresas
distintas con el pedido `#1` al mismo tiempo es correcto y esperado.

**La idempotencia** (FR-136) se sostiene en el `UNIQUE` de `idempotency_key`, no
en el `findOne` del paso 4: en el `catch`, un `SequelizeUniqueConstraintError` se
relee con `findOne` scopeado —el que ganó ya commiteó, porque Postgres hizo
esperar al perdedor en el índice— y se devuelve **el mismo cuerpo** que la
primera vez. Es el molde de `sales.js:599-624`, con su comentario.

**Los avisos, después del commit y con su resultado en la respuesta.** Se
`await`ean dentro de su propio `try`: el pedido ya existe y un fallo del correo
no lo toca (FR-181), pero la respuesta lleva `email_enviado: boolean` porque es
lo que le permite a la pantalla **no** prometer un email que no salió (FR-182,
H8). Un `fire and forget` haría imposible ese requisito: la respuesta saldría
antes de saber.

### 8 · `/c/:slug` lo sirve la API pidiéndole el HTML al servicio `tienda`, y el Caddyfile solo enruta

**Se eligió** el tercer router exportado, `paginas`, montado en `/c` (decisión 2)
y con este handler:

1. Resuelve el slug con el **mismo** resolvedor y las **mismas** reglas de
   visibilidad (FR-117b).
2. Pide `GET http://tienda/index.html` por la red interna del compose, con
   `timeout` —lo exige la guardia de llamadas salientes de `observabilidad.test.js`—
   y lo guarda en memoria con TTL de **60 segundos**. Una visita normal cuesta
   cero peticiones extra; un deploy de la tienda tarda a lo sumo un minuto en
   verse.
3. Reemplaza el marcador `<!--FAVALIO_META-->` del `<head>` por las cinco
   etiquetas: `og:title`, `og:description`, `og:image`, `og:url` y
   `<meta name="robots" content="noindex, nofollow">`.
   **Un marcador y no una expresión regular sobre `<head>`**: si el marcador
   desapareció, el handler sirve el HTML **sin** metadatos y lo registra, en vez
   de servir un documento roto o no servir nada.
4. Agrega la cabecera `X-Robots-Tag: noindex, nofollow` (FR-116), que es lo que
   cubre lo que no es HTML.
5. **Visibilidad**: catálogo `publicado` → metadatos del catálogo. `borrador` o
   slug inexistente → **404** con el mismo documento y metadatos **genéricos de
   Favalio**, indistinguibles entre sí (FR-055). `pausado` o empresa vencida →
   200 con metadatos genéricos: el socio tiene que reconocer que llegó al lugar
   correcto, pero el enlace compartido no muestra la portada de una tienda que no
   vende.
6. **Si el servicio `tienda` no responde**: 503 con una página propia de una
   línea, y `logger.error`. Servir un HTML inventado sin el `<script>` del bundle
   sería una página en blanco sin explicación.

**El Caddyfile**, quinto bloque:

```
tienda.{$DOMINIO} {
	encode gzip
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	header X-Robots-Tag "noindex, nofollow"

	# Las fotos salen del volumen. No las sirve la API (FR-023): un proceso de
	# Node sirviendo archivos estáticos compite con las cajas del comercio.
	handle_path /img/* {
		root * /var/favalio/imagenes
		file_server
		header Cache-Control "public, max-age=31536000, immutable"
	}

	# El catálogo público, en el MISMO origen que la tienda: sin CORS de por
	# medio no hay preflight que fallar en silencio.
	handle /api/publico/* {
		reverse_proxy api:5000
	}

	# Todo /c/* al handler: cada URL de la tienda lleva el slug adentro, así
	# que cada una recibe los metadatos de SU catálogo.
	handle /c/* {
		reverse_proxy api:5000
	}

	handle {
		reverse_proxy tienda:80
	}
}
```

**La tienda habla con la API por su propio origen** (`/api/publico/...`,
relativo), no contra `api.favalio.com`. Se gana que no haya CORS: ni preflight,
ni el modo de falla que la spec advierte —«sin esto falla en silencio, del lado
del navegador»—. **`https://tienda.${DOMINIO}` se agrega igual a
`ALLOWED_ORIGINS`** en `docker-compose.produccion.yml:89`, por interpolación
(FR-118): es de un renglón, y cubre el día que alguien mueva el `handle` o
apunte la tienda al dominio de la API.

**Alternativa descartada** para el enrutado: que `/c/:slug` viva bajo
`/api/publico/pagina/:slug` y Caddy lo reescriba, **porque** pone la forma de la
URL pública en dos archivos, y FR-117a pide explícitamente que el Caddyfile no
haga nada más que enrutar.

**`robots.txt`** (FR-116) sale de `apps/tienda/public/robots.txt` por el `handle`
final, con `Disallow: /c/`.

### 9 · Las imágenes: un volumen, `sharp` como validador, nombre aleatorio sin empresa en la ruta, y el respaldo en el mismo commit

**Se eligió**:

- **Volumen** `imagenes_favalio`, montado en la API en `/var/favalio/imagenes`
  (lectura y escritura) y en **Caddy** en `/var/favalio/imagenes:ro`. La ruta es
  absoluta y sale de la variable `RUTA_DE_IMAGENES`, no del `WORKDIR` del
  contenedor —que cambia con los workspaces—.
- **Disposición**: `<aa>/<bb>/<nombre>.jpg`, donde `aa` y `bb` son los cuatro
  primeros caracteres del nombre aleatorio. **El `empresa_id` no va en la ruta**:
  incluirlo permitiría enumerar qué empresas existen probando directorios, que es
  media vuelta al problema que FR-026 viene a cerrar. El abanico de dos niveles
  existe para que ningún directorio junte cien mil entradas.
- **El nombre** sale de `crypto.randomBytes(16).toString('hex')`, el molde de
  `Invitacion.js:24-29`. Público por URL sí, enumerable no (FR-026a).
- **`sharp` es lo que valida** (FR-024): si `sharp(buffer).metadata()` tira, no
  es una imagen, y no importa la extensión ni el `Content-Type` que declaró el
  cliente. Una medida por uso, sin `srcset` ni WebP negociado:

  | Uso | Medida | Formato |
  |---|---|---|
  | Foto de producto | 800×800, `fit: 'inside'`, `withoutEnlargement` | JPEG q82 |
  | Portada del catálogo | 1200×480 | JPEG q82 |
  | Logo del catálogo | 400×400 | **PNG**, para conservar el fondo transparente que la pantalla pide (`:804`) |

- **La escritura es atómica**: se escribe en un temporal del mismo volumen y se
  `rename`. Es lo que impide que una imagen que se corta a la mitad deje un
  archivo incompleto que Caddy después sirve roto.
- **multer** con `memoryStorage` y `limits: { fileSize: 5 * 1024 * 1024 }`, más
  el manejador de errores del molde de `routes/empresas.js:178-180`, para que
  `LIMIT_FILE_SIZE` salga como `ErrorDeNegocio` **diciendo cuál es el límite** y
  no como el 500 de multer que nombra el campo del formulario (FR-025).
- **`products.image_url` guarda la ruta relativa** (`/img/aa/bb/xxx.jpg`), no la
  URL absoluta. Mudarse de dominio no exige una migración de datos, y —lo que
  importa más— hace verificable FR-030 con una **función pura**:
  `esImagenPropia(url) === url.startsWith('/img/')`. La usan la proyección
  pública, que no dibuja las externas, y la pestaña Productos del panel, que las
  marca «foto externa, no se publica».
- **Borrar** la imagen la borra del volumen **y** de `image_url`; borrar el
  producto la borra también, en el mismo camino. Un `unlink` que falla se
  registra y no aborta el borrado: un archivo huérfano es un problema de disco, y
  un producto que no se puede borrar es un problema del usuario.

**Alternativa descartada**: el camino de `routes/empresas.js:47-51` —data URI
base64 en una columna—, **porque** un catálogo de suplementos con sesenta fotos
mete decenas de megabytes en la base, que es lo mismo que meterlos en cada
`pg_dump` diario y en cada respaldo de los catorce días que se conservan.

**`deploy/respaldo.sh`** (FR-027), en el **mismo cambio que crea el volumen**:

```sh
ARCHIVO_IMG="$DESTINO/favalio-imagenes-$(date +%Y-%m-%d-%H%M).tar.gz"
docker run --rm -v favalio_imagenes_favalio:/datos:ro alpine \
  tar -czf - -C /datos . > "$ARCHIVO_IMG"

# Un tar.gz de un volumen VACÍO pesa ~45 bytes, así que `-s` no distingue
# «vacío» de «cortado». Lo que sí lo distingue es que el archivo se pueda leer
# entero: un tar truncado falla al listarse.
if ! tar -tzf "$ARCHIVO_IMG" > /dev/null 2>&1; then
  echo "$(date -Is) RESPALDO DE IMAGENES ILEGIBLE: $ARCHIVO_IMG" >&2
  exit 1
fi

find "$DESTINO" -name 'favalio-imagenes-*.tar.gz' -mtime "+$DIAS_A_CONSERVAR" -delete
```

Un volumen vacío es legítimo —el primer día no hay fotos— así que lo que se
verifica no es el tamaño sino que el archivo se pueda **leer entero**, que es el
modo de falla real. Y el procedimiento de restauración va a `docs/OPERACION.md`
(FR-028): un respaldo que nadie restauró no es un respaldo.

**La guardia**: `apps/api/src/tests/respaldoDeImagenes.test.js` lee
`deploy/respaldo.sh` como texto y exige que nombre el volumen, que verifique el
resultado y que rote con el mismo `DIAS_A_CONSERVAR` que la base. Es el molde de
las guardias que leen `ci.yml`.

### 10 · `apps/tienda` tiene su propio arnés de Playwright, a 390px

**Se eligió** esta estructura:

```
apps/tienda/
  package.json            favalio-tienda · type: module · dependencies: react, react-dom
  vite.config.js          server.port 5175 strictPort · test: jsdom
  index.html              con <!--FAVALIO_META--> en el <head>
  public/robots.txt
  nginx.conf              copia del de apps/web
  Dockerfile              contexto en la raíz, mismo molde que apps/landing
  playwright.config.js    viewport 390×844, su propio webServer y su globalSetup
  src/
    main.jsx  App.jsx     rutas: /c/:slug · /p/:id · /carrito · /checkout · /confirmado/:numero
    api.js                cliente HTTP propio, fetch nativo
    tema.js               textoSobre() + las dos variables CSS
    carrito.js            el carrito en localStorage — función pura + hook
    pantallas/            Catalogo, Ficha, Carrito, Checkout, Confirmado
    estados/              Cargando, Pausada, SinResultados, CarritoVacio,
                          PagoRechazado, SeAgoto, NoDisponible, DemasiadasPeticiones
    tests/                render con jsdom
  pruebas-de-navegador/
    anchoDeLaTienda.navegador.js
```

**El cliente HTTP es `fetch` nativo, no axios** (FR-120). Treinta líneas, sin
interceptores, sin `Authorization`, sin `X-Sesion-Id` y sin el manejo de 401 que
dispara el logout (`apps/web/src/services/api.js:150-167`). **Alternativa
descartada**: copiar `services/api.js` y sacarle lo que sobra, **porque** lo que
sobra es exactamente lo que no se puede tener, y un archivo que arranca teniendo
las tres cosas y se las quita es un archivo al que alguien se las devuelve
copiando de la app privada. Un `fetch` de treinta líneas no puede heredar una
cabecera de sesión por accidente.

**La guardia** (`apps/tienda/src/tests/guardiaDeLaTienda.test.js`) recorre
`apps/tienda/src` y falla si aparece `Authorization`, `X-Sesion-Id`, `auth0`,
`@/services/api`, `localStorage.getItem('token')` o un hexadecimal de color. Y
tiene su ancla: encontró los N archivos que dice revisar.

**El tema por catálogo**: la respuesta trae `color_marca`. Al montar, `tema.js`
escribe **dos** variables en `document.documentElement`: `--marca` y
`--marca-texto`, la segunda calculada con `textoSobre()` —la función de la
maqueta (`:1211-1218`), portada tal cual, con su test de función pura sobre los
cuatro colores de prueba de `:55-58`—. Los componentes usan `var(--marca)` y
**nunca** un hex, que es lo que hace verificable «el color solo en lo que se
toca»: el hex está prohibido por la guardia, y `--marca` se define en un solo
archivo.

**Cómo se prueba a 390px**, que es la pregunta de la spec:

`apps/web/playwright.config.js` corre **solo** a 1920×1080 (`:112`, `:123`) y su
`webServer` levanta el servidor de desarrollo de `apps/web` con
`FAVALIO_SESION_DE_PRUEBA=1`. **Se eligió un `playwright.config.js` propio en
`apps/tienda`**, con `viewport: { width: 390, height: 844 }`, su `webServer`
(`vite --port 5175 --strictPort`) y su `globalSetup`.

**Alternativa descartada**: un segundo `project` y un segundo `webServer` en el
config de `apps/web`, **porque** ese arnés existe alrededor del bypass de sesión
—el alias de `vite.config.js`, el `ProveedorDeSesionDePrueba.jsx`, las tres
guardias que verifican que eso **no exista** en un bundle—. La tienda **no tiene
sesión que falsear**, y eso es su propiedad definitoria; meterla en el arnés que
la falsea es arrastrarle una pieza que su guardia tiene que prohibir. Además
`workers: 1` y `fullyParallel: false` son de aquel config por un motivo suyo —dos
archivos sobre el mismo catálogo sembrado— y la tienda no tiene por qué heredar
la lentitud.

**Qué se mide ahí y nada más** (FR-121, criterio 17): que el `<body>` no desborde
a lo ancho en catálogo, ficha, carrito y **los tres pasos** del checkout.
Cualquier otra cosa —qué dice cada estado, que la casilla arranque desmarcada,
que el botón «Sin stock» sea inerte, que el renglón de la marca no diga
`undefined`— es **test de render con jsdom**, porque no necesita motor de
maquetado y en el navegador cuesta cincuenta veces más. La regla de
`CONVENCIONES.md` no se relaja por ser una app nueva.

**La siembra**: `globalSetup` propio que, contra la API descartable con
`BYPASS_AUTH`, crea un catálogo publicado con slug conocido y **tres productos
elegidos para poder distinguir defectos**: uno sin marca, uno sin foto y uno con
`available = 0` y `quantity > 0`.

**El job de CI** `Tienda — tests y build` es el gemelo de `navegador`: Postgres,
migraciones, API con bypass, `npm run build -w apps/tienda`,
`npm test -w apps/tienda` y `npx playwright test`. **Alternativa descartada**:
sumarle la tienda al job `navegador`, **porque** ese ya es el más lento del CI
—Chromium de 115 MB, base, API— y agregarle un segundo servidor y un segundo
recorrido lo pone en el camino crítico de cada push. Como job aparte corre en
paralelo y el CI sigue tardando lo que tarda el más lento.

### 11 · El gate de módulo se cierra en la API, pero solo para el catálogo

**Verificado, no supuesto**: `enabled_modules` tiene **cero apariciones** en
`apps/api/src`. La única línea del servidor que toca los settings de la empresa
es `middleware/auth.js:224`, que los expone como `req.empresaSettings`, y **nadie
los lee**. O sea que hoy el gate de módulo **existe únicamente en el navegador**:
`navegacion.js:212-228` y `RouteGuard` (`App.jsx:61-65`).

**Se eligió**: crear `apps/api/src/middleware/requireModulo.js` y aplicarlo
**solo a `/api/catalogos` y `/api/pedidos`**:

```js
app.use('/api/catalogos', ...authEmpresa, requireModulo('catalogo'), require('./routes/catalogos'));
app.use('/api/pedidos',   ...authEmpresa, requireModulo('catalogo'), require('./routes/pedidos'));
```

Tres detalles del middleware, cada uno con su motivo:

1. **Sin lista declarada, pasa.** `enabled_modules` ausente o no-arreglo
   significa «esta empresa tiene todo», que es el estado de todas las empresas de
   hoy. Cerrar por ausencia apagaría el sistema entero en el primer deploy.
2. **Responde 404, no 403.** Es el mismo motivo escrito en `server.js:472-476`
   para `requireSuperadmin`: un 403 confirma que el módulo está ahí y solo
   oculto.
3. **Replica la excepción del dueño** de `App.jsx:59` (`owner_auth0_sub`). No es
   una concesión: sin ella, `RouteGuard` deja entrar al dueño de una empresa sin
   el módulo y la API le contesta 404 a todo, o sea una pantalla rota llena de
   errores — exactamente el modo de falla que el comentario de `RouteGuard`
   describe al revés. Los dos lados dicen lo mismo o el gate miente en uno de los
   dos. Hay un test que ata las dos ramas.

**Se eligió NO aplicarlo retroactivamente** a TiendaNube ni a ningún otro
módulo, y esto es lo que hay que escribir: `enabled_modules` no tiene hoy
**ninguna** semántica probada del lado del servidor, así que encenderlo para
once endpoints de una integración en producción, dentro de una funcionalidad que
no es de ella, es cambiar el comportamiento de un cliente por un efecto
colateral. Queda anotado como deuda, con el mismo tratamiento que H12.

**Alternativa descartada**: leer `enabled_modules` dentro de cada handler,
**porque** son dieciséis endpoints y basta olvidarse en uno. Un middleware en la
línea del montaje se ve en `server.js`, que es donde `montajeDeRouters` y
`permisosDeRutas` ya miran.

### 12 · Ninguna asociación nueva con `empresa_id`, y por eso el ancla `toBe(3)` no se mueve

**Se eligió**: los cinco modelos nuevos —`Catalogo`, `CatalogoProducto`,
`CatalogoReglaPrecio`, `Pedido`, `PedidoItem`, `CatalogoVisita`— se **exportan**
desde `models/index.js` —o `scripts/verificar-esquema.js` no los mira
(FR-212)— y se declara **una sola** asociación: `Pedido.hasMany(PedidoItem)` /
`PedidoItem.belongsTo(Pedido)`.

Eso es lo que hace que `aislamientoEmpresas.test.js:1136`
—`expect(deHijos.length).toBe(3)`— **no se mueva**: ese detector cuenta includes
de hijos **con `empresa_id`**, y `pedido_items` **no lleva `empresa_id`**, igual
que `sale_items`. La bandeja puede traer el detalle con `include` sin tocar el
ancla.

**Que `pedido_items` no lleve `empresa_id` es la decisión, y el motivo es doble**:
la tabla solo se alcanza a través de su padre, que sí está scopeado, así que la
columna sería redundante; y agregarla obligaría a mover un ancla cuyo único
trabajo es no moverse.

Para `catalogo_productos` y `catalogo_reglas_precio` —que sí llevan
`empresa_id`, porque el ABM las busca por id— **no se declara ninguna
asociación**, y las filas se leen planas y se unen en JS. Es el patrón que
`models/index.js:39-48` ya documenta para los cinco de TiendaNube. Y acá no
cuesta nada: el motor de reglas es una función pura que **ya recibe arreglos
planos**, así que un `include` no ahorraría ni una línea.

⚠ **Escrito para el futuro**: el día que alguien declare
`Catalogo.hasMany(CatalogoReglaPrecio)` y lo use en un `include`, el ancla pasa
de 3 a 4 y **hay que actualizarla con el motivo al lado, nunca rodearla**.

### 13 · `pedidos.origen` y la columna «Canal»: dos bandejas honestas antes que una mentirosa

**Se eligió**: `pedidos` lleva `origen` ENUM con **un solo valor por ahora**,
`catalogo`, y la bandeja dibuja una columna **«Canal»** al lado del filtro
«Catálogo: todos» que la maqueta ya trae (`:1085`). Hay un índice
`(empresa_id, origen, created_at DESC)` para que filtrar por canal no barra la
tabla el día que haya un segundo valor.

Una columna con un solo valor parece decoración y no lo es: es lo que hace que
el día que entre un segundo canal **no haya que migrar datos ni tocar la
pantalla**. Agregar `origen` después significa una migración con backfill sobre
pedidos reales y una columna que la bandeja no sabía dibujar.

**Alternativa descartada: una bandeja única desde el día uno**, que traiga
también los pedidos de TiendaNube — **porque** obligaría a resolver el pendiente
12c de `PROXIMOS-PROYECTOS.md` **dentro de esta spec**. `tiendanube_pedidos` no
es una bandeja: es **el libro de idempotencia del webhook de stock**. Su propio
encabezado lo dice (`models/TiendanubePedido.js`): la fila se inserta *dentro*
de la transacción que descuenta, el `SequelizeUniqueConstraintError` de
`uq_tn_pedido` es lo que sostiene la garantía cuando llegan dos entregas del
mismo webhook a la vez, y **esas filas no se borran nunca** porque un pedido
borrado es un pedido que se puede volver a descontar. No tiene comprador, ni
total, ni estado, ni entrega, ni medio de pago.

Unificar hoy daría una tabla donde media docena de filas tienen todo y las otras
tienen guiones en seis columnas — y una fila con guiones no es un pedido que
alguien pueda operar: no se le puede cambiar el estado, no se lo puede marcar
cobrado, no se sabe a quién llamar. **Dos pantallas honestas antes que una que
promete una bandeja y entrega una lista.**

### 14 · Los permisos, el menú y las cuatro listas de `apps/web`

**Se eligió** lo que fija la decisión 8 de la spec, sin desvíos:

```js
// seedPermissions.js — cuatro más, con el formato de los 50 que ya están
{ codigo: 'catalogo.ver',      nombre: 'Ver catálogos',            modulo: 'catalogo' },
{ codigo: 'catalogo.editar',   nombre: 'Editar catálogos',         modulo: 'catalogo' },
{ codigo: 'pedidos.ver',       nombre: 'Ver pedidos online',       modulo: 'pedidos'  },
{ codigo: 'pedidos.gestionar', nombre: 'Gestionar pedidos online', modulo: 'pedidos'  },
```

`admin` los recibe por `ROLE_PERMISOS.admin = PERMISOS.map(…)` (`:83`), sin
tocar nada. `gerente` suma los cuatro explícitos; `vendedor`, solo
`pedidos.ver` y `pedidos.gestionar`; `produccion` y `compras`, ninguno.

**No se reusan `config.ver` / `config.editar`** (FR-190). El motivo escrito:
TiendaNube arrastra el pendiente 12b justamente por eso, y `config.editar` es lo
que abre el certificado de AFIP — el que prepara pedidos no tiene por qué verlo.

**El menú** (`components/navegacion.js`), grupo nuevo «Venta online»:

```js
{ to: '/catalogos', label: 'Catálogos', permission: 'catalogo.ver', modulo: 'catalogo', alcance: 'empresa' },
{ to: '/pedidos',   label: 'Pedidos',   permission: 'pedidos.ver',  modulo: 'catalogo', alcance: 'empresa' },
```

`alcance: 'empresa'` en las dos: un catálogo declara **su** punto de venta
adentro, así que cambiar la sucursal de arriba no cambiaría nada en ninguna de
las dos pantallas, y un control que se dibuja y no hace nada es lo que el hito 9
corrigió en ocho pantallas (`REGLAS-DISENO.md`, «El selector de sucursal»).

Y el título de la pantalla tiene que decir **exactamente** «Catálogos» y
«Pedidos», porque `guardiasDeSrc.test.js:677-679` compara el `label` del menú
contra el `titulo` del `PageHeader` por igualdad.

### 15 · El slug se normaliza con una sola función, y el viejo muere sin dejar rastro

**Se eligió**: `apps/api/src/utils/slugDeCatalogo.js`, pura, con tres cosas:

```js
function normalizarSlug(texto)   // minúsculas, sin acentos, [a-z0-9-], sin guiones repetidos ni en los bordes
function validarSlug(slug)       // largo 3..60, no reservado → { ok, motivo }
const RESERVADOS = ['c', 'api', 'assets', 'admin', 'robots.txt', 'favicon.ico', 'img', 'static', 'public']
```

**La misma función la usa el formulario del panel y el servidor** (FR-051). No es
prolijidad: si el formulario propone `comprafit-fitnet` y el servidor guarda otra
cosa, el usuario apretó «Publicar» sobre una dirección y quedó publicada otra —y
esa dirección se imprime en una pared—. La función vive en `apps/api` y
`apps/web` **la duplicaría**, así que va donde ya hay lugar: **en
`packages/precios` no**, porque el paquete se llama por lo que hace. Va en
`apps/api/src/utils/` y `apps/web` la consume por una **guardia de texto**, del
mismo molde que `apps/web/src/tests/mediosDePago.test.js:46`, que lee el archivo
del otro paquete y compara la lista de reservados y el regex.

> Es un caso donde la copia sí se acepta y hay que decir por qué: la
> normalización de un slug son ocho líneas sin dependencias, la guardia que las
> ata ya tiene molde en el repositorio, y crear un tercer paquete compartido para
> ocho líneas engorda el corte de workspaces —que es el más peligroso del hito—
> sin resolver ningún problema que la guardia no resuelva. Si mañana aparece una
> tercera regla compartida, ahí sí nace `packages/comun`.

**El slug es único global** por índice de la base (FR-050), y el choque llega
como `ErrorDeNegocio` que **no dice de quién es** (FR-053). Lo garantiza el
índice, no un `findOne` previo: dos empresas pidiendo el mismo slug al mismo
tiempo pasan las dos por el `findOne`.

**Cambiar el slug mata el viejo** (decisión 11 de la spec): sin tabla de alias,
sin redirección, sin reserva. El enlace anterior devuelve el mismo 404 público
que un slug inexistente y el nombre vuelve al espacio de nombres global. La
pantalla avisa **antes de guardar** y pide confirmación explícita, porque el QR
está pegado en una pared.

**Alternativa descartada**: una tabla `catalogo_slugs_viejos` con redirección,
**porque** obliga a decidir por cuánto tiempo vive cada alias —y cualquier
respuesta es arbitraria— y mientras vive sigue ocupando el espacio de nombres
global, o sea que cambiar de slug le seguiría bloqueando el nombre a otro
comercio.

### 16 · `catalogo_productos` es una lista de inclusión, y borrar un catálogo con pedidos se rechaza

**Se eligió** lo que fija la decisión 9 de la spec: estar en la tabla **es**
estar en el catálogo. No se crea `catalogos.incluye_todos`, no se crea
`catalogo_productos.visible`, y quitar un producto **borra su fila**.

El motivo, que conviene tener escrito porque `incluye_todos` es lo que uno
escribe primero: con «todos los publicables», una importación de CSV de
cincuenta productos —que es una operación de inventario, no de catálogo— publica
cincuenta productos en una página pública sin que nadie lo decida. Y `visible`
sería una **tercera** bandera, además de `publicable` e `is_active`, para decir
lo mismo que decir que la fila no exista.

El costo es real y hay que pagarlo: armar el catálogo el primer día son 62
clics. Por eso las **acciones masivas** de la pestaña Productos (FR-066) no son
un adorno de la maqueta sino parte de lo que hace usable la decisión.

**Borrar un catálogo con pedidos se rechaza**, con `ErrorDeNegocio` que ofrece
pausarlo (FR-069). En la base, `pedidos.catalogo_id` es
`ON DELETE RESTRICT` — la garantía la da el motor, y el mensaje legible lo da el
handler. Un catálogo **sin** pedidos sí se borra, en cascada sobre
`catalogo_productos`, `catalogo_reglas_precio` y `catalogo_visitas`.

---

## Project Structure

### Archivos nuevos

**Paquetes compartidos**

| Archivo | Qué |
|---|---|
| `packages/precios/package.json` · `index.js` · `index.test.js` · `vitest.config.js` | La fórmula, mudada de `apps/web/src/utils/precios.js`, con sus 21 casos |
| `packages/pedido/package.json` · `index.js` · `index.test.js` | `normalizarTelefono` y `armarTextoPedido`, mudadas de `apps/web/src/utils/pedidoWhatsapp.js` (hallazgo 4). **Etapa 2** |

**API — funciones puras (`apps/api/src/utils/`)**

| Archivo | Qué |
|---|---|
| `slugDeCatalogo.js` | `normalizarSlug`, `validarSlug`, `RESERVADOS`, `slugDeLaRuta` |
| `reglasDePrecio.js` | `reglaQueGana`, `aplicarRegla`, `resolverPrecios` (precio + cobertura en una pasada), `validarRegla` |
| `textoDeBusqueda.js` | `normalizarTexto` — la **única** comparación de categoría y de búsqueda |
| `estadoDeSuscripcion.js` | `evaluarSuscripcion(sub, ahora)`, extraída de `checkSubscription.js:85-115` |
| `totalDePedido.js` | Subtotal, envío con umbral `>=`, total |
| `estadoDePedido.js` | Las transiciones permitidas entre los seis estados; `cancelado` terminal |
| `pedidoPublico.js` | `consolidarLineas`, `validarComprador`, `esImagenPropia` |
| `vistaPublica.js` | `catalogoPublico`, `productoPublico`, `pedidoPublico` — objetos literales |
| `tenantDeSlug.js` | `resolverCatalogoPorSlug` |
| `imagenes.js` | `nombreAleatorio`, `rutaDeImagen`, `redimensionarYGuardar` (usa `sharp`) |

**API — routers, middleware, modelos, migraciones**

| Archivo | Qué |
|---|---|
| `routes/catalogoPublico.js` | `module.exports = { publico, paginas }` — lectura pública, pedido, y el HTML de `/c/:slug` |
| `routes/catalogos.js` | Privado: ABM, reglas, productos del catálogo, previsualización, visitas |
| `routes/pedidos.js` | Privado: bandeja, detalle, cambio de estado |
| `middleware/requireModulo.js` | El gate de módulo que hoy no existe en la API |
| `models/Catalogo.js` · `CatalogoProducto.js` · `CatalogoReglaPrecio.js` · `CatalogoVisita.js` · `Pedido.js` · `PedidoItem.js` | Seis modelos, exportados desde `models/index.js` |
| `migrations/20260814-productos-publicables.js` | `products.publicable` + índice de `customers` |
| `migrations/20260815-catalogos.js` | `catalogos` |
| `migrations/20260816-catalogo-productos-y-reglas.js` | Las dos tablas hijas |
| `migrations/20260817-catalogo-visitas.js` | El contador agregado |
| `migrations/20260818-pedidos.js` | `pedidos` + `pedido_items` |
| `plantillas/` (dos plantillas de Resend) | Aviso al comercio y confirmación al comprador |

**API — tests**

`src/tests/`: `paqueteDePrecios.test.js`, `proyeccionPublica.test.js`,
`respaldoDeImagenes.test.js`, `slugDeCatalogo.test.js`,
`reglasDePrecio.test.js`, `totalDePedido.test.js`, `estadoDePedido.test.js`,
`estadoDeSuscripcion.test.js`, `pedidoPublico.test.js`, `requireModulo.test.js`.
`src/tests/integracion/`: `catalogoPublico.integracion.test.js`,
`pedidoPublico.integracion.test.js`, `bandejaDePedidos.integracion.test.js`.

**Web (`apps/web/src/`)**

`pages/Catalogos.jsx`, `pages/Pedidos.jsx`, `components/ReglasDePrecio.jsx`,
`components/ProductosDelCatalogo.jsx`, `components/QrDelCatalogo.jsx`,
`components/PanelDePedido.jsx`, `utils/catalogos.js` (el tono del badge, pura),
y sus tests de render.

**Tienda (`apps/tienda/`)**: la estructura entera de la decisión 10.

**Infraestructura**: `.dockerignore` en la raíz, `apps/tienda/Dockerfile`,
`apps/tienda/nginx.conf`.

### Archivos modificados

| Archivo | Qué cambia |
|---|---|
| `package.json` (raíz) | `workspaces`, scripts con `-w`, `install:all` fuera |
| `apps/api/package.json` · `apps/web/package.json` · `apps/landing/package.json` | Entran al workspace; api y web declaran `@favalio/precios`; api suma `sharp` |
| `apps/api/package-lock.json` · `apps/web/…` · `apps/landing/…` | **Se borran.** Nace `package-lock.json` en la raíz |
| `apps/api/Dockerfile` · `apps/web/Dockerfile` · `apps/landing/Dockerfile` | Contexto en la raíz, instalación por workspace |
| `apps/api/.dockerignore` · `apps/web/…` · `apps/landing/…` | **Se borran.** Nace uno en la raíz |
| `.github/workflows/ci.yml` | Cinco jobs cambian de raíz de instalación; entran dos |
| `docker-compose.produccion.yml` | `context: .` en los cuatro builds; servicio `tienda`; volumen `imagenes_favalio` en `api` y en `caddy`; `ALLOWED_ORIGINS` con `https://tienda.${DOMINIO}` |
| `deploy/Caddyfile` | Quinto bloque de sitio, con tres `handle` |
| `deploy/respaldo.sh` | El volumen de imágenes, verificado y rotado |
| `apps/api/src/server.js` | El `skip` del limitador, `limitadorPublico`, y **cuatro** montajes nuevos (`/api/publico`, `/c`, `/api/catalogos`, `/api/pedidos`) |
| `apps/api/src/middleware/checkSubscription.js` | Delega el `switch` a `estadoDeSuscripcion.js`. **Sin cambio de comportamiento** |
| `apps/api/src/seedPermissions.js` | Cuatro permisos, y `gerente`/`vendedor` en `ROLE_PERMISOS` |
| `apps/api/src/models/index.js` | Seis modelos exportados, una asociación (`Pedido`↔`PedidoItem`) |
| `apps/api/src/routes/products.js` | Subida y borrado de la foto; `publicable` en el ABM y la acción masiva; borrar el producto borra su archivo |
| `apps/api/src/routes/general.js` | Desactivar un punto de venta usado por un catálogo publicado se rechaza (H13, FR-059) |
| `apps/web/src/App.jsx` | Dos `<Route>` con `RouteGuard requiredModule="catalogo"` y `MarcoDePantalla` |
| `apps/web/src/components/navegacion.js` | Grupo «Venta online» |
| `apps/web/src/pages/Inventory.jsx` · `components/PanelProducto.jsx` · `utils/exportarInventario.js` · `utils/impresionInventario.js` · `store/useStore.js` | El import de la fórmula |
| `apps/web/src/utils/precios.js` · `utils/precios.test.js` | **Se borran** |
| `apps/web/vite.config.js` | `optimizeDeps.include: ['@favalio/precios']` |
| `docs/OPERACION.md` | Restauración de imágenes (FR-028) y el número de llamadas por visita (FR-114) |

---

## Las guardias que se van a poner en rojo

Once anclas. Cada una con **qué valor tiene hoy**, **a cuál pasa** y **el motivo
que se escribe al lado**. Ninguna se rodea.

| # | Guardia | Hoy | Pasa a | El motivo que se escribe |
|---|---|---|---|---|
| 1 | `permisosDeRutas.test.js:73-87` — `ROUTERS_SIN_SESION`, **igualdad exacta** | 2 entradas | **4** | `'routes/catalogoPublico.js publico'`: es la tienda; no hay sesión de la cual salga un permiso, y lo que corta es el estado del catálogo y la suscripción, verificados dentro del handler. `'routes/catalogoPublico.js paginas'`: sirve el HTML de `/c/:slug` con las etiquetas Open Graph; lo lee el previsualizador de WhatsApp, que no tiene cuenta |
| 2 | `permisosDeRutas.test.js:549-565` — la lista literal de archivos de `routes/`, con `expect(montados).toEqual(nombres)` | 19 | **22** | Entran `catalogoPublico.js`, `catalogos.js` y `pedidos.js`, y los tres se montan en `server.js`. Un archivo de `routes/` que nadie monta es código muerto — o peor, un router que alguien cree publicado |
| 3 | `permisosDeRutas.test.js:674-693` — todo `checkPermission('…')` existe en `seedPermissions.js`, con el catálogo anclado en `> 40` | 50 permisos | **54** | Los cuatro permisos entran **antes** que los endpoints que los nombran, o esta guardia se pone en rojo entre los dos cortes |
| 4 | `permisosDeRutas.test.js:578-586` — `> 120` rutas y `> 115` autenticadas | 134 / 130 | crecen | Son pisos, no igualdades: no hay nada que actualizar, y se dice para que nadie lo «arregle» |
| 5 | `montajeDeRouters.test.js:331-338` — nada débil debajo del genérico | `[]` | **`[]`** | El montaje público va **arriba** del `:464`. Si esta guardia se pone en rojo, el montaje quedó en el lugar equivocado (decisión 2) |
| 6 | `observabilidad.test.js` — **guardia nueva**, molde `:394-536` | — | 5 aserciones | Posición del montaje respecto del parser, del limitador y del genérico; el `skip` que nombra `'/publico/'`; y **la atadura** entre el `skip` y `limitadorPublico`. Devuelve `null` si falta cualquiera de las líneas |
| 7 | `aislamientoEmpresas.test.js:1136` — `expect(deHijos.length).toBe(3)` | 3 | **3** | **No se mueve**, y no por casualidad: `pedido_items` no lleva `empresa_id` —igual que `sale_items`— y no se declara ninguna asociación desde `Catalogo` (decisión 12). El día que alguien declare una, sube a 4 y se actualiza con el motivo |
| 8 | `aislamientoEmpresas.test.js:993` — `conClaveForanea.length > 10` y el `it.each` de `sinValidar` | `[]` | **`[]`** | El `Pedido.create` **se queda en `routes/catalogoPublico.js`** con el `findScoped(Product, …)` delante, en el mismo handler. Es una restricción de arquitectura, igual que el `SupplierMovement.create` del pago (`:1015-1039`) |
| 9 | `guardiasDeDiseno.test.js:171-215` — `NOMBRES`, y `:473` `toHaveLength(32)` | 32 | **38** | Entran las seis pantallas y componentes nuevos **antes de escribirse**, para que la guardia los acompañe desde el primer commit. Su primera corrida da seis hallazgos «el archivo NO existe» |
| 10 | `guardiasDeSrc.test.js:598-612` `PANTALLA_DE_LA_RUTA` y `:702-714` `PANTALLAS` | 13 y 11 | **15 y 13** | El `label` del menú y el `titulo` del `PageHeader` tienen que ser **el mismo string**: «Catálogos» y «Pedidos». Y las dos pantallas llevan `anim-subida` |
| 11 | `marcoDeLasPantallas.navegador.js:56-61` — `CON_MARCO` | 18 rutas | **20** | Las dos rutas nuevas se agregan **al final**, no en el medio: `abrir()` corta el bucle con una excepción y lo que va antes se mide igual |

Y tres que no se mueven pero hay que mirar:

- **`reversibilidadDeMigraciones.test.js`**: las **cinco** migraciones nuevas
  necesitan su `down`, y su ancla (`ARCHIVOS.length >= 20`) sube sola.
- **`marcoDePantalla.test.js`**: exige que toda ruta cuyo ítem del menú declara
  `modulo` lleve `RouteGuard` con **ese mismo** módulo. Los dos ítems declaran
  `modulo: 'catalogo'`, así que las dos `<Route>` lo declaran igual.
- **`todosLosTestsCorren.test.js`**: los tests de la API van en `src/tests/`,
  nunca en `src/utils/*.test.js` — ahí jest no los levanta y nadie se entera.

---

## Orden de fases

Diecisiete cortes. Cada uno termina en **algo probable**, y el criterio para
cortar es que el commit se pueda revertir sin arrastrar al siguiente.

### Etapa 0 · Cimientos

| # | Corte | Termina cuando |
|---|---|---|
| **F0.1** | **Workspaces y `packages/precios`.** Nada de catálogo. Los tres lock se borran, nace uno; los cuatro `package.json`; los tres Dockerfiles y el `.dockerignore` de la raíz; el compose; los cinco jobs y el sexto (`Paquetes`); los cinco imports; `optimizeDeps`; la guardia de la copia única | Los **seis** jobs del CI en verde, los 21 casos corriendo desde `packages/precios`, `npm run dev` levantando las tres apps y `docker compose build` reconstruyendo las tres imágenes |
| **F0.2** | **`products.publicable`.** Migración con `DEFAULT false`, columna en el ABM, acción masiva en Inventario, índice de `customers` (H11), y la guardia de que no se escribe sin sesión | La migración corre en el job `contenedor`, `verificar-esquema.js` pasa, y los 431 productos quedan en `false` |
| **F0.3** | **Imágenes.** Volumen, `sharp`, los dos endpoints, el bloque de Caddy, `respaldo.sh`, `OPERACION.md`, `esImagenPropia` | Se sube un JPEG de 4000×3000, se sirve en 800×800 por `/img/…`, un `.exe` renombrado a `.jpg` se rechaza, y `respaldo.sh` produce un `.tar.gz` legible |

### Etapa 1 · Catálogo visible

| # | Corte | Termina cuando |
|---|---|---|
| **F1.1** | **Permisos, módulo y las cuatro listas de guardias**, en rojo a propósito | Los cuatro permisos en `seedPermissions.js`, `requireModulo.js` con su test, y `guardiasDeDiseno` diciendo «el archivo NO existe» seis veces |
| **F1.2** | **Datos.** Las cuatro migraciones de la etapa 1, los cuatro modelos, `models/index.js` | `verificar-esquema.js` mira las cuatro tablas nuevas, y `reversibilidadDeMigraciones` no tiene nada que decir |
| **F1.3** | **Funciones puras**: slug, reglas de precio, `textoDeBusqueda`, `estadoDeSuscripcion` | Los cuatro tests pasan sin base, incluidos los seis precios de `PREVIEW` y las cuatro coberturas de `REGLAS` de la maqueta |
| **F1.4** | **API privada de catálogos**: ABM, reglas, productos, previsualización | Se crea «Comprafit / Fitnet» por HTTP, se le cargan las cuatro reglas y la previsualización devuelve los seis precios. La pantalla **todavía no existe** |
| **F1.5** | **El router público de lectura**: resolvedor, `contextoPublico`, proyección, las dos guardias nuevas, el limitador y el `skip` | `catalogoPublico.integracion.test.js` con dos empresas: el catálogo de B da 404 desde el enlace de A, borrador y slug inexistente dan lo mismo, y el JSON entero no tiene ninguna de las diez claves |
| **F1.6** | **`apps/tienda`**: esqueleto, cliente HTTP, tema, catálogo, buscador, categorías, ficha, los seis estados, su job de CI y la prueba de 390px | El séptimo job en verde y el `<body>` sin desbordar en las tres primeras pantallas |
| **F1.7** | **`/c/:slug`, el Caddyfile, el servicio del compose, `ALLOWED_ORIGINS`** | El enlace pegado en un mensajero muestra el nombre, la descripción y la portada **del catálogo**, y `/robots.txt` existe |
| **F1.8** | **Pantalla Catálogos** en el panel: las cinco pestañas, el QR y el cartel A4 | `guardiasDeDiseno` baja de seis hallazgos a dos, `guardiasDeSrc` en verde, y el marco mide `/catalogos` |

### Etapa 2 · Pedido

| # | Corte | Termina cuando |
|---|---|---|
| **F2.1** | **`pedidos` + `pedido_items`**, `packages/pedido`, `estadoDePedido`, `totalDePedido` | La migración corre, las dos funciones puras pasan con el umbral de envío justo en el borde |
| **F2.2** | **`POST …/pedidos`**: transacción, idempotencia, numeración bajo candado, revalidación de stock | `pedidoPublico.integracion.test.js`: dos requests **en paralelo** crean uno solo, dos pedidos simultáneos no comparten número, un `product_id` de otra empresa no deja ninguna fila |
| **F2.3** | **Carrito y checkout** de tres pasos en la tienda, más la confirmación y los dos estados que faltan | El `<body>` sin desbordar en los tres pasos, la casilla sin dibujarse (puerta de FR-147a), y `#1042` con el formato de FR-137b |
| **F2.4** | **Bandeja** en el panel: tabla con «Canal», panel lateral de 520px, «Marcar cobrado» y el aviso permanente | Un test de integración que afirma **lo que no pasó**: `stock`, `stock_movements`, `sales`, `sale_items` y la caja quedaron como estaban. Y un test de render que verifica que el aviso **no tiene** botón de cerrar |
| **F2.5** | **Avisos**: las dos plantillas de Resend y el enlace de WhatsApp | Con `RESEND_API_KEY` y sin ella, el pedido se crea en los dos casos y la confirmación **no promete** el email que no salió |
| **F2.6** | **Visitas y la pestaña QR**: `INSERT … ON CONFLICT`, y visitas/pedidos/conversión | Diez aperturas y un pedido dan 10, 1 y 10 %; con cero visitas, un guion |

### Por qué en ese orden, y las dos dependencias que cruzan

**F0.1 va solo y primero**, sin una línea de catálogo encima. Es el commit que
puede romper las cuatro apps a la vez, y la única forma de que sea revertible es
que no lleve nada más.

**F1.1 antes que las pantallas** por el protocolo de las guardias: los seis
archivos entran a `NOMBRES` **antes** de escribirse, así que la primera corrida
da seis hallazgos «el archivo NO existe» y se sabe que la ruta está bien escrita
y que la guardia los está mirando. Una guardia agregada después se escribe para
el código que ya está, y entonces no es una guardia sino una descripción.

**F1.5 antes que F1.6**, aunque la app se pueda esqueletar antes: la tienda
consume lo que el router público devuelve, y si se dibuja primero se dibuja
contra un contrato imaginado. `apps/tienda` no puede tener reglas propias (H2).

**Las dos dependencias que cruzan las etapas de la spec**:

1. **El conteo de visitas es de la etapa 1 por escritura y de la etapa 2 por
   lectura.** `catalogo_visitas` y el `INSERT … ON CONFLICT` se necesitan desde
   **F1.5** —el que cuenta es el resolvedor, en cada apertura—, pero la pestaña
   que muestra los números necesita **pedidos** para calcular la conversión.
   Se parte: la tabla y la escritura en F1.2/F1.5, la lectura en F2.6. Sin
   partirlo, o la etapa 1 termina con una pestaña que muestra tres ceros
   inventados, o la etapa 2 arranca sin ningún dato histórico y el primer número
   real llega un mes tarde.
2. **`packages/precios` no se puede diferir a la etapa 1.** FR-076 —un producto
   sin precio resoluble no sale al catálogo— necesita `sinCosto` **del lado del
   servidor** desde F1.4, que es la previsualización. Por eso es el corte cero y
   no un refactor «que se hace cuando haya tiempo».

---

## Cómo se verifica

La escalera de `CONVENCIONES.md`, aplicada caso por caso. **Primero la función
pura.** El navegador es el último recurso. Y acá el cuarto nivel no es opcional:
con `BYPASS_AUTH=true` la suite rápida **no puede distinguir** un endpoint
público bien aislado de uno que filtra todo.

### Función pura (`utils/`, test en `src/tests/`)

Los 21 casos de precios; qué regla gana y cuál queda pisada, con las cuatro
combinaciones de ámbito y las tres de tipo; la cobertura «gana en N de M»; el
porcentaje del 100 % que da cero y no negativo; la normalización del slug con
acentos, mayúsculas y espacios; los cinco estados de la suscripción más el
desconocido; el total del pedido con el umbral **exactamente** en el borde; las
transiciones del estado del pedido; `esImagenPropia`; `textoSobre` con los
cuatro colores de prueba de la maqueta; `slugDeLaRuta`; `consolidarLineas` con
el mismo producto dos veces.

### Guardia estática

`paqueteDePrecios.test.js` (la copia única, los cuatro `package.json`, el
workspace); `proyeccionPublica.test.js` (las tres reglas, las muestras
sintéticas y el ancla); la guardia de posición en `observabilidad.test.js` (las
cuatro posiciones y **la atadura entre el `skip` y el limitador propio**);
`respaldoDeImagenes.test.js`; `guardiaDeLaTienda.test.js` (nada de
`Authorization`, `X-Sesion-Id`, `auth0` ni hexadecimales en `apps/tienda/src`).
Y las once anclas de la tabla de arriba.

### Integración contra Postgres (`src/tests/integracion/`)

Lo que **solo** este nivel contesta:

- El catálogo de B da 404 desde el enlace de A, con las dos empresas sembradas.
- Ningún dato de A aparece en una respuesta de B, recorriendo el **JSON entero**.
- Borrador y slug inexistente devuelven **el mismo cuerpo**.
- Pausado devuelve 200 **sin productos ni precios**.
- La suscripción vencida apaga el catálogo — y es el **único** lugar donde se
  puede probar, porque `BYPASS_AUTH` saltea `checkSubscription` en la cadena
  privada (`server.js:407`).
- El error de base al consultar la suscripción responde **503** en el público
  mientras la cadena privada **sigue dejando pasar**. Las dos mitades, cada una
  con su caso.
- Dos reglas del mismo ámbito y objetivo chocan contra el **índice**.
- El mismo pedido **en paralelo** crea uno solo, garantizado por el `UNIQUE`.
- Dos pedidos simultáneos de la misma empresa **no comparten número**.
- Un `product_id` de otra empresa **no deja ninguna fila**.
- Un precio en el cuerpo se descarta y el pedido queda con el del servidor.
- Un producto publicable nuevo **no aparece** en ningún catálogo.
- «Marcar cobrado» dejó `stock`, `stock_movements`, `sales`, `sale_items` y la
  caja **como estaban** — afirmando lo que **no** pasó, que es la mitad que se
  olvida.

**La fixture** suma a `sembrarDosEmpresas()`, cada dato con su motivo: un
catálogo publicado **en cada empresa** —si no, «404 desde el enlace de A» no se
distingue de «no hay nada»—; **dos catálogos en la empresa A** —para que «el
pedido cayó en el catálogo equivocado» sea detectable—; un producto con costo
$0; uno sin marca; uno con `available = 0` y `quantity > 0`; **una regla de cada
ámbito sobre el mismo producto** —sin eso no se puede ver cuál gana—; importes
que dejan centavos; y un subtotal **exactamente igual** al umbral de envío
gratis.

### Render (jsdom)

Que encabezado y filas de las cinco tablas compartan el mismo string de
`grid-template-columns`; que el aviso de la bandeja **no tenga botón de cerrar**;
que con la puerta cerrada **no se dibujen** el DNI ni la casilla de marketing;
que la casilla, cuando exista, arranque **desmarcada**; que sin
`catalogo.editar` los campos estén **deshabilitados con su explicación** y no
ausentes; que el renglón de la marca no diga `undefined`; que el botón «Sin
stock» no dispare nada; que el precio de lista tachado no se dibuje cuando el
final es mayor o igual.

### Navegador

**Solo** geometría, y solo dos cosas: que las veinte rutas del panel sigan
entrando en el marco (`marcoDeLasPantallas`, que pasa de dieciocho a veinte) y
que el `<body>` de la tienda **no desborde a lo ancho** a 390px en catálogo,
ficha, carrito y los tres pasos del checkout. Todo lo demás baja un escalón.

---

## Riesgos

**1 · F0.1 es un commit que toca las cuatro apps a la vez.** Tres
`package-lock.json` se borran y nace uno: si la resolución de la raíz elige una
versión distinta de una dependencia transitiva, se entera un job del CI —o peor,
un `docker build` en el VPS—. **Se detecta** con los seis jobs, que corren los
seis contra el árbol nuevo. **Mitigación**: el corte no lleva nada más encima, y
revertirlo es un `git revert` de un commit.

**2 · El contexto de build pasa a ser la raíz del repositorio.** Sin el
`.dockerignore` de la raíz, cada `docker build` sube `node_modules`, `.git`,
`legacy/` y `docs/` al demonio de Docker: en el VPS de 4 GB eso es la diferencia
entre segundos y quedarse sin memoria. **Se detecta** en el job `contenedor`, por
tiempo. **Y no hay que olvidarlo**: los tres `.dockerignore` de `apps/*` dejan de
aplicar en el momento en que el contexto cambia, sin ningún aviso.

**3 · El `skip` del limitador global es una línea que, borrada, no rompe nada.**
El catálogo seguiría andando y las cajas empezarían a recibir 429 los sábados a
la tarde, que es un síntoma que nadie relaciona con una línea de `server.js`. **Se
detecta** con la aserción 4 de la guardia de posición, y por eso la guardia
además **ata** el `skip` a la existencia del limitador propio.

**4 · `trust proxy` ya está en `1`** (`server.js:49`), y de eso depende que el
limitador por IP signifique algo detrás de Caddy. Con la tienda hablando por
`tienda.favalio.com/api/publico/…`, hay **un** proxy en el camino, igual que
hoy. **Si alguien mete un segundo proxy**, todas las peticiones públicas pasan a
parecer de la misma IP y el limitador por IP+slug degenera en uno global por
slug: un solo visitante podría apagarle el catálogo a todos. Hay que mirarlo el
día que cambie la infraestructura.

**5 · La proyección pública envejece con `Product`.** La guardia mira la
**forma** —nada de spread, nada de `exclude`, nada de instancias— y una lista
explícita de diez nombres. Un campo nuevo llamado `precio_costo` no está en esa
lista. Lo que lo cubre de verdad es que `vistaPublica.js` sea una **lista
blanca**: un campo nuevo no entra a menos que alguien lo escriba. El test de
integración que recorre el JSON entero es la segunda red.

**6 · El hop de la API al servicio `tienda` para el HTML.** Si el contenedor de
la tienda está caído, `/c/:slug` responde 503 aunque el bundle esté en el caché
del navegador de todos. El caché de 60 segundos lo tapa parcialmente. **Se
detecta** en el `logger.error` del handler, y es un caso que
`docs/OPERACION.md` tiene que nombrar.

**7 · El advisory lock serializa los pedidos de una empresa.** Con el volumen
esperado —decenas por semana— es irrelevante. Con mil por minuto sería el cuello,
y la salida es una secuencia por empresa, que en ese momento sí se paga.

**8 · Sin reserva de stock, dos pedidos por la última unidad se crean los dos.**
Está en la spec y no es un defecto, pero es la primera llamada de teléfono del
comercio. La bandeja tiene que dejar ver los dos pedidos y el aviso permanente
tiene que estar arriba.

**9 · `X-Robots-Tag` a nivel de sitio se lo lleva todo, incluidas las
imágenes** — que es lo que se quiere— **pero los previsualizadores de enlaces no
son buscadores** y no lo respetan, así que el `og:image` sigue funcionando. Es
la clase de cosa que se descubre pegando el enlace en WhatsApp y no antes: va en
el paso manual del corte F1.7.

**10 · El VPS suma un contenedor y un volumen.** El plan de 4 GB con swap «ya
está justito». `nginx:alpine` con un bundle chico es despreciable; el volumen de
imágenes crece con el uso y **no hay cuota por empresa** en esta etapa (está
fuera de alcance). Se mide al agregarlo, y `docs/OPERACION.md` dice qué hacer
cuando se llene.

**11 · La suite rápida de la API no puede ver ninguno de los defectos que
importan acá.** Con `BYPASS_AUTH=true`, `req.empresaId` está clavado en 1,
`checkSubscription` no corre y `checkPermission` llama a `next()` sin mirar. Un
endpoint público que filtre datos de otra empresa **pasa en verde**. Todo lo que
sostiene esta funcionalidad vive en `src/tests/integracion/` y en las guardias
estáticas, y las dos cosas hay que **pedirlas**: `npm run test:api` no levanta la
suite de integración.

**12 · Once anclas movidas en un mismo hito.** Cada una es una oportunidad de
«actualizar el número para que pase». La regla, escrita en el propio código de
las guardias, es que el número se mueve **con el motivo al lado**. Un ancla
movida sin motivo es una guardia que dejó de significar algo, y no se nota hasta
que hace falta.

---

## Lo que haría falta para unificar las dos bandejas

Queda escrito acá para que la decisión 13 no se pierda, porque la pregunta va a
volver.

`tiendanube_pedidos` **no se puede migrar tal cual** a `pedidos`. Le faltan seis
cosas que la bandeja necesita para poder operar una fila: **comprador**
(nombre, teléfono, email), **total**, **estado** operable, **entrega**, **medio
de pago** y **líneas con precio congelado**. Lo que tiene es
`tiendanube_order_id`, `numero`, el JSONB de `items` con lo que se descontó y
`items_sin_descontar` — o sea, el registro de qué hizo el webhook con el stock.

Y hay dos propiedades suyas que **chocan de frente** con las de una bandeja:

1. **Sus filas son inmutables por diseño.** Un pedido de la bandeja cambia de
   estado seis veces; una fila de `tiendanube_pedidos` se escribe una vez, dentro
   de la transacción que descuenta, y no se toca más.
2. **Sus filas no se borran nunca.** Borrar una deja que un webhook reintentado
   descuente dos veces — y TiendaNube reintenta. Un pedido de la bandeja, en
   cambio, se cancela y se puede archivar.

Unificarlas exige primero que un pedido de TiendaNube **tenga** comprador, total
y estado, que es el **pendiente 12c** de `PROXIMOS-PROYECTOS.md` y no entra en
esta spec. Cuando eso exista, el camino es: una tabla `pedidos` con
`origen = 'tiendanube'`, `tiendanube_pedidos` **se queda** como libro de
idempotencia del webhook —no se borra ni se fusiona— y las dos se relacionan por
un `tiendanube_pedido_id` anulable. La columna `origen` que se crea ahora es lo
que hace que ese día no haya que migrar nada.

