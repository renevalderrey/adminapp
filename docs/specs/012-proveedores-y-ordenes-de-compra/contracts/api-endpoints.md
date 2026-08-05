# Contratos de API: Proveedores y Órdenes de compra — pasada fina

Complementa a [plan.md](../plan.md). Todas las rutas cuelgan de `routes/suppliers.js`,
montado con `authEmpresa` en `server.js`: ya pasaron por `checkJwt`, `extractUser`,
`loadEmpresaContext`, `requireEmpresa` y `checkSubscription`. **`req.empresaId` está
garantizado**, y `req.puntoDeVentaId` viene de la cabecera `X-Punto-De-Venta-Id`
cuando el navegador la manda.

| Ruta | Estado | Permiso |
|---|---|---|
| `GET /api/suppliers` | **modificada** (rompe) | `proveedores.ver` |
| `GET /api/suppliers/:id` | **modificada** (rompe) | `proveedores.ver` |
| `GET /api/suppliers/:id/movimientos` | **nueva** | `proveedores.ver` |
| `GET /api/suppliers/:id/movimientos/export` | **nueva** | `proveedores.ver` |
| `DELETE /api/suppliers/:id` | **modificada** (aditiva) | `proveedores.eliminar` |
| `POST /api/suppliers/:id/payments` | **modificada** (aditiva) | `proveedores.crear` |
| `POST /api/suppliers/:id/orders` | **modificada** (aditiva) | `ordenes_compra.crear` |
| `GET /api/suppliers/orders` | **modificada** (aditiva) | `ordenes_compra.ver` |
| `GET /api/suppliers/orders/:id` | **modificada** (aditiva) | `ordenes_compra.ver` |
| `PUT /api/suppliers/orders/:id/receive` | **modificada** (rompe) | `ordenes_compra.recibir` |
| `PUT /api/suppliers/orders/:id/cancel` | **modificada** (aditiva) | `ordenes_compra.anular` |
| `POST /api/suppliers/:id/documents` | **sin cambios** | `proveedores.editar` |
| `DELETE /api/suppliers/documents/:id` | **sin cambios** | `proveedores.eliminar` |
| `PUT /api/suppliers/movements/:id` | **sin cambios** | `proveedores.editar` |
| `DELETE /api/suppliers/movements/:id` | **sin cambios** | `proveedores.eliminar` |

**No se crea ningún permiso** (supuesto 9). Los dos endpoints de documentos son los
que ya estaban bien (`suppliers.js:246-279`) y **no se tocan**.

> ⚠ **Orden de declaración.** `router.get('/:id')` está en `suppliers.js:104` y se
> come cualquier palabra literal que se declare después. Las dos rutas nuevas
> cuelgan de `/:id/…`, así que entran sin problema. **Un `GET /api/suppliers/export`
> —de todos los proveedores— no podría declararse ahí abajo**: iría a parar a
> `GET /:id` con `id = 'export'`. Es la misma trampa documentada en
> `routes/sales.js:226-230`.

---

## `GET /api/suppliers` — modificada, **rompe**

### Antes

Devuelve todos los proveedores de la empresa, cada uno con el arreglo completo de
`movements` y de `documents` (`suppliers.js:77-96`). Sin paginación, sin búsqueda,
sin ningún número calculado. El navegador suma los movimientos para mostrar un
saldo (`Orders.jsx:93-98`).

### Ahora

```
GET /api/suppliers?q=nutri&page=1&limit=50
```

| Parámetro | Tipo | Por defecto | Qué hace |
|---|---|---|---|
| `q` | string | — | Filtra por nombre, sin distinguir mayúsculas ni acentos (FR-059) |
| `page` | entero ≥ 1 | `1` | 1-indexado, como `components/Pagination.jsx` |
| `limit` | entero 1-200 | `50` | Un valor fuera de rango se recorta, no se rechaza |

```json
{
  "ok": true,
  "total": 37,
  "data": [
    {
      "id": 7,
      "name": "Nutrifit",
      "phone": "1155…", "email": "…", "address": "…", "cuit": "30123456789",
      "deuda": 184000.00,
      "pagado": 120000.00,
      "saldo": 64000.00,
      "pendiente_de_recibir": 38500.00,
      "movimientos": 23,
      "documentos": 0
    }
  ]
}
```

**Lo que desaparece: `movements` y `documents`.** Es el hallazgo 7 de la spec: con
tres años de operación, ese par de arreglos es la contabilidad entera en cada carga
de pantalla, y el único uso que tenían era sumarse para mostrar un número.

**Los cinco números, y qué significa cada uno** (vocabulario de la spec):

| Campo | Definición | De dónde sale |
|---|---|---|
| `deuda` | Σ de los movimientos `type: 'deuda'` | `GROUP BY supplier_id, type` |
| `pagado` | Σ de los movimientos `type: 'pago'` | idem |
| `saldo` | `deuda − pagado`. **Positivo = se le debe al proveedor** | `resumenDeCuenta`, en centavos enteros |
| `pendiente_de_recibir` | Σ `(quantity − quantity_received) × unit_price` sobre las órdenes `pending` y `partial` | `pendienteDeRecibir`, sobre el `detail` JSONB |
| `movimientos` / `documentos` | Conteos, para el estado vacío y el aviso «sin factura» (FR-086) | `COUNT` agrupado |

**`pendiente_de_recibir` es la decisión 2 de la spec hecha número.** La deuda sigue
siendo la mercadería recibida —una orden emitida y no entregada no se debe— y el
número que el sistema viejo contaba **al emitir** se muestra al lado, con su
etiqueta, para que Comprafit lo siga viendo.

**Los cinco salen en centavos y vuelven a pesos con dos decimales.** El driver
devuelve `DECIMAL` como **string** (`modelosFalsos.js` lo reproduce a propósito), y
el `SUM` de Postgres también. La conversión explícita es lo que pide FR-050 y el
escenario 7 de US6.

**Aislamiento.** Las tres consultas llevan `empresa_id` en el `where`. **Ninguna
lleva `include`**, así que las cuatro entradas que este endpoint aportaba al
detector de `analizarIncludes` desaparecen (decisión 6a del plan).

### Quién lo consume

`getSuppliers()` se llama hoy desde `Orders.jsx:75` y `PurchaseOrders.jsx:142`.
**Antes del corte 4 hay que barrer el repositorio buscando otros llamadores** —
Faltantes y Comparador son candidatos — porque el cambio es de los que rompen.
Riesgo 5 del plan.

---

## `GET /api/suppliers/:id` — modificada, **rompe**

### Antes

Trae el proveedor con tres `include`: `orders`, `movements` y `documents`
(`suppliers.js:106-115`). Los dos `order: [['date','DESC']]` están **adentro** del
include, donde Sequelize los ignora.

### Ahora

```json
{
  "ok": true,
  "data": {
    "id": 7, "name": "Nutrifit", "cuit": "30123456789", "phone": "…", "email": "…", "address": "…",
    "deuda": 184000.00, "pagado": 120000.00, "saldo": 64000.00,
    "pendiente_de_recibir": 38500.00,
    "documents": [
      { "id": 3, "name": "Factura 0001-00012345", "type": "factura",
        "url": "https://drive.google.com/…", "date": "2026-07-14" }
    ]
  }
}
```

- **`movements` se va**: paginan por su propio endpoint (abajo).
- **`orders` se va**: salen de `GET /api/suppliers/orders?supplier_id=7`, que ya
  existe, ya pagina y ya exige `ordenes_compra.ver`. **Ese cambio de permiso es
  buscado**: la spec lo pide en su caso de borde («un usuario con `proveedores.ver`
  y sin `ordenes_compra.ver` ve la cuenta y **no** ve las órdenes») y hoy no se
  cumple, porque el include solo miraba `proveedores.ver`. Riesgo 12 del plan.
- **`documents` se queda**, con su `where: { empresa_id }`, porque son pocos, no
  paginan y el bloque los muestra completos. Es el único `include` de hijo que
  sobrevive en el archivo.
- Los cuatro números son **los mismos** que trae el listado, calculados por **las
  mismas funciones**. Ni la lista ni la cuenta pueden decir números distintos.

**404** si el proveedor no es de la empresa, sin distinguir «no existe» de «no es
tuyo» (`tenantScope.js:78-96`).

---

## `GET /api/suppliers/:id/movimientos` — nueva

El historial de cuenta, paginado y **con el saldo acumulado ya calculado**.

```
GET /api/suppliers/7/movimientos?page=1&limit=50&desde=2026-01-01&hasta=2026-07-31
```

```json
{
  "ok": true,
  "total": 23,
  "saldo_inicial": 42000.00,
  "data": [
    { "id": 91, "date": "2026-07-28", "type": "pago", "amount": 50000.00,
      "payment_method": "tr", "notes": "Transferencia", "saldo": 64000.00 },
    { "id": 88, "date": "2026-07-14", "type": "deuda", "amount": 72000.00,
      "payment_method": null, "notes": "Recepción orden #118", "saldo": 114000.00 }
  ]
}
```

- **Orden descendente por `date`, desempatando por `id`.** Es el orden en que se
  lee una cuenta corriente y es el que la pantalla dibuja sin volver a ordenar
  (FR-053: nada de `.sort()` sobre el estado de React).
- **`saldo` es el acumulado *después* de ese movimiento**, calculado ascendente y
  devuelto descendente. `saldo_inicial` es el saldo al final del período anterior
  al primer movimiento de **esta página**, y sale de un `SUM` sobre los movimientos
  más viejos que el corte.
- **Sin `saldo_inicial`, el acumulado de la página 2 sería la suma de un
  subconjunto** y la última fila del archivo no coincidiría con el saldo grande de
  la pantalla, que es exactamente lo que FR-101 y el escenario 6 de US8 prohíben.
- `date` es `DATEONLY`: viaja como `"2026-07-28"` y **la pantalla no lo pasa por
  `new Date()`** (FR-052). Es el defecto que hoy muestra 31/07 en lugar de 01/08.

---

## `GET /api/suppliers/:id/movimientos/export` — nueva

Mismo molde que `GET /api/sales/export` (`routes/sales.js:232-290`): **el servidor
arma las filas, el navegador arma la hoja** (FR-097).

```
GET /api/suppliers/7/movimientos/export?desde=2026-01-01&hasta=2026-07-31
```

```json
{
  "ok": true,
  "total": 23,
  "proveedor": { "name": "Nutrifit", "cuit": "30123456789" },
  "saldo_inicial": 0, "saldo_final": 64000.00,
  "data": [
    { "fecha": "2026-01-08", "tipo": "Pedido", "descripcion": "Recepción orden #103",
      "debe": 72000, "haber": 0, "saldo": 72000, "cuit": "30123456789" }
  ]
}
```

**Las seis columnas son las que decidió [PENDIENTE 4]**: fecha, tipo, descripción,
debe, haber y saldo. **No es un asiento contable formal** —eso necesita un plan de
cuentas que AdminApp no tiene— y está escrito así en la spec para que nadie lo
descubra en la reunión con el contador.

| Regla | Por qué |
|---|---|
| **Ascendente**, del más viejo al más nuevo | Es al revés que la pantalla, y a propósito: un saldo acumulado que crece hacia abajo es como se lee una cuenta en una planilla |
| `debe` y `haber` son **números**, no strings | FR-098. Es la trampa de los importes argentinos del lado de la escritura: si la celda dice `"1.234,50"`, la columna no suma |
| `cuit` viaja **como string** en cada fila | FR-099. La web lo escribe con `{ t: 's', z: '@' }`; once dígitos inferidos como número salen en notación científica y pierden dígitos, igual que el CAE (`exportarVentas.js:63-65`) |
| **Sin paginar**, con tope | `LIMITE_EXPORT` como en ventas. Por encima, `400 LIMITE_EXPORT_SUPERADO` con el total y el límite en el cuerpo, para que la pantalla diga qué acotar |
| `saldo_final` es **el acumulado de la última fila del archivo**. Sin rango, o con solo `desde`, es **el mismo número** que el `saldo` del listado; **con `hasta` es el saldo a esa fecha** | FR-101. Sale de la misma acumulación en centavos que las filas, no de una segunda suma. La salvedad de `hasta` está abajo |
| `saldo_inicial` es el saldo **anterior** al primer movimiento del archivo | Con `desde`, los movimientos más viejos que el corte existen y son el «saldo anterior» de la cuenta: sin este número la primera fila parece el principio de la cuenta y no lo es. Sin `desde` es `0` y no se consulta nada. Mismo campo que devuelve `GET /:id/movimientos` |
| Sin movimientos → `data: []` y `total: 0`, **200** | US8 escenario 7: el archivo sale con encabezados y sin filas, y no falla. `saldo_final` cae en `saldo_inicial` |

### La salvedad de `hasta`, y por qué no es una excepción a FR-101

La primera versión de esta línea decía, **sin condicionar**, que `saldo_final` es
el mismo número que el `saldo` del listado. Con `?desde=` lo es —el arreglo
arranca en `saldo_inicial`, así que el acumulado llega al saldo entero—. **Con
`?hasta=` no puede serlo, y forzarlo rompería el archivo**: si el corte deja
movimientos posteriores afuera, un archivo que cerrara en el saldo de hoy no
cuadraría con sus propias filas —la última fila diría una cosa y el pie otra— y
eso es exactamente lo que prohíben FR-101 y el escenario 6 de US8, que piden que
el archivo cierre en el número con el que cierra la planilla.

Lo que FR-101 exige es **una sola fuente**, no un solo valor: los cuatro saldos
—listado, ficha, bloqueo del borrado y archivo— salen de `resumenDeCuenta` y de
la misma acumulación en centavos (`utils/cuentaDeProveedor.js`). Cortar un
período cambia **qué se está sumando**, no cómo. Por eso:

- **sin rango**, y **con solo `desde`** (porque el período arranca en
  `saldo_inicial`), `saldo_final` es el saldo de la cuenta y coincide con el
  listado y con el saldo grande de la pantalla;
- **con `hasta`**, `saldo_final` es el saldo **a esa fecha**, que es lo que
  significa cortar un período. La pantalla que ofrezca el rango tiene que decirlo
  en el archivo o al lado del botón: un contador que compara el pie de la
  planilla contra el saldo de la pantalla tiene que saber por qué difieren.

El nombre del archivo lo arma la web (`nombreDelArchivo({ proveedor, desde, hasta })`,
FR-100), como en ventas: la API no sabe cómo se llama la descarga.

---

## `PUT /api/suppliers/orders/:id/receive` — modificada, **rompe**

Es el endpoint del defecto 4 y el que más cambia.

### Cuerpo — antes

```json
{ "items": [ { "product_id": 41, "quantity_received": 10 } ], "location": "general" }
```

`receiveOrder` resolvía la línea con `detail.find(d => d.product_id === received.product_id)`
(`purchaseService.js:93`). Con dos líneas del mismo producto, **la primera se lleva
todo**; con dos líneas sin producto, `undefined === undefined` matchea la primera.

### Cuerpo — ahora

```json
{
  "items": [
    { "linea": 0, "cantidad": 10, "actualizar_costo": true },
    { "linea": 2, "cantidad": 4,  "actualizar_costo": false }
  ],
  "punto_de_venta_id": 3
}
```

| Campo | Tipo | Obligatorio | Qué es |
|---|---|---|---|
| `items[].linea` | entero ≥ 0 | **sí** | La **posición en `detail`**. Es la identidad de la línea (decisión 1 del plan) |
| `items[].cantidad` | número > 0 | sí | Lo que llegó **en esta recepción**, no el acumulado |
| `items[].actualizar_costo` | booleano | no (`false`) | Si se acepta la propuesta de costo de esa línea |
| `punto_de_venta_id` | entero | no | La sucursal de destino (FR-103). Si falta, cae a `X-Punto-De-Venta-Id` y después a la sucursal por defecto, vía `resolverSucursal` |
| `location` | string | — | **Se ignora.** Ya no ubicaba nada (`purchaseService.js:114-118`) y ahora ni se lee. FR-104 |

**`linea` no es opcional, y la validación es explícita**: si el índice no existe en
`detail`, `400 LINEA_INEXISTENTE`. Si `linea` está y `product_id` también, y no
coinciden, `400 LINEA_INCONSISTENTE` — es la red contra una pantalla que se quedó
con un detalle viejo.

> **Respaldo transitorio, de un solo corte.** Entre el corte 1 y el corte 10, el
> servidor acepta también el cuerpo viejo `{ product_id, quantity_received }`
> **y solo si la orden no es ambigua**: ninguna línea sin `product_id` y ningún
> `product_id` repetido. Si lo es, `400 LINEA_REQUERIDA` con el nombre del producto
> repetido en el mensaje. El corte 10 borra ese camino y agrega el test de que el
> cuerpo viejo se rechaza. El motivo de no dejarlo para siempre está en la decisión
> 1 del plan: es el camino ambiguo que este hito viene a cerrar.

### Respuesta

```json
{
  "ok": true,
  "data": {
    "id": 118,
    "status": "partial",
    "recibido": [
      { "linea": 0, "product_id": 41, "product_name": "Colágeno 300g",
        "pedido": 12, "recibido_ahora": 10, "recibido_total": 10, "pendiente": 2 }
    ],
    "deuda": { "id": 402, "amount": 12000.00, "date": "2026-08-04" },
    "costos": [
      { "linea": 0, "product_id": 41, "costo_anterior": 900.00, "costo_nuevo": 1200.00,
        "aplicado": true, "recosteos": 3 }
    ],
    "avisos": [
      "Se pidieron 4 de «Panel acústico» y quedaban 2 pendientes: se cargaron 2.",
      "«Fletes» no está en el catálogo: se registró la deuda y no se movió stock."
    ]
  }
}
```

**`recibido[].recibido_ahora` es FR-033.** Cuando el servidor recorta a lo pendiente
(`purchaseService.js:101`), la pantalla tiene que decir **cuánto entró de verdad** y
no repetir lo que el usuario escribió. Hoy dice «Mercadería recibida» y nada más.

**`costos[]` solo trae las líneas cuya casilla se aceptó y que además superaron el
umbral.** El servidor **vuelve a evaluar** `esCambioSignificativo` antes de escribir:
la casilla del cliente es un pedido, no una orden. `recosteos` es cuántos productos
elaborados se recostearon en cascada (decisión 2 del plan), y está para que se vea
que pasó: es el trabajo que la spec no menciona.

**`avisos[]` son frases para leer, no para parsear.** Todo lo que la pantalla
necesita saber por producto está en `recibido[]` y en `costos[]`, indexado por
`linea`. Es la lección del campo `stock` de `POST /api/sales` (contrato de la 011,
cambio 2): un aviso con el nombre del producto adentro de un texto en castellano no
se puede usar para decidir nada.

**`deuda` es `null`** cuando no se recibió nada válido (FR-037: cero unidades no
crea movimiento ni cambia el estado).

### Reglas por línea

| Caso de la línea | Stock | Deuda | Costo | Aviso |
|---|---|---|---|---|
| Producto de la empresa | sube en la sucursal resuelta | sí | se propone y se aplica si se aceptó | — |
| `cantidad` ≤ 0 | — | — | — | «Se ignoró una cantidad de cero o negativa» |
| `cantidad` > pendiente | sube **lo pendiente** | por lo pendiente | idem | «se cargaron N» |
| `product_id: null` | **no se toca** | **sí** | no aplica | «no está en el catálogo» |
| `product_id` de un producto borrado | **no se toca** | **sí** | no aplica | idem |
| `product_id` de **otra empresa** | — | — | — | **La recepción se rechaza entera**, `400` |

Las tres primeras ya las hacía el servidor y **no las decía**. La cuarta y la
quinta hoy **revierten la transacción entera con un 500** (hallazgo 2 del plan): el
`Stock.create` con `product_id: null` choca contra la columna y no entra nada, ni de
las otras líneas.

### Códigos de respuesta

| Código | Cuándo | Cuerpo |
|---|---|---|
| `200` | Recepción registrada | `{ ok: true, data }` |
| `400 LINEA_REQUERIDA` | Cuerpo viejo sobre una orden ambigua (solo durante el respaldo) | `error` + `message` con el producto repetido |
| `400 LINEA_INEXISTENTE` | El índice no existe en `detail` | idem |
| `400 LINEA_INCONSISTENTE` | `linea` y `product_id` no coinciden | idem |
| `400` | Un `product_id` del detalle no es de la empresa | `ErrorDeNegocio` |
| `404` | La orden no es de la empresa, o no existe | «Orden no encontrada» |
| `409` | «La orden ya fue recibida completa» / «La orden está anulada» | El mensaje **tal cual**. Hoy los dos salen **500** |
| `400` | Empresa sin sucursales | El `ErrorDeNegocio` de `sucursalPorDefecto` |
| `500` | Cualquier otra cosa | `fallo()`: mensaje en castellano + `requestId` |

**El 409 es el hallazgo 3 del plan.** Los cinco mensajes de `purchaseService` son
`throw new Error(...)`, y `fallo()` solo respeta `err.status` cuando `err.publico`
es verdadero (`errores.js:60-73`). Pasan a `ErrorDeNegocio` y **no hace falta tocar
ninguna ruta**.

### Lo que **no** cambia de `receiveOrder`

FR-038, y es el supuesto 3 de la spec: es la pieza más sólida de la funcionalidad
y **sus tres bugs corregidos no pueden volver**.

- `assertEmpresaId(empresaId)` (`:72`).
- La transacción única (`:74`).
- El `lock: t.LOCK.UPDATE` sobre la fila de `Stock` (`:137`).
- La **copia profunda** del `detail` más el `changed('detail', true)` (`:89`, `:174`).
  Sin eso, las cantidades recibidas nunca se persistían.
- El estado recalculado sobre **todas** las líneas, no solo las que vinieron
  (`:162-166`). Sin eso, recibir una línea de tres marcaba la orden como completa.
- `empresa_id` en el `where` **y** en el alta de `Stock` (`:130-153`). Sin eso, el
  stock caía en la empresa 1 por el default de la columna.

Lo único que se mueve de posición es la llamada a `resolverSucursal`, que **sube
antes del bucle**: hoy se ejecuta una vez por línea, dentro de la transacción
(hallazgo 5 del plan).

---

## `GET /api/suppliers/orders/:id` — modificada, aditiva

El detalle gana, **por línea**, lo que la propuesta de costo necesita:

```json
{
  "ok": true,
  "data": {
    "id": 118, "supplier_id": 7, "supplier_name": "Nutrifit",
    "date": "2026-08-01", "total": 108000.00, "status": "partial", "notes": null,
    "items": [
      { "linea": 0, "product_id": 41, "product_name": "Colágeno 300g",
        "quantity": 12, "unit_price": 1200.00, "quantity_received": 8,
        "costo_actual": 900.00, "propone_costo": true },
      { "linea": 1, "product_id": null, "product_name": "Flete",
        "quantity": 1, "unit_price": 9000.00, "quantity_received": 0,
        "costo_actual": null, "propone_costo": false }
    ]
  }
}
```

| Campo nuevo | Qué es |
|---|---|
| `linea` | La posición en `detail`. **Va explícita** para que la pantalla no la deduzca del orden del arreglo y el cuerpo de la recepción sea copiar un número |
| `costo_actual` | El `Product.cost` de hoy, resuelto con `findScoped`. `null` si la línea no tiene producto o el producto ya no existe |
| `propone_costo` | `esCambioSignificativo(costo_actual, unit_price)`. **La regla vive acá y no en el navegador** (decisión 2 del plan) |

**No se agrega a `GET /api/suppliers/orders`** (el listado): serían N consultas de
producto para dibujar una tabla que no muestra costos. El panel siempre pide el
detalle.

---

## `GET /api/suppliers/orders` — modificada, aditiva

Ya acepta `supplier_id`, `status`, `from`, `to`, `limit` y `offset`, y ya devuelve
`total` (`purchaseService.js:209-253`). Lo que cambia:

**1. Los filtros se validan (FR-021).** Hoy `if (supplier_id) where.supplier_id = supplier_id`
(`:221`) manda `' '` —un espacio— a una columna `INTEGER`, Postgres responde
`invalid input syntax for type integer`, y el `catch` hace `console.error`
(`PurchaseOrders.jsx:134`): **la pantalla queda con la lista anterior y sin ningún
aviso**. Ahora:

| Parámetro | Validación | Si falla |
|---|---|---|
| `supplier_id` | entero positivo | `400 FILTRO_INVALIDO` |
| `status` | uno de `pending`/`partial`/`received`/`cancelled` | idem |
| `from`, `to` | `YYYY-MM-DD` | idem |
| `limit` | entero, recortado a **200** | se recorta, no falla |

**La corrección de fondo es de la pantalla** (FR-020): la opción «todos» produce la
**ausencia** del parámetro, no un valor centinela. `<SelectItem value=" ">`
(`PurchaseOrders.jsx:212`, `:224`) desaparece. El servidor valida igual, porque el
requisito dice que un valor del tipo equivocado no puede subir como 500.

**2. El `include` de `Supplier` se acota a la empresa (FR-067).**
`{ model: Supplier, as: 'supplier', attributes: ['id','name'] }` (`:234`) gana
`where: { empresa_id }, required: false`. Es un `belongsTo`, así que **no mueve el
ancla de `analizarIncludes`**, que solo cuenta `HasMany` y `HasOne`.

**3. La paginación pasa a usarse.** No hay trabajo de servidor: `limit`/`offset` ya
están. `PurchaseOrders.jsx:128` manda `limit = 100` fijo y nunca `offset`, así que
hoy no hay forma de llegar a la orden 101 (FR-022).

---

## `POST /api/suppliers/:id/orders` — modificada, aditiva

**Cambio único: los `product_id` del detalle se validan contra la empresa (FR-062).**

```js
const ids = [...new Set(detalle.map(l => l.product_id).filter(Boolean))];
const propios = await Product.findAll({ where: { id: ids, empresa_id: empresaId }, attributes: ['id'] });
if (propios.length !== ids.length) throw new ErrorDeNegocio('…', 400);
```

Hoy `purchaseService.js:40` guarda `item.product_id || null` sin mirar nada, así
que una empresa puede dejar en su propio `detail` una línea que apunta al producto
de otro cliente. La consecuencia se ve al recibir: el `Stock.findOne` lleva
`empresa_id`, así que no encuentra la fila del otro, pero el `Stock.create` **crea
una fila de stock propia para un producto ajeno**.

El mensaje nombra los productos que no son de la empresa. **404 no**: acá el
proveedor sí es propio y el error es del cuerpo, no del recurso.

Este `findAll` con `empresa_id` en el `where` es además lo que el detector
`analizarCreates` acepta como validación previa
(`/find(One|All)\(\s*\{[^;]*?empresa_id/`), así que el `SupplierOrder.create` de
tres líneas más abajo sigue limpio.

Y la fecha por defecto pasa de `new Date().toISOString().split('T')[0]` (`:51`) a
`await hoyDelNegocio(empresaId)` (decisión 9 del plan).

---

## `POST /api/suppliers/:id/payments` — modificada, aditiva

El proveedor ya se valida con `findScoped` antes de crear (`suppliers.js:196`) y
**eso no se toca**: es el arreglo de `dfd7009` y es lo que ancla la guardia
`analizarCreates` a este archivo.

**Cambio único: el importe se valida (FR-088).**

| Caso | Antes | Ahora |
|---|---|---|
| `amount` ausente o `NaN` | `parseFloat('')` = `NaN` llega a la base | `400` «El monto del pago tiene que ser un número mayor que cero» |
| `amount` ≤ 0 | se acepta | `400`, mismo mensaje |
| `amount` > saldo | se acepta | **se acepta**: pagar por adelantado es legítimo (FR-089). La confirmación con los dos números es de la pantalla |

Hoy `Orders.jsx:125` manda `parseFloat(payData.amount)` sin validar nada. La
validación va en los dos lados —navegador **y** servidor— porque el requisito lo
dice y porque el navegador no es una barrera.

---

## `PUT /api/suppliers/orders/:id/cancel` — modificada, aditiva

Sin cambios de parámetros. Lo que cambia son los errores: los tres `throw new Error`
(`purchaseService.js:200-202`) pasan a `ErrorDeNegocio` con **404** y **409**, igual
que en la recepción.

**Se sigue pudiendo anular una orden `partial`**, y es [PENDIENTE 9] resuelto por
defecto: la mercadería que llegó se debe, así que el movimiento de deuda **queda
vivo** y la anulación cancela solo lo pendiente. La pantalla lo dice con el número
antes de confirmar; el servidor no cambia de comportamiento.

---

## `DELETE /api/suppliers/:id` — modificada, aditiva

[PENDIENTE 10] por defecto: **con saldo distinto de cero, se bloquea.**

```json
{ "ok": false,
  "error": "Nutrifit tiene un saldo de $64.000,00. Saldá la cuenta antes de eliminarlo.",
  "requestId": "…" }
```

El saldo sale de la misma función de la decisión 4 (`resumenDeCuenta`), no de una
segunda suma. Con saldo cero, el `DELETE` sigue haciendo exactamente lo que hace
hoy: borra documentos, movimientos, órdenes y proveedor en una transacción
(`suppliers.js:150-169`). La confirmación con los conteos es de la pantalla
(FR-094).

> ⚠ **Las tres líneas de `destroy` no se reformatean.** Están en la lista de
> excepciones de `observabilidad.test.js:182-191` como **match exacto sobre la línea
> recortada**. El chequeo del saldo va **antes** de ellas. Un cambio de espaciado
> rompe la exención y aparece como un hallazgo de aislamiento que no lo es.
> FR-068: la lista no crece.

---

## Los cuatro endpoints que no se tocan

| Ruta | Por qué |
|---|---|
| `POST /api/suppliers/:id/documents` | Es el que ya estaba bien: valida el proveedor con `findScoped` y usa lista blanca (`suppliers.js:246-268`). US7 escenario 10 lo dice explícitamente |
| `DELETE /api/suppliers/documents/:id` | `where` con `empresa_id` (`:273`) |
| `PUT /api/suppliers/movements/:id` | `findScoped` + lista blanca (`:220-225`). FR-093 solo pide que la pantalla lo **use**, que es lo que falta |
| `DELETE /api/suppliers/movements/:id` | `where` con `empresa_id` (`:235`) |

Los cuatro existen y funcionan desde siempre. Lo único que falta de los dos de
movimientos es un botón que los llame.
