# Modelo de datos: Cantidades decimales

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)
**Migración**: `apps/api/src/migrations/20260820-cantidades-decimales.js`

---

## Resumen del cambio

**No se crea ninguna tabla y no se crea ninguna columna.** Cambian de tipo **nueve
columnas** en **cuatro tablas**. Nada más.

| Tabla | Columna | Hoy | Después | Dónde está declarada hoy |
|---|---|---|---|---|
| `sale_items` | `quantity` | `INTEGER NOT NULL DEFAULT 1` | `NUMERIC(14,4) NOT NULL DEFAULT 1` | `20260531-initial-schema.js:364` · `models/Sale.js:176` |
| `stock` | `quantity` | `INTEGER NOT NULL DEFAULT 0` | `NUMERIC(14,4) NOT NULL DEFAULT 0` | `20260531-initial-schema.js:270` · `models/Stock.js:43` |
| `stock` | `available` | `INTEGER NOT NULL DEFAULT 0` | `NUMERIC(14,4) NOT NULL DEFAULT 0` | `20260531-initial-schema.js:271` · `models/Stock.js:48` |
| `stock` | `min_stock` | `INTEGER NOT NULL DEFAULT 0` | `NUMERIC(14,4) NOT NULL DEFAULT 0` | `20260531-initial-schema.js:272` · `models/Stock.js:53` |
| `stock_movements` | `cantidad_anterior` | `INTEGER NOT NULL` | `NUMERIC(14,4) NOT NULL` | `20260601-add-stock-movements-and-sales-status.js:13` · `models/StockMovement.js:30` |
| `stock_movements` | `cantidad_nueva` | `INTEGER NOT NULL` | `NUMERIC(14,4) NOT NULL` | `:14` · `models/StockMovement.js:34` |
| `stock_movements` | `disponible_anterior` | `INTEGER NOT NULL` | `NUMERIC(14,4) NOT NULL` | `:15` · `models/StockMovement.js:38` |
| `stock_movements` | `disponible_nuevo` | `INTEGER NOT NULL` | `NUMERIC(14,4) NOT NULL` | `:16` · `models/StockMovement.js:42` |
| `pedido_items` | `cantidad` | `INTEGER NOT NULL` | `NUMERIC(14,4) NOT NULL` | `20260819-pedidos.js:150` · `models/PedidoItem.js:34` |

**Nulabilidad, defaults, índices, claves foráneas y restricciones: sin cambios.**
`ALTER COLUMN … TYPE` conserva el `NOT NULL` y convierte el `DEFAULT` al tipo nuevo
(`0` pasa a `0.0000`, `1` a `1.0000`), que es el mismo valor.

---

## Por qué `DECIMAL(14,4)` y no otra cosa

**Cuatro decimales, y no tres.** `recipe_items.quantity` y
`production_orders.quantity_produced` ya son `DECIMAL(12,4)`
(`20260531-initial-schema.js:246`, `:377`), y son las que se restan de `stock`. Con
tres decimales, una producción que consume `1,2345` se redondearía al descontar:
**el mismo defecto que esta funcionalidad viene a eliminar, en espejo.**

**Cuántos decimales admite una línea de venta lo impone un validador, no la
columna.** El PENDIENTE 1 se resolvió en **3** —un gramo, la unidad más chica que
informa una balanza comercial— y esa regla vive en
`utils/cantidades.js:DECIMALES_DE_UNA_LINEA_DE_VENTA`, no en el esquema. En la 016
el endpoint acepta **cero** decimales (PENDIENTE 2); la 017 lo mueve a 3. La columna
no cambia en ninguno de los dos casos.

**Catorce dígitos** dejan diez enteros: `9.999.999.999,9999`. Una cantidad más
grande que eso se rechaza en el validador con un mensaje legible (FR-020, borde
«cantidad enorme»), y no con un 500 de Postgres.

---

## Lo que explícitamente NO cambia

| Qué | Por qué |
|---|---|
| Todos los importes `DECIMAL(12,2)` — `unit_price`, `total`, `cost`, `subtotal`, `precio_unitario`, `precio_lista` | FR-008. Esta funcionalidad no toca la plata |
| `recipe_items.quantity`, `production_orders.quantity_produced`, `production_order_items.quantity_used`, `recipes.yield` | Ya son `DECIMAL(12,4)`. Esta migración las **beneficia**; no las modifica |
| `products.unit_type`, `products.unit_size` | Siguen significando «este bulto se mide en kg» (FR-041). Hay fixtures que lo usan así (`tests/integracion/fixtures.js:145`, `:198`) |
| `stock_transfers.items` | Es `JSONB` (`models/StockTransfer.js:33-34`): una foto escrita desde el cuerpo del request, no una columna de cantidad |
| `products.se_vende_fraccionado` | **No se crea.** Es de la 017 |
| `empresas.settings.balanza` | **No se crea.** Es de la 018 |
| `empresas.rubro` | No se puebla, no se valida y no gobierna nada (FR-042) |
| `supplier_orders.detail` (`quantity`, `quantity_received`) | `JSONB`, y fuera del alcance de la spec |

---

## La migración `up`

Todo adentro de **una sola transacción**, sobre el molde de
`20260814-productos-publicables.js`. SQL crudo y no modelos de Sequelize: un modelo
describe el esquema de hoy y una migración corre contra el de ayer.

### 1 · Qué columnas hay que convertir

Se lee `information_schema.columns` y **se saltan las que ya son `numeric` con
precisión 14 y escala 4**. Dos motivos:

- **Idempotencia real** (borde «la migración corre dos veces»): un `ALTER TYPE` a un
  tipo que ya está reescribe la tabla para nada.
- **Y sobre todo, la verificación del paso 4.** El `COUNT(*)` de FR-005 solo puede
  exigir cero sobre las columnas que **esta corrida** convirtió: en una base que ya
  migró y donde después hubo una producción con consumo fraccionario, exigirlo sobre
  todas abortaría la migración por hacer bien su trabajo.

Si la lista queda vacía, se loguea «ya estaban las nueve» y se sale sin tocar nada.

### 2 · La foto de control

Una tabla temporal `ON COMMIT DROP` —muere con la transacción, haya commit o
rollback, y no deja basura— con la suma de cada columna a convertir, por tabla. Es
el molde de `20260804-identidad-de-sucursal-en-stock.js:76-84`.

### 3 · Los `ALTER`

```sql
ALTER TABLE <tabla> ALTER COLUMN <columna> TYPE NUMERIC(14,4);
```

Sin `USING`: `integer → numeric` es una conversión implícita y sin pérdida
(Assumption 2 de la spec), y FR-005 la verifica en vez de darla por hecha.

Sobre las magnitudes medidas —`sale_items` 4 filas, `stock` 42, `stock_movements` 5,
`pedido_items` 2— el `ACCESS EXCLUSIVE LOCK` que toma cada `ALTER` es instantáneo.
⚠ Esa medición es contra la base de Neon; **antes de correr esto contra el VPS
(`docker-compose.produccion.yml`) hay que repetirla ahí.**

### 4 · La verificación, adentro de la misma transacción

Dos comprobaciones, y si cualquiera falla la transacción se revierte entera y **no
queda nada aplicado**:

1. **FR-005 · Ninguna fila quedó fraccionaria.** Para cada columna convertida,
   `COUNT(*) WHERE <col> <> ROUND(<col>)` tiene que dar **cero**: antes eran todas
   enteras, así que después tienen que seguir siéndolo. El mensaje del error nombra
   la tabla, la columna y cuántas filas.
2. **Ninguna suma se movió.** La foto del paso 2 contra la de ahora. Es más fuerte
   que la primera: detecta también una fila que cambió de valor sin dejar de ser
   entera.

⚠ **Sobre una base vacía las dos pasan siempre y no verifican nada.** Por eso el
test de esta migración **siembra filas antes** de correrla (criterio de éxito 8).

### 5 · El log

Qué columnas convirtió y cuántas filas tenía cada tabla. Es lo que se lee el día del
despliegue para saber que hizo lo que dice.

---

## La migración `down` · negativa condicional

**No se puede negar siempre y no se puede revertir siempre.** Bajar de `NUMERIC` a
`INTEGER` pierde las fracciones, y redondearlas en silencio al revertir sería el
mismo defecto que la migración vino a eliminar, en espejo. Pero sin fracciones,
revertir es limpio, y negarse sin motivo obliga a la próxima persona a editar el
archivo de la migración.

1. **Contar.** Por tabla, las filas con **al menos una** columna fraccionaria:
   `WHERE <col> <> ROUND(<col>) OR …`.
2. **Si hay alguna, tirar.** El mensaje dice **qué tabla**, **cuántas filas** y qué
   hacer si igual hace falta —la exigencia que `verificar-reversibilidad.js:103-109`
   le pone a las que se niegan—:

   > No se puede revertir: `stock` tiene 3 fila(s) con cantidades fraccionarias y
   > volver a `INTEGER` las redondearía sin avisar, que es exactamente el defecto
   > que esta migración eliminó. Si hay que bajar igual, primero hay que decidir
   > **a mano** qué pasa con esas filas: redondearlas es inventar inventario.
   > No se aplicó nada.

3. **Si no hay ninguna, revertir:**

   ```sql
   ALTER TABLE <tabla> ALTER COLUMN <columna> TYPE INTEGER USING <columna>::integer;
   ```

   El `USING` va explícito aunque el cast de asignación exista: acá la conversión es
   el punto del paso y tiene que leerse, no deducirse.

4. **Avisar por log** qué se revirtió, igual que `20260814-productos-publicables.js:126-131`.

### Por qué **no** va en `SE_NIEGAN`

`scripts/verificar-reversibilidad.js:110` lista las que se niegan **siempre**, y su
test (`reversibilidadDeMigraciones.test.js:99-119`) corre el `down` **esperando que
falle**. Una negativa condicional metida ahí pasaría en verde sobre una base limpia
**por la razón equivocada** (H7, FR-012).

El precedente correcto es `20260804-identidad-de-sucursal-en-stock.js`, que se niega
por una condición de los datos y tiene su propio caso en
`reversibilidadDeMigraciones.test.js:121-129`.

`scripts/verificar-reversibilidad.js` la toma sola —recorre en ascendente desde
`DESDE_POR_DEFECTO`— y sobre su Postgres descartable, que está vacío, el `down`
revierte limpio y el esquema comparado queda idéntico. Ese es el resultado correcto.

---

## Los modelos

Cambian **en el mismo commit** que la migración (FR-006), o
`scripts/verificar-esquema.js` y el job «API — la imagen arranca y migra»
(`.github/workflows/ci.yml:502`) lo reportan.

```js
// models/Stock.js — las tres, y lo mismo en Sale.js, StockMovement.js, PedidoItem.js
quantity: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
```

⚠ **`verificar-esquema.js` compara `udt_name` y nada más** (`:204`): para él
`numeric(14,4)` y `numeric(12,4)` son la misma columna. O sea que **el script
verifica que sea `numeric`, no que la escala sea la correcta**. Lo que ata la escala
es una guardia estática que lee las dos puntas —`rawAttributes[…].type.options` del
modelo y el fuente de la migración—, en el molde de `modeloStock.test.js` y
`modeloSale.test.js`. El motivo de no tocar el script está en el plan, decisión «La
escala de la columna se ata con una guardia estática».

---

## Lo que el cambio de tipo provoca río abajo

No es teoría: es la razón por la que esta migración no puede ir sola.

| Hecho del driver | Consecuencia |
|---|---|
| `pg` devuelve `NUMERIC` como **string**, con la escala puesta | Un stock de 12 vuelve como `"12.0000"` **sin que exista un solo decimal en toda la base** |
| `'100' + 5` es `'1005'`; `'100' - 5` es `95` | **El operador decide**, no el valor. Rompen las sumas y no las restas |
| `Math.max(0, '100' + 5)` es `1005` | La función numérica de afuera convierte **después** de que ya se concatenó, y no lanza nada |
| `"0.0000"` es *truthy* | Todo `\|\|` y todo `if (cantidad)` sobre una cantidad leída de la base cambia de rama **en el caso de cero** |
| `"12.0000" == 12` es `true`, `=== 12` es `false` | Cualquier comparación estricta contra un número deja de funcionar |
| `JSON.stringify` devuelve `"quantity": "12.0000"` | Cambia el **tipo** de nueve campos de la respuesta: ver `contracts/api-endpoints.md` |
| `parseInt("0.4")` es `0` | `routes/import.js:406`, `:431` truncan sin avisar |

**No se registra ningún `pg.types.setTypeParser` global** (FR-027). Haría que los
importes empezaran a llegar como `number`, con la pérdida de precisión que el texto
evita: está escrito en
`tests/integracion/centavoDelSaldo.integracion.test.js:243`, y ese test se pondría en
rojo. La conversión se hace en el punto de uso, con `utils/cantidades.js`.

---

## Datos que no se reparan

Las cantidades que **ya** se corrompieron por el redondeo de producción **no se
recuperan**, y la migración no lo intenta. El `9,6` que se guardó como `10` en marzo
es indistinguible de un `10` legítimo, y reconstruirlo sería inventar el dato.

Es una decisión, no un olvido, y se repite en el aviso de `docs/OPERACION.md`: lo que
la migración arregla es que **desde ahora** no vuelva a pasar.
