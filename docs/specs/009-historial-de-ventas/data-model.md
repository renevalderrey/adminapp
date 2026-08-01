# Modelo de datos: Historial de ventas

Complementa a [plan.md](./plan.md). Solo cambia la tabla `sales`, y solo con
columnas nuevas nulas y un índice. **Ninguna fila existente se modifica.**

---

## `sales` — dos columnas nuevas

| Columna | Tipo | Nulo | Default | Para qué |
|---|---|---|---|---|
| `afip_ultimo_error` | `TEXT` | sí | `NULL` | El mensaje con el que AFIP rechazó el último intento de facturación, tal cual lo devolvió. |
| `afip_ultimo_intento` | `TIMESTAMP WITH TIME ZONE` | sí | `NULL` | Cuándo fue ese intento. Se escribe también en los intentos exitosos. |

### Por qué existen

Hoy el error de AFIP se loguea (`sales.js:432`) y se devuelve en la respuesta
HTTP, pero **no se persiste**. Si el operador cierra la pestaña, se perdió, y la
venta queda indistinguible de una venta interna hecha a propósito: las dos son
`status = 'active'` con `afip_cae = NULL`.

Esas dos columnas son la única diferencia entre el estado **B (Registrada)** y el
estado **C (Rechazada)** de la spec. Sin ellas, el cuarto requisito de la
funcionalidad —«la venta Rechazada sigue apareciendo Rechazada después de
recargar»— no se puede cumplir.

### Por qué `TEXT` y no `VARCHAR(255)`

El mensaje que se guarda es el que arma `afipService`, y ya trae un
`JSON.stringify` adentro:

```js
// afipService.js:286
reject(new Error('Error de AFIP: ' + JSON.stringify(res.Errors.Err)));
// afipService.js:291
reject(new Error('Factura rechazada u observada por AFIP: ' + JSON.stringify(...)));
```

Un rechazo con dos observaciones pasa los 255 caracteres con facilidad, y lo que
queda cortado es el final, que es donde está el código. FR-048 exige mostrar el
mensaje de AFIP **tal cual**; truncarlo es incumplirlo con un `varchar`.

### Qué se escribe y cuándo

| Momento | `afip_ultimo_error` | `afip_ultimo_intento` |
|---|---|---|
| Intento fallido | el mensaje de AFIP | ahora |
| Intento exitoso | `NULL` | ahora |
| Cualquier otra operación (alta, anulación) | sin tocar | sin tocar |

Un intento fallido posterior **pisa** al anterior (FR-022): no hay historial, hay
último intento. Limpiarlo al facturar bien no es imprescindible para el badge
—`afip_cae` tiene precedencia sobre el error al derivar el estado— pero deja de
mostrar en el panel un rechazo de una venta que después salió.

La escritura del error va en un `UPDATE` propio, fuera de la transacción del
reintento (que se revierte), y condicionado:

```sql
UPDATE sales SET afip_ultimo_error = ?, afip_ultimo_intento = ?
WHERE id = ? AND empresa_id = ? AND afip_cae IS NULL
```

`empresa_id` porque toda escritura por id lo lleva; `afip_cae IS NULL` para que
una escritura tardía no le ponga un mensaje de rechazo a una venta que, entre
medio, se facturó bien.

### Qué pasa con las ventas que ya existen

Las dos columnas quedan en `NULL`. Por la tabla de los cinco estados, eso
significa que **toda venta activa sin CAE anterior a esta migración se muestra
como «Registrada»**, nunca como «Rechazada». Es el supuesto 12 de la spec y es
correcto: no hay forma de saber cuáles de esas ventas fallaron. Reconstruirlo
exigiría adivinar, y adivinar sobre una obligación fiscal es peor que no saber.

---

## `sales` — índice nuevo

| Índice | Campos | Para qué |
|---|---|---|
| `sales_empresa_date_idx` | `(empresa_id, date)` | El filtro por rango del listado y del export. |

Hoy hay índices sueltos sobre `date` y sobre `empresa_id` (`Sale.js:115-122`).
Ninguno de los dos sirve bien para la consulta que estrena esta funcionalidad,
que siempre es `empresa_id = X AND date BETWEEN a AND b`: con índices separados
Postgres elige uno y filtra el resto fila por fila. El compuesto ataca las dos
condiciones a la vez.

**Por qué no se le agrega `time` ni `id`.** El orden es
`date DESC, time DESC, id DESC` y un índice que lo cubriera entero tendría que
incluir los tres. `id` es `VARCHAR(40)`, así que el índice pasaría a pesar más
que el ahorro: con el rango ya acotado por `(empresa_id, date)`, ordenar unos
pocos miles de filas es trabajo despreciable. Si el criterio de éxito 12 no se
cumple, se mide antes de ensanchar el índice.

**Por qué no hay índice para `afip_ultimo_error`.** Ningún filtro de la pantalla
consulta por estado: los filtros son fecha, sucursal y tipo. El estado se deriva
al armar la respuesta, no se busca.

---

## La migración

`apps/api/src/migrations/20260803-intentos-de-facturacion.js`

Aditiva, con la forma de `20260731-ventas-a-cuenta-corriente.js` (columna +
índice, con su `down`):

```js
async up(queryInterface, Sequelize) {
  await queryInterface.addColumn('sales', 'afip_ultimo_error', {
    type: Sequelize.TEXT,
    allowNull: true,
  });

  await queryInterface.addColumn('sales', 'afip_ultimo_intento', {
    type: Sequelize.DATE,
    allowNull: true,
  });

  await queryInterface.addIndex('sales', ['empresa_id', 'date'], {
    name: 'sales_empresa_date_idx',
  });
}

async down(queryInterface) {
  await queryInterface.removeIndex('sales', 'sales_empresa_date_idx');
  await queryInterface.removeColumn('sales', 'afip_ultimo_intento');
  await queryInterface.removeColumn('sales', 'afip_ultimo_error');
}
```

No lleva `addConstraint`, así que la trampa de `{ model, key }` no aplica acá.
Si en el futuro se agrega una, va con `{ table, field }`.

Corre por `npm --prefix apps/api run db:migrate`, que usa `scripts/migrar.js`
con el advisory lock. Como es aditiva y sobre columnas nulas, es segura mientras
la versión anterior de la aplicación sigue corriendo.

---

## El modelo

`apps/api/src/models/Sale.js` suma las dos columnas y el índice compuesto:

```js
afip_ultimo_error: { type: DataTypes.TEXT, allowNull: true },
afip_ultimo_intento: { type: DataTypes.DATE, allowNull: true },
```

```js
indexes: [
  // … los existentes se dejan
  { name: 'sales_empresa_date_idx', fields: ['empresa_id', 'date'] },
]
```

Los índices sueltos de `date` y `empresa_id` se dejan: sacarlos es una migración
destructiva sobre una tabla caliente, y no molestan.

---

## Los cinco estados

No es una columna: es una función de tres campos. Vive en
`apps/api/src/utils/estadoVenta.js` y se calcula al armar cada respuesta.

| # | `status` | `afip_cae` | `afip_ultimo_error` | `codigo` | Etiqueta |
|---|---|---|---|---|---|
| A | `active` | presente | — | `autorizada` | Autorizada |
| B | `active` | `NULL` | `NULL` | `registrada` | Registrada |
| C | `active` | `NULL` | presente | `rechazada` | Rechazada |
| D | `voided` | `NULL` | — | `anulada` | Anulada |
| E | `voided` | presente | — | `anulada_con_cae` | Anulada · vigente ante ARCA |

**El orden de las comparaciones importa y no es intercambiable:**

1. `status === 'voided'` primero. Una venta anulada es D o E, sin mirar el error.
2. Dentro de cada rama, `afip_cae` **antes** que `afip_ultimo_error`. Una venta
   con CAE es A aunque tenga guardado un rechazo de un intento anterior. Al
   revés, la venta que falló y después se facturó bien seguiría mostrándose
   Rechazada para siempre.

El estado **E** es dato histórico: `taxService.js:96-105` ya lo cuenta como
`anuladas_con_cae_sin_nc` porque es un desvío conocido —el comprobante sigue
declarado ante ARCA hasta que exista una nota de crédito—. Con FR-055 deja de
poder crearse, pero el que hay se sigue mostrando con etiqueta y color propios.

El frontend recibe `codigo` y lo mapea a tokens en
`apps/web/src/utils/estadoVenta.js`:

| `codigo` | Texto | Fondo | Línea |
|---|---|---|---|
| `autorizada` | `text-ok` | `bg-ok-soft` | `border-ok-line` |
| `registrada` | `text-fg-2` | `bg-surface-3` | `border-border` |
| `rechazada` | `text-danger` | `bg-danger-soft` | `border-danger-line` |
| `anulada` | `text-fg-3` | `bg-surface-3` | `border-border` |
| `anulada_con_cae` | `text-warn` | `bg-warn-soft` | `border-warn-line` |

Las filas D y E van además al 55 % de opacidad (FR-010).

---

## Lo que NO cambia

Se deja escrito para que no se discuta después.

| Cosa | Por qué se deja como está |
|---|---|
| `Sale.location` | Queda como texto histórico. El filtro pasa a `punto_de_venta_id` (FR-071), pero borrar la columna haría desaparecer el dato de las ventas anteriores a multi-sucursal. |
| `Sale.status` | Sigue con `'active'` y `'voided'`. Los cinco estados son de presentación, no de base. |
| `Sale.customer_name` | Ya existe como `VARCHAR(255)`. FR-100 cambia **cuándo se escribe**, no la columna. Se recorta a 255 y se hace `trim` antes de guardar: hoy solo llega desde una ficha de cliente, y con el cambio va a llegar tipeado a mano. |
| `Sale.notes` | Sin migración. Las ventas viejas conservan el `"… - Cliente: X"` que les metió el POS. FR-105: no se parsea, no se migra. |
| `puntos_de_venta` | **No** se le agrega `afip_pv`, pese a FR-044. Ver el apartado correspondiente en `plan.md`: sería una columna que ninguna pantalla puede completar. |
| `SaleItem` | Sin cambios. El panel muestra `product_name`, que ya sobrevive al borrado del producto. |
| `Customer` | Sin cambios. `name`, `tax_id` y `tax_condition` alcanzan para el receptor del reintento. |

---

## Aislamiento

Todas las consultas nuevas llevan `empresa_id`:

| Consulta | Cómo |
|---|---|
| `GET /api/sales` | `scoped(where, req.empresaId)` en la ruta, no en `filtroVentas.js`. |
| `GET /api/sales/:id` | `findScoped(Sale, req.params.id, req.empresaId, …)`. |
| `GET /api/sales/export` | `scoped(where, req.empresaId)`, igual que el listado. |
| `POST /:id/facturar` | `findScoped` con `transaction` y `lock`. |
| El `UPDATE` del error de AFIP | `WHERE id = ? AND empresa_id = ? AND afip_cae IS NULL`. |
| `PUT /:id/void` | Ya usa `findScoped`. Sin cambios en el scoping. |

Un `punto_de_venta_id` de otra empresa en la query **no filtra hacia afuera**:
el `where` lleva `empresa_id` y `punto_de_venta_id` juntos, así que devuelve cero
filas. Ninguna consulta nueva usa `findByPk`, así que las guardias de
`aislamientoEmpresas.test.js` siguen limpias sin sumar excepciones.
