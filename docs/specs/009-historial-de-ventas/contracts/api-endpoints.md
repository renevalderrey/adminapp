# Contratos de API: Historial de ventas

Complementa a [plan.md](../plan.md). Todas las rutas cuelgan de
`app.use('/api/sales', ...authEmpresa, …)` (`server.js:339`), o sea que ya pasan
por `checkJwt`, `extractUser`, `loadEmpresaContext`, `requireEmpresa` y
`checkSubscription`. **`req.empresaId` está garantizado en todas.**

| Ruta | Estado | Permiso |
|---|---|---|
| `GET /api/sales` | modificada | `ventas.ver` |
| `GET /api/sales/export` | **nueva** | `ventas.ver` |
| `GET /api/sales/:id` | **nueva** | `ventas.ver` |
| `POST /api/sales` | modificada | `ventas.crear` |
| `POST /api/sales/:id/facturar` | modificada | `ventas.crear` |
| `PUT /api/sales/:id/void` | modificada | `ventas.anular` |
| `GET /api/sales/summary` | sin cambios | `ventas.ver` |

> **Orden de declaración en `sales.js`.** `/summary`, `/export` y cualquier otra
> ruta literal tienen que declararse **antes** que `GET /:id`, o Express hace que
> `:id` se coma `"export"` y el listado exportado devuelva 404. Es el error más
> fácil de cometer en este cambio.

---

## `GET /api/sales`

Listado paginado del historial. Es la consulta principal de la pantalla.

### Parámetros

| Parámetro | Tipo | Default | Qué hace |
|---|---|---|---|
| `desde` | `YYYY-MM-DD` | hoy en la zona de la empresa | Inicio del rango, inclusive. |
| `hasta` | `YYYY-MM-DD` | hoy en la zona de la empresa | Fin del rango, inclusive. |
| `punto_de_venta_id` | int \| `todas` | la cabecera `X-Punto-De-Venta-Id`, si viene | Sucursal. `todas` desactiva el filtro. |
| `tipo` | `1` \| `6` \| `11` \| `sin_cae` | — | Tipo de comprobante de AFIP; `sin_cae` es `afip_type IS NULL`. |
| `q` | string | — | Busca en número de comprobante, CAE, `customer_name` y nombre de la ficha del cliente. |
| `page` | int | `1` | Página. |
| `limit` | int | `25` | Filas por página. Se acota a 100. |
| `customer_id` | int | — | Se conserva del contrato anterior. |
| `date` | `YYYY-MM-DD` | — | **Alias de compatibilidad.** Equivale a `desde = hasta = date`. Si vienen `desde`/`hasta`, se ignora. |
| `location` | string | — | **Se conserva pero queda obsoleto.** `Sale.location` es texto histórico; el filtro real es `punto_de_venta_id` (FR-071). Solo se aplica si no vino `punto_de_venta_id`. |

**Reglas de resolución**

- El rango se completa antes de consultar. Si falta uno de los dos extremos, se
  usa el otro; si faltan los dos, es el día de hoy en `Empresa.timezone`,
  calculado con `fechaDelNegocio` — nunca con `toISOString()` (FR-081).
- **La query manda sobre la cabecera.** Si viene `punto_de_venta_id`, decide él;
  si no viene, se usa `req.puntoDeVentaId`. Con `todas` no se filtra por
  sucursal, ni siquiera si la cabecera trae una (FR-072). Esto corrige
  `sales.js:20-24`, donde la cabecera pisaba el parámetro en silencio.
- `q` se aplica como `OR` entre: `afip_cae ILIKE %q%`, `customer_name ILIKE %q%`,
  `customer.name ILIKE %q%` y —solo si `q` tiene dígitos— `afip_nro = <dígitos>`.
  Los separadores se descartan, así que `0005-00014882` busca el número `14882`.
  Insensible a mayúsculas, **sensible a acentos** (ver riesgo 2 del plan).
- Orden fijo: `date DESC, time DESC, id DESC`. El tercer criterio es lo que hace
  la paginación estable cuando dos ventas comparten fecha y hora.

### Respuesta 200

```json
{
  "ok": true,
  "data": [
    {
      "id": "sale_1754006400000",
      "date": "2026-08-01",
      "time": "14:32",
      "total": "12500.00",
      "payment_method": "ef",
      "punto_de_venta_id": 3,
      "location": "ortiz",
      "customer_id": 41,
      "customer_name": "Vega, Marcela",
      "customer": { "id": 41, "name": "Vega, Marcela" },
      "afip_type": 6,
      "afip_pv": 5,
      "afip_nro": 14882,
      "afip_cae": "75412339018264",
      "afip_vto": "20260811",
      "status": "active",
      "estado": { "codigo": "autorizada", "etiqueta": "Autorizada" }
    }
  ],
  "total": 148,
  "total_periodo": 1842300.5,
  "page": 1,
  "totalPages": 6,
  "rango": { "desde": "2026-08-01", "hasta": "2026-08-01" },
  "sucursales": [
    { "id": 3, "name": "Ortiz", "is_active": true },
    { "id": 5, "name": "Centro", "is_active": false }
  ]
}
```

| Campo | Qué es |
|---|---|
| `total` | Comprobantes que pasan el filtro. Es la M de «Mostrando N de M» (FR-017) y lo que la pantalla compara contra 5.000 antes de exportar (FR-095). |
| `total_periodo` | Suma de `total` sobre **todo** el filtro, **anuladas incluidas**. Es un número, no un string: se hace `parseFloat` del `DECIMAL`. Ver decisión 6 del plan. |
| `rango` | El rango efectivamente aplicado. La pantalla inicializa sus campos de fecha con esto en la primera carga (FR-081). |
| `estado` | Derivado en el servidor. `codigo` alimenta el color; `etiqueta` es el texto del badge y la celda «Estado» del `.xlsx`. |
| `sucursales` | Las sucursales **presentes en el resultado filtrado**, activas e inactivas, ordenadas por nombre. Ver abajo. |

#### `sucursales` — extensión del contrato, agregada al implementar T905

El único origen de sucursales que tiene el frontend es
`empresaActiva.puntosDeVenta`, y la API lo filtra con `is_active: true` en los
cuatro lugares donde lo arma (`empresas.js:195`, `:220`, `:371` y
`GET /:empresaId/puntos-de-venta` en `:561`).

Con la respuesta como estaba escrita, una venta de una sucursal dada de baja
llega con un `punto_de_venta_id` que **la pantalla no puede nombrar**: el filtro
mostraría un id crudo, o directamente perdería la opción, y las ventas de un
local cerrado quedarían inalcanzables. FR-073 —«el filtro DEBE listar las
sucursales activas más las que aparezcan en el resultado aunque estén dadas de
baja, marcadas (inactiva)»— no se podía cumplir.

Por eso el listado devuelve las sucursales que aparecen en el resultado. La
pantalla las une con las activas que ya conoce y marca «(inactiva)» las que
vienen con `is_active: false`. Se calcula sobre **todo** el filtro, no sobre la
página: si no, la opción aparecería y desaparecería al paginar.

Las ventas anteriores a multi-sucursal tienen `punto_de_venta_id` en `null` y no
aportan ninguna entrada a esta lista; siguen apareciendo en el listado con
«Todas las sucursales».

**Cambios respecto de hoy que rompen a un consumidor:**

- **`data[].items` ya no viene.** El listado no muestra ítems (FR-003). Se
  obtienen por `GET /api/sales/:id`. Decisión 5 del plan.
- El orden por defecto pasa de `time ASC` a `date DESC, time DESC, id DESC`
  (FR-077).
- `limit` por defecto pasa de «sin paginar» a 25 (FR-017).
- `afip_ultimo_error` **no** se devuelve acá. Es texto largo que solo usa el
  panel; en el listado ya está representado por `estado.codigo === 'rechazada'`.

### Errores

| Código | `error` | Cuándo |
|---|---|---|
| `400` | `RANGO_INVERTIDO` | `desde > hasta` (FR-080). |
| `400` | `RANGO_DEMASIADO_LARGO` | Más de un año entre `desde` y `hasta` (FR-070, FR-080). |

Los dos son `ErrorDeNegocio`, así que `fallo()` responde con su `status` y su
mensaje en castellano. La pantalla además valida antes de consultar, así que
estos 400 son la red de abajo, no el camino normal.

---

## `GET /api/sales/export`

Todo el resultado del filtro, sin paginar, con las columnas del `.xlsx` ya
armadas. El archivo lo construye el navegador.

### Parámetros

Los mismos del listado **menos `page` y `limit`**, que no aplican.

### Respuesta 200

```json
{
  "ok": true,
  "total": 1240,
  "data": [
    {
      "fecha": "2026-08-01",
      "hora": "14:32",
      "tipo": "Factura B",
      "comprobante": "0005-00014882",
      "cae": "75412339018264",
      "cliente": "Vega, Marcela",
      "sucursal": "Ortiz",
      "estado": "Autorizada",
      "medio_de_pago": "Efectivo",
      "total": 12500
    }
  ]
}
```

Las diez claves son exactamente las diez columnas de FR-092, en orden.

| Clave | Cómo se arma |
|---|---|
| `comprobante` | `afip_pv` y `afip_nro` con relleno de ceros (`0005-00014882`). Sin CAE, el `id` de la operación. |
| `cae` | El string tal cual. El navegador lo escribe como celda de texto (FR-093). |
| `cliente` | `customer.name` → `customer_name` → `"Consumidor final"` (FR-103). |
| `sucursal` | `puntoDeVenta.name`. Sin sucursal, `"—"`. |
| `estado` | `estado.etiqueta`, la misma que el badge (FR-024). |
| `medio_de_pago` | Etiqueta legible de `payment_method`. Si la venta tuvo líneas de distinto medio, el declarado, que es el que ya guarda `metodoDePago` (`sales.js:158`). |
| `total` | **Número**, no string: `Number()` sobre el `DECIMAL` (FR-094). |

Sin filas se devuelve `data: []` y `total: 0`; el aviso de FR-096 lo da la
pantalla.

### Errores

| Código | `error` | Cuerpo | Cuándo |
|---|---|---|---|
| `400` | `LIMITE_EXPORT_SUPERADO` | `{ total, limite: 5000 }` | El filtro devuelve más de 5.000 comprobantes (FR-095). No se devuelve ninguna fila. |
| `400` | `RANGO_INVERTIDO` / `RANGO_DEMASIADO_LARGO` | — | Igual que el listado. |

El tope se evalúa con un `COUNT` antes de traer nada, así que el caso «más de
5.000» no carga 5.001 filas para descartarlas.

---

## `GET /api/sales/:id`

El detalle que alimenta el panel lateral. Una venta por vez.

### Respuesta 200

```json
{
  "ok": true,
  "data": {
    "id": "sale_1754006400000",
    "date": "2026-08-01",
    "time": "14:32",
    "total": "12500.00",
    "payment_method": "ef",
    "notes": null,
    "seller": "Rocío",
    "punto_de_venta_id": 3,
    "location": "ortiz",
    "customer_id": 41,
    "customer_name": "Vega, Marcela",
    "customer": {
      "id": 41,
      "name": "Vega, Marcela",
      "tax_id": "27123456784",
      "tax_condition": "consumidor_final"
    },
    "puntoDeVenta": { "id": 3, "name": "Ortiz", "code": "ortiz" },
    "afip_type": 6,
    "afip_pv": 5,
    "afip_nro": 14882,
    "afip_cae": "75412339018264",
    "afip_vto": "20260811",
    "afip_ultimo_error": null,
    "afip_ultimo_intento": null,
    "status": "active",
    "voided_at": null,
    "voided_by": null,
    "estado": { "codigo": "autorizada", "etiqueta": "Autorizada" },
    "items": [
      {
        "id": 9912,
        "product_id": 77,
        "product_name": "Whey Protein 1kg",
        "quantity": 1,
        "unit_price": "12500.00",
        "payment_method": "ef"
      }
    ]
  }
}
```

- `items` puede venir vacío: el panel dice que no hay detalle en vez de dibujar
  una tabla vacía (FR-033).
- `customer` y `puntoDeVenta` pueden ser `null`.
- `afip_ultimo_error` y `afip_ultimo_intento` alimentan el aviso de FR-034 y
  solo se muestran cuando `estado.codigo === 'rechazada'`.
- `afip_pv` es lo que usa «Verificar en AFIP», cayendo a `settings.afip_pv` solo
  si viene `null` (FR-099). Esto corrige `InvoicesList.jsx:105`, que usaba
  siempre el punto de venta configurado hoy.

### Errores

| Código | `error` | Cuándo |
|---|---|---|
| `404` | `Venta no encontrada` | No existe, **o es de otra empresa**. No se distingue: un 403 confirmaría que el id existe en otro cliente. |

---

## `POST /api/sales/:id/facturar`

Pide el CAE de una venta ya registrada. El contrato se **amplía**: los cuatro
campos del body pasan a ser opcionales y el servidor los resuelve cuando faltan.
`Billing.jsx` los sigue mandando y no cambia.

### Body

| Campo | Tipo | Requerido | Si no viene |
|---|---|---|---|
| `type` | int | no | `settings.tax_condition === 'RI'` → `6` (Factura B); `Monotributo` o `Exento` → `11` (Factura C). FR-042. |
| `customerCuit` | string | no | El `tax_id` de la ficha del cliente de la venta. Sin ficha, consumidor final: DocTipo 99. FR-043. |
| `customerVatCondition` | int | no | `1` para Factura A, `5` para B y C. FR-043. |
| `pv` | int | no | `sale.afip_pv` → `settings.afip_pv`. **Ver la salvedad de FR-044 en `plan.md`.** FR-044. |

El reintento desde el panel manda **body vacío**, salvo el caso de FR-047, donde
manda solo el `customerCuit` que el usuario acaba de tipear.

### Comportamiento nuevo

1. Abre transacción y toma la venta con `findScoped(..., { transaction, lock:
   t.LOCK.UPDATE })`, **sin `include`** — con un `include`, Sequelize arma un
   `LEFT OUTER JOIN … FOR UPDATE` que Postgres rechaza; está documentado en
   `sales.js:268-273`.
2. Revalida **dentro de la transacción**: `status === 'voided'` → 400;
   `afip_cae` presente → respuesta idempotente `yaFacturada` (FR-051).
3. Resuelve tipo, CUIT, condición de IVA y punto de venta.
4. Llama a `afipService.createVoucher`. **La transacción sigue abierta**: es lo
   que impide que se emita un CAE contra una venta que se anuló en el intervalo
   (FR-046). Está acotada por el timeout de 30 s del cliente SOAP.
5. Éxito → escribe `afip_cae`, `afip_nro`, `afip_vto`, `afip_type`, `afip_pv`,
   `afip_ultimo_error = null`, `afip_ultimo_intento = ahora`, y commit.
6. Fallo de AFIP → rollback, y después un `UPDATE` aparte con el error y la
   fecha, condicionado a `empresa_id = ? AND afip_cae IS NULL`.
7. El reintento **no toca el stock** en ningún caso (FR-050): la venta ya lo
   descontó al registrarse.

### Respuesta 200 — emitido

```json
{
  "ok": true,
  "data": {
    "cae": "75412339018264",
    "expiration": "20260811",
    "voucherNumber": 14882,
    "pointOfSale": 5,
    "type": 6
  }
}
```

### Respuesta 200 — ya estaba facturada

```json
{
  "ok": true,
  "yaFacturada": true,
  "data": { "cae": "…", "expiration": "…", "voucherNumber": 14882, "type": 6 }
}
```

Se mantiene como red de seguridad, no como camino normal: la pantalla no ofrece
el botón sobre una venta con CAE (FR-051).

### Errores

| Código | `error` | Cuándo |
|---|---|---|
| `400` | `CUIT_REQUERIDO` | Factura A (tipos 1, 2, 3) sin 11 dígitos de CUIT. La pantalla pide el CUIT y reintenta en el mismo paso (FR-047). Sin cambios respecto de hoy. |
| `400` | `No se puede facturar una venta anulada` | `status === 'voided'`, evaluado **dentro** de la transacción. |
| `400` | `Falta el punto de venta de AFIP` | Ni la venta ni `settings.afip_pv` tienen uno. |
| `404` | `Venta no encontrada` | No existe o es de otra empresa (FR, historia 3, escenario 13). |
| `502` | el mensaje de AFIP, tal cual | AFIP rechazó. La venta queda Rechazada con el error guardado y el botón vuelve a estar disponible (FR-048). |
| `500` | mensaje genérico + `requestId` | Cualquier otra falla. **Nuevo:** hoy un fallo del `sale.update` sale como 502 con el mensaje de Sequelize. Ver decisión 10 del plan. |

El 502 conserva su forma actual, incluido el `message` explicativo:

```json
{
  "ok": false,
  "error": "Factura rechazada u observada por AFIP: [{\"Code\":10015,…}]",
  "message": "La venta quedó registrada pero no se pudo emitir el comprobante. Podés reintentar desde el listado de ventas."
}
```

---

## `PUT /api/sales/:id/void`

Sin cambios para las ventas **sin** CAE: sigue restaurando stock y registrando
los movimientos, exactamente igual (FR-058, supuesto 5).

### Lo único que cambia

Después de tomar la venta con lock y antes de tocar el stock:

```js
if (sale.afip_cae) {
  throw new ErrorDeNegocio(
    'Esta venta tiene un comprobante con CAE: sigue vigente ante ARCA y anularla ' +
    'acá no lo da de baja. Hace falta una nota de crédito, que el sistema todavía ' +
    'no emite.'
  );
}
```

`fallo()` ya reconoce `err.publico` y responde `400` con ese mensaje, así que no
hace falta ningún manejo especial en el `catch`.

### Errores

| Código | `error` | Cuándo |
|---|---|---|
| `400` | el mensaje de arriba | La venta tiene `afip_cae` (FR-055, FR-057). |
| `400` | `Venta ya anulada` | Sin cambios. |
| `404` | `Venta no encontrada` | Sin cambios. |

La pantalla muestra «Anular venta» **deshabilitada con la explicación**, no
ausente (FR-056), pero el bloqueo real está acá: sin él, un `curl` sigue pudiendo
anular (FR-057).

---

## `POST /api/sales`

Un solo cambio, en el armado de `saleData`.

### Hoy (`sales.js:164-170`)

```js
if (customer_id) {
  saleData.customer_id = customer_id;
  saleData.customer_name = customer_name || null;
  saleData.is_credit = is_credit === true || is_credit === 'true';
}
```

El nombre libre que escribe el operador se pierde si no hay ficha de cliente.

### Nuevo

```js
// El nombre del cliente se guarda exista o no la ficha: es lo que se imprime
// en un remito y lo que se busca en el historial. Antes solo se persistia
// junto con customer_id, y el POS terminaba metiendolo adentro de `notes`.
//
// Se recorta a 255 porque la columna es VARCHAR(255) y este texto ahora llega
// tipeado a mano: un nombre largo haria fallar el INSERT y la venta no se
// registraria.
saleData.customer_name = String(customer_name || '').trim().slice(0, 255) || null;

if (customer_id) {
  saleData.customer_id = customer_id;
  // is_credit sigue atado a customer_id: sin ficha no hay a quien cobrarle
  // despues, asi que un nombre libre NO puede generar cuenta corriente.
  saleData.is_credit = is_credit === true || is_credit === 'true';
}
```

Cubre FR-100 y FR-102. El resto del handler —recálculo del total, fecha y hora
del servidor, descuento de stock, movimientos, avisos— no se toca.

**Del lado del POS** (`Billing.jsx:215`), `customer_name` se manda siempre y sale
de `notes` (FR-101):

```js
notes: isAfip ? '' : (docType === 'remito' ? 'REMITO' : 'RECIBO X'),
customer_name: customerName || null,
```

`printInvoice` arma el `typeStr` con `notes.split('-')[0].trim()`, que con
`'REMITO'` o `'RECIBO X'` sigue devolviendo lo mismo. Las ventas ya registradas
conservan el `"… - Cliente: X"` viejo y no se migran (FR-105).

---

## Cambios en `apps/web/src/services/api.js`

```js
export const getSales = (params) => api.get('/sales', { params });
export const getSale = (id) => api.get(`/sales/${id}`);
export const exportSales = (params) => api.get('/sales/export', { params });
```

`getSales` pasa de cuatro posicionales `(date, location, page, limit)` a un
objeto: con siete parámetros, los posicionales obligan a pasar `undefined` en el
medio. Nadie lo importa hoy, así que el cambio de firma no rompe nada.
