const axios = require('axios');
const {
  sequelize,
  Setting,
  Stock,
  TiendanubeMapping,
  TiendanubePedido,
  TiendanubeTienda,
  StockMovement,
} = require('../models');
const { resolverSucursal } = require('../utils/sucursalDeStock');
const { clasificarError, CLASES } = require('../utils/tiendanubeCola');
const { ErrorDeNegocio } = require('../utils/errores');
const logger = require('../utils/logger');

/**
 * Cuánto se espera a TiendaNube antes de cortar.
 *
 * ⚠ **Hasta este hito ninguna de las tres llamadas tenía `timeout`.** Una
 * llamada colgada deja el request de la aplicación esperando para siempre y
 * ocupa una conexión del pool: con unas cuantas, el resto de AdminApp se queda
 * sin conexiones y el síntoma no se parece en nada a «TiendaNube no contesta».
 * El precedente está escrito y comentado en `afipService.js:86-89`.
 *
 * Quince segundos es lo que aguanta alguien mirando un botón. Lo que tarde más
 * que eso se reintenta desde la cola, que no tiene a nadie esperando.
 */
const TIMEOUT_TIENDANUBE_MS = 15000;

/** El tamaño de página del catálogo, que es el máximo que acepta TiendaNube. */
const POR_PAGINA = 200;

/**
 * El tope de páginas de un refresco.
 *
 * 200 × 100 = 20.000 variantes. No es un límite de negocio: es lo que impide que
 * una API que devolviera siempre la misma página convirtiera el refresco en un
 * bucle infinito con una llamada por vuelta.
 */
const TOPE_DE_PAGINAS = 100;

/** Cuántas veces se reintenta una página que volvió 429, dentro del request. */
const REINTENTOS_POR_LIMITE = 3;

/**
 * El tope de la espera de un 429 **dentro de un request**.
 *
 * ⚠ Es a propósito distinto del backoff de `utils/tiendanubeCola.js`, que se
 * mide en minutos: aquél es para la cola, que no tiene a nadie esperando; éste
 * corre con una persona mirando la pantalla. Diez segundos por reintento es lo
 * máximo que se le puede pedir; si la tienda pide más, se corta y el mensaje lo
 * dice, y la corrida siguiente lo vuelve a intentar.
 */
const ESPERA_MAXIMA_EN_REQUEST_MS = 10000;

/**
 * Por que un item de un pedido no desconto nada.
 *
 * Los cuatro se salteaban con un `continue` y lo unico que quedaba era que el
 * inventario estaba mal: se vendio, salio del deposito, y nadie se entero. Es
 * exactamente el modo de falla que `descuentoDeStock.test.js` existe para
 * evitar, y su encabezado lo dice — «lo grave no es que falle: es que no falla».
 */
const MOTIVOS = {
  SIN_VARIANTE: 'sin_variante',
  CANTIDAD_CERO: 'cantidad_cero',
  SIN_MAPEO: 'sin_mapeo',
  SIN_STOCK: 'sin_stock_en_sucursal',
};

/** El largo de `tiendanube_pedidos.numero`. */
const LARGO_DEL_NUMERO = 40;

/**
 * Las lineas del pedido, normalizadas.
 *
 * TiendaNube manda los items en `products`; se acepta `items` porque es la forma
 * que ya toleraba el codigo anterior y no hay entorno de pruebas del tercero
 * donde comprobar cual llega (supuesto 11).
 *
 * La cantidad se normaliza con `Number` porque puede venir como texto: un `'2'`
 * sin convertir hace que `stock.quantity - qty` de una concatenacion, y el
 * descuento escribiria un numero absurdo en vez de fallar.
 */
function lineasDelPedido(orderData) {
  const crudas = orderData.products || orderData.items || [];

  return (Array.isArray(crudas) ? crudas : []).map((item) => ({
    variante: item.product_variant_id || item.variant_id || null,
    cantidad: Number(item.quantity ?? 0),
  }));
}

class TiendaNubeService {
  constructor() {
    this.clientId = process.env.TIENDANUBE_CLIENT_ID;
    this.clientSecret = process.env.TIENDANUBE_CLIENT_SECRET;
  }

  async getAccessToken(code, empresaId) {
    try {
      const response = await axios.post(
        'https://www.tiendanube.com/apps/authorize/token',
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'authorization_code',
          code: code
        },
        { timeout: TIMEOUT_TIENDANUBE_MS }
      );

      const { access_token, user_id } = response.data;

      // ⚠ **Solo el token va a `settings`, y el `user_id` ya NO.**
      //
      // Hasta este hito había un segundo `Setting.upsert({ key:
      // 'tiendanube_user_id' })` acá, que recreaba la fila que la migración
      // 20260810 acababa de mover a `tiendanube_tiendas`. El mismo dato en dos
      // lugares, y solo uno de los dos con el índice UNIQUE que impide que dos
      // empresas vinculen la misma tienda: la fuente sin garantía es la que
      // alguien iba a leer.
      //
      // El token SÍ se queda en `settings` (FR-077): esta funcionalidad no lo
      // cifra y no puede agregar ningún lugar nuevo donde quede en claro.
      // Cifrarlo es el proyecto 6 de `PROXIMOS-PROYECTOS.md`, junto con la clave
      // de AFIP y sobre esta misma tabla.
      await Setting.upsert({
        key: 'tiendanube_access_token',
        value: access_token,
        empresa_id: empresaId,
      });

      return { access_token, user_id };
    } catch (err) {
      // `console.error` NO pasa por la redaccion de secretos: `utils/logger.js`
      // tapa `access_token` y `tiendanube_access_token`, y `config/sentry.js`
      // los tapa antes de salir a un tercero, pero las dos cosas viven en el
      // logger. Esta era la unica linea de la integracion por la que el token
      // podia llegar entero a un log —imprimia `error.response?.data`, que es
      // la respuesta del canje— y era justo la que esquivaba el filtro.
      logger.error({ err, empresaId }, 'tiendanube: canje del code');
      throw new Error('No se pudo autenticar con TiendaNube');
    }
  }

  /**
   * Las credenciales para hablar con la tienda de una empresa: el token y el id.
   *
   * ── Por qué salen de dos lugares distintos ──
   *
   * El **token** sigue en `settings.tiendanube_access_token`, en texto plano,
   * porque FR-077 dice que esta funcionalidad no puede agregar ningún lugar
   * nuevo donde quede en claro: cuando se cifre —proyecto 6, junto con la clave
   * de AFIP— el trabajo es sobre `settings` y sobre nada más.
   *
   * El **id de tienda** sale de `tiendanube_tiendas`, que es la única columna
   * con `UNIQUE`. Antes salía de `settings`, cuya PK es `(key, empresa_id)`: dos
   * empresas podían guardar el mismo id de tienda y el webhook le descontaba
   * stock a la que Postgres devolviera primero, en un orden que nadie definió.
   * Que el dato viva donde está la garantía es la otra mitad de FR-036.
   */
  async getStoredToken(empresaId) {
    const tokenSetting = await Setting.findOne({
      where: { key: 'tiendanube_access_token', empresa_id: empresaId }
    });

    if (!tokenSetting) return null;

    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: empresaId } });

    // Sin fila de tienda no hay a quién hablarle: un token suelto en `settings`
    // es lo que queda cuando el canje salió bien y la vinculación no se pudo
    // completar. Devolver `null` es lo que hace que el endpoint conteste «no hay
    // ninguna tienda vinculada» en vez de armar una URL con `undefined` adentro.
    if (!tienda) return null;

    return {
      access_token: tokenSetting.value,
      user_id: tienda.tiendanube_user_id,
    };
  }

  /** Las cabeceras que TiendaNube exige en cada llamada. */
  cabeceras(credentials, extra = {}) {
    return {
      'Authentication': `bearer ${credentials.access_token}`,
      // TiendaNube pide un User-Agent con un contacto para poder avisar cuando
      // una app hace algo raro con su cuota.
      'User-Agent': `Nexar POS (${process.env.TIENDANUBE_CONTACT_EMAIL || 'contacto@tudominio.com'})`,
      ...extra,
    };
  }

  /**
   * Espera. Es un método —y no una función suelta— para que un test pueda
   * espiarlo: sin eso, ejercitar el reintento de un 429 costaría los segundos
   * que el reintento espera.
   */
  async dormir(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * **Todas** las páginas del catálogo de la tienda.
   *
   * ── Qué hacía antes, y qué se veía ──
   *
   * Pedía `/products` sin `page` ni `per_page` y devolvía `response.data` crudo:
   * **la primera página y nada más**, descartando las cabeceras que dicen
   * cuántas hay. Una tienda con más productos de los que entran en una página
   * mostraba los primeros y el resto no se podía mapear, sin que nada avisara —
   * la lista se veía completa. Es el hallazgo 10 de la spec.
   *
   * Corta cuando una página vuelve **vacía o corta**, que es lo que dice que era
   * la última. TiendaNube devuelve 404 en la página siguiente a la última en
   * algunas versiones; eso lo trata `pedirPagina`.
   *
   * @returns {Promise<Array<Array<object>>>} Una entrada por página, en orden.
   *   `utils/tiendanubeCatalogo.js` las aplana a filas de variante.
   */
  async getProducts(empresaId) {
    const credentials = await this.getStoredToken(empresaId);
    // Cubre las dos mitades: sin fila de tienda y con la fila pero sin token en
    // `settings`. La segunda existe —el canje guarda el token y la vinculación
    // puede no completarse, o al revés— y decir «no hay tienda vinculada» sobre
    // una pantalla que muestra la tienda vinculada manda a mirar el lado
    // equivocado.
    if (!credentials) {
      throw new ErrorDeNegocio('La tienda no tiene un token válido. Volvé a vincularla.', 409);
    }

    const paginas = [];

    for (let pagina = 1; pagina <= TOPE_DE_PAGINAS; pagina++) {
      const filas = await this.pedirPagina(credentials, pagina);

      if (!filas.length) break;

      paginas.push(filas);

      // Una página más corta que el tamaño pedido es la última: pedir la
      // siguiente sería una llamada de la cuota para recibir un arreglo vacío.
      if (filas.length < POR_PAGINA) break;
    }

    return paginas;
  }

  /**
   * Una página del catálogo, reintentando el 429.
   *
   * Un 429 no es un error: es «más despacio». Sin este reintento, la primera
   * página que se pase de cuota corta el refresco entero y la instantánea queda
   * a medias — que es exactamente el estado que FR-057 vino a cerrar, con otro
   * nombre.
   */
  async pedirPagina(credentials, pagina) {
    for (let intento = 0; ; intento++) {
      try {
        const response = await axios.get(
          `https://api.tiendanube.com/v1/${credentials.user_id}/products`,
          {
            params: { page: pagina, per_page: POR_PAGINA },
            headers: this.cabeceras(credentials),
            timeout: TIMEOUT_TIENDANUBE_MS,
          }
        );

        return Array.isArray(response.data) ? response.data : [];
      } catch (err) {
        const info = clasificarError(err);

        // Algunas cuentas responden 404 en la página siguiente a la última en
        // vez de un arreglo vacío. Es el fin del catálogo, no un fallo.
        if (info.status === 404) return [];

        if (info.clase !== CLASES.LIMITE || intento >= REINTENTOS_POR_LIMITE) throw err;

        await this.dormir(this.esperaPorLimite(info.retryAfter, intento));
      }
    }
  }

  /**
   * Cuánto esperar un 429 **dentro del request**, en milisegundos.
   *
   * Se respeta el `Retry-After` de la tienda, recortado: hay alguien mirando la
   * pantalla, y una espera de minutos acá es un request colgado. Lo que no entre
   * en esa ventana lo levanta la corrida siguiente.
   */
  esperaPorLimite(retryAfter, intento) {
    const pedidos = /^\d+$/.test(String(retryAfter || '').trim())
      ? Number(retryAfter) * 1000
      : null;

    const calculado = 2 ** intento * 1000;

    return Math.min(pedidos === null ? calculado : pedidos, ESPERA_MAXIMA_EN_REQUEST_MS);
  }

  async updateVariantStock(empresaId, variantId, quantity) {
    const credentials = await this.getStoredToken(empresaId);
    // Cubre las dos mitades: sin fila de tienda y con la fila pero sin token en
    // `settings`. La segunda existe —el canje guarda el token y la vinculación
    // puede no completarse, o al revés— y decir «no hay tienda vinculada» sobre
    // una pantalla que muestra la tienda vinculada manda a mirar el lado
    // equivocado.
    if (!credentials) {
      throw new ErrorDeNegocio('La tienda no tiene un token válido. Volvé a vincularla.', 409);
    }

    await axios.put(
      `https://api.tiendanube.com/v1/${credentials.user_id}/products/variants/${variantId}`,
      // TiendaNube no acepta stock negativo, y un stock local negativo existe:
      // sale de un ajuste manual o de una venta contra una fila en cero.
      { stock: Math.max(0, quantity) },
      {
        headers: this.cabeceras(credentials, { 'Content-Type': 'application/json' }),
        timeout: TIMEOUT_TIENDANUBE_MS,
      }
    );
  }

  /**
   * Traduce un fallo de la API de TiendaNube al error que corresponde.
   *
   * ── Qué se veía antes ──
   *
   * Los cuatro casos —no contesta, token revocado, cuota agotada, TiendaNube
   * caído— producían el mismo texto: «No se pudo sincronizar el stock con
   * TiendaNube». Se arreglan de cuatro maneras distintas, y sin distinguirlos la
   * pantalla manda a revisar el lado equivocado.
   *
   * **Devuelve el error original cuando el problema es nuestro** —un 4xx que no
   * es 401 ni 429, o algo que no sabemos leer—: así `fallo` responde su 500
   * genérico con el `requestId` con el que se encuentra la línea en los logs.
   * Decirle «TiendaNube tuvo un problema» a alguien cuyo problema es de AdminApp
   * es peor que no decir nada.
   *
   * @returns {Error} Un `ErrorDeNegocio` con su status, o el mismo `err`.
   */
  errorDeTiendanube(err) {
    const info = clasificarError(err);

    if (!info.mensaje) return err;

    // El 401 es 400 y no 502: el que falló no es TiendaNube, es que nuestro
    // token dejó de valer, y lo que hay que hacer es volver a vincular. El resto
    // —timeout, 429, 5xx— es 502: el que no contestó es el tercero.
    const status = info.clase === CLASES.TOKEN_INVALIDO ? 400 : 502;

    const propio = new ErrorDeNegocio(info.mensaje, status);
    // Lo lee el que actualiza `tiendanube_tiendas`: `ultima_comunicacion_ok` y
    // el estado «vinculada con error» de FR-006 salen de acá.
    propio.tiendanube = info;

    return propio;
  }

  /**
   * Descuenta stock por un pedido de TiendaNube: una sola vez y entero.
   *
   * ── La idempotencia vive en `tiendanube_pedidos`, no en `stock_movements` ──
   *
   * FR-026 pedía un `UNIQUE (empresa_id, referencia_id)` sobre `stock_movements`
   * y **eso rompería el punto de venta el día del deploy**: `referencia_id` no es
   * único en ninguno de sus tres usos —una venta escribe una fila POR LÍNEA con
   * el mismo `sale.id` (`routes/sales.js:557`), la anulación escribe encima de
   * esos mismos valores, y este mismo pedido escribe una por ítem—. Un ticket de
   * dos productos revertiría la transacción entera.
   *
   * La restricción que sí se puede tener es `uq_tn_pedido (empresa_id,
   * tiendanube_order_id)`: una fila **por pedido**, que es la unidad de
   * idempotencia de verdad.
   *
   * ── Por qué el INSERT va primero y no hay ningún `findOne` previo ──
   *
   * La guarda anterior era un `findOne` sobre `stock_movements` seguido de
   * escrituras sin transacción. Un `findOne` **no es atómico**: TiendaNube
   * reintenta el webhook por diseño, y dos entregas del mismo `order/paid` en
   * vuelo al mismo tiempo pasan las dos la comprobación y descuentan las dos. Es
   * la lección del CAE y la de `POST /api/sales`, y la mitad que de verdad
   * sostiene la garantía es el `SequelizeUniqueConstraintError` de acá abajo —la
   * que un test secuencial no toca nunca—.
   *
   * ── Y es atómico (FR-025) ──
   *
   * La transacción envuelve el INSERT del pedido, los `UPDATE` de stock y los
   * `StockMovement`. Si el tercer ítem falla, **no queda ni la fila del pedido**
   * y el reintento de TiendaNube vuelve a entrar por el camino normal. Antes
   * quedaban los dos primeros descontados para siempre y el reintento contestaba
   * «pedido ya procesado».
   *
   * ── Lo que no descontó queda escrito (FR-027) ──
   *
   * Cada ítem que no se pudo descontar deja su motivo en `pedido.items` y suma a
   * `items_sin_descontar`, que es lo que `GET /api/tiendanube/pedidos` lista.
   * Antes eran tres `continue` y lo único que quedaba era que el inventario
   * estaba mal.
   *
   * LIMITACIÓN CONOCIDA: baja el inventario pero NO registra una venta. Los
   * pedidos de la tienda online no aparecen en facturación, ni en el flujo de
   * caja, ni en los reportes: el stock desaparece sin ingreso asociado.
   * Completarlo es desarrollo nuevo, no un arreglo. Ver docs/ANALISIS.md.
   *
   * @param {object} orderData El cuerpo del webhook `order/paid`.
   * @param {number} empresaId La empresa de la tienda, resuelta por el índice único.
   * @param {number} puntoDeVentaId **La sucursal designada de la tienda.**
   */
  async processOrderCreated(orderData, empresaId, puntoDeVentaId) {
    const referencia = `tn_order_${orderData.id}`;
    const lineas = lineasDelPedido(orderData);

    // Sin rama de omisión, y a propósito: `tiendanube_tiendas.punto_de_venta_id`
    // es NOT NULL justamente para que no exista un «si no vino, la por defecto»
    // que se pueda equivocar. Ese `null` era el defecto de hoy — se publicaba el
    // stock de una sucursal y se descontaba de otra— y si vuelve, esto lo grita
    // en vez de descontar del lugar equivocado en silencio.
    if (!puntoDeVentaId) {
      throw new Error(
        'processOrderCreated necesita la sucursal designada de la tienda: ' +
        'sin ella el descuento cae en la sucursal por defecto, que puede no ser ' +
        'de la que salió la mercadería.'
      );
    }

    const t = await sequelize.transaction();

    try {
      // La sucursal se resuelve antes del INSERT porque la fila del pedido la
      // guarda —y es NOT NULL—: es una lectura de `puntos_de_venta`, no una
      // comprobación sobre el pedido, así que no debilita nada. La carrera se
      // sigue resolviendo en el INSERT de abajo, que es la primera escritura.
      const sucursal = await resolverSucursal({ empresaId, puntoDeVentaId, transaction: t });

      const items = lineas.map((l) => ({
        variante: l.variante,
        cantidad: l.cantidad,
        product_id: null,
        descontado: false,
        motivo: null,
      }));

      // ⚠ **El INSERT va PRIMERO.** Si choca, este pedido ya se procesó y no se
      // toca nada. `items` se completa al final, cuando se sabe qué descontó cada
      // uno: lo que hace de guarda es la fila, no su contenido.
      const pedido = await TiendanubePedido.create({
        empresa_id: empresaId,
        tiendanube_order_id: orderData.id,
        // El número que ve el comprador: la pantalla nombra el pedido con lo que
        // el cliente va a leer por teléfono, no con un id interno.
        numero: orderData.number === null || orderData.number === undefined
          ? null
          : String(orderData.number).slice(0, LARGO_DEL_NUMERO),
        recibido_en: new Date(),
        // La designada AL MOMENTO del pedido: si mañana cambia, esta fila tiene
        // que seguir diciendo de dónde salió la mercadería.
        punto_de_venta_id: sucursal.id,
        items,
        items_descontados: 0,
        items_sin_descontar: 0,
      }, { transaction: t });

      for (const item of items) {
        if (!item.variante) {
          item.motivo = MOTIVOS.SIN_VARIANTE;
          continue;
        }

        // Un ítem de cantidad cero —o negativa, o con `quantity` ilegible— no
        // descuenta nada, y hasta hoy el `|| 1` de arriba lo convertía en un
        // descuento de una unidad que nadie pidió.
        if (!(item.cantidad > 0)) {
          item.motivo = MOTIVOS.CANTIDAD_CERO;
          continue;
        }

        const mapeo = await TiendanubeMapping.findOne({
          where: { tiendanube_variant_id: item.variante, empresa_id: empresaId },
          transaction: t,
        });

        if (!mapeo) {
          item.motivo = MOTIVOS.SIN_MAPEO;
          continue;
        }

        item.product_id = mapeo.product_id;

        // ⚠⚠ El `lock` va sobre un `findOne` SIN `include`, y no se le agrega
        // ninguno. Con un `include`, Sequelize traduce esto a un `LEFT OUTER
        // JOIN` y Postgres responde `0A000: FOR UPDATE cannot be applied to the
        // nullable side of an outer join`: sería un 500 en TODO pedido, no solo
        // en los simultáneos. Si alguna vez hiciera falta, la forma es
        // `lock: { level: t.LOCK.UPDATE, of: Stock }`.
        const stock = await Stock.findOne({
          where: {
            product_id: mapeo.product_id,
            empresa_id: empresaId,
            punto_de_venta_id: sucursal.id,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (!stock) {
          // Se vendió y salió del depósito, pero no hay fila de stock en la
          // sucursal designada: no se inventa una, se anota. Publicar o descontar
          // sobre una fila que no existe es lo que hacía que el faltante
          // apareciera recién en un recuento físico.
          item.motivo = MOTIVOS.SIN_STOCK;
          continue;
        }

        const cantidadAnterior = stock.quantity;
        const disponibleAnterior = stock.available;

        // Los dos números, como en los otros siete caminos que escriben stock:
        // `quantity` es lo que hay y `available` lo que se puede vender.
        await stock.update({
          quantity: Math.max(0, stock.quantity - item.cantidad),
          available: Math.max(0, stock.available - item.cantidad),
        }, { transaction: t });

        await StockMovement.create({
          empresa_id: empresaId,
          product_id: mapeo.product_id,
          // La sucursal de la que salió la mercadería, no la cabecera que nunca
          // vino: un pedido de la tienda online no tiene a nadie en una caja.
          punto_de_venta_id: sucursal.id,
          tipo: 'tiendanube_sale',
          referencia_id: referencia,
          cantidad_anterior: cantidadAnterior,
          cantidad_nueva: stock.quantity,
          disponible_anterior: disponibleAnterior,
          disponible_nuevo: stock.available,
          // Es un literal en una columna que significa «id de usuario». Ya está
          // anotado en `ProductCostHistory.js:33` y no se arregla acá; se nombra
          // para que nadie lo lea como un id que se pueda unir con `usuarios`.
          usuario_id: 'tiendanube',
        }, { transaction: t });

        item.descontado = true;
      }

      const descontados = items.filter((i) => i.descontado).length;

      await pedido.update({
        items,
        items_descontados: descontados,
        items_sin_descontar: items.length - descontados,
      }, { transaction: t });

      await t.commit();

      if (descontados < items.length) {
        // No es un error del sistema —el pedido se procesó— pero es lo que hace
        // que un faltante tenga fecha y motivo en vez de aparecer en un recuento
        // tres meses después.
        logger.warn(
          {
            empresaId,
            tiendanubeOrderId: orderData.id,
            sinDescontar: items.length - descontados,
          },
          'tiendanube: el pedido dejó ítems sin descontar'
        );
      }

      return {
        procesado: true,
        items_descontados: descontados,
        items_sin_descontar: items.length - descontados,
      };
    } catch (err) {
      await t.rollback();

      if (err.name !== 'SequelizeUniqueConstraintError') throw err;

      // **La mitad que sostiene la garantía.** Se relee el pedido en vez de
      // confiar en el nombre del constraint: si el choque hubiera sido por otra
      // cosa, no se encuentra nada y el error sale como cualquier otro. Cuando el
      // que perdió la carrera llega acá, el que ganó ya commiteó —Postgres lo
      // hizo esperar en el índice—, así que la fila está.
      const yaProcesado = await TiendanubePedido.findOne({
        where: { empresa_id: empresaId, tiendanube_order_id: orderData.id },
        attributes: ['id'],
      });

      if (!yaProcesado) throw err;

      // Este log es lo ÚNICO que distingue desde afuera «lo frenó el índice
      // único» de «lo frenó una comprobación previa»: las dos ramas devuelven lo
      // mismo. El test de integración lo espía, igual que
      // `idempotenciaDeVentas.integracion.test.js` con las ventas.
      logger.info(
        { empresaId, tiendanubeOrderId: orderData.id, referencia },
        'tiendanube: pedido repetido, lo frenó la restricción única'
      );

      return { procesado: false, motivo: 'pedido ya procesado' };
    }
  }
}

module.exports = new TiendaNubeService();
