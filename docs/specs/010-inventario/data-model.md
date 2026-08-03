# Modelo de datos: Inventario — pasada fina

Complementa a [plan.md](./plan.md). Cambian tres tablas: `stock` cambia de
verdad, `product_cost_history` gana dos columnas nulas, y nace
`stock_migracion_sucursal`, que existe para que lo de `stock` sea reversible.

**Migración**: `20260804-identidad-de-sucursal-en-stock.js`. Es la número **14**;
las trece anteriores están aplicadas y la cadena está al día.

---

## Lo que hay hoy, que no es lo que dice el modelo

Antes de nada, porque cambia el plan: **`Stock.js:66` declara un índice único
`(product_id, punto_de_venta_id)` que la base no tiene.** Esa lista de `indexes`
solo la aplica `sequelize.sync()`, que este proyecto no usa. Lo que existe en
Postgres lo puso `20260531-initial-schema.js:544`:

```js
await queryInterface.addIndex('stock', ['product_id', 'location'], { unique: true });
```

O sea, hoy en `stock`:

| Índice | Columnas | Único |
|---|---|---|
| `stock_pkey` | `id` | sí |
| `stock_product_id_location` | `(product_id, location)` | **sí** |
| `stock_location` | `location` | no |
| `stock_empresa_id` | `empresa_id` | no |
| `stock_punto_de_venta_id` | `punto_de_venta_id` | no |
| FK | `punto_de_venta_id → puntos_de_venta.id`, `ON DELETE SET NULL` | — |

Tres consecuencias:

1. **FR-042 describe mal el problema.** No es que el índice no separe por los
   nulos: es que **no existe**. Hay que crearlo.
2. **Hoy no puede haber dos filas del mismo producto con el mismo `location`.**
   Los duplicados que la migración va a encontrar son filas con `location`
   **distinto** que caen en la misma sucursal. Eso acota el problema y es lo que
   hace que la consolidación sea abordable.
3. **El paso que reescribe `location` colisionaría con ese índice** si quedaran
   duplicados, así que el orden de FR-043 no es negociable: consolidar antes de
   reescribir el espejo.

Y una consecuencia sobre `ON DELETE SET NULL`: con `punto_de_venta_id NOT NULL`,
borrar un punto de venta pasa a **fallar** en vez de dejar stock huérfano. Es lo
correcto —la mercadería no se evapora al cerrar un local, dice la spec— y hay que
saberlo: `DELETE /api/empresas/puntos-de-venta/:id` (`empresas.js:594`) tiene que
seguir siendo un borrado blando. La FK se cambia a `ON DELETE RESTRICT`.

---

## `stock` — el cambio principal

### Estado final

| Columna | Tipo | Nulo | Cambio |
|---|---|---|---|
| `punto_de_venta_id` | `INTEGER` | **no** | era nulo. **La identidad de la sucursal** (FR-040) |
| `location` | `VARCHAR(30)` | no | sin cambio de tipo. **Pasa a ser espejo del `code`**, lo escribe el servidor (FR-041) |

### Índices al terminar

| Índice | Columnas | Único | Qué pasa |
|---|---|---|---|
| `stock_product_id_punto_de_venta_id` | `(product_id, punto_de_venta_id)` | sí | **nuevo** (FR-042) |
| `stock_product_id_location` | `(product_id, location)` | sí | **se elimina** (decisión 6) |
| `stock_location`, `stock_empresa_id`, `stock_punto_de_venta_id` | | no | quedan |
| FK a `puntos_de_venta` | | — | pasa de `SET NULL` a `RESTRICT` |

`models/Stock.js` se actualiza para que su lista de `indexes` diga lo que la base
tiene. Hoy miente, y esa mentira es la que hizo que la spec diagnosticara mal.

---

## `stock_migracion_sucursal` — tabla nueva

Una fila **por cada fila de `stock` que la migración tocó**, más una por cada
punto de venta que creó. Es al mismo tiempo el informe que pide FR-046 y el
respaldo que hace reversibles los pasos 2 a 4.

| Columna | Tipo | Nulo | Para qué |
|---|---|---|---|
| `id` | `INTEGER` PK | no | |
| `empresa_id` | `INTEGER` | no | Toda consulta futura se filtra por acá. |
| `motivo` | `VARCHAR(20)` | no | `'reasignada'`, `'fusionada'` o `'pv_creado'`. |
| `stock_id` | `INTEGER` | sí | La fila original. Nulo cuando `motivo = 'pv_creado'`. |
| `stock_id_sobreviviente` | `INTEGER` | sí | Con qué fila se fusionó. Solo en `'fusionada'`. |
| `product_id` | `INTEGER` | sí | Para leer el informe sin juntar con `stock`. |
| `punto_de_venta_id_anterior` | `INTEGER` | sí | Lo que había antes. En la práctica siempre `NULL`, y por eso importa que quede escrito. |
| `punto_de_venta_id_nuevo` | `INTEGER` | sí | A dónde fue. En `'pv_creado'`, el punto de venta creado. |
| `location_anterior` | `VARCHAR(30)` | sí | **El texto que había escrito el operador.** Es lo único que se pierde al reescribir el espejo. |
| `fila` | `JSONB` | sí | La fila entera, tal cual, antes de desaparecer. Solo en `'fusionada'`. |
| `revisar` | `BOOLEAN` | no | `true` si la fusión tiene señales de doble registro. Ver abajo. |
| `nota` | `TEXT` | sí | Por qué se marcó, y los lotes descartados. |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | no | `underscored: true` es global (`config/database.js:44`). |

Índices: `(empresa_id)`, `(motivo)`, `(stock_id)`.

**Por qué una tabla y no un log.** FR-046 pide informar cada consolidación. Un
`logger.info` en el arranque de un contenedor que se recicla no es un informe: es
un texto que existió durante una hora. Y FR-047 —«ningún dato se pierde»— con las
filas borradas es aritmético, no literal: la suma se conserva, las filas no. Con
la tabla, las dos cosas se cumplen de verdad y además el `down` puede hacer algo
más que fallar.

**Cuánto ocupa.** Una fila por fila de stock tocada, una vez. Con 5.000 productos
y tres sucursales son 15.000 filas de una tabla de trece columnas escalares. Es
nada, y se saca cuando el inventario de Comprafit esté verificado (riesgo 5 del
plan).

### Cuándo se marca `revisar`

Ninguna de estas señales prueba nada; todas juntas son lo único que hay para
distinguir «dos pilas» de «una pila anotada dos veces». Se marca `revisar = true`
si se cumple **al menos una**:

| Señal | Por qué |
|---|---|
| Las dos filas tienen la **misma** `quantity` y es > 0 | Dos caminos que escribieron el mismo número absoluto sobre la misma estantería. |
| Las dos tienen `current_batch` **nulo** o **igual** | Sin lote no hay evidencia de que sean pilas distintas. |
| Las dos tienen `updated_at` a menos de 24 h | Se escribieron en la misma sesión de trabajo. |
| Alguna tiene `quantity` negativa | Sumar un negativo tapa una sobreventa. |
| Alguna tiene `available > quantity` | Ya estaban desincronizadas antes de fusionar; la suma conserva la anomalía. |

Y **no** se marca —o sea, la suma es casi seguro correcta— cuando las dos filas
tienen `current_batch` distintos y no nulos: dos lotes son dos entradas de
mercadería distintas.

---

## `product_cost_history` — dos columnas nuevas

| Columna | Tipo | Nulo | Default | Para qué |
|---|---|---|---|---|
| `usuario_id` | `INTEGER` | sí | `NULL` | Quién hizo el cambio. Apunta a `usuarios.id` (FR-108). |
| `empresa_id` | `INTEGER` | sí | `NULL` | De qué empresa es la fila (FR-109). |

Índice nuevo: `(empresa_id, change_date)`. La consulta futura de «qué costos
cambiaron esta semana» —que está Fuera de alcance pero que esta columna habilita—
es exactamente esas dos condiciones.

**Backfill de `empresa_id`**, en la misma migración:

```sql
UPDATE product_cost_history h
   SET empresa_id = p.empresa_id
  FROM products p
 WHERE p.id = h.product_id
   AND h.empresa_id IS NULL;
```

Queda nula solo para filas cuyo producto ya no existe. Por eso la columna **no**
es `NOT NULL`: obligarla sería inventar un valor para esas filas.

**`usuario_id` no se backfillea.** Ese dato no existe y no se puede inferir
(supuesto 16). Las filas anteriores quedan sin autor y la pantalla lo muestra
como dato viejo, no como error (escenario 9 de la historia 6).

**Por qué `INTEGER` a `usuarios.id` y no el `sub` de Auth0.** Está razonado en la
decisión 9 del plan: `StockMovement.usuario_id` es `STRING(255)` y ya tiene
guardado el literal `'tiendanube'`. Una columna que significa «id de usuario, o lo
que sea» no se puede juntar con `usuarios` y no puede contestar «quién».

`models/index.js` suma:

```js
ProductCostHistory.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
ProductCostHistory.belongsTo(Empresa, { foreignKey: 'empresa_id', as: 'empresa' });
```

---

## La migración, paso por paso

Todo dentro de **una sola transacción**. Si cualquier chequeo falla, no queda
nada aplicado. Sin modelos de Sequelize: SQL crudo (decisión 3).

### Paso 0 — La foto de control

```sql
CREATE TEMP TABLE control_antes AS
  SELECT empresa_id, product_id, SUM(quantity) AS q, SUM(available) AS d
    FROM stock GROUP BY 1, 2;
```

Es lo que el paso 8 vuelve a mirar. **Reversible:** es temporal, muere con la
transacción.

### Paso 1 — Toda empresa con stock tiene al menos un punto de venta

Para cada `empresa_id` que tenga filas en `stock` y ninguna en
`puntos_de_venta`, se inserta `{ name: 'Sucursal Principal', code: 'principal',
is_active: true }` — el mismo que crea `POST /api/empresas`
(`empresas.js:110-114`). Se registra en `stock_migracion_sucursal` con
`motivo = 'pv_creado'`.

Sin esto no hay a dónde mandar las filas y `NOT NULL` no se puede aplicar.

**Reversible:** sí. El `down` borra los puntos de venta que están registrados como
`'pv_creado'`, después de haber devuelto el stock a `NULL`.

### Paso 2 — Backfill por coincidencia de `code`

Para cada fila con `punto_de_venta_id IS NULL`, el punto de venta de **su misma
empresa** cuyo `code` sea igual a su `location`. La comparación es exacta y
sensible a mayúsculas, igual que hoy en `seedPuntosDeVenta.js:88` y en
`stock.js:30` — cambiarla acá haría que la migración mapee distinto de como
mapean las rutas, que es peor que mapear poco.

**Reversible:** sí, desde `stock_migracion_sucursal.punto_de_venta_id_anterior`.

### Paso 3 — Las que no coinciden, al punto de venta por defecto

El por defecto de la empresa, en este orden (FR-044 más el escalón que le falta,
ver «Lo que la spec pide y hay que ajustar» § 4):

1. `code = 'principal'`, si existe;
2. el **activo** de menor `id`;
3. el de menor `id`, activo o no.

El tercero cubre la empresa que cerró todos sus locales y todavía tiene stock —el
caso en que justamente hay mercadería que rescatar—. Si no hay ninguno, es porque
el paso 1 le creó uno.

**Reversible:** igual que el paso 2.

### Paso 4 — Consolidar los duplicados

Se agrupa por `(empresa_id, product_id, punto_de_venta_id)`. Los grupos de más de
una fila se fusionan. **Sobrevive la de mayor `quantity`**; a igualdad, la de
menor `id`, para que el resultado sea determinístico.

| Campo | Qué queda | Cambio contra FR-045 |
|---|---|---|
| `quantity` | la suma | — |
| `available` | la suma | — |
| `min_stock` | el máximo | — |
| `expiration_date` | **el más próximo de los no nulos** | **sí** — FR-045 dice «el de la fila con más cantidad» |
| `purchase_date` | **el más antiguo de los no nulos** | **sí**, por simetría |
| `current_batch` | **el de la fila con más cantidad de las que tienen lote** | **sí** — los descartados van a `nota` |

**Por qué el lote no lo decide la cantidad sola.** FR-045 dice «el de la fila con
más cantidad». Si esa fila tiene el lote en `NULL` y la otra tiene uno real, el
resultado queda **sin lote**: el único dato que había desaparece sin que hubiera
ninguna razón para descartarlo. Un lote es identidad, no magnitud, y perderlo
rompe un retiro de producto —no queda con qué saber qué mercadería hay que sacar
de la góndola—; suplementos es un rubro donde eso pasa. La regla es: si **una
sola** fila tiene lote, gana ese sin importar la cantidad; si **las dos** tienen
lotes distintos, gana el de la fila mayor y el otro va a descartados; si ninguna
tiene, queda `NULL`.

Esto **no** apaga la señal «no hay dos lotes distintos que las separen»: la señal
contesta «¿hay evidencia de que sean dos pilas?» —y un lote solo no separa nada—,
mientras que la elección del lote contesta «¿cuál queda?». Son dos preguntas
distintas y confundirlas sacaría del recuento justo el caso más dudoso.

**Por qué el vencimiento cambia de criterio.** La spec elige el máximo para
`min_stock` y lo justifica: «el criterio conservador: avisa antes de más, no de
menos». Para el vencimiento elige el contrario. Si la fila de 100 unidades vence
en enero y la de 5 vence el mes que viene, quedarse con enero **saca esas 5
unidades de la alerta de vencimientos** (`general.js:360-366` mira los próximos 30
días). El criterio conservador acá es el vencimiento más próximo: avisa antes, y
lo peor que puede pasar es una alerta de más.

Cada fila que desaparece se copia entera a `stock_migracion_sucursal` **antes** de
borrarse, con `motivo = 'fusionada'`, `stock_id_sobreviviente`, el `JSONB` de la
fila y la marca `revisar`.

**Reversible:** sí, y **solo** por esto. Es el paso que da la razón de existir a la
tabla.

### Paso 5 — El espejo

```sql
UPDATE stock s
   SET location = LEFT(COALESCE(pv.code, pv.name), 30)
  FROM puntos_de_venta pv
 WHERE pv.id = s.punto_de_venta_id
   AND s.location IS DISTINCT FROM LEFT(COALESCE(pv.code, pv.name), 30);
```

`LEFT(...,30)` porque `location` es `VARCHAR(30)` y `puntos_de_venta.name` es
`VARCHAR(100)` (riesgo 4 del plan). El dato autoritativo es el id: recortar el
espejo no pierde nada.

**Reversible:** sí, desde `location_anterior`.

### Paso 6 — `NOT NULL`

```sql
ALTER TABLE stock ALTER COLUMN punto_de_venta_id SET NOT NULL;
```

Antes, la guarda: `SELECT count(*) FROM stock WHERE punto_de_venta_id IS NULL`
tiene que dar 0. Si no da, se aborta con el mensaje de cuántas quedaron y de qué
empresas. Un `ALTER` que falla con el error de Postgres no dice qué revisar.

**Reversible:** sí, trivialmente.

### Paso 7 — Los índices

- `DROP INDEX stock_product_id_location` (decisión 6).
- `CREATE UNIQUE INDEX stock_product_id_punto_de_venta_id ON stock (product_id, punto_de_venta_id)`.
- La FK a `puntos_de_venta` pasa de `ON DELETE SET NULL` a `ON DELETE RESTRICT`.

**Reversible:** sí. El `down` recrea el único sobre `(product_id, location)` y
**falla a propósito** si quedaron dos filas con el mismo par: elegir cuál
sobrevive es una decisión de negocio, no de la migración. Es el mismo criterio que
`20260730-settings-pk-por-empresa.js:66-68`.

### Paso 8 — La verificación, adentro de la transacción

```sql
SELECT count(*) FROM control_antes a
  JOIN (SELECT empresa_id, product_id, SUM(quantity) q, SUM(available) d
          FROM stock GROUP BY 1,2) b
    ON b.empresa_id = a.empresa_id AND b.product_id = a.product_id
 WHERE b.q <> a.q OR b.d <> a.d;
```

Distinto de 0 → se lanza el error y se revierte todo. Es el criterio de éxito 5
de la spec, **ejecutado por la migración** en vez de comprobado a mano después.
También se verifica que no haya quedado ningún `product_id` de `control_antes` sin
fila en `stock`.

### Idempotencia (FR-048)

Cada paso está condicionado al estado que corrige: el 1 solo mira empresas sin
punto de venta, el 2 y el 3 solo filas con `punto_de_venta_id IS NULL` —que
después del paso 6 no puede haber—, el 4 solo grupos de más de una fila, el 5 solo
las que difieren del espejo. Una segunda corrida no encuentra nada. Los `CREATE
INDEX` y el `ALTER` van con chequeo de existencia previo, porque son los únicos
que fallarían en vez de no hacer nada.

`sequelize-cli` igual no la vuelve a ejecutar: está en `SequelizeMeta`. La
idempotencia importa por el otro camino, el de correr a mano el mismo plan desde
`scripts/informe-stock-sucursal.js`.

### `down()`

En orden inverso:

1. FK de vuelta a `SET NULL`; se borra el único de `(product_id, punto_de_venta_id)`.
2. `punto_de_venta_id` vuelve a admitir nulos.
3. Se reinsertan las filas `'fusionada'` desde `fila`, con su `id` original, y se
   restauran los valores de la fila sobreviviente.
4. Se restauran `punto_de_venta_id_anterior` y `location_anterior` de las
   `'reasignada'`.
5. Se borran los puntos de venta `'pv_creado'`.
6. Se recrea el único sobre `(product_id, location)` — **falla si en el medio se
   crearon duplicados**, a propósito.
7. Se borra `stock_migracion_sucursal`.

**Lo que el `down` no puede hacer, y queda dicho en el encabezado del archivo:**
restaura exactamente lo archivado y **pisa cualquier movimiento de stock
posterior a la migración**. Es para volver atrás minutos después de un deploy, no
semanas después. Un `down` que intentara reconciliar movimientos posteriores
estaría adivinando.

---

## Entidades que **no** cambian

| Entidad | Por qué se aclara |
|---|---|
| `Sale.location`, `Sale.punto_de_venta_id` | La migración de identidad es **solo para `Stock`** (Fuera de alcance de la spec). `sale.punto_de_venta_id` sigue nulo en las ventas viejas, y por eso `PUT /:id/void` tiene que resolver la sucursal en vez de confiar en él. |
| `ProductionOrder.location` | Igual. |
| `StockTransfer` | `from_punto_de_venta_id` / `to_punto_de_venta_id` siguen nullable, y los `_location` siguen siendo `NOT NULL`. La transferencia nueva los llena siempre; las viejas quedan como están. |
| `PuntoDeVenta.code` | Sigue **nullable**, y el único `(empresa_id, code)` no impide dos nulos —la misma trampa de Postgres que la spec señala—. Por eso el espejo cae al `name` cuando el `code` es nulo, y por eso el único sobre `location` se saca. |
| `Product.cost` | Un costo por producto, no por sucursal (supuesto 9). |
| `Setting` | Nada nuevo persistido. `umbral_stock_bajo` sale en `GET /api/settings` como valor derivado, de solo lectura. |
