# Contratos de API: TiendaNube

Complementa a [plan.md](../plan.md).

Las rutas cuelgan de `routes/tiendanube.js`, que exporta **dos routers con
exposición distinta** y que `server.js` monta por separado. Esa separación se
conserva (supuesto 5), y `permisosDeRutas.test.js:81-85` la reconoce como
excepción documentada.

| Router | Montaje | Cadena | Quién lo llama |
|---|---|---|---|
| `publico` | **arriba de `app.use(express.json(…))`** — decisión 5 | `requestId`, `helmet`, `morgan`, `cors`. **Sin `express.json` global y sin rate limiter** | TiendaNube |
| `privado` | donde está hoy (`server.js:346`) | `...authEmpresa` = `checkJwt`, `extractUser`, `loadEmpresaContext`, `requireEmpresa`, `checkSubscription` | La app |

> ⚠ **El router `publico` sube de lugar y eso cambia lo que tiene delante.**
> Cualquier ruta que se le agregue a partir de ahora nace **sin cuerpo JSON
> parseado** y **sin rate limit**. El comentario va en `server.js` y en
> `routes/tiendanube.js`, y la guardia de FR-021 lo verifica leyendo `server.js`.

---

## Las catorce rutas

| Ruta | Router | Estado | Permiso |
|---|---|---|---|
| `GET /api/tiendanube/auth` | privado | **modificada** (rompe) | `config.editar` |
| `GET /api/tiendanube/callback` | público | **modificada** | — |
| `GET /api/tiendanube/status` | privado | **modificada** (rompe) | `config.ver` |
| `PUT /api/tiendanube/sucursal` | privado | **nueva** | `config.editar` |
| `DELETE /api/tiendanube/vinculacion` | privado | **nueva** | `config.editar` |
| `POST /api/tiendanube/webhook` | público | **modificada** | — |
| `GET /api/tiendanube/variantes` | privado | **nueva** (reemplaza `/products`) | `config.ver` |
| `POST /api/tiendanube/variantes/refrescar` | privado | **nueva** | `config.editar` |
| `GET /api/tiendanube/mapeos` | privado | **nueva** | `config.ver` |
| `POST /api/tiendanube/mapeos` | privado | **nueva** (reemplaza `/mapping`) | `config.editar` |
| `DELETE /api/tiendanube/mapeos/:id` | privado | **nueva** | `config.editar` |
| `POST /api/tiendanube/sincronizar` | privado | **nueva** (reemplaza `/sync-stock`) | `config.editar` |
| `GET /api/tiendanube/corridas/ultima` | privado | **nueva** | `config.ver` |
| `GET /api/tiendanube/pedidos` | privado | **nueva** | `config.ver` |
| ~~`GET /api/tiendanube/products`~~ | — | **se borra** | — |
| ~~`POST /api/tiendanube/mapping`~~ | — | **se borra** | — |
| ~~`POST /api/tiendanube/sync-stock`~~ | — | **se borra** | — |

**No se crea ningún permiso** ([PENDIENTE N1] por defecto): `config.ver` y
`config.editar` ya existen (`seedPermissions.js:59-60`). Queda anotado en
`PROXIMOS-PROYECTOS.md` que si alguien quiere que el encargado de depósito
sincronice sin ver el CUIT, ahí hace falta un permiso propio.

> ⚠ **US8 escenario 5 se cumple, pero no por donde la spec supone.**
> `/callback` y `/webhook` «siguen exentos» de `checkSubscription` — y lo cierto
> es que **nunca llegan a ese middleware**: viven en el router `publico`, que
> `server.js` monta **sin** la cadena `authEmpresa`, y Express resuelve el
> primer montaje que atienda la ruta. Dejarlos en `EXEMPT_PREFIXES` es defensivo
> y no cuesta nada, pero un test que afirme «el webhook funciona con la
> suscripción vencida» **pasaría igual con la lista vacía**: no prueba lo que
> dice probar. Lo que sí hay que verificar es lo contrario —que las once rutas
> privadas **sí** queden cortadas—, y eso es el criterio 17.

**Borrar las tres rutas viejas no rompe nada**: `apps/web/src/services/api.js` no
tiene ni un helper de TiendaNube y `Settings.jsx` solo llama a `/status` y a
`/auth`. Se verificó con `grep`.

> **`GET /auth` pasa a exigir `config.editar` y no `config.ver`.** Hoy pide
> `config.ver` (`routes/tiendanube.js:47`), y no corresponde: ese endpoint
> **escribe** una fila de `tiendanube_estados_oauth` y arranca el flujo que
> termina guardando un token. Un usuario de solo lectura no puede iniciar una
> vinculación. La pantalla ya deshabilita el botón sin `config.editar` (US1
> escenario 11); esto es la mitad del servidor.

> **Orden de declaración.** `DELETE /mapeos/:id` va después de
> `POST /mapeos`, y `POST /variantes/refrescar` **antes** de cualquier
> `/variantes/:algo` que se agregue algún día: es la trampa documentada en
> `routes/sales.js:226-230` y la que la 012 anotó para un
> `GET /api/suppliers/export`.

---

## `GET /api/tiendanube/auth` — modificada, **rompe**

### Antes

```json
{ "ok": true, "url": "https://www.tiendanube.com/apps/1234/authorize" }
```

**Sin `state`.** El callback lo exige y redirige a `?motivo=sin_empresa`: el
circuito **nunca se pudo completar**.

### Ahora

Crea una fila en `tiendanube_estados_oauth` con 32 bytes aleatorios, la empresa
y el usuario de la sesión, y vencimiento a 15 minutos.

```json
{ "ok": true, "url": "https://www.tiendanube.com/apps/1234/authorize?state=9f3c…" }
```

| Código | Cuándo | Cuerpo |
|---|---|---|
| `200` | Normal | arriba |
| `409` | Ya hay una tienda vinculada a esta empresa | `ErrorDeNegocio`: «Ya tenés una tienda vinculada. Desvinculala antes de conectar otra.» |
| `500` | Falta `TIENDANUBE_CLIENT_ID` | `{ ok: false, error: 'TIENDANUBE_CLIENT_ID no configurado en el servidor.' }` — **se conserva tal cual**: es el cuarto estado de FR-006 y ya estaba bien |

**El 409 es nuevo y es deliberado.** Hoy `Setting.upsert` pisa el token en
silencio (`tiendanubeService.js:22-31`), que es el primer caso de borde de la
spec. Volver a vincular la misma tienda o vincular otra pasa por desvincular
primero, que es donde el `ConfirmDialog` puede decir qué se pierde.

**Dos pestañas iniciando el OAuth a la vez** producen dos filas de `state`, las
dos válidas. La primera que vuelva gana; la otra queda sin consumir y la barre el
cron. Es el caso de borde de la spec y no rompe nada.

---

## `GET /api/tiendanube/callback` — modificada

Público. TiendaNube redirige el navegador del usuario acá.

```
GET /api/tiendanube/callback?code=abc123&state=9f3c…
```

| Camino | Redirige a | Por qué |
|---|---|---|
| Sin `code` | `{FRONTEND_URL}/tiendanube?estado=error&motivo=sin_codigo` | FR-003: distinguible del siguiente |
| `state` ausente, desconocido, vencido o ya usado | `…?estado=error&motivo=state_invalido` | **Los cuatro casos dan el mismo motivo al usuario**, igual que `findScoped` responde 404 sin distinguir «no existe» de «no es tuyo». **En el log sí se distingue cuál de los cuatro fue** |
| La tienda ya está vinculada a **otra** empresa | `…?estado=error&motivo=tienda_ocupada` | Es FR-036 llegando desde el choque del `UNIQUE`, no desde una comprobación en el handler |
| El canje del `code` falla | `…?estado=error&motivo=tiendanube` | Es un problema del otro lado |
| La empresa no tiene ninguna sucursal | `…?estado=error&motivo=sin_sucursal` | `sucursalPorDefecto` tira `ErrorDeNegocio`. No se puede designar una sucursal que no existe |
| Todo bien | `…?estado=ok` | |

**El destino cambia de `/settings` a `/tiendanube`.** Hoy va a `/settings`, que
redirige a `/facturacion` (`App.jsx:299`), donde vive la tarjeta que este hito
saca.

**El consumo del `state` es un `UPDATE … RETURNING` y no un `findOne` + `update`**
(decisión 2): dos callbacks con el mismo `state` —el usuario recarga la pestaña—
canjearían el `code` dos veces.

**El token no aparece en la redirección de ninguna forma.** Ni entero, ni
truncado, ni en un fragmento. FR-075.

---

## `GET /api/tiendanube/status` — modificada, **rompe**

### Antes

```json
{ "ok": true, "linked": true }
```

Un booleano. Y si la llamada falla, `Settings.jsx:78` hace `console.error` y la
tarjeta dice «no vinculada» aunque lo esté.

### Ahora

```json
{
  "ok": true,
  "estado": "vinculada",
  "tienda": {
    "tiendanube_user_id": 4455667,
    "nombre": "Comprafit Suplementos",
    "vinculada_en": "2026-08-06T14:02:11.000Z",
    "punto_de_venta": { "id": 3, "name": "Depósito Mayo", "code": "mayo" },
    "ultima_comunicacion_en": "2026-08-12T09:31:00.000Z",
    "ultima_comunicacion_ok": true,
    "catalogo_refrescado_en": "2026-08-12T09:31:00.000Z",
    "reconciliada_en": "2026-08-12T04:00:12.000Z",
    "sincronizando": false
  },
  "variantes": { "total": 214, "mapeadas": 87, "pendientes": 2, "con_error": 0 },
  "pedidos_con_items_sin_descontar": 1
}
```

**`estado` es uno de cuatro** (FR-006), y lo decide el servidor:

| `estado` | Cuándo | `tienda` |
|---|---|---|
| `sin_configurar` | Falta `TIENDANUBE_CLIENT_ID` en el servidor | `null` |
| `no_vinculada` | No hay fila en `tiendanube_tiendas` | `null` |
| `vinculada` | Hay fila y `ultima_comunicacion_ok` no es `false` | el objeto |
| `vinculada_con_error` | Hay fila y la última comunicación falló | el objeto, con `ultimo_error` |

**Un fallo de este endpoint NO es «no vinculada»** (FR-006, US1 escenario 10). Es
un 500 con `fallo()`, y la pantalla lo dibuja como «no pudimos comprobar el
estado», que es un quinto estado **de la pantalla** y no del contrato.

**`variantes` y `pedidos_con_items_sin_descontar` son FR-058 y FR-027.** Salen de
dos `count` con `where` sobre índices, no de traer filas.

**El token no sale de ninguna forma** (FR-075, US1 escenario 7): ni entero, ni
truncado, ni «los últimos cuatro». Hay un test que busca la cadena del token en
la respuesta de **todos** los endpoints.

---

## `PUT /api/tiendanube/sucursal` — nueva

La sucursal designada: de ahí sale lo que se publica y ahí se descuenta el
pedido. Decisión 4.

```json
{ "punto_de_venta_id": 3 }
```

Se resuelve con `findScoped(PuntoDeVenta, …, req.empresaId)`: un id de otra
empresa **no resuelve**.

```json
{ "ok": true, "punto_de_venta": { "id": 3, "name": "Depósito Mayo" }, "encoladas": 87 }
```

| Código | Cuándo |
|---|---|
| `200` | Cambiada. `encoladas` es cuántas variantes mapeadas se marcaron para volver a empujar |
| `400` | `punto_de_venta_id` ausente o no entero |
| `404` | El punto de venta no existe **o es de otra empresa** |
| `409` | No hay tienda vinculada |

**`encoladas` no es informativo, es el contrato.** Cambiar la sucursal mueve
todos los números publicados; si el `PUT` no encolara, la tienda seguiría
publicando el stock de la sucursal vieja hasta el próximo movimiento de cada
producto — el defecto de hoy con una demora encima. La pantalla usa ese número en
el `ConfirmDialog`, **antes** de confirmar.

---

## `DELETE /api/tiendanube/vinculacion` — nueva

FR-005. Borra la fila de `tiendanube_tiendas` y la fila de `settings` del token.

```json
{ "ok": true, "mapeos_conservados": 87 }
```

**Los mapeos NO se borran** ([PENDIENTE N9] por defecto), y la respuesta lo dice
para que la pantalla lo pueda repetir en la confirmación. Volver a vincular **la
misma** tienda los encuentra intactos; vincular **otra** los deja apuntando a
variantes que ya no existen, y eso la pantalla lo muestra: después del primer
refresco, esas variantes tienen `vista_en` anterior al refresco.

**La instantánea `tiendanube_variantes` sí se borra**: es una copia de un
catálogo al que ya no tenemos acceso, y dejarla sería mostrar como actual algo
que no se puede volver a pedir.

| Código | Cuándo |
|---|---|
| `200` | Desvinculada |
| `404` | No había tienda vinculada |

---

## `POST /api/tiendanube/webhook` — modificada

Público, sin sesión. Se autentica con la **firma HMAC-SHA256 sobre el cuerpo
crudo**, en la cabecera `x-linkedstore-hmac-sha256`, comparada con
`timingSafeEqual` y chequeo de longitud previo. `firmaValida`
(`controllers/tiendanube.js:69-84`) **se conserva tal cual**: está bien escrita.
Lo que cambia es que ahora **le llega el cuerpo crudo** (decisión 5).

| Respuesta | Cuándo | Por qué |
|---|---|---|
| `401 firma invalida` | La firma no valida | **Es el único camino que no responde 200.** Un webhook que no se puede autenticar no es un webhook |
| `200 OK` | **Todos los demás caminos**, incluido el error interno | FR-023: TiendaNube reintenta y **deshabilita el webhook** ante errores repetidos. Es lo que dice el comentario de `:104-105` y lo que el código de hoy contradice respondiendo 401 siempre |

**El rechazo por firma pasa a loguear cuál de las tres cosas faltó** —el secreto
del servidor, la cabecera o el cuerpo crudo—, porque hoy un despliegue sin
`TIENDANUBE_CLIENT_SECRET` y un intento de suplantación producen exactamente el
mismo `logger.warn`. Riesgo 10 del plan.

**Solo se procesa `order/paid`** (supuesto 6, FR-024). `order/created` descontaba
dos veces por la misma venta y no se reabre. `order/cancelled` no se escucha
([PENDIENTE N5]) y **la pantalla lo advierte**.

### Lo que hace, en orden

```
1. firmaValida(req)                              → 401 si no
2. evento === 'order/paid'                       → 200 si no
3. tienda = TiendanubeTienda.findOne({ tiendanube_user_id: body.store_id })
                                                 → 200 + log si no hay
4. transaction:
     a. TiendanubePedido.create({ empresa_id, tiendanube_order_id, … })
        ← SI CHOCA CONTRA EL UNIQUE: ya procesado, no se toca nada, 200
     b. sucursal = resolverSucursal({ empresaId, puntoDeVentaId: tienda.punto_de_venta_id })
     c. por cada ítem: mapeo → Stock.findOne({ … , lock: t.LOCK.UPDATE })
                       → update de quantity Y available
                       → StockMovement.create({ tipo: 'tiendanube_sale', referencia_id: `tn_order_${id}` })
                       → si no hay mapeo o no hay fila de stock: se anota en pedido.items
     d. commit
5. 200
```

**El paso 4a va primero y es toda la idempotencia** (FR-026, decisión 6). Es la
misma forma que `POST /api/sales`: el `INSERT` y su
`SequelizeUniqueConstraintError`, no un `findOne` previo. Un `findOne` **no es
atómico** y dos entregas en paralelo lo pasan las dos.

**El `Stock.findOne` lleva `lock: t.LOCK.UPDATE` y NO lleva `include`.** Si
alguna vez hiciera falta un `include`, la forma es `lock: { level, of: Modelo }`:
con `lock` a secas Sequelize lo traduce a un `LEFT OUTER JOIN` y Postgres no
admite `FOR UPDATE` sobre el lado externo — es el 500 que produciría la
«mitigación de una línea» anotada para el hito 6.

**FR-025, atómico:** si el tercer ítem falla, se revierte todo **incluida la fila
del pedido**, así que el reintento de TiendaNube vuelve a entrar por el camino
normal. Hoy quedan los dos primeros descontados para siempre y el reintento
contesta «pedido ya procesado».

**FR-027, lo que no descontó:** cada ítem que no se pudo descontar queda en
`pedido.items` con su motivo (`sin_mapeo`, `sin_stock_en_sucursal`,
`sin_variante`, `cantidad_cero`) y suma a `items_sin_descontar`, que es lo que
`GET /pedidos` lista y la pantalla muestra. Hoy es un `continue`
(`tiendanubeService.js:129,134,144`).

**El webhook queda fuera del rate limiter** (FR-029), como consecuencia del
movimiento del montaje: las IP de TiendaNube no son las de nadie sentado en una
caja, y un 429 al webhook es un pedido que no descuenta.

**Y el descuento encola la variante**, por el hook de `Stock` (decisión 8a): un
pedido baja el stock local y el número nuevo sale hacia la tienda en el mismo
proceso, sin esperar a ninguna corrida.

---

## `GET /api/tiendanube/variantes` — nueva (reemplaza `GET /products`)

### Antes

`GET /api/tiendanube/products` pasaba a través la respuesta cruda de TiendaNube.
**Una sola página**, sin `page` ni `per_page`, descartando las cabeceras que
dicen cuántas hay. Una tienda con más de una página mostraba los primeros
productos y **nada avisaba**.

### Ahora

Lee **la instantánea local** (`tiendanube_variantes`), que el refresco llenó con
todas las páginas. Ajuste 2 del plan: buscar y filtrar sobre lo que no se pidió
es imposible, y filtrar sobre la página que llegó es el mismo defecto con otro
nombre.

```
GET /api/tiendanube/variantes?q=colageno&sin_mapear=true&page=1&limit=50
```

| Parámetro | Tipo | Por defecto | Qué hace |
|---|---|---|---|
| `q` | string | — | Nombre de producto, nombre de variante **o SKU**, sin distinguir mayúsculas ni acentos (FR-059) |
| `sin_mapear` | `true` \| `false` | — | Solo las que no tienen mapeo (FR-059) |
| `page` | entero ≥ 1 | `1` | 1-indexado, como `components/Pagination.jsx` |
| `limit` | entero 1-200 | `50` | Fuera de rango se **recorta**, no se rechaza |

```json
{
  "ok": true,
  "total": 214,
  "refrescado_en": "2026-08-12T09:31:00.000Z",
  "data": [
    {
      "tiendanube_variant_id": 998877,
      "tiendanube_product_id": 5544,
      "nombre_producto": "Colágeno hidrolizado",
      "nombre_variante": "300 g",
      "sku": "COL-300",
      "stock_en_tienda": 7,
      "en_la_tienda": true,
      "mapeo": { "id": 12, "product_id": 41, "product_name": "Colágeno 300g", "sku": "COL-300" },
      "disponible": 7,
      "motivo_no_publicado": null,
      "stock_publicado": 7,
      "publicado_en": "2026-08-12T09:31:04.000Z",
      "pendiente_desde": null,
      "ultimo_error": null
    }
  ]
}
```

| Campo | Qué significa |
|---|---|
| `en_la_tienda` | `vista_en >= tienda.catalogo_refrescado_en`. `false` = **la variante ya no existe en TiendaNube** y el mapeo quedó colgado |
| `mapeo` | `null` si no hay. **Si el producto del sistema se borró, el mapeo desaparece solo** por el `ON DELETE CASCADE`, así que acá nunca hay un mapeo roto (US3 escenario 11) |
| `disponible` | `stock.available` de la **sucursal designada**. `null` si no hay fila |
| `motivo_no_publicado` | `sin_stock_en_sucursal` cuando no hay fila. **No se publica cero** (FR-046) |
| `stock_publicado` | Lo último que se mandó con éxito. Distinto de `disponible` = está desfasada |

**`refrescado_en` va en la respuesta, no solo en `/status`.** Una instantánea sin
fecha a la vista es una mentira con horario.

**Ninguna consulta usa `include`**: se traen las variantes de la página, después
los mapeos de esas variantes y después los productos de esos mapeos, y se unen en
JS. Es el mismo corte que la decisión 4 del plan de la 012, y es lo que deja el
ancla de `analizarIncludes` en `toBe(4)`.

| Código | Cuándo |
|---|---|
| `200` | Normal. `data: []` con `total: 0` si la tienda no tiene productos, y **la pantalla distingue eso del filtro sin resultados** por `q`/`sin_mapear` |
| `409` | No hay tienda vinculada |

---

## `POST /api/tiendanube/variantes/refrescar` — nueva

Trae **todas** las páginas del catálogo de TiendaNube y reescribe la instantánea.
FR-057.

```json
{ "ok": true, "variantes": 214, "nuevas": 3, "desaparecidas": 1, "paginas": 5 }
```

- Recorre `GET /v1/{user_id}/products?page=N&per_page=200` hasta que una página
  vuelva vacía o corta. **Con `timeout` y con reintento ante 429** (FR-047,
  FR-048).
- Cada variante se escribe con `upsert` sobre `(empresa_id,
  tiendanube_variant_id)` y `vista_en = NOW()`.
- **Las que no se vieron no se borran**: quedan con `vista_en` viejo y salen con
  `en_la_tienda: false`. Borrarlas se llevaría el registro de lo que se publicó y
  dejaría al mapeo apuntando a la nada sin explicación.
- Actualiza `tienda.catalogo_refrescado_en`.

| Código | Cuándo |
|---|---|
| `200` | Refrescado |
| `409` | No hay tienda vinculada, **o** hay un refresco/sincronización en curso (el arriendo de FR-044) |
| `401→400` | El token de TiendaNube ya no vale: `ErrorDeNegocio` «Tu tienda desconectó Favalio. Hay que volver a vincularla.» y la tienda queda en `vinculada_con_error` (FR-049) |
| `502` | TiendaNube no contesta o contesta 5xx, con el texto que lo distingue de un error de Favalio (FR-062) |

---

## `GET /api/tiendanube/mapeos` — nueva

FR-033. **Hoy no existe, y sin esto la pantalla de mapeo no se puede dibujar.**

```
GET /api/tiendanube/mapeos?page=1&limit=50
```

```json
{
  "ok": true,
  "total": 87,
  "data": [
    {
      "id": 12,
      "product_id": 41,
      "product_name": "Colágeno 300g",
      "product_sku": "COL-300",
      "product_activo": true,
      "tiendanube_variant_id": 998877,
      "tiendanube_product_id": 5544,
      "nombre_variante": "Colágeno hidrolizado · 300 g",
      "en_la_tienda": true
    }
  ]
}
```

Acotado a `empresa_id` siempre: **la empresa B no ve ninguno de la A** (FR-038,
US4 escenario 2). Es un `where` con `scoped()`, y lo verifica el cuarto nivel
—una guardia estática ve que se llamó, no que la fila ajena haya quedado afuera—.

---

## `POST /api/tiendanube/mapeos` — nueva (reemplaza `POST /mapping`)

### Antes

```js
// controllers/tiendanube.js:157-164
const { product_id, tiendanube_variant_id, tiendanube_product_id } = req.body;
const mapping = await TiendanubeMapping.create({
  empresa_id: req.empresaId,
  product_id,                    // ← nadie verificó de quién es este producto
  …
});
```

Un `product_id` de otra empresa devolvía **201**. Y un choque de índice único
—«ese producto ya está mapeado»— devolvía **500 genérico** (`:169`).

### Ahora

```json
{ "product_id": 41, "tiendanube_variant_id": 998877, "tiendanube_product_id": 5544 }
```

```
1. Los tres ids tienen que ser enteros                      → 400 si no (FR-031)
2. producto = await findScoped(Product, product_id, req.empresaId)
                                                            → 404 si no (FR-030)
3. La variante tiene que estar en la instantánea            → 400 si no
4. TiendanubeMapping.create({ empresa_id, product_id: producto.id, … })
     ← SequelizeUniqueConstraintError → 409 con el mensaje que nombra el choque
```

| Código | Cuerpo | Cuándo |
|---|---|---|
| `201` | `{ ok: true, data: { … } }` | Creado |
| `400` | `ErrorDeNegocio` | Algún id no es entero (FR-031), o la variante no está en el catálogo refrescado |
| `404` | «Recurso no encontrado» | El `product_id` **no existe o es de otra empresa**. **Verificable contra hoy, donde responde 201** (criterio 6) |
| `409` | «"Colágeno 300g" ya está mapeado a la variante "Colágeno hidrolizado · 300 g".» | Choque de `uq_tn_mapping_product` (US3 escenario 8) |
| `409` | «Esa variante ya está mapeada a "Creatina 300g".» | Choque de `uq_tn_mapping_variant` (US3 escenario 9) |

**Los dos mensajes de 409 nombran con qué choca**, y para eso el handler relee el
mapeo existente después del choque. FR-032. Un 409 que dice «ya existe» sin decir
cuál obliga a buscarlo a mano.

**El `create` va con `product_id: producto.id` y no con `req.body.product_id`.**
Es la misma forma que `dfd7009` dejó en `routes/suppliers.js`, y es lo que hace
que `analizarCreates` lo dé por validado. El paso 2 tiene que estar **antes** y
en la misma función.

**La relación sigue siendo uno a uno en los dos sentidos** (FR-035, [PENDIENTE
N4]): los dos índices únicos se conservan. Un producto que fuera dos variantes
publicaría el mismo stock dos veces y la tienda podría vender el doble.

**No hay mapeo masivo por SKU** ([PENDIENTE N3]): la sugerencia viene en
`GET /variantes` y **hay que confirmarla**. Dos productos con el mismo SKU no son
imposibles en este catálogo, y `sugerirPorSku` devuelve **cuántos coincidieron**
para que la pantalla pueda decir «hay dos» en vez de elegir uno.

---

## `DELETE /api/tiendanube/mapeos/:id` — nueva

FR-034. Hoy un mapeo equivocado solo se corrige entrando a la base.

```
DELETE /api/tiendanube/mapeos/12
```

Se resuelve con `findScoped(TiendanubeMapping, req.params.id, req.empresaId)`.

| Código | Cuándo |
|---|---|
| `200` | `{ ok: true }`. La variante vuelve a «Sin mapear» y **sale de la cola** |
| `404` | No existe **o es de otra empresa**, y **la fila de la otra empresa queda como estaba** (US4 escenario 3, verificado en integración) |

---

## `POST /api/tiendanube/sincronizar` — nueva (reemplaza `POST /sync-stock`)

### Antes

```js
// controllers/tiendanube.js:183-192
const stockEntries = await Stock.findAll({ where: { empresa_id } });
for (const stock of stockEntries) {
  const mapping = mappings.find((m) => m.product_id === stock.product_id);
  if (!mapping) continue;
  await tiendanubeService.updateVariantStock(empresaId, mapping.tiendanube_variant_id, stock.quantity);
}
```

Un PUT **por fila de stock**: con tres sucursales, tres PUT a la misma variante
con tres números distintos y **gana el último**, en el orden que devuelva la
consulta. Ante el primer fallo, `catch` → 502 y el conteo se pierde. Y manda
`quantity`, no `available`.

### Ahora

```json
{ "ok": true, "corrida_id": 91, "mandadas": 84, "fallidas": 3 }
```

```
1. Arriendo: UPDATE tiendanube_tiendas SET sincronizando_desde = NOW()
             WHERE empresa_id = $1 AND (sincronizando_desde IS NULL
                                        OR sincronizando_desde < NOW() - INTERVAL '10 minutes')
   → 0 filas = 409 «Ya hay una sincronización en curso»                      (FR-044)
2. Una fila de tiendanube_corridas con disparador 'manual' y usuario_id
3. Por cada mapeo de la empresa, EXACTAMENTE UN PUT:                          (FR-040)
     disponible = stock.available de la SUCURSAL DESIGNADA                    (decisión 2 y 4)
     sin fila de stock → NO se manda, se anota motivo_no_publicado            (FR-046)
     el PUT falla     → se anota en fallas y SE SIGUE                         (FR-041)
     429              → se espera y se reintenta, sin perder el resto         (FR-048)
     401              → se corta, se marca vinculada_con_error                (FR-049)
4. terminada_en, mandadas, fallidas, fallas; se suelta el arriendo
```

| Código | Cuándo |
|---|---|
| `200` | Terminó. **Incluso con fallas**: el resultado dice cuántas y cuáles |
| `409` | Hay una corriendo (FR-044), o no hay tienda vinculada |
| `400` | No hay ningún mapeo: `ErrorDeNegocio` «No hay ningún producto mapeado» y **no se manda ninguna llamada** (US5 escenario 9) |
| `400` | 401 de TiendaNube: «Hay que volver a vincular» (FR-049) |

**El 200 con fallas es el contrato, no un descuido.** Hoy la primera variante que
falla se lleva el conteo y el usuario no sabe cuántas entraron ni cuáles faltan
(FR-041, US5 escenario 4).

**Repetir la corrida es seguro** (FR-045): el PUT manda el número absoluto, no un
delta. Lo que quedó escrito del lado de TiendaNube son las variantes que ya se
mandaron y ninguna otra.

**Un producto mapeado que está inactivo se publica igual** ([PENDIENTE N10]) y la
respuesta lo marca, para que la pantalla pueda señalar la fila. Publicar cero por
estar inactivo agota una variante que la tienda podría estar vendiendo.

---

## `GET /api/tiendanube/corridas/ultima` — nueva

FR-042 y FR-043. **Hoy esto no existe en ningún lado**: ni tabla, ni setting, ni
log del que se pueda leer, y el pedido de la sección 4.10 lo nombra
explícitamente.

```json
{
  "ok": true,
  "corrida": {
    "id": 91,
    "empezada_en": "2026-08-12T09:31:00.000Z",
    "terminada_en": "2026-08-12T09:31:47.000Z",
    "disparador": "manual",
    "usuario_id": "auth0|abc",
    "mandadas": 84,
    "fallidas": 3,
    "fallas": [
      { "variante": 998877, "sku": "COL-300", "motivo": "La variante ya no existe en tu tienda" }
    ]
  },
  "cola": { "pendientes": 2, "con_error": 1, "mas_vieja": "2026-08-12T09:44:10.000Z" }
}
```

**Sobrevive un reinicio del servidor** (FR-043, criterio 12): es una fila.

**`fallas` trae solo las que fallaron** ([PENDIENTE N2]). Con un catálogo grande,
las que salieron bien son cientos de filas que nadie lee.

**`cola` es la otra mitad, y es la que contesta el disparador de la decisión 4**
(ajuste 4 del plan). El empujón por movimiento no escribe corridas —serían
cientos de filas diarias que crecen sin tope— y su estado vive en la fila de la
variante. `cola` lo resume, y es **más útil** que un registro de lotes: dice qué
está desfasado **ahora**.

`corrida: null` si nunca corrió ninguna. La pantalla lo distingue de «corrió y no
mandó nada».

---

## `GET /api/tiendanube/pedidos` — nueva

FR-027 y criterio 5: **un ítem que no descontó se puede ver desde la pantalla**.
Hoy se saltea en silencio y lo único que queda es que el inventario está mal.

```
GET /api/tiendanube/pedidos?solo_con_problemas=true&page=1&limit=25
```

```json
{
  "ok": true,
  "total": 3,
  "data": [
    {
      "id": 5,
      "tiendanube_order_id": 3344556,
      "numero": "1043",
      "recibido_en": "2026-08-12T11:02:00.000Z",
      "items_descontados": 3,
      "items_sin_descontar": 1,
      "items": [
        { "variante": 111222, "cantidad": 2, "product_id": 41, "descontado": true,  "motivo": null },
        { "variante": 333444, "cantidad": 1, "product_id": null, "descontado": false, "motivo": "sin_mapeo" }
      ]
    }
  ]
}
```

Los cuatro motivos: `sin_mapeo`, `sin_stock_en_sucursal`, `sin_variante`,
`cantidad_cero`. Los cuatro son casos de borde escritos en la spec y los cuatro
se saltean hoy con un `continue`.

`solo_con_problemas=true` usa el índice parcial
`idx_tn_pedidos_pendientes`: es la única lectura frecuente de esa tabla.

---

## `POST /api/tareas/ejecutar` — **modificada** (aditiva)

`server.js:219-236`. Ya existe, se protege con `x-cron-secret`, y sin
`CRON_SECRET` configurado responde 404 para que no quede una ruta abierta por
olvido. **No cambia nada de eso.**

Gana tres tareas más, para **cada tienda vinculada**:

| Tarea | Qué hace |
|---|---|
| **Reconciliación** | Refresca la instantánea y encola **solo lo que difiere** entre `stock.available` de la sucursal designada, `stock_publicado` y `stock_en_tienda`. Escribe su fila de `tiendanube_corridas` con `disparador: 'reconciliacion'` y actualiza `tienda.reconciliada_en` |
| **Barrido de `state`** | `DELETE FROM tiendanube_estados_oauth WHERE expira_en < NOW() - INTERVAL '1 day'` |
| **Barrido de corridas** | Borra las de más de 90 días. **No toca `tiendanube_pedidos`**: un pedido borrado es un pedido que se puede volver a descontar |

```json
{ "ok": true, "expirados": 0, "avisos": 2,
  "tiendanube": { "tiendas": 1, "encoladas": 4, "estados_barridos": 12, "corridas_barridas": 0 } }
```

⚠ **Este cron hoy falla todos los días**: faltan `API_URL` y `CRON_SECRET`
(`.github/workflows/tareas-diarias.yml:50-51`, `docs/OPERACION.md:17`). Por eso
`GET /status` devuelve `reconciliada_en` y la pantalla lo muestra con su tono: la
ausencia de la red tiene que **verse**, no suponerse. Es el paso manual P4 y el
riesgo 4 del plan.

**Comparar contra los tres números no cuesta llamadas extra**: el refresco del
catálogo hay que hacerlo igual (FR-057), y con la respuesta en la mano la
comparación es local. Atrapa dos fallas distintas: el empujón que se perdió, y el
número que alguien cambió a mano en el panel de TiendaNube.

---

## Errores, en todos los endpoints

**Ningún handler arma la respuesta a mano.** Hoy el controlador lo hace en cinco
lugares (`:13`, `:59`, `:151`, `:169`, `:197`) y ninguno deja el `requestId` con
el que se encuentra la línea en los logs de Render (`OPERACION.md:78`).

| Situación | Cómo se responde |
|---|---|
| Error del servidor | `fallo(req, res, err, 'mensaje en castellano')` → 500 con `requestId`, sin nombres de tabla ni de constraint (FR-063) |
| Condición prevista | `throw new ErrorDeNegocio(mensaje, 400 \| 404 \| 409)`; `fallo` responde **su** status y **su** mensaje (`errores.js:60-73`) |
| Recurso ajeno | **404**, nunca 403: un 403 confirma que existe en otra empresa y permite enumerar ids |
| Error de TiendaNube | `ErrorDeNegocio` con el texto que lo distingue de un error de Favalio (FR-062), clasificado por `errorDeTiendanube` (decisión 11) |

**Ningún camino usa `console.error`** (FR-060). El de hoy —
`tiendanubeService.js:35`, con `error.response?.data`— es el **único** lugar
donde el material sensible de esta integración podía llegar a un log, y es
justamente el que esquiva la redacción de `logger.js:63-67` y la de
`sentry.js:55`. Hay una guardia estática que lo vigila para todo `routes/`,
`services/` y `utils/`.

**Ninguna respuesta contiene el token** (FR-075, FR-076): ni entera, ni truncada,
ni «los últimos cuatro». Hay un test que busca la cadena del token en la
respuesta de los catorce endpoints.
