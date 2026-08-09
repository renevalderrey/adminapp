// ════════════════════════════════════════════
//  FAVALIO · La tienda de prueba y su catálogo
//
//  Lo que `/tiendanube` necesita para dibujar algo que se pueda medir: una
//  tienda vinculada y una instantánea de catálogo con variantes.
//
//  ── Por qué esto va por SQL y no por HTTP, que es lo que hace el resto ──
//
//  Porque **no hay ningún endpoint que pueda producir este estado sin una
//  cuenta real de TiendaNube**, y se verificó ruta por ruta contra
//  `contracts/api-endpoints.md` y contra `routes/tiendanube.js`:
//
//   · `GET /auth` solo crea el `state`; no vincula nada.
//   · `GET /callback` exige un `code` que hay que canjear **contra TiendaNube**.
//     Sin cuenta real el canje falla y redirige a `?motivo=tiendanube`.
//   · `POST /variantes/refrescar` sale a pedirle el catálogo a TiendaNube.
//   · `POST /mapeos` exige que la variante ya esté en la instantánea.
//
//  O sea que la única forma de llegar a «tienda vinculada con catálogo» por la
//  puerta de adelante es tener la tienda. Es el supuesto 11 de la spec —**no hay
//  entorno de pruebas de TiendaNube**— visto desde el arnés.
//
//  ── Y por qué esto NO es «doblar la API», que es lo que la convención prohíbe ──
//
//  Lo que `CONVENCIONES.md` prohíbe en este nivel es que **los datos que la
//  pantalla dibuja vengan de un doble**: entonces la prueba diría que el diseño
//  funciona con datos que el sistema no produce. Acá no hay ningún doble. Las
//  filas se escriben en la base de verdad, y **la pantalla las recibe por
//  `GET /api/tiendanube/status` y `GET /api/tiendanube/variantes` reales**, con
//  sus `count`, su paginado, su unión de mapeos en JS y su cálculo de
//  `motivo_no_publicado`. Lo que se saltea es el tercero, no Favalio.
//
//  Dos cosas sostienen que las filas sean las que el sistema produciría:
//
//   1. **El mapeo se crea por HTTP** (`POST /api/tiendanube/mapeos`), o sea que
//      el handler real tiene que aceptar esta instantánea: si las filas no
//      tuvieran la forma que el sistema espera, el mapeo responde 400 y la
//      siembra falla acá y no doce pruebas más tarde.
//   2. **La siembra se comprueba por HTTP** al final: `GET /status` tiene que
//      contestar `vinculada` con este `tiendanube_user_id` y este conteo de
//      variantes. Sin eso, sembrar contra una base **que no es la que la API
//      está usando** pasaría en silencio y las pruebas fallarían diciendo que la
//      pantalla está vacía, que es el síntoma que no deja adivinar la causa.
//
//  ⚠ **`pg` es una dependencia de la API**, no de la web: `apps/web` no lo tiene
//  y no corresponde que lo tenga —este archivo es lo único de la web que toca la
//  base—. Pero **dónde está instalado no se puede escribir a mano**.
//
//  Antes acá decía `../../api/node_modules/pg`, con el motivo «el monorepo no
//  hoistea, cada app instala lo suyo». Eso valía hasta el hito 10: desde que el
//  repositorio usa workspaces de npm hay un solo `node_modules` en la raíz, ese
//  directorio no existe, y la siembra moría con «No se pudo cargar pg» — en el
//  único job del CI que no se puede reproducir con `npm test`.
//
//  Se resuelve pidiéndoselo a Node **empezando por la API**, que es de quien es
//  la dependencia. Así anda hoisteado o anidado, y no vuelve a importar cómo
//  esté armado el árbol de instalación.
// ════════════════════════════════════════════

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ_DE_LA_API = path.resolve(AQUI, '../../api')

/**
 * La base descartable. **Tiene que ser la misma contra la que corre la API**, y
 * `mismaBaseQueLaApi()` lo comprueba **antes** de escribir una sola fila.
 *
 * Los tres escalones, en orden:
 *
 *  1. `FAVALIO_DB_DE_PRUEBAS` — el explícito. Existe para el caso, que ya pasó,
 *     de que el 55432 lo esté ocupando el contenedor del arnés de integración
 *     (`favalio-pg-integracion`): los dos no pueden estar arriba a la vez.
 *  2. `DATABASE_URL` — es lo que el job del navegador de `ci.yml` define a nivel
 *     de job, así que allá esto sale solo.
 *  3. El del comando documentado en `COMO_LEVANTAR_LA_API`.
 *
 * ⚠ El escalón 2 es el que puede apuntar a la base de desarrollo de alguien que
 * la tenga exportada en su terminal. Por eso el chequeo de identidad de abajo no
 * es una comodidad: es lo que convierte «le escribí a la base equivocada» en un
 * fallo con nombre, antes de tocar nada.
 */
const BASE = process.env.FAVALIO_DB_DE_PRUEBAS
  || process.env.DATABASE_URL
  || 'postgres://favalio:favalio@localhost:55432/favalio_e2e'

/** El id de tienda de la tienda de prueba. Fijo, para que la siembra sea repetible. */
export const TIENDA_DE_PRUEBA = 9100001

/** Cómo se llama la tienda en la pantalla. */
export const NOMBRE_DE_LA_TIENDA = 'PRUEBA-Tienda de maquetado'

/**
 * Las cuatro variantes de la instantánea, y por qué cada una es como es.
 *
 * La advertencia de `CONVENCIONES.md` sobre las fixtures manda acá igual que en
 * integración: cuatro variantes de un producto cada una, todas con SKU y todas
 * con nombre corto, pasan con y sin la mitad de lo que estas pruebas dicen
 * medir.
 *
 * ⚠ Los ids son fijos y no autoincrementales: la siembra borra e inserta por id,
 * así que correrla dos veces no duplica, y **los mapeos que cuelgan de estos ids
 * sobreviven** a una segunda corrida.
 */
export const VARIANTES = [
  {
    clave: 'normal',
    tiendanube_variant_id: 9101,
    tiendanube_product_id: 9001,
    // La fila de referencia: es contra sus columnas que se compara la de nombre
    // largo, así que tiene que existir una fila normal sí o sí.
    nombre_producto: 'PRUEBA-Colágeno hidrolizado',
    nombre_variante: '300 g',
    sku: 'PRUEBA-TN-001',
    stock_en_tienda: 7,
  },
  {
    clave: 'segunda_variante',
    tiendanube_variant_id: 9102,
    tiendanube_product_id: 9001,
    // **El mismo `tiendanube_product_id` que la anterior**: la tabla tiene una
    // fila por VARIANTE y no por producto de la tienda, y sin dos variantes del
    // mismo producto eso no se distingue. Además ejercita el desempate del
    // `order` de `GET /variantes`, que existe justamente para esto.
    nombre_producto: 'PRUEBA-Colágeno hidrolizado',
    nombre_variante: '1 kg',
    sku: 'PRUEBA-TN-002',
    stock_en_tienda: 3,
  },
  {
    clave: 'sin_sku',
    tiendanube_variant_id: 9103,
    tiendanube_product_id: 9002,
    // SKU vacío: es el caso de borde que la spec nombra —la sugerencia por SKU
    // tiene que aguantarlo, porque un SKU vacío que coincide con otro SKU vacío
    // mapearía dos productos al azar— y en la tabla se dibuja como «—».
    nombre_producto: 'PRUEBA-Creatina monohidrato',
    nombre_variante: null,
    sku: '',
    stock_en_tienda: 0,
  },
  {
    clave: 'nombre_largo',
    tiendanube_variant_id: 9104,
    tiendanube_product_id: 9003,
    // Las DOS líneas de la primera celda largas, y no solo la de arriba: la
    // celda dibuja `nombre_producto` y debajo `nombre_variante`, las dos con
    // `truncate` propio. Con la segunda corta, sacarle el recorte a la segunda
    // no pondría nada en rojo.
    //
    // Los guiones no son decorativos: sin ellos el texto no tendría dónde
    // partirse y sacar `truncate` seguiría dejándolo desbordado, con lo cual la
    // mutación no distinguiría nada. Con guiones, sacar `truncate` lo hace
    // ENTRAR en la celda, que es el rojo que la prueba busca.
    nombre_producto: 'PRUEBA-Suplemento-Proteico-Hidrolizado-De-Suero-Con-Colageno-Y-Magnesio-Vainilla',
    nombre_variante: 'Talle-Unico-Edicion-Limitada-Aniversario-Sabor-Frutos-Rojos-Del-Sur-Y-Norte',
    sku: 'PRUEBA-TN-004',
    stock_en_tienda: 12,
  },
]

/** Una variante sembrada, por su clave. Buscar por posición se rompe al reordenar. */
export const variante = (clave) => VARIANTES.find((v) => v.clave === clave)

/**
 * Comprueba que la base a la que nos conectamos sea la que la API está usando.
 *
 * ── Por qué va ANTES de escribir y no después ──
 *
 * Porque lo que sigue empieza con dos `DELETE`. Comprobarlo al final —que
 * también se hace, por HTTP, en `preparacion.js`— contesta «esto no funcionó»;
 * comprobarlo acá contesta **«no toqué nada»**, que es lo único que sirve cuando
 * la cadena apuntaba sin querer a la base de desarrollo de alguien.
 *
 * Se comparan el nombre y la fecha de creación de la empresa, que la API acaba
 * de devolver por `GET /api/empresas/:id`. Dos bases distintas con la misma
 * empresa creada en el mismo milisegundo son la misma base.
 */
async function mismaBaseQueLaApi(cliente, empresaId, segunLaApi) {
  const { rows } = await cliente.query(
    'SELECT name, created_at FROM empresas WHERE id = $1',
    [empresaId]
  )

  const enLaBase = rows[0]
  const igual = enLaBase
    && enLaBase.name === segunLaApi.name
    && new Date(enLaBase.created_at).getTime() === new Date(segunLaApi.createdAt).getTime()

  if (igual) return

  const err = new Error(
    `La base ${BASE} NO es la que está usando la API: no se escribió nada.\n\n`
    + `  La API dice que la empresa ${empresaId} es «${segunLaApi.name}», creada el ${segunLaApi.createdAt}.\n`
    + `  Esa base dice ${enLaBase ? `«${enLaBase.name}», creada el ${new Date(enLaBase.created_at).toISOString()}` : 'que esa empresa no existe'}.\n\n`
    + 'Pasá la cadena correcta en FAVALIO_DB_DE_PRUEBAS. Ojo con DATABASE_URL exportada '
    + 'en la terminal: apunta a la base de desarrollo y no a la descartable.'
  )
  err.baseEquivocada = true
  throw err
}

/**
 * Escribe la tienda y su instantánea de catálogo.
 *
 * @param {number} empresaId
 * @param {number} puntoDeVentaId  La sucursal designada. `NOT NULL` en la tabla:
 *   de ahí sale el stock que se publica y ahí se descuenta el pedido.
 * @param {{name: string, createdAt: string}} empresaSegunLaApi  Lo que devolvió
 *   `GET /api/empresas/:id`. Es contra esto que se comprueba que la base sea la
 *   misma, **antes** de escribir.
 */
export async function sembrarLaTienda(empresaId, puntoDeVentaId, empresaSegunLaApi) {
  const require = createRequire(import.meta.url)

  let Client
  try {
    // Por resolución de módulos y no por ruta fija: `pg` puede estar hoisteado
    // en la raíz del workspace o anidado adentro de la API, y las dos son
    // correctas.
    ({ Client } = require(require.resolve('pg', { paths: [RAIZ_DE_LA_API] })))
  } catch (err) {
    throw new Error(
      'No se pudo cargar «pg» partiendo de '
      + `${RAIZ_DE_LA_API}.\n\n`
      + 'Es una dependencia de la API y sale de ahí; apps/web no la tiene. Si falta:\n\n'
      + '  npm ci\n\n'
      + `Motivo: ${err.message}`
    )
  }

  const cliente = new Client({ connectionString: BASE })

  try {
    await cliente.connect()
  } catch (err) {
    throw new Error(
      `No se pudo conectar a la base de pruebas (${BASE}).\n\n`
      + 'Tiene que ser LA MISMA base contra la que corre la API descartable. Si la '
      + 'levantaste en otro puerto, pasala en FAVALIO_DB_DE_PRUEBAS.\n\n'
      + `Motivo: ${err.message}`
    )
  }

  try {
    // Primero de todo, y antes de cualquier escritura: la base tiene que ser la
    // de la API. Tira si no lo es, y el `finally` de abajo cierra la conexión.
    await mismaBaseQueLaApi(cliente, empresaId, empresaSegunLaApi)

    // Una transacción sola: una siembra a medias —tienda sin catálogo— dibuja la
    // pantalla vacía y la prueba falla diciendo que no encuentra ninguna fila,
    // que no dice nada de por qué.
    await cliente.query('BEGIN')

    // Se borra y se inserta, en vez de `ON CONFLICT`: la base de estas pruebas la
    // arma `sequelize.sync()` a partir de los modelos, y `ON CONFLICT (empresa_id,
    // tiendanube_variant_id)` depende de que `sync` haya creado `uq_tn_variante`
    // con esas dos columnas exactas. Un borrado previo no depende de ningún
    // índice y hace lo mismo.
    await cliente.query('DELETE FROM tiendanube_tiendas WHERE empresa_id = $1', [empresaId])

    await cliente.query(
      `INSERT INTO tiendanube_tiendas
         (empresa_id, tiendanube_user_id, nombre, punto_de_venta_id, vinculada_en,
          ultima_comunicacion_en, ultima_comunicacion_ok, catalogo_refrescado_en,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), true, NOW(), NOW(), NOW())`,
      [empresaId, TIENDA_DE_PRUEBA, NOMBRE_DE_LA_TIENDA, puntoDeVentaId]
    )

    const ids = VARIANTES.map((v) => v.tiendanube_variant_id)
    await cliente.query(
      'DELETE FROM tiendanube_variantes WHERE empresa_id = $1 AND tiendanube_variant_id = ANY($2::bigint[])',
      [empresaId, ids]
    )

    for (const v of VARIANTES) {
      // `vista_en = NOW()` y la tienda con `catalogo_refrescado_en = NOW()`: así
      // las cuatro salen con `en_la_tienda: true`. Una variante «que ya no está
      // en tu tienda» es otro estado y otra prueba; acá lo que se mide es el
      // maquetado de una fila normal.
      await cliente.query(
        `INSERT INTO tiendanube_variantes
           (empresa_id, tiendanube_variant_id, tiendanube_product_id, nombre_producto,
            nombre_variante, sku, stock_en_tienda, vista_en, intentos, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 0, NOW(), NOW())`,
        [
          empresaId,
          v.tiendanube_variant_id,
          v.tiendanube_product_id,
          v.nombre_producto,
          v.nombre_variante,
          v.sku,
          v.stock_en_tienda,
        ]
      )
    }

    await cliente.query('COMMIT')
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {})

    // El de «no es la base de la API» ya dice todo lo que hay que hacer y
    // envolverlo lo escondería detrás de un consejo que no aplica: tirar el
    // contenedor no arregla una cadena de conexión equivocada.
    if (err.baseEquivocada) throw err

    throw new Error(
      'No se pudo sembrar la tienda de TiendaNube.\n\n'
      + 'Si la base es anterior a este hito, las cinco tablas de TiendaNube no existen. '
      + 'Lo más rápido es tirarla y volver a empezar:\n\n'
      + '  docker rm -f favalio-e2e-pg\n\n'
      + `Motivo: ${err.message}`
    )
  } finally {
    await cliente.end().catch(() => {})
  }
}
