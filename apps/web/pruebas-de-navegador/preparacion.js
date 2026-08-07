// ════════════════════════════════════════════
//  ADMINAPP · Lo que tiene que existir antes de abrir el navegador
//
//  Corre UNA vez por suite (`globalSetup` de `playwright.config.js`) y hace dos
//  cosas: comprobar que la API descartable esté arriba, y sembrar los datos que
//  los pasos de maquetado necesitan —el catálogo del punto de venta y los
//  proveedores con sus órdenes—.
//
//  ── Por qué los datos se siembran y no se doblan ──
//
//  Un test de render dobla el store con `useStore.setState` y no toca la red.
//  Acá no se puede: lo que se está midiendo es el maquetado de la pantalla real
//  con los datos que le entran por el camino real. Si el catálogo viniera de un
//  doble, la prueba diría que el diseño funciona con datos que el sistema no
//  produce.
//
//  Los números salen de los pasos manuales de las specs:
//
//   · `docs/specs/011-punto-de-venta/tasks.md`: el paso 2 pide **40 resultados**
//     en el catálogo y 8 líneas en el ticket; el paso 3 pide un producto con un
//     nombre de **80 caracteres**. Por eso son 45 y no «unos cuantos».
//   · `docs/specs/012-proveedores-y-ordenes-de-compra/tasks.md` (T1250): cuatro
//     proveedores en los **cuatro estados de cuenta** de la tabla de la spec y
//     seis órdenes en los **cuatro estados de orden**, una de ellas con **dos
//     líneas del mismo producto**.
//
//  ⚠ **El plan de la 012 daba por sembrado algo que no estaba.** Decía que el
//  `NOMBRE_LARGO` de 80 caracteres «ya sirve» para la afirmación del nombre
//  largo de proveedor, y no: ese nombre era —y sigue siendo— el de un
//  **producto**, y este archivo no creaba ningún `Supplier` ni ninguna
//  `SupplierOrder`. Sin la siembra de abajo, dos de las cuatro pruebas de
//  `proveedoresYOrdenes.navegador.js` no tienen contra qué correr.
//
//  ⚠⚠ **Y el hito 013 encontró la otra mitad del mismo problema**: una pantalla
//  puede estar escrita, tener datos y **seguir siendo inalcanzable**.
//  `/tiendanube` cuelga de `RouteGuard requiredModule="tiendanube"` en
//  `App.jsx`, y ninguna empresa tiene ese módulo en `enabled_modules`, así
//  que el navegador termina en `/pos` y la prueba falla diciendo que no
//  encuentra lo que busca — sin decir por qué. Lo resuelve `habilitarLosModulos`,
//  acá abajo. En producción eso es el paso manual P4 y no se arregla sacando el
//  guard.
// ════════════════════════════════════════════

import { readFile } from 'node:fs/promises'
import { sembrarLaTienda, TIENDA_DE_PRUEBA, VARIANTES, variante } from './siembraDeTiendanube.js'

const API = process.env.ADMINAPP_API_DE_PRUEBAS || 'http://localhost:5099/api'

/** Cuántos productos comunes se siembran. El paso 2 pide 40 resultados. */
const CUANTOS = 44

/**
 * El nombre largo del paso 3, de 80 caracteres exactos y sin espacios.
 *
 * Sin espacios a propósito: un nombre con espacios se parte en varias líneas y
 * el defecto que el paso busca —que el nombre corra las columnas de precio— no
 * se reproduce. Un token indivisible es el caso peor y es el que hay que
 * probar. Ochenta caracteres es lo que dice el paso.
 *
 * Lo usan DOS siembras y a propósito: el producto del catálogo del POS y el
 * nombre de uno de los proveedores. Es el mismo caso de borde —un nombre que no
 * entra en su celda— sobre dos tablas distintas, y tenerlo escrito una sola vez
 * es lo que hace que las dos pruebas midan lo mismo.
 */
const NOMBRE_LARGO = 'Suplemento-Proteico-Hidrolizado-De-Suero-Con-Colageno-Y-Magnesio-Sabor-Vainilla'.padEnd(80, '-')

/** El prefijo que hace reconocible lo sembrado, para no duplicarlo en cada corrida. */
const PREFIJO = 'PRUEBA-'

/**
 * Cómo levantar lo que falta, con el comando escrito.
 *
 * Una suite de navegador que falla con «ECONNREFUSED» en cada uno de sus veinte
 * casos no le dice a nadie qué hacer. Falla una vez, con esto.
 */
const COMO_LEVANTAR_LA_API =
  'Las pruebas de navegador necesitan una base descartable y la API contra ella:\n\n'
  + '  docker run -d --name adminapp-e2e-pg -e POSTGRES_USER=adminapp \\\n'
  + '    -e POSTGRES_PASSWORD=adminapp -e POSTGRES_DB=adminapp_e2e \\\n'
  + '    -p 55432:5432 postgres:16-alpine\n\n'
  + '  cd apps/api && DATABASE_URL=postgres://adminapp:adminapp@localhost:55432/adminapp_e2e \\\n'
  + '    DB_SSL=false NODE_ENV=development BYPASS_AUTH=true PORT=5099 \\\n'
  + '    ALLOWED_ORIGINS=http://localhost:5199 TIENDANUBE_CLIENT_ID=maquetado \\\n'
  + '    node src/server.js\n\n'
  // ⚠ `ALLOWED_ORIGINS` NO es opcional y no estaba escrito en ninguna parte.
  // La lista blanca de CORS de `server.js:112-119` trae 5173, 5174 y 3000, y el
  // servidor de estas pruebas corre en el **5199** (`playwright.config.js`).
  // Sin esa variable, el navegador recibe la respuesta sin cabecera de CORS, la
  // carga del contexto falla, `App.jsx` dibuja «Redirigiendo al inicio de
  // sesión…» y **las diecisiete pruebas fallan diciendo que no encuentran
  // `<main>`** — que es exactamente el síntoma que no permite adivinar la causa.
  // El único rastro es un `WARN CORS: origen rechazado` en el log de la API.
  //
  // ⚠ `TIENDANUBE_CLIENT_ID` tampoco es opcional, y por un motivo distinto del
  // de CORS: sin esa variable `GET /api/tiendanube/status` corta en el primer
  // `if` y responde `estado: 'sin_configurar'` con `tienda: null`, o sea que la
  // pantalla dibuja el estado vacío de «la integración no está configurada en el
  // servidor» **por más filas que haya en la base**, y las dos medidas de
  // `tiendanube.navegador.js` no tienen ninguna tabla que medir. El valor da
  // igual: nada sale hacia TiendaNube en estas pruebas y lo único que se hace
  // con él es armar la URL de autorización.
  //
  // ⚠ El comando de arriba es el que manda. El encabezado de
  // `playwright.config.js` explica POR QUÉ existe cada pieza —la base vacía, el
  // servidor de desarrollo en vez de `vite preview`, el bypass de la sesión— pero
  // su comando quedó corto: le faltan `ALLOWED_ORIGINS` y `TIENDANUBE_CLIENT_ID`,
  // y las dos se agregaron acá porque acá es donde se lee cuando algo falla.
  + 'El porqué de cada pieza está en el encabezado de apps/web/playwright.config.js; '
  + 'el comando completo es el de arriba.\n\n'
  + 'Si la base descartable no está en el 55432 —el arnés de integración usa ese mismo '
  + 'puerto y los dos no pueden estar arriba a la vez—, pasá la cadena en '
  + 'ADMINAPP_DB_DE_PRUEBAS al correr las pruebas.'

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

// ════════════════════════════════════════════
//  Los cuatro proveedores, uno por estado de cuenta
// ════════════════════════════════════════════

/**
 * Los cuatro estados de la tabla de la spec, con el guion que los produce.
 *
 * ⚠ **El estado NO se escribe: se produce.** No hay ninguna columna
 * `estado_de_cuenta` que sembrar — el estado sale de `estadoDeProveedor`
 * (`utils/cuentaDeProveedor.js`) sobre `deuda`, `pagado` y `saldo`, que a su vez
 * salen de los movimientos que genera **recibir una orden** y de los pagos. Por
 * eso cada proveedor lleva su guion de órdenes y pagos en vez de un campo, y por
 * eso vale como dato del sistema: si mañana la recepción dejara de generar la
 * deuda, estas cuentas dejarían de tener el estado que dicen tener y las pruebas
 * lo verían.
 *
 * `PREFIJO` en el nombre de tres de los cuatro, para reconocer lo sembrado. El
 * cuarto es `NOMBRE_LARGO` a secas: agregarle el prefijo lo dejaría en 87
 * caracteres y el paso pide **80**.
 */
const PROVEEDORES = [
  {
    clave: 'sin_movimientos',
    name: `${PREFIJO}Distribuidora Norte`,
    phone: '+5493411234567',
    cuit: '30-71234567-8',
    email: 'ventas@norte.test',
  },
  {
    clave: 'saldado',
    name: `${PREFIJO}Almacén Central`,
    phone: '+5493415550001',
    cuit: '30-71234567-9',
    email: 'pedidos@central.test',
  },
  {
    clave: 'pago_parcial',
    name: `${PREFIJO}Insumos del Sur`,
    phone: '+5493415550002',
    cuit: '33-71234567-9',
    email: 'admin@sur.test',
  },
  {
    clave: 'con_deuda',
    name: NOMBRE_LARGO,
    phone: '+5493415550003',
    cuit: '30-71234567-0',
    email: 'contacto@largo.test',
  },
]

/** Una línea de orden a partir de un producto del catálogo sembrado. */
function linea(producto, cantidad, precio) {
  return {
    product_id: producto.id,
    product_name: producto.name,
    quantity: cantidad,
    unit_price: precio,
  }
}

const crearOrden = (supplierId, items, notes) =>
  pedir(`/suppliers/${supplierId}/orders`, {
    method: 'POST',
    body: JSON.stringify({ items, notes }),
  }).then((r) => r.data)

// El cuerpo es `{ linea, cantidad }`: la identidad de una línea es su POSICIÓN
// en el detalle (FR-031). El cuerpo viejo `{ product_id, quantity_received }` lo
// borró T1239 y desde entonces responde 400 LINEA_REQUERIDA — que es
// exactamente lo que se quiere si alguien copia esta siembra de un commit viejo.
const recibirOrden = (ordenId, items) =>
  pedir(`/suppliers/orders/${ordenId}/receive`, { method: 'PUT', body: JSON.stringify({ items }) })

const anularOrden = (ordenId) =>
  pedir(`/suppliers/orders/${ordenId}/cancel`, { method: 'PUT' })

const registrarPago = (supplierId, fecha, monto, notas) =>
  pedir(`/suppliers/${supplierId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ date: fecha, amount: monto, payment_method: 'tr', notes: notas }),
  })

/**
 * Las órdenes y los movimientos de UN proveedor, según el estado que tiene que
 * quedar.
 *
 * Seis órdenes en total entre los cuatro, y los cuatro estados de orden
 * cubiertos: tres `pending`, una `partial`, dos `received` y una `cancelled`
 * —la anulada se cuenta aparte porque anular no toca la cuenta—.
 *
 * @param {string} clave  El estado de cuenta buscado.
 * @param {number} supplierId
 * @param {Array<object>} productos  El catálogo sembrado, por posición.
 * @param {string} hoy  La fecha del pago. La de la deuda la pone el servidor.
 */
async function sembrarLaCuentaDe(clave, supplierId, productos, hoy) {
  if (clave === 'sin_movimientos') {
    // Dos órdenes pendientes y una anulada: ninguna de las tres genera
    // movimiento, así que la cuenta queda en cero **con actividad a la vista**.
    // Es el caso que distingue «Sin movimientos» de «Saldado», y el que hace
    // aparecer el badge «Sin factura» de FR-086 —hay mercadería pedida y ningún
    // documento cargado—.
    await crearOrden(supplierId, [
      linea(productos[0], 12, 1480),
      linea(productos[1], 6, 2360.5),
    ], 'Reposición semanal')

    // ⚠ **Dos líneas del MISMO producto**, que es el caso del defecto 4: hasta
    // este hito la recepción se indexaba por `product_id` y las dos líneas
    // compartían un solo campo. Va sembrada para que el panel de recepción se
    // pueda abrir contra ella en el navegador.
    await crearOrden(supplierId, [
      linea(productos[2], 10, 980),
      linea(productos[2], 4, 1150),
    ], 'Dos líneas del mismo producto, a dos precios')

    const anulada = await crearOrden(supplierId, [linea(productos[3], 5, 700)], 'Pedido duplicado')
    await anularOrden(anulada.id)

    return
  }

  if (clave === 'saldado') {
    // 10 × 1250,50 = 12.505,00 recibidos, y un pago por el mismo importe: el
    // saldo queda en CERO de verdad y el badge dice «Saldado». Es el criterio de
    // éxito 8 llevado a la pantalla: si la suma se hiciera en punto flotante, el
    // residuo dejaría la cuenta en «Con deuda» sin que nada fallara.
    const orden = await crearOrden(supplierId, [linea(productos[4], 10, 1250.5)], 'Compra al contado')
    await recibirOrden(orden.id, [{ linea: 0, cantidad: 10 }])
    await registrarPago(supplierId, hoy, 12505, 'Transferencia por la factura A-0001-00000123')

    return
  }

  if (clave === 'pago_parcial') {
    // Se recibe una sola de las dos líneas: la orden queda en `partial` —el
    // cuarto estado de orden— y la cuenta con deuda de 10.000 y 3.500 pagados.
    const orden = await crearOrden(supplierId, [
      linea(productos[5], 20, 500),
      linea(productos[6], 10, 1000),
    ], 'Entrega en dos partes')
    await recibirOrden(orden.id, [{ linea: 0, cantidad: 20 }])
    await registrarPago(supplierId, hoy, 3500, 'A cuenta')

    return
  }

  // `con_deuda`: recibido entero y sin un peso pagado. Es el proveedor del
  // nombre de 80 caracteres, así que además de su badge rojo tiene el saldo más
  // grande de la lista — que es lo que la prueba del nombre largo compara
  // contra la caja del nombre.
  const orden = await crearOrden(supplierId, [linea(productos[7], 30, 1625)], 'Compra a 30 días')
  await recibirOrden(orden.id, [{ linea: 0, cantidad: 30 }])
}

/**
 * Los cuatro proveedores, si no están.
 *
 * Idempotente **por proveedor** y no por «ya se sembró algo»: se busca cada uno
 * por su nombre —que es único por empresa, lo garantiza el índice— y solo se
 * siembra la cuenta del que se acaba de crear. Correr esto dos veces no duplica
 * nada, y una corrida que se cortó a la mitad se completa sola en la siguiente.
 */
async function sembrarProveedores(productos, hoy) {
  const { data } = await pedir('/suppliers?limit=200')
  const porNombre = new Set((data || []).map((s) => s.name))

  for (const spec of PROVEEDORES) {
    if (porNombre.has(spec.name)) continue

    const creado = await pedir('/suppliers', {
      method: 'POST',
      body: JSON.stringify({
        name: spec.name,
        phone: spec.phone,
        email: spec.email,
        cuit: spec.cuit,
        address: 'Ruta 9 km 312',
      }),
    })

    await sembrarLaCuentaDe(spec.clave, creado.data.id, productos, hoy)
  }
}

// ════════════════════════════════════════════
//  Los gastos fijos de /gastos
// ════════════════════════════════════════════

/**
 * El nombre de gasto que no entra en su columna.
 *
 * Es el caso de borde de `maquetadoDeGastos.navegador.js`: la descripción es la
 * única columna elástica de la tabla —`minmax(0,1fr)`— y sin `min-w-0` ni
 * `truncate` un texto largo la ensancha y empuja la de importe. jsdom no lo
 * puede contestar: `getBoundingClientRect` devuelve ceros.
 *
 * **Con espacios, a diferencia de `NOMBRE_LARGO`**, y es deliberado: un gasto se
 * escribe como una frase —«Alquiler del depósito de Ortiz de Ocampo y
 * expensas»— y con `truncate` puesto lo que hay que comprobar es que la frase
 * se corte con puntos suspensivos, no que un token indivisible desborde. El
 * token indivisible ya lo cubre el producto del catálogo, en otra tabla.
 */
const NOMBRE_DE_GASTO_LARGO =
  'Alquiler del depósito de Ortiz de Ocampo y expensas, más el seguro contra incendio del galpón'

/**
 * Cuatro gastos fijos: dos con sucursal, dos sin ella.
 *
 * ⚠ **Uno tiene que ser SIN sucursal**, y ése es el punto: es el que la pantalla
 * vieja perdía —`group='gf1'` y `punto_de_venta_id` nulo—, y el que hace que
 * «General» tenga tarjeta. Una siembra con todos los gastos asignados dejaría la
 * prueba midiendo una pantalla que no tiene el caso.
 *
 * Los importes llevan centavos que no cierran en punto flotante (0,10 + 0,20),
 * así que la fila más ancha de la columna de importe es la que de verdad se
 * dibuja y no una redondeada.
 */
const GASTOS_FIJOS = [
  { name: `${PREFIJO}${NOMBRE_DE_GASTO_LARGO}`, amount: 1875430.1, conSucursal: true },
  { name: `${PREFIJO}Sueldos`, amount: 2400000.2, conSucursal: false },
  { name: `${PREFIJO}Internet y telefonía`, amount: 48750.55, conSucursal: true },
  { name: `${PREFIJO}Contador`, amount: 190000, conSucursal: false },
]

/**
 * Siembra los gastos fijos si no están.
 *
 * Idempotente por nombre, como los proveedores: correr esto dos veces no
 * duplica nada y una corrida cortada a la mitad se completa sola.
 */
async function sembrarGastosFijos(puntoDeVentaId) {
  const { data } = await pedir('/expenses')
  const porNombre = new Set((data || []).map((g) => g.name))

  for (const gasto of GASTOS_FIJOS) {
    if (porNombre.has(gasto.name)) continue

    await pedir('/expenses', {
      method: 'POST',
      body: JSON.stringify({
        name: gasto.name,
        amount: gasto.amount,
        // `null` es un caso legítimo: el gasto se dibuja en «General».
        punto_de_venta_id: gasto.conSucursal ? puntoDeVentaId : null,
      }),
    })
  }
}

// ════════════════════════════════════════════
//  Los módulos habilitados, que es lo que decide qué pantallas existen
// ════════════════════════════════════════════

/**
 * Pone en `empresa.settings.enabled_modules` todos los módulos que las rutas de
 * `App.jsx` exigen.
 *
 * ── Por qué la lista se DERIVA de `App.jsx` en vez de escribirse ──
 *
 * Es lo contrario de la regla de `CON_MARCO`, que se escribe a mano justamente
 * para no derivarla del código que verifica, y la diferencia es qué papel juega
 * cada lista. `CON_MARCO` **afirma** algo sobre `App.jsx`; ésta no afirma nada:
 * **configura el entorno** para que las pantallas sean alcanzables, igual que
 * `superadmin.js` o `ALLOWED_ORIGINS`. Una lista escrita a mano acá no detecta
 * ningún defecto: lo único que produce es que el día que alguien agregue una
 * ruta con módulo, dieciocho pruebas fallen diciendo «el navegador terminó en
 * /pos» por un olvido del arnés.
 *
 * ⚠ `tiendanube` se agrega **además** y no se depende de que esté en `App.jsx`.
 * Si la `<Route>` todavía no existe —o perdió su guard—, esto no falla acá: lo
 * dice `marcoDeLasPantallas.navegador.js`, que distingue «la pantalla no se
 * escribió» de «el navegador terminó en otra».
 *
 * ⚠⚠ **El `PUT` manda el `settings` ENTERO** (`routes/empresas.js:501-511`). Se
 * lee el JSON actual, se le agrega la clave y se manda completo: armarlo de
 * memoria pisa el resto de la configuración de la empresa. Es la misma
 * precaución que el paso manual P4 deja escrita para producción.
 */
async function habilitarLosModulos(empresaId) {
  const fuenteDeApp = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const delAppJsx = [...fuenteDeApp.matchAll(/requiredModule="([\w-]+)"/g)].map((m) => m[1])

  const modulos = [...new Set([...delAppJsx, 'tiendanube'])].sort()

  const { data: empresa } = await pedir(`/empresas/${empresaId}`)
  const ajustes = { ...(empresa.settings || {}) }

  const yaEstaban = Array.isArray(ajustes.enabled_modules) ? ajustes.enabled_modules : []
  if (modulos.every((m) => yaEstaban.includes(m))) return modulos

  ajustes.enabled_modules = [...new Set([...yaEstaban, ...modulos])].sort()

  await pedir(`/empresas/${empresaId}`, {
    method: 'PUT',
    body: JSON.stringify({ settings: ajustes }),
  })

  return modulos
}

// ════════════════════════════════════════════
//  La tienda de TiendaNube y su catálogo
// ════════════════════════════════════════════

/**
 * Deja `/tiendanube` con una tienda vinculada, cuatro variantes y un mapeo.
 *
 * Las filas las escribe `siembraDeTiendanube.js` por SQL —su encabezado explica
 * por qué no hay ninguna otra forma sin una cuenta real de TiendaNube—, y acá se
 * hacen las dos mitades que **sí** pasan por la API de verdad: crear el mapeo y
 * comprobar que la pantalla va a recibir lo que se sembró.
 */
async function sembrarTiendanube(empresaId, puntoDeVentaId, productos) {
  // La empresa según la API, para que la siembra pueda comprobar —ANTES de
  // escribir— que la base a la que se conecta es la que la API está usando.
  const { data: empresaSegunLaApi } = await pedir(`/empresas/${empresaId}`)

  await sembrarLaTienda(empresaId, puntoDeVentaId, empresaSegunLaApi)

  // El mapeo se crea por HTTP y no por SQL, y es deliberado: `POST /mapeos`
  // valida el producto con `findScoped`, exige que la variante esté en la
  // instantánea y traduce el choque del índice único. Si la instantánea sembrada
  // no tuviera la forma que el sistema espera, esto responde 400 **acá**, y no
  // dos pruebas más tarde con una pantalla vacía.
  const productoAMapear = productos[0]
  const laNormal = variante('normal')

  const respuesta = await fetch(`${API}/tiendanube/mapeos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_id: productoAMapear.id,
      tiendanube_variant_id: laNormal.tiendanube_variant_id,
      tiendanube_product_id: laNormal.tiendanube_product_id,
    }),
  })

  // 409 es «ya estaba mapeado», que es lo que devuelve la segunda corrida contra
  // la misma base. No es un fallo: la siembra es idempotente por diseño.
  if (!respuesta.ok && respuesta.status !== 409) {
    const cuerpo = await respuesta.text()
    throw new Error(
      `POST /tiendanube/mapeos respondió ${respuesta.status}: ${cuerpo.slice(0, 300)}\n\n`
      + 'La instantánea sembrada no la acepta el handler real. Antes de tocar la prueba, '
      + 'mirar si cambió el contrato de POST /mapeos.'
    )
  }

  // ── Y la comprobación que hace que sembrar contra la base equivocada se vea ──
  //
  // Sin esto, apuntar ADMINAPP_DB_DE_PRUEBAS a una base que no es la de la API
  // deja todo en verde acá y las pruebas fallan después diciendo que no
  // encuentran ninguna fila, que es el síntoma que no permite adivinar la causa.
  const estado = await pedir('/tiendanube/status')

  if (estado.estado !== 'vinculada' || String(estado.tienda?.tiendanube_user_id) !== String(TIENDA_DE_PRUEBA)) {
    throw new Error(
      'Se sembró la tienda de TiendaNube pero GET /tiendanube/status no la ve: '
      + `devolvió estado «${estado.estado}» y tienda ${JSON.stringify(estado.tienda)}.\n\n`
      + 'La causa, casi siempre, es que falta TIENDANUBE_CLIENT_ID en el arranque de la API: '
      + 'sin esa variable GET /status corta en el primer if y responde «sin_configurar».\n\n'
      + '  · A mano: está en el comando de acá abajo.\n'
      + '  · En CI: va en el paso «Levantar la API con BYPASS_AUTH» de\n'
      + '    .github/workflows/ci.yml, al lado de ALLOWED_ORIGINS.\n\n'
      + '(La otra causa posible ya está descartada acá: si la base fuera otra, la siembra '
      + 'habría fallado antes de escribir nada.)\n\n'
      + COMO_LEVANTAR_LA_API
    )
  }

  if (Number(estado.variantes?.total) < VARIANTES.length) {
    throw new Error(
      `La tienda está vinculada pero GET /status cuenta ${estado.variantes?.total} variantes `
      + `y se sembraron ${VARIANTES.length}. La instantánea quedó a medias.`
    )
  }
}

export default async function preparar() {
  // ── La API tiene que estar arriba, y decir CÓMO levantarla si no lo está ──
  try {
    const salud = await pedir('/health')
    if (!salud.ok) throw new Error(`la API respondió ${JSON.stringify(salud)}`)
  } catch (err) {
    throw new Error(`No hay una API en ${API}.\n\n${COMO_LEVANTAR_LA_API}\n\nMotivo: ${err.message}`)
  }

  // ── El contexto: sin empresa activa no hay pantalla que dibujar ──
  const contexto = await pedir('/empresas/mi-contexto')
  const empresa = contexto.data?.empresaActiva
  if (!empresa) {
    throw new Error(
      'La API está arriba pero no devuelve empresa activa. La base tiene que ser la '
      + 'que el propio arranque siembra (empresa 1, tres sucursales y el usuario test-user-id).'
    )
  }

  // Las seis pantallas de módulos no liberados —recetas, producción, clientes,
  // caja, impuestos y reportes— redirigen a `/pos` si quien mira no es
  // superadmin, y entonces la prueba de las diecisiete pantallas estaría
  // mirando `/pos` diecisiete veces sin que nada avise.
  if (contexto.data?.usuario?.es_superadmin !== true) {
    throw new Error(
      'El usuario de pruebas no es superadmin, así que seis de las diecisiete pantallas '
      + 'redirigen a /pos y la prueba del marco no probaría nada.\n\n'
      + '  cd apps/api && DATABASE_URL=<la de pruebas> DB_SSL=false \\\n'
      + `    node scripts/superadmin.js activar ${contexto.data?.usuario?.email}`
    )
  }

  const sucursal = empresa.puntosDeVenta?.[0]?.id
  if (!sucursal) throw new Error('La empresa de pruebas no tiene ninguna sucursal.')

  // ── El catálogo ──
  const catalogo = await pedir('/products?limit=500')
  const yaSembrados = (catalogo.data || []).filter((p) => String(p.sku || '').startsWith(PREFIJO))

  // ⚠ El catálogo se saltea, pero la función NO termina acá. Antes había un
  // `return` en esta línea y por eso los proveedores no se podían agregar
  // debajo: con el catálogo ya sembrado —o sea, en la segunda corrida y en
  // todas las siguientes— la siembra de proveedores no se ejecutaría nunca.
  const productos = [...yaSembrados]

  if (productos.length < CUANTOS + 1) {
    for (let i = yaSembrados.length; i < CUANTOS; i++) {
      const { data } = await pedir('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: `Producto de prueba ${String(i + 1).padStart(2, '0')}`,
          sku: `${PREFIJO}${String(i + 1).padStart(3, '0')}`,
          barcode: `779${String(i + 1).padStart(10, '0')}`,
          cost: 1000 + i * 137,
          category: 'proteina',
          unit_type: 'unidad',
          taxed: true,
        }),
      })
      productos.push(data)
    }

    const nuevos = productos.filter((p) => !yaSembrados.includes(p))

    if (!productos.some((p) => p.name === NOMBRE_LARGO)) {
      const { data } = await pedir('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: NOMBRE_LARGO,
          // El SKU tiene la MISMA forma que el de los demás —`PRUEBA-` y tres
          // dígitos— y no `PRUEBA-LARGO`, que fue el primer intento. El motivo es
          // el renglón de abajo del nombre: `PRUEBA-LARGO` tiene un guion más y
          // se parte en dos líneas cuando la columna aprieta, así que la fila
          // quedaba 16px más alta **por el SKU** y no por el nombre. La prueba
          // compara esta fila contra una normal: si algo más que el nombre es
          // distinto, lo que falla no es lo que se está probando.
          sku: `${PREFIJO}999`,
          barcode: '7790000009999',
          cost: 9876.54,
          category: 'proteina',
          unit_type: 'unidad',
          taxed: true,
        }),
      })
      productos.push(data)
      nuevos.push(data)
    }

    // Stock en la primera sucursal para todos: un producto agotado se dibuja con
    // `opacity-50` y el botón de agregar deshabilitado, así que sin stock no se
    // pueden cargar las ocho líneas que pide el paso 2.
    if (nuevos.length > 0) {
      await pedir('/stock/bulk', {
        method: 'POST',
        body: JSON.stringify({
          punto_de_venta_id: sucursal,
          items: nuevos.map((p) => ({ product_id: p.id, quantity: 250 })),
        }),
      })
    }
  }

  // ── Los proveedores y sus órdenes ──
  //
  // Las líneas se arman con los ocho primeros productos comunes, así que el
  // catálogo tiene que estar antes. El fallo dice el comando exacto por lo
  // mismo que el de la API: si esto se cae, la mitad de la suite falla midiendo
  // una pantalla vacía y el mensaje tiene que decir qué hacer, no qué esperaba.
  const comunes = productos
    .filter((p) => p.name !== NOMBRE_LARGO)
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)))

  if (comunes.length < 8) {
    throw new Error(
      `Hacen falta 8 productos sembrados para armar las órdenes y hay ${comunes.length}. `
      + `Lo más rápido es tirar la base y volver a empezar:\n\n`
      + '  docker rm -f adminapp-e2e-pg\n\n'
      + COMO_LEVANTAR_LA_API
    )
  }

  // La fecha de los pagos la decide esta siembra; la de las deudas la decide el
  // servidor con la zona horaria de la empresa (T1206), y por eso no se manda.
  const hoy = new Date().toISOString().slice(0, 10)

  try {
    await sembrarProveedores(comunes, hoy)
  } catch (err) {
    throw new Error(
      'No se pudieron sembrar los proveedores y sus órdenes, así que las pruebas de '
      + '/proveedores y /ordenes-compra medirían pantallas vacías.\n\n'
      + 'Si la base quedó a medias, lo más rápido es tirarla y volver a empezar:\n\n'
      + '  docker rm -f adminapp-e2e-pg\n\n'
      + `${COMO_LEVANTAR_LA_API}\n\nMotivo: ${err.message}`
    )
  }

  // ── Los gastos fijos de /gastos ──
  //
  // Van después del catálogo porque necesitan la sucursal, y antes de los
  // módulos por nada en particular: no dependen de ninguno.
  try {
    await sembrarGastosFijos(sucursal)
  } catch (err) {
    throw new Error(
      'No se pudieron sembrar los gastos fijos, así que la prueba de maquetado de /gastos '
      + `mediría una pantalla vacía.\n\n${COMO_LEVANTAR_LA_API}\n\nMotivo: ${err.message}`
    )
  }

  // ── Los módulos, ANTES de cualquier pantalla nueva ──
  //
  // Va acá abajo y no arriba porque no lo necesita nada de lo anterior; y va
  // antes de la tienda porque sin el módulo `/tiendanube` no se puede abrir ni
  // con la tienda sembrada.
  await habilitarLosModulos(empresa.id)

  // ── La tienda de TiendaNube ──
  await sembrarTiendanube(empresa.id, sucursal, comunes)
}

export { NOMBRE_LARGO, PREFIJO, CUANTOS, PROVEEDORES, NOMBRE_DE_GASTO_LARGO, GASTOS_FIJOS }
