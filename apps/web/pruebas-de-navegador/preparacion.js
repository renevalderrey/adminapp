// ════════════════════════════════════════════
//  ADMINAPP · Lo que tiene que existir antes de abrir el navegador
//
//  Corre UNA vez por suite (`globalSetup` de `playwright.config.js`) y hace dos
//  cosas: comprobar que la API descartable esté arriba, y sembrar el catálogo
//  que los pasos de maquetado necesitan.
//
//  ── Por qué el catálogo se siembra y no se dobla ──
//
//  Un test de render dobla el store con `useStore.setState` y no toca la red.
//  Acá no se puede: lo que se está midiendo es el maquetado de la pantalla real
//  con los datos que le entran por el camino real. Si el catálogo viniera de un
//  doble, la prueba diría que el diseño funciona con datos que el sistema no
//  produce.
//
//  Los números salen de los pasos manuales de
//  `docs/specs/011-punto-de-venta/tasks.md`: el paso 2 pide **40 resultados**
//  en el catálogo y 8 líneas en el ticket; el paso 3 pide un producto con un
//  nombre de **80 caracteres**. Por eso son 45 y no «unos cuantos».
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
 */
const NOMBRE_LARGO = 'Suplemento-Proteico-Hidrolizado-De-Suero-Con-Colageno-Y-Magnesio-Sabor-Vainilla'.padEnd(80, '-')

/** El prefijo que hace reconocible lo sembrado, para no duplicarlo en cada corrida. */
const PREFIJO = 'PRUEBA-'

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

export default async function preparar() {
  // ── La API tiene que estar arriba, y decir CÓMO levantarla si no lo está ──
  //
  // Una suite de navegador que falla con «ECONNREFUSED» en cada uno de sus
  // veinte casos no le dice a nadie qué hacer. Falla una vez, acá, con el
  // comando escrito.
  try {
    const salud = await pedir('/health')
    if (!salud.ok) throw new Error(`la API respondió ${JSON.stringify(salud)}`)
  } catch (err) {
    throw new Error(
      `No hay una API en ${API}.\n\n`
      + 'Las pruebas de navegador necesitan una base descartable y la API contra ella:\n\n'
      + '  docker run -d --name adminapp-e2e-pg -e POSTGRES_USER=adminapp \\\n'
      + '    -e POSTGRES_PASSWORD=adminapp -e POSTGRES_DB=adminapp_e2e \\\n'
      + '    -p 55432:5432 postgres:16-alpine\n\n'
      + '  cd apps/api && DATABASE_URL=postgres://adminapp:adminapp@localhost:55432/adminapp_e2e \\\n'
      + '    DB_SSL=false NODE_ENV=development BYPASS_AUTH=true PORT=5099 node src/server.js\n\n'
      + 'Los detalles están en el encabezado de apps/web/playwright.config.js.\n\n'
      + `Motivo: ${err.message}`
    )
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

  if (yaSembrados.length >= CUANTOS + 1) {
    return
  }

  const nuevos = []
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
    nuevos.push(data)
  }

  if (!yaSembrados.some((p) => p.name === NOMBRE_LARGO)) {
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

export { NOMBRE_LARGO, PREFIJO, CUANTOS }
