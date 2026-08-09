# Modelo de datos: Catálogo de ventas online

**Plan**: [plan.md](./plan.md) · **Spec**: [spec.md](./spec.md)

Seis tablas nuevas, dos columnas nuevas en tablas existentes, un índice que
faltaba, y **cinco migraciones**. Todas aditivas, todas con `down`, ninguna
`sync({ force: true })`.

---

## Lo que NO se crea, y por qué va primero

Cuatro columnas y dos tablas que el borrador del plan traía y que **no se
escriben**. Va primero porque es lo que alguien va a querer agregar «ya que
estamos».

### `catalogos.incluye_todos` no se crea

Decisión 9 de la spec. Con «todos los publicables», una importación de CSV de
cincuenta productos —que es una operación de **inventario**— publicaría
cincuenta productos en una página pública sin que nadie lo decidiera.
`catalogo_productos` es una **lista de inclusión**: estar en la tabla **es**
estar en el catálogo.

### `catalogo_productos.visible` no se crea

Sería una **tercera** bandera, además de `products.publicable` y
`products.is_active`, para decir lo mismo que decir que la fila no exista.
Quitar un producto de un catálogo **borra su fila** (FR-065).

### `pedido_items.empresa_id` no se crea

Dos motivos, y el segundo es el que importa:

1. La tabla solo se alcanza a través de `pedidos`, que sí lleva `empresa_id` y
   por el que pasa todo `findScoped`. La columna sería redundante, igual que en
   `sale_items`.
2. `aislamientoEmpresas.test.js:1136` ancla en **3** la cantidad de includes de
   hijos **con `empresa_id`**. Con la columna, el `include: [{ model: PedidoItem,
   as: 'items' }]` de la bandeja movería ese ancla — y el ancla existe para no
   moverse. Sin la columna, la bandeja trae el detalle con `include` y el número
   se queda en 3.

### `pedidos.mp_preference_id`, `mp_payment_id` y `mp_estado` no se crean

Son de la etapa 3. Una columna que nadie escribe es una columna que nadie sabe
si funciona, y el día que la pasarela entre va a hacer falta migrar igual para
agregarle índices y restricciones.

**`pedidos.sale_id` sí se crea**, siempre `NULL` en estas tres etapas, con FK a
`sales`. Es la excepción y tiene motivo: es la columna que ata un pedido a la
venta que generó, y la etapa 3 la va a llenar sobre pedidos **que ya existen**.
Crearla ahora evita una migración con backfill sobre datos reales.

### `empresa_mercadopago` no se crea

Es la etapa 3 entera: OAuth, token cifrado, `marketplace_fee_pct`.

### Ninguna tabla de reserva de stock

Es la etapa 4, y no es solo una columna: cinco caminos existentes la borrarían
asignando `available = quantity` (`productionService.js:357` y `:380`,
`import.js:438`, `products.js:344` y `:350`, `general.js:265` y `:271`). Los
cinco se arreglan **en el mismo commit** que la reserva, o la reserva dura hasta
la primera importación.

---

## Las seis tablas nuevas

### 1 · `catalogos` — la cara pública y su configuración

| Columna | Tipo | Notas |
|---|---|---|
| `id` | INTEGER PK autoincremental | |
| `empresa_id` | INTEGER NOT NULL | Aislamiento. FK a `empresas`, `ON DELETE CASCADE` |
| `punto_de_venta_id` | INTEGER NOT NULL | FK a `puntos_de_venta`, **`ON DELETE RESTRICT`**. De acá sale el stock que se lee (FR-058) |
| `slug` | STRING(60) NOT NULL | **UNIQUE global**, no por empresa (FR-050) |
| `nombre_visible` | STRING(120) NOT NULL | «Comprafit / Fitnet» |
| `descripcion` | TEXT NULL | Va al `og:description` |
| `logo_url` | TEXT NULL | Ruta relativa `/img/aa/bb/…`, nunca absoluta |
| `portada_url` | TEXT NULL | Idem. Va al `og:image` |
| `color_marca` | STRING(7) NOT NULL DEFAULT `'#00B4B6'` | Un solo valor. El color del texto encima **se calcula** (FR-060) |
| `whatsapp_destino` | STRING(20) NULL | Por catálogo, no global (FR-184) |
| `email_avisos` | STRING(255) NULL | La casilla que recibe el aviso de pedido nuevo (decisión 7). Vacío es válido |
| `datos_transferencia` | JSONB NOT NULL DEFAULT `'{}'` | `{ titular, cbu, alias, banco }` |
| `retiro_socio` | BOOLEAN NOT NULL DEFAULT false | |
| `retiro_socio_direccion` | TEXT NULL | |
| `retiro_local` | BOOLEAN NOT NULL DEFAULT false | |
| `envio` | BOOLEAN NOT NULL DEFAULT false | |
| `envio_costo` | DECIMAL(12,2) NOT NULL DEFAULT 0 | |
| `envio_gratis_desde` | DECIMAL(12,2) NULL | **NULL o 0 significa «no hay envío gratis»**, no «todo gratis» |
| `coordinar_whatsapp` | BOOLEAN NOT NULL DEFAULT false | |
| `pide_nro_socio` | BOOLEAN NOT NULL DEFAULT false | |
| `pide_dni` | BOOLEAN NOT NULL DEFAULT false | **Modelado pero apagado y sin exponerse** hasta que se abra la puerta de FR-147a |
| `mostrar_precio_lista` | BOOLEAN NOT NULL DEFAULT **false** | El default seguro es no publicar el margen (FR-061, decisión 8) |
| `mp_habilitado` | BOOLEAN NOT NULL DEFAULT false | Se conserva y queda siempre en `false`: la pasarela es etapa 3 |
| `estado` | ENUM(`borrador`,`publicado`,`pausado`) NOT NULL DEFAULT `'borrador'` | Tres, ni uno más (FR-054) |
| `publicado_en` | TIMESTAMP NULL | |
| `created_at` / `updated_at` | TIMESTAMP | |

**Índices**

| Nombre | Columnas | Por qué |
|---|---|---|
| `uq_catalogo_slug` | `slug` UNIQUE | La garantía del slug único global **es este índice**, no un `findOne` previo: dos empresas pidiendo el mismo slug al mismo tiempo pasan las dos por el `findOne` (FR-050) |
| `idx_catalogo_empresa` | `(empresa_id)` | La lista del panel |
| `idx_catalogo_punto_de_venta` | `(punto_de_venta_id)` | Lo consulta la validación de FR-059, que corre en cada intento de desactivar una sucursal |

**Dos decisiones de esta tabla**:

- **`punto_de_venta_id` con `ON DELETE RESTRICT`, no `SET NULL`.** Un catálogo
  publicado sin punto de venta no sabe de dónde leer stock, y `NULL` obligaría a
  un ternario en cada consulta de disponibilidad — exactamente lo que
  `utils/sucursalDeStock.js` existe para que no pase. El rechazo por
  **desactivar** la sucursal (H13, FR-059) es otra cosa y vive en el handler,
  porque desactivar no es borrar y la base no lo puede impedir.
- **`slug` es STRING(60) y no TEXT**, con mínimo 3 en `validarSlug`. Un slug de
  doscientos caracteres no se copia a mano de un cartel.

### 2 · `catalogo_productos` — la lista de inclusión

| Columna | Tipo | Notas |
|---|---|---|
| `id` | INTEGER PK | |
| `catalogo_id` | INTEGER NOT NULL | FK a `catalogos`, `ON DELETE CASCADE` |
| `product_id` | INTEGER NOT NULL | FK a `products`, `ON DELETE CASCADE` |
| `orden` | INTEGER NOT NULL DEFAULT 0 | |
| `created_at` / `updated_at` | TIMESTAMP | |

**Índices**: `uq_catalogo_producto (catalogo_id, product_id)` UNIQUE —agregar dos
veces el mismo producto es un no-op, no una fila duplicada— e
`idx_catalogo_producto_catalogo (catalogo_id, orden)`, que es el orden en el que
se dibuja la grilla.

**Sin `empresa_id`, y a propósito**: la tabla se opera siempre como «las filas
del catálogo X», y X ya pasó por `findScoped`. Agregar la columna daría una
segunda fuente de verdad sobre a quién pertenece una fila, y dos fuentes es una
que puede estar mal.

**`ON DELETE CASCADE` desde `products`**: si alguien borra un producto, su fila
del catálogo se va con él. No hay nada que la fila pueda significar sin el
producto.

### 3 · `catalogo_reglas_precio` — cuatro ámbitos, tres columnas anulables

| Columna | Tipo | Notas |
|---|---|---|
| `id` | INTEGER PK | |
| `empresa_id` | INTEGER NOT NULL | FK, `CASCADE`. Está para que `findScoped(CatalogoReglaPrecio, id, empresaId)` funcione directo en el ABM (FR-081) |
| `catalogo_id` | INTEGER NOT NULL | FK, `CASCADE` |
| `ambito` | ENUM(`catalogo`,`categoria`,`marca`,`producto`) NOT NULL | |
| `categoria` | STRING(50) NULL | Solo con `ambito = 'categoria'` |
| `brand_id` | INTEGER NULL | FK a `brands`, **`ON DELETE SET NULL`** |
| `product_id` | INTEGER NULL | FK a `products`, **`ON DELETE CASCADE`** |
| `tipo` | ENUM(`porcentaje_descuento`,`monto_descuento`,`precio_fijo`) NOT NULL | |
| `valor` | DECIMAL(12,2) NOT NULL | |
| `activo` | BOOLEAN NOT NULL DEFAULT true | Una regla desactivada se comporta como si no existiera (FR-082) |
| `created_at` / `updated_at` | TIMESTAMP | |

**Tres columnas anulables en vez de un `ambito_valor STRING(100)` polimórfico**,
que es lo que traía el borrador del plan. El motivo, que es de la base y no de
estilo: **una columna que guarda «texto de categoría o `brand_id` o
`product_id`» no puede tener clave foránea**. Sin FK:

- borrar una marca deja una regla apuntando a un número que ya no existe, y la
  previsualización tendría que descubrirlo consultando;
- el `ON DELETE CASCADE` de FR-083 —borrar el producto borra su regla— **no se
  puede escribir**.

Con tres columnas, cada una tiene la FK que corresponde y el motor las respeta:
borrar el **producto** borra la regla (no hay nada que la regla pueda
significar); borrar la **marca** deja la regla con `brand_id` en `NULL`, que el
motor lee como «no alcanza a nadie» y la fila se dibuja atenuada, «0 de 0»
(edge case explícito de la spec: «no se borra sola»).

**El CHECK que exige exactamente la columna del ámbito**:

```sql
ALTER TABLE catalogo_reglas_precio ADD CONSTRAINT ck_regla_ambito CHECK (
  (ambito = 'catalogo'  AND categoria IS NULL AND brand_id IS NULL AND product_id IS NULL) OR
  (ambito = 'categoria' AND categoria IS NOT NULL AND brand_id IS NULL AND product_id IS NULL) OR
  (ambito = 'marca'     AND categoria IS NULL AND brand_id IS NOT NULL AND product_id IS NULL) OR
  (ambito = 'producto'  AND categoria IS NULL AND brand_id IS NULL AND product_id IS NOT NULL)
);
```

Sin el CHECK, una regla de ámbito `marca` con `product_id` cargado es una fila
que el motor no sabe interpretar y que ningún test va a producir.

**Cuatro índices únicos parciales**, uno por ámbito, en vez de uno solo sobre
`(catalogo_id, ambito, ambito_valor)`:

```sql
CREATE UNIQUE INDEX uq_regla_catalogo   ON catalogo_reglas_precio (catalogo_id)              WHERE ambito = 'catalogo';
CREATE UNIQUE INDEX uq_regla_categoria  ON catalogo_reglas_precio (catalogo_id, categoria)   WHERE ambito = 'categoria';
CREATE UNIQUE INDEX uq_regla_marca      ON catalogo_reglas_precio (catalogo_id, brand_id)    WHERE ambito = 'marca';
CREATE UNIQUE INDEX uq_regla_producto   ON catalogo_reglas_precio (catalogo_id, product_id)  WHERE ambito = 'producto';
```

Son los que garantizan FR-080 —dos reglas del mismo ámbito y el mismo objetivo
chocan contra **la base**, no contra un `findOne` previo— y, sobre todo, son lo
que hace que el motor de reglas sea simple: con estos cuatro índices, **un
producto tiene como mucho cuatro candidatas, una por ámbito**, así que «gana la
más específica» es un máximo sobre cuatro elementos y **no hay empate que
desempatar**.

⚠ Un índice único ordinario sobre `(catalogo_id, ambito, categoria, brand_id,
product_id)` **no serviría**: en Postgres, `NULL` no es igual a `NULL`, así que
dos reglas de ámbito `catalogo` —las dos con las tres columnas en `NULL`— no
chocarían nunca. Los índices parciales lo resuelven porque cada uno mira solo
las columnas que en su ámbito son `NOT NULL`.

### 4 · `pedidos` — lo que arma un visitante

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK, `defaultValue: UUIDV4` | Lo genera el servidor. **No viaja en ninguna respuesta pública** (FR-152) |
| `empresa_id` | INTEGER NOT NULL | FK, `RESTRICT`. Sale **del resolvedor de slug**, nunca del cuerpo (FR-150) |
| `catalogo_id` | INTEGER NOT NULL | FK a `catalogos`, **`ON DELETE RESTRICT`** — es lo que hace que borrar un catálogo con pedidos se rechace (FR-069) |
| `punto_de_venta_id` | INTEGER NOT NULL | FK, `RESTRICT`. El del catálogo en el momento del pedido, congelado |
| **`origen`** | **ENUM(`catalogo`) NOT NULL DEFAULT `'catalogo'`** | **Un solo valor por ahora.** Ver «La columna `origen`», más abajo |
| `numero` | INTEGER NOT NULL | Correlativo **por empresa**, arranca en 1, sin letra ni prefijo, no se reinicia nunca (decisión 10) |
| `estado` | ENUM(`pendiente_pago`,`pagado`,`en_preparacion`,`listo`,`entregado`,`cancelado`) NOT NULL DEFAULT `'pendiente_pago'` | Los seis de la maqueta (`:1478-1487`) |
| `comprador_nombre` | STRING(120) NOT NULL | Obligatorio (decisión 5) |
| `comprador_telefono` | STRING(30) NOT NULL | Obligatorio. Normalizado con `packages/pedido` |
| `comprador_email` | STRING(255) NULL | Opcional. Si falta, la confirmación **no promete** ningún email |
| `comprador_dni` | STRING(20) NULL | **Se crea y no se escribe** hasta que se abra la puerta de FR-147a |
| `comprador_nro_socio` | STRING(40) NULL | Declarativo, sin validar contra ningún padrón (H4) |
| `customer_id` | INTEGER NULL | FK a `customers`, `SET NULL` |
| `acepta_comunicaciones` | BOOLEAN NOT NULL DEFAULT false | **Se crea y queda en `false`** hasta la puerta |
| `consentimiento_en` | TIMESTAMP NULL | Un booleano no dice **cuándo** (FR-146) |
| `consentimiento_texto` | STRING(60) NULL | **Ni qué.** Guarda la versión del texto aceptado, no el texto entero |
| `entrega` | ENUM(`retiro_socio`,`retiro_local`,`envio`,`coordinar`) NOT NULL | Revalidada contra el catálogo al crear (FR-141) |
| `envio_direccion` / `envio_localidad` / `envio_cp` | STRING NULL | Obligatorios **solo** con `entrega = 'envio'`, y eso lo valida el handler, no la base |
| `subtotal` / `envio_costo` / `total` | DECIMAL(12,2) NOT NULL | **Los calcula el servidor** (FR-133) |
| `medio_pago` | ENUM(`transferencia`,`efectivo`) NOT NULL | **`mp` NO está en el enum**: la pasarela es etapa 3, y un valor que nadie puede producir es un valor que nadie probó |
| `notas` | TEXT NULL | |
| `idempotency_key` | STRING(64) NOT NULL | UNIQUE global |
| `sale_id` | STRING(40) NULL | FK a `sales`, `SET NULL`. **Siempre `NULL` en estas etapas** |
| `created_at` / `updated_at` | TIMESTAMP | |

**Índices**

| Nombre | Columnas | Por qué |
|---|---|---|
| `uq_pedido_numero` | `(empresa_id, numero)` UNIQUE | **La red de la numeración** (FR-137a). El mecanismo es el advisory lock; esto es lo que garantiza que jamás se emitan dos iguales |
| `uq_pedido_idempotencia` | `(idempotency_key)` UNIQUE | **La garantía de FR-136.** Global y no por empresa: la clave la genera el navegador como UUID, y dos empresas no la comparten. Molde: `uq_tn_pedido` |
| `idx_pedido_bandeja` | `(empresa_id, estado, created_at DESC)` | La consulta por defecto de la bandeja: los de una empresa, filtrados por estado, más nuevos primero |
| `idx_pedido_catalogo` | `(catalogo_id, created_at DESC)` | El filtro «Catálogo: todos» de la maqueta (`:1085`), y la conversión de la pestaña QR |
| **`idx_pedido_origen`** | **`(empresa_id, origen, created_at DESC)`** | El filtro de canal. Ver abajo |
| `idx_pedido_customer` | `(customer_id)` | «¿este comprador ya pidió antes?» |

#### La columna `origen`

`origen` es un ENUM con **un solo valor**, `catalogo`, y la bandeja dibuja una
columna **«Canal»** que hoy muestra siempre lo mismo, al lado del filtro
«Catálogo: todos».

Una columna con un solo valor parece decoración y no lo es: es lo que hace que
el día que entre un segundo canal **no haya que migrar datos ni enseñarle una
columna nueva a una pantalla que ya está en producción**. Agregar `origen`
después significa una migración con backfill sobre pedidos reales de un cliente.

`idx_pedido_origen` se crea **ahora** aunque hoy no discrimine nada: con un solo
valor el planificador lo va a ignorar, y cuesta unos kilobytes. Crearlo después,
sobre una tabla con pedidos, es un `CREATE INDEX` que bloquea escrituras —o un
`CONCURRENTLY` que no se puede correr dentro de la transacción de una migración
de sequelize-cli—.

El motivo de que la bandeja del catálogo **no** sea la bandeja de TiendaNube
está en la decisión 13 del plan, y el camino para unificarlas, en «Lo que haría
falta para unificar las dos bandejas».

### 5 · `pedido_items` — todo congelado

| Columna | Tipo | Notas |
|---|---|---|
| `id` | INTEGER PK | |
| `pedido_id` | UUID NOT NULL | FK a `pedidos`, `ON DELETE CASCADE` |
| `product_id` | INTEGER NULL | FK a `products`, **`ON DELETE SET NULL`** |
| `nombre` | STRING(200) NOT NULL | **Congelado.** Es lo que hace que un pedido cuyo producto se borró se siga viendo (US16 escenario 11) |
| `precio_unitario` | DECIMAL(12,2) NOT NULL | Congelado. Si mañana cambia la regla, el pedido de ayer no cambia |
| `precio_lista` | DECIMAL(12,2) NOT NULL | Congelado. **Sin esto no se puede contestar «¿por qué este pedido salió a este precio?»** seis meses después |
| `regla_id` | INTEGER NULL | FK a `catalogo_reglas_precio`, `SET NULL`. La otra mitad de la misma pregunta |
| `cantidad` | INTEGER NOT NULL | La **efectivamente** pedida, después del recorte por stock (decisión 6a) |
| `subtotal` | DECIMAL(12,2) NOT NULL | `precio_unitario × cantidad`, calculado por el servidor |
| `created_at` / `updated_at` | TIMESTAMP | |

**Sin `empresa_id`** — ver arriba: es lo que mantiene el ancla `toBe(3)` de
`aislamientoEmpresas.test.js:1136` en su lugar.

**`product_id` con `SET NULL` y no `CASCADE`**: borrar un producto **no puede**
borrar la línea de un pedido histórico. La línea sigue existiendo con su nombre
y su precio congelados, que es exactamente para lo que están congelados.

**Índice**: `idx_pedido_item_pedido (pedido_id)`. El `include` de la bandeja.

### 6 · `catalogo_visitas` — el contador agregado

| Columna | Tipo | Notas |
|---|---|---|
| `id` | INTEGER PK | |
| `catalogo_id` | INTEGER NOT NULL | FK, `ON DELETE CASCADE` |
| `fecha` | DATEONLY NOT NULL | La del negocio, con `fechaDelNegocio(zona)` de `utils/fechas.js` — no `toISOString()`, que en Argentina manda una visita de las 21:30 al día siguiente |
| `origen` | STRING(20) NOT NULL DEFAULT `'directo'` | Del parámetro `?f=` del QR. Se acota a un conjunto conocido; cualquier otra cosa cae en `otro` |
| **`estado_catalogo`** | **ENUM(`publicado`,`pausado`,`no_disponible`) NOT NULL** | El estado que tenía el catálogo **cuando entró la visita** |
| `cantidad` | INTEGER NOT NULL DEFAULT 0 | |
| `created_at` / `updated_at` | TIMESTAMP | |

**Índice**: `uq_visita (catalogo_id, fecha, origen, estado_catalogo)` UNIQUE. Es
lo que hace posible el `INSERT … ON CONFLICT DO UPDATE SET cantidad = catalogo_visitas.cantidad + 1`
(FR-200): **una fila por día**, no una por visita. Sin él, el endpoint más leído
del sistema sería el que más escribe (H7).

**`estado_catalogo` es la corrección del hallazgo 3 del plan.** Key Entities
proponía la clave `(catalogo_id, fecha, origen)`, y con esa clave **US20
escenario 7 no se puede cumplir**: la pestaña tiene que **distinguir** las
visitas que ocurrieron con el catálogo pausado «para que la conversión en cero
no se lea como un problema de la tienda», y la fila no guardaba el estado. Con
la cuarta columna, a lo sumo se triplican las filas —y en la práctica no, porque
un catálogo no cambia de estado todos los días—.

**No guarda IP, ni cookie, ni identificador de dispositivo** (FR-201). Contar no
es rastrear, y la tabla no tiene dónde poner un dato del visitante aunque
alguien quisiera.

---

## Las dos columnas nuevas en tablas existentes

### `products.publicable`

```
publicable  BOOLEAN NOT NULL DEFAULT false
```

**`false` para los 431 productos existentes** (FR-040, criterio 5): crear un
catálogo no publica nada que nadie eligió. El `DEFAULT false` del `addColumn` ya
lo hace; la migración lo **verifica** con un `COUNT(*) WHERE publicable = true`
que tiene que dar cero, y falla si no.

Un producto sale a un catálogo solo si es `publicable` **Y** `is_active` **Y**
tiene precio resoluble **Y** está en `catalogo_productos`. Son **cuatro**
condiciones con `Y`.

**Sin índice**: la consulta pública filtra por `catalogo_productos`, que ya está
indexada, y `publicable` se evalúa sobre las decenas de filas que quedaron.
Indexar un booleano con el 99 % en `false` no le sirve al planificador.

### `customers` — el índice que falta (H11, FR-151)

```
idx_customer_empresa  (empresa_id)
```

`models/Customer.js:51-52` declara índices por `name` y `tax_id` y **ninguno por
`empresa_id`**. No es un problema teórico a partir de esta funcionalidad: el
pedido público **crea o actualiza un `Customer` por comprador**, así que la
tabla pasa a recibir escrituras de gente que todavía no es cliente del comercio,
y toda búsqueda scopeada —incluida la del propio pedido, que busca por teléfono
dentro de la empresa— barrería la tabla entera.

Va en la migración de la etapa 0 aunque el pedido sea de la etapa 2: es una
línea, no cambia ningún comportamiento, y llegar tarde significa correrla sobre
una tabla que ya creció.

---

## Las cinco migraciones

Formato de `apps/api/src/migrations/`: `module.exports = { up, down }`, nombre
`YYYYMMDD-descripcion-en-kebab-case.js`, todo dentro de una transacción, y
`addConstraint` con `{ table, field }` y **no** `{ model, key }`.

| Archivo | Qué crea | Fase |
|---|---|---|
| `20260814-productos-publicables.js` | `products.publicable` + `idx_customer_empresa` | F0.2 |
| `20260815-catalogos.js` | `catalogos` con sus tres índices | F1.2 |
| `20260816-catalogo-productos-y-reglas.js` | `catalogo_productos` y `catalogo_reglas_precio`, con el CHECK y los cuatro índices parciales | F1.2 |
| `20260817-catalogo-visitas.js` | `catalogo_visitas` | F1.2 |
| `20260818-pedidos.js` | `pedidos` y `pedido_items` | F2.1 |

### Por qué cinco archivos y no uno

Porque el orden de las fases lo exige: `products.publicable` tiene que estar
corrido para la etapa 0 y `pedidos` recién para la etapa 2, y una migración que
crea las seis tablas de una obliga a que la etapa 0 arrastre tablas que nadie va
a escribir en dos meses. Con cinco, cada fase se puede desplegar y **revertir**
sola.

Y por qué `catalogo_productos` y `catalogo_reglas_precio` van juntas: las dos
tienen FK a `catalogos`, ninguna sirve sin la otra —un catálogo con productos y
sin reglas publica precios de lista, que es válido, pero un catálogo con reglas
y sin productos no publica nada— y las dos se borran juntas si la fase se
revierte.

### Lo que cada `down` tiene que hacer, y lo que no puede

- Los cuatro `down` de tablas hacen `dropTable` en orden inverso al de creación,
  para que las FK no bloqueen.
- El `down` de `20260814` hace `removeColumn('products', 'publicable')` y
  `removeIndex('customers', 'idx_customer_empresa')`. **Pierde el dato de qué
  productos eran publicables**, y eso va escrito en el encabezado: revertirla
  después de que alguien haya marcado sesenta productos significa volver a
  marcarlos. No hay tabla de archivo porque el dato es un booleano reconstruible
  a mano en cinco minutos, a diferencia de los gastos que
  `20260813-gastos-fijos-a-su-sucursal.js` sí archiva.
- **El `down` de `20260818` borra pedidos reales.** Se escribe igual —una
  migración sin `down` falla el día del rollback, con un error que no la nombra
  (`reversibilidadDeMigraciones.test.js:83-89`)— pero con la advertencia en el
  encabezado y en el mensaje. Es el único `down` de este hito que destruye datos
  de un cliente.

### Los tipos ENUM

Cinco enums nuevos: `catalogos.estado`, `catalogo_reglas_precio.ambito`,
`catalogo_reglas_precio.tipo`, `pedidos.origen`, `pedidos.estado`,
`pedidos.entrega`, `pedidos.medio_pago` y `catalogo_visitas.estado_catalogo`.

⚠ **El tipo del modelo y el de la migración tienen que ser el mismo.** El job
`navegador` del CI corre las migraciones **y después** el arranque en desarrollo
con `sequelize.sync({ alter: true })`: si una columna es `ENUM` en el modelo y
`VARCHAR` en la migración, el sync intenta convertirla, Postgres no castea el
default de texto a enum y **el job se cae**. Es el defecto que dejó ocho columnas
divergentes hasta el proyecto 0, y está escrito en `ci.yml:210-222`. Los ocho
enums de acá se declaran `DataTypes.ENUM(...)` en el modelo y
`Sequelize.ENUM(...)` en la migración, con **los mismos valores en el mismo
orden**.

---

## Los seis modelos

`apps/api/src/models/`: `Catalogo.js`, `CatalogoProducto.js`,
`CatalogoReglaPrecio.js`, `CatalogoVisita.js`, `Pedido.js`, `PedidoItem.js`.

**Los seis se exportan desde `models/index.js`** o `scripts/verificar-esquema.js`
no los mira: ese script hace un `findOne` real **por cada modelo exportado**
(`:278-314`) y compara tipos contra `information_schema` (`:317-344`). Corre en
el job «API — la imagen arranca y migra» (`ci.yml:352-359`), y es lo único que
detecta que una migración se olvidó una columna que el modelo declara.

**Una sola asociación**:

```js
Pedido.hasMany(PedidoItem, { foreignKey: 'pedido_id', as: 'items', onDelete: 'CASCADE' });
PedidoItem.belongsTo(Pedido, { foreignKey: 'pedido_id', as: 'pedido' });
```

**Las otras cuatro tablas van SIN asociaciones declaradas**, con el patrón y el
motivo de `models/index.js:39-48` —los cinco de TiendaNube—: `analizarIncludes`
de `aislamientoEmpresas.test.js` clasifica cualquier `include` de una tabla
asociada **con `empresa_id`** como «hijo con empresa_id», y su ancla existe para
no moverse. Las filas se leen planas y se unen en JS, que acá además no cuesta
nada: el motor de reglas es una función pura que **ya recibe arreglos planos**.

`Pedido.hasMany(PedidoItem)` **no** mueve el ancla porque `pedido_items` no
lleva `empresa_id` — es la mitad de por qué la columna no se crea.

⚠ El comentario que va al lado de las cuatro exportaciones sin asociación tiene
que decir esto mismo, como lo dice el de TiendaNube. Sin el comentario, la
próxima persona declara `Catalogo.hasMany(CatalogoReglaPrecio)` «para poder usar
`include`», el ancla se pone en rojo y el arreglo barato es cambiar el 3 por un
4 sin entender qué se estaba protegiendo.

---

## Lo que hay que agregarle a la semilla de `verificar-reversibilidad.js`

El script levanta un Postgres descartable, aplica cada migración, la revierte y
compara el esquema. Para que las cinco de este hito se verifiquen de verdad
—y no sobre tablas vacías, donde toda migración revierte bien— la semilla
necesita:

- **un catálogo publicado con su punto de venta**, para que el
  `ON DELETE RESTRICT` de `catalogos.punto_de_venta_id` tenga algo que restringir;
- **una regla de cada ámbito**, para que el CHECK y los cuatro índices parciales
  se ejerciten;
- **un pedido con dos líneas**, una de ellas apuntando a un producto que después
  se borra, para que el `SET NULL` de `pedido_items.product_id` se vea;
- **dos filas de `catalogo_visitas` del mismo día y el mismo origen con estados
  distintos**, que es lo único que distingue la clave de cuatro columnas de la de
  tres.

