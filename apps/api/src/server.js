// ════════════════════════════════════════════
//  FAVALIO · Server Entry Point
//  Express + PostgreSQL + Auth0
// ════════════════════════════════════════════

require('dotenv').config();

// Sentry va antes que todo lo demas: si algo falla al cargar un modulo, ese
// error tambien tiene que llegar.
const { iniciarSentry, reportarError, vaciarSentry } = require('./config/sentry');
iniciarSentry();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
// `ipKeyGenerator` normaliza la IP antes de usarla como clave. Sin él, el conteo
// por IPv6 agrupa redes enteras: un proveedor móvil completo contaría como un
// solo visitante, y el límite del catálogo público no limitaría nada.
const { ipKeyGenerator } = require('express-rate-limit');
const { sequelize, Usuario } = require('./models');
const { checkJwt, extractUser, loadEmpresaContext, requireEmpresa } = require('./middleware/auth');
const checkSubscription = require('./middleware/checkSubscription');
const requestId = require('./middleware/requestId');
const requireSuperadmin = require('./middleware/requireSuperadmin');
const requireModulo = require('./middleware/requireModulo');
const subscriptionCron = require('./services/subscriptionCron');
const tiendanubeSincronizacion = require('./services/tiendanubeSincronizacion');
const logger = require('./utils/logger');

// ── Validate required env vars ──
const REQUIRED_ENV = ['AUTH0_DOMAIN', 'AUTH0_AUDIENCE'];
if (process.env.BYPASS_AUTH !== 'true') {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      logger.fatal(`Missing required env var: ${key}`);
      process.exit(1);
    }
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

// Referencia al servidor HTTP, para el cierre ordenado.
let servidor = null;

// ── Trust proxy ──
// Render, Railway, Vercel y cualquier PaaS ponen un reverse proxy delante.
// Sin esto, express-rate-limit ve la IP del proxy en vez de la del cliente
// (limita a todos los usuarios como si fueran uno) y avisa con
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. El valor 1 = confiar en un solo hop.
app.set('trust proxy', 1);

// ── Identificador de request ──
// Primero de todo: para que cualquier cosa que se loguee despues —incluido un
// rechazo de CORS o un error del propio helmet— pueda referenciarlo.
app.use(requestId);

// ── Security Headers ──
app.use(helmet({
  // Los assets servidos por la API (logos de empresa) se embeben desde el
  // dominio del frontend, que es un origen distinto.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── Request Logging (morgan → pino) ──
//
// En produccion los requests se loguean a nivel `info`, no al nivel `http`
// personalizado.
//
// `http` esta definido con valor 10, y el nivel efectivo del logger en
// produccion es `info` (30): todo lo que se emitia por debajo de 30 se
// descartaba. El resultado era que en produccion NO se registraba ni un solo
// request. Sin log de acceso no se puede reconstruir que hizo un usuario antes
// de un error.
//
// En desarrollo se mantiene el nivel http para no ensuciar la consola.
//
// En produccion la linea sale como campos y no como texto: `combined` produce
// una cadena estilo Apache que despues nadie puede filtrar sin escribir una
// expresion regular. Con campos se puede buscar por requestId, por status o
// por ruta directamente en el panel.
morgan.token('id', (req) => req.id);

const FORMATO_PROD = ':id\t:remote-addr\t:method\t:url\t:status\t:response-time';

const nivelRequest = process.env.NODE_ENV === 'production'
  ? (linea) => {
      const [id, ip, metodo, url, status, ms] = linea.trim().split('\t');
      logger.info(
        {
          tipo: 'request',
          requestId: id,
          ip,
          metodo,
          url,
          status: Number(status),
          ms: Number(ms),
        },
        `${metodo} ${url} ${status}`
      );
    }
  : (msg) => logger.http(msg.trim());

app.use(morgan(process.env.NODE_ENV === 'production' ? FORMATO_PROD : 'dev', {
  stream: { write: nivelRequest },
  // El health check lo consulta la plataforma cada pocos segundos: loguearlo
  // tapa todo lo demas.
  skip: (req) => req.originalUrl === '/api/health' || req.originalUrl === '/api/ping',
}));

// ── CORS ──
// Origenes permitidos. Ahora hay mas de uno (app + landing + previews de
// Vercel), asi que se acepta una lista separada por comas en ALLOWED_ORIGINS.
// FRONTEND_URL se mantiene por compatibilidad con la config existente.
const allowedOrigins = [
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()),
  process.env.FRONTEND_URL,
  process.env.LANDING_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
].filter(Boolean);

// Los deploy previews de Vercel usan subdominios efimeros. Se permiten solo
// si se define VERCEL_PREVIEW_PATTERN (ej: "favalio-.*\.vercel\.app$").
const previewPattern = process.env.VERCEL_PREVIEW_PATTERN
  ? new RegExp(process.env.VERCEL_PREVIEW_PATTERN)
  : null;

function isOriginAllowed(origin) {
  if (allowedOrigins.includes(origin)) return true;
  if (previewPattern && previewPattern.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: (origin, cb) => {
    // Sin Origin = same-origin, curl, o health check del PaaS.
    if (!origin) return cb(null, true);
    if (isOriginAllowed(origin)) return cb(null, true);
    logger.warn({ origin }, 'CORS: origen rechazado');
    cb(null, false);
  },
  credentials: true,
  // ⚠ `PATCH` tiene que estar acá o el navegador **no manda el request**: el
  // preflight contesta un `Access-Control-Allow-Methods` sin PATCH y el browser
  // corta antes de salir. El síntoma es un error de red en Inventario al
  // publicar en lote (`PATCH /api/products/publicables`) y al cambiar el estado
  // de un pedido, con la API sana y sin una sola línea en el log del servidor.
  // Y no se ve con curl ni con supertest: ninguno de los dos hace preflight.
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // ⚠ `X-Sesion-Id` tiene que estar acá o el navegador **no la manda**: una
  // cabecera que no figura en `allowedHeaders` hace fallar el preflight y el
  // request ni sale. El síntoma sería un 401 SESION_REQUERIDA en cada pantalla
  // del que despliega —y en ninguno de los tests, porque supertest habla con la
  // app sin preflight—.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Empresa-Id', 'X-Punto-De-Venta-Id', 'X-Request-Id', 'X-Sesion-Id'],
  // X-Request-Id se expone para que el frontend pueda leerlo: sin esto el
  // navegador se lo oculta al codigo de la app y el usuario no tiene que
  // copiar a mano.
  exposedHeaders: ['X-Empresa-Id', 'X-Punto-De-Venta-Id', 'X-Request-Id'],
}));
// ⚠ ── El router publico de TiendaNube se monta ANTES del express.json global ──
//
// No es preferencia de orden: es lo unico que hace que el webhook funcione.
// `routes/tiendanube.js` trae su propio `express.json({ type, verify })` para
// guardar el cuerpo crudo en `req.rawBody`, que es contra lo que se verifica la
// firma HMAC. body-parser NO ejecuta el `verify` si alguien ya parseo el cuerpo,
// asi que con este `app.use(express.json(` delante, `req.rawBody` quedaba
// `undefined`, `firmaValida` cortaba en `!req.rawBody` y **todo webhook
// respondia 401**. Ningun pedido de la tienda online desconto stock jamas, y el
// 401 repetido ademas apaga la integracion del otro lado: TiendaNube
// deshabilita el webhook ante errores repetidos.
//
// Ademas queda ARRIBA del rate limiter (mas abajo, `app.use('/api/', limiter)`),
// que es deliberado: los 600 requests por IP cada 15 minutos estan pensados para
// el navegador de una caja, y las IP de TiendaNube no son las de nadie sentado
// en una caja. Un 429 al webhook es un pedido que no descuenta.
//
// ⚠ Consecuencia para el futuro: **cualquier ruta que se agregue al router
// `publico` nace sin `express.json` global y sin rate limit**. Si necesita
// cuerpo JSON, se lo tiene que poner ella, como hace `/webhook`. Esta advertencia
// esta repetida en `routes/tiendanube.js` porque es contraintuitiva, y hay una
// guardia en `tests/observabilidad.test.js` que falla si este montaje vuelve a
// caer debajo del `express.json` global.
//
// El montaje del router `privado` NO se mueve: sigue mas abajo, detras de la
// cadena de autenticacion. Como el publico solo declara `/callback` y `/webhook`,
// el resto cae al privado por orden de declaracion.
app.use('/api/tiendanube', require('./routes/tiendanube').publico);

app.use(express.json({ limit: '10mb' }));

// ════════════════════════════════════════════
//  Las fotos, SOLO cuando no hay quien las sirva mejor
//
//  `utils/imagenes.js` dice —y sigue siendo cierto— que las fotos no las sirve
//  la API: un proceso de Node mandando archivos estáticos compite por el mismo
//  event loop que las cajas del comercio. En el VPS las sirve Caddy desde el
//  volumen, y este bloque queda apagado.
//
//  El esquema PaaS (Render + Vercel + Neon) no tiene Caddy ni volumen: no hay
//  ningún otro proceso que pueda leer el directorio donde `guardarImagen`
//  escribió. Sin este bloque, cada miniatura del panel y cada foto de la tienda
//  son un 404 — y el dato en la base está bien, así que no hay a dónde mirar.
//
//  Por eso va detrás de una variable y NO es el defecto: que encenderlo sea una
//  decisión explícita del que despliega, y que el que lea esto en el VPS no
//  crea que la API ya está sirviendo archivos.
//
//  ⚠ En Render free el disco es EFÍMERO: cada deploy y cada reinicio del
//  servicio se lleva las fotos subidas. La base sigue apuntando a rutas que ya
//  no existen. Es aceptable para probar en línea; no lo es para un comercio
//  real, y ese es uno de los motivos por los que existe el VPS.
//
//  Va antes del limitador global —que sólo cuelga de `/api/`— y con el mismo
//  `Cache-Control` que pone Caddy: el nombre del archivo es aleatorio y nunca
//  se reusa, así que una foto que cambia es una URL nueva.
// ════════════════════════════════════════════
if (process.env.SERVIR_IMAGENES === 'true') {
  const rutaDeImagenes = process.env.RUTA_DE_IMAGENES || '/var/favalio/imagenes';

  logger.warn(
    { ruta: rutaDeImagenes },
    'imagenes: las sirve la API (SERVIR_IMAGENES=true). En el VPS esto lo hace Caddy'
  );

  app.use('/img', express.static(rutaDeImagenes, {
    // `index` y `redirect` apagados: `/img/aa/` no tiene que listar ni redirigir
    // a ningún lado. Sólo se sirve el archivo exacto que pidió alguien que ya
    // conocía el nombre — que es lo único que aísla estas fotos entre empresas.
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    maxAge: '1y',
    immutable: true,
    // Sin `fallthrough`: un `/img/` que no existe termina en 404 acá y no sigue
    // bajando por la cadena de autenticación, que respondería 401 y mandaría a
    // buscar un problema de sesión donde hay un archivo que falta.
    fallthrough: false,
  }));
}

// ── Health Check (público: sin auth y sin rate limit) ──
// Va DESPUES de cors y ANTES del rate limiter, a proposito.
// Antes estaba declarado arriba de app.use(cors(...)), con lo cual no recibia
// cabeceras CORS: un fetch desde el navegador para despertar la API (util con
// el cold start de ~50s del free tier de Render) quedaba bloqueado.
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, msg: 'Favalio API OK', time: new Date().toISOString() });
});

// ── Health check profundo ──
//
// /api/ping solo dice que el proceso responde. Render lo usaba como
// healthCheckPath, con lo cual el servicio figuraba SANO aunque Postgres
// estuviera caido y cada request devolviera 500. Nadie se enteraba: ni una
// alerta, ni un reinicio, ni un aviso en el panel.
//
// Este endpoint verifica de verdad que se puede consultar la base. Es el que
// tiene que mirar la plataforma.
app.get('/api/health', async (req, res) => {
  const inicio = Date.now();

  try {
    await sequelize.query('SELECT 1');

    res.json({
      ok: true,
      base_de_datos: 'ok',
      // Con Neon free la base autosuspende: la primera consulta despues de la
      // suspension tarda. Exponer el tiempo permite distinguir "esta lenta"
      // de "esta caida" sin adivinar.
      latencia_ms: Date.now() - inicio,
      time: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'health: la base de datos no responde');

    res.status(503).json({
      ok: false,
      base_de_datos: 'error',
      latencia_ms: Date.now() - inicio,
      time: new Date().toISOString(),
    });
  }
});

// ── Disparador externo de tareas programadas ──
//
// El cron de suscripciones corre con setInterval dentro del proceso. En el free
// tier de Render el servicio duerme a los 15 min sin trafico, y setInterval no
// dispara mientras duerme: los vencimientos y los avisos NO se procesan de
// forma confiable. Con la app usandose de dia y durmiendo de noche, el cron
// puede pasar dias sin correr.
//
// Este endpoint permite que un cron externo gratuito (cron-job.org, GitHub
// Actions, el scheduler de la propia plataforma) lo despierte una vez por dia.
// Ademas de correr las tareas, la peticion despierta el servicio.
//
// Se protege con un secreto compartido y no con la sesion de un usuario:
// quien lo llama es una maquina, no una persona. Sin CRON_SECRET configurado
// el endpoint queda deshabilitado, para que no exista una ruta abierta por
// olvido.
app.post('/api/tareas/ejecutar', async (req, res) => {
  const secreto = process.env.CRON_SECRET;

  if (!secreto) {
    return res.status(404).json({ ok: false, error: 'No disponible' });
  }

  const recibido = req.headers['x-cron-secret'];

  if (recibido !== secreto) {
    logger.warn({ ip: req.ip }, 'tareas: intento con secreto invalido');
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  try {
    const resultado = await subscriptionCron.expireTrials();
    const avisos = await subscriptionCron.avisarVencimientosProximos();

    // ── La red de la sincronizacion de TiendaNube ──
    //
    // La reconciliacion de cada tienda vinculada —refrescar la instantanea,
    // comparar los tres numeros y encolar solo lo que difiere— mas el barrido de
    // los `state` del OAuth vencidos y el de las corridas viejas.
    //
    // ⚠ Va DESPUES de las suscripciones y en su propio `try`: un fallo hablando
    // con TiendaNube no puede impedir que se venzan las pruebas gratuitas ni que
    // salgan los avisos de vencimiento, que es lo que este cron ya hacia.
    //
    // ⚠⚠ Y hoy esto NO CORRE: `.github/workflows/tareas-diarias.yml` corta
    // porque faltan API_URL y CRON_SECRET, y sin CRON_SECRET este endpoint
    // responde 404 mas arriba. Por eso el caso normal de la sincronizacion no
    // depende de aca —el drenaje lo dispara la propia peticion que movio el
    // stock— y por eso GET /api/tiendanube/status devuelve `reconciliada_en`:
    // la ausencia de la red tiene que verse en la pantalla, no suponerse.
    let tiendanube = null;

    try {
      tiendanube = await tiendanubeSincronizacion.tareasDiarias();
    } catch (err) {
      logger.error({ err }, 'tareas: fallaron las tareas diarias de TiendaNube');
    }

    logger.info({ ...resultado, avisos, tiendanube }, 'tareas: ejecucion manual completada');

    res.json({ ok: true, ...resultado, avisos, tiendanube });
  } catch (err) {
    logger.error({ err }, 'tareas: error en la ejecucion manual');
    res.status(500).json({ ok: false, error: 'Error ejecutando las tareas' });
  }
});

// ── Rate Limiting (después de ping) ──
// El limite se cuenta por IP, y se sube de 200 a 600 requests cada 15 minutos.
//
// Por que sube: un comercio con tres cajas sale a internet por un unico router,
// asi que las tres comparten IP y entre las tres consumen el mismo cupo. Y en
// un punto de venta una sola operacion dispara varias llamadas (buscar
// producto, registrar la venta, pedir el CAE, refrescar el listado). Con 200
// cada 15 minutos, una hora movida corta ventas reales.
//
// Por que NO se cuenta por usuario, que seria mas justo: este middleware corre
// ANTES de la cadena de autenticacion, asi que req.userId todavia no existe.
// Tomar el `sub` del token sin validarlo permitiria evadir el limite
// inventando tokens. Contar por IP es menos preciso pero no se puede falsear
// tan facil, y es lo que protege del abuso sin sesion.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 10000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas solicitudes. Intente de nuevo en 15 min.' },
  // ⚠ El prefijo publico del catalogo NO consume este cupo, y sacar esta linea
  // devuelve el problema **sin que nada falle**: el catalogo seguiria andando y
  // las cajas del comercio empezarian a recibir 429 los sabados a la tarde.
  //
  // El motivo: este limitador cuenta por IP y corre ANTES de la autenticacion.
  // Un gimnasio entero detras de un NAT comparte una sola IP con... nadie mas,
  // salvo que el comercio este en la misma red — pero cincuenta personas
  // escaneando el QR de una tienda comen 50 requests del cupo de 600 que el
  // punto de venta necesita para vender.
  //
  // El catalogo tiene su propio limitador, `limitadorPublico`, mas abajo. Los
  // dos van atados por `tests/observabilidad.test.js`: un prefijo eximido sin
  // limitador propio es una superficie abierta.
  //
  // ⚠ `req.path` adentro de un `app.use('/api/', ...)` viene RELATIVO al punto
  // de montaje: la comparacion es '/publico/' y no '/api/publico/'.
  skip: (req) => req.path.startsWith('/publico/'),
});
app.use('/api/', limiter);

// El limitador del catalogo publico.
//
// Ventana corta y cupo por IP **y slug**: el que abre una tienda no tiene por
// que gastarle el cupo al que abre otra, y contar solo por IP agruparia a todo
// un gimnasio detras de su NAT.
//
// `ipKeyGenerator` es de express-rate-limit v8 y hace falta: sin el, el conteo
// por IPv6 agrupa redes enteras — un proveedor movil entero contaria como un
// solo visitante.
const limitadorPublico = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 10000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const { slugDeLaRuta } = require('./utils/slugDeCatalogo');
    return `${ipKeyGenerator(req.ip)}:${slugDeLaRuta(req.path) || '-'}`;
  },
  // ⚠ El `error` es un CÓDIGO y el texto va aparte, al revés que el limitador
  // global. No es cosmético: `apps/tienda` decide qué pantalla dibuja mirando
  // este código, y con un texto en castellano no lo reconoce — el 429 caía en la
  // pantalla neutra de «no disponible» en vez de la de reintentar.
  //
  // Y no se veía en ningún test: los de la tienda simulan el cuerpo del
  // contrato, así que estaban verdes contra una respuesta que el servidor no
  // producía. Lo atrapó leer los dos archivos, no ejecutarlos.
  message: {
    ok: false,
    error: 'DEMASIADAS_PETICIONES',
    mensaje: 'Demasiadas solicitudes. Probá de nuevo en un minuto.',
  },
});

// El limitador del ALTA de pedidos, que es otra cosa.
//
// 120 lecturas por minuto son un socio mirando la tienda; 120 **altas** por
// minuto son 120 pedidos falsos en la bandeja del comercio, que despues tiene
// que borrar a mano y que le tapan los de verdad. Leer y escribir desde una
// pagina publica no pueden compartir cupo.
//
// El cuerpo es el mismo codigo `DEMASIADAS_PETICIONES`: la tienda ya sabe
// dibujarlo, y un codigo nuevo seria una pantalla que nadie escribio.
const limitadorDePedidos = rateLimit({
  windowMs: 10 * 60 * 1000,
  // ⚠ La condicion es sobre `production` y no sobre `development`, al reves que
  // el limitador de arriba. El motivo: este cupo es de diez, y la suite de
  // integracion manda muchos mas pedidos que eso desde la misma IP — con la
  // condicion escrita al reves, catorce casos se caian con 429 y el mensaje de
  // error acusaba al handler, que estaba bien.
  max: process.env.NODE_ENV === 'production' ? 10 : 10000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const { slugDeLaRuta } = require('./utils/slugDeCatalogo');
    // ⚠ `originalUrl` y no `path`: adentro de un `app.use` con ruta, `req.path`
    // viene **relativo al montaje**, o sea '/'. Con `path`, el slug siempre sale
    // nulo y las diez altas por ventana quedan compartidas entre TODOS los
    // catalogos — un comercio con movimiento le gasta el cupo a los demas.
    return `pedido:${ipKeyGenerator(req.ip)}:${slugDeLaRuta(req.originalUrl) || '-'}`;
  },
  message: {
    ok: false,
    error: 'DEMASIADAS_PETICIONES',
    mensaje: 'Ya mandaste varios pedidos seguidos. Esperá unos minutos.',
  },
});

// ── Rutas protegidas con Auth0 ──
// Ahora usamos Auth0 incluso en desarrollo. Si necesitas bypass, usa BYPASS_AUTH=true
const authMiddleware = process.env.BYPASS_AUTH === 'true'
  ? [(req, res, next) => {
      req.userId = 'test-user-id';
      req.empresaId = 1;
      req.userRole = 'admin';
      Usuario.findOne({ where: { auth0_sub: 'test-user-id' } })
        .then(async (u) => {
          req.usuario = u;
          // Cargar permisos en bypass mode (admin = todos)
          const { RolPermiso, UsuarioPermiso, UsuarioEmpresa, PuntoDeVenta } = require('./models');
          try {
            const ue = await UsuarioEmpresa.findOne({
              where: { usuario_id: u.id, empresa_id: 1, is_active: true },
            });
            if (ue && ue.rol_id) {
              const rp = await RolPermiso.findAll({
                where: { rol_id: ue.rol_id },
                attributes: ['permiso_codigo'],
              });
              const permisos = new Set(rp.map(p => p.permiso_codigo));
              const overrides = await UsuarioPermiso.findAll({
                where: { usuario_empresa_id: ue.id },
                attributes: ['permiso_codigo', 'granted'],
              });
              for (const o of overrides) {
                if (o.granted) permisos.add(o.permiso_codigo);
                else permisos.delete(o.permiso_codigo);
              }
              req.usuarioPermisos = [...permisos];
            } else {
              req.usuarioPermisos = [];
            }
            // Cargar punto de venta por defecto
            const pvHeader = req.headers['x-punto-de-venta-id'];
            if (pvHeader) {
              req.puntoDeVentaId = parseInt(pvHeader, 10);
            } else {
              const defaultPv = await PuntoDeVenta.findOne({
                where: { empresa_id: 1, is_active: true },
                order: [['id', 'ASC']],
              });
              if (defaultPv) req.puntoDeVentaId = defaultPv.id;
            }
          } catch {
            req.usuarioPermisos = [];
          }
          next();
        })
        .catch(() => { req.usuarioPermisos = []; next(); });
    }]
  : [checkJwt, extractUser, loadEmpresaContext];

// ⚠ ── LA LÍNEA DEL CORTE 8: sacarla revierte las sesiones y nada más ──
//
// `registrarSesion` corre en TODOS los requests: registra desde qué dispositivo
// entró cada persona y corta con 401 si esa sesión la cerraron desde la pantalla
// de Equipo. Es el único cambio del hito que puede dejar la aplicación entera sin
// funcionar, así que tiene que poder revertirse quitando **una línea**, sin tocar
// las cadenas ni los treinta montajes de abajo. Por eso se empuja sobre
// `authMiddleware` en vez de escribirse en las dos cadenas: `authEmpresa` y
// `authSinEmpresa` se arman con `[...authMiddleware, …]` diez líneas más abajo,
// así que las dos lo heredan y hay un solo lugar que sacar. La tabla `sesiones`
// se puede quedar.
//
// Queda DESPUÉS de `loadEmpresaContext` —que es lo último de `authMiddleware`—
// porque necesita `req.usuario`, y ANTES de `requireEmpresa`, que es lo correcto:
// una sesión es de una persona y no de una empresa (la tabla no tiene
// `empresa_id`), así que registrarla no depende de que haya empresa activa.
//
// Sin `Authorization` no hace nada, y eso es lo que hace que el cron, el webhook
// de TiendaNube, las pruebas de navegador y los ~1400 tests con `BYPASS_AUTH` no
// se enteren de que existe. El `require` va en la misma línea a propósito: una
// línea de import arriba sería una segunda cosa que sacar el día del rollback.
authMiddleware.push(require('./middleware/registrarSesion'));

// ── Cadena para rutas con datos de una empresa ──
// requireEmpresa va DESPUES de loadEmpresaContext y ANTES de
// checkSubscription: sin empresa activa no hay suscripcion que chequear, y
// sobre todo no hay empresa valida sobre la cual operar. Antes las rutas lo
// resolvian con `req.empresaId || 1`, que ante un contexto no resuelto caia
// sobre la empresa 1 — un cliente real en produccion.
// checkSubscription solo fuera de bypass, igual que antes: en desarrollo con
// BYPASS_AUTH no se quiere que un trial vencido en la empresa 1 local bloquee
// todos los endpoints.
const authEmpresa = process.env.BYPASS_AUTH === 'true'
  ? [...authMiddleware, requireEmpresa]
  : [...authMiddleware, requireEmpresa, checkSubscription];

// ── Cadena para rutas que un usuario SIN empresa todavia debe poder usar ──
// Un usuario recien registrado no tiene empresa hasta completar el onboarding,
// y quien acepta una invitacion tampoco la tiene antes de aceptarla. Estas
// rutas se autentican igual, pero no pueden exigir empresa activa: hacerlo
// dejaria al usuario nuevo sin forma de crear la primera.
// El scoping de las que SI operan sobre una empresa se aplica ruta por ruta
// dentro de routes/empresas.js.
const authSinEmpresa = [...authMiddleware];

// ⚠ ── Los montajes SIN requireEmpresa van ARRIBA del /api generico ──
//
// Los middlewares de un `app.use('/api', …)` corren para **todo** lo que empiece
// con /api, matchee o no el router que va detras. O sea que la cadena
// `...authEmpresa` de la linea de mas abajo —checkJwt, loadEmpresaContext,
// requireEmpresa, checkSubscription— se aplica igual a un request de
// /api/auth/invite/... aunque el router que lo atiende sea otro. Cualquier
// montaje mas debil que quede DEBAJO nunca recibe el request: lo corta
// requireEmpresa con 403 NO_EMPRESA, o checkJwt con 401 si no hay token.
//
// Las tres lineas de aca abajo son exactamente las que necesitan un usuario sin
// empresa, y por eso son las que tienen que estar arriba:
//
//  - GET /api/auth/invite/:token es publico: quien abre el enlace del mail
//    todavia no tiene cuenta. Debajo respondia 401.
//  - POST /api/auth/accept-invite/:token se autentica pero NO puede exigir
//    empresa: la fila de usuario_empresas es lo que ese endpoint crea. Debajo
//    respondia 403, o sea que `authSinEmpresa` era codigo muerto tal como
//    estaba montado.
//  - POST /api/empresas/onboarding es el endpoint del usuario recien
//    registrado, que por definicion no tiene empresa. Tambien respondia 403.
//
// Hasta este hito las dos de auth ademas se montaban con `app.get`/`app.post`,
// que le pasa a un Router la URL entera como punto de montaje: adentro buscaba
// `/` y respondian **404 siempre**. El motivo completo esta en routes/auth.js.
//
// Lo protege `tests/montajeDeRouters.test.js`, que verifica el **tipo** de
// montaje y el **orden**. Es la unica red: con BYPASS_AUTH=true se clava
// req.empresaId = 1 y requireEmpresa no dispara, asi que ningun test de
// integracion puede distinguir este orden del anterior.
//
// Esto NO tiene nada que ver con el motivo por el que el router publico de
// TiendaNube subio arriba del `express.json` global —ese necesita el cuerpo
// crudo— aunque la forma sea la misma: un montaje que queda debajo de otro que
// ya opino sobre el request. Estos tres no necesitan subir tanto: el rate
// limiter y el parser de JSON les corresponden.
app.use('/api/auth', require('./routes/auth').publico);
app.use('/api/auth', ...authSinEmpresa, require('./routes/auth').privado);
app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'));

// ════════════════════════════════════════════
//  El catálogo público · POR QUÉ VA EXACTAMENTE ACÁ
//
//  **Arriba** del `app.use('/api', ...authEmpresa, general)` de más abajo,
//  porque los middlewares de ese montaje corren para **todo** lo que empiece con
//  `/api`, matchee o no el router de atrás: un visitante sin token recibiría el
//  401 de `checkJwt` sin llegar nunca a un handler. Es el defecto que dejó
//  `POST /api/auth/accept-invite` respondiendo 403 durante meses.
//
//  **Debajo** del `express.json` global, que es lo contrario del router público
//  de TiendaNube: allá hace falta el cuerpo crudo para verificar la firma HMAC,
//  acá no hay firma que verificar y el `POST /pedidos` necesita el cuerpo
//  parseado.
//
//  Y con `limitadorPublico` aplicado en esta misma línea. El limitador global lo
//  exime por prefijo; si esta línea perdiera su limitador, la exención quedaría
//  eximiendo a una superficie sin límite. Los dos están atados por
//  `tests/observabilidad.test.js`.
// ════════════════════════════════════════════
// El alta de pedidos lleva SU limitador, y va **antes** del montaje del router:
// `app.use` con ruta corre para lo que empiece con ese camino, asi que este
// llega primero y el otro cuenta despues. Al reves, el alta quedaria con el cupo
// de las lecturas.
app.use('/api/publico/c/:slug/pedidos', limitadorDePedidos);
app.use('/api/publico', limitadorPublico, require('./routes/catalogoPublico').publico);

// Y las PÁGINAS del catálogo, que no cuelgan de `/api` y es a propósito: es una
// página HTML, no una API. Colgada de `/api` la vería el limitador global —que
// exime `/publico/`, no `/c/`— y quedaría del lado de una cadena pensada para
// JSON, con `checkSubscription` incluido.
//
// Sirve el `index.html` de la tienda con los metadatos del catálogo puestos, que
// es lo que WhatsApp lee al compartir el enlace. Los metadatos NO se pueden
// poner desde React: el lector de previsualizaciones no ejecuta JavaScript.
app.use('/c', limitadorPublico, require('./routes/catalogoPublico').paginas);

// El catálogo lleva el gate del módulo además de la cadena de sesión: es una
// funcionalidad que se libera por empresa, y `requireModulo` es la mitad del
// gate que hasta el hito 10 vivía sólo en el navegador.
app.use('/api/catalogos', ...authEmpresa, requireModulo('catalogo'), require('./routes/catalogos'));
// La bandeja lleva el gate del **mismo** modulo: `catalogo` libera la
// funcionalidad entera —el ABM, la tienda publica y los pedidos que entran por
// ella—. Un modulo `pedidos` aparte dejaria habilitar una mitad sin la otra, y
// una bandeja sin catalogo no puede recibir un solo pedido.
app.use('/api/pedidos', ...authEmpresa, requireModulo('catalogo'), require('./routes/pedidos'));
app.use('/api/products', ...authEmpresa, require('./routes/products'));
app.use('/api/sales', ...authEmpresa, require('./routes/sales'));
app.use('/api/suppliers', ...authEmpresa, require('./routes/suppliers'));
app.use('/api/afip', ...authEmpresa, require('./routes/afip'));
app.use('/api', ...authEmpresa, require('./routes/general'));
// TiendaNube se monta en dos partes: lo que llama TiendaNube desde afuera va
// sin sesion (valida firma HMAC) y **se monta mucho mas arriba**, antes del
// `express.json` global y del rate limiter — el motivo esta escrito alla, y
// moverlo de vuelta aca deja el webhook sin cuerpo crudo y respondiendo 401.
// Lo que llama la app va autenticado y es esta linea.
app.use('/api/tiendanube', ...authEmpresa, require('./routes/tiendanube').privado);
app.use('/api/production', ...authEmpresa, requireSuperadmin, require('./routes/production'));
// ── Modulos todavia no liberados a los clientes ──
// requireSuperadmin va DESPUES de la cadena de empresa: primero se resuelve
// quien sos y sobre que empresa operas, y recien despues si este modulo
// existe para vos. Responde 404 y no 403: un 403 confirma que el modulo esta
// ahi y solo oculto.
app.use('/api/customers', ...authEmpresa, requireSuperadmin, require('./routes/customers'));
app.use('/api/stock', ...authEmpresa, require('./routes/stock'));
app.use('/api/reports', ...authEmpresa, requireSuperadmin, require('./routes/reports'));
app.use('/api/dashboard', ...authEmpresa, require('./routes/dashboard'));
app.use('/api/cashflow', ...authEmpresa, requireSuperadmin, require('./routes/cashflow'));
app.use('/api/taxes', ...authEmpresa, requireSuperadmin, require('./routes/taxes'));
app.use('/api/import', ...authEmpresa, require('./routes/import'));
app.use('/api/precios', ...authEmpresa, require('./routes/precios'));
app.use('/api/gastos-variables', ...authEmpresa, require('./routes/gastosVariables'));
app.use('/api/comparador', ...authEmpresa, require('./routes/comparador'));

// Los dos montajes de /api/auth y el de /api/empresas vivian aca abajo, y ese
// era el defecto: ver el bloque de arriba de app.use('/api/products', …).

// ── Error Handler Global ──
app.use((err, req, res, next) => {
  // Un token vencido no es una falla del servidor: es lo que pasa cada vez que
  // alguien deja una pestaña abierta. Logueado como error y con el stack
  // completo, tapaba los errores reales y disparaba alertas por nada.
  if (err.status === 401) {
    logger.warn({ requestId: req.id, ruta: req.originalUrl }, 'Token inválido o expirado');
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }

  const contexto = {
    requestId: req.id,
    ruta: req.originalUrl,
    metodo: req.method,
    empresaId: req.empresaId,
  };

  logger.error({ err, ...contexto }, 'Error no atrapado por la ruta');
  reportarError(err, contexto);

  if (res.headersSent) return next(err);

  res.status(err.status || 500).json({
    ok: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Error interno del servidor',
    requestId: req.id,
  });
});

// ── Setup inicial ──
const setupDefaultData = require('./setup');
const seedPermissions = require('./seedPermissions');
const seedPuntosDeVenta = require('./seedPuntosDeVenta');

/**
 * Avisa al arrancar si hay tiendas vinculadas y no hay `TIENDANUBE_CLIENT_SECRET`.
 *
 * `firmaValida` devuelve `false` cuando falta el secreto, asi que **un despliegue
 * mal configurado y un intento de suplantacion producen el mismo 401 y el mismo
 * warn**: sin este aviso, la unica pista de que falta una variable de entorno es
 * una tienda que dejo de descontar stock y nadie sabe desde cuando.
 *
 * **No corta el arranque**, y es deliberado: una empresa que no usa TiendaNube no
 * tiene por que quedarse sin API por una variable de una integracion opcional.
 * Tampoco corta si la consulta falla —la tabla puede no existir todavia en una
 * base sin migrar— porque un aviso no puede impedir que el servidor levante.
 */
async function avisarSiFaltaElSecretoDeTiendanube() {
  if (process.env.TIENDANUBE_CLIENT_SECRET) return;

  try {
    const { TiendanubeTienda } = require('./models');
    const vinculadas = await TiendanubeTienda.count();

    if (!vinculadas) return;

    logger.error(
      { tiendasVinculadas: vinculadas },
      'tiendanube: hay tiendas vinculadas y falta TIENDANUBE_CLIENT_SECRET. ' +
      'TODOS los webhooks se van a rechazar con 401 y ningun pedido va a descontar stock.'
    );
  } catch (err) {
    logger.warn({ err }, 'tiendanube: no se pudo comprobar si falta el secreto');
  }
}

// ── Iniciar servidor ──
async function start() {
  try {
    await sequelize.authenticate();
    logger.info('PostgreSQL connected');

    if (process.env.NODE_ENV === 'production') {
      logger.info('Production mode: skipping sequelize.sync() — use "npm run migrate" instead');
    } else {
      await sequelize.sync({ alter: true });
      logger.info('Models synchronized (development)');
    }

    await seedPermissions();
    await seedPuntosDeVenta();
    await setupDefaultData();

    await avisarSiFaltaElSecretoDeTiendanube();

    subscriptionCron.start();

    // Se guarda la referencia para poder cerrarlo de forma ordenada: sin ella
    // el shutdown cortaba la base con requests todavia en vuelo.
    servidor = app.listen(PORT, () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Server started');
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Solo arranca si el archivo se ejecuta directo (node src/server.js).
// Cuando se importa desde un test, se exporta `app` sin abrir el puerto ni
// conectar a la base, para poder ejercitarlo con supertest.
if (require.main === module) {
  start();

  // ── Graceful Shutdown ──
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // ── Fallos no atrapados ──
  //
  // No habia handlers. En Node una promesa rechazada sin catch tumba el
  // proceso, y una excepcion no atrapada tambien: el contenedor se reiniciaba
  // sin dejar ningun rastro de por que. Con los logs yendo a un archivo
  // efimero, el motivo se perdia del todo.
  //
  // Se loguea y se sale con codigo distinto de cero para que la plataforma lo
  // registre como caida y no como reinicio normal. No se intenta seguir
  // operando: despues de una excepcion no atrapada el estado del proceso es
  // desconocido, y una API de facturacion en estado desconocido es peor que
  // una API caida.
  process.on('unhandledRejection', (motivo, promesa) => {
    logger.fatal({ err: motivo, promesa: String(promesa) }, 'Promesa rechazada sin catch');
    reportarError(motivo instanceof Error ? motivo : new Error(String(motivo)), { ruta: 'unhandledRejection' });
    shutdown(1);
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Excepcion no atrapada');
    reportarError(err, { ruta: 'uncaughtException' });
    shutdown(1);
  });
}

/**
 * Cierre ordenado.
 *
 * El orden importa: primero se deja de aceptar requests nuevos y se esperan
 * los que estan en vuelo, y RECIEN despues se cierra la base. La version
 * anterior cerraba Postgres de una, con lo cual una venta a medio guardar
 * durante un deploy se cortaba en el medio.
 *
 * @param {number} codigo Codigo de salida. 0 para un cierre normal.
 */
function shutdown(codigo = 0) {
  logger.info({ codigo }, 'Cerrando el servidor');

  subscriptionCron.stop();

  // Si el cierre se traba, no se puede esperar indefinidamente: la plataforma
  // manda SIGKILL a los ~30s de todas formas.
  const plazo = setTimeout(() => {
    logger.error('El cierre ordenado tardo demasiado, se fuerza la salida');
    process.exit(codigo || 1);
  }, 10000);
  plazo.unref();

  const cerrarBase = () => {
    // Primero se vacia la cola de Sentry: si el proceso muere con el error que
    // causo la caida todavia en cola, ese error —el que mas importa— no se
    // entera nadie.
    vaciarSentry(2000).finally(() => {
      sequelize.close()
        .then(() => logger.info('Conexion a PostgreSQL cerrada'))
        .catch((err) => logger.error({ err }, 'Error cerrando PostgreSQL'))
        .finally(() => {
          clearTimeout(plazo);
          process.exit(codigo);
        });
    });
  };

  if (servidor) {
    // close() deja de aceptar conexiones nuevas y espera a que terminen las
    // que estan en curso.
    servidor.close(cerrarBase);
  } else {
    cerrarBase();
  }
}

// `avisarSiFaltaElSecretoDeTiendanube` se exporta para poder ejercitarlo: corre
// dentro de `start()`, que ningun test llama —abre el puerto—, y un aviso que
// nadie probo es un aviso que puede no salir el dia que haga falta.
module.exports = { app, start, shutdown, avisarSiFaltaElSecretoDeTiendanube };
