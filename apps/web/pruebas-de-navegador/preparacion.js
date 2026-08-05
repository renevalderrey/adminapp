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
// ════════════════════════════════════════════

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
  + '    ALLOWED_ORIGINS=http://localhost:5199 node src/server.js\n\n'
  // ⚠ `ALLOWED_ORIGINS` NO es opcional y no estaba escrito en ninguna parte.
  // La lista blanca de CORS de `server.js:112-119` trae 5173, 5174 y 3000, y el
  // servidor de estas pruebas corre en el **5199** (`playwright.config.js`).
  // Sin esa variable, el navegador recibe la respuesta sin cabecera de CORS, la
  // carga del contexto falla, `App.jsx` dibuja «Redirigiendo al inicio de
  // sesión…» y **las diecisiete pruebas fallan diciendo que no encuentran
  // `<main>`** — que es exactamente el síntoma que no permite adivinar la causa.
  // El único rastro es un `WARN CORS: origen rechazado` en el log de la API.
  + 'Los detalles están en el encabezado de apps/web/playwright.config.js.'

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
}

export { NOMBRE_LARGO, PREFIJO, CUANTOS, PROVEEDORES }
