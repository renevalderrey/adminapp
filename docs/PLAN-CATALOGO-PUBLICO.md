# Plan · Catálogo público y pedidos

**Hito 10.** Producto nuevo, no reemplazo del legacy. Se declara como cambio de
rumbo, no se cuela como una spec más.

---

## El norte

Una empresa de Favalio publica un catálogo de productos en una URL propia. Un
QR pegado en el local de un socio lleva a esa URL. El visitante ve el catálogo
con el precio que la empresa definió **para ese catálogo**, arma un pedido y lo
paga —o lo coordina—. El pedido cae en el panel de la empresa.

**Primer caso real.** Comprafit (suplementos deportivos) se asocia con un
gimnasio. El QR vive en el gimnasio, el catálogo se llama «Comprafit / Fitnet»
y los socios del gimnasio ven precio preferencial. Referencia funcional:
[pedix.app](https://info.pedix.app/).

**Es capacidad de plataforma, no una pantalla de Comprafit.** Todo scopeado por
`empresa_id` desde el día uno, el módulo se libera por `enabled_modules` como
`tiendanube`.

---

## Las trece decisiones tomadas

| # | Decisión | Consecuencia |
|---|---|---|
| 1 | Multi-tenant desde el día uno, liberado solo a Comprafit | El slug público es global; el aislamiento se prueba con dos empresas |
| 2 | El pedido llega por **los tres** caminos: bandeja del panel, WhatsApp y Mercado Pago | Ninguno reemplaza a los otros; el pedido existe en la base aunque el WhatsApp no se envíe |
| 3 | Precio por **reglas** por catálogo: porcentaje o monto nominal | Tabla nueva. Ámbitos: catálogo, categoría, marca, producto |
| 4 | El socio **no** se modela: es un catálogo con branding propio | Sin entidad Socio. El catálogo tiene nombre visible, descripción, logo y portada |
| 5 | Comprador: nombre, teléfono, email, N° de socio y DNI · **declarativo** | Se crea/actualiza `Customer` para base de datos y marketing. Padrón del gimnasio queda para etapa 2 |
| 6 | Entrega: retiro en el socio, retiro en el local, envío a domicilio y «a coordinar». El comprador elige | Costo de envío **fijo por catálogo**, con envío gratis a partir de un monto |
| 7 | **Pago aprobado → se crea la `Sale`**: ahí y solo ahí se descuenta stock y entra a caja | No se repite la deuda 12c de TiendaNube. Sin CAE |
| 8 | Mercado Pago **Marketplace**: la plata va a la empresa, un `marketplace_fee` al dev | Onboarding por OAuth, no por credenciales pegadas |
| 9 | La tienda es una app nueva: `apps/tienda` | Quinto servicio del compose, su propio nombre en Caddy, bundle chico, tema del comercio, mobile-first |
| 10 | Imágenes servidas por la plataforma, con subida y redimensionado | Con el VPS ya no hace falta un bucket de terceros: alcanza un volumen. Es bloqueante igual: un catálogo de suplementos sin foto es medio catálogo |
| 11 | URL con **slug legible + `noindex`** | `/c/comprafit-fitnet` no se indexa. El precio preferencial no termina en Google |
| 12 | v1 = buscador + categorías + ficha de producto | Mínimo de compra, destacados, horarios y cupones: **fuera de alcance**, escrito |
| 13 | Arranca ya | Con la salvedad del §«Lo que bloquea la publicación» |

### Supuestos que asumo salvo que digas lo contrario

- **La suscripción vencida corta el catálogo público.** `checkSubscription` exime
  por prefijo de URL y no corre en el router público: el estado se verifica
  **dentro del handler**. Sin esto, una empresa con la cuota vencida sigue
  publicando y recibiendo pedidos.
- **El slug es único global**, no por empresa: la URL es global.
- **Las reglas de precio no se acumulan.** Gana la más específica:
  producto → marca → categoría → catálogo. Es predecible; acumular no lo es.
- **El precio se congela en la línea del pedido** al crearlo. Si la regla cambia
  mañana, el pedido de ayer no cambia.
- **Transferencia y efectivo no crean la venta solos.** Alguien de la empresa
  marca «cobrado» en la bandeja y ahí nace la `Sale`.

### Lo que cerró la revisión de la spec 015

- **El cálculo de precios vive en `packages/precios`**, un paquete compartido con
  workspaces de npm. Cambia la forma del monorepo, y a cambio hay una sola copia
  **y** cálculo instantáneo mientras se escribe el costo. Sin workspaces no había
  forma: `PanelProducto.jsx:203` calcula en vivo y no tolera una llamada HTTP.
- **Términos y Política de Privacidad son de Favalio**, y son una **puerta**:
  hasta que estén publicados, el checkout **no pide DNI ni ofrece la casilla de
  marketing**. El pedido funciona igual con nombre, teléfono y email.
- **La lista de productos de un catálogo es selección explícita.** Un producto
  publicable nuevo no aparece solo en ninguna página pública. Se cae
  `incluye_todos`.
- **El número de pedido es correlativo por empresa desde 1, sin letra**, y no se
  reinicia nunca.
- **El slug viejo muere** cuando se cambia, con aviso antes de guardar. Un
  catálogo con pedidos no se borra: se pausa.
- **Los metadatos de WhatsApp los sirve la API** en `/c/:slug`; el resto sale del
  bundle. Un `index.html` de Vite no los puede poner desde React.
- **Obligatorios: nombre y teléfono.** Nada más, salvo dirección con envío.
- **Nada vence solo**, y si pediste 5 y hay 2 se recorta avisando.

---

## Lo que ya existe y se reusa

| Pieza | Dónde | Para qué sirve acá |
|---|---|---|
| `Product` + `Brand` | `models/Product.js:5-101`, `models/Brand.js:8-33` | Es el catálogo. No se crea una tabla paralela |
| Importador CSV/Excel en castellano | `routes/import.js:45-56` | Ya mapea nombre, costo, categoría, unidad e «imagen» |
| `utils/tenantScope.js` | `:29-121` | `findScoped` sirve igual; hay que alimentarlo con un `empresaId` que viene del slug, no de la sesión |
| Router público montado arriba de la cadena de auth | `server.js:182` y `:456`, con `app.use('/api', ...authEmpresa, general)` en `:464` | El patrón exacto a copiar: exportar `{ publico, privado }` y montar el público **arriba** del `/api` genérico y **debajo** del rate limiter |
| Token opaco con expiración | `models/Invitacion.js:19-59` | Molde por si el slug legible no alcanza |
| `UPDATE` condicional de un solo uso | `models/TiendanubeEstadoOauth.js`, `routes/tiendanube.js:201-233` | Resolver algo que manda un desconocido sin carrera de concurrencia |
| `calcularPrecios` | `apps/web/src/utils/precios.js:98-131` | La regla de precio de venta, escrita y probada. **Se mueve al servidor**, no se duplica |
| `POST /api/sales` | `routes/sales.js:311-630` | El molde de escritura segura: transacción, total recalculado, idempotencia, `Stock.findOne({ lock: t.LOCK.UPDATE })`, `StockMovement` por movimiento |
| `utils/sucursalDeStock.js` | `:59-196` | Toda escritura de stock pasa por acá. Nunca un ternario propio |
| `StockMovement` | `models/StockMovement.js:4-55` | Auditoría con un `tipo` nuevo, sin tabla nueva |
| `pedidoWhatsapp.js` | `apps/web/src/utils/:26-73,141-154` | Deep link a `wa.me` y normalización de teléfono argentino, ya escritos |
| `qrcode` | ya instalado, `printInvoice.js:1,48-75` | El QR del catálogo se genera en el navegador. Cero API |
| `services/email.js` (Resend) + `plantillaBase` | `:1-63, 65-256` | Avisar el pedido es una plantilla más |
| Arnés de integración con dos empresas | `tests/integracion/baseDePruebas.js:135-224` | El único lugar donde el aislamiento se verifica de verdad |
| Guardias estáticas | `aislamientoEmpresas.test.js`, `montajeDeRouters.test.js`, `permisosDeRutas.test.js` | Van a marcar en rojo los errores clásicos de este trabajo. Se actualizan con el motivo escrito al lado, nunca se rodean |
| Sistema de diseño de `apps/web` | `index.css:38-316` | Sirve entero para las **pantallas de administración**. **No** para la tienda: declara mínimo 1280px y su marca es la de Favalio |

---

## Lo que falta

### Datos

```
catalogos
  id                     PK
  empresa_id             NOT NULL          -- aislamiento
  punto_de_venta_id      NOT NULL FK       -- de qué sucursal sale el stock
  slug                   UNIQUE global, minúsculas, [a-z0-9-]
  nombre_visible         NOT NULL          -- «Comprafit / Fitnet»
  descripcion            TEXT
  logo_url, portada_url  TEXT              -- servidas por la plataforma
  color_marca            STRING(7)         -- tema de la tienda
  whatsapp_destino       STRING(20)        -- configurable por catálogo
  datos_transferencia    JSONB             -- titular, cbu, alias, banco
  retiro_socio           BOOL  + retiro_socio_direccion TEXT
  retiro_local           BOOL
  envio                  BOOL  + envio_costo DECIMAL(12,2) + envio_gratis_desde DECIMAL(12,2) NULL
  coordinar_whatsapp     BOOL
  pide_nro_socio, pide_dni   BOOL
  mp_habilitado          BOOL
  mostrar_precio_lista   BOOL default false  -- publicar el precio tachado es publicar el margen
  email_avisos           STRING              -- a dónde llega el aviso de pedido nuevo
  estado                 ENUM('borrador','publicado','pausado')
  publicado_en           TIMESTAMP NULL

catalogo_productos            -- LISTA DE INCLUSIÓN: si no está acá, no se publica
  catalogo_id, product_id, orden INT
  UNIQUE (catalogo_id, product_id)

catalogo_reglas_precio
  id, empresa_id, catalogo_id
  ambito        ENUM('catalogo','categoria','marca','producto')
  ambito_valor  STRING(100) NULL           -- texto de category | brand_id | product_id
  tipo          ENUM('porcentaje_descuento','monto_descuento','precio_fijo')
  valor         DECIMAL(12,2)
  activo        BOOL
  UNIQUE (catalogo_id, ambito, ambito_valor)

pedidos
  id UUID PK
  empresa_id, catalogo_id, punto_de_venta_id   NOT NULL
  numero                 -- legible, secuencial por empresa. UNIQUE (empresa_id, numero)
  estado                 ENUM('pendiente_pago','pagado','en_preparacion','listo','entregado','cancelado')
  comprador_nombre, comprador_telefono, comprador_email
  comprador_dni, comprador_nro_socio
  customer_id            FK NULL
  acepta_comunicaciones  BOOL              -- consentimiento explícito
  entrega                ENUM('retiro_socio','retiro_local','envio','coordinar')
  envio_direccion, envio_localidad, envio_cp
  subtotal, envio_costo, total   DECIMAL(12,2)
  medio_pago             ENUM('mp','transferencia','efectivo')
  mp_preference_id, mp_payment_id, mp_estado
  sale_id                FK NULL           -- la venta que generó, si se cobró
  notas                  TEXT
  idempotency_key        UNIQUE

pedido_items
  id, pedido_id, product_id
  nombre, precio_unitario, cantidad, subtotal   -- todo congelado

empresa_mercadopago
  empresa_id UNIQUE, mp_user_id, access_token (cifrado), refresh_token,
  public_key, expira_en, marketplace_fee_pct
```

Además, en tablas existentes:

- `products.publicable` BOOL default false — `is_active` es el flag del ABM
  interno; sin uno propio, publicar el catálogo publica todo lo del POS.
- Migraciones: una por cambio, SQL crudo en transacción, índices con el mismo
  `name` que declaran los modelos, y registro en `models/index.js`. El job
  «contenedor» del CI corre `verificar-esquema.js`.

### API

**Públicos** — montados **arriba** de `app.use('/api', ...authEmpresa, general)`
(`server.js:464`) y **debajo** del rate limiter (`:319`), con limitador propio
por slug además del global por IP.

```
GET  /api/publico/c/:slug                      → branding, entrega, medios de pago, categorías
GET  /api/publico/c/:slug/productos            → ?q= &categoria= &marca= &page=
GET  /api/publico/c/:slug/productos/:id
POST /api/publico/c/:slug/pedidos              → { numero, whatsapp_url, init_point? }
POST /api/publico/mp/webhook                   → firma verificada
```

**Privados**

```
GET|POST|PUT|DELETE  /api/catalogos            + /:id/reglas  + /:id/productos
GET   /api/pedidos                             ?estado= &catalogo=
PATCH /api/pedidos/:id/estado
POST  /api/pedidos/:id/cobrado                 → crea la Sale
GET   /api/mercadopago/conectar | /callback | DELETE /desconectar
```

**Y además:**

- **Servicio de precios en el servidor.** Mover `calcularPrecios` a la API y que
  el POS consuma el mismo cálculo, en el mismo cambio. Dos copias de la misma
  regla es el defecto ya documentado de `mediosDePago.js`.
- **Resolvedor de tenant sin sesión**: slug → `{ empresaId, catalogoId, puntoDeVentaId }`.
  Nunca reutilizar `loadEmpresaContext`: tiene la rama del superadmin que entra a
  cualquier empresa por `X-Empresa-Id` sin membresía.
- **Proyección explícita** en toda respuesta pública. Nunca el objeto del modelo,
  nunca un spread. `GET /api/products` devuelve `cost` crudo, proveedor y stock.
- **Permisos nuevos** en `seedPermissions.js`: `catalogo.ver`, `catalogo.editar`,
  `pedidos.ver`, `pedidos.gestionar`. No reusar `config.*` — TiendaNube ya
  arrastra el pendiente 12b por eso.
- **Idempotencia por `UNIQUE` en la base**, no por orden de ejecución. Molde:
  `uq_tn_pedido`.

### Panel (`apps/web`)

- Pantalla **Catálogos**: ABM, sucursal, branding, entrega, medios de pago,
  reglas de precio, selección de productos, publicar/pausar, ver y **descargar el
  QR**.
- Pantalla **Pedidos**: bandeja con estados, detalle, marcar cobrado, cancelar.
- Entradas nuevas en `navegacion.js`, en `PANTALLA_DE_LA_RUTA`/`PANTALLAS` de
  `guardiasDeSrc.test.js` y en `NOMBRES` de `guardiasDeDiseno.test.js` (que tiene
  un ancla `toHaveLength(32)`).

### Tienda (`apps/tienda`)

React + Vite + Tailwind, **mobile-first de verdad** (390px es el caso, no el
borde). Sin Auth0, cliente HTTP propio sin `Authorization`, sin `X-Sesion-Id` y
sin el interceptor de 401 que dispara el logout. Tema por catálogo desde
`color_marca` en variables CSS. `og:title`/`og:image`/`og:url` por catálogo,
`noindex` y `robots.txt`. Footer **«powered by Favalio»**.

### Infra

> Desde `c1013e8` la plataforma entera corre en **un VPS de Hostinger** con
> `docker-compose.produccion.yml`: Caddy (único puerto expuesto, TLS solo),
> Postgres (sin puertos públicos), `api`, `web` y `landing`. Eso cambia tres
> decisiones de este plan y **elimina el peor riesgo**.

- **La tienda es el quinto servicio del compose**, con su bloque en
  `deploy/Caddyfile`. Dirección: `tienda.favalio.com/c/<slug>` — un registro `A`
  más en el DNS de Hostinger apuntando a la misma IP, y un bloque de tres líneas
  igual al de `app`. La alternativa `<slug>.favalio.com` exige certificado
  comodín y desafío DNS con token de Hostinger: no vale la pena en la v1.
- **`ALLOWED_ORIGINS`** se arma en el compose por interpolación
  (`docker-compose.produccion.yml:89`): hay que sumar `https://tienda.${DOMINIO}`
  ahí, no en un `.env` suelto.
- **Las `VITE_*` son argumentos de build**: viven dentro del bundle. Cambiar la
  URL de la API de la tienda no tiene efecto hasta `up -d --build`. Está avisado
  en la cabecera del compose (`:18-19`) y es un modo de falla clásico.
- **`X-Frame-Options: DENY`** hoy sale del `vercel.json` de la landing, que ya no
  es el camino de producción. Si alguna vez se quiere embeber el catálogo en la
  web del gimnasio, se resuelve en el bloque de Caddy de la tienda.
- **Imágenes**: con VPS propio, un volumen de Docker montado en la API y servido
  por Caddy alcanza y sobra. Baja de proyecto de infraestructura a endpoint de
  subida + `sharp` + volumen. **La trampa**: `deploy/respaldo.sh` sólo vuelca
  Postgres con `pg_dump`. Un volumen de imágenes **no queda respaldado**, y las
  copias todavía no salen del VPS. Ampliar el script en el mismo cambio que crea
  el volumen, o las fotos se pierden con el disco.
- **Job de CI** para la app nueva. Hoy `ci.yml` tiene cinco.
- **Recursos**: un quinto contenedor (nginx estático) es despreciable, pero el
  plan de 4 GB con swap ya está justito. Medirlo al agregarlo.

**Lo que dejó de ser un problema.** El riesgo de arranque en frío —Render free
durmiendo a los 15 min y Neon autosuspendiendo a los 5, casi un minuto en blanco
para el primero que escaneaba el QR— **ya no existe**: en el VPS el proceso no
duerme (`restart: unless-stopped`) y el cron interno de suscripciones sí dispara
(`docker-compose.produccion.yml:103-106`). Y el dominio del QR **existe de
verdad**: `favalio.com` está comprado y apuntado.

**Lo que aparece a cambio.** Ya no hay copias automáticas de la base: si el cron
de `respaldo.sh` no está puesto, no hay respaldo, y un respaldo en el mismo disco
que la base no cubre perder el disco. Antes de que un pedido con plata real entre
por el catálogo, ese cron tiene que estar corriendo y una restauración probada.

---

## Lo que agregó el diseño

La maqueta está en
[maqueta/Catalogo-de-ventas-online.dc.html](maqueta/Catalogo-de-ventas-online.dc.html).
Dibuja cosas que este plan no tenía y que hay que decidir si entran:

| Lo que dibuja | Qué implica |
|---|---|
| **Escaneos (30 d), pedidos y conversión** en la pestaña del QR | Contar visitas al catálogo. Tabla o contador nuevo; no estaba previsto |
| **Cartel A4 para imprimir** además del PNG y el SVG del QR | Generación de un PDF/PNG compuesto con logo, nombre y leyenda. `qrcode` sola no alcanza |
| **Duplicar catálogo** | Copia profunda: reglas y selección de productos |
| **Exportar pedidos** | Otro camino de exportación; ya hay precedente en el repositorio |
| **«Gana en 2 de 4»** por regla | El motor de precios tiene que devolver cobertura, no solo el precio final: cuántos productos alcanza cada regla y en cuántos termina ganando |
| **Precio de lista tachado** en la tienda | Publica el precio de lista además del preferencial. Es una decisión de negocio: muestra el margen del descuento a cualquiera con el enlace. En la maqueta es la prop `mostrarPrecioLista`, así que puede quedar como interruptor por catálogo |
| **Selección múltiple con «Publicar» y «Quitar»** | Acciones masivas sobre la selección de productos |

### Una divergencia que hay que resolver

La maqueta escribe la dirección como **`comprafit.favalio.com/c/comprafit-fitnet`**:
un subdominio **por empresa**, más el slug del catálogo. Este plan había
decidido `tienda.favalio.com/c/<slug>`, con un solo nombre.

No es cosmético. Un subdominio por empresa obliga a **certificado comodín**
(`*.favalio.com`), y eso en Caddy exige el desafío DNS con un token de la API de
Hostinger: registro `A` comodín, plugin de DNS en la imagen de Caddy y una
credencial más en el `.env`. A cambio, cada empresa tiene su dirección propia,
que es mejor de comunicar.

**Salvo indicación contraria, la spec toma `tienda.favalio.com/c/<slug>`** y
deja el subdominio por empresa anotado como evolución: el slug ya es único
global, así que mudarse después es un cambio de DNS y de Caddyfile, no de datos.

---

## Orden de ejecución

| Etapa | Qué entra | Por qué en ese orden |
|---|---|---|
| **0 · Cimientos** | **`packages/precios`** (workspaces de npm) · subida de imágenes (volumen + `sharp`) y respaldo del volumen · `products.publicable` | Nada de lo de abajo se puede probar sin esto, y el precio en el navegador no se puede exponer |
| **1 · Catálogo visible** | `catalogos` + reglas + resolvedor por slug + endpoints públicos de lectura + `apps/tienda` (catálogo, buscador, ficha) + ABM y QR en el panel | Es la mitad que se puede mostrar y validar con Comprafit sin tocar stock ni dinero |
| **2 · Pedido** | `pedidos` + `pedido_items` + checkout + WhatsApp + bandeja en el panel + aviso por email | El pedido ya existe en la base y se opera, todavía sin pasarela |
| **3 · Cobro** | MP Marketplace (OAuth, preferencia, webhook, `marketplace_fee`) + «cobrado» → `Sale` con descuento de stock | Es lo más burocrático y lo único que toca dinero: va último y entra completo |
| **4 · Después** | Reserva de stock · padrón de socios · mínimo de compra · destacados · horarios · cupones | Fuera de alcance de la v1, escrito en la spec |

---

## Riesgos que hay que mirar de frente

**Aislamiento.** Un endpoint sin sesión rompe el supuesto sobre el que está
escrito todo el aislamiento: hoy `empresa_id` sale siempre de `req.usuario` y
`assertEmpresaId` tira 500 si no hay empresa resuelta. Y ningún test de ejecución
lo detecta: los ~1400 tests corren con `BYPASS_AUTH=true` y `empresa_id` clavado
en 1. **La red es estática y hay que ampliarla**: guardia nueva sobre el
serializador público (que falle si aparece `cost`, `margin_override`,
`wholesale_*`, `supplier` o un `empresa_id` ajeno) y test de integración con dos
empresas: el catálogo de la B da 404 desde el enlace de la A.

**Ids de un desconocido.** Un pedido público recibe, por definición, `product_id`
de cualquiera. El detector 1 de `aislamientoEmpresas.test.js` marca todo `create`
con un `<algo>_id` que viene del cliente sin `findScoped` previo. Se validan
todos los productos contra el catálogo publicado **antes** de crear nada, en el
mismo ámbito, y que la guardia lo vea.

**Precio fijado desde afuera.** `POST /api/sales` acepta el precio unitario del
cliente y solo verifica que el total cierre. El pedido público manda **producto y
cantidad, nunca precio**: el servidor resuelve la regla y la congela.

**Sobreventa.** No hay reserva de stock, y aunque se escribiera, cinco caminos
existentes la borrarían asignando `available = quantity`
(`productionService.js:357` y `:380`, `import.js:438`, `products.js:344` y
`:350`, `general.js:265` y `:271`). Con «pago aprobado → Sale», dos personas
pueden pagar el mismo último frasco. **Mitigación de la v1**: el catálogo muestra
«agotado» leyendo stock real, y al crear la `Sale` se revalida con lock; si no
alcanza, el pedido queda `sin_stock` y hay que reembolsar a mano. La reserva real
es etapa 4 y arregla los cinco escritores en el mismo commit.

**Medio de pago nuevo.** `Sale.payment_method` es `STRING(20)` sin validación: un
código nuevo ensucia los reportes en silencio. `mp` se agrega explícitamente a
`mediosDePago.js` y a los segmentos de los reportes, no se cuela.

**Paywall.** `checkSubscription` exime por prefijo de URL y no corre en el router
público. Se verifica el estado dentro del handler. Y ojo con elegir un prefijo
que empiece con `/api/empresas`: heredaría la exención sin querer.

**Rate limit.** El límite global es 600 req/15 min **por IP** y corre antes de la
autenticación: un gimnasio entero detrás de un NAT comparte cupo con las cajas
del comercio. Cincuenta personas escaneando el QR pueden provocar un 429 en el
punto de venta. Limitador propio para el prefijo público, y medir cuántas
llamadas hace una visita antes de publicar.

**Datos personales.** Guardar nombre, teléfono, email, DNI y N° de socio para
marketing exige consentimiento explícito (una casilla, no una preseleccionada) y
Términos y Política de Privacidad publicados —que además son requisito de
cualquier pasarela y hoy **no existen**.

---

## Lo que bloquea la publicación

El desarrollo arranca ya. **La publicación del QR no.**

Si hoy se publicara lo migrable serían **431 productos: 96 % sin marca, ninguno
con foto, ninguno con descripción y 376 con costo $0**. Las categorías se
infieren por regex y 99 de 392 caen en «otro»; las marcas están sin normalizar
(`Nutremax`/`NUTREMAX`, `Gold Nutrition`/`Gold Nutricion`).

Un producto sin foto y a $0 en una página pública es peor que no tener página.
La migración real sigue **bloqueada por el acceso al hosting viejo de Comprafit**
(`PLAN-COMPRAFIT.md:327-343`), y el primer paso cuando se destrabe es **rotar la
contraseña de la base y el token**, que están en el historial de git.

Orden sano: etapas 0-2 mientras se destraba el hosting; datos cargados y
revisados; recién ahí el QR.
