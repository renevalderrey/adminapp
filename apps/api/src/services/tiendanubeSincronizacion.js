// ════════════════════════════════════════════
//  ADMINAPP · TiendaNube · lo que habla con la tienda
//
//  Acá vive lo que hace red: traer el catálogo entero y escribir la instantánea.
//  Las reglas —normalizar la respuesta, el backoff, clasificar un error— son
//  funciones puras y viven en `utils/tiendanubeCatalogo.js` y
//  `utils/tiendanubeCola.js`. Llamar «regla» a un GET contra la API de un
//  tercero es cómo una función pura deja de serlo y su test pasa a probar un
//  doble.
//
//  ── Por qué este archivo existe y el descuento NO se muda acá ──
//
//  `descuentoDeStock.test.js:227` ancla sobre `services/tiendanubeService.js`
//  tres cosas: que haya **exactamente un** bloque de búsqueda de fila de stock,
//  que no busque por una sucursal que pueda ser nula, y que la sucursal salga de
//  `utils/sucursalDeStock`. Mudar `processOrderCreated` dejaría ese ancla mirando
//  un archivo sin ninguna búsqueda de stock: **en verde sin haber mirado nada**,
//  que es el modo de falla que este repositorio viene juntando.
//
//  Y por eso también este archivo está separado: la sincronización **también**
//  lee `Stock`, y meterla allá subiría el conteo a dos sin que nada explique por
//  qué. `descuentoDeStock.test.js` lee archivos por nombre, no el directorio, así
//  que este archivo le es invisible — a propósito.
//
//  ── Por qué hay una instantánea local y no un pasamanos ──
//
//  Contar cuántas variantes hay, cuántas están mapeadas, y buscar por nombre o
//  por SKU **no se puede contestar sobre una página que todavía no se pidió**, y
//  filtrar sobre la página que llegó es el mismo defecto con otro nombre — es
//  literalmente el que tuvo la pantalla de órdenes de compra: buscar una que
//  existía devolvía «ninguna coincide» y la red ni se tocaba.
//
//  La instantánea **no es una segunda fuente de verdad**: el catálogo de
//  TiendaNube no es un dato de AdminApp, es la respuesta de un tercero con la
//  fecha en que se pidió a la vista. Esa fecha no es decorado: es lo que evita
//  que alguien lea una instantánea vieja creyendo que es el estado actual.
// ════════════════════════════════════════════

const { Op, literal } = require('sequelize');
const {
  sequelize,
  Product,
  Stock,
  TiendanubeCorrida,
  TiendanubeEstadoOauth,
  TiendanubeMapping,
  TiendanubeTienda,
  TiendanubeVariante,
} = require('../models');
const tiendanubeService = require('./tiendanubeService');
const { normalizarCatalogo } = require('../utils/tiendanubeCatalogo');
const {
  clasificarError,
  hayQueEmpujar,
  proximoIntento,
  stockAPublicar,
  CLASES,
  MOTIVOS_NO_PUBLICADO,
} = require('../utils/tiendanubeCola');
const { ErrorDeNegocio } = require('../utils/errores');
const logger = require('../utils/logger');

/**
 * Cuánto dura el arriendo de una sincronización antes de darse por muerto.
 *
 * ⚠ **Es el único lugar donde vive este número.** Hasta este corte había dos
 * —uno acá y otro en `routes/tiendanube.js`, cada uno con su predicado—, que es
 * la forma exacta de tener dos relojes para el mismo arriendo: el día que
 * alguien suba uno a quince minutos, `GET /status` va a decir «sincronizando»
 * sobre una tienda que la corrida ya soltó, o al revés. La ruta importa el
 * predicado de acá.
 *
 * Diez minutos: un arriendo vencido es una corrida que murió, no una corriendo,
 * y sin vencimiento una caída dejaría la sincronización bloqueada hasta que
 * alguien entre a la base a borrar la fecha a mano.
 */
const ARRIENDO_DE_SINCRONIZACION_MS = 10 * 60 * 1000;

/**
 * Cuánto se puede esperar **en total** dentro de un `POST /sincronizar` por los
 * 429 de TiendaNube.
 *
 * ⚠ Es un presupuesto de la corrida entera y no de cada variante, y eso es lo
 * que importa: un catálogo de dos mil variantes con la cuota agotada, esperando
 * diez segundos por cada una, deja el request colgado durante horas con alguien
 * mirando el botón. Lo que no entra en el presupuesto **no se pierde**: la fila
 * queda con `proximo_intento_en` calculado por `proximoIntento`, que respeta el
 * `Retry-After` de la tienda, y la corrida sigue con las demás (FR-041, FR-048).
 */
const PRESUPUESTO_DE_ESPERA_MS = 30 * 1000;

/** El largo de `tiendanube_tiendas.ultimo_error`. */
const LARGO_DEL_ERROR = 200;

/**
 * Las columnas de la instantánea que el refresco pisa.
 *
 * ⚠ **La lista es exhaustiva a propósito y NO incluye las de la cola.**
 * `stock_publicado`, `publicado_en`, `pendiente_desde`, `intentos`,
 * `ultimo_error` y `motivo_no_publicado` son lo que le debemos a la variante, no
 * lo que la tienda dice de ella: pisarlas con cada refresco borraría el registro
 * de lo que se mandó y sacaría de la cola todo lo que estaba esperando, una vez
 * por día y sin que nada avise.
 */
const COLUMNAS_DEL_CATALOGO = [
  'tiendanube_product_id',
  'nombre_producto',
  'nombre_variante',
  'sku',
  'stock_en_tienda',
  'vista_en',
  'updatedAt',
];

/** ¿Hay una sincronización viva sobre esta tienda? */
function haySincronizacionEnCurso(tienda) {
  if (!tienda.sincronizando_desde) return false;

  const desde = new Date(tienda.sincronizando_desde).getTime();
  return Date.now() - desde < ARRIENDO_DE_SINCRONIZACION_MS;
}

/**
 * Deja escrito cómo salió la última comunicación con la tienda.
 *
 * Es de donde sale el cuarto estado de FR-006 —«vinculada con error»— y el aviso
 * de FR-049: un 401 no es «no se pudo sincronizar», es «hay que volver a
 * vincular», y la pantalla no puede distinguirlos si nadie lo escribe.
 *
 * ⚠ `ultimo_error` guarda el **mensaje clasificado**, nunca `err.message`: la
 * pantalla lo muestra tal cual, y un error de axios trae la URL con el id de la
 * tienda adentro.
 */
async function registrarComunicacion(tienda, ok, err = null) {
  const info = err ? clasificarError(err) : null;

  const mensaje = info && info.mensaje
    ? info.mensaje
    : 'No se pudo hablar con TiendaNube.';

  await tienda.update({
    ultima_comunicacion_en: new Date(),
    ultima_comunicacion_ok: ok,
    ultimo_error: ok ? null : mensaje.slice(0, LARGO_DEL_ERROR),
  });
}

/**
 * Trae **todas** las páginas del catálogo y reescribe la instantánea.
 *
 * ── Lo que NO hace: borrar ──
 *
 * Las variantes que no se vieron en este refresco **se quedan**, con su
 * `vista_en` viejo, y el listado las marca `en_la_tienda: false`. Borrarlas se
 * llevaría el registro de lo que se publicó y dejaría al mapeo apuntando a la
 * nada sin ninguna explicación: la pantalla mostraría «sin mapear» sobre una
 * variante que alguien mapeó, y nadie podría saber que la variante se borró del
 * otro lado.
 *
 * @returns {Promise<{variantes: number, nuevas: number, desaparecidas: number,
 *   paginas: number, refrescado_en: Date}>}
 */
async function refrescarCatalogo(empresaId) {
  const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: empresaId } });
  if (!tienda) throw new ErrorDeNegocio('No hay ninguna tienda vinculada.', 409);

  if (haySincronizacionEnCurso(tienda)) {
    throw new ErrorDeNegocio('Hay una sincronización en curso. Esperá a que termine.', 409);
  }

  // ⚠ **Un solo instante para las dos cosas.** `vista_en` de cada fila y
  // `catalogo_refrescado_en` de la tienda tienen que ser el MISMO valor: el
  // listado decide «esta variante ya no está en la tienda» comparando los dos, y
  // con dos relojes distintos —uno antes y otro después de veinte llamadas— todo
  // el catálogo recién traído quedaría marcado como desaparecido.
  const refrescadoEn = new Date();

  let paginas;

  try {
    paginas = await tiendanubeService.getProducts(empresaId);
  } catch (err) {
    await registrarComunicacion(tienda, false, err);
    throw tiendanubeService.errorDeTiendanube(err);
  }

  const filas = normalizarCatalogo(paginas);

  // Las que ya estaban, para poder contar cuántas son nuevas y cuántas dejaron
  // de estar. Se traen los ids y nada más: el catálogo entero no tiene por qué
  // viajar por el pool para calcular dos números.
  const existentes = await TiendanubeVariante.findAll({
    where: { empresa_id: empresaId },
    attributes: ['id', 'tiendanube_variant_id'],
  });

  // BIGINT: el driver devuelve `int8` como string y la API como número. Comparar
  // sin normalizar contaría como «nueva» a cada variante en cada refresco.
  const conocidas = new Set(existentes.map((v) => String(v.tiendanube_variant_id)));
  const vistas = new Set(filas.map((f) => String(f.tiendanube_variant_id)));

  const nuevas = filas.filter((f) => !conocidas.has(String(f.tiendanube_variant_id))).length;
  const desaparecidas = existentes.filter((v) => !vistas.has(String(v.tiendanube_variant_id))).length;

  if (filas.length) {
    await TiendanubeVariante.bulkCreate(
      filas.map((f) => ({ empresa_id: empresaId, ...f, vista_en: refrescadoEn })),
      {
        // El conflicto es contra `uq_tn_variante`, que NO es la clave primaria:
        // sin `conflictAttributes` Sequelize apuntaría al `id` y cada refresco
        // insertaría el catálogo entero de nuevo.
        conflictAttributes: ['empresa_id', 'tiendanube_variant_id'],
        updateOnDuplicate: COLUMNAS_DEL_CATALOGO,
      }
    );
  }

  await tienda.update({
    catalogo_refrescado_en: refrescadoEn,
    ultima_comunicacion_en: refrescadoEn,
    ultima_comunicacion_ok: true,
    ultimo_error: null,
  });

  logger.info(
    { empresaId, variantes: filas.length, nuevas, desaparecidas, paginas: paginas.length },
    'tiendanube: catálogo refrescado'
  );

  return {
    variantes: filas.length,
    nuevas,
    desaparecidas,
    paginas: paginas.length,
    refrescado_en: refrescadoEn,
  };
}

// ════════════════════════════════════════════
//  La corrida explícita: el botón «Sincronizar» y, más adelante, la
//  reconciliación diaria
//
//  ── Qué hacía antes, y por qué gana el número equivocado ──
//
//  `syncStock` recorría **todas las filas de `Stock` de la empresa** y mandaba
//  un PUT por cada una cuyo producto estuviera mapeado. Con tres sucursales son
//  tres PUT a la misma variante con tres números distintos, y **gana el último**,
//  en el orden que devuelva la consulta — que nadie definió. Comprafit tiene tres
//  sucursales. Acá se recorren **los mapeos**, que son una fila por variante:
//  eso, y no una comprobación, es lo que hace que el PUT sea exactamente uno.
//
//  Y mandaba `quantity`. Se manda `available`, que es lo que se puede vender.
//
//  ── Lo que este archivo NO registra ──
//
//  El empujón por movimiento de stock (fase 7) **no escribe una fila de
//  corrida**: serían cientos de filas diarias que nadie lee y que crecen sin
//  tope. Su estado vive en la fila de la variante —`pendiente_desde`,
//  `intentos`, `ultimo_error`—, que además dice qué está desfasado **ahora** en
//  vez de qué pasó en un lote.
// ════════════════════════════════════════════

/**
 * Toma el arriendo de la sincronización de una empresa (FR-044).
 *
 * ⚠ **Es UNA sentencia condicional y tiene que seguir siéndolo.** Un `findOne`
 * seguido de un `update` deja pasar a los dos: cuando cada uno lee, ninguno
 * escribió todavía, y las dos corridas mandan PUT a las mismas variantes. Lo
 * único que decide quién gana es la base, igual que el `state` del OAuth y que
 * `POST /api/sales`.
 *
 * El reloj es el de **Postgres** (`NOW()`), no el del proceso: con varias
 * instancias, dos relojes de Node desfasados abrirían y cerrarían el arriendo en
 * momentos distintos.
 *
 * La ventana se interpola desde la constante de arriba —es un número que
 * calculamos nosotros, no un dato del cliente— para que no haya dos lugares que
 * digan cuánto dura el arriendo.
 *
 * @returns {Promise<boolean>} `false` = ya hay una corriendo.
 */
async function tomarArriendo(empresaId) {
  const minutos = ARRIENDO_DE_SINCRONIZACION_MS / 60000;

  const [filas] = await sequelize.query(
    `UPDATE tiendanube_tiendas
        SET sincronizando_desde = NOW()
      WHERE empresa_id = $1
        AND (sincronizando_desde IS NULL
             OR sincronizando_desde < NOW() - INTERVAL '${minutos} minutes')
      RETURNING empresa_id`,
    { bind: [empresaId] }
  );

  return Boolean(filas && filas.length);
}

/**
 * Suelta el arriendo.
 *
 * ⚠ **Va por `TiendanubeTienda.update` de clase y NO por `tienda.update`.** La
 * instancia se cargó **antes** del `UPDATE` que tomó el arriendo, así que sigue
 * teniendo `sincronizando_desde: null` en memoria: pedirle que lo ponga en
 * `null` no es un cambio, Sequelize no emite ninguna sentencia, y la fila queda
 * arrendada diez minutos con la corrida ya terminada. El síntoma sería «hay una
 * sincronización en curso» sobre una tienda quieta.
 */
async function soltarArriendo(empresaId) {
  await TiendanubeTienda.update(
    { sincronizando_desde: null },
    { where: { empresa_id: empresaId } }
  );
}

/**
 * Qué le pasó a esta variante, en castellano y para que lo lea una persona.
 *
 * El 404 se nombra aparte porque es el caso más frecuente y el único que la
 * clasificación genérica no puede explicar: `PUT /products/variants/{id}` contra
 * una variante borrada del otro lado es una petición «mal armada» para
 * `clasificarError` —un 4xx que no es 401 ni 429— y su mensaje sería el genérico
 * de AdminApp. Quien mira la pantalla necesita saber que la variante ya no está,
 * porque lo que hay que hacer es refrescar el catálogo y borrar el mapeo.
 */
function motivoDelFallo(err) {
  const info = clasificarError(err);

  if (info.status === 404) return 'La variante ya no existe en tu tienda.';

  return info.mensaje || 'AdminApp no pudo publicar el stock de esta variante.';
}

/**
 * Deja la variante publicada: lo que se mandó, cuándo, y fuera de la cola.
 *
 * `motivo_no_publicado` queda en `producto_inactivo` cuando el producto del
 * sistema está inactivo, **aunque se haya publicado igual** ([PENDIENTE N10]):
 * publicar cero por estar inactivo agotaría en la tienda una variante que se
 * podría estar vendiendo, y dejar de publicarla la congelaría en el último
 * número. Se publica y se marca, para que la pantalla pueda señalar la fila.
 */
async function anotarPublicada(variante, numero, producto) {
  if (!variante) return;

  await variante.update({
    stock_publicado: numero,
    publicado_en: new Date(),
    pendiente_desde: null,
    proximo_intento_en: null,
    intentos: 0,
    ultimo_error: null,
    motivo_no_publicado: producto && producto.is_active === false
      ? MOTIVOS_NO_PUBLICADO.PRODUCTO_INACTIVO
      : null,
  });
}

/**
 * La variante mapeada que **no se pudo** publicar por una condición del sistema.
 *
 * ⚠ **Sale de la cola** (FR-046). Sin fila de stock en la sucursal designada no
 * hay ningún número que mandar, y dejarla pendiente haría que el drenaje la
 * reintentara para siempre sin llegar a hacer ninguna llamada, con el contador
 * de pendientes clavado en un número que nadie puede bajar. Cuando aparezca la
 * fila de stock, el hook de `Stock` la vuelve a encolar — que es exactamente el
 * momento en que hay algo nuevo que publicar.
 */
async function anotarNoPublicada(variante, motivo) {
  if (!variante) return;

  await variante.update({
    motivo_no_publicado: motivo,
    pendiente_desde: null,
    proximo_intento_en: null,
    intentos: 0,
    ultimo_error: null,
  });
}

/**
 * La variante que falló: queda encolada, con su error y su próximo intento.
 *
 * `proximo_intento_en` en `null` significa «no se reintenta sola»: es lo que
 * pasa a los ocho intentos y con los errores que no se arreglan esperando —un
 * 404, un token revocado—. `pendiente_desde` **se conserva**: la pantalla la
 * muestra en rojo y una corrida manual o la reconciliación son las que la
 * vuelven a mover.
 */
async function anotarFallo(variante, err) {
  if (!variante) return;

  const info = clasificarError(err);
  const intentos = Number(variante.intentos || 0) + 1;

  await variante.update({
    intentos,
    // Clasificado, nunca `err.message`: un error de axios trae la URL con el id
    // de la tienda adentro y esta columna la lee la pantalla.
    ultimo_error: motivoDelFallo(err).slice(0, LARGO_DEL_ERROR),
    pendiente_desde: variante.pendiente_desde || new Date(),
    proximo_intento_en: info.reintentable
      ? proximoIntento(intentos, info.retryAfter)
      : null,
  });
}

/**
 * El PUT de una variante, con **un** reintento por 429 mientras haya presupuesto.
 *
 * Un 429 no es un error: es «más despacio». Pero acá hay alguien esperando una
 * respuesta, así que la espera es del tamaño que se puede pedir y sale de un
 * presupuesto común a toda la corrida. Lo que no entra, la corrida lo deja
 * encolado y sigue.
 *
 * @param {{gastado: number}} presupuesto Se muta: es de la corrida, no de la
 *   variante.
 */
async function publicarUna(empresaId, varianteId, numero, presupuesto) {
  for (let intento = 0; ; intento++) {
    try {
      return await tiendanubeService.updateVariantStock(empresaId, varianteId, numero);
    } catch (err) {
      const info = clasificarError(err);
      if (info.clase !== CLASES.LIMITE || intento > 0) throw err;

      const espera = tiendanubeService.esperaPorLimite(info.retryAfter, intento);
      if (presupuesto.gastado + espera > PRESUPUESTO_DE_ESPERA_MS) throw err;

      presupuesto.gastado += espera;
      await tiendanubeService.dormir(espera);
    }
  }
}

/**
 * Un PUT por mapeo, con el `available` de la sucursal designada.
 *
 * Las tres consultas de contexto —variantes, productos y stock— se hacen **una
 * vez para toda la corrida** y no una por variante: dos mil variantes serían
 * seis mil consultas para armar tres mapas.
 *
 * ⚠ Ninguna usa `include`: se traen las filas planas y se unen en JS por
 * `(empresa_id, tiendanube_variant_id)` y por `product_id`, que es lo que deja
 * el ancla de `analizarIncludes` donde está.
 */
async function publicarLasMapeadas(tienda, mapeos) {
  const empresaId = tienda.empresa_id;
  const variantesId = mapeos.map((m) => m.tiendanube_variant_id);
  const productIds = [...new Set(mapeos.map((m) => m.product_id))];

  const variantes = await TiendanubeVariante.findAll({
    where: { empresa_id: empresaId, tiendanube_variant_id: { [Op.in]: variantesId } },
  });

  const productos = await Product.findAll({
    where: { empresa_id: empresaId, id: { [Op.in]: productIds } },
    attributes: ['id', 'name', 'is_active'],
  });

  // El stock **de la sucursal designada** y de ninguna otra: es de donde sale lo
  // que se publica, y es la mitad que hace que el PUT sea uno solo.
  const stocks = await Stock.findAll({
    where: {
      empresa_id: empresaId,
      punto_de_venta_id: tienda.punto_de_venta_id,
      product_id: { [Op.in]: productIds },
    },
    attributes: ['product_id', 'available'],
  });

  // BIGINT: el driver devuelve `int8` como string y la API como número. La clave
  // del mapa es el string de los dos lados o no encuentra nunca nada.
  const variantePorId = new Map(variantes.map((v) => [String(v.tiendanube_variant_id), v]));
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const disponiblePorProducto = new Map(stocks.map((s) => [s.product_id, s.available]));

  const resumen = { mandadas: 0, fallidas: 0, omitidas: 0, fallas: [], corte: null, ultimoError: null };
  const presupuesto = { gastado: 0 };

  for (const mapeo of mapeos) {
    const variante = variantePorId.get(String(mapeo.tiendanube_variant_id)) || null;
    const producto = productoPorId.get(mapeo.product_id) || null;

    const disponible = disponiblePorProducto.has(mapeo.product_id)
      ? disponiblePorProducto.get(mapeo.product_id)
      : null;

    // ⚠ **No se publica cero** (FR-046). Publicar cero por no tener fila de
    // stock agota en la tienda una variante que sí tiene mercadería: el producto
    // deja de venderse y nadie entiende por qué. No se manda nada y queda
    // escrito el motivo, que es lo que la pantalla muestra.
    if (disponible === null || disponible === undefined) {
      resumen.omitidas += 1;
      await anotarNoPublicada(variante, MOTIVOS_NO_PUBLICADO.SIN_STOCK_EN_SUCURSAL);
      continue;
    }

    const numero = stockAPublicar(disponible);

    try {
      await publicarUna(empresaId, mapeo.tiendanube_variant_id, numero, presupuesto);
    } catch (err) {
      // **El fallo NO corta la corrida** (FR-041). Antes el primer error
      // respondía 502 y el conteo que se venía juntando se perdía: quien
      // apretaba el botón no sabía cuántas variantes habían entrado ni cuáles
      // faltaban, y del lado de TiendaNube quedaban «las primeras N, no sé
      // cuáles».
      resumen.fallidas += 1;
      // El error entero y no su texto: `registrarComunicacion` lo vuelve a
      // clasificar para escribir el mensaje de la tienda, y un `new Error(texto)`
      // reconstruido perdería el `response.status` que es lo que lo clasifica.
      resumen.ultimoError = err;
      resumen.fallas.push({
        variante: mapeo.tiendanube_variant_id,
        sku: variante ? variante.sku : null,
        motivo: motivoDelFallo(err),
      });

      await anotarFallo(variante, err);

      // La única excepción, y por eso está acá abajo y no arriba: con el token
      // revocado **todas** las que faltan van a fallar igual. Seguir sería
      // gastar la cuota de la tienda para juntar dos mil veces el mismo error.
      if (clasificarError(err).hayQueVolverAVincular) {
        resumen.corte = err;
        break;
      }

      continue;
    }

    resumen.mandadas += 1;
    await anotarPublicada(variante, numero, producto);
  }

  return resumen;
}

/**
 * Una corrida explícita de sincronización de stock.
 *
 * El orden de los pasos es el del contrato y no es cosmético: el arriendo va
 * **antes** que cualquier otra cosa, porque es lo que impide que dos corridas
 * manden PUT a las mismas variantes; y la fila de `tiendanube_corridas` se crea
 * recién cuando hay algo que publicar, porque una corrida sin mapeos no es una
 * corrida —es un aviso— y dejaría una fila que la pantalla muestra como «se
 * cortó por la mitad».
 *
 * **El 200 con fallas es el contrato, no un descuido**: el resultado dice
 * cuántas entraron y cuáles no.
 *
 * @param {number} empresaId
 * @param {{disparador?: 'manual'|'reconciliacion', usuarioId?: string|null}} opciones
 * @returns {Promise<{corrida_id: number, mandadas: number, fallidas: number,
 *   omitidas: number, fallas: Array<object>}>}
 */
async function sincronizar(empresaId, { disparador = 'manual', usuarioId = null } = {}) {
  const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: empresaId } });
  if (!tienda) throw new ErrorDeNegocio('No hay ninguna tienda vinculada.', 409);

  if (!(await tomarArriendo(empresaId))) {
    throw new ErrorDeNegocio('Ya hay una sincronización en curso. Esperá a que termine.', 409);
  }

  try {
    const mapeos = await TiendanubeMapping.findAll({
      where: { empresa_id: empresaId },
      attributes: ['id', 'product_id', 'tiendanube_variant_id'],
    });

    // Sin mapeos no se manda ninguna llamada y se dice por qué (US5 escenario 9).
    // Antes la corrida salía «exitosa» con cero variantes y nadie podía saber si
    // era que no había nada que publicar o que algo no había andado.
    if (!mapeos.length) {
      throw new ErrorDeNegocio(
        'No hay ningún producto mapeado: no hay nada que publicar en la tienda.',
        400
      );
    }

    const corrida = await TiendanubeCorrida.create({
      empresa_id: empresaId,
      empezada_en: new Date(),
      disparador,
      usuario_id: usuarioId,
      mandadas: 0,
      fallidas: 0,
      fallas: null,
    });

    const resumen = await publicarLasMapeadas(tienda, mapeos);

    await corrida.update({
      terminada_en: new Date(),
      mandadas: resumen.mandadas,
      fallidas: resumen.fallidas,
      // Solo las que fallaron ([PENDIENTE N2]): con un catálogo grande, las que
      // salieron bien son cientos de entradas que nadie lee. `null` y no `[]`
      // para que «no hubo fallas» y «no se miró» no se vean igual.
      fallas: resumen.fallas.length ? resumen.fallas : null,
    });

    // ⚠ La regla es «¿pudimos hablar con la tienda?», no «¿salió todo bien?».
    // Una variante borrada del otro lado devuelve 404 y eso no es un problema de
    // comunicación: marcar la tienda en rojo por una fila de dos mil mandaría a
    // volver a vincular una integración que anda.
    if (resumen.mandadas > 0) {
      await registrarComunicacion(tienda, true);
    } else if (resumen.fallidas > 0) {
      await registrarComunicacion(tienda, false, resumen.corte || resumen.ultimoError);
    }

    logger.info(
      {
        empresaId,
        corridaId: corrida.id,
        disparador,
        mandadas: resumen.mandadas,
        fallidas: resumen.fallidas,
        omitidas: resumen.omitidas,
      },
      'tiendanube: corrida de sincronización terminada'
    );

    // El 401 se corta y sale como «hay que volver a vincular» (FR-049), pero la
    // corrida **ya quedó escrita** con lo que alcanzó a mandar: el usuario tiene
    // que poder ver cuántas entraron antes de que el token dejara de valer.
    if (resumen.corte) throw tiendanubeService.errorDeTiendanube(resumen.corte);

    return {
      corrida_id: corrida.id,
      mandadas: resumen.mandadas,
      fallidas: resumen.fallidas,
      omitidas: resumen.omitidas,
      fallas: resumen.fallas,
    };
  } finally {
    // Pase lo que pase. Un `throw` que dejara el arriendo puesto bloquearía la
    // sincronización de esa empresa durante diez minutos por un error que ya se
    // le contó al usuario.
    await soltarArriendo(empresaId);
  }
}

// ════════════════════════════════════════════
//  La cola: el empujón por movimiento de stock
//
//  ── Qué problema cierra, y por qué no alcanza con la corrida explícita ──
//
//  Empujar en cada movimiento **y nada más** tiene un modo de falla que las otras
//  opciones no tienen: si un empujón falla —la API caída, un 429, un token
//  vencido— esa variante queda desfasada **en silencio y para siempre**, porque
//  el disparador ya ocurrió y no hay nada que lo reintente. La cola es lo que le
//  da un segundo intento, y la reconciliación diaria lo que atrapa lo que ni
//  siquiera llegó a encolarse.
//
//  ── Dónde corre, y por qué no es un `setInterval` ──
//
//  `server.js:198-204` lo explica: en el free tier de Render el servicio duerme a
//  los 15 minutos sin tráfico y `setInterval` **no dispara mientras duerme**. Un
//  temporizador que no corre de noche es peor que no tenerlo, porque parece que
//  está. El drenaje lo dispara la propia petición que movió el stock, con
//  `setImmediate` después de responder: si el proceso está dormido, no hay
//  movimiento que encolar.
//
//  ── Lo que este archivo NO escribe acá ──
//
//  Una fila de `tiendanube_corridas`. El empujón por movimiento puede pasar
//  cientos de veces por día y serían cientos de filas que nadie lee y que crecen
//  sin tope. Su estado vive en la fila de la variante —`pendiente_desde`,
//  `intentos`, `ultimo_error`—, que además contesta algo que un registro de lotes
//  no puede: **qué está desfasado ahora**.
// ════════════════════════════════════════════

/**
 * Cuántas variantes toma un drenaje.
 *
 * No es un límite de negocio: es lo que impide que un catálogo entero recién
 * encolado —cambiar la sucursal designada encola **todas** las mapeadas— se
 * convierta en dos mil PUT seguidos disparados desde el `setImmediate` de una
 * venta. Lo que no entra queda pendiente y lo levanta el drenaje siguiente.
 */
const TOPE_DEL_DRENAJE = 200;

/**
 * Un solo drenaje simultáneo por empresa, dentro de este proceso.
 *
 * ⚠ No reemplaza al arriendo y no es lo mismo: el arriendo es de la **base** y
 * sirve entre instancias y contra la corrida manual; este `Map` evita que diez
 * movimientos de stock de la misma venta disparen diez drenajes que se pisan
 * antes de llegar a pedirle nada a Postgres.
 */
const drenajesEnCurso = new Map();

/** Las filas que están en la cola **y** ya les toca. */
function enLaColaYVencidas(empresaId) {
  return {
    empresa_id: empresaId,
    pendiente_desde: { [Op.not]: null },
    // ⚠ `NULL` queda afuera, y es exactamente lo que corresponde:
    // `proximo_intento_en = null` con `pendiente_desde` puesto significa «ya no
    // se reintenta sola» —se agotaron los ocho intentos, o el error no se arregla
    // esperando—. Esa fila la mueve una corrida manual o la reconciliación, no el
    // drenaje.
    //
    // El reloj es el de **Postgres** y no el del proceso: con varias instancias,
    // dos relojes de Node desfasados tomarían la cola en momentos distintos.
    proximo_intento_en: { [Op.lte]: literal('NOW()') },
  };
}

/**
 * Publica las variantes que están esperando en la cola.
 *
 * ⚠ **Acá sí se usa `hayQueEmpujar`, y la corrida explícita NO.** Es la
 * diferencia entre «el usuario pidió republicar todo» y «hay que empujar lo que
 * cambió»: el drenaje corre cientos de veces por día contra una API con cuota,
 * así que una variante cuyo número no se movió no gasta una llamada.
 *
 * Las tres consultas de contexto se hacen **una vez** para todo el drenaje y no
 * una por fila, igual que en la corrida.
 */
async function publicarLasPendientes(tienda, filas) {
  const empresaId = tienda.empresa_id;
  const variantesId = filas.map((f) => f.tiendanube_variant_id);

  const mapeos = await TiendanubeMapping.findAll({
    where: { empresa_id: empresaId, tiendanube_variant_id: { [Op.in]: variantesId } },
    attributes: ['product_id', 'tiendanube_variant_id'],
  });

  const productIds = [...new Set(mapeos.map((m) => m.product_id))];

  const productos = productIds.length
    ? await Product.findAll({
      where: { empresa_id: empresaId, id: { [Op.in]: productIds } },
      attributes: ['id', 'name', 'is_active'],
    })
    : [];

  // El stock **de la sucursal designada** y de ninguna otra: es de donde sale lo
  // que se publica.
  const stocks = productIds.length
    ? await Stock.findAll({
      where: {
        empresa_id: empresaId,
        punto_de_venta_id: tienda.punto_de_venta_id,
        product_id: { [Op.in]: productIds },
      },
      attributes: ['product_id', 'available'],
    })
    : [];

  // BIGINT: el driver devuelve `int8` como string. La clave del mapa es el
  // string de los dos lados o no encuentra nunca nada.
  const productoDeLaVariante = new Map(mapeos.map((m) => [String(m.tiendanube_variant_id), m.product_id]));
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const disponiblePorProducto = new Map(stocks.map((s) => [s.product_id, s.available]));

  const resumen = { mandadas: 0, fallidas: 0, omitidas: 0, fallas: [], corte: null, ultimoError: null };
  const presupuesto = { gastado: 0 };

  for (const fila of filas) {
    const productId = productoDeLaVariante.get(String(fila.tiendanube_variant_id));

    // El mapeo se borró mientras la fila esperaba en la cola. Sale de la cola con
    // su motivo: reintentarla sería publicar el stock de un producto que ya nadie
    // asoció a esa variante.
    if (productId === undefined) {
      resumen.omitidas += 1;
      await anotarNoPublicada(fila, MOTIVOS_NO_PUBLICADO.SIN_MAPEO);
      continue;
    }

    const producto = productoPorId.get(productId) || null;

    const disponible = disponiblePorProducto.has(productId)
      ? disponiblePorProducto.get(productId)
      : null;

    if (!hayQueEmpujar(fila, disponible)) {
      resumen.omitidas += 1;
      // Sin fila de stock en la designada **no se publica cero** (FR-046):
      // publicar cero agota en la tienda una variante que sí tiene mercadería.
      // Con el número igual al que ya se mandó, el motivo es `null`: no pasó
      // nada, simplemente no hay nada que empujar.
      await anotarNoPublicada(
        fila,
        disponible === null || disponible === undefined
          ? MOTIVOS_NO_PUBLICADO.SIN_STOCK_EN_SUCURSAL
          : null
      );
      continue;
    }

    const numero = stockAPublicar(disponible);

    try {
      await publicarUna(empresaId, fila.tiendanube_variant_id, numero, presupuesto);
    } catch (err) {
      resumen.fallidas += 1;
      resumen.ultimoError = err;
      resumen.fallas.push({
        variante: fila.tiendanube_variant_id,
        sku: fila.sku,
        motivo: motivoDelFallo(err),
      });

      // La fila **se queda encolada**, con su espera creciente. Es la mitad que
      // convierte «se perdió el empujón» en «se reintenta en unos minutos»: sin
      // esto, un 429 dejaría la variante desfasada en silencio y para siempre.
      await anotarFallo(fila, err);

      if (clasificarError(err).hayQueVolverAVincular) {
        // Con el token revocado todas las que faltan van a fallar igual, y cada
        // una gasta una llamada de la cuota de la tienda.
        resumen.corte = err;
        break;
      }

      continue;
    }

    resumen.mandadas += 1;
    await anotarPublicada(fila, numero, producto);
  }

  return resumen;
}

/**
 * Drena la cola de una empresa: un PUT por variante que lo necesite.
 *
 * @returns {Promise<{mandadas: number, fallidas: number, omitidas: number,
 *   fallas: Array<object>, ocupada: boolean}>} `ocupada` = había una
 *   sincronización en curso y este drenaje no hizo nada.
 */
async function drenarCola(empresaId) {
  const vacio = { mandadas: 0, fallidas: 0, omitidas: 0, fallas: [], ocupada: false };

  const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: empresaId } });
  if (!tienda) return vacio;

  // ⚠ **Se mira antes de tomar el arriendo, y ese orden importa.** El drenaje se
  // dispara desde el hook de `Stock`, o sea desde toda venta, toda recepción y
  // toda producción: tomar el arriendo para descubrir que no había nada que hacer
  // dejaría a `GET /status` diciendo «sincronizando» sobre una tienda quieta y le
  // respondería 409 a quien apretara el botón en ese instante.
  const esperando = await TiendanubeVariante.count({ where: enLaColaYVencidas(empresaId) });
  if (!esperando) return vacio;

  // El mismo arriendo que la corrida manual, y a propósito: los dos mandan PUT a
  // las mismas variantes, y dos números en vuelo al mismo tiempo se pisan en el
  // orden en que TiendaNube los reciba.
  if (!(await tomarArriendo(empresaId))) return { ...vacio, ocupada: true };

  try {
    const filas = await TiendanubeVariante.findAll({
      where: enLaColaYVencidas(empresaId),
      // La que espera hace más tiempo primero: con el tope de arriba, una cola
      // más larga que el tope se drena entera en varias vueltas en vez de dejar
      // siempre afuera a las mismas.
      order: [['pendiente_desde', 'ASC'], ['id', 'ASC']],
      limit: TOPE_DEL_DRENAJE,
    });

    const resumen = await publicarLasPendientes(tienda, filas);

    // La regla es «¿pudimos hablar con la tienda?», no «¿salió todo bien?».
    if (resumen.mandadas > 0) {
      await registrarComunicacion(tienda, true);
    } else if (resumen.fallidas > 0) {
      await registrarComunicacion(tienda, false, resumen.corte || resumen.ultimoError);
    }

    logger.info(
      {
        empresaId,
        mandadas: resumen.mandadas,
        fallidas: resumen.fallidas,
        omitidas: resumen.omitidas,
      },
      'tiendanube: cola drenada'
    );

    return {
      mandadas: resumen.mandadas,
      fallidas: resumen.fallidas,
      omitidas: resumen.omitidas,
      fallas: resumen.fallas,
      ocupada: false,
    };
  } finally {
    // Pase lo que pase: un `throw` que dejara el arriendo puesto bloquearía la
    // sincronización de esa empresa durante diez minutos, y acá no hay nadie
    // mirando una pantalla a quien contárselo.
    await soltarArriendo(empresaId);
  }
}

/**
 * Un drenaje por empresa, sin importar cuántas veces se pida.
 *
 * Devuelve la promesa del drenaje que ya estaba corriendo, así que quien lo pide
 * dos veces recibe **el mismo resultado** en vez de un «hay una sincronización en
 * curso» que no significaría nada — el que la tiene es él mismo.
 */
function dispararDrenaje(empresaId) {
  const clave = Number(empresaId);

  const enCurso = drenajesEnCurso.get(clave);
  if (enCurso) return enCurso;

  const promesa = drenarCola(clave)
    .catch((err) => {
      // El drenaje corre sin nadie esperándolo: si su error se propagara, sería
      // un `unhandledRejection` que en Node tumba el proceso. Lo que queda es la
      // línea de log y la fila pendiente, que la reconciliación vuelve a mirar.
      logger.error({ err, empresaId: clave }, 'tiendanube: falló el drenaje de la cola');
      return { mandadas: 0, fallidas: 0, omitidas: 0, fallas: [], ocupada: false, error: true };
    })
    .finally(() => drenajesEnCurso.delete(clave));

  drenajesEnCurso.set(clave, promesa);

  return promesa;
}

/**
 * Espera a que terminen los drenajes que ya estan en vuelo. NO arranca ninguno.
 *
 * Existe para los tests, y no es azucar: sin esto, la unica forma de esperar un
 * drenaje disparado por `setImmediate` era encadenar unos ticks y confiar. Un
 * drenaje hace varias consultas a Postgres, que tardan bastante mas que un tick,
 * asi que la espera alcanzaba en una maquina y no en otra — y esa es la forma
 * exacta de un test que pasa local y falla en CI.
 *
 * Paso: `drenar despues de cien movimientos manda UN solo PUT` daba 0 llamadas
 * en CI porque el drenaje de fondo seguia corriendo y el explicito se salteaba
 * por el candado de arriba, que devuelve la promesa en curso en vez de empezar
 * otro.
 *
 * Vuelve a mirar el mapa despues de esperar, porque un drenaje puede haber
 * encolado a otro. El tope corta una espera infinita en vez de colgar la suite.
 */
async function esperarDrenajesEnCurso({ vueltas = 10 } = {}) {
  for (let i = 0; i < vueltas; i += 1) {
    const enVuelo = [...drenajesEnCurso.values()];
    if (!enVuelo.length) return true;

    // `dispararDrenaje` ya envuelve cada promesa en un `.catch`, asi que ninguna
    // rechaza: esperarlas no puede tumbar el test por un error del drenaje.
    await Promise.all(enVuelo);
  }

  return drenajesEnCurso.size === 0;
}

// ════════════════════════════════════════════
//  La reconciliación diaria y los dos barridos
//
//  ⚠⚠ **El cron que dispara esto hoy falla todos los días.**
//  `.github/workflows/tareas-diarias.yml:50-51` corta si faltan `API_URL` o
//  `CRON_SECRET`, y sin `CRON_SECRET` del lado del servidor `POST
//  /api/tareas/ejecutar` responde 404 aunque se llame. O sea que **la
//  reconciliación no se ejecuta**. Por eso el caso normal no cuelga de ella —el
//  drenaje es in-process— y por eso `GET /status` devuelve `reconciliada_en` y la
//  pantalla lo muestra: la ausencia de la red tiene que **verse**, no suponerse.
//
//  *Lo que no se hace*: subir la frecuencia del cron para compensar. Cada corrida
//  despierta el servicio, que es lo que el free tier cobra.
// ════════════════════════════════════════════

/**
 * Encola las variantes cuyo número no coincide, comparando **tres**.
 *
 * | Número | De dónde sale | Qué falla atrapa |
 * |---|---|---|
 * | `stock.available` de la designada | AdminApp | — es la referencia |
 * | `stock_publicado` | lo que mandamos | **el empujón que se perdió** |
 * | `stock_en_tienda` | el refresco recién hecho | **el número que alguien cambió a mano en el panel de TiendaNube** |
 *
 * Comparar contra los dos no cuesta ninguna llamada extra: el refresco del
 * catálogo hay que hacerlo igual, y con la respuesta en la mano la comparación es
 * local.
 *
 * **Solo lo que difiere.** Encolar todo sería republicar el catálogo entero una
 * vez por día contra una API con cuota, que es justamente lo que la cola vino a
 * evitar.
 */
async function encolarLoQueDifiere(empresaId, puntoDeVentaId) {
  const mapeos = await TiendanubeMapping.findAll({
    where: { empresa_id: empresaId },
    attributes: ['product_id', 'tiendanube_variant_id'],
  });

  if (!mapeos.length) return 0;

  const variantesId = mapeos.map((m) => m.tiendanube_variant_id);
  const productIds = [...new Set(mapeos.map((m) => m.product_id))];

  const variantes = await TiendanubeVariante.findAll({
    where: { empresa_id: empresaId, tiendanube_variant_id: { [Op.in]: variantesId } },
  });

  const stocks = await Stock.findAll({
    where: {
      empresa_id: empresaId,
      punto_de_venta_id: puntoDeVentaId,
      product_id: { [Op.in]: productIds },
    },
    attributes: ['product_id', 'available'],
  });

  const productoDeLaVariante = new Map(mapeos.map((m) => [String(m.tiendanube_variant_id), m.product_id]));
  const disponiblePorProducto = new Map(stocks.map((s) => [s.product_id, s.available]));

  // Dos listas y no una: la segunda necesita **además** olvidar lo que creíamos
  // publicado. Ver abajo.
  const seNosPerdioElEmpujon = [];
  const loCambiaronAMano = [];

  for (const variante of variantes) {
    const productId = productoDeLaVariante.get(String(variante.tiendanube_variant_id));

    const disponible = disponiblePorProducto.has(productId)
      ? disponiblePorProducto.get(productId)
      : null;

    // Sin fila de stock en la designada no hay ningún número que mandar, y
    // publicar cero agotaría en la tienda una variante que sí tiene mercadería.
    if (disponible === null || disponible === undefined) continue;

    if (hayQueEmpujar(variante, disponible)) {
      seNosPerdioElEmpujon.push(variante.id);
      continue;
    }

    const nuestro = stockAPublicar(disponible);
    const enLaTienda = variante.stock_en_tienda === null || variante.stock_en_tienda === undefined
      ? null
      : stockAPublicar(variante.stock_en_tienda);

    if (enLaTienda !== null && enLaTienda !== nuestro) loCambiaronAMano.push(variante.id);
  }

  let encoladas = 0;

  if (seNosPerdioElEmpujon.length) {
    encoladas += await encolar(empresaId, seNosPerdioElEmpujon, {});
  }

  if (loCambiaronAMano.length) {
    // ⚠ **`stock_publicado` se borra, y sin eso esta rama no publica nada.** El
    // drenaje decide con `hayQueEmpujar`, que compara el disponible contra lo
    // que dice esta columna: para una variante que alguien tocó del otro lado
    // los dos números coinciden —mandamos 3, tenemos 3, la tienda dice 99— y el
    // drenaje concluiría que no hay nada que empujar, sacaría la fila de la cola
    // y dejaría a la tienda con el 99 puesto **hasta la próxima venta de ese
    // producto**. Que es exactamente la falla que la reconciliación existe para
    // atrapar.
    //
    // Borrarla también es lo honesto: alguien cambió el número del otro lado, así
    // que el registro de lo que mandamos ya no describe lo que la tienda tiene.
    // La próxima publicación lo vuelve a escribir.
    encoladas += await encolar(empresaId, loCambiaronAMano, { stock_publicado: null });
  }

  return encoladas;
}

/** Mete estas filas en la cola, para ya. */
async function encolar(empresaId, ids, extra) {
  const [encoladas] = await TiendanubeVariante.update(
    {
      ...extra,
      pendiente_desde: literal('COALESCE(pendiente_desde, NOW())'),
      // Ya, y no dentro de la ventana de agrupado: la reconciliación corre una
      // vez por día y lo que encuentra desfasado ya lleva horas así.
      proximo_intento_en: literal('NOW()'),
    },
    { where: { empresa_id: empresaId, id: { [Op.in]: ids } } }
  );

  return encoladas;
}

/**
 * La reconciliación de una tienda: refrescar, comparar, encolar y drenar.
 *
 * Deja su fila en `tiendanube_corridas` con `disparador: 'reconciliacion'` —es
 * una corrida explícita, no un empujón por movimiento— y escribe
 * `tienda.reconciliada_en`, que es lo único que permite ver desde la pantalla que
 * la red existe.
 *
 * @returns {Promise<{corrida_id: number, encoladas: number, mandadas: number,
 *   fallidas: number, variantes: number}|null>} `null` si la empresa no tiene
 *   tienda vinculada.
 */
async function reconciliar(empresaId) {
  const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: empresaId } });
  if (!tienda) return null;

  const corrida = await TiendanubeCorrida.create({
    empresa_id: empresaId,
    empezada_en: new Date(),
    disparador: 'reconciliacion',
    // Nadie apretó nada: la reconciliación no tiene usuario, y ponerle uno sería
    // inventar quién la pidió.
    usuario_id: null,
    mandadas: 0,
    fallidas: 0,
    fallas: null,
  });

  let refresco;

  try {
    // ⚠ Va **antes** del arriendo: `refrescarCatalogo` responde 409 si hay una
    // sincronización en curso, y el drenaje de más abajo lo toma. Al revés, la
    // reconciliación se bloquearía a sí misma.
    refresco = await refrescarCatalogo(empresaId);
  } catch (err) {
    // La corrida queda cerrada con el motivo: una fila sin `terminada_en` es «se
    // cortó por la mitad», y la pantalla la dibuja distinto. `reconciliada_en`
    // NO se escribe: no se reconcilió nada.
    await corrida.update({
      terminada_en: new Date(),
      fallas: [{ variante: null, sku: null, motivo: motivoDelFallo(err) }],
    });

    throw err;
  }

  const encoladas = await encolarLoQueDifiere(empresaId, tienda.punto_de_venta_id);
  const resumen = await drenarCola(empresaId);

  await corrida.update({
    terminada_en: new Date(),
    mandadas: resumen.mandadas,
    fallidas: resumen.fallidas,
    fallas: resumen.fallas.length ? resumen.fallas : null,
  });

  // Por `TiendanubeTienda.update` de clase y no por `tienda.update`: la
  // instancia se cargó **antes** del refresco y del drenaje, que le escribieron
  // `catalogo_refrescado_en`, `ultima_comunicacion_*` y `sincronizando_desde`.
  // Hoy `instance.update` manda solo los campos que cambian y daría lo mismo,
  // pero basta con que alguien agregue un segundo campo a esta llamada para que
  // la fila vuelva a los valores que tenía en memoria hace veinte llamadas.
  await TiendanubeTienda.update(
    { reconciliada_en: new Date() },
    { where: { empresa_id: empresaId } }
  );

  return {
    corrida_id: corrida.id,
    encoladas,
    mandadas: resumen.mandadas,
    fallidas: resumen.fallidas,
    variantes: refresco.variantes,
  };
}

/**
 * Borra los `state` del OAuth vencidos hace más de un día.
 *
 * Una tabla de tokens sin barrido crece para siempre. El día de gracia es para
 * que `motivoDelState` pueda seguir distinguiendo «venció» de «no existe» en el
 * log mientras alguien mira por qué no puede vincular.
 */
async function barrerEstadosDeOauth() {
  return TiendanubeEstadoOauth.destroy({
    where: { expira_en: { [Op.lt]: literal("NOW() - INTERVAL '1 day'") } },
  });
}

/**
 * Borra las corridas de más de 90 días.
 *
 * ⚠ **No toca `tiendanube_pedidos`, y esa es la mitad que importa.** Un pedido
 * borrado es un pedido que se puede volver a descontar si TiendaNube reintenta un
 * webhook viejo: la fila **es** la idempotencia. Las corridas son un registro
 * histórico y no sostienen ninguna garantía.
 */
async function barrerCorridas() {
  return TiendanubeCorrida.destroy({
    where: { empezada_en: { [Op.lt]: literal("NOW() - INTERVAL '90 days'") } },
  });
}

/**
 * Lo que corre una vez por día desde `POST /api/tareas/ejecutar`.
 *
 * Una tienda que falla **no se lleva puestas a las demás**: cada reconciliación
 * va en su `try`. Con una sola excepción propagándose, la primera tienda con el
 * token vencido dejaría sin reconciliar a todas las que vinieran después y los
 * dos barridos no correrían nunca.
 */
async function tareasDiarias() {
  const tiendas = await TiendanubeTienda.findAll({ attributes: ['empresa_id'] });

  let encoladas = 0;

  for (const tienda of tiendas) {
    try {
      const resultado = await reconciliar(tienda.empresa_id);
      if (resultado) encoladas += resultado.encoladas;
    } catch (err) {
      logger.error(
        { err, empresaId: tienda.empresa_id },
        'tiendanube: no se pudo reconciliar esta tienda'
      );
    }
  }

  const estadosBarridos = await barrerEstadosDeOauth();
  const corridasBarridas = await barrerCorridas();

  return {
    tiendas: tiendas.length,
    encoladas,
    estados_barridos: estadosBarridos,
    corridas_barridas: corridasBarridas,
  };
}

module.exports = {
  refrescarCatalogo,
  registrarComunicacion,
  haySincronizacionEnCurso,
  sincronizar,
  drenarCola,
  dispararDrenaje,
  esperarDrenajesEnCurso,
  reconciliar,
  tareasDiarias,
  ARRIENDO_DE_SINCRONIZACION_MS,
  TOPE_DEL_DRENAJE,
};
