const express = require('express');
const crypto = require('crypto');
const { Op, literal, fn, col, where: sqlWhere } = require('sequelize');
const {
  sequelize,
  Setting,
  Product,
  PuntoDeVenta,
  Stock,
  TiendanubeMapping,
  TiendanubeTienda,
  TiendanubeEstadoOauth,
  TiendanubeVariante,
  TiendanubePedido,
  TiendanubeCorrida,
} = require('../models');
const checkPermission = require('../middleware/checkPermission');
const tiendanubeService = require('../services/tiendanubeService');
const tiendanubeSincronizacion = require('../services/tiendanubeSincronizacion');
const { findScoped, scoped } = require('../utils/tenantScope');
const { sucursalPorDefecto } = require('../utils/sucursalDeStock');
const { sugerirPorSku } = require('../utils/tiendanubeCatalogo');
const { MOTIVOS_NO_PUBLICADO } = require('../utils/tiendanubeCola');
// La lista de acentos vive en un solo lugar a propósito: normaliza la columna en
// SQL **y** el texto que escribió el usuario en JS, y si fueran dos listas la
// búsqueda podría devolver vacío sin que nada falle.
const { sinAcentos, ACENTOS, SIN_ACENTOS } = require('../utils/cuentaDeProveedor');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const logger = require('../utils/logger');

// ════════════════════════════════════════════
//  TiendaNube · dos routers con exposicion distinta
//
//  Antes era un router unico montado en server.js SIN la cadena de
//  autenticacion. Eso producia dos problemas opuestos al mismo tiempo:
//
//   - /webhook quedaba abierto a internet y, como el controlador resolvia la
//     empresa con `req.empresaId || 1`, cualquiera podia postear un pedido
//     falso y descontarle stock a la empresa 1, que en produccion es un
//     cliente real.
//
//   - /status, /products, /mapping y /sync-stock usaban checkPermission, que
//     lee req.usuarioPermisos. Ese campo lo llena loadEmpresaContext, que no
//     corria: en produccion esos endpoints respondian 403 siempre y la
//     integracion no se podia usar.
//
//  Ahora se separan: `publico` para lo que TiendaNube llama desde afuera y
//  `privado` para lo que llama la app, que server.js monta detras de la
//  cadena de autenticacion.
//
//  ── Por que los handlers viven ACA y no en un controllers/ ──
//
//  Hasta el hito 013 estos siete handlers vivian en `src/controllers/`, el
//  unico directorio del servidor que **ninguna** de las cinco guardias
//  estaticas mira: `aislamientoEmpresas.test.js` recorre routes/, services/ y
//  utils/; `observabilidad.test.js` y `permisosDeRutas.test.js` solo routes/.
//  Un solo archivo, con una convencion que el resto del repositorio no usa, y
//  fuera del radar de todo.
//
//  Lo que se pago por eso: `createMapping` colgaba una fila de un producto que
//  nadie habia validado —el mismo IDOR que dfd7009 cerro en los pagos a
//  proveedores— y respondia 201. El detector `analizarCreates` reconoce esa
//  forma y la habria nombrado con archivo y linea. Nunca miro ahi.
//
//  El directorio se borro, y hay una guardia en `observabilidad.test.js` que
//  falla si vuelve a existir. No alcanza con no volver a usarlo: cada guardia
//  futura vuelve a nacer sin ese directorio en su lista.
//
//  ── ⚠ Donde se monta `publico`, y que NO tiene delante ──
//
//  `server.js` monta este router **antes** de `app.use(express.json(` y antes
//  del rate limiter, y eso es lo unico que hace que el webhook funcione: el
//  `express.json({ type, verify })` de `/webhook` guarda el cuerpo crudo en
//  `req.rawBody`, y body-parser **no ejecuta el `verify` si alguien ya parseo el
//  cuerpo**. Con el parser global delante, `req.rawBody` quedaba `undefined`,
//  `firmaValida` cortaba ahi y todo webhook respondia 401 — o sea que ningun
//  pedido de la tienda online desconto stock jamas.
//
//  Consecuencia para cualquier ruta que se agregue a `publico` de ahora en mas:
//  **nace sin `express.json` y sin rate limit**. Si necesita cuerpo JSON, se lo
//  tiene que poner ella misma, como hace `/webhook`. El router `privado` no
//  tiene ese problema: se monta abajo, con toda la cadena delante.
// ════════════════════════════════════════════

// ── Constantes de la vinculacion ──

/**
 * Cuanto vive un `state` sin consumir.
 *
 * Quince minutos es el ida y vuelta al navegador con margen para que alguien se
 * distraiga. Mas largo agranda la ventana en la que un `state` capturado del
 * historial sirve; mas corto rompe el flujo normal de quien se toma su tiempo
 * eligiendo la tienda del otro lado.
 */
const VIDA_DEL_STATE_MS = 15 * 60 * 1000;

/**
 * Las dos claves de `settings` que escribe el canje del OAuth.
 *
 * El token se queda en `settings` a proposito (FR-077): esta funcionalidad no
 * lo cifra y no puede agregar ningun lugar nuevo donde quede en claro. Cifrarlo
 * es el proyecto 6 de `PROXIMOS-PROYECTOS.md`, junto con la clave de AFIP y
 * sobre esta misma tabla.
 */
const CLAVES_DE_LA_VINCULACION = ['tiendanube_access_token', 'tiendanube_user_id'];

/** Los cuatro numeros del bloque de estado cuando todavia no hay tienda. */
const SIN_VARIANTES = { total: 0, mapeadas: 0, pendientes: 0, con_error: 0 };

// ── Rutas que llama TiendaNube, sin sesion de usuario ──
const publico = express.Router();

/**
 * Verifica la firma HMAC-SHA256 que TiendaNube adjunta a cada webhook.
 *
 * Sin esto, el endpoint acepta cualquier cuerpo de cualquier origen: un tercero
 * podia postear un pedido inventado y descontar inventario.
 */
function firmaValida(req) {
  const secret = process.env.TIENDANUBE_CLIENT_SECRET;
  const recibida = req.headers['x-linkedstore-hmac-sha256'];

  if (!secret || !recibida || !req.rawBody) return false;

  const esperada = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(recibida), 'utf8');
  if (a.length !== b.length) return false;

  // Comparacion en tiempo constante: comparar con === filtra informacion sobre
  // la firma correcta a traves del tiempo de respuesta.
  return crypto.timingSafeEqual(a, b);
}

/**
 * Cual de las tres cosas le falto a la firma, **para el log y solo para el log**.
 *
 * ⚠ No es cosmetico. `firmaValida` devuelve `false` si falta
 * `TIENDANUBE_CLIENT_SECRET`, asi que hasta hoy **un despliegue mal configurado y
 * un intento de suplantacion producian exactamente el mismo 401 y el mismo
 * `logger.warn`**: quien opera no tenia forma de distinguir «me falta una
 * variable de entorno» de «alguien esta posteando pedidos falsos», y las dos se
 * arreglan distinto.
 *
 * `sin_cuerpo_crudo` es el tercero y es el sintoma exacto del defecto que este
 * hito cerro: si alguien vuelve a montar este router debajo del `express.json`
 * global, todos los rechazos van a decir eso.
 */
function motivoDelRechazo(req) {
  if (!process.env.TIENDANUBE_CLIENT_SECRET) return 'sin_secreto_en_el_servidor';
  if (!req.headers['x-linkedstore-hmac-sha256']) return 'sin_cabecera_de_firma';
  if (!req.rawBody) return 'sin_cuerpo_crudo';

  return 'no_coincide';
}

/**
 * A que tienda —y por lo tanto a que empresa y a que sucursal— pertenece un
 * webhook.
 *
 * ⚠ **Es una lectura sobre TODAS las empresas y tiene que serlo**: el webhook no
 * tiene sesion y el `store_id` es lo unico con lo que se puede resolver a quien
 * le corresponde el pedido. Lo que cambia respecto de antes es de donde sale la
 * garantia: hasta hoy era `Setting.findAll({ key: 'tiendanube_user_id' })`
 * quedandose con **el primer match**, sobre una tabla cuya PK es
 * `(key, empresa_id)` — o sea que nada impedia que dos empresas guardaran el
 * mismo id de tienda, y el pedido le descontaba stock a la que Postgres
 * devolviera primero, en un orden que nadie definio.
 *
 * `tiendanube_tiendas.tiendanube_user_id` tiene un indice UNICO, asi que este
 * `findOne` devuelve **una empresa o ninguna**, siempre. Es FR-037, y la
 * garantia es de la base.
 *
 * Devuelve la fila entera y no el `empresa_id` porque el descuento necesita
 * ademas la sucursal designada, que es de donde tiene que salir la mercaderia.
 */
async function tiendaDelWebhook(storeId) {
  if (!storeId) return null;

  return TiendanubeTienda.findOne({ where: { tiendanube_user_id: String(storeId) } });
}

/**
 * Consume el `state` del OAuth: lo marca usado y devuelve de quien era.
 *
 * ⚠ **Es UNA sentencia y tiene que seguir siendolo.** Un `findOne` seguido de
 * un `update` no es atomico: dos callbacks con el mismo `state` —el usuario
 * recarga la pestania de vuelta, o TiendaNube reintenta el redirect— pasan los
 * dos por el `findOne` y canjean el `code` dos veces. Un `UPDATE` condicional
 * lo decide la base, y por eso «de un solo uso» pasa de ser una intencion a ser
 * una garantia. Es la leccion del CAE y la de `POST /api/sales`, otra vez.
 *
 * Cero filas = el `state` no sirve, **sin distinguir** si no existe, si vencio
 * o si ya se uso: es lo mismo que hace `findScoped` al responder 404 y por el
 * mismo motivo — distinguirlos le dice a quien prueba tokens cual de las tres
 * acerto. En el log SI se distingue, y de eso se encarga `motivoDelState`.
 *
 * @returns {Promise<{empresa_id: number, usuario_id: string|null}|null>}
 */
async function consumirState(state) {
  const token = typeof state === 'string' ? state.trim() : '';
  if (!token) return null;

  const [filas] = await sequelize.query(
    `UPDATE tiendanube_estados_oauth
        SET consumido_en = NOW()
      WHERE token = $1 AND consumido_en IS NULL AND expira_en > NOW()
      RETURNING empresa_id, usuario_id`,
    { bind: [token] }
  );

  return filas && filas.length ? filas[0] : null;
}

/**
 * Cual de las tres cosas le pasaba al `state`, **para el log y solo para el log**.
 *
 * Se lee despues de que el UPDATE no toco nada, asi que la fila —si existe—
 * sigue como estaba. El usuario recibe siempre `state_invalido`; quien opera
 * necesita saber si el problema es que los tokens vencen demasiado rapido o que
 * alguien esta probando cadenas al azar, y esas dos cosas se arreglan distinto.
 */
async function motivoDelState(state) {
  const token = typeof state === 'string' ? state.trim() : '';
  if (!token) return 'ausente';

  const fila = await TiendanubeEstadoOauth.findOne({ where: { token } });
  if (!fila) return 'desconocido';
  if (fila.consumido_en) return 'ya_consumido';

  return 'vencido';
}

/**
 * Borra el token y el id de tienda de una empresa.
 *
 * Hace falta en dos lugares: al desvincular a mano, y cuando el canje del OAuth
 * salio bien pero la vinculacion no se pudo completar —la tienda ya era de otra
 * empresa—. Sin esto, ese camino dejaria en `settings` un token valido colgado
 * de una vinculacion que no existe: `GET /status` diria «no vinculada» y el
 * material sensible se quedaria ahi para siempre, sin nada que lo nombre.
 */
async function borrarCredenciales(empresaId, transaction) {
  return Setting.destroy({
    where: { key: { [Op.in]: CLAVES_DE_LA_VINCULACION }, empresa_id: empresaId },
    transaction,
  });
}

/**
 * Callback del OAuth de TiendaNube.
 *
 * Es publico —TiendaNube redirige el navegador del usuario hasta aca— asi que
 * no hay sesion. La empresa sale del `state`, que es un token opaco de un solo
 * uso guardado del lado del servidor.
 *
 * ── Por que este circuito NUNCA se pudo completar hasta hoy ──
 *
 * `getAuthUrl` armaba la URL de autorizacion **sin `state`** y este handler
 * exigia un `state` que fuera un entero: el flujo terminaba siempre en
 * `?motivo=sin_empresa`, antes de llamar a `getAccessToken`. El rechazo era
 * correcto —la version anterior resolvia la empresa con `|| 1` y le guardaba el
 * token de cualquiera a la empresa 1, que en produccion es un cliente real— y
 * lo que faltaba era la otra mitad. O sea que **nada de lo que hay debajo de
 * esta linea estuvo nunca probado por el uso**: no hay ni una tienda vinculada.
 *
 * ── El orden de los pasos no es cosmetico ──
 *
 * La sucursal designada se resuelve **antes** del canje. Si se resolviera
 * despues, una empresa sin ninguna sucursal terminaria con el token guardado en
 * `settings` y sin fila en `tiendanube_tiendas`: material sensible en la base,
 * colgado de una vinculacion que no existe y que nada nombra.
 */
publico.get('/callback', async (req, res) => {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  // El destino pasa de `/settings` a `/tiendanube`: la tarjeta escondida al
  // final de Ajustes se va y la pantalla propia es la que sabe dibujar cada uno
  // de estos motivos.
  const volver = (motivo) => res.redirect(`${frontend}/tiendanube?estado=error&motivo=${motivo}`);
  // Sin `?estado=ok` no habria forma de distinguir «volvi de vincular» de
  // «entre a la pantalla». El token no viaja aca de ninguna forma —ni entero,
  // ni truncado, ni en un fragmento— (FR-075).
  const listo = () => res.redirect(`${frontend}/tiendanube?estado=ok`);

  try {
    return await vincular(req, volver, listo);
  } catch (err) {
    // Sin este catch, una excepcion inesperada sale por el manejador de errores
    // de Express: **este handler lo mira una persona**, porque TiendaNube le
    // redirige el navegador hasta aca, y lo que veria es una pagina de error de
    // Express en vez de la pantalla con su mensaje. `error_interno` es el unico
    // motivo que no esta en el contrato de los seis caminos previstos, y es a
    // proposito: no es TiendaNube la que fallo y decir que si mandaria a
    // revisar el lado equivocado.
    logger.error({ err, requestId: req.id }, 'tiendanube: error inesperado en el callback');
    return volver('error_interno');
  }
});

/**
 * El cuerpo del callback, separado para que el `try` de arriba lo envuelva
 * entero sin anidar seis niveles.
 */
async function vincular(req, volver, listo) {
  const { code, state } = req.query;

  if (!code) {
    // Distinguible de `state_invalido` a proposito: hoy el usuario ve «Error al
    // vincular TiendaNube» y nada mas, y las dos cosas se arreglan distinto.
    logger.warn({ requestId: req.id }, 'tiendanube: callback sin code');
    return volver('sin_codigo');
  }

  const estado = await consumirState(state);

  if (!estado) {
    logger.warn(
      { requestId: req.id, motivo: await motivoDelState(state) },
      'tiendanube: callback con un state que no sirve'
    );
    return volver('state_invalido');
  }

  const empresaId = estado.empresa_id;

  let sucursal;
  try {
    // Nunca devuelve null: tira ErrorDeNegocio si la empresa no tiene ninguna
    // sucursal. La columna `punto_de_venta_id` es NOT NULL justamente para no
    // tener una rama de omision que se pueda equivocar.
    sucursal = await sucursalPorDefecto(empresaId);
  } catch (err) {
    logger.warn({ requestId: req.id, empresaId, motivo: err.message }, 'tiendanube: la empresa no tiene sucursales');
    return volver('sin_sucursal');
  }

  let credenciales;
  try {
    credenciales = await tiendanubeService.getAccessToken(code, empresaId);
  } catch (err) {
    // Un fallo del canje es del otro lado, y el mensaje del usuario lo dice.
    logger.error({ err, requestId: req.id, empresaId }, 'tiendanube: no se pudo canjear el code');
    return volver('tiendanube');
  }

  try {
    await TiendanubeTienda.create({
      empresa_id: empresaId,
      tiendanube_user_id: credenciales.user_id,
      // El canje del OAuth devuelve `user_id` y nada mas: el nombre de la
      // tienda no viene en esa respuesta y se completa con el primer refresco
      // del catalogo. Inventarlo aca seria mostrar un nombre que nadie dijo.
      nombre: null,
      punto_de_venta_id: sucursal.id,
      vinculada_en: new Date(),
    });
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;

    // **FR-036 llegando desde la base**, no desde una comprobacion del handler.
    // Hoy `settings` no puede impedirlo —su PK es (key, empresa_id)— y dos
    // empresas con el mismo `tiendanube_user_id` hacen que el pedido de una
    // tienda le descuente stock a la empresa equivocada, elegida por el orden
    // en que Postgres devuelva las filas.
    await borrarCredenciales(empresaId);
    logger.warn(
      { requestId: req.id, empresaId },
      'tiendanube: esa tienda ya esta vinculada a otra empresa, no se vincula y se borra el token'
    );
    return volver('tienda_ocupada');
  }

  logger.info({ requestId: req.id, empresaId, puntoDeVentaId: sucursal.id }, 'tiendanube: tienda vinculada');

  return listo();
}

// El webhook necesita el cuerpo crudo para poder validar la firma HMAC: si se
// parsea antes, el JSON reserializado no coincide byte a byte con lo que
// TiendaNube firmo.
publico.post(
  '/webhook',
  express.json({
    type: 'application/json',
    verify: (req, res, buf) => { req.rawBody = buf; },
  }),
  async (req, res) => {
    // Siempre 200: TiendaNube reintenta y deshabilita el webhook si recibe
    // errores repetidos. Los rechazos se registran, no se devuelven.
    try {
      if (!firmaValida(req)) {
        logger.warn(
          // El `requestId` es lo que permite encontrar la linea en los logs de
          // Render y cruzarla con la de morgan (`OPERACION.md`).
          { requestId: req.id, ip: req.ip, evento: req.headers['x-event'], motivo: motivoDelRechazo(req) },
          'tiendanube: webhook con firma invalida, descartado'
        );
        return res.status(401).send('firma invalida');
      }

      const evento = req.headers['x-event'];
      const orderData = req.body || {};

      // Antes se procesaban 'order/created' Y 'order/paid'. Un pedido normal
      // dispara los dos, con lo cual el stock se descontaba DOS veces por la
      // misma venta. Se toma solo uno: 'order/paid', que es el momento en que la
      // venta esta confirmada.
      if (evento !== 'order/paid') {
        return res.status(200).send('OK');
      }

      const tienda = await tiendaDelWebhook(orderData.store_id);

      if (!tienda) {
        logger.warn(
          { requestId: req.id, storeId: orderData.store_id },
          'tiendanube: webhook de una tienda que no esta vinculada a ninguna empresa'
        );
        return res.status(200).send('OK');
      }

      // La sucursal DESIGNADA, no la por defecto. Hasta hoy aca iba `null`, que
      // hacia caer a `resolverSucursal` al escalon por defecto: se publicaba el
      // stock de una sucursal y se descontaba de otra.
      //
      // El pedido repetido no se distingue aca: lo frena la restriccion unica de
      // `tiendanube_pedidos` adentro del servicio, que ademas es quien deja la
      // linea de log que lo prueba.
      await tiendanubeService.processOrderCreated(
        orderData,
        tienda.empresa_id,
        tienda.punto_de_venta_id
      );

      res.status(200).send('OK');
    } catch (error) {
      // 200 igual: el error se registra, no se le devuelve a TiendaNube. Un
      // error repetido apaga el webhook del otro lado y nadie puede volver a
      // prenderlo desde Favalio.
      logger.error(
        { err: error, requestId: req.id, storeId: (req.body || {}).store_id },
        'tiendanube: error procesando el webhook'
      );
      res.status(200).send('OK');
    }
  }
);

// ── Rutas que llama la app, con usuario autenticado ──
const privado = express.Router();

// Los endpoints privados corren detras de requireEmpresa, asi que req.empresaId
// siempre esta definido. Antes todos usaban `req.empresaId || 1` y el router se
// montaba sin autenticacion: en la practica operaban sobre la empresa 1.

// ── Un fallo de TiendaNube no es un fallo de Favalio ──
//
// Acá vivía `falloDeTiendanube`, que respondía 502 con un texto fijo para
// cualquier cosa que viniera del tercero. Era lo mínimo que sostenía la
// distinción, y no alcanzaba: no contestar, un token revocado, la cuota agotada
// y TiendaNube caído se arreglan de cuatro maneras distintas y producían el
// mismo mensaje.
//
// Ahora eso lo hace `tiendanubeService.errorDeTiendanube(err)`, que clasifica y
// devuelve un `ErrorDeNegocio` con **su** texto y **su** status —o el error
// original cuando el problema es de Favalio, para que `fallo()` responda su 500
// genérico con el `requestId`—. Los handlers solo llaman a `fallo`.

/**
 * El id que mando el cliente, como entero positivo, o null.
 *
 * Los tres ids del mapeo son NOT NULL en la tabla. Sin esta validacion un
 * `product_id: 'abc'` llegaba hasta Postgres y volvia como un 500 generico:
 * el usuario leia «Error al crear el mapeo de producto» y no habia forma de
 * saber que lo que estaba mal era el dato que mando.
 */
function idEntero(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) && valor > 0 ? valor : null;

  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    const n = parseInt(valor.trim(), 10);
    return n > 0 ? n : null;
  }

  return null;
}

/**
 * Contra que choco el mapeo, en castellano.
 *
 * La tabla tiene DOS indices unicos —`uq_tn_mapping_product` sobre
 * (empresa_id, product_id) y `uq_tn_mapping_variant` sobre (empresa_id,
 * tiendanube_variant_id)— y el usuario tiene que saber cual de los dos fue:
 * «ese producto ya esta mapeado» y «esa variante ya esta mapeada» se corrigen
 * de maneras distintas. Por eso se relee el mapeo existente en vez de repetir
 * el texto del driver.
 *
 * Antes los dos casos respondian el mismo 500 generico.
 */
async function motivoDelChoque(empresaId, producto, varianteId) {
  const porProducto = await TiendanubeMapping.findOne({
    where: { empresa_id: empresaId, product_id: producto.id },
  });

  if (porProducto) {
    return `"${producto.name}" ya está mapeado a la variante ${porProducto.tiendanube_variant_id}.`;
  }

  const porVariante = await TiendanubeMapping.findOne({
    where: { empresa_id: empresaId, tiendanube_variant_id: varianteId },
  });

  if (porVariante) {
    const otro = await findScoped(Product, porVariante.product_id, empresaId);
    const nombre = otro ? otro.name : `el producto ${porVariante.product_id}`;
    return `Esa variante ya está mapeada a "${nombre}".`;
  }

  // No deberia pasar: el choque lo tiro uno de los dos indices. Si llega aca es
  // que la fila desaparecio entre el INSERT y la relectura.
  return 'Ese mapeo ya existe.';
}

/**
 * Marca como pendientes de empujar todas las variantes mapeadas de la empresa.
 *
 * ⚠ **El numero que devuelve es parte del contrato, no un dato informativo.**
 * Cambiar la sucursal designada mueve TODOS los numeros publicados; si esto no
 * encolara, la tienda seguiria publicando el stock de la sucursal vieja hasta el
 * proximo movimiento de cada producto — el defecto de hoy con una demora encima.
 * La pantalla usa el numero en la confirmacion, ANTES de que alguien acepte.
 *
 * Las dos tablas se unen en JS por `(empresa_id, tiendanube_variant_id)` y no
 * con un `include`: ninguna consulta de este hito declara asociaciones, y por
 * eso el ancla de `analizarIncludes` sigue donde estaba.
 *
 * `COALESCE(pendiente_desde, NOW())` y no `NOW()` a secas: si la variante ya
 * estaba esperando, lo que interesa es hace cuanto espera, no cuando fue la
 * ultima vez que alguien la volvio a encolar.
 */
async function encolarLasMapeadas(empresaId) {
  const mapeos = await TiendanubeMapping.findAll({
    where: { empresa_id: empresaId },
    attributes: ['tiendanube_variant_id'],
  });

  if (!mapeos.length) return 0;

  // BIGINT: el driver los devuelve como string y asi viajan al `IN`. Postgres
  // los compara bien; convertirlos a Number seria lo que rompe arriba de 2^53.
  const variantes = mapeos.map((m) => m.tiendanube_variant_id);

  const [encoladas] = await TiendanubeVariante.update(
    {
      pendiente_desde: literal('COALESCE(pendiente_desde, NOW())'),
      // Ya, y no dentro de la espera creciente que traia de antes: el numero
      // publicado quedo mal por un cambio que alguien acaba de pedir, no por un
      // fallo del que haya que protegerse esperando.
      proximo_intento_en: literal('NOW()'),
    },
    { where: { empresa_id: empresaId, tiendanube_variant_id: { [Op.in]: variantes } } }
  );

  return encoladas;
}

// `config.editar` y no `config.ver`: este endpoint **escribe** —inserta la fila
// de `tiendanube_estados_oauth`— y arranca el flujo que termina guardando un
// token. Un usuario de solo lectura no puede iniciar una vinculacion.
privado.get('/auth', checkPermission('config.editar'), async (req, res) => {
  try {
    const clientId = process.env.TIENDANUBE_CLIENT_ID;

    if (!clientId) {
      // El 500 con su texto se conserva: es un estado propio —«la integracion
      // no esta configurada en el servidor»— y es distinto de «no vinculada».
      // Colapsarlos dejaria al usuario intentando vincular algo que el servidor
      // no puede vincular.
      throw new ErrorDeNegocio('TIENDANUBE_CLIENT_ID no configurado en el servidor.', 500);
    }

    const yaVinculada = await TiendanubeTienda.findOne({ where: { empresa_id: req.empresaId } });

    if (yaVinculada) {
      // El 409 es nuevo y es deliberado. Sin el, `Setting.upsert` pisaba el
      // token en silencio: la empresa quedaba con la tienda vieja en
      // `tiendanube_tiendas` y el token de la nueva en `settings`, o sea
      // publicando stock en una tienda y hablando con otra. Desvincular es un
      // paso propio porque es donde se puede decir que se pierde.
      throw new ErrorDeNegocio(
        'Ya tenés una tienda vinculada. Desvinculala antes de conectar otra.',
        409
      );
    }

    // 32 bytes de `crypto.randomBytes` en hexadecimal. **No es el empresaId ni
    // nada derivado de el**: un `state` en claro deja que cualquiera complete un
    // OAuth con `state=1` y le cuelgue SU tienda a la empresa 1, que en
    // produccion es un cliente real.
    const token = crypto.randomBytes(32).toString('hex');

    await TiendanubeEstadoOauth.create({
      token,
      empresa_id: req.empresaId,
      usuario_id: req.userId || null,
      expira_en: new Date(Date.now() + VIDA_DEL_STATE_MS),
    });

    res.json({ ok: true, url: `https://www.tiendanube.com/apps/${clientId}/authorize?state=${token}` });
  } catch (err) {
    fallo(req, res, err, 'Error al armar la URL de autorización de TiendaNube');
  }
});

/**
 * El bloque de estado de la pantalla: cuatro estados, no un booleano.
 *
 * Antes devolvia `{ linked: boolean }` y la tarjeta de Ajustes hacia
 * `console.error` en el catch: si la llamada fallaba decia «no vinculada»
 * aunque lo estuviera. Los dos casos que ese booleano no podia expresar son los
 * que mas importan: «el servidor no tiene configurada la integracion» y «la
 * tienda esta vinculada pero nos dejo de contestar».
 *
 * **Un fallo de este endpoint NO es «no vinculada»**: es un 500 con `fallo()`, y
 * la pantalla lo dibuja como «no pudimos comprobar el estado», que es un estado
 * de la pantalla y no del contrato.
 *
 * El token no sale de aca de ninguna forma: ni entero, ni truncado, ni «los
 * ultimos cuatro» (FR-075).
 */
privado.get('/status', checkPermission('config.ver'), async (req, res) => {
  try {
    if (!process.env.TIENDANUBE_CLIENT_ID) {
      return res.json({
        ok: true,
        estado: 'sin_configurar',
        tienda: null,
        variantes: { ...SIN_VARIANTES },
        pedidos_con_items_sin_descontar: 0,
      });
    }

    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: req.empresaId } });

    if (!tienda) {
      return res.json({
        ok: true,
        estado: 'no_vinculada',
        tienda: null,
        variantes: { ...SIN_VARIANTES },
        pedidos_con_items_sin_descontar: 0,
      });
    }

    // Los conteos salen de `count` con `where` sobre indices, no de traer las
    // filas y contarlas en JS: un catalogo de dos mil variantes viaja entero por
    // el pool para calcular cuatro numeros que Postgres ya sabe.
    const donde = { empresa_id: req.empresaId };

    const [total, mapeadas, pendientes, conError, pedidosConProblemas] = await Promise.all([
      TiendanubeVariante.count({ where: donde }),
      TiendanubeMapping.count({ where: donde }),
      TiendanubeVariante.count({ where: { ...donde, pendiente_desde: { [Op.not]: null } } }),
      TiendanubeVariante.count({ where: { ...donde, ultimo_error: { [Op.not]: null } } }),
      TiendanubePedido.count({ where: { ...donde, items_sin_descontar: { [Op.gt]: 0 } } }),
    ]);

    const pv = await findScoped(PuntoDeVenta, tienda.punto_de_venta_id, req.empresaId);

    res.json({
      ok: true,
      // `ultima_comunicacion_ok` es null mientras no se haya hablado con la
      // tienda desde que se vinculo, y eso NO es un error: solo el `false`
      // explicito lo es.
      estado: tienda.ultima_comunicacion_ok === false ? 'vinculada_con_error' : 'vinculada',
      tienda: {
        tiendanube_user_id: tienda.tiendanube_user_id,
        nombre: tienda.nombre,
        vinculada_en: tienda.vinculada_en,
        punto_de_venta: pv ? { id: pv.id, name: pv.name, code: pv.code } : null,
        ultima_comunicacion_en: tienda.ultima_comunicacion_en,
        ultima_comunicacion_ok: tienda.ultima_comunicacion_ok,
        ultimo_error: tienda.ultimo_error,
        catalogo_refrescado_en: tienda.catalogo_refrescado_en,
        // No es decorativo: es la senial visible de que la reconciliacion diaria
        // corrio. El cron externo que la dispara hoy falla todos los dias, y la
        // pantalla muestra esta fecha en vez de dar por hecho que la red existe.
        reconciliada_en: tienda.reconciliada_en,
        // Un arriendo vencido es una corrida que murio, no una corriendo. El
        // predicado sale del servicio, que es quien TOMA el arriendo: hasta este
        // corte habia dos ventanas de diez minutos escritas por separado, que es
        // como se termina diciendo «sincronizando» sobre una tienda quieta.
        sincronizando: tiendanubeSincronizacion.haySincronizacionEnCurso(tienda),
      },
      variantes: { total, mapeadas, pendientes, con_error: conError },
      pedidos_con_items_sin_descontar: pedidosConProblemas,
    });
  } catch (err) {
    fallo(req, res, err, 'Error al comprobar el estado de TiendaNube');
  }
});

/**
 * La sucursal designada: de ahi sale el stock que se publica **y** ahi se
 * descuenta el pedido.
 *
 * Que sea una sola y que sea obligatoria es lo que hace que las dos mitades
 * coincidan por construccion. Hoy no coinciden: la sincronizacion publica el
 * stock de la sucursal que el orden de las filas le haya dado, y el pedido
 * descuenta de la sucursal por defecto.
 */
privado.put('/sucursal', checkPermission('config.editar'), async (req, res) => {
  try {
    const cuerpo = req.body || {};
    const puntoDeVentaId = idEntero(cuerpo.punto_de_venta_id);

    if (!puntoDeVentaId) {
      throw new ErrorDeNegocio('Hace falta el id de la sucursal, como número entero.');
    }

    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: req.empresaId } });
    if (!tienda) throw new ErrorDeNegocio('No hay ninguna tienda vinculada.', 409);

    // findScoped y no findByPk: el id viene del cuerpo. Una sucursal de otra
    // empresa no resuelve, y responde 404 y no 403 — un 403 confirmaria que ese
    // punto de venta existe en otra empresa.
    const puntoDeVenta = await findScoped(PuntoDeVenta, puntoDeVentaId, req.empresaId);
    if (!puntoDeVenta) throw new ErrorDeNegocio('Sucursal no encontrada', 404);

    await tienda.update({ punto_de_venta_id: puntoDeVenta.id });

    const encoladas = await encolarLasMapeadas(req.empresaId);

    logger.info(
      { requestId: req.id, empresaId: req.empresaId, puntoDeVentaId: puntoDeVenta.id, encoladas },
      'tiendanube: cambio la sucursal designada'
    );

    res.json({
      ok: true,
      punto_de_venta: { id: puntoDeVenta.id, name: puntoDeVenta.name, code: puntoDeVenta.code },
      encoladas,
    });
  } catch (err) {
    fallo(req, res, err, 'Error al cambiar la sucursal de TiendaNube');
  }
});

/**
 * Desvincular: se borra el token, la fila de la tienda y la instantanea.
 *
 * **Los mapeos NO se borran**, y la respuesta lo dice para que la confirmacion
 * de la pantalla lo pueda repetir antes de que alguien acepte. Volver a
 * vincular la MISMA tienda los encuentra intactos; vincular otra los deja
 * apuntando a variantes que ya no existen, y eso la pantalla lo muestra despues
 * del primer refresco.
 *
 * La instantanea si se borra: es una copia de un catalogo al que ya no tenemos
 * acceso, y dejarla seria mostrar como actual algo que no se puede volver a
 * pedir.
 */
privado.delete('/vinculacion', checkPermission('config.editar'), async (req, res) => {
  try {
    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: req.empresaId } });
    if (!tienda) throw new ErrorDeNegocio('No hay ninguna tienda vinculada.', 404);

    const mapeosConservados = await TiendanubeMapping.count({ where: { empresa_id: req.empresaId } });

    // Las tres escrituras van juntas: media desvinculacion —la fila borrada y
    // el token todavia ahi, o al reves— es peor que ninguna. Que la transaccion
    // aisle de verdad lo contesta el cuarto nivel; aca lo que importa es que las
    // tres esten en la misma sentencia logica.
    await sequelize.transaction(async (transaction) => {
      await TiendanubeVariante.destroy({ where: { empresa_id: req.empresaId }, transaction });
      await borrarCredenciales(req.empresaId, transaction);
      await tienda.destroy({ transaction });
    });

    logger.info(
      { requestId: req.id, empresaId: req.empresaId, mapeosConservados },
      'tiendanube: tienda desvinculada'
    );

    res.json({ ok: true, mapeos_conservados: mapeosConservados });
  } catch (err) {
    fallo(req, res, err, 'Error al desvincular TiendaNube');
  }
});

/** El tope de filas por página: una lista sin tope es una tabla entera por HTTP. */
const PEDIDOS_POR_PAGINA = 25;
const TOPE_DE_PAGINA = 100;

/**
 * Los pedidos que entraron por el webhook, y qué descontó cada uno.
 *
 * Es el criterio 5 del lado del servidor: **un ítem que no descontó se puede
 * ver**. Hasta este hito se salteaba con un `continue` y lo único que quedaba
 * era que el inventario estaba mal — el faltante aparecía en un recuento físico
 * tres meses después, cuando ya no se puede reconstruir qué pasó.
 *
 * `solo_con_problemas=true` es la lectura frecuente de esta tabla y la que usa el
 * índice parcial `idx_tn_pedidos_pendientes`: los pedidos que descontaron todo
 * —que son casi todos— no están en ese índice.
 *
 * La respuesta arma cada pedido campo por campo y no devuelve la fila cruda: es
 * lo que garantiza que agregarle una columna a la tabla mañana no la publique
 * sola en una respuesta de la API.
 */
privado.get('/pedidos', checkPermission('config.ver'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const solicitado = parseInt(req.query.limit, 10) || PEDIDOS_POR_PAGINA;
    const limit = Math.min(TOPE_DE_PAGINA, Math.max(1, solicitado));

    const where = { empresa_id: req.empresaId };

    // El string 'true' y no cualquier valor con verdad: `?solo_con_problemas=0`
    // llega como '0', que en JS es verdadero, y filtraría al revés de lo que
    // dice.
    if (req.query.solo_con_problemas === 'true') {
      where.items_sin_descontar = { [Op.gt]: 0 };
    }

    const { count, rows } = await TiendanubePedido.findAndCountAll({
      where,
      // El desempate por id no es decorativo: dos webhooks del mismo segundo
      // —que es lo normal cuando TiendaNube entrega en lote— tendrían el mismo
      // `recibido_en`, y sin desempate el mismo pedido puede salir en la página 1
      // y en la 2, o en ninguna.
      order: [['recibido_en', 'DESC'], ['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    res.json({
      ok: true,
      // El total de la consulta, no el largo de la página: de acá salen las
      // páginas y el número que muestra la pantalla.
      total: count,
      data: rows.map((p) => ({
        id: p.id,
        tiendanube_order_id: p.tiendanube_order_id,
        numero: p.numero,
        recibido_en: p.recibido_en,
        items_descontados: p.items_descontados,
        items_sin_descontar: p.items_sin_descontar,
        items: p.items,
      })),
    });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener los pedidos de TiendaNube');
  }
});

/** Cuántas variantes trae una página del listado, y el tope de lo que se puede pedir. */
const VARIANTES_POR_PAGINA = 50;
const TOPE_DE_VARIANTES = 200;

/** Cuántos mapeos trae una página. */
const MAPEOS_POR_PAGINA = 50;

/**
 * La página pedida y cuántas filas, recortadas a lo que se puede servir.
 *
 * ⚠ **Se recorta, no se rechaza.** Un `limit=999999` es alguien que quiere ver
 * todo, no un ataque: responderle 400 lo deja sin lista y sin entender por qué.
 * Lo que no se puede es servirlo: un catálogo entero por HTTP en cada carga es
 * el defecto que la paginación vino a cerrar.
 */
function paginado(query, porDefecto, tope) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const solicitado = parseInt(query.limit, 10) || porDefecto;
  const limit = Math.min(tope, Math.max(1, solicitado));

  return { page, limit, offset: (page - 1) * limit };
}

/**
 * La búsqueda por nombre de producto, nombre de variante o SKU (FR-059).
 *
 * ⚠ **`translate()` y no la extensión `unaccent`**: `unaccent` necesita permisos
 * de superusuario en una base administrada, que es la razón por la que la
 * búsqueda de ventas quedó sensible a acentos (`utils/filtroVentas.js:152`).
 * `translate` es del núcleo de Postgres y no pide nada. Es el mismo corte que
 * `routes/suppliers.js:250`, con la misma lista de acentos.
 *
 * Una columna nula no matchea —`translate(null, …)` es `null` y `null LIKE …`
 * no es verdadero—, que es exactamente lo que corresponde: una variante sin SKU
 * no aparece cuando se busca por SKU.
 */
function condicionDeBusqueda(q) {
  const texto = sinAcentos(q).trim();
  if (!texto) return null;

  const patron = `%${texto}%`;
  const comparable = (columna) => sqlWhere(
    fn('translate', fn('lower', col(columna)), ACENTOS, SIN_ACENTOS),
    { [Op.like]: patron }
  );

  return {
    [Op.or]: [
      comparable('nombre_producto'),
      comparable('nombre_variante'),
      comparable('sku'),
    ],
  };
}

/**
 * ¿La variante sigue estando en la tienda?
 *
 * `vista_en` anterior al último refresco significa que el catálogo se pidió y
 * esta variante no vino: **se borró del otro lado**. La fila se conserva —tiene
 * el registro de lo que se publicó— y es la pantalla la que la marca.
 *
 * Sin ningún refresco todavía no hay contra qué comparar, y decir «ya no está»
 * sería una afirmación sobre algo que nunca se miró.
 */
function estaEnLaTienda(variante, tienda) {
  if (!tienda.catalogo_refrescado_en) return true;

  return new Date(variante.vista_en).getTime() >= new Date(tienda.catalogo_refrescado_en).getTime();
}

/**
 * El listado de variantes: **sobre la instantánea local**, no sobre la API.
 *
 * ── Qué había antes ──
 *
 * `GET /products` pasaba a través la respuesta cruda de TiendaNube: **una sola
 * página**, sin `page` ni `per_page`, descartando las cabeceras que dicen
 * cuántas hay. Una tienda con más productos de los que entran en una página
 * mostraba los primeros y el resto **no se podía mapear**, sin que nada avisara.
 *
 * Y buscar o filtrar sobre eso era imposible por definición: no se puede
 * contestar «cuáles no están mapeadas» sobre una página que todavía no se pidió,
 * y filtrar sobre la que llegó es el mismo defecto con otro nombre —el que tuvo
 * la pantalla de órdenes de compra, donde buscar una orden que existía devolvía
 * «ninguna coincide» y la red ni se tocaba—.
 *
 * ⚠ **Ninguna consulta usa `include`.** Se traen las variantes de la página,
 * después los mapeos de esas variantes, después los productos de esos mapeos, y
 * se unen en JS. Es el mismo corte que la decisión 4 del plan de la 012, y es lo
 * que deja el ancla de `analizarIncludes` donde está.
 */
privado.get('/variantes', checkPermission('config.ver'), async (req, res) => {
  try {
    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: req.empresaId } });
    if (!tienda) throw new ErrorDeNegocio('No hay ninguna tienda vinculada.', 409);

    const { limit, offset } = paginado(req.query, VARIANTES_POR_PAGINA, TOPE_DE_VARIANTES);

    const where = scoped({}, req.empresaId);

    const busqueda = condicionDeBusqueda(req.query.q);
    if (busqueda) where[Op.and] = [busqueda];

    // Los mapeos de la empresa entera y no solo los de la página: hacen falta
    // para el filtro «solo sin mapear», que se aplica ANTES de paginar. Son una
    // fila por producto mapeado, no por variante del catálogo.
    const mapeos = await TiendanubeMapping.findAll({
      where: scoped({}, req.empresaId),
      attributes: ['id', 'product_id', 'tiendanube_variant_id'],
    });

    const mapeoPorVariante = new Map(
      mapeos.map((m) => [String(m.tiendanube_variant_id), m])
    );

    // El string 'true' y no cualquier valor con verdad: `?sin_mapear=0` llega
    // como '0', que en JS es verdadero, y filtraría al revés de lo que dice.
    if (req.query.sin_mapear === 'true' && mapeos.length) {
      where.tiendanube_variant_id = { [Op.notIn]: mapeos.map((m) => m.tiendanube_variant_id) };
    }

    const { count, rows } = await TiendanubeVariante.findAndCountAll({
      where,
      // El desempate por variante no es decorativo: un producto con tres talles
      // tiene tres filas con el MISMO `nombre_producto`, y sin desempate la misma
      // variante puede salir en la página 1 y en la 2, o en ninguna.
      order: [['nombre_producto', 'ASC'], ['tiendanube_variant_id', 'ASC']],
      limit,
      offset,
    });

    const productIds = [...new Set(
      rows
        .map((v) => mapeoPorVariante.get(String(v.tiendanube_variant_id)))
        .filter(Boolean)
        .map((m) => m.product_id)
    )];

    const productos = productIds.length
      ? await Product.findAll({
        where: scoped({ id: { [Op.in]: productIds } }, req.empresaId),
        attributes: ['id', 'name', 'sku', 'is_active'],
      })
      : [];

    const productoPorId = new Map(productos.map((p) => [p.id, p]));

    // El stock **de la sucursal designada** y de ninguna otra: es de donde sale
    // lo que se publica. Sumar todas las sucursales es lo que más vende y lo que
    // peor descuenta.
    const stocks = productIds.length
      ? await Stock.findAll({
        where: scoped(
          { punto_de_venta_id: tienda.punto_de_venta_id, product_id: { [Op.in]: productIds } },
          req.empresaId
        ),
        attributes: ['product_id', 'available'],
      })
      : [];

    const disponiblePorProducto = new Map(stocks.map((s) => [s.product_id, s.available]));

    const data = rows.map((v) => {
      const clave = String(v.tiendanube_variant_id);
      const mapeo = mapeoPorVariante.get(clave) || null;
      const producto = mapeo ? productoPorId.get(mapeo.product_id) : null;

      const disponible = producto && disponiblePorProducto.has(producto.id)
        ? disponiblePorProducto.get(producto.id)
        : null;

      return {
        tiendanube_variant_id: v.tiendanube_variant_id,
        tiendanube_product_id: v.tiendanube_product_id,
        nombre_producto: v.nombre_producto,
        nombre_variante: v.nombre_variante,
        sku: v.sku,
        stock_en_tienda: v.stock_en_tienda,
        en_la_tienda: estaEnLaTienda(v, tienda),
        mapeo: producto
          ? {
            id: mapeo.id,
            product_id: producto.id,
            product_name: producto.name,
            sku: producto.sku,
            product_activo: producto.is_active,
          }
          : null,
        disponible,
        // Se calcula acá y no se lee de la fila: la fila guarda el motivo del
        // último intento, y «no hay fila de stock» es una condición de AHORA. Lo
        // que NO se hace es publicar cero (FR-046): publicar cero agota en la
        // tienda una variante que sí tiene mercadería.
        motivo_no_publicado: motivoDeNoPublicar(v, producto, disponible),
        stock_publicado: v.stock_publicado,
        publicado_en: v.publicado_en,
        pendiente_desde: v.pendiente_desde,
        ultimo_error: v.ultimo_error,
        sugerencia: null,
      };
    });

    await agregarSugerencias(data, req.empresaId);

    res.json({
      ok: true,
      total: count,
      // ⚠ Va en la respuesta y no solo en `/status`: una instantánea sin fecha a
      // la vista es una mentira con horario. Es lo que evita que alguien lea un
      // catálogo de la semana pasada creyendo que es el estado actual.
      refrescado_en: tienda.catalogo_refrescado_en,
      data,
    });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener las variantes de TiendaNube');
  }
});

/** Por qué esta variante no se publica, o `null` si no hay nada que impida. */
function motivoDeNoPublicar(variante, producto, disponible) {
  if (!producto) return MOTIVOS_NO_PUBLICADO.SIN_MAPEO;
  if (disponible === null || disponible === undefined) {
    return MOTIVOS_NO_PUBLICADO.SIN_STOCK_EN_SUCURSAL;
  }

  // Un producto inactivo se publica igual ([PENDIENTE N10]) y la fila se marca:
  // publicar cero por estar inactivo agota una variante que la tienda podría
  // estar vendiendo, y dejar de publicarla la congela en el último número.
  if (producto.is_active === false) return MOTIVOS_NO_PUBLICADO.PRODUCTO_INACTIVO;

  return null;
}

/**
 * Le agrega a las filas sin mapear el producto del sistema que propone su SKU.
 *
 * ⚠ **Propone, no mapea** ([PENDIENTE N3]). Con dos productos del mismo SKU no
 * propone ninguno y dice cuántos hay: mapear solo por SKU es exactamente cómo se
 * mapea el producto equivocado sin que nadie lo mire, y el síntoma aparece en un
 * recuento físico meses después.
 *
 * La consulta se hace solo si hay algo que sugerir: en una pantalla con todo
 * mapeado no se pide nada.
 */
async function agregarSugerencias(data, empresaId) {
  const sinMapear = data.filter((f) => !f.mapeo && f.sku);
  if (!sinMapear.length) return;

  const candidatos = await Product.findAll({
    where: scoped({ sku: { [Op.not]: null } }, empresaId),
    attributes: ['id', 'name', 'sku'],
  });

  const sugerencias = sugerirPorSku(sinMapear, candidatos);

  for (const fila of data) {
    if (fila.mapeo) continue;
    fila.sugerencia = sugerencias.get(String(fila.tiendanube_variant_id))
      || { coincidencias: 0, producto: null };
  }
}

/**
 * Vuelve a traer el catálogo entero de la tienda y reescribe la instantánea.
 *
 * ⚠ **Va declarada ANTES de cualquier `/variantes/:algo`.** Express atiende con
 * la primera ruta que matchea, así que un `/variantes/:id` declarado arriba se
 * quedaría con `refrescar` como si fuera un id. Es la trampa documentada en
 * `routes/sales.js:226-230`.
 */
privado.post('/variantes/refrescar', checkPermission('config.editar'), async (req, res) => {
  try {
    const resumen = await tiendanubeSincronizacion.refrescarCatalogo(req.empresaId);

    logger.info(
      { requestId: req.id, empresaId: req.empresaId, ...resumen },
      'tiendanube: refresco del catálogo pedido a mano'
    );

    res.json({ ok: true, ...resumen });
  } catch (err) {
    fallo(req, res, err, 'No se pudo refrescar el catálogo de TiendaNube');
  }
});

/**
 * Los mapeos de la empresa.
 *
 * **Hasta este hito no existía**, y sin esto la pantalla de mapeo no se podía
 * dibujar: no había forma de saber qué estaba mapeado. La consecuencia práctica
 * era que un mapeo equivocado —el producto correcto contra la variante de otro—
 * solo se corregía entrando a la base.
 */
privado.get('/mapeos', checkPermission('config.ver'), async (req, res) => {
  try {
    const { limit, offset } = paginado(req.query, MAPEOS_POR_PAGINA, TOPE_DE_VARIANTES);

    const { count, rows } = await TiendanubeMapping.findAndCountAll({
      // `scoped()` y no un objeto a mano: la empresa B no ve ninguno de la A
      // (FR-038), y que la fila ajena haya quedado afuera lo verifica el cuarto
      // nivel — una guardia estática solo ve que se llamó.
      where: scoped({}, req.empresaId),
      order: [['id', 'DESC']],
      limit,
      offset,
    });

    const productos = rows.length
      ? await Product.findAll({
        where: scoped({ id: { [Op.in]: rows.map((m) => m.product_id) } }, req.empresaId),
        attributes: ['id', 'name', 'sku', 'is_active'],
      })
      : [];

    const productoPorId = new Map(productos.map((p) => [p.id, p]));

    const variantes = rows.length
      ? await TiendanubeVariante.findAll({
        where: scoped(
          { tiendanube_variant_id: { [Op.in]: rows.map((m) => m.tiendanube_variant_id) } },
          req.empresaId
        ),
      })
      : [];

    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: req.empresaId } });

    const variantePorId = new Map(variantes.map((v) => [String(v.tiendanube_variant_id), v]));

    res.json({
      ok: true,
      total: count,
      data: rows.map((m) => {
        const producto = productoPorId.get(m.product_id) || null;
        const variante = variantePorId.get(String(m.tiendanube_variant_id)) || null;

        return {
          id: m.id,
          product_id: m.product_id,
          product_name: producto ? producto.name : null,
          product_sku: producto ? producto.sku : null,
          product_activo: producto ? producto.is_active : null,
          tiendanube_variant_id: m.tiendanube_variant_id,
          tiendanube_product_id: m.tiendanube_product_id,
          nombre_variante: variante ? nombreLegible(variante) : null,
          // `false` cuando el mapeo quedó apuntando a una variante que ya no está
          // en la tienda: es lo que pasa al vincular OTRA tienda sin borrar los
          // mapeos ([PENDIENTE N9]), y la sincronización va a fallar ahí para
          // siempre si nadie lo ve.
          en_la_tienda: variante && tienda ? estaEnLaTienda(variante, tienda) : false,
        };
      }),
    });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener los mapeos de TiendaNube');
  }
});

/** «Harina 000 · 1 kg», o solo el producto si la variante no tiene nombre. */
function nombreLegible(variante) {
  if (!variante.nombre_variante) return variante.nombre_producto;
  if (!variante.nombre_producto) return variante.nombre_variante;

  return `${variante.nombre_producto} · ${variante.nombre_variante}`;
}

privado.post('/mapeos', checkPermission('config.editar'), async (req, res) => {
  try {
    // `req.body || {}` y no desestructurar: un POST sin cuerpo JSON deja
    // `req.body` sin definir segun el parser que haya corrido, y un
    // TypeError aca saldria como 500 en vez del 400 que corresponde.
    const cuerpo = req.body || {};

    const productId = idEntero(cuerpo.product_id);
    const varianteId = idEntero(cuerpo.tiendanube_variant_id);
    const productoDeLaTienda = idEntero(cuerpo.tiendanube_product_id);

    if (!productId || !varianteId || !productoDeLaTienda) {
      throw new ErrorDeNegocio(
        'El mapeo necesita el producto, la variante y el producto de TiendaNube, ' +
        'los tres como números enteros.'
      );
    }

    // findScoped y no findByPk: el id viene del cuerpo. **Esta es la mitad que
    // no existia.** Sin ella, la empresa B mandaba el product_id de la A y la
    // fila se creaba con el empresa_id de B —asi que revisando la tabla no se
    // ve nada raro— colgada de un producto ajeno, y la respuesta era 201.
    const producto = await findScoped(Product, productId, req.empresaId);

    // 404 y no 403: un 403 confirmaria que ese producto existe en otra empresa,
    // que es justo lo que permite enumerar ids ajenos.
    if (!producto) throw new ErrorDeNegocio('Producto no encontrado', 404);

    // La variante tiene que estar en la instantánea. No es una validación de
    // formato: un mapeo contra una variante que no existe en la tienda es una
    // fila que la sincronización va a intentar publicar y fallar **para
    // siempre**, y el 404 de TiendaNube llega variante por variante sin que nadie
    // sepa de dónde salió ese id. Es el motivo por el que el catálogo se guarda.
    const enElCatalogo = await TiendanubeVariante.findOne({
      where: scoped({ tiendanube_variant_id: varianteId }, req.empresaId),
    });

    if (!enElCatalogo) {
      throw new ErrorDeNegocio(
        'Esa variante no está en el catálogo. Refrescá el catálogo de la tienda y volvé a intentar.'
      );
    }

    let mapping;

    try {
      mapping = await TiendanubeMapping.create({
        empresa_id: req.empresaId,
        // `producto.id` y no `req.body.product_id`: es la forma que dfd7009
        // dejo en routes/suppliers.js y la que `analizarCreates` da por
        // validada. Escribir el id del cuerpo aca reabriria el agujero aunque
        // el findScoped siguiera arriba.
        product_id: producto.id,
        tiendanube_variant_id: varianteId,
        tiendanube_product_id: productoDeLaTienda,
      });
    } catch (err) {
      if (err.name !== 'SequelizeUniqueConstraintError') throw err;

      throw new ErrorDeNegocio(await motivoDelChoque(req.empresaId, producto, varianteId), 409);
    }

    res.status(201).json({ ok: true, data: mapping });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el mapeo de producto');
  }
});

/**
 * Quitar un mapeo.
 *
 * **Hasta este hito no existía**: un mapeo equivocado —el producto correcto
 * contra la variante de otro— solo se corregía entrando a la base, y mientras
 * tanto la sincronización publicaba el stock de un producto en la variante de
 * otro.
 *
 * Va declarada **después** de `POST /mapeos` y de `GET /mapeos`: son verbos
 * distintos, así que el orden no las pisa, pero se mantiene el orden del
 * contrato para que se lea igual que se escribió.
 */
privado.delete('/mapeos/:id', checkPermission('config.editar'), async (req, res) => {
  try {
    // findScoped y no findByPk: el id viene de la URL. Un mapeo de otra empresa
    // **no resuelve**, y la fila ajena queda como estaba — que es lo que un
    // `findByPk` seguido de un `destroy` no garantiza y una guardia estática no
    // puede contestar.
    const mapeo = await findScoped(TiendanubeMapping, req.params.id, req.empresaId);

    if (!mapeo) throw new ErrorDeNegocio('Mapeo no encontrado', 404);

    const varianteId = mapeo.tiendanube_variant_id;

    await mapeo.destroy();

    // Y la variante **sale de la cola**. Sin esto queda una fila pendiente de
    // empujar sin ningún producto al que mirarle el stock: reintentaría hasta
    // agotar los ocho intentos y quedaría en rojo en la pantalla por un mapeo que
    // alguien borró a propósito.
    const [sacadasDeLaCola] = await TiendanubeVariante.update(
      {
        pendiente_desde: null,
        proximo_intento_en: null,
        intentos: 0,
        ultimo_error: null,
        motivo_no_publicado: MOTIVOS_NO_PUBLICADO.SIN_MAPEO,
      },
      { where: scoped({ tiendanube_variant_id: varianteId }, req.empresaId) }
    );

    logger.info(
      { requestId: req.id, empresaId: req.empresaId, mapeoId: mapeo.id, sacadasDeLaCola },
      'tiendanube: mapeo borrado'
    );

    res.json({ ok: true });
  } catch (err) {
    fallo(req, res, err, 'Error al borrar el mapeo de TiendaNube');
  }
});

/**
 * Sincronizar el stock a mano: un PUT por variante mapeada.
 *
 * ── Qué había antes ──
 *
 * `POST /sync-stock` recorría **todas las filas de `Stock`** de la empresa y
 * mandaba un PUT por cada una cuyo producto estuviera mapeado: con tres
 * sucursales, tres PUT a la misma variante con tres números distintos, y ganaba
 * el último en el orden que devolviera la consulta. Y mandaba `quantity`, no
 * `available`.
 *
 * Ante el primer fallo respondía 502 y el conteo que se venía juntando **se
 * perdía**: quien apretaba el botón no sabía cuántas variantes habían entrado ni
 * cuáles faltaban. Por eso acá **el 200 con fallas es el contrato**: el
 * resultado dice cuántas entraron y cuántas no, y `GET /corridas/ultima` dice
 * cuáles.
 *
 * Los tres códigos de error son del servicio y llegan con su texto: 409 «hay una
 * corriendo» o «no hay tienda vinculada», y 400 «no hay ningún mapeo» o el 401
 * de TiendaNube —«hay que volver a vincular»—, que no se arregla reintentando.
 */
privado.post('/sincronizar', checkPermission('config.editar'), async (req, res) => {
  try {
    const resumen = await tiendanubeSincronizacion.sincronizar(req.empresaId, {
      disparador: 'manual',
      usuarioId: req.userId || null,
    });

    // Las `fallas` no van al log: ya están en la fila de la corrida y en la de
    // cada variante, y un catálogo grande las convertiría en cientos de entradas
    // por línea de log.
    logger.info(
      {
        requestId: req.id,
        empresaId: req.empresaId,
        corridaId: resumen.corrida_id,
        mandadas: resumen.mandadas,
        fallidas: resumen.fallidas,
        omitidas: resumen.omitidas,
      },
      'tiendanube: sincronización pedida a mano'
    );

    res.json({
      ok: true,
      corrida_id: resumen.corrida_id,
      mandadas: resumen.mandadas,
      fallidas: resumen.fallidas,
    });
  } catch (err) {
    fallo(req, res, err, 'No se pudo sincronizar el stock con TiendaNube');
  }
});

/**
 * El resultado de la última corrida, y qué está esperando ahora.
 *
 * **Hasta este hito no existía en ningún lado**: ni tabla, ni setting, ni un log
 * del que se pudiera leer, y el pedido nombra «el resultado de la última
 * corrida» explícitamente. Sobrevive un reinicio porque es una fila, no una
 * variable de módulo (FR-043).
 *
 * ⚠ **`cola` es la otra mitad, y no es un adorno.** El empujón por movimiento de
 * stock **no escribe corridas** —serían cientos de filas diarias que nadie lee y
 * que crecen sin tope—, así que su estado vive en la fila de la variante. `cola`
 * lo resume, y contesta algo que un registro de lotes no puede: **qué está
 * desfasado ahora**.
 *
 * `corrida: null` si nunca corrió ninguna, y la pantalla lo distingue de «corrió
 * y no mandó nada»: son dos cosas distintas y la segunda puede querer decir que
 * no hay nada mapeado.
 */
privado.get('/corridas/ultima', checkPermission('config.ver'), async (req, res) => {
  try {
    const corrida = await TiendanubeCorrida.findOne({
      where: { empresa_id: req.empresaId },
      // El desempate por id no es decorativo: dos corridas del mismo segundo
      // —una manual apretada justo cuando corre la reconciliación no puede pasar
      // por el arriendo, pero dos reconciliaciones de dos instancias sí— tendrían
      // el mismo `empezada_en` y «la última» la decidiría el orden físico de las
      // filas.
      order: [['empezada_en', 'DESC'], ['id', 'DESC']],
    });

    const enLaCola = { empresa_id: req.empresaId, pendiente_desde: { [Op.not]: null } };

    const [pendientes, conError, masVieja] = await Promise.all([
      TiendanubeVariante.count({ where: enLaCola }),
      TiendanubeVariante.count({
        where: { empresa_id: req.empresaId, ultimo_error: { [Op.not]: null } },
      }),
      TiendanubeVariante.findOne({
        where: enLaCola,
        order: [['pendiente_desde', 'ASC']],
        attributes: ['pendiente_desde'],
      }),
    ]);

    res.json({
      ok: true,
      // Campo por campo y no la fila cruda: agregarle una columna a la tabla
      // mañana no la publica sola en una respuesta de la API.
      corrida: corrida
        ? {
          id: corrida.id,
          empezada_en: corrida.empezada_en,
          // `null` = se cortó por la mitad. Es un estado propio y la pantalla lo
          // dibuja distinto de «terminó con cero fallas».
          terminada_en: corrida.terminada_en,
          disparador: corrida.disparador,
          usuario_id: corrida.usuario_id,
          mandadas: corrida.mandadas,
          fallidas: corrida.fallidas,
          // Solo las que fallaron ([PENDIENTE N2]): con un catálogo grande, las
          // que salieron bien son cientos de entradas que nadie lee.
          fallas: corrida.fallas || [],
        }
        : null,
      cola: {
        pendientes,
        con_error: conError,
        mas_vieja: masVieja ? masVieja.pendiente_desde : null,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener la última corrida de TiendaNube');
  }
});

module.exports = { publico, privado };
