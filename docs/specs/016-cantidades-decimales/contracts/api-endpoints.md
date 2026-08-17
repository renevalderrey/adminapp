# Contrato de API: Cantidades decimales

**Spec**: [`../spec.md`](../spec.md) · **Plan**: [`../plan.md`](../plan.md) · **Modelo**: [`../data-model.md`](../data-model.md)

---

## Qué cambia, en una línea

**No se agrega ningún endpoint, no se saca ninguno y no cambia ninguna URL, ningún
método, ningún permiso ni ninguna forma de respuesta.** Lo que cambia es el **tipo
JSON** de nueve campos —de `number` a `string`— y **un motivo de rechazo nuevo** en
`POST /api/sales`.

Este documento existe por eso: un cambio de tipo en una respuesta no se ve en
ninguna firma y rompe a cualquier consumidor que compare con `===`.

---

## 1 · Los campos que pasan de `number` a `string`

Es un hecho del driver, no una decisión de diseño: `pg` devuelve `NUMERIC` como
texto y con la escala puesta, y este repositorio **no registra ningún
`setTypeParser`** (FR-027, y el motivo está en
`tests/integracion/centavoDelSaldo.integracion.test.js:243`).

**Ocurre el día de la migración, con la base tal como está y sin que exista un solo
decimal**: un stock de 12 viaja como `"12.0000"`.

### `GET /api/products` · `products.ver`

```diff
  "stock": [
    {
      "id": 41, "punto_de_venta_id": 3, "location": "centro",
-     "quantity": 12, "available": 12, "min_stock": 0
+     "quantity": "12.0000", "available": "12.0000", "min_stock": "0.0000"
    }
  ]
```

Es la fuente del catálogo del punto de venta, de Inventario y de la ficha de
producto. Consumidores en el repositorio: `CatalogoDelPos.jsx:200`,
`Billing.jsx:468`, `PanelProducto.jsx:310` y `:1173`, `utils/inventario.js`
—que ya envuelve todo en `Number(…) || 0`— y `utils/stockBajo.js`, ídem.

### `GET /api/stock` · `stock.ver` — `routes/general.js:27`

Mismos tres campos, en la fila de stock de primer nivel.

### `PUT /api/stock/:id` y `POST /api/stock` · `stock.editar`

Devuelven la fila actualizada: mismos tres campos.

⚠ El **cuerpo del request no cambia**: se siguen aceptando `quantity`, `available` y
`min_stock` como número o como string, igual que hoy. Lo que cambia es que ahora un
`0.4` **se guarda como 0,4** en vez de redondearse a 0 al insertar.

### `POST /api/stock/bulk` · `stock.editar`

Ídem, en cada fila del resultado.

### `GET /api/sales/:id` · `ventas.ver`

```diff
  "items": [
-   { "product_name": "Creatina", "quantity": 3, "unit_price": "1200.00" }
+   { "product_name": "Creatina", "quantity": "3.0000", "unit_price": "1200.00" }
  ]
```

`unit_price` ya viajaba como string —es `DECIMAL(12,2)`— y **no se toca**. Es el
campo que alimenta el ticket impreso (`InvoicesList.jsx:651` → `printInvoice.js:125`)
y por lo tanto el criterio de éxito 1 de la spec.

⚠ El **listado** `GET /api/sales` no incluye las líneas (`routes/sales.js:112-160`, sin
`include` de `SaleItem`) y `GET /api/sales/export` tampoco toca cantidades
(`utils/exportVentas.js`): los dos quedan idénticos.

### `POST /api/sales` · `ventas.crear` — el arreglo `stock` de la respuesta

```diff
  "stock": [
-   { "product_id": 7, "punto_de_venta_id": 3, "quantity": 97, "available": 97 }
+   { "product_id": 7, "punto_de_venta_id": 3, "quantity": "97.0000", "available": "97.0000" }
  ]
```

Son las filas leídas dentro de la transacción de la venta (FR-047 de la 014). El POS
las escribe tal cual en el catálogo del navegador
(`Billing.jsx:434-450`, `aplicarStockDelServidor`), así que el string llega a la
baldosa del catálogo por este camino además de por `GET /api/products`.

### `GET /api/reports/inventory` · `reportes.ver` + `requireSuperadmin`

```diff
- { "product_name": "Creatina", "quantity": 12, "cost": 800, "total_value": 9600 }
+ { "product_name": "Creatina", "quantity": "12.0000", "cost": 800, "total_value": 9600 }
```

`routes/reports.js:95` devuelve `s.quantity` crudo. `total_value` **no** cambia: se
calcula con una multiplicación, que coerciona.

### `GET /api/pedidos` y `GET /api/pedidos/:id` · `pedidos.ver` + módulo `catalogo`

```diff
  "lineas": [
-   { "nombre": "Creatina", "cantidad": 2, "subtotal": "2400.00" }
+   { "nombre": "Creatina", "cantidad": "2.0000", "subtotal": "2400.00" }
  ]
```

⚠ **Nada escribe decimales ahí.** `apps/tienda/src/carrito.js:55` hace
`Math.floor(Number(cantidad))` y la tienda pública sigue vendiendo por unidad
(H5, FR-043). La columna migra porque es parte de la misma cadena.

### `GET /api/dashboard/kpis` · `dashboard.ver`

`alerts.low_stock[].quantity` y `.min_stock` (`services/dashboardService.js:962-963`)
pasan a string. **Hoy ninguna pantalla los dibuja** —el Panel usa el conteo, no las
filas—, y se listan igual: un campo que nadie mira es exactamente el que rompe
callado el día que alguien lo mira.

---

## 2 · Los campos que **NO** cambian, y por qué

Se nombran para que nadie «los arregle» y escriba un test que pasa con y sin el
cambio.

| Endpoint · campo | Por qué sigue siendo `number` |
|---|---|
| `GET /api/reports/sales` · `quantity` | `routes/reports.js:39` ya hace `parseFloat(i.quantity)` antes de responder |
| `GET /api/faltantes` · `stock`, `min_stock` | `routes/general.js:703-704` ya hacen `Number(…) \|\| 0` |
| `GET /api/stock/transfers` · `items[].quantity` | `stock_transfers.items` es `JSONB` (`models/StockTransfer.js:33-34`): una foto escrita desde el cuerpo del request, no una columna `DECIMAL` |
| `POST /api/stock/transfer` · `data.items[].quantity` | Ídem: lo escribe `routes/stock.js:133` con `parseFloat(item.quantity)` |
| Todos los importes: `total`, `unit_price`, `cost`, `subtotal`, `precio_unitario`, `precio_lista` | Ya eran `DECIMAL(12,2)` y ya viajaban como string. **No se tocan** (FR-008) |
| `GET /api/production/*` · `quantity_produced`, `quantity_used` | Ya eran `DECIMAL(12,4)` y ya viajaban como string |

---

## 3 · `POST /api/sales` · el rechazo

### Lo que ya pasaba y sigue pasando

`400` con la misma forma de siempre. **La forma no cambia**: el test del defecto
viejo —la cantidad negativa que sumaba inventario, documentada en
`routes/sales.js:318-320`— tiene que seguir pasando **sin modificarse** (US3.3).

```json
{
  "ok": false,
  "error": "ITEM_INVALIDO",
  "message": "El item \"Creatina\" tiene cantidad o precio inválidos (cantidad -5, precio 1200)."
}
```

| Cantidad enviada | Hoy | Después de la 016 |
|---|---|---|
| `0` | 400 `ITEM_INVALIDO` | igual |
| `-5` | 400 `ITEM_INVALIDO` | igual |
| `'tres'` | 400 (`normalizarItem` la lleva a 0) | igual |
| `3` | 201 | igual: mismo total, mismo descuento, mismo movimiento |

### Lo que cambia

| Cantidad enviada | Hoy | Después de la 016 |
|---|---|---|
| `0.4` | **201**, y guarda una línea en **0** | **400**, y **no queda ninguna fila**: ni la venta, ni sus líneas, ni el movimiento de stock |
| `0.00004` | **201**, y guarda **0** | **400** |
| `999999999999999` | 500 de Postgres | **400**, con un mensaje legible |

**Por qué se rechaza todo lo no entero y no solo lo no representable** (PENDIENTE 2,
resuelto): la 016 no habilita ninguna capacidad visible. Si el endpoint aceptara
`0,25`, alguien con `curl` podría crear un estado que ninguna pantalla produce, y
«nada cambió» dejaría de ser literalmente cierto. **La capacidad queda en el esquema
y la puerta sigue cerrada**; la 017 la abre junto con la pantalla que la necesita.

El límite que la 017 va a aplicar ya está decidido —**3 decimales**, un gramo
(PENDIENTE 1)— y vive en `utils/cantidades.js:DECIMALES_DE_UNA_LINEA_DE_VENTA`, hoy
en `0`. **Abrir la puerta en la 017 es cambiar ese número**, y su test ya cubre los
dos valores.

⚠ El mensaje **nombra el producto y la cantidad, y nunca la tabla, la columna ni la
restricción** (FR-021, `CONVENCIONES.md` «Errores»). Todo lo que no sea un
`ErrorDeNegocio` sigue saliendo por `fallo(req, res, err, …)`.

### Y el otro mensaje que cambia de texto

`routes/sales.js:548` y `routes/stock.js:142` escriben la cantidad con
`textoDeCantidad(...)` en vez de interpolarla cruda:

```diff
- Stock insuficiente para "Creatina": disponible 5.0000, requerido 3
+ Stock insuficiente para "Creatina": disponible 5, requerido 3

- Stock insuficiente en "Centro" para "Creatina" (disponible: 0.0000, requerido: 2)
+ Stock insuficiente en "Centro" para "Creatina" (disponible: 0, requerido: 2)
```

El segundo **no se arregla formateando el resultado**: la expresión de hoy es
`sourceStock?.quantity || 0`, y con la cadena `"0.0000"` —que es *truthy*— el `||`
deja de caer al cero. Lo que se saca es la dependencia de que el valor sea *falsy*, y
justo en el caso de stock cero, que es el único en el que ese mensaje se lee.

`routes/sales.js:595` sigue reconociendo el error por
`err.message.startsWith('Stock insuficiente')`, y
`tests/rutasDeStock.test.js:293` sigue exigiendo
``ErrorDeNegocio(`Stock insuficiente`` en el fuente de la transferencia: las dos
formas se conservan.

---

## 4 · Aislamiento

**Ninguna de las correcciones introduce una lectura nueva.** Los cuatro sitios de
aritmética operan sobre una fila que la ruta ya tenía en la mano, resuelta con
`empresa_id` en el `where` y —en los tres transaccionales— con `lock: t.LOCK.UPDATE`.
`routes/general.js` sigue entrando por `findScoped(Stock, req.params.id, req.empresaId)`.

FR-050 y FR-051 se verifican donde corresponde: `aislamientoEmpresas.test.js` y
`observabilidad.test.js` sin hallazgos nuevos, y
`integracion/aislamientoEntreEmpresas.integracion.test.js` ejecutado.

---

## 5 · Cómo debería leer esto un consumidor nuevo

La regla del repositorio, ya escrita para la plata en
`centavoDelSaldo.integracion.test.js`, ahora vale también para las cantidades:

> **Lo que hay en la base viaja tal cual, y cada consumidor convierte.**

- Para **contar o comparar**: `Number(x)`. Nunca `===` contra un número, nunca
  `parseInt` —trunca—, nunca confiar en que `if (x)` sea falso cuando `x` es cero.
- Para **sumar del lado del servidor**: `sumarCantidades` de `src/utils/cantidades.js`.
  Hay una guardia estática que falla si vuelve a aparecer un `+` desnudo sobre
  `.quantity`, `.available`, `.min_stock` o `.cantidad`.
- Para **dibujar en la web**: `cantidad()` de `apps/web/src/utils/formato.js`. Hay una
  guardia en `utils/formato.test.js` que falla si una pantalla lo hace por su cuenta.
- Para **escribir dentro de un `<input type="number">`**: `Number(...)` y **no** el
  formateador — un `value="9,6"` deja el campo en blanco.
