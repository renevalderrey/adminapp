# Modelo de datos: TiendaNube

Complementa a [plan.md](./plan.md).

**Cinco tablas nuevas, dos columnas ensanchadas y una fila de `settings` que se
muda.** Ninguna tabla existente cambia de forma más allá de eso, y **el índice
único que pide FR-026 no se crea** — el motivo está en el hallazgo 1 del plan y
se repite abajo, porque es lo primero que alguien va a querer agregar.

---

## Lo que NO se hace, y por qué va primero

### El índice único sobre `stock_movements` no se crea

FR-026 pide `UNIQUE (empresa_id, referencia_id)` sobre `stock_movements`.
**`referencia_id` no es único por diseño en ninguno de sus usos:**

| Escritor | Línea | Valor | Filas por valor |
|---|---|---|---|
| Venta | `routes/sales.js:557` | `sale.id` | una **por línea** de la venta |
| Anulación | `routes/sales.js:726` | `sale.id`, el mismo | una por línea, **encima** de las de la venta |
| Pedido de TiendaNube | `services/tiendanubeService.js:154` | `tn_order_{id}` | una **por ítem** del pedido |
| Ajuste manual | `routes/general.js:95` | `null` | — (los `NULL` no chocan entre sí en Postgres) |

Con ese índice, un ticket de dos productos revierte la transacción entera y
`POST /api/sales` responde error. **No es un riesgo teórico: es el primer ticket
del día siguiente al deploy.**

La idempotencia va a `tiendanube_pedidos` con `UNIQUE (empresa_id,
tiendanube_order_id)`, que es una fila por pedido — la unidad de idempotencia de
verdad. Decisión 6 del plan.

### La columna `products.tiendanube_variant_id` no se borra

FR-072. Sacarla de `CAMPOS_EDITABLES` (`routes/products.js:44`) es reversible; el
`DROP COLUMN` no. La columna y su índice `idx_products_tiendanube_variant` quedan
como están.

### El token no cambia de lugar

`settings.tiendanube_access_token` se queda donde está, en texto plano, con su
PK compuesta `(key, empresa_id)`. FR-077: esta funcionalidad no lo cifra **y no
puede agregar ningún lugar nuevo donde quede en claro**. El cifrado es el proyecto
6 de `PROXIMOS-PROYECTOS.md` y se hace para AFIP y TiendaNube juntos, sobre
`settings`. Una columna `access_token` en `tiendanube_tiendas` sería un segundo
lugar que ese proyecto tendría que descubrir.

---

## Las cinco tablas

### 1 · `tiendanube_tiendas` — la vinculación

Una fila por empresa. Es lo que reemplaza a las dos filas de `settings` y lo que
sostiene FR-004, FR-006 y FR-036.

| Columna | Tipo | Nulo | Qué es |
|---|---|---|---|
| `empresa_id` | `INTEGER` | no | **PK**. FK `empresas(id)` `ON DELETE CASCADE`. Supuesto 14: una empresa, una tienda |
| `tiendanube_user_id` | `BIGINT` | no | **`UNIQUE`**. Es FR-036, y la garantía es de la base |
| `nombre` | `VARCHAR(200)` | sí | El nombre de la tienda, para el bloque de estado. Es de TiendaNube y puede no venir |
| `punto_de_venta_id` | `INTEGER` | **no** | FK `puntos_de_venta(id)` `ON DELETE RESTRICT`. La sucursal designada |
| `vinculada_en` | `TIMESTAMPTZ` | no | «Desde cuándo» (FR-004) |
| `ultima_comunicacion_en` | `TIMESTAMPTZ` | sí | Cuándo fue la última llamada a la API |
| `ultima_comunicacion_ok` | `BOOLEAN` | sí | El cuarto estado de FR-006 |
| `ultimo_error` | `VARCHAR(200)` | sí | Clasificado, **nunca `err.message` crudo** |
| `catalogo_refrescado_en` | `TIMESTAMPTZ` | sí | Lo que la pantalla muestra al lado de la instantánea |
| `reconciliada_en` | `TIMESTAMPTZ` | sí | Cuándo corrió la última reconciliación. Es la señal visible del riesgo 4 |
| `sincronizando_desde` | `TIMESTAMPTZ` | sí | El arriendo de FR-044 (decisión 9) |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | no | |

**`punto_de_venta_id` es `NOT NULL` a propósito.** Una columna que admite null
tiene una rama de omisión, y esa rama es exactamente el defecto de hoy: el
webhook pasa `null` y cae al punto de venta por defecto mientras la
sincronización elige otro por el orden de las filas. Se resuelve con
`sucursalPorDefecto(empresaId)` al vincular, que nunca devuelve null.

**`ON DELETE RESTRICT` y no `CASCADE`.** Borrar una sucursal no puede llevarse la
vinculación de la tienda por delante: lo que tiene que pasar es que la operación
falle y alguien elija otra sucursal.

**Por qué `tiendanube_user_id` es `BIGINT` y `empresa_id` es `INTEGER`.** El
primero es un identificador de un tercero (decisión 12); el segundo es nuestro y
todas las FK del repositorio lo declaran `INTEGER`.

### 2 · `tiendanube_estados_oauth` — el `state`

Una fila por flujo de OAuth iniciado. Decisión 2 del plan.

| Columna | Tipo | Nulo | Qué es |
|---|---|---|---|
| `token` | `VARCHAR(64)` | no | **PK**. 32 bytes de `crypto.randomBytes` en hexadecimal |
| `empresa_id` | `INTEGER` | no | FK `empresas(id)` `ON DELETE CASCADE` |
| `usuario_id` | `VARCHAR(255)` | sí | Quién inició el flujo. Mismo tipo que `stock_movements.usuario_id` |
| `expira_en` | `TIMESTAMPTZ` | no | 15 minutos desde la creación |
| `consumido_en` | `TIMESTAMPTZ` | sí | `NOT NULL` = ya se usó |
| `created_at` | `TIMESTAMPTZ` | no | Sin `updated_at`: la fila se escribe una vez y se consume una vez |

**Índice**: `idx_tn_estados_expira` sobre `(expira_en)`, para el barrido diario.
No hace falta ninguno más: la única lectura es por la PK.

**El consumo es un `UPDATE … RETURNING`, no un `findOne` + `update`:**

```sql
UPDATE tiendanube_estados_oauth
   SET consumido_en = NOW()
 WHERE token = $1 AND consumido_en IS NULL AND expira_en > NOW()
RETURNING empresa_id, usuario_id;
```

Cero filas = no sirve, sin distinguir cuál de las tres cosas pasó. Un `findOne`
seguido de un `update` deja pasar dos callbacks con el mismo `state`, que es
literalmente lo que «de un solo uso» tiene que impedir.

**El barrido**: `DELETE FROM tiendanube_estados_oauth WHERE expira_en < NOW() -
INTERVAL '1 day'`, en `POST /api/tareas/ejecutar`. Una tabla de tokens sin
barrido crece para siempre.

### 3 · `tiendanube_variantes` — la instantánea del catálogo **y** la cola

Una fila por (empresa, variante). Es la decisión 7: las dos cosas son la misma
pregunta —«¿cómo está esta variante?»— y la cola necesita **exactamente** una
fila por variante, que es lo que agrupa los empujones sin ningún temporizador.

| Columna | Tipo | Nulo | Qué es |
|---|---|---|---|
| `id` | `INTEGER` | no | PK autoincremental |
| `empresa_id` | `INTEGER` | no | FK `empresas(id)` `ON DELETE CASCADE` |
| `tiendanube_variant_id` | `BIGINT` | no | Con `empresa_id`, **`UNIQUE`** |
| `tiendanube_product_id` | `BIGINT` | no | Para agrupar las variantes de un producto en la pantalla |
| `nombre_producto` | `VARCHAR(300)` | sí | Lo que dice TiendaNube |
| `nombre_variante` | `VARCHAR(300)` | sí | Talle, color. Puede ser la variante por defecto |
| `sku` | `VARCHAR(100)` | sí | **Puede venir vacío**, y la sugerencia por SKU tiene que aguantarlo |
| `stock_en_tienda` | `INTEGER` | sí | Lo que la tienda dice que tiene, del último refresco |
| `vista_en` | `TIMESTAMPTZ` | no | Cuándo se la vio por última vez en el catálogo. Anterior al último refresco = **ya no está en la tienda** |
| `stock_publicado` | `INTEGER` | sí | Lo último que **se mandó** con éxito |
| `publicado_en` | `TIMESTAMPTZ` | sí | Cuándo |
| `pendiente_desde` | `TIMESTAMPTZ` | sí | `NOT NULL` = está en la cola |
| `proximo_intento_en` | `TIMESTAMPTZ` | sí | El backoff |
| `intentos` | `SMALLINT` | no | `DEFAULT 0`. A los 8 deja de reintentar sola |
| `ultimo_error` | `VARCHAR(200)` | sí | Clasificado |
| `motivo_no_publicado` | `VARCHAR(40)` | sí | `sin_stock_en_sucursal` / `sin_mapeo` / `producto_inactivo`. FR-046 |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | no | |

**Índices:**

| Nombre | Columnas | Qué consulta sirve |
|---|---|---|
| `uq_tn_variante` | `(empresa_id, tiendanube_variant_id)` **único** | El `upsert` del refresco y el del encolado. **Es lo que agrupa los empujones**: cien movimientos del mismo producto tocan la misma fila |
| `idx_tn_variantes_cola` | `(empresa_id, proximo_intento_en)` **parcial**, `WHERE pendiente_desde IS NOT NULL` | El drenaje. Parcial porque la cola es una fracción diminuta de la tabla y el índice no tiene por qué cargar el catálogo entero |
| `idx_tn_variantes_producto` | `(empresa_id, tiendanube_product_id)` | Agrupar las variantes de un producto en la pantalla |

**`stock_publicado` no es una segunda fuente de verdad.** Es el registro de **lo
que se mandó**, que es un hecho histórico. La fuente del stock sigue siendo
`stock.available` de la sucursal designada, y se lee en el momento de empujar.
Es lo que hace que la reconciliación pueda comparar tres números y saber cuál
está mal: lo que tenemos, lo que mandamos y lo que la tienda dice que tiene.

**No hay FK a `tiendanube_mappings`.** Una variante existe en la tienda con
mapeo o sin él, y un mapeo puede apuntar a una variante que ya no está en el
catálogo (después de desvincular y vincular otra tienda, [PENDIENTE N9]). Las dos
tablas se unen en JS por `(empresa_id, tiendanube_variant_id)`, que es lo que
evita subir el ancla de `analizarIncludes`.

### 4 · `tiendanube_pedidos` — la idempotencia y el resultado por ítem

Una fila por pedido. Reemplaza al índice imposible de FR-026 y es donde vive
FR-027.

| Columna | Tipo | Nulo | Qué es |
|---|---|---|---|
| `id` | `INTEGER` | no | PK autoincremental |
| `empresa_id` | `INTEGER` | no | FK `empresas(id)` `ON DELETE CASCADE` |
| `tiendanube_order_id` | `BIGINT` | no | Con `empresa_id`, **`UNIQUE`**. **Es la garantía de FR-026** |
| `numero` | `VARCHAR(40)` | sí | El número que ve el comprador, para la pantalla |
| `recibido_en` | `TIMESTAMPTZ` | no | Cuándo entró el webhook |
| `punto_de_venta_id` | `INTEGER` | no | La sucursal designada al momento del pedido. FK `ON DELETE RESTRICT` |
| `items` | `JSONB` | no | Una entrada por ítem: `{ variante, cantidad, product_id, descontado, motivo }` |
| `items_descontados` | `SMALLINT` | no | Para la pantalla, sin recorrer el JSONB |
| `items_sin_descontar` | `SMALLINT` | no | idem. **Es el número que hace visible el escenario 7 de US2** |
| `created_at` | `TIMESTAMPTZ` | no | Sin `updated_at`: una fila se escribe una vez |

**Índices:**

| Nombre | Columnas | Qué consulta sirve |
|---|---|---|
| `uq_tn_pedido` | `(empresa_id, tiendanube_order_id)` **único** | La idempotencia. Es lo único que la sostiene |
| `idx_tn_pedidos_pendientes` | `(empresa_id, recibido_en DESC)` **parcial**, `WHERE items_sin_descontar > 0` | La lista de «lo que no descontó» de la pantalla, que es la única lectura frecuente |

**Por qué `items` es JSONB y no una tabla hija.** Porque nadie va a consultar por
un ítem: se leen todos juntos, con su pedido, para dibujar una fila. Es el mismo
criterio que `supplier_orders.detail`. Y una tabla hija más sería un `include`
más que la guardia de `analizarIncludes` tendría que contar.

**Estas filas no se borran nunca.** Un pedido borrado es un pedido que se puede
volver a descontar si TiendaNube reintenta un webhook viejo — y los reintenta.
Riesgo 9 del plan.

### 5 · `tiendanube_corridas` — el registro de las corridas explícitas

Una fila por corrida **manual** o de **reconciliación**. El empujón por
movimiento **no escribe acá**: su estado vive en la fila de la variante (ajuste 4
del plan).

| Columna | Tipo | Nulo | Qué es |
|---|---|---|---|
| `id` | `INTEGER` | no | PK autoincremental |
| `empresa_id` | `INTEGER` | no | FK `empresas(id)` `ON DELETE CASCADE` |
| `empezada_en` | `TIMESTAMPTZ` | no | FR-042 |
| `terminada_en` | `TIMESTAMPTZ` | sí | `NULL` = se cortó por la mitad (US5 escenario 6) |
| `disparador` | `VARCHAR(20)` | no | `manual` \| `reconciliacion`. **`VARCHAR` con `CHECK`, no `ENUM`** |
| `usuario_id` | `VARCHAR(255)` | sí | Quién apretó el botón. `NULL` en la reconciliación |
| `mandadas` | `INTEGER` | no | `DEFAULT 0` |
| `fallidas` | `INTEGER` | no | `DEFAULT 0` |
| `fallas` | `JSONB` | sí | `[{ variante, sku, motivo }]`. **Solo las que fallaron** ([PENDIENTE N2]): con un catálogo grande las que salieron bien son cientos de filas que nadie lee |
| `created_at` | `TIMESTAMPTZ` | no | |

**Índice**: `idx_tn_corridas_empresa` sobre `(empresa_id, empezada_en DESC)`. La
pantalla pide **la última**, y eso es un `ORDER BY … LIMIT 1` que este índice
resuelve sin leer la tabla.

**`VARCHAR(20)` con `CHECK` y no `ENUM`, deliberadamente.** El proyecto 0 de
`PROXIMOS-PROYECTOS.md` dejó ocho columnas declaradas `ENUM` en el modelo y
creadas `VARCHAR` por las migraciones, y ese desajuste todavía está abierto:
`sync({ alter: true })` en desarrollo muere en `products.unit_type` antes de
llegar a cualquier otra cosa. Agregar un `ENUM` nuevo es agregarle una novena
columna a ese problema. El modelo declara `DataTypes.STRING(20)` y la migración
crea `VARCHAR(20)` con un `CHECK`: **los dos archivos dicen lo mismo**, que es lo
que ese proyecto pide.

**Se borran las de más de 90 días**, en `POST /api/tareas/ejecutar`. Riesgo 9.

---

## Las dos columnas que se ensanchan

`tiendanube_mappings.tiendanube_variant_id` y `.tiendanube_product_id` pasan de
`INTEGER` a `BIGINT`.

Es la decisión 12 del plan y una **desviación declarada del supuesto 4 de la
spec**, que dice que el modelo y su migración se conservan tal cual. Lo que el
supuesto protege queda intacto: los dos índices únicos `uq_tn_mapping_product` y
`uq_tn_mapping_variant`, las dos FK con `ON DELETE CASCADE`, y el bug documentado
de `addConstraint` con `key` en vez de `field`, que no puede volver.

**Por qué.** Son identificadores de un tercero y `int4` topa en 2.147.483.647.
Y sobre todo: `tiendanube_variantes.tiendanube_variant_id` es `BIGINT`, y unir
dos columnas del mismo dato con anchos distintos significa que el día del
desbordamiento una tabla acepta la fila y la otra no, dejando un mapeo que apunta
a una variante que existe.

**`products.tiendanube_variant_id` NO se ensancha**: es la columna muerta, deja
de ser escribible (FR-070) y ensanchar una columna que nadie va a escribir es
trabajo sin destino.

---

## La fila de `settings` que se muda

`settings` con `key = 'tiendanube_user_id'` se copia a
`tiendanube_tiendas.tiendanube_user_id` y **se borra**. `key =
'tiendanube_access_token'` **no se toca**.

**En producción esto es un no-op comprobable.** `getAuthUrl` nunca puso `state`
en la URL y `handleCallback` rechaza el callback sin `state`, así que
`getAccessToken` —el único que escribe esas dos filas
(`tiendanubeService.js:22-31`)— **nunca se ejecutó**. La migración existe para
una base de desarrollo con la fila puesta a mano, y por eso el `down` importa
igual: es lo único que devuelve el dato si hay que revertir.

**La sucursal designada, en la migración de datos.** Cada fila que se muda
necesita un `punto_de_venta_id`, que es `NOT NULL`. La migración lo resuelve en
SQL con los mismos tres escalones que `elegirPorDefecto`
(`utils/sucursalDeStock.js:59-69`), y **en ese orden**:

```sql
COALESCE(
  (SELECT id FROM puntos_de_venta p WHERE p.empresa_id = s.empresa_id AND p.code = 'principal' ORDER BY id LIMIT 1),
  (SELECT id FROM puntos_de_venta p WHERE p.empresa_id = s.empresa_id AND p.is_active ORDER BY id LIMIT 1),
  (SELECT id FROM puntos_de_venta p WHERE p.empresa_id = s.empresa_id ORDER BY id LIMIT 1)
)
```

Si los tres dan `NULL` —una empresa sin ninguna sucursal— **la fila no se muda y
la migración lo dice por `console.log`**, en vez de fallar: una empresa sin
sucursales no puede tener stock, así que tampoco puede tener una tienda que
sincronizar. Se vuelve a vincular a mano cuando tenga una.

---

## Los dos archivos de migración

`apps/api/src/migrations/20260810-tiendanube-vinculacion-y-estado.js`
`apps/api/src/migrations/20260811-tiendanube-catalogo-pedidos-y-corridas.js`

Siguen el molde de `20260808-indices-de-empresa-en-proveedores.js`: **SQL crudo,
una sola transacción, `IF NOT EXISTS` en el `up` e `IF EXISTS` en el `down`**.

### Por qué dos archivos y no uno

Porque **la primera mueve datos y la segunda no**. Un `down` que tiene que
restaurar filas de `settings` y un `down` que solo hace cinco `DROP TABLE` son dos
riesgos distintos, y `verificar-reversibilidad.js` los prueba de a uno: mezclarlos
significa que un fallo del `up` de una tabla nueva se lee como un fallo de la
migración de datos, y al revés.

Y porque el orden importa: `tiendanube_variantes` no tiene FK a
`tiendanube_tiendas` —a propósito, para que borrar la vinculación no se lleve la
instantánea— pero `tiendanube_pedidos.punto_de_venta_id` sí depende de que las
sucursales existan, y todo el hito depende de que la primera haya corrido.

### `20260810` — la vinculación, el `state` y el ensanchado

**`up`**, en una transacción:

1. `CREATE TABLE IF NOT EXISTS tiendanube_tiendas (…)` con la FK a `empresas`
   (`CASCADE`), la FK a `puntos_de_venta` (`RESTRICT`) y el `UNIQUE` de
   `tiendanube_user_id`.
2. `CREATE TABLE IF NOT EXISTS tiendanube_estados_oauth (…)` + su índice.
3. `INSERT INTO tiendanube_tiendas … SELECT … FROM settings s WHERE s.key =
   'tiendanube_user_id'` con el `COALESCE` de la sucursal de arriba y
   `WHERE … IS NOT NULL`, más `ON CONFLICT DO NOTHING` —dos empresas con el
   mismo `user_id` es exactamente el hallazgo 4 de la spec, y en ese caso **entra
   una y la migración imprime cuál quedó afuera**.
4. `DELETE FROM settings WHERE key = 'tiendanube_user_id'` **solo de las que
   entraron**.
5. `ALTER TABLE tiendanube_mappings ALTER COLUMN tiendanube_variant_id TYPE
   BIGINT`, y lo mismo con `tiendanube_product_id`.

**`down`**, en una transacción, exactamente al revés:

1. `ALTER … TYPE INTEGER` en las dos columnas. **No puede fallar por datos**:
   ningún valor guardado bajo `int4` puede exceder `int4`. Es lo que hace que el
   script la pueda probar de verdad.
2. `INSERT INTO settings (key, empresa_id, value) SELECT 'tiendanube_user_id',
   empresa_id, to_jsonb(tiendanube_user_id) FROM tiendanube_tiendas`
   `ON CONFLICT (key, empresa_id) DO NOTHING`. **Es el paso que devuelve el dato**,
   y el que la semilla de hoy no ejercitaría.
3. `DROP TABLE IF EXISTS tiendanube_estados_oauth`.
4. `DROP TABLE IF EXISTS tiendanube_tiendas`.

> ⚠ El `value` vuelve como **número** (`to_jsonb(bigint)`), y el código viejo lo
> comparaba con `String(s.value) === String(storeId)`
> (`controllers/tiendanube.js:98`), que aguanta las dos formas. El comentario de
> ese archivo dice que el valor «puede estar guardado como number o como string»:
> el `down` elige `number`, que es lo que `Setting.upsert` producía con el
> `user_id` de la respuesta del OAuth.

### `20260811` — el catálogo, los pedidos y las corridas

**`up`**: tres `CREATE TABLE IF NOT EXISTS` y sus seis índices, todo aditivo, sin
tocar ninguna fila existente.

**`down`**: tres `DROP TABLE IF EXISTS` en orden inverso. **Reversible de verdad
y sin condiciones**: no guarda ningún dato que no se pueda volver a construir
—la instantánea se refresca desde TiendaNube y las corridas son un registro—
salvo `tiendanube_pedidos`, cuya pérdida significa que un webhook viejo
reintentado volvería a descontar. **Eso queda escrito en el `down`**, y es la
razón por la que revertir esta migración con una tienda vinculada en producción
no es una operación gratuita.

---

## Los cinco modelos

`models/TiendanubeTienda.js`, `TiendanubeEstadoOauth.js`, `TiendanubeVariante.js`,
`TiendanubePedido.js`, `TiendanubeCorrida.js`, registrados en `models/index.js`.

**Sin ninguna asociación declarada**, y eso es deliberado:

- `verificar-esquema.js` hace un `findOne` **por modelo de `src/models`**
  (`:288`), así que las cinco tablas entran a ese chequeo solo si los modelos
  están registrados en `index.js`. Ese es el motivo de registrarlos.
- Declarar `Product.hasOne(TiendanubeVariante)` o `hasMany(TiendanubeMapping)`
  haría que el detector `analizarIncludes` de `aislamientoEmpresas.test.js`
  clasificara cualquier `include` de esas tablas como «hijo con `empresa_id`» y
  **subiría el ancla de `toBe(4)`**. Como ninguna consulta de este hito usa
  `include` —se traen las filas planas y se unen en JS, igual que la decisión 4
  del plan de la 012— la asociación no aporta nada y el ancla no se mueve.
- Los índices que el modelo declara llevan **`name` explícito idéntico al de la
  migración**, por el motivo escrito en `20260808`: Sequelize los nombraría
  `<tabla>_<col>_<col>` y un `sync({ alter: true })` en desarrollo crearía un
  **segundo** índice sobre las mismas columnas.

**Los dos hooks van en `models/Stock.js`**, no en un modelo nuevo: `afterCreate`
y `afterUpdate`, con `options.transaction`, envueltos en `try/catch` con
`logger.error`. Decisión 8a y riesgo 3 del plan.

---

## Lo que hay que agregarle a la semilla de `verificar-reversibilidad.js`

Hallazgo 5 del plan, y es trabajo de la fase 1. Hoy `sembrar()`
(`scripts/verificar-reversibilidad.js:425-470`) **no inserta en `settings`, ni en
`puntos_de_venta`, ni en `stock`, ni en `tiendanube_mappings`**. Sin esas cuatro
cosas, el `down` de `20260810` compara dos esquemas idénticos, no restaura
ninguna fila y sale con código 0 **sin haber ejecutado su rama de datos**.

Lo que hay que sembrar, y por qué cada cosa:

| Qué | Por qué |
|---|---|
| Dos filas de `puntos_de_venta` para la empresa 1: una con `code = 'principal'` y otra activa de id menor | Para que el `COALESCE` de tres escalones **elija** y no caiga siempre al mismo. Con una sola sucursal, los tres escalones dan lo mismo y el orden no se prueba |
| Una empresa **sin ninguna** sucursal, con su fila de `settings` | Es la rama del `console.log` que deja la fila sin mudar. Sin ella, esa rama no se ejecuta nunca |
| Dos filas de `settings`: `tiendanube_user_id` y `tiendanube_access_token`, de empresas distintas | Para que el `up` mueva una y **no** toque la otra, y el `down` restaure una sola |
| Una fila de `tiendanube_mappings` con `tiendanube_variant_id` grande pero dentro de `int4` | Para que el `ALTER TYPE` de ida y de vuelta tenga una fila que convertir |

Es exactamente lo que el encabezado del propio script pide: «sobre una base
vacía casi todo `down` pasa».
