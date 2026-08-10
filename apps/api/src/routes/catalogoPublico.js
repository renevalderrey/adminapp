// ════════════════════════════════════════════
//  FAVALIO · Rutas: el catálogo público
//
//  El primer pedazo de Favalio que le contesta a alguien que no inició sesión.
//  Del otro lado hay una persona que escaneó un QR pegado en la recepción de un
//  gimnasio: no tiene cuenta, no tiene empresa, y no debería poder averiguar
//  nada del comercio más allá de lo que el comercio decidió publicar.
//
//  ── La decisión que ordena todo este archivo ──
//
//  `req.empresaId` se deja **sin definir**, a propósito, y cada consulta escribe
//  `req.publico.empresaId` a mano.
//
//  Lo cómodo sería setear `req.empresaId` en el middleware: `scoped` y
//  `findScoped` funcionarían igual que en cualquier ruta privada. Y ese es el
//  problema — **una copia de un handler privado compilaría y andaría**, y la
//  diferencia entre «la empresa la resolvió el slug» y «la empresa la resolvió
//  el JWT» dejaría de verse en el código.
//
//  Con `req.publico`, una consulta copiada de otro lado tira 500 en el primer
//  request por `assertEmpresaId`. Fallar fuerte y temprano es exactamente lo que
//  se quiere en la única superficie del sistema que contesta sin autenticar.
//
//  ── Y la que ordena las respuestas ──
//
//  Todo lo que sale pasa por `utils/vistaPublica.js`, campo por campo. Nunca la
//  fila del modelo, nunca un spread. Lo sostiene
//  `tests/proyeccionPublica.test.js`.
// ════════════════════════════════════════════

const express = require('express');
const publico = express.Router();
const { Op } = require('sequelize');
const crypto = require('crypto');
const {
  Catalogo, CatalogoProducto, CatalogoReglaPrecio, CatalogoVisita,
  Pedido, PedidoItem, Customer,
  Product, Brand, Stock, Suscripcion, sequelize,
} = require('../models');
const logger = require('../utils/logger');
const { fallo } = require('../utils/errores');
const { calcularPrecios } = require('@favalio/precios');
const { normalizarTelefono } = require('@favalio/pedido');
const { findScoped, scoped } = require('../utils/tenantScope');
const { resolverCatalogoPorSlug } = require('../utils/tenantDeSlug');
const { normalizarTexto } = require('../utils/textoDeBusqueda');
const { resolverPrecios } = require('../utils/reglasDePrecio');
const { evaluarSuscripcion } = require('../utils/estadoDeSuscripcion');
const { ajustesDeLaEmpresa } = require('../utils/ajustesDeLaEmpresa');
const { totalDePedido } = require('../utils/totalDePedido');
const { consolidarLineas, validarComprador } = require('../utils/pedidoPublico');
const { fechaDelNegocio } = require('../utils/fechas');
const vistaPublica = require('../utils/vistaPublica');

/** Cuántos productos trae una página. */
const POR_PAGINA = 24;

/** El largo máximo de una búsqueda. Más que esto no es una búsqueda. */
const LARGO_DE_BUSQUEDA = 80;

/**
 * Los orígenes conocidos del parámetro `?f=`.
 *
 * Cualquier otra cosa cae en `otro`: es texto que manda cualquiera, y guardarlo
 * tal cual convertiría la tabla de visitas en un lugar donde escribir.
 */
const ORIGENES = ['qr', 'directo', 'whatsapp', 'instagram', 'cartel'];

/** El cuerpo del 404. Uno solo, para todos los casos. */
const NO_ENCONTRADO = { ok: false, error: 'No encontramos esta tienda.' };

/** El cuerpo del producto que no está. Mismo texto para ajeno e inexistente. */
const PRODUCTO_NO_ENCONTRADO = { ok: false, error: 'No encontramos este producto.' };

// ════════════════════════════════════════════
//  El contexto público
// ════════════════════════════════════════════

async function contextoPublico(req, res, next) {
  try {
    const resuelto = await resolverCatalogoPorSlug(req.params.slug);

    // Un slug inexistente y un catálogo en borrador devuelven **lo mismo**: si
    // el borrador contestara distinto, probando slugs se podría averiguar qué
    // catálogos existen sin publicar.
    if (!resuelto || resuelto.estado === 'borrador') {
      return res.status(404).json(NO_ENCONTRADO);
    }

    // ── La suscripción, dentro del handler ──
    //
    // `checkSubscription` no corre acá: este router se monta fuera de la cadena
    // privada. Y las dos diferencias con esa cadena son deliberadas.
    let suscripcion;
    try {
      suscripcion = await Suscripcion.findOne({ where: { empresa_id: resuelto.empresaId } });
    } catch (err) {
      // ⚠ **Al revés que la cadena privada, que deja pasar.** Allá un hipo de la
      // base no puede tumbar la caja de un comercio que ya pagó; acá, del otro
      // lado hay cualquiera y lo prudente es cerrar.
      //
      // Y 503 y no 402: el 402 afirmaría que la suscripción venció, y lo que
      // pasó es que **no se pudo saber**.
      logger.error(
        { slug: req.params.slug, empresa: resuelto.empresaId, err: err.message },
        'catalogo publico: no se pudo consultar la suscripcion'
      );
      return res.status(503).json({
        ok: false,
        error: 'NO_DISPONIBLE_POR_UN_MOMENTO',
        mensaje: 'La tienda no está disponible en este momento. Probá de nuevo en un rato.',
      });
    }

    const { bloqueado } = evaluarSuscripcion(suscripcion, new Date());

    const catalogo = await Catalogo.findOne({
      where: { id: resuelto.catalogoId, empresa_id: resuelto.empresaId },
    });

    req.publico = {
      slug: req.params.slug,
      empresaId: resuelto.empresaId,
      catalogoId: resuelto.catalogoId,
      puntoDeVentaId: resuelto.puntoDeVentaId,
      catalogo,
      // `no_disponible` y no un 402: el 402 es un contrato entre la API y
      // `apps/web`, que lo intercepta y muestra el aviso de renovación. Acá el
      // que lee no es el moroso — es un socio del gimnasio, y contarle que el
      // comercio está en mora no es asunto suyo.
      estado: bloqueado ? 'no_disponible' : resuelto.estado,
    };

    next();
  } catch (err) {
    fallo(req, res, err, 'Error al abrir la tienda');
  }
}

// ════════════════════════════════════════════
//  El conteo de visitas
// ════════════════════════════════════════════

/**
 * Una fila por día, no una por visita.
 *
 * Sin el `ON CONFLICT`, el endpoint más leído del sistema —el que abre cada
 * persona que escanea el QR— sería también el que más escribe, en la misma base
 * donde el comercio factura.
 *
 * Nunca tira: que el contador falle no puede dejar a alguien sin ver la tienda.
 */
async function contarVisita(req) {
  try {
    const pedido = String(req.query.f || 'directo').toLowerCase();
    const origen = ORIGENES.includes(pedido) ? pedido : 'otro';
    const fecha = fechaDelNegocio();

    await sequelize.query(
      `INSERT INTO catalogo_visitas (catalogo_id, fecha, origen, estado_catalogo, cantidad, created_at, updated_at)
       VALUES ($catalogoId, $fecha, $origen, $estado, 1, NOW(), NOW())
       ON CONFLICT (catalogo_id, fecha, origen, estado_catalogo)
       DO UPDATE SET cantidad = catalogo_visitas.cantidad + 1, updated_at = NOW()`,
      {
        bind: {
          catalogoId: req.publico.catalogoId,
          fecha,
          origen,
          estado: req.publico.estado,
        },
      }
    );
  } catch (err) {
    logger.warn(
      { slug: req.publico?.slug, err: err.message },
      'catalogo publico: no se pudo contar la visita'
    );
  }
}

// ════════════════════════════════════════════
//  Precios y stock
// ════════════════════════════════════════════

/**
 * Los productos publicables del catálogo, con su precio final y si están
 * agotados.
 *
 * `agotado` sale de `available` y **sólo del punto de venta del catálogo**: si
 * mirara el stock de toda la empresa, la tienda ofrecería lo que hay en otra
 * sucursal y el pedido caería sobre una que no lo tiene.
 */
async function productosDelCatalogo(publicoDeLaPeticion, { filtro } = {}) {
  const { empresaId, catalogoId, puntoDeVentaId, catalogo } = publicoDeLaPeticion;

  const filas = await CatalogoProducto.findAll({
    attributes: ['product_id', 'orden'],
    where: { catalogo_id: catalogoId },
    order: [['orden', 'ASC'], ['product_id', 'ASC']],
    raw: true,
  });
  if (filas.length === 0) return [];

  const productos = await Product.findAll({
    attributes: [
      'id', 'name', 'description', 'category', 'unit_type',
      'image_url', 'brand_id', 'cost', 'price_override', 'margin_override',
    ],
    where: {
      id: filas.map((f) => f.product_id),
      // El `empresa_id` va en la consulta, no en una validación previa. Los ids
      // salen de `catalogo_productos`, que ya es del catálogo, pero una consulta
      // sin este filtro es una consulta que copiada a otro lado no aísla nada.
      empresa_id: empresaId,
      publicable: true,
      is_active: true,
    },
  });

  const marcas = await Brand.findAll({
    attributes: ['id', 'name'],
    where: { empresa_id: empresaId },
    raw: true,
  });
  const nombreDeMarca = new Map(marcas.map((m) => [m.id, m.name]));

  const stock = await Stock.findAll({
    attributes: ['product_id', 'available'],
    where: { empresa_id: empresaId, punto_de_venta_id: puntoDeVentaId },
    raw: true,
  });
  const disponible = new Map(stock.map((s) => [s.product_id, Number(s.available)]));

  const reglas = await CatalogoReglaPrecio.findAll({
    where: { catalogo_id: catalogoId, empresa_id: empresaId },
  });

  // El precio de lista sale del mismo cálculo que el punto de venta: una sola
  // copia de la fórmula, en `packages/precios`, y **los mismos ajustes** que usa
  // el mostrador.
  //
  // ⚠ Acá decía `catalogo.settings`, que no es una columna de `catalogos`: los
  // ajustes llegaban siempre en `{}`, `calcularPrecios` tomaba margen 0 y la
  // tienda pública mostraba **el costo de compra** como precio de venta.
  const settings = await ajustesDeLaEmpresa(empresaId);
  const conLista = productos.map((p) => ({
    fila: p,
    id: p.id,
    brand_id: p.brand_id,
    category: p.category,
    precioLista: calcularPrecios(p, settings).cashPrice,
  }));

  const { porProducto } = resolverPrecios(conLista, reglas);
  const orden = new Map(filas.map((f) => [f.product_id, f.orden]));

  const salida = conLista
    .map(({ fila, id, precioLista }) => {
      const resuelto = porProducto.get(id) || { precio: precioLista };
      const enStock = disponible.has(id) ? disponible.get(id) : 0;

      if (enStock < 0) {
        // Un `available` negativo es un dato inconsistente del inventario, no un
        // caso de negocio. Se trata como agotado y queda registrado.
        logger.warn(
          { producto: id, empresa: empresaId, punto_de_venta: puntoDeVentaId, available: enStock },
          'catalogo publico: available negativo'
        );
      }

      return {
        orden: orden.get(id) ?? 0,
        vista: vistaPublica.productoPublico(fila, {
          precio: resuelto.precio,
          precioLista,
          mostrarLista: catalogo && catalogo.mostrar_precio_lista === true,
          // Sin fila de stock es agotado, y no es un error: un producto que
          // nunca se cargó en esa sucursal no está disponible ahí.
          agotado: !(enStock > 0),
          marca: nombreDeMarca.get(fila.brand_id),
        }),
      };
    })
    .sort((a, b) => a.orden - b.orden)
    .map((x) => x.vista);

  if (!filtro) return salida;

  const texto = normalizarTexto(filtro.q || '');
  const categoria = normalizarTexto(filtro.categoria || '');

  return salida.filter((p) => {
    if (categoria && normalizarTexto(p.categoria || '') !== categoria) return false;
    if (!texto) return true;
    return normalizarTexto(`${p.nombre} ${p.marca || ''}`).includes(texto);
  });
}

/** Las categorías que existen hoy entre lo que sale, en el orden en que salen. */
function categoriasDe(productos) {
  const vistas = new Map();
  for (const p of productos) {
    if (!p.categoria) continue;
    const clave = normalizarTexto(p.categoria);
    if (!vistas.has(clave)) vistas.set(clave, { categoria: clave, etiqueta: p.categoria, productos: 0 });
    vistas.get(clave).productos += 1;
  }
  // `Array.from` y no un spread: volcar un iterador sería legítimo, pero la
  // guardia de proyección prohíbe los tres puntos en este archivo **sin
  // excepciones**, y está bien que así sea. Una guardia con excepciones es una
  // guardia que hay que leer antes de confiar en ella.
  return Array.from(vistas.values());
}

// ════════════════════════════════════════════
//  Los tres endpoints
// ════════════════════════════════════════════

// GET /api/publico/c/:slug
//
// Trae la marca, la entrega, los pagos, las categorías **y la primera página de
// productos embebida**. Es lo que mantiene una visita en dos llamadas en vez de
// cuatro: del otro lado hay un teléfono en la puerta de un gimnasio.
publico.get('/c/:slug', contextoPublico, async (req, res) => {
  try {
    await contarVisita(req);

    const { catalogo, estado } = req.publico;

    // Pausado y no disponible devuelven 200 con la cara del catálogo y **sin
    // productos ni precios**. Las claves no vienen vacías: NO ESTÁN.
    if (estado !== 'publicado') {
      return res.json({
        ok: true,
        data: {
          estado,
          catalogo: vistaPublica.catalogoPublico(catalogo),
        },
      });
    }

    const productos = await productosDelCatalogo(req.publico);

    res.json({
      ok: true,
      data: {
        estado,
        catalogo: vistaPublica.catalogoPublico(catalogo),
        categorias: categoriasDe(productos),
        productos: productos.slice(0, POR_PAGINA),
        total: productos.length,
        pagina: 1,
        hay_mas: productos.length > POR_PAGINA,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al abrir la tienda');
  }
});

// GET /api/publico/c/:slug/productos
publico.get('/c/:slug/productos', contextoPublico, async (req, res) => {
  try {
    if (req.publico.estado !== 'publicado') {
      return res.json({ ok: true, data: { estado: req.publico.estado, productos: [], total: 0, pagina: 1, hay_mas: false } });
    }

    // Acotado: más de 80 caracteres no es una búsqueda. Y va parametrizado —lo
    // hace `normalizarTexto` + `includes` en memoria, no un LIKE armado con
    // concatenación—.
    const q = String(req.query.q || '').slice(0, LARGO_DE_BUSQUEDA);
    const categoria = String(req.query.categoria || '').slice(0, 60);

    const pedida = Number.parseInt(req.query.pagina, 10);
    const pagina = Number.isInteger(pedida) && pedida > 0 && pedida <= 500 ? pedida : 1;

    const productos = await productosDelCatalogo(req.publico, { filtro: { q, categoria } });
    const desde = (pagina - 1) * POR_PAGINA;
    const pagina_actual = productos.slice(desde, desde + POR_PAGINA);

    // Una página vacía es 200 con lista vacía. Un 404 diría «esta tienda no
    // existe», que es otra cosa.
    res.json({
      ok: true,
      data: {
        estado: req.publico.estado,
        productos: pagina_actual,
        total: productos.length,
        pagina,
        hay_mas: desde + POR_PAGINA < productos.length,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al buscar en la tienda');
  }
});

// GET /api/publico/c/:slug/productos/:id
//
// Un `:id` de otra empresa, inexistente, negativo, enorme o no numérico
// devuelve **404 con el mismo cuerpo**. Es el caso que un `findByPk` haría
// pasar: encontraría el producto ajeno y lo devolvería.
publico.get('/c/:slug/productos/:id', contextoPublico, async (req, res) => {
  try {
    if (req.publico.estado !== 'publicado') {
      return res.status(404).json(PRODUCTO_NO_ENCONTRADO);
    }

    // ⚠ El parámetro tiene que ser **sólo dígitos**, y no alcanza con
    // `parseInt`. `Number.parseInt('1.5')` devuelve 1, y `parseInt('1;DROP')`
    // también: los dos terminaban devolviendo el producto 1 con un 200. No es
    // una inyección —la consulta va parametrizada— pero sí una URL basura que
    // contesta contenido real, que es exactamente lo que una superficie pública
    // no tiene que hacer.
    const crudo = String(req.params.id);
    if (!/^\d{1,15}$/.test(crudo)) {
      return res.status(404).json(PRODUCTO_NO_ENCONTRADO);
    }

    const id = Number.parseInt(crudo, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(404).json(PRODUCTO_NO_ENCONTRADO);
    }

    const productos = await productosDelCatalogo(req.publico);
    const producto = productos.find((p) => p.id === id);

    if (!producto) return res.status(404).json(PRODUCTO_NO_ENCONTRADO);

    res.json({ ok: true, data: { estado: req.publico.estado, producto } });
  } catch (err) {
    fallo(req, res, err, 'Error al abrir el producto');
  }
});

// ════════════════════════════════════════════
//  POST /api/publico/c/:slug/pedidos
//
//  **El único endpoint público que escribe.** Del otro lado hay alguien sin
//  sesión, sin empresa y sin nada que lo identifique, y lo que manda termina en
//  la misma base donde el comercio factura.
//
//  ── El orden de los doce pasos no es negociable ──
//
//  Todo lo que puede rechazar el pedido pasa **antes** de crear la primera fila.
//  Un producto de otra empresa en la línea siete no puede encontrar seis líneas
//  ya escritas: rechaza el pedido entero y no deja rastro (FR-132).
//
//  ── Dos apartamientos del molde de `routes/sales.js` ──
//
//  **1 · La lectura de stock va SIN `lock`.** `sales.js:518-526` lo toma porque
//  va a descontar; acá **no se descuenta nada** (FR-140), así que el lock sólo
//  haría esperar a dos compradores por una fila que ninguno va a modificar.
//
//  La consecuencia se dice en voz alta: **dos personas que piden la última
//  unidad al mismo tiempo se llevan las dos un pedido creado** (US14, escenario
//  8). Es a propósito. Es un pedido, no una venta: el comercio lo resuelve por
//  WhatsApp, que es lo que hoy hace igual. Reservar stock desde una página
//  pública es la puerta para que cualquiera con el enlace deje el inventario del
//  comercio en cero sin comprar nada.
//
//  **2 · El total NO se compara contra un declarado.** El cliente no manda
//  ninguno: `consolidarLineas` lo tira en el paso 2. Aceptar un `total` opcional
//  «para verificar» sería exactamente la puerta que este endpoint no puede
//  tener: la que deja fijar el precio desde afuera.
//
//  ── La idempotencia se sostiene en el UNIQUE, no en el findOne ──
//
//  El `findOne` del paso 4 es el camino normal; **la garantía es el índice**.
//  Dos requests en vuelo pasan los dos por el `findOne` y el que pierde choca
//  contra `uq_pedido_idempotencia`; ahí se relee y se devuelve el mismo cuerpo.
// ════════════════════════════════════════════

/** El id del advisory lock que serializa la numeración de pedidos por empresa. */
//
// El **947214**: el siguiente al `947213` que usa `apps/api/scripts/migrar.js:41`,
// para que el día que alguien se pregunte de dónde salieron los encuentre juntos.
//
// Es un lock **de transacción** (`_xact_`): se suelta solo en el commit o en el
// rollback. No hay forma de olvidarse de liberarlo, que es lo que pasa con
// `pg_advisory_lock` cuando el handler sale por una rama de error.
const LOCK_DE_NUMERACION = 947214;

const CATALOGO_NO_DISPONIBLE = {
  ok: false,
  error: 'CATALOGO_NO_DISPONIBLE',
  mensaje: 'Esta tienda no está recibiendo pedidos en este momento.',
};

/** El siguiente número de pedido de la empresa. Sólo se llama con el lock tomado. */
async function siguienteNumero(empresaId, transaction) {
  await sequelize.query('SELECT pg_advisory_xact_lock($lock, $empresaId)', {
    bind: { lock: LOCK_DE_NUMERACION, empresaId },
    transaction,
  });

  const [filas] = await sequelize.query(
    'SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM pedidos WHERE empresa_id = $empresaId',
    { bind: { empresaId }, transaction }
  );

  return Number(filas[0].siguiente);
}

publico.post('/c/:slug/pedidos', contextoPublico, async (req, res) => {
  // 1 · El contexto ya resolvió empresa, catálogo, sucursal, suscripción y
  // estado. Borrador ya salió por 404 en `contextoPublico`; pausado y empresa
  // vencida no reciben pedidos.
  if (req.publico.estado !== 'publicado') {
    return res.status(409).json(CATALOGO_NO_DISPONIBLE);
  }

  const { empresaId, catalogoId, puntoDeVentaId, catalogo } = req.publico;

  // 2 · Normalizar. De acá para abajo **no existe** ningún precio del cuerpo.
  const cuerpo = req.body || {};

  const consolidado = consolidarLineas(cuerpo.items);
  if (!consolidado.ok) return res.status(400).json(consolidado);

  const validado = validarComprador(cuerpo.comprador, catalogo);
  if (!validado.ok) return res.status(400).json(validado);

  // La clave la genera el navegador. Si no viene, se inventa una: sin clave no
  // hay idempotencia, pero tampoco hay motivo para rechazar el pedido de alguien
  // que ya llenó el formulario.
  const idempotencyKey = String(cuerpo.idempotency_key || '').trim().slice(0, 64)
    || crypto.randomUUID();

  // 3 · La transacción.
  const t = await sequelize.transaction();

  // Lo que hace falta para reintentar el alta si el número choca. Se llena justo
  // antes de crear; hasta entonces vale `null` y no hay reintento posible, que es
  // lo correcto: antes del alta, un error no es una carrera.
  let paraReintentar = null;

  try {
    // 4 · Idempotencia, camino rápido.
    const yaEstaba = await Pedido.findOne({
      where: scoped({ idempotency_key: idempotencyKey }, empresaId),
      transaction: t,
    });

    if (yaEstaba) {
      const lineasPrevias = await PedidoItem.findAll({
        where: { pedido_id: yaEstaba.id },
        order: [['id', 'ASC']],
        transaction: t,
      });
      await t.commit();
      return res.status(201).json({
        ok: true,
        yaRegistrado: true,
        data: vistaPublica.pedidoPublico(yaEstaba, lineasPrevias),
      });
    }

    // 5 · **Validar TODOS los productos antes de crear nada.**
    //
    // El bucle es explícito y vive acá, en el handler, con el `findScoped`
    // delante del `Pedido.create`. Es una restricción de arquitectura y no de
    // estilo: el detector de «padre ajeno» de `aislamientoEmpresas.test.js` da
    // por validado un `create` cuando encuentra un `findScoped` **antes, en el
    // mismo handler**, y mudar esto a un servicio parte el ámbito y lo deja sin
    // validar a ojos de la guardia. Molde: `suppliers.js:1015-1039`.
    // `catalogo_productos` **no tiene `empresa_id`**: es una tabla de unión, y su
    // empresa es la del catálogo. El aislamiento lo dan las dos puntas —el
    // catálogo salió del slug y cada producto pasa por `findScoped`— y no esta
    // consulta.
    const delCatalogo = await CatalogoProducto.findAll({
      attributes: ['product_id'],
      where: { catalogo_id: catalogoId },
      raw: true,
      transaction: t,
    });
    const estaEnElCatalogo = new Set(delCatalogo.map((f) => f.product_id));

    const productos = [];

    for (const linea of consolidado.lineas) {
      // Un producto de otra empresa **no resuelve**: `findScoped` filtra por
      // `empresa_id` y devuelve `null`. El 404 no dice si existía.
      const producto = await findScoped(Product, linea.product_id, empresaId, { transaction: t });

      const usable = producto
        && producto.is_active === true
        && producto.publicable === true
        && estaEnElCatalogo.has(producto.id);

      if (!usable) {
        await t.rollback();
        return res.status(404).json(PRODUCTO_NO_ENCONTRADO);
      }

      productos.push({ producto, cantidad: linea.cantidad });
    }

    // 6 · El precio lo pone el servidor. Los ajustes y las reglas se leen **una
    // vez**, no una por línea.
    const settings = await ajustesDeLaEmpresa(empresaId, { transaction: t });

    const reglas = await CatalogoReglaPrecio.findAll({
      where: { catalogo_id: catalogoId, empresa_id: empresaId },
      transaction: t,
    });

    const paraResolver = productos.map(({ producto }) => ({
      id: producto.id,
      brand_id: producto.brand_id,
      category: producto.category,
      precioLista: calcularPrecios(producto, settings).cashPrice,
    }));

    const { porProducto } = resolverPrecios(paraResolver, reglas);
    const listaPorId = new Map(paraResolver.map((p) => [p.id, p.precioLista]));

    // 7 · Revalidar stock. **Sin `lock`** — ver el encabezado de esta sección.
    const stock = await Stock.findAll({
      attributes: ['product_id', 'available'],
      where: {
        empresa_id: empresaId,
        punto_de_venta_id: puntoDeVentaId,
        product_id: productos.map((p) => p.producto.id),
      },
      raw: true,
      transaction: t,
    });
    const disponible = new Map(stock.map((s) => [s.product_id, Number(s.available)]));

    const lineasFinales = [];
    const ajustadas = [];

    for (const { producto, cantidad } of productos) {
      const crudo = disponible.has(producto.id) ? disponible.get(producto.id) : 0;

      if (crudo < 0) {
        // Un `available` negativo es un dato inconsistente del inventario, no un
        // caso de negocio. Se trata como agotado y queda registrado.
        logger.warn(
          { producto: producto.id, empresa: empresaId, punto_de_venta: puntoDeVentaId, available: crudo },
          'pedido publico: available negativo'
        );
      }

      // Sin fila de stock es agotado y **no es un error**: un producto que nunca
      // se cargó en esa sucursal no está disponible ahí.
      const hay = crudo > 0 ? crudo : 0;

      if (hay <= 0) {
        ajustadas.push({ product_id: producto.id, nombre: producto.name, pedida: cantidad, disponible: 0, accion: 'quitada' });
        continue;
      }

      const final = Math.min(cantidad, hay);
      if (final < cantidad) {
        ajustadas.push({ product_id: producto.id, nombre: producto.name, pedida: cantidad, disponible: hay, accion: 'recortada' });
      }

      const precioLista = listaPorId.get(producto.id);
      const resuelto = porProducto.get(producto.id) || { precio: precioLista, gana: null };
      const precioUnitario = Number(resuelto.precio);

      // Los cuatro congelados (FR-131): el nombre, para que un pedido cuyo
      // producto se borró se siga leyendo; el precio de lista y la regla, para
      // poder contestar «¿por qué salió a este precio?» seis meses después.
      lineasFinales.push({
        product_id: producto.id,
        nombre: producto.name,
        precio_unitario: precioUnitario,
        precio_lista: precioLista,
        regla_id: resuelto.gana ? resuelto.gana.id : null,
        cantidad: final,
        subtotal: Math.round(precioUnitario * final * 100) / 100,
      });
    }

    // 8 · Cero líneas es **ningún pedido** (FR-139).
    if (lineasFinales.length === 0) {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        error: 'SIN_LINEAS_DISPONIBLES',
        mensaje: 'Los productos del pedido se agotaron. Volvé a mirar la tienda.',
        lineas: ajustadas,
      });
    }

    // Si algo se recortó, el comprador tiene que confirmarlo. `reintentar_con`
    // es **el cuerpo exacto** que la tienda vuelve a mandar: sin él tendría que
    // reconstruirlo restando por su cuenta —el cliente recalculando— y se
    // equivocaría justo en el caso que importa.
    if (ajustadas.length > 0) {
      await t.rollback();
      return res.status(409).json({
        ok: false,
        error: 'STOCK_INSUFICIENTE',
        mensaje: 'Cambió el stock de algunos productos mientras armabas el pedido.',
        lineas: ajustadas,
        reintentar_con: {
          idempotency_key: crypto.randomUUID(),
          items: lineasFinales.map((l) => ({ product_id: l.product_id, cantidad: l.cantidad })),
          comprador: cuerpo.comprador,
        },
      });
    }

    // 9 · El total.
    const totales = totalDePedido(lineasFinales, catalogo, validado.comprador.entrega);

    // 10 · El cliente, **scopeado a la empresa del resolvedor** y nunca a una
    // que venga en el cuerpo (FR-150).
    const telefonoNormalizado = normalizarTelefono(validado.comprador.comprador_telefono);
    let customerId = null;

    if (telefonoNormalizado) {
      const existente = await Customer.findOne({
        where: scoped({ phone: telefonoNormalizado }, empresaId),
        transaction: t,
      });

      if (existente) {
        customerId = existente.id;
      } else {
        const nuevo = await Customer.create({
          empresa_id: empresaId,
          name: validado.comprador.comprador_nombre,
          phone: telefonoNormalizado,
          email: validado.comprador.comprador_email,
        }, { transaction: t });
        customerId = nuevo.id;
      }
    }

    // 11 · El número y el pedido, en esta transacción.
    const numero = await siguienteNumero(empresaId, t);

    paraReintentar = { comprador: validado.comprador, telefonoNormalizado, customerId, totales, lineasFinales };

    const pedido = await Pedido.create({
      id: crypto.randomUUID(),
      empresa_id: empresaId,
      catalogo_id: catalogoId,
      punto_de_venta_id: puntoDeVentaId,
      origen: 'catalogo',
      numero,
      estado: 'pendiente_pago',
      comprador_nombre: validado.comprador.comprador_nombre,
      comprador_telefono: telefonoNormalizado || validado.comprador.comprador_telefono,
      comprador_email: validado.comprador.comprador_email,
      comprador_nro_socio: validado.comprador.comprador_nro_socio,
      customer_id: customerId,
      entrega: validado.comprador.entrega,
      envio_direccion: validado.comprador.envio_direccion,
      envio_localidad: validado.comprador.envio_localidad,
      envio_cp: validado.comprador.envio_cp,
      subtotal: totales.subtotal,
      envio_costo: totales.envio_costo,
      total: totales.total,
      medio_pago: validado.comprador.medio_pago,
      notas: validado.comprador.notas,
      idempotency_key: idempotencyKey,
    }, { transaction: t });

    const guardadas = await PedidoItem.bulkCreate(
      lineasFinales.map((l) => ({
        pedido_id: pedido.id,
        product_id: l.product_id,
        nombre: l.nombre,
        precio_unitario: l.precio_unitario,
        precio_lista: l.precio_lista,
        regla_id: l.regla_id,
        cantidad: l.cantidad,
        subtotal: l.subtotal,
      })),
      { transaction: t }
    );

    // 12 · Commit, y los avisos **después**, fuera de la transacción: un correo
    // que tarda no puede tener abierta una transacción sobre `pedidos`.
    await t.commit();

    logger.info(
      { empresa: empresaId, catalogo: catalogoId, numero, lineas: guardadas.length, total: totales.total },
      'pedido publico: pedido creado'
    );

    res.status(201).json({ ok: true, data: vistaPublica.pedidoPublico(pedido, guardadas) });
  } catch (err) {
    await t.rollback();

    // La otra mitad de la idempotencia, y la que de verdad sostiene la garantía.
    // Cuando el que perdió la carrera llega acá, el que ganó ya commiteó
    // —Postgres lo hizo esperar en el índice—, así que la fila está.
    //
    // Se relee en vez de confiar en el nombre de la restricción: si el choque
    // fue por otra cosa, no se encuentra nada y sale por `fallo()`.
    if (err.name === 'SequelizeUniqueConstraintError') {
      const registrado = await Pedido.findOne({
        where: scoped({ idempotency_key: idempotencyKey }, empresaId),
      });

      if (registrado) {
        const lineasPrevias = await PedidoItem.findAll({
          where: { pedido_id: registrado.id },
          order: [['id', 'ASC']],
        });

        logger.info(
          { empresa: empresaId, numero: registrado.numero },
          'pedido publico: dos requests con la misma clave, se devuelve el pedido ya registrado'
        );

        return res.status(201).json({
          ok: true,
          yaRegistrado: true,
          data: vistaPublica.pedidoPublico(registrado, lineasPrevias),
        });
      }

      // El otro choque posible es el del número, y `uq_pedido_numero` es **la
      // red**: con el advisory lock puesto no debería activarse nunca. Si se
      // activa igual —dos procesos, un lock que no se tomó, lo que sea— se
      // reintenta **una sola vez** con un número nuevo. Reintentar en un bucle
      // convertiría una carrera en un martilleo contra la base.
      const choqueDeNumero = String(err.parent && err.parent.constraint) === 'uq_pedido_numero';

      if (choqueDeNumero && paraReintentar) {
        logger.warn({ empresa: empresaId }, 'pedido publico: choque de numero, se reintenta una vez');

        const t2 = await sequelize.transaction();
        try {
          const numero = await siguienteNumero(empresaId, t2);

          const pedido = await Pedido.create({
            id: crypto.randomUUID(),
            empresa_id: empresaId,
            catalogo_id: catalogoId,
            punto_de_venta_id: puntoDeVentaId,
            origen: 'catalogo',
            numero,
            estado: 'pendiente_pago',
            comprador_nombre: paraReintentar.comprador.comprador_nombre,
            comprador_telefono: paraReintentar.telefonoNormalizado || paraReintentar.comprador.comprador_telefono,
            comprador_email: paraReintentar.comprador.comprador_email,
            comprador_nro_socio: paraReintentar.comprador.comprador_nro_socio,
            customer_id: paraReintentar.customerId,
            entrega: paraReintentar.comprador.entrega,
            envio_direccion: paraReintentar.comprador.envio_direccion,
            envio_localidad: paraReintentar.comprador.envio_localidad,
            envio_cp: paraReintentar.comprador.envio_cp,
            subtotal: paraReintentar.totales.subtotal,
            envio_costo: paraReintentar.totales.envio_costo,
            total: paraReintentar.totales.total,
            medio_pago: paraReintentar.comprador.medio_pago,
            notas: paraReintentar.comprador.notas,
            idempotency_key: idempotencyKey,
          }, { transaction: t2 });

          const guardadas = await PedidoItem.bulkCreate(
            paraReintentar.lineasFinales.map((l) => ({
              pedido_id: pedido.id,
              product_id: l.product_id,
              nombre: l.nombre,
              precio_unitario: l.precio_unitario,
              precio_lista: l.precio_lista,
              regla_id: l.regla_id,
              cantidad: l.cantidad,
              subtotal: l.subtotal,
            })),
            { transaction: t2 }
          );

          await t2.commit();
          return res.status(201).json({ ok: true, data: vistaPublica.pedidoPublico(pedido, guardadas) });
        } catch (err2) {
          // Si vuelve a chocar, sale por `fallo()`: dos choques seguidos con el
          // lock tomado no son una carrera, son un problema que hay que mirar.
          await t2.rollback();
          return fallo(req, res, err2, 'Error al registrar el pedido');
        }
      }
    }

    fallo(req, res, err, 'Error al registrar el pedido');
  }
});

// ════════════════════════════════════════════
//  Las páginas · `/c/:slug`
//
//  ── Por qué la API sirve una página HTML ──
//
//  Porque los metadatos que WhatsApp lee al compartir un enlace —`og:title`,
//  `og:image`— **no se pueden poner desde React**: el lector de
//  previsualizaciones no ejecuta JavaScript. `apps/tienda` es una app de Vite,
//  o sea un `index.html` estático con un `<div id="raiz">`.
//
//  Así que la API le pide ese `index.html` al servicio `tienda`, le reemplaza un
//  marcador por las etiquetas del catálogo, y lo devuelve.
//
//  ── Por qué se lo PIDE al servicio y no lo lee del disco ──
//
//  `apps/api` y `apps/tienda` son **dos imágenes de Docker distintas**. El
//  `index.html` de la tienda referencia su bundle con un hash que **cambia en
//  cada build** (`<script src="/assets/index-a1b2c3.js">`), y ese archivo vive
//  adentro de la imagen de la tienda.
//
//  Las tres alternativas, y por qué no:
//
//   · **Una copia del `index.html` en la API.** Dos archivos que hay que
//     mantener sincronizados, y el que se desincroniza apunta a un bundle que
//     ya no existe: **página en blanco, sin ningún error**.
//   · **Un volumen compartido.** Acopla el ciclo de vida de las dos imágenes, y
//     durante la ventana del deploy la API lee el build anterior.
//   · **Que Caddy inyecte las etiquetas.** Pondría la forma de la URL pública y
//     el contenido de los metadatos adentro de un archivo cuya única función es
//     enrutar.
//
//  ── Por qué NO cuelga de `/api` ──
//
//  Es una página, no una API. Colgada de `/api` la vería el limitador global
//  —que exime `/publico/`, no `/c/`— y quedaría del lado de una cadena pensada
//  para JSON. Se monta en `/c` con su propio limitador.
// ════════════════════════════════════════════

const paginas = express.Router();

/** El marcador. Un marcador, y no una expresión regular sobre `<head>`. */
const MARCADOR = '<!--FAVALIO_META-->';

/** De dónde sale el HTML. El nombre es el del servicio en el compose. */
const ORIGEN_DE_LA_TIENDA = process.env.URL_DE_LA_TIENDA || 'http://tienda';

/** Cuánto vive el HTML en memoria. */
const TTL_DEL_HTML = 60 * 1000;

let cacheDelHtml = { html: null, vence: 0 };

/**
 * El `index.html` de la tienda, cacheado un minuto.
 *
 * Una visita normal cuesta **cero** peticiones extra, y un deploy de la tienda
 * tarda a lo sumo un minuto en verse. Sin caché, cada persona que escanea el QR
 * dispara una petición interna más.
 */
async function htmlDeLaTienda() {
  const ahora = Date.now();
  if (cacheDelHtml.html && cacheDelHtml.vence > ahora) return cacheDelHtml.html;

  // Con `timeout`: una llamada saliente sin él puede colgar el handler para
  // siempre, y es lo que exige la guardia de llamadas salientes.
  const respuesta = await fetch(`${ORIGEN_DE_LA_TIENDA}/index.html`, {
    signal: AbortSignal.timeout(3000),
  });

  if (!respuesta.ok) throw new Error(`la tienda respondió ${respuesta.status}`);

  const html = await respuesta.text();
  cacheDelHtml = { html, vence: ahora + TTL_DEL_HTML };
  return html;
}

const escapar = (texto) => String(texto || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Las cinco etiquetas. */
function etiquetas({ titulo, descripcion, imagen, url }) {
  const lineas = [
    `<meta property="og:title" content="${escapar(titulo)}">`,
    `<meta property="og:description" content="${escapar(descripcion)}">`,
    `<meta property="og:url" content="${escapar(url)}">`,
    // ⚠ `noindex` en la página, además del `X-Robots-Tag` de la respuesta: el
    // precio que una empresa negoció con un socio no tiene por qué terminar en
    // un buscador.
    '<meta name="robots" content="noindex, nofollow">',
  ];

  if (imagen) lineas.push(`<meta property="og:image" content="${escapar(imagen)}">`);

  return lineas.join('\n    ');
}

// GET /c/:slug — y cualquier cosa debajo, porque cada URL de la tienda lleva el
// slug adentro y cada una recibe los metadatos de SU catálogo.
paginas.get('/:slug{/*resto}', async (req, res) => {
  let html;
  try {
    html = await htmlDeLaTienda();
  } catch (err) {
    // No se inventa un HTML sin el `<script>` del bundle: eso sería una página
    // en blanco sin ninguna explicación, que es peor que un error.
    logger.error(
      { slug: req.params.slug, origen: ORIGEN_DE_LA_TIENDA, err: err.message },
      'paginas: el servicio de la tienda no respondió'
    );
    return res.status(503).type('html').send(
      '<!doctype html><html lang="es"><meta charset="utf-8">'
      + '<title>Volvemos en un rato</title>'
      + '<p style="font:16px system-ui;margin:3rem;text-align:center">'
      + 'La tienda no está disponible en este momento. Probá de nuevo en un rato.</p>'
    );
  }

  const base = `${req.protocol}://${req.get('host')}`;
  const url = `${base}/c/${req.params.slug}`;

  // Genéricos por defecto: es lo que sale para un slug que no existe, para un
  // borrador y para una tienda pausada. Los tres tienen que verse **iguales al
  // compartirse**.
  let meta = {
    titulo: 'Tienda online',
    descripcion: 'Pedidos online.',
    imagen: null,
    url,
  };
  let estado = 404;

  try {
    const resuelto = await resolverCatalogoPorSlug(req.params.slug);

    if (resuelto && resuelto.estado !== 'borrador') {
      const catalogo = await Catalogo.findOne({
        attributes: ['nombre_visible', 'descripcion', 'portada_url', 'estado'],
        where: { id: resuelto.catalogoId, empresa_id: resuelto.empresaId },
      });

      // Pausado devuelve 200 —el socio tiene que reconocer que llegó al lugar
      // correcto— pero con genéricos: el enlace compartido no muestra la
      // portada de una tienda que no está vendiendo.
      estado = 200;

      if (catalogo && catalogo.estado === 'publicado') {
        meta = {
          titulo: catalogo.nombre_visible,
          descripcion: catalogo.descripcion || 'Pedí online y coordinamos la entrega.',
          imagen: catalogo.portada_url ? `${base}${catalogo.portada_url}` : null,
          url,
        };
      }
    }
  } catch (err) {
    // Que la base no conteste no puede dejar sin página a nadie: sale la
    // genérica, y queda registrado.
    logger.error({ slug: req.params.slug, err: err.message }, 'paginas: no se pudo resolver el catálogo');
    estado = 200;
  }

  let salida;
  if (html.includes(MARCADOR)) {
    salida = html.replace(MARCADOR, etiquetas(meta));
  } else {
    // Sin el marcador, la página sale igual y sin metadatos. Romper acá sería
    // dejar la tienda entera afuera por un problema de previsualización.
    logger.warn(
      { slug: req.params.slug },
      'paginas: el index.html de la tienda no tiene el marcador FAVALIO_META'
    );
    salida = html;
  }

  // Cubre lo que no es HTML y lo que un lector ignore de la etiqueta.
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.status(estado).type('html').send(salida);
});

module.exports = { publico, paginas };
