# Contratos de API: Punto de venta — pasada fina

Complementa a [plan.md](../plan.md). Todas las rutas de acá cuelgan de routers
montados con `authEmpresa` en `server.js`, o sea que ya pasaron por `checkJwt`,
`extractUser`, `loadEmpresaContext`, `requireEmpresa` y `checkSubscription`.
**`req.empresaId` está garantizado**, y `req.puntoDeVentaId` viene de la cabecera
`X-Punto-De-Venta-Id` cuando el navegador la manda.

| Ruta | Estado | Permiso |
|---|---|---|
| `POST /api/sales` | **modificada** | `ventas.crear` |
| `POST /api/sales/:id/facturar` | **sin cambios** | `ventas.crear` |
| `GET /api/sales/summary` | sin cambios de contrato | `ventas.ver` |
| `POST /api/afip/invoice` | sin cambios | (la que ya tiene) |

**No se crea ningún endpoint y no se crea ningún permiso** (supuesto 6). El único
contrato que cambia es el de `POST /api/sales`, y los tres cambios son
**aditivos**: el cliente viejo sigue funcionando.

---

## `POST /api/sales` — modificada

Registra la venta, descuenta stock y avisa lo que no pudo descontar. Sigue
siendo el único endpoint que crea ventas y el único que llama esta pantalla.

### Lo que **no** cambia

- El total lo recalcula el servidor a partir de las líneas y rechaza con
  `TOTAL_INCONSISTENTE` si el declarado no cierra (`sales.js:354-367`, FR-081).
- La fecha y la hora las decide el servidor en la zona horaria de la empresa
  (`:369-385`, supuesto 3). El navegador no manda ninguna de las dos.
- `is_credit` sigue atado a `customer_id`: un nombre libre no genera deuda.
- `ITEM_INVALIDO` con cantidad ≤ 0 o precio negativo.
- El descuento de stock con `lock: t.LOCK.UPDATE` y el `StockMovement` por línea.
- `payment_method` se sigue deduciendo de las líneas cuando todas coinciden
  (`metodoDePago`, `calculosVenta.js:105`) y cae al declarado cuando difieren.

### Cambio 1 — idempotente por `id`

**Antes:** `Sale.create` con un `id` que ya existe tira
`SequelizeUniqueConstraintError`, cae en el `catch` genérico y sale por `fallo()`
como **500 «Error al registrar la venta»** (`sales.js:512-520`).

**Ahora:** antes de crear, se busca la venta con
`findScoped(Sale, id, req.empresaId, { transaction: t, include: [SaleItem] })`.
Si existe, se revierte la transacción y se responde **200**:

```json
{
  "ok": true,
  "yaRegistrada": true,
  "data": {
    "id": "sale_1754320000000_9f3a1c02",
    "total": "47300.00",
    "afip_cae": null,
    "items": [
      { "product_id": 10, "product_name": "Colágeno 300g", "quantity": 1, "unit_price": "1500.00" }
    ],
    "…": "…"
  },
  "warnings": [],
  "stock": []
}
```

**`items` va SOLO en esta rama, y es lo que hace verificable el «ya
registrada».** Sin las líneas, la afirmación no la puede comprobar nadie: un
reintento del mismo ticket **modificado** —se cortó la red después del commit, el
operador leyó «Error», el cliente pidió una unidad más y se volvió a cobrar—
recibe la venta vieja con el mismo `id`, y el navegador no tiene con qué darse
cuenta. Se entregan dos unidades, se registró y se descontó una, y el comprobante
impreso sale con dos líneas y el total de una. El cliente compara lo que mandó
contra lo que volvió (`utils/reintentoDeVenta.js`) y solo trata como éxito
silencioso el reintento que de verdad coincide.

El `include` es seguro **porque este `findScoped` no lleva `lock`**: lo que
PostgreSQL rechaza es el `LEFT OUTER JOIN … FOR UPDATE`, y por eso
`POST /:id/facturar` sigue sin poder traerlas.

Y **además** el `catch` distingue `SequelizeUniqueConstraintError` sobre la clave
primaria y responde lo mismo. El `findScoped` previo no es atómico: dos requests
en vuelo a la vez pasan los dos, y el que pierde choca contra la restricción. La
guardia real es la base; el `findOne` es el camino normal.

`stock: []` y `warnings: []` van vacíos a propósito: **no se vuelve a descontar
nada**. La venta ya existe, su stock ya se descontó cuando se creó, y devolver los
avisos de aquella vez haría que la pantalla los mostrara dos veces.

**Aislamiento.** El `findScoped` lleva `req.empresaId`, así que la idempotencia es
**por empresa** y desde acá no se puede leer ninguna venta ajena. Ninguna guardia
de `aislamientoEmpresas.test.js` cambia.

> ⚠ **Corrección**: este documento decía que un `id` que existe en otra empresa
> «no se encuentra y la venta se crea normalmente». **No se crea.** `Sale.id` es
> la clave primaria **global**: el `findScoped` no lo encuentra, el `create`
> choca contra la PK, el `catch` relee con `findScoped` —que sigue sin
> encontrarlo— y la respuesta es **500, y el reintento también 500** (verificado
> contra Postgres). La probabilidad es despreciable —exige el mismo milisegundo
> **y** los mismos 8 hexadecimales de `nuevoIdDeVenta()`— y **no se maneja**: ver
> el motivo y el costo en T1102 de `tasks.md`.

**Por qué acá y no una cabecera `Idempotency-Key`:** el `id` de la venta ya es una
clave de idempotencia —lo genera el cliente, es la clave primaria, y ya tiene una
restricción única que hoy produce un 500—. La decisión 3 del plan tiene las
alternativas descartadas.

> ⚠ **Depende de que el `id` tenga entropía.** Con `sale_${Date.now()}` a secas,
> dos cajas que cobran en el mismo milisegundo producen el mismo id y la segunda
> recibiría los datos de la venta de la primera **sin registrar la suya**. El
> cliente pasa a generar `sale_${Date.now()}_${8 hex}` en el mismo cambio. Es el
> riesgo 1 del plan.

### Cambio 2 — la respuesta dice qué stock quedó

**Nuevo campo `stock`**, con una fila por cada `Stock` que el handler
efectivamente actualizó, leída **después** del `update` y dentro de la misma
transacción:

```json
{
  "ok": true,
  "data": { "id": "sale_1754320000000_9f3a1c02", "…": "…" },
  "warnings": [
    "No hay stock cargado para \"Creatina 300g\" en este punto de venta: no se descontó inventario."
  ],
  "stock": [
    { "product_id": 41, "punto_de_venta_id": 3, "quantity": 8, "available": 8 },
    { "product_id": 77, "punto_de_venta_id": 3, "quantity": 0, "available": 0 }
  ]
}
```

- Los productos que **no** tenían fila de stock no aparecen en `stock` y **sí**
  aparecen en `warnings`. Los dos arreglos son complementarios y ninguno hay que
  parsear.
- `punto_de_venta_id` va en cada fila aunque sea siempre el mismo: es lo que le
  permite a la pantalla reemplazar **esa** fila de `producto.stock[]` y no la de
  otra sucursal.

Es lo que hace posible FR-047 sin volver a pedir el catálogo. Sin este campo, el
navegador tendría que restar `available - qty` por su cuenta —el cliente
recalculando inventario— y equivocarse en el único caso que importa: el producto
sin fila de stock, donde **no** se descontó nada.

**Aditivo:** un cliente que ignore `stock` funciona igual.

### Cambio 3 — la sucursal se resuelve antes de crear la venta

**Antes:** `punto_de_venta_id: req.puntoDeVentaId || null` (`sales.js:396`),
mientras que el stock salía de `resolverSucursal(...)` (`:442-446`), **adentro** del
`if (lineas.length)`. Sin la cabecera, las dos respuestas diferían: el stock salía
de una sucursal concreta y la venta quedaba diciendo que no fue de ninguna.

**Ahora:** la llamada a `resolverSucursal` sube antes del `Sale.create` y
`saleData.punto_de_venta_id = sucursal.id`. El bucle de stock usa la misma
variable, así que **por construcción** la venta queda asentada en la sucursal de
la que salió la mercadería (FR-070, FR-071).

Efecto sobre las respuestas de error:

| Caso | Antes | Ahora |
|---|---|---|
| Empresa sin ninguna sucursal, venta **con** líneas | `400` con el `ErrorDeNegocio` de `sucursalPorDefecto` | igual |
| Empresa sin ninguna sucursal, venta **sin** líneas | `201`, con `punto_de_venta_id: null` | `400` con el mismo `ErrorDeNegocio` (FR-072) |
| Cabecera con un `punto_de_venta_id` de **otra** empresa | se guardaba tal cual en la venta | `resolverSucursal` lo valida con `findScoped` y **no** resuelve: cae al por defecto de la empresa |

La segunda fila es un cambio de comportamiento y es el buscado: una venta sin
líneas también tiene que quedar atribuida. La tercera cierra una fuga que hoy
escribe un id ajeno en la columna.

`Sale.location` **no cambia**: sigue siendo el texto histórico que manda el
cliente y **no** se usa para decidir de dónde sale el stock de una venta nueva
(FR-074). Los tres escalones de `sucursalDeAnulacion` (`sales.js:27-47`) quedan
intactos para las ventas viejas (FR-073).

### Cuerpo del request

Lo que manda el POS, con lo único que cambia marcado:

| Campo | Tipo | Antes | Ahora |
|---|---|---|---|
| `id` | string ≤ 40 | `sale_${Date.now()}` | **`sale_${Date.now()}_${8 hex}`**, generado **una vez por ticket** y reusado en cualquier reintento (FR-043) |
| `payment_method` | string ≤ 20 | `cart[0]?.method` | **el medio de pago del ticket** (decisión 3 de la spec): es la respuesta correcta a «con qué se pagó» cuando las líneas difieren |
| `items[].payment_method` | string ≤ 20 | `'ef'`, `'tc3'`, `'al'` | **uno de los nueve**: `ef`, `tr`, `qr`, `td`, `tc1`, `tc3v`, `tc3m`, `tc3n`, `al` |
| `items[]` | array | igual | igual (`quantity`/`qty`, `unit_price`/`price`, `product_id`/`id`) |
| `total` | number | igual | igual — se declara y el servidor lo verifica, no lo acepta |
| `location`, `notes`, `customer_id`, `customer_name` | — | igual | igual |

`payment_method` es `STRING(20)` en el modelo (`models/Sale.js:38`) y en la base
(`migrations/20260531-initial-schema.js:344`), **sin `ENUM` y sin `CHECK`**. Los
nueve códigos entran sin tocar la base: **no hay migración**.

### Códigos de respuesta

| Código | Cuándo | Cuerpo |
|---|---|---|
| `201` | Venta creada | `{ ok: true, data, warnings, stock }` |
| `200` | **`id` ya registrado en esta empresa** | `{ ok: true, yaRegistrada: true, data (con `items`), warnings: [], stock: [] }` |
| `400 ITEM_INVALIDO` | Cantidad ≤ 0 o precio negativo | igual que hoy |
| `400 TOTAL_INCONSISTENTE` | El total declarado no cierra contra las líneas | igual que hoy |
| `400` | `Stock insuficiente para "…"` | igual que hoy — texto plano en `error` |
| `400` | Empresa sin sucursales (`ErrorDeNegocio`) | **también sin líneas**, ver arriba |
| `500` | Cualquier otra cosa | `fallo()`: mensaje en castellano + `requestId` |

---

## `POST /api/sales/:id/facturar` — sin cambios

Se consume tal cual (supuesto 4). El POS le sigue mandando `type`,
`customerCuit`, `customerVatCondition` y `pv`, que siguen siendo opcionales
porque el servidor los resuelve solo (`resolverComprobante`, `sales.js:662`).

Dos cosas del contrato actual que esta funcionalidad **usa** y que conviene tener
a la vista, porque de ellas dependen tres criterios de aceptación:

- **Es idempotente.** Una venta que ya tiene CAE devuelve
  `{ ok: true, yaFacturada: true, data: { cae, expiration, voucherNumber, type } }`
  sin volver a pedirle nada a ARCA (`:854-870`). Es lo que hace seguro el
  reintento del escenario 4.15.
- **`400 CUIT_REQUERIDO`** cuando el comprobante es tipo 1/2/3 y el CUIT no tiene
  11 dígitos (`:887-893`). La pantalla lo distingue por el código —no por el
  texto— y reintenta **solo la facturación** con el CUIT corregido, sin volver a
  registrar la venta (FR-054).
- **`502`** con el mensaje de AFIP **tal cual** en `error` y la explicación en
  `message` (`:932-936`). La venta ya quedó registrada. Es lo que FR-051 muestra
  sin que desaparezca solo.

---

## `GET /api/sales/summary` — sin cambios de contrato, distinto contenido

No se toca una línea. Se documenta acá porque **lo que devuelve cambia** a partir
de este hito: agrupa por `(date, payment_method)` (`sales.js:203`), y el POS pasa
de producir tres valores a producir hasta nueve. El «Efectivo» del día deja de
incluir transferencias, QR y débito.

Es el defecto 3 de la spec resuelto, y es un número que el dueño mira todos los
días. Riesgo 3 del plan. Lo mismo aplica a `dashboardService._salesByMethod`
(`:99-114`), que además hoy le entrega al frontend claves crudas que
`Dashboard.jsx:209` imprime tal cual — por eso ese archivo pasa a usar el mapa de
etiquetas compartido.

**El histórico no se migra.** Incluido `tc3`, el código que el POS actual escribe
y que no está en la lista de nueve: nada en la fila dice si esa tarjeta fue Visa,
Master o Naranja. Se le agrega una etiqueta (`'T. Crédito 3c'`) para que deje de
mostrarse crudo, y sigue significando lo que significaba.
