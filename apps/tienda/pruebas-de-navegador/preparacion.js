// ════════════════════════════════════════════
//  FAVALIO · apps/tienda · Lo que tiene que existir antes de abrir el navegador
//
//  Corre UNA vez por suite (`globalSetup` de `playwright.config.js`) y deja un
//  catálogo **publicado**, con slug conocido, contra la API descartable con
//  `BYPASS_AUTH`.
//
//  ── Por qué los datos se siembran y no se doblan ──
//
//  Un test de render arma el objeto del producto a mano y no toca la red
//  (`src/tests/ayudaDeRender.jsx`). Acá no se puede: lo que se mide es el
//  maquetado de la pantalla real con los datos que le entran por el camino real
//  —`GET /api/publico/c/:slug`, con su proyección, su motor de precios y su
//  lectura de stock—. Si el catálogo viniera de un doble, la prueba diría que el
//  diseño funciona con datos que el sistema no produce.
//
//  ── Los tres productos están elegidos, no son «unos cuantos» ──
//
//  Son los tres que permiten **distinguir un defecto de otro** cuando algo se
//  rompe, y cada uno cubre una rama que el otro no:
//
//   1. **Sin marca.** La clave `marca` viene **ausente** de la API —no en
//      `null`— para el 96 % de los productos migrables
//      (`utils/vistaPublica.js:102-104`), y la tarjeta no dibuja el renglón
//      cuando falta. Con los tres productos marcados, esa rama no se recorre
//      nunca y una tarjeta 10px más alta que sus vecinas pasa sin verse.
//   2. **Sin foto.** Va el damero del mismo tamaño que la foto
//      (`Catalogo.jsx:104-123`). Es la pieza que evita que la grilla se
//      descuadre fila por medio, y sin un producto sin foto no hay contra qué
//      comprobarlo.
//   3. **`available = 0` con `quantity > 0`**: agotado **con existencias**. Es
//      el caso que un stock mal leído confunde, porque las dos columnas dicen
//      cosas distintas y sólo una manda: `catalogoPublico.js:248` mira
//      `available` y **sólo el del punto de venta del catálogo**. Un producto
//      agotado a secas —sin fila de stock— pasaría igual leyendo la columna
//      equivocada; éste no.
//
//  Y por eso la comprobación final de este archivo no es «hay tres productos»
//  sino que **cada uno llegó con lo suyo**: uno sin `marca`, uno sin `imagen` y
//  exactamente uno con `agotado: true`. Sembrar contra la base equivocada, o
//  contra una API que cambió de proyección, se ve acá y no dos pruebas después
//  con una pantalla que mide cualquier cosa.
//
//  ── La foto, y la única cosa que acá NO sale del sistema ──
//
//  `image_url` se carga con un `data:` URI de 800×800 —la misma medida que
//  produce `utils/imagenes.js` para el uso `producto`— y no con una foto subida
//  de verdad. El motivo es que **las fotos no las sirve la API** (FR-023): el
//  prefijo `/img/` lo sirve Caddy desde un volumen, y en este arnés no hay
//  Caddy. Una subida real dejaría la columna apuntando a una URL que nadie
//  contesta, o sea una imagen rota, y la grilla estaría midiendo una caja que
//  ningún visitante ve. Lo que se está verificando es el ancho de la tarjeta con
//  una foto adentro, no el hosting de la foto.
// ════════════════════════════════════════════

/** El origen de la API descartable. Sin `/api`: lo agrega `API`. */
const ORIGEN_DE_LA_API = process.env.FAVALIO_ORIGEN_DE_LA_API || 'http://localhost:5098'
const API = `${ORIGEN_DE_LA_API}/api`

/**
 * El slug del catálogo sembrado. Lo importa la prueba, que arma la URL con él.
 *
 * Es un slug ya normalizado —minúsculas, sin acentos, sin guiones repetidos—
 * así que `normalizarSlug` del servidor lo devuelve igual: si el catálogo se
 * guardara bajo otra dirección, `GET /c/<este>` daría 404 y la prueba fallaría
 * diciendo «no llegó a haber catálogo», que es el síntoma que no deja adivinar
 * la causa.
 */
export const SLUG = 'comprafit-de-prueba'

/** El prefijo que hace reconocible lo sembrado, para no duplicarlo en cada corrida. */
const PREFIJO = 'TIENDA-'

/** La marca que llevan dos de los tres productos. El tercero no lleva ninguna. */
const MARCA = 'Ena'

/**
 * La foto: un cuadrado liso de 800×800, del tamaño que guarda el sistema.
 *
 * SVG y no PNG porque se lee de un vistazo y no hay que confiar en un base64 que
 * nadie puede revisar. `silver` y no un hexadecimal: el color no significa nada
 * acá, y escribirlo con nombre evita que este archivo parezca una excepción a la
 * regla de `src/tema.js` —que vale para `src/`, no para esta carpeta, pero la
 * distinción no se lee de lejos—.
 */
const FOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">'
  + '<rect width="800" height="800" fill="silver"/></svg>'
)}`

/**
 * Los tres productos, con el defecto que cada uno permite distinguir.
 *
 * Los precios y las categorías son los de un catálogo de suplementos de verdad:
 * lo que se mide es el ancho, y un precio de cuatro cifras y uno de seis no
 * ocupan lo mismo en una tarjeta de media pantalla.
 */
export const PRODUCTOS = [
  {
    clave: 'sin_marca',
    name: 'Creatina Monohidrato 300 g',
    sku: `${PREFIJO}001`,
    category: 'Creatinas',
    cost: 38868,
    marca: null,
    foto: true,
    quantity: 40,
    available: 40,
  },
  {
    clave: 'sin_foto',
    name: 'Proteína Whey Vainilla 1 kg',
    sku: `${PREFIJO}002`,
    category: 'Proteínas',
    cost: 64500,
    marca: MARCA,
    foto: false,
    quantity: 25,
    available: 25,
  },
  {
    clave: 'agotado_con_existencias',
    name: 'Barrita Proteica Chocolate',
    sku: `${PREFIJO}003`,
    category: 'Barritas',
    cost: 2450,
    marca: MARCA,
    foto: true,
    // ⚠ Las dos columnas dicen cosas distintas **a propósito**: hay doce en el
    // depósito y ninguna disponible. La tienda tiene que decir «Agotado».
    quantity: 12,
    available: 0,
  },
]

/**
 * Cómo levantar lo que falta, con el comando escrito.
 *
 * Una suite de navegador que falla con «ECONNREFUSED» en cada uno de sus casos
 * no le dice a nadie qué hacer. Falla una vez, con esto.
 */
const COMO_LEVANTAR_LA_API =
  'Las pruebas de navegador de la tienda necesitan una base descartable y la API contra ella:\n\n'
  + '  docker run -d --name favalio-tienda-e2e -e POSTGRES_USER=favalio \\\n'
  + '    -e POSTGRES_PASSWORD=favalio -e POSTGRES_DB=favalio_tienda_e2e \\\n'
  + '    -p 55436:5432 postgres:16-alpine\n\n'
  + '  cd apps/api && DATABASE_URL=postgres://favalio:favalio@localhost:55436/favalio_tienda_e2e \\\n'
  + '    DB_SSL=false NODE_ENV=development BYPASS_AUTH=true PORT=5098 \\\n'
  + '    node src/server.js\n\n'
  // ⚠ Sin `ALLOWED_ORIGINS` y sin `TIENDANUBE_CLIENT_ID`, que en el arnés de
  // `apps/web` no son opcionales. Acá no hacen falta y el motivo es estructural,
  // no una simplificación: la tienda habla contra su **propio origen** —rutas
  // relativas en `src/api.js`, proxy del servidor de desarrollo en
  // `vite.config.js`—, así que el navegador no manda `Origin` y la lista blanca
  // de CORS de `server.js` no se consulta nunca. Si alguien agrega acá una
  // llamada con URL absoluta, esto deja de ser cierto y hay que volver a leer
  // este párrafo.
  + 'El porqué de cada pieza está en el encabezado de apps/tienda/playwright.config.js.\n\n'
  + 'Los números son propios (API 5098, base 55436) para que este arnés y el de apps/web\n'
  + 'puedan estar arriba a la vez. Si cambiás alguno, va en FAVALIO_ORIGEN_DE_LA_API.'

async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
  })

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text()
    throw new Error(`${opciones.method || 'GET'} ${ruta} respondió ${respuesta.status}: ${cuerpo.slice(0, 300)}`)
  }

  return respuesta.json()
}

const enviar = (ruta, metodo, cuerpo) =>
  pedir(ruta, { method: metodo, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })

/** Un fallo con el motivo escrito. `assert` a secas deja un mensaje que no dice nada. */
function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

// ════════════════════════════════════════════
//  La siembra
// ════════════════════════════════════════════

/**
 * La marca, si no está.
 *
 * Idempotente por nombre: correr esto dos veces no deja dos marcas iguales, y
 * una corrida que se cortó a la mitad se completa sola en la siguiente.
 */
async function sembrarLaMarca() {
  const { data } = await pedir('/brands')
  const ya = (data || []).find((m) => m.name === MARCA)
  if (ya) return ya.id

  const creada = await enviar('/brands', 'POST', { name: MARCA })
  return creada.data.id
}

/**
 * Los tres productos y su stock.
 *
 * `publicable: true` va en el alta y no después: un producto nace en `false`
 * (`models/Product.js:95-99`) y sin esa marca no entra al catálogo aunque se lo
 * agregue, así que la publicación fallaría con «ningún producto puede salir» y
 * el mensaje mandaría a mirar el catálogo en vez del alta.
 *
 * @returns {Map<string, object>} el producto de la API, por `clave`.
 */
async function sembrarLosProductos(brandId, puntoDeVentaId) {
  const { data } = await pedir('/products?limit=500')
  const porSku = new Map((data || []).map((p) => [p.sku, p]))

  const porClave = new Map()

  for (const spec of PRODUCTOS) {
    let producto = porSku.get(spec.sku)

    if (!producto) {
      const creado = await enviar('/products', 'POST', {
        name: spec.name,
        sku: spec.sku,
        category: spec.category,
        cost: spec.cost,
        unit_type: 'unidad',
        taxed: true,
        publicable: true,
        brand_id: spec.marca ? brandId : null,
        image_url: spec.foto ? FOTO : null,
      })
      producto = creado.data
    }

    // El stock se manda SIEMPRE, también cuando el producto ya estaba: es la
    // única forma de que una segunda corrida deje las dos columnas donde este
    // archivo dice que están. `POST /api/stock` es un `findOrCreate` con
    // actualización, y manda las dos por separado —`quantity` y `available`—,
    // que es lo que hace posible el tercer caso.
    await enviar('/stock', 'POST', {
      product_id: producto.id,
      punto_de_venta_id: puntoDeVentaId,
      quantity: spec.quantity,
      available: spec.available,
    })

    porClave.set(spec.clave, producto)
  }

  return porClave
}

/**
 * El catálogo publicado, con su slug.
 *
 * ⚠ El `punto_de_venta_id` es **el mismo** en el que se cargó el stock, y eso no
 * es una prolijidad: `catalogoPublico.js:220-225` lee el stock **sólo** del
 * punto de venta del catálogo. Con el stock en una sucursal y el catálogo
 * colgado de otra, los tres productos saldrían agotados y el caso del agotado
 * con existencias dejaría de distinguir nada.
 */
async function sembrarElCatalogo(puntoDeVentaId, productos) {
  const { data } = await pedir('/catalogos')
  let catalogo = (data || []).find((c) => c.slug === SLUG)

  if (!catalogo) {
    const creado = await enviar('/catalogos', 'POST', {
      nombre_visible: 'Comprafit',
      slug: SLUG,
      punto_de_venta_id: puntoDeVentaId,
      descripcion: 'Suplementos deportivos. Retiro en el local o coordinamos la entrega por WhatsApp.',
      retiro_local: true,
      coordinar_whatsapp: true,
    })
    catalogo = creado.data
  }

  // ⚠ La entrega y el pago se escriben SIEMPRE, también cuando el catálogo ya
  // existía: son lo que hace que el checkout tenga tres pasos con algo adentro.
  // Sin `envio` no se dibujan los campos de dirección —que son los que rompen
  // primero a 390px— y sin CBU no se dibuja el bloque de la transferencia, que
  // lleva la cadena más larga e incortable de la tienda.
  await enviar(`/catalogos/${catalogo.id}`, 'PUT', {
    retiro_local: true,
    coordinar_whatsapp: true,
    envio: true,
    envio_costo: 2500,
    envio_gratis_desde: 50000,
    datos_transferencia: {
      titular: 'Comprafit S.R.L.',
      cbu: '0720123488000012345678',
      alias: 'COMPRAFIT.SUPLE',
      banco: 'Santander',
    },
  })

  // En lote y con los tres ids: `POST /:id/productos` ignora los que ya estaban,
  // así que esto es idempotente sin preguntar antes.
  await enviar(`/catalogos/${catalogo.id}/productos`, 'POST', {
    ids: PRODUCTOS.map((spec) => productos.get(spec.clave).id),
  })

  // Publicar es una verificación de cuatro condiciones y devuelve la lista de lo
  // que falta (`routes/catalogos.js:307-354`). Se re-lanza con esa lista adentro:
  // «respondió 409» a secas obliga a ir a leer el handler.
  try {
    await enviar(`/catalogos/${catalogo.id}/publicar`, 'POST')
  } catch (err) {
    throw new Error(
      `No se pudo publicar el catálogo sembrado, así que la tienda dibujaría el estado `
      + `«no encontrada» en vez del catálogo.\n\nMotivo: ${err.message}`
    )
  }

  return catalogo
}

/**
 * Lo que la tienda va a recibir de verdad, pedido por el mismo camino público.
 *
 * Sin esto, una siembra contra la base equivocada —o contra una API que cambió
 * de proyección— deja todo en verde acá y las pruebas fallan después midiendo
 * una pantalla vacía, que es el síntoma que no permite adivinar la causa.
 *
 * Y las tres afirmaciones de abajo son las que le dan sentido a haber elegido
 * **estos** tres productos: si sobrevivieran a un stock mal leído o a una
 * proyección que manda `marca: null`, la elección no serviría para distinguir
 * nada.
 */
async function comprobarLoQueVeLaTienda() {
  const respuesta = await fetch(`${API}/publico/c/${SLUG}`)
  const cuerpo = await respuesta.json().catch(() => null)

  exigir(
    respuesta.ok && cuerpo && cuerpo.ok,
    `GET /api/publico/c/${SLUG} respondió ${respuesta.status}. La tienda no tendría catálogo que dibujar.\n\n`
    + COMO_LEVANTAR_LA_API
  )

  const datos = cuerpo.data

  exigir(
    datos.estado === 'publicado',
    `El catálogo sembrado está en «${datos.estado}» y no en «publicado».\n\n`
    + 'Si dice `no_disponible`, lo que bloquea es la suscripción de la empresa 1 y no el catálogo: '
    + 'el arranque en desarrollo la crea en `trialing` por 15 días (`src/setup.js:47-63`), así que '
    + 'una base vieja se vence sola. Lo más rápido es tirarla y volver a empezar:\n\n'
    + '  docker rm -f favalio-tienda-e2e\n\n'
    + COMO_LEVANTAR_LA_API
  )

  const productos = datos.productos || []
  exigir(
    productos.length === PRODUCTOS.length,
    `El catálogo público devuelve ${productos.length} productos y se sembraron ${PRODUCTOS.length}.`
  )

  const sinMarca = productos.filter((p) => p.marca === undefined)
  exigir(
    sinMarca.length === 1,
    `Tiene que haber exactamente UN producto sin la clave «marca» y hay ${sinMarca.length}. `
    + 'Si son cero, la proyección pública empezó a mandar `marca: null` y la tarjeta va a dibujar '
    + 'un renglón vacío que descuadra la grilla (`utils/vistaPublica.js:102-104`).'
  )

  const sinFoto = productos.filter((p) => p.imagen === undefined)
  exigir(
    sinFoto.length === 1,
    `Tiene que haber exactamente UN producto sin foto y hay ${sinFoto.length}: sin él, el damero `
    + 'del marcador nunca se dibuja y la grilla se mide sin el caso que la descuadra.'
  )

  const agotados = productos.filter((p) => p.agotado === true)
  exigir(
    agotados.length === 1,
    `Tiene que haber exactamente UN producto agotado y hay ${agotados.length}. El sembrado tiene `
    + '`quantity: 12` y `available: 0`: si sale disponible, el stock se está leyendo por la columna '
    + 'equivocada o desde otra sucursal (`catalogoPublico.js:220-225`).'
  )

  exigir(
    productos.every((p) => Number(p.precio) > 0),
    'Algún producto sale a $0. Con un precio en cero la tarjeta mide distinto y, sobre todo, '
    + 'es una oferta que alguien de la calle va a tomar.'
  )
}

export default async function preparar() {
  // ── La API tiene que estar arriba, y decir CÓMO levantarla si no lo está ──
  try {
    const salud = await pedir('/health')
    exigir(salud.ok, `la API respondió ${JSON.stringify(salud)}`)
  } catch (err) {
    throw new Error(`No hay una API en ${API}.\n\n${COMO_LEVANTAR_LA_API}\n\nMotivo: ${err.message}`)
  }

  // ── El contexto: sin empresa activa no hay catálogo que colgar de ningún lado ──
  const contexto = await pedir('/empresas/mi-contexto')
  const empresa = contexto.data?.empresaActiva
  exigir(
    empresa,
    'La API está arriba pero no devuelve empresa activa. La base tiene que ser la que el propio '
    + 'arranque en desarrollo siembra (empresa 1, sus tres sucursales y el usuario test-user-id).'
  )

  const sucursal = empresa.puntosDeVenta?.[0]?.id
  exigir(sucursal, 'La empresa de pruebas no tiene ninguna sucursal, y el catálogo cuelga de una.')

  const brandId = await sembrarLaMarca()
  const productos = await sembrarLosProductos(brandId, sucursal)
  await sembrarElCatalogo(sucursal, productos)

  await comprobarLoQueVeLaTienda()
}
