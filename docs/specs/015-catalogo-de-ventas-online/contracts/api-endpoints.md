# Contratos de API: Catálogo de ventas online

**Plan**: [../plan.md](../plan.md) · **Modelo de datos**: [../data-model.md](../data-model.md)

Tres superficies con reglas distintas, y esta separación es el punto:

| Superficie | Prefijo | Sesión | Permiso | Suscripción | Límite |
|---|---|---|---|---|---|
| **Pública (JSON)** | `/api/publico` | **Ninguna** | **Ninguno** | Dentro del handler | `limitadorPublico` (IP + slug). **Exenta del global** |
| **Pública (HTML)** | `/c` | **Ninguna** | **Ninguno** | Dentro del handler | `limitadorPublico`. No cuelga de `/api`, así que el global nunca la vio |
| **Privada** | `/api/catalogos`, `/api/pedidos` | `authEmpresa` | `checkPermission` | `checkSubscription` | El global de `server.js:319` |

---

## Las reglas que valen para TODA la superficie pública

Antes de los endpoints, porque cada uno las hereda y no se repiten abajo.

1. **La empresa sale del slug y de ningún otro lado.** `X-Empresa-Id`,
   `Authorization` y `X-Sesion-Id` **se ignoran por completo** si vienen
   (FR-102). El router no tiene cadena de autenticación, así que ni siquiera se
   leen.
2. **Toda respuesta se arma con lista blanca explícita** (`utils/vistaPublica.js`).
   Ninguna lleva `cost`, `margin_override`, `wholesale_margin`,
   `wholesale_price`, `supplier_id`, `barcode`, `is_active`, `publicable`,
   `empresa_id` ni `punto_de_venta_id` (FR-096).
3. **Ningún id interno viaja.** El `id` de un producto **sí** viaja —es lo que la
   tienda manda de vuelta en el pedido— pero es el `products.id` scopeado, y un
   id de otra empresa da 404 sin decir si existía. El `id` del pedido, el del
   catálogo y el de la regla **no viajan nunca**.
4. **404 y 404 son indistinguibles.** Un slug inexistente, un catálogo en
   borrador y un producto de otra empresa devuelven **el mismo cuerpo**:
   `{ ok: false, error: 'NO_ENCONTRADO' }` (FR-055, criterio 8).
5. **Ningún `catch` responde con `err.message`.** Todos usan
   `fallo(req, res, err, '…')`: el mensaje que llega es genérico y en castellano,
   y el detalle queda en el log con su `requestId` (FR-101). En el público hay un
   motivo extra: `err.message` de Sequelize nombra tablas y restricciones, y acá
   el que lee es cualquiera.
6. **Todo importe es un número entero de pesos**, ya redondeado por el servidor.
   La tienda **no calcula precios** (H2): los formatea.
7. **La visita se cuenta una vez por apertura**, en `GET /api/publico/c/:slug` y
   en `GET /c/:slug`, no en cada endpoint. Un `INSERT … ON CONFLICT DO UPDATE`
   sobre `(catalogo_id, fecha, origen, estado_catalogo)`.

### El estado del catálogo, que gobierna todo lo demás

`GET /api/publico/c/:slug` **siempre** devuelve un campo `estado`, y es de donde
sale qué pantalla dibuja la tienda:

| `estado` | Cuándo | Qué trae el cuerpo | HTTP |
|---|---|---|---|
| `publicado` | Todo bien | Marca, entrega, pagos, categorías y productos | 200 |
| `pausado` | El comercio lo pausó | **Solo** nombre, descripción, logo, portada, color y WhatsApp. **Sin productos ni precios** (FR-056) | 200 |
| `no_disponible` | Suscripción vencida y gracia agotada, o sin fila de suscripción | Lo mismo que `pausado`, **menos el WhatsApp** | 200 |
| — | Borrador, o el slug no existe | `{ ok: false, error: 'NO_ENCONTRADO' }` | **404** |
| — | Error de base al consultar la suscripción | `{ ok: false, error: 'NO_DISPONIBLE_POR_UN_MOMENTO' }` | **503** |

Dos cosas que no son obvias:

- **`no_disponible` responde 200 y no 402.** El 402 es un contrato entre la API y
  `apps/web`, que lo intercepta y muestra el aviso de renovación
  (`services/api.js:171-177`). Acá el que lee no es el moroso: es un socio del
  gimnasio, y el mensaje del 402 le contaría que el comercio está en mora. La
  tienda dibuja un estado neutro con **el mismo camino** que dibuja `pausado`.
- **El error de base responde 503 y no 402** (FR-112a): 402 afirmaría que la
  suscripción venció, y lo que pasó es que **no se pudo saber**. Se cierra en vez
  de abrir, al revés que la cadena privada. El `logger.error` lleva **el slug y
  la empresa**.

---

## Público · JSON

### `GET /api/publico/c/:slug`

El único pedido que hace la tienda al abrirse. Trae **todo lo de la pantalla
inicial**, incluida la primera página de productos: es lo que mantiene una visita
en dos llamadas (una al HTML, una acá).

**Query**: `?f=<origen>` — el parámetro que codifica el QR (`qr`, `wa`,
`directo`). Cualquier otro valor cae en `otro`. **El catálogo se ve igual con el
parámetro y sin él** (US11 escenario 8).

```jsonc
// 200 · estado: publicado
{
  "ok": true,
  "estado": "publicado",
  "catalogo": {
    "nombre": "Comprafit / Fitnet",
    "descripcion": "Suplementos deportivos para socios de Fitnet",
    "logo": "/img/a3/f1/a3f1….png",
    "portada": "/img/b7/2c/b72c….jpg",
    "color_marca": "#00B4B6",
    "muestra_precio_lista": false,
    "whatsapp": "5493514567890",
    "pie": { "comercio": "Comprafit", "cuit": "30-11111111-8", "telefono": "351 456-7890" }
  },
  "entrega": {
    "retiro_socio":       { "activo": true, "direccion": "Fitnet · Av. Colón 1234" },
    "retiro_local":       { "activo": true },
    "envio":              { "activo": true, "costo": 1500, "gratis_desde": 25000 },
    "coordinar_whatsapp": { "activo": false }
  },
  "pago": {
    "transferencia": { "activo": true, "titular": "…", "cbu": "…", "alias": "…", "banco": "…" },
    "efectivo":      { "activo": true }
  },
  "formulario": { "pide_nro_socio": true, "pide_dni": false },
  "categorias": ["Proteínas", "Creatinas", "Vitaminas", "otro"],
  "productos": { "items": [ /* ver abajo */ ], "pagina": 1, "hay_mas": true, "total": 62 }
}
```

**`formulario.pide_dni` viaja siempre en `false`** mientras la puerta de FR-147a
esté cerrada, sin importar lo que diga la columna. La puerta se aplica **acá y
en el servidor del pedido**, no en el dibujo: es lo que hace que mandar `dni` en
el cuerpo no sirva de nada.

**`pago` no tiene `mp`**: `medio_pago` no tiene ese valor en el enum, así que no
hay forma de ofrecerlo ni de guardarlo.

```jsonc
// 200 · estado: pausado — nada más que esto
{
  "ok": true,
  "estado": "pausado",
  "catalogo": { "nombre": "…", "descripcion": "…", "logo": "…", "portada": "…",
                "color_marca": "#00B4B6", "whatsapp": "5493514567890",
                "pie": { … } }
}
```

**Sin `productos`, sin `entrega`, sin `pago`, sin `categorias`** (FR-056). No
están vacíos: **no están**. Un arreglo vacío invita a un componente a dibujar
una grilla sin nada; una clave ausente obliga a la tienda a tomar el otro camino.

### `GET /api/publico/c/:slug/productos`

Las páginas siguientes de la grilla. **La tienda no la llama al buscar ni al
cambiar de categoría**: filtra en el navegador sobre lo que ya tiene, y solo
pide más cuando el visitante aprieta «ver más» (FR-114 y US8 escenario 2 — «el
filtrado no dispara una llamada por tecla»).

**Query**: `?q=` (máx. 80 caracteres, parametrizado), `?categoria=`,
`?pagina=` (entero ≥ 1; negativo o gigante se acota, y una página vacía es
**200 con lista vacía**, no un error).

```jsonc
{
  "ok": true,
  "items": [
    {
      "id": 412,
      "nombre": "Whey Protein 1kg",
      "marca": "ENA",                 // ausente si el producto no tiene marca
      "categoria": "Proteínas",
      "imagen": "/img/c4/9a/c49a….jpg", // ausente si no hay foto propia
      "precio": 28600,
      "precio_lista": 32500,          // solo si muestra_precio_lista Y precio < lista
      "ahorro_pct": 12,               // idem
      "agotado": false
    }
  ],
  "pagina": 2, "hay_mas": false, "total": 62
}
```

Cuatro reglas del ítem, todas verificadas con tests de función pura:

- **`marca` ausente y no `null`.** El 96 % de los productos migrables no tiene
  marca; una clave presente con `null` es cómo se dibuja «undefined» en una
  tarjeta.
- **`imagen` ausente** cuando no hay foto **o cuando la `image_url` apunta
  afuera** (`esImagenPropia`, FR-030). La tienda dibuja el marcador neutro del
  mismo tamaño, para que la grilla no se descuadre.
- **`precio_lista` y `ahorro_pct` solo cuando los dos se cumplen**: el catálogo
  tiene el interruptor encendido **y** el precio final es **menor** que el de
  lista (FR-062). Tachar el mismo número dos veces es ruido y un «−0 %» es peor;
  y un catálogo que vende más caro que el mostrador —que se acepta— no dibuja el
  tachado al revés.
- **`agotado` sale de `available`**, no de `quantity`, y **solo del punto de
  venta del catálogo** (FR-138). Sin fila de stock → agotado, y no es un error.
  `available` negativo → agotado, y queda registrado: es un dato inconsistente
  del inventario, no del catálogo.

### `GET /api/publico/c/:slug/productos/:id`

La ficha. El mismo objeto más `descripcion` —**ausente** si está vacía, para que
la ficha no quede con un hueco— y `stock_disponible` (entero, acotado a 0),
que es lo que le permite al control de cantidad no dejar pedir más de lo que
hay.

Un `:id` de otra empresa, inexistente, negativo, enorme o no numérico: **404**,
mismo cuerpo. Es el caso que un `findByPk` haría pasar (US6 escenario 6).

### `POST /api/publico/c/:slug/pedidos`

El único endpoint público que escribe.

```jsonc
{
  "idempotency_key": "a3f1…",          // UUID que genera el navegador
  "items": [ { "product_id": 412, "cantidad": 2 } ],
  "comprador": {
    "nombre": "Martina Olivera",        // OBLIGATORIO
    "telefono": "351 456-7890",         // OBLIGATORIO
    "email": "martina@…",               // opcional
    "nro_socio": "F-2291"               // opcional, aunque el catálogo lo pida
  },
  "entrega": { "tipo": "envio", "direccion": "…", "localidad": "…", "cp": "5000" },
  "medio_pago": "transferencia",
  "notas": "Timbre 3B"
}
```

**Las líneas llevan `product_id` y `cantidad`, y nada más** (FR-130). Cualquier
`precio`, `precio_unitario`, `subtotal` o `total` que venga **se descarta antes
de entrar al handler**: `consolidarLineas()` devuelve
`[{ product_id, cantidad }]`, así que el resto del código no tiene desde dónde
leerlos. No es una validación que se pueda olvidar: no hay dato que olvidar.

**`comprador.dni` y `comprador.acepta_comunicaciones` se ignoran** mientras la
puerta de FR-147a esté cerrada, aunque vengan en el cuerpo (US15 escenario 2). La
fila queda con el DNI en `NULL` y el consentimiento en `false`, y **el pedido se
crea igual**.

**Respuesta 201** — solo lo que la pantalla de confirmación necesita (FR-152):

```jsonc
{
  "ok": true,
  "numero": 1042,                       // entero. El «#» lo pone la interfaz
  "estado": "pendiente_pago",
  "resumen": [ { "nombre": "Whey Protein 1kg", "cantidad": 2,
                 "precio_unitario": 28600, "subtotal": 57200 } ],
  "subtotal": 57200, "envio_costo": 0, "total": 57200,
  "entrega": "envio", "medio_pago": "transferencia",
  "whatsapp_url": "https://wa.me/5493514567890?text=…",
  "email_enviado": true
}
```

**Ningún id**: ni del pedido, ni del catálogo, ni de la empresa, ni del punto de
venta. **`email_enviado` es lo que hace verificable FR-182**: la pantalla no
puede decir «te mandamos el detalle por email» si el servidor no confirmó que
salió. Es `false` cuando `sendEmail` devolvió `ok: false` **y** cuando el
comprador no dejó email.

#### Los códigos de error, y qué dibuja cada uno

| HTTP | `error` | Cuándo | Qué dibuja la tienda |
|---|---|---|---|
| 200 | — | El pedido ya existía con esa `idempotency_key` | **El mismo cuerpo** que la primera vez. El botón apretado dos veces no crea dos pedidos (FR-136) |
| 400 | `ITEMS_INVALIDOS` | Cantidad ≤ 0, no entera, mayor que 999, o **cero líneas** | El carrito, con el motivo |
| 400 | `FALTAN_DATOS` | Sin nombre o sin teléfono; sin dirección con `entrega = 'envio'`; email mal escrito | El paso del checkout que corresponde, con el campo señalado |
| 400 | `ENTREGA_NO_DISPONIBLE` | La opción no está encendida en el catálogo (FR-141), o «efectivo al retirar» con envío a domicilio (FR-142) | El paso 2, con las opciones que sí hay |
| 404 | `NO_ENCONTRADO` | Un `product_id` de **otra empresa**, inexistente, no publicable, inactivo, sin precio resoluble, o **que no está en este catálogo**. **No queda ninguna fila** (FR-132) | El carrito, con «uno de los productos ya no está disponible» |
| **409** | **`STOCK_INSUFICIENTE`** | Alguna línea se agotó o se recortó entre el carrito y el envío | **La pantalla «se agotó mientras compraba»** (`:586-624`), con las líneas **tachadas** arriba del total nuevo |
| **409** | **`SIN_LINEAS_DISPONIBLES`** | **Todas** las líneas se agotaron. **No se crea ningún pedido** (FR-139) | El carrito vacío con el aviso |
| 409 | `CATALOGO_NO_DISPONIBLE` | El catálogo está pausado, en borrador, o la empresa vencida | El estado neutro |
| 429 | `DEMASIADAS_PETICIONES` | El limitador propio | El estado que invita a reintentar, no una pantalla en blanco (US10 escenario 10) |
| 503 | `NO_DISPONIBLE_POR_UN_MOMENTO` | Error al consultar la suscripción (FR-112a) | «No disponible por un momento, reintentá» |

El cuerpo del **409 `STOCK_INSUFICIENTE`** lleva lo que la pantalla necesita
para explicar el cambio de importe, que es el punto entero de la decisión 6a:

```jsonc
{
  "ok": false, "error": "STOCK_INSUFICIENTE",
  "lineas": [
    { "nombre": "Creatina 300g", "pedida": 5, "disponible": 2, "accion": "recortada" },
    { "nombre": "BCAA 200g",     "pedida": 1, "disponible": 0, "accion": "quitada" }
  ],
  "subtotal": 41200, "envio_costo": 1500, "total": 42700,
  "reintentar_con": [ { "product_id": 412, "cantidad": 2 } ]
}
```

**`reintentar_con` es el cuerpo exacto** que la tienda vuelve a mandar cuando el
comprador aprieta «Seguir con el resto». Sin él, la tienda tendría que
reconstruirlo restando por su cuenta —el cliente recalculando— y se equivocaría
justo en el caso que importa. Es el mismo motivo por el que `POST /api/sales`
devuelve `stock: []` con las filas ya actualizadas (`sales.js:344-353`).

**`accion: 'recortada'` y no la línea quitada entera**: el socio quiere las 2 que
hay (decisión 6a). El aviso usa **el mismo tratamiento visual** de la línea
tachada del estado «se agotó» (`:598-605`), con la cantidad pedida tachada al
lado de la nueva.

---

## Público · HTML

### `GET /c/:slug` y `GET /c/:slug/*`

Sirve el documento de `apps/tienda` con las etiquetas Open Graph **de ese
catálogo** ya puestas (decisión 12 de la spec). **No es JSON y no cuelga de
`/api`**.

**Respuesta**: `text/html`, con la cabecera `X-Robots-Tag: noindex, nofollow`
(FR-116) y estas cinco etiquetas reemplazando el marcador `<!--FAVALIO_META-->`:

```html
<title>Comprafit / Fitnet</title>
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="Comprafit / Fitnet">
<meta property="og:description" content="Suplementos deportivos para socios de Fitnet">
<meta property="og:image" content="https://tienda.favalio.com/img/b7/2c/b72c….jpg">
<meta property="og:url" content="https://tienda.favalio.com/c/comprafit-fitnet">
```

| Estado del catálogo | HTTP | Metadatos |
|---|---|---|
| `publicado` | 200 | **Del catálogo** |
| `pausado`, o empresa vencida | 200 | **Genéricos de Favalio** — el socio tiene que reconocer que llegó al lugar correcto, pero el enlace compartido no muestra la portada de una tienda que no vende (FR-117b) |
| `borrador`, o slug inexistente | **404** | Genéricos. **El mismo documento**, indistinguibles entre sí |
| El servicio `tienda` no responde | **503** | Página propia de una línea, con `logger.error` |

`GET /robots.txt` lo sirve el estático de `apps/tienda`, con `Disallow: /c/`.

---

## Privado · `/api/catalogos`

Montado con `...authEmpresa, requireModulo('catalogo')`. **Cada ruta lleva su
`checkPermission`**, verificado por `permisosDeRutas.test.js:674-693`.

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/catalogos` | `catalogo.ver` | La lista: nombre, slug, estado, punto de venta, cantidad de productos publicados, pedidos del mes |
| `POST /api/catalogos` | `catalogo.editar` | Crea en **`borrador`**. Normaliza el slug con `normalizarSlug` antes de guardar |
| `GET /api/catalogos/:id` | `catalogo.ver` | El detalle entero, para las cinco pestañas |
| `PUT /api/catalogos/:id` | `catalogo.editar` | Campos explícitos, **nunca `...req.body`** |
| `DELETE /api/catalogos/:id` | `catalogo.editar` | **409 `TIENE_PEDIDOS`** si los tiene, ofreciendo pausar (FR-069). Sin pedidos, borra en cascada |
| `POST /api/catalogos/:id/publicar` | `catalogo.editar` | Ver abajo |
| `POST /api/catalogos/:id/pausar` | `catalogo.editar` | `publicado` → `pausado` |
| `POST /api/catalogos/:id/despublicar` | `catalogo.editar` | → `borrador`. **Es otra cosa que pausar**: borrador da 404, pausado da la pantalla de pausa |
| `GET /api/catalogos/slug-disponible?slug=` | `catalogo.editar` | Para el formulario. **No sustituye al índice único**: entre la consulta y el guardado pasa tiempo |
| `GET /api/catalogos/:id/categorias` | `catalogo.ver` | Las categorías que existen **hoy** en los productos publicables del catálogo (FR-078). No hay tabla de categorías |
| `GET /api/catalogos/:id/reglas` | `catalogo.ver` | Las reglas **con su cobertura** |
| `POST /api/catalogos/:id/reglas` | `catalogo.editar` | |
| `PUT /api/catalogos/:id/reglas/:reglaId` | `catalogo.editar` | |
| `DELETE /api/catalogos/:id/reglas/:reglaId` | `catalogo.editar` | |
| `GET /api/catalogos/:id/previsualizacion` | `catalogo.ver` | Las cinco columnas de la maqueta (`:959-973`) |
| `GET /api/catalogos/:id/productos` | `catalogo.ver` | Los del catálogo **y** los publicables que no están, con sus banderas |
| `POST /api/catalogos/:id/productos` | `catalogo.editar` | Agrega **en lote** (FR-066) |
| `DELETE /api/catalogos/:id/productos` | `catalogo.editar` | Quita en lote: **borra las filas** (FR-065) |
| `POST /api/catalogos/:id/imagen` | `catalogo.editar` | `multipart`, campo `tipo` = `logo` \| `portada` |
| `DELETE /api/catalogos/:id/imagen?tipo=` | `catalogo.editar` | Borra del volumen **y** de la columna |
| `GET /api/catalogos/:id/metricas?dias=30` | `catalogo.ver` | Visitas, pedidos y conversión |

### `POST /api/catalogos/:id/publicar`

Publicar no es cambiar una columna: es una verificación con **cuatro
condiciones**, y si falta algo **la pantalla dice qué falta, uno por uno**
(FR-057). Por eso la respuesta de error es una **lista**, no un mensaje:

```jsonc
// 409
{
  "ok": false, "error": "FALTAN_REQUISITOS",
  "faltan": [
    { "que": "punto_de_venta_activo", "detalle": "La sucursal «Centro» está desactivada." },
    { "que": "productos_que_salen",   "detalle": "Ninguno de los 8 productos del catálogo tiene precio resoluble." }
  ]
}
```

Un solo mensaje concatenado obliga al comercio a arreglar una cosa, reintentar,
descubrir la siguiente y repetir. Con la lista, ve las cuatro de una.

### `GET /api/catalogos/:id/reglas` — la cobertura

```jsonc
{
  "ok": true,
  "reglas": [
    { "id": 7, "ambito": "producto", "objetivo": { "product_id": 412, "nombre": "Whey Protein 1kg" },
      "tipo": "porcentaje_descuento", "valor": 15, "activo": true,
      "cobertura": { "alcanza": 1, "gana": 1 } },
    { "id": 5, "ambito": "marca", "objetivo": { "brand_id": 3, "nombre": "ENA" },
      "tipo": "porcentaje_descuento", "valor": 12, "activo": true,
      "cobertura": { "alcanza": 2, "gana": 1 } },
    { "id": 9, "ambito": "marca", "objetivo": { "brand_id": null, "nombre": null },
      "tipo": "monto_descuento", "valor": 500, "activo": true,
      "cobertura": { "alcanza": 0, "gana": 0 } }
  ]
}
```

**«Gana en N de M» es `gana` de `alcanza`** (`:942`), y **el universo son los
productos del catálogo**, no el inventario entero: si `alcanza` contara
productos que la previsualización no muestra, las dos pantallas dirían cosas
distintas sobre lo mismo (criterio 12).

La tercera fila es una regla cuya marca alguien borró: `brand_id` quedó en
`NULL` por el `ON DELETE SET NULL`, la cobertura es `0 de 0` y **la fila se
dibuja atenuada**. La regla no se borra sola.

**Una regla que apunta a un producto o a una marca de otra empresa**: 404 al
guardarla, y **no queda ninguna fila** (FR-081). El handler hace `findScoped`
del objetivo antes de crear, en el mismo ámbito, para que el detector de
`aislamientoEmpresas.test.js:867-1044` lo vea.

### `GET /api/catalogos/:id/previsualizacion`

```jsonc
{
  "ok": true,
  "productos": [
    { "id": 412, "nombre": "Whey Protein 1kg", "marca": "ENA",
      "precio_lista": 32500, "precio_final": 27625,
      "regla_gana": { "id": 7, "ambito": "producto", "etiqueta": "−15 % a este producto" },
      "pisadas": [ { "id": 5, "etiqueta": "−12 % a ENA" } ],
      "avisos": [] },
    { "id": 88, "nombre": "Barra proteica", "marca": null,
      "precio_lista": 1200, "precio_final": 0,
      "regla_gana": { "id": 11, "ambito": "catalogo", "etiqueta": "−$1.500 a todo el catálogo" },
      "pisadas": [],
      "avisos": ["QUEDA_EN_CERO"] }
  ],
  "sin_precio": [ { "id": 903, "nombre": "Shaker", "motivo": "SIN_COSTO_NI_PRECIO_MANUAL" } ]
}
```

Las cinco columnas de la maqueta (`:959-973`), más dos cosas que no son adorno:

- **`avisos: ["QUEDA_EN_CERO"]`** cuando una regla deja el precio en $0 (FR-077).
  En el punto de venta eso lo mira una persona; en una página pública **un
  producto a $0 es una oferta**, y alguien la va a tomar.
- **`sin_precio`** es la lista de los que **no van a salir al catálogo** aunque
  estén marcados publicables (FR-076, H5). El panel dice **cuántos son y
  cuáles**: hoy serían 376 de 431.

### `GET /api/catalogos/:id/productos`

```jsonc
{
  "ok": true,
  "en_el_catalogo": 8, "publicables_del_inventario": 62,
  "items": [
    { "id": 412, "nombre": "…", "marca": "ENA", "categoria": "Proteínas",
      "en_el_catalogo": true, "publicable": true, "is_active": true,
      "precio_lista": 32500, "avisos": [] },
    { "id": 903, "nombre": "Shaker", "marca": null, "categoria": "otro",
      "en_el_catalogo": false, "publicable": true, "is_active": true,
      "precio_lista": null, "avisos": ["SIN_PRECIO", "FOTO_EXTERNA"] }
  ]
}
```

`"8 publicados de 62 del inventario"` (`:985`) sale de los dos primeros campos.
**`FOTO_EXTERNA`** es lo que dibuja «foto externa, no se publica» (FR-030, H6):
la `image_url` no empieza con `/img/`, así que la cargó el importador de CSV y
apunta al hosting de un tercero.

---

## Privado · `/api/pedidos`

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/pedidos` | `pedidos.ver` | La bandeja. `?estado=`, `?catalogo_id=`, `?origen=`, `?pagina=` |
| `GET /api/pedidos/:id` | `pedidos.ver` | El detalle con sus líneas |
| `PATCH /api/pedidos/:id/estado` | `pedidos.gestionar` | El único que escribe |

**Un pedido de otra empresa**: 404 en los dos, y **nada cambia** (FR-170).
`findScoped(Pedido, id, req.empresaId)`.

**La lista y el detalle son dos permisos distintos del cambio de estado**: quien
tiene `pedidos.ver` y no `pedidos.gestionar` **ve todo** y los botones están
**deshabilitados con su explicación**, no ausentes (US16 escenario 9).

### `GET /api/pedidos`

```jsonc
{
  "ok": true,
  "items": [
    { "id": "a3f1-…", "numero": 1042, "fecha": "2026-08-09T14:32:00Z",
      "comprador": { "nombre": "Martina Olivera", "nro_socio": "F-2291" },
      "catalogo": { "id": 3, "nombre": "Comprafit / Fitnet" },
      "origen": "catalogo",
      "total": 57200, "medio_pago": "transferencia", "estado": "pendiente_pago" }
  ],
  "pagina": 1, "total": 37,
  "por_estado": { "pendiente_pago": 12, "pagado": 8, "en_preparacion": 3,
                  "listo": 2, "entregado": 11, "cancelado": 1 }
}
```

**`id` sí viaja acá**: es la superficie privada y es lo que el panel usa para
abrir el detalle y cambiar el estado. Es la diferencia con la pública, donde no
viaja ninguno.

**`origen` es la columna «Canal»** de la bandeja, al lado del filtro «Catálogo:
todos» que la maqueta ya dibuja (`:1085`). Hoy dice siempre `catalogo`. El motivo
por el que existe con un solo valor, y por el que la bandeja **no** trae los
pedidos de TiendaNube, está en la decisión 13 del plan.

**`por_estado` viene siempre**, con o sin filtro: son los siete botones de
`:1593` con su número. Se calcula con un `GROUP BY` en la misma consulta, no con
siete `COUNT`.

**El estado vacío distingue dos casos** (FR-172): `total: 0` **sin** filtros
aplicados es «todavía no entró ninguno»; `total: 0` **con** filtros es «el filtro
no devolvió nada». Son dos textos distintos y la respuesta trae con qué
elegirlos.

### `PATCH /api/pedidos/:id/estado`

```jsonc
// pedido
{ "estado": "pagado" }
```

- **Las transiciones permitidas son una función pura** (`utils/estadoDePedido.js`,
  FR-162) y se validan **contra el estado real de la base**, no contra el que
  tenía cargado la pantalla: dos pestañas cambiando el mismo pedido no lo dejan
  en un estado imposible.
- **`cancelado` es terminal** (FR-163). Intentar moverlo: **409
  `TRANSICION_NO_PERMITIDA`**, nombrando el estado actual.
- **Marcar cobrado dos veces —o dos veces en paralelo— da el mismo resultado que
  una** (FR-169): la transición `pagado → pagado` no está permitida, así que el
  segundo request recibe 409 y **nada cambió**. Idempotente por construcción, sin
  una clave de idempotencia.
- **Y esto es todo lo que hace.** `POST /api/pedidos/:id/cobrado` **no existe**:
  no hay un endpoint aparte para «cobrar» porque cobrar, en estas etapas, es
  cambiar un estado. Crear un endpoint con ese nombre sería prometer en la API lo
  mismo que la maqueta promete en la pantalla, y es falso: **no toca `stock`, ni
  `stock_movements`, ni `sales`, ni `sale_items`, ni la caja** (FR-164). El test
  de integración lo afirma mirando **las cinco tablas** (FR-165).

---

## Endpoints existentes que cambian

| Método y ruta | Permiso | Qué cambia |
|---|---|---|
| `POST /api/products/:id/imagen` | `products.editar` | **Nuevo.** `multipart`, campo `imagen`. Redimensiona a 800×800 y guarda en el volumen. Devuelve `{ image_url: '/img/aa/bb/….jpg' }` |
| `DELETE /api/products/:id/imagen` | `products.editar` | **Nuevo.** Borra del volumen **y** de la columna (FR-029) |
| `PATCH /api/products/publicables` | `products.editar` | **Nuevo.** Acción masiva: `{ ids: [...], publicable: true }` (FR-043) |
| `DELETE /api/products/:id` | `products.eliminar` | **Cambia**: borra también el archivo del volumen, para que no acumule imágenes que ya no referencia nadie y el respaldo no las arrastre |
| `POST /api/products` · `PUT /api/products/:id` | `products.crear` / `.editar` | **Cambian**: aceptan `publicable`. **Nunca desde un endpoint sin sesión** (FR-042) |
| `PUT /api/puntos-de-venta/:id` (en `routes/general.js`) | `sucursales.editar` | **Cambia**: desactivar una sucursal usada por un catálogo **publicado** se rechaza **nombrando el catálogo** (FR-059, H13) |

### Los errores de subida de imagen

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `ARCHIVO_NO_ES_IMAGEN` | `sharp` no pudo leerlo. **Mira el contenido**, no la extensión ni el `Content-Type` (FR-024) |
| 400 | `ARCHIVO_DEMASIADO_GRANDE` | Supera el límite, **y el mensaje dice cuál es** (FR-025). Es el `LIMIT_FILE_SIZE` de multer atrapado y convertido en `ErrorDeNegocio`; sin eso responde un 500 que nombra el campo del formulario |
| 507 | `SIN_ESPACIO` | El volumen se llenó. Mensaje legible y `logger.error`. **No hay cuota por empresa** en esta etapa |

**Las imágenes no las sirve la API** (FR-023): las sirve Caddy desde el volumen,
con `handle /img/*  (con `uri strip_prefix /img`)`. Un proceso de Node sirviendo archivos estáticos compite
con las cajas del comercio por el mismo *event loop*. **Son públicas por URL y se
acepta** —son fotos de catálogo, no documentos— pero **no enumerables**: el
nombre es aleatorio y la ruta **no lleva el `empresa_id`**, así que nadie puede
recorrer el catálogo de todas las empresas incrementando un número (FR-026a,
supuesto 23).

