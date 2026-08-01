# Contratos de API: Inventario — pasada fina

Complementa a [plan.md](../plan.md). Todas las rutas de acá cuelgan de routers
montados con `authEmpresa` en `server.js`, o sea que ya pasaron por `checkJwt`,
`extractUser`, `loadEmpresaContext`, `requireEmpresa` y `checkSubscription`.
**`req.empresaId` está garantizado en todas**, y `req.usuario` también
(`middleware/auth.js:89`).

| Ruta | Estado | Permiso |
|---|---|---|
| `GET /api/stock/sucursales` | **nueva** | `stock.ver` |
| `POST /api/stock` | modificada | `stock.editar` |
| `PUT /api/stock/:id` | modificada | `stock.editar` |
| `POST /api/stock/bulk` | modificada | `stock.editar` |
| `POST /api/stock/transfer` | modificada | `stock.transferir` |
| `GET /api/stock/transfers` | modificada | `stock.ver` |
| `GET /api/products/:id/cost-history` | modificada | `products.ver` |
| `PUT /api/products/:id` | modificada | `products.editar` |
| `POST /api/products/bulk` | modificada | `products.crear` |
| `POST /api/import/products` | modificada | `products.crear` |
| `GET /api/settings` | modificada | (la que ya tiene) |
| `GET /api/products` | **sin cambios de contrato** | `products.ver` |
| `GET /api/stock` | sin cambios | `stock.ver` |

> **Orden de declaración en `stock.js`.** `/sucursales`, `/transfer` y
> `/transfers` son rutas literales y no hay ninguna `/:id` en ese router, así que
> no hay riesgo de que se coman entre sí. En `products.js` sí lo hay y ya está
> resuelto: `/:id/cost-history` está declarada después de `/bulk`.

**No se crea ningún permiso** (supuesto 3). El que decide qué se puede hacer es el
que ya existe.

---

## `GET /api/stock/sucursales` — nueva

Las sucursales de la empresa, **incluidas las inactivas**. Es lo que define
cuántas columnas de stock tiene la tabla (FR-060, FR-063) y qué ofrecen los
selectores de la transferencia (FR-115).

Existe porque los dos endpoints que hoy listan puntos de venta filtran por
`is_active` —`GET /api/empresas/mi-contexto` (`empresas.js:195`) y
`GET /api/empresas/:id/puntos-de-venta` (`empresas.js:561`)— y el segundo además
pide `sucursales.ver`, que esta pantalla no exige. Ver la decisión 12 del plan.

### Respuesta

```json
{
  "ok": true,
  "data": [
    { "id": 3, "name": "Sucursal Principal", "code": "principal", "is_active": true },
    { "id": 7, "name": "Depósito",           "code": "deposito",  "is_active": false }
  ]
}
```

Orden: activas primero, después por `name`. Una sucursal inactiva **se devuelve
igual**: cerrar un local no evapora su mercadería, y ese stock es justamente el
que hay que transferir a otro lado (FR-066).

---

## `POST /api/stock` — modificada

Crea o actualiza la fila de stock de un producto en una sucursal.

### Cuerpo

| Campo | Tipo | Antes | Ahora |
|---|---|---|---|
| `product_id` | int | requerido | igual |
| `punto_de_venta_id` | int | opcional; si venía se validaba contra la empresa | **es lo que decide la sucursal** |
| `location` | string | **decidía la sucursal si no venía el id** | **se ignora** (FR-041) |
| `quantity` | int | sin validar | **rechaza negativos** (FR-036) |
| `available` | int | sin validar | **rechaza negativos**; si no viene, sigue a `quantity` |
| `min_stock` | int | opcional | igual |

**Resolución de la sucursal**, por `utils/sucursalDeStock.js` y en este orden:
`punto_de_venta_id` del cuerpo → `req.puntoDeVentaId` (la cabecera) → el punto de
venta por defecto de la empresa. **Nunca queda en `null`** (FR-052): después de la
migración la columna es `NOT NULL` y la fila no se podría insertar.

`location` lo escribe el servidor con el `code` del punto de venta resuelto —o su
`name`, recortado a 30, si el `code` es nulo—.

### Errores

| Código | Cuándo | Cuerpo |
|---|---|---|
| `400` | falta `product_id` | `{ ok:false, error:'product_id es requerido' }` |
| `400` | `quantity < 0` | `{ ok:false, error:'El stock no puede ser negativo' }` |
| `400` | `available < 0` | `{ ok:false, error:'El disponible no puede ser negativo' }` |
| `400` | `punto_de_venta_id` de otra empresa o inexistente | `{ ok:false, error:'Punto de venta inválido' }` |

Los dos mensajes de negativo son **exactamente** los que ya devuelve
`PUT /api/stock/:id` (`general.js:49` y `:52`). Ese es el punto del defecto 4: la
misma pantalla, con el mismo campo, decía una cosa o ninguna según si la fila ya
existía.

---

## `PUT /api/stock/:id` — modificada

Un solo cambio: **`location` sale de la lista blanca** (`general.js:65`). Es un
espejo, y un espejo que el cliente puede escribir no es un espejo. Lo demás queda
igual, incluido el `StockMovement` y la sincronización de `available` con
`quantity`.

Una fila de stock **no se puede mover de sucursal** por esta ruta. Mover
mercadería de una sucursal a otra es `POST /api/stock/transfer`, que es
transaccional y deja registro; hacerlo cambiando un campo no deja ninguno.

---

## `POST /api/stock/bulk` — modificada

Se cae la rama que buscaba la fila por `location` (`general.js:166-171`). La
sucursal se resuelve igual que en `POST /api/stock`: `punto_de_venta_id` del
cuerpo → cabecera → por defecto. El parámetro `location` del cuerpo queda
aceptado y **ignorado**, por compatibilidad con quien todavía lo mande.

---

## `POST /api/stock/transfer` — modificada

Sigue siendo transaccional y sigue devolviendo `ErrorDeNegocio` con el mensaje de
stock insuficiente (supuesto 6). Lo que cambia:

### Cuerpo

| Campo | Tipo | Nota |
|---|---|---|
| `from_punto_de_venta_id` | int | **nuevo**, es el que manda (FR-051) |
| `to_punto_de_venta_id` | int | **nuevo**, es el que manda |
| `from_location` / `to_location` | string | **se conservan** por compatibilidad; se resuelven a id antes de tocar nada |
| `items` | `[{ product_id, quantity }]` | ya se aceptaba; la pantalla nueva manda varios (FR-110) |

Si vienen los dos, mandan los ids. Un `code` que no resuelve contra ningún punto
de venta de la empresa es un `400`, **no** una caída a `location` como hoy
(`stock.js:42-46`).

### Validaciones nuevas

| Código | Cuándo | Antes |
|---|---|---|
| `400` | origen y destino son el **mismo id** | solo se comparaban los strings |
| `400` | un ítem con `quantity <= 0` o sin `product_id` | **se salteaba en silencio** (`stock.js:39`), y podía quedar registrada una transferencia sin ningún ítem |
| `400` | el destino es una sucursal **inactiva** | no se miraba (FR-115) |
| `400` | origen o destino no resuelven | caía a `location` |

El **origen sí puede ser una sucursal inactiva** (FR-115): si quedó mercadería en
un local cerrado, hay que poder sacarla.

La fila de destino, cuando no existe, se crea siempre **con `punto_de_venta_id`**
(hoy solo si `toPv` resolvió, `stock.js:87`).

### Respuesta

Sin cambios: `201` con la fila de `StockTransfer`, `items` incluidos.

---

## `GET /api/stock/transfers` — modificada

Mismos parámetros (`limit`, `offset`) y mismo scoping. Se agregan los nombres de
las sucursales, para que el historial pueda mostrarlos con el patrón de tabla
(FR-117) sin tener que cruzarlos en el navegador:

```json
{
  "ok": true,
  "total": 12,
  "data": [{
    "id": 41,
    "createdAt": "2026-08-01T14:22:10.000Z",
    "from_location": "principal", "to_location": "deposito",
    "from_punto_de_venta_id": 3,  "to_punto_de_venta_id": 7,
    "fromPuntoDeVenta": { "id": 3, "name": "Sucursal Principal" },
    "toPuntoDeVenta":   { "id": 7, "name": "Depósito" },
    "items": [{ "product_id": 88, "product_name": "Colágeno 300g", "quantity": 6 }]
  }]
}
```

Las transferencias **anteriores** a esta funcionalidad pueden tener los dos ids en
`null`; ahí el nombre sale de `from_location` / `to_location`. La pantalla tiene
que contemplarlo: no se migran (Fuera de alcance).

---

## `GET /api/products/:id/cost-history` — modificada

Sigue resolviendo el producto con `findScoped` antes de leer, y sigue devolviendo
`404` para el id de otra empresa sin distinguir «no existe» de «no es tuyo»
(escenario 10 de la historia 6). Lo que cambia es que **pagina** y que **dice
quién**.

### Parámetros

| Parámetro | Tipo | Default | Qué hace |
|---|---|---|---|
| `limit` | int | `10` | Filas por página. Se acota a 100. |
| `offset` | int | `0` | Desde dónde. |

FR-107: el historial no se trae entero de una. Diez es lo que entra en el panel
sin scrollear.

### Respuesta

```json
{
  "ok": true,
  "total": 23,
  "data": [{
    "id": 511,
    "change_date": "2026-07-30T11:04:00.000Z",
    "old_cost": "1200.00",
    "new_cost": "1380.00",
    "reason": "Importación de lista de precios",
    "usuario": { "id": 4, "nombre": "Rene", "email": "rene@…" }
  }]
}
```

- `old_cost` y `new_cost` son `DECIMAL(12,2)`: **el driver de Postgres los
  devuelve como string.** La variación en porcentaje que pide FR-102 se calcula en
  el navegador con `Number()`, nunca restando strings.
- `usuario` es `null` en las filas anteriores a esta funcionalidad (supuesto 16).
  La pantalla lo muestra como dato viejo, no como error.
- Orden: `change_date DESC, id DESC`. El `id` como segundo criterio porque dos
  cambios de la misma actualización masiva comparten timestamp, y sin un tercer
  criterio determinístico la paginación repite una fila y se saltea otra.

### Motivos (`reason`)

FR-105 pide distinguir el origen. Los valores quedan tipados en
`utils/historialDeCostos.js`:

| Constante | Texto | Quién lo escribe |
|---|---|---|
| `EDICION_MANUAL` | `Edición manual de costo base` | `PUT /api/products/:id` (ya existe, `products.js:141`) |
| `ACTUALIZACION_MASIVA` | `Actualización masiva: …` | `preciosService` (ya existe) |
| `DESHACER_MASIVA` | `Deshacer actualización masiva #N` | `preciosService` (ya existe) |
| `IMPORTACION` | `Importación de lista de precios` | **nuevo** — `POST /api/import/products` (FR-104) |
| `CARGA_MASIVA` | `Carga masiva de productos` | **nuevo** — `POST /api/products/bulk` (FR-104) |
| `ORDEN_DE_PRODUCCION` | `Actualización por orden de producción` | `productionService` (ya existe) |
| `RECOSTEO_DE_RECETA` | `Recosteo por cambio de un insumo` | `costService` en cascada |

Los textos existentes **no se cambian**: son los que ya está mostrando el
histórico guardado, y reescribirlos haría que dos filas del mismo origen se lean
distinto según cuándo se grabaron.

---

## `PUT /api/products/:id` — modificada

Dos cambios.

**1. Lista blanca de campos.** Hoy es `product.update(req.body)`
(`products.js:132`): el cuerpo entero se copia sobre la fila, así que un request
armado a mano puede mandar `empresa_id` y **mover el producto a otra empresa
cliente**. Pasan a aceptarse solo: `name`, `description`, `sku`, `barcode`,
`cost`, `brand_id`, `supplier_id`, `margin_override`, `price_override`,
`wholesale_margin`, `wholesale_price`, `category`, `unit_type`, `unit_size`,
`taxed`, `image_url`, `is_active`.

`is_active` está en la lista **a propósito**: es por donde el panel reactiva un
producto desactivado (FR-039, FR-078).

**2. El historial de costos lleva autor.** Pasa por
`registrarCambioDeCosto({ …, usuarioId: req.usuario.id })`. El umbral de `0.01`
que ya usa `products.js:135` se conserva: cambiar de `1200.00` a `1200.004` no es
un cambio de costo.

El resto —la transacción, el `findScoped`, la propagación en cascada a las
recetas— queda igual.

---

## `POST /api/products/bulk` — modificada

| Qué | Antes | Ahora |
|---|---|---|
| Sucursal del stock | `req.puntoDeVentaId` → `p.punto_de_venta_id` → `location` | `utils/sucursalDeStock.js`; **nunca `null`** |
| Historial de costos | **no escribía nada** (`products.js:203`) | escribe con motivo `CARGA_MASIVA` y autor (FR-104) |
| `p.location` | decidía la fila | se ignora |

---

## `POST /api/import/products` — modificada

**El contrato de transporte no cambia**: sigue siendo `multipart/form-data` con
`file`, `mapping` y `defaultLocation`. Pegar texto se resuelve en el navegador
normalizando la matriz y subiéndola como un CSV canónico (decisión 11 del plan),
así que el servidor no aprende una segunda forma de entrada.

### Qué cambia adentro

**1. La sucursal se resuelve por id (FR-050).** Este es el punto de la decisión:
que al importar productos no se rompa.

| Caso | Antes | Ahora |
|---|---|---|
| La fila trae columna Sucursal y resuelve contra un `code` de la empresa | fila con `location`, `punto_de_venta_id = null` | fila con el id de esa sucursal |
| La fila trae columna Sucursal y **no** resuelve | se creaba una fila con ese texto, invisible para la pantalla | **error de fila con su número**, y las demás se importan igual |
| La fila no trae columna Sucursal | `defaultLocation`, por defecto el string `'principal'` | el **punto de venta por defecto** de la empresa |

El texto del error dice qué códigos existen:

```json
{ "fila": 14, "error": "La sucursal \"Deposito Norte\" no existe. Códigos válidos: principal, deposito." }
```

`defaultLocation` sigue aceptándose y ahora se interpreta como **`code` de
sucursal**: se resuelve a id, y si no resuelve la importación entera se rechaza
con `400` **antes de escribir nada** — es un parámetro que aplica a todas las
filas, y descubrirlo en la fila 300 sería tarde.

**2. Los importes se leen con las reglas argentinas (FR-095).** El `toNum` de
`import.js:252` es `parseFloat`, que lee `1.234,50` como `1.234`. Pasa a usar
`aNumero` de `utils/importes.js` —la función que ya existe y ya está testeada en
`comparadorService`—. Se conserva intacto lo que corrige `import.js:254-259`: una
celda de costo vacía **no** pone el costo en cero (FR-099).

**3. Se registra el historial de costos (FR-104).** Cada producto cuyo costo
cambia escribe una fila con motivo `IMPORTACION` y `usuario_id = req.usuario.id`.
Es el defecto 2: el camino que más costos mueve era el único que no registraba
nada, y sin esto la pantalla de historial queda inútil justo en el caso principal.

**4. Los repetidos se informan (FR-097).** Si el archivo trae el mismo producto
—mismo SKU, o mismo nombre si no hay SKU— más de una vez, **gana la última fila**
y la respuesta dice cuántas se pisaron.

### Respuesta

```json
{
  "ok": true,
  "total": 200,
  "created": 12,
  "updated": 185,
  "pisados": 2,
  "errors": [{ "fila": 14, "error": "…" }]
}
```

`pisados` es nuevo. `errors` sigue siendo `undefined` cuando no hay ninguno, como
hoy (`import.js:324`).

### Lo que la pantalla hace y el servidor no sabe

- **El tope de 2.000 líneas** (FR-100) lo aplica el navegador antes de armar
  nada. El bucle del servidor sigue corriendo fila por fila sin transacción
  envolvente, y ese es el motivo del tope: una pegada grande que se corta a la
  mitad deja escrito lo que alcanzó y nadie sabe dónde.
- **La traducción del número de línea.** El servidor informa `fila: i + 2`,
  contando desde el archivo que recibió. El asistente guarda la correspondencia
  entre cada fila de la matriz y la línea original pegada —descartó las vacías,
  y puede haber agregado un encabezado sintético— y traduce antes de mostrar.
- **Confirmar dos veces** no dispara dos importaciones (FR-101): el botón se
  bloquea mientras hay una en curso.

---

## `GET /api/settings` — modificada

Se agrega un campo derivado, de **solo lectura**, que no se persiste:

```json
{ "ok": true, "data": { "…": "…", "umbral_stock_bajo": 3 } }
```

Es el mismo valor que usa `GET /api/faltantes` (`general.js:416`), ahora sacado de
`utils/stockBajo.js`. Existe para que la pantalla no tenga que repetir el literal
`3`: FR-017 pide que Inventario y Faltantes digan el mismo número, y dos
constantes iguales en dos repositorios empiezan iguales y terminan distintas.

**No lo hace configurable** —eso está Fuera de alcance—: escribirlo por
`PUT /api/settings` no tiene efecto.

> **El permiso de esta ruta es `config.ver`, no `products.ver`**
> (`general.js:277`). No agrega una exigencia nueva: `useStore.initialize()` ya
> pide `GET /settings` dentro del mismo `Promise.all` que trae los productos
> (`useStore.js:38-45`), así que un usuario sin `config.ver` hoy **no puede
> cargar ninguna de las pantallas que dependen del store**, no solo Inventario.
> Es un problema anterior a esta funcionalidad y queda anotado, no resuelto acá.
> Si alguna vez se separa, `umbral_stock_bajo` se muda a
> `GET /api/stock/sucursales`, que ya es la respuesta que la tabla necesita sí o
> sí y que va con `stock.ver`.

---

## `GET /api/products` — sin cambios de contrato

Se documenta porque es de donde sale toda la tabla (supuesto 7).

`products.js:59` ya incluye `punto_de_venta_id` en los atributos de `stock`, así
que la correspondencia fila de stock ↔ sucursal se resuelve por id y no por el
texto `location` (FR-061) **sin tocar el endpoint**.

Lo que cambia de hecho, por efecto de la migración: `stock[].punto_de_venta_id`
**nunca más viene en `null`**, y no puede haber dos elementos del array con el
mismo `punto_de_venta_id`. Las dos cosas la pantalla las da por ciertas.

Sigue sin paginar cuando no se le pasan `page` y `limit`, que es como lo llama
`useStore.initialize()` (`useStore.js:38`). Eso es el defecto 6 y queda Fuera de
alcance; la consecuencia está en el riesgo 7 del plan.
