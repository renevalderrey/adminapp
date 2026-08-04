const express = require('express');
const router = express.Router();
const { Sale, SaleItem, Product, Stock, StockMovement, Empresa, Customer, PuntoDeVenta, Setting } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const checkPermission = require('../middleware/checkPermission');
const { findScoped, scoped } = require('../utils/tenantScope');
const { verificarTotal, normalizarItem, metodoDePago, esPagoMixto, normalizarNombreDeCliente } = require('../utils/calculosVenta');
const logger = require('../utils/logger');
const { fechaDelNegocio, horaDelNegocio } = require('../utils/fechas');
const afipService = require('../services/afipService');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const { estadoVenta } = require('../utils/estadoVenta');
const { filtroVentas } = require('../utils/filtroVentas');
const { filaDeExport, totalDelPeriodo } = require('../utils/exportVentas');
const { condicionIvaDeAfip } = require('../utils/condicionIvaAfip');
const { resolverSucursal, sucursalPorDefecto } = require('../utils/sucursalDeStock');

/**
 * La sucursal a la que vuelve la mercadería de una venta anulada.
 *
 * Los tres escalones están explicados donde se usa. Va como función aparte
 * porque el del medio —el `location` viejo, que puede ser cualquier texto— es
 * el único que necesita tragarse su error: si `sale.location` dice «mostrador»
 * y esa sucursal no existe, la anulación tiene que seguir, no fallar.
 */
async function sucursalDeAnulacion(sale, transaction) {
  if (sale.punto_de_venta_id) {
    const suya = await PuntoDeVenta.findOne({
      where: { id: sale.punto_de_venta_id, empresa_id: sale.empresa_id },
      transaction,
    });

    if (suya) return suya;
  }

  if (sale.location) {
    const porCodigo = await PuntoDeVenta.findOne({
      where: { empresa_id: sale.empresa_id, code: sale.location },
      transaction,
    });

    if (porCodigo) return porCodigo;
  }

  return sucursalPorDefecto(sale.empresa_id, { transaction });
}

/**
 * El «hoy» del negocio, para completar el rango cuando no viene.
 *
 * Se calcula en el servidor con la zona horaria de la empresa. Hacerlo en el
 * navegador con toISOString() devuelve UTC: en Argentina (UTC-3), despues de
 * las 21:00 «hoy» pasa a ser mañana y una venta recien cobrada no aparece en
 * su propio listado.
 */
async function hoyDelNegocio(empresaId) {
  const empresa = await Empresa.findByPk(empresaId, { attributes: ['timezone'] });
  return fechaDelNegocio(empresa && empresa.timezone);
}

/**
 * Responde los errores de rango con su codigo, para que la pantalla distinga
 * «invertido» de «demasiado largo» sin parsear el texto del mensaje.
 *
 * Se separa de fallo() porque fallo() no lleva codigo: manda solo el mensaje.
 * @returns {boolean} true si el error era de filtro y ya se respondio.
 */
function respondioErrorDeFiltro(res, err) {
  if (!err || !err.codigo) return false;

  res.status(err.status || 400).json({
    ok: false,
    error: err.codigo,
    message: err.message,
  });
  return true;
}

/**
 * La ficha del cliente se trae con LEFT JOIN para poder mostrar su nombre y
 * para que la busqueda libre lo alcance. `required: false` no es opcional: con
 * required true, una venta a consumidor final desapareceria del listado.
 */
function incluirCliente(attributes) {
  return [{ model: Customer, as: 'customer', required: false, attributes }];
}

/**
 * Las sucursales que aparecen en el resultado filtrado.
 *
 * El frontend solo conoce las sucursales ACTIVAS (la API las filtra por
 * is_active en los cuatro lugares donde las arma). Sin esta lista, una venta
 * de una sucursal dada de baja llega con un punto_de_venta_id que la pantalla
 * no puede nombrar: el filtro mostraria un id crudo o directamente perderia la
 * opcion, y las ventas de un local cerrado quedarian inalcanzables.
 */
async function sucursalesDelResultado(where, empresaId) {
  const presentes = await Sale.findAll({
    where,
    include: incluirCliente([]),
    attributes: ['punto_de_venta_id'],
    group: ['Sale.punto_de_venta_id'],
    raw: true,
  });

  const ids = presentes
    .map((fila) => fila.punto_de_venta_id)
    .filter((id) => Number.isInteger(id));

  if (!ids.length) return [];

  return PuntoDeVenta.findAll({
    where: scoped({ id: { [Op.in]: ids } }, empresaId),
    attributes: ['id', 'name', 'is_active'],
    order: [['name', 'ASC']],
    raw: true,
  });
}

// GET /api/sales — Historial de ventas: rango, sucursal, tipo, busqueda y paginado
router.get('/', checkPermission('ventas.ver'), async (req, res) => {
  try {
    const filtro = filtroVentas(req.query, {
      hoy: await hoyDelNegocio(req.empresaId),
      puntoDeVentaId: req.puntoDeVentaId,
    });

    // empresa_id lo agrega la ruta y no filtroVentas: que la funcion pura no
    // pueda ponerlo es lo que hace imposible que se olvide.
    const where = scoped(filtro.where, req.empresaId);

    // El listado NO trae los items. Ninguna de las siete columnas los muestra,
    // y ese include es un hasMany: con limit obliga a Sequelize a armar una
    // subconsulta y a contar con COUNT(DISTINCT). Se pagaba una junta y N
    // filas por pagina para no mostrar nada. Los items salen de GET /:id.
    const { count, rows } = await Sale.findAndCountAll({
      where,
      include: incluirCliente(['id', 'name']),
      order: filtro.order,
      limit: filtro.limit,
      offset: filtro.offset,
    });

    // La suma va con el MISMO `where` que el listado. Sin el, el encabezado
    // muestra el total de todas las ventas de la empresa mientras la tabla
    // muestra las del filtro: dos numeros que se leen juntos y no hablan de lo
    // mismo (FR-079).
    //
    // Incluye las anuladas a proposito: el archivo exportado las lleva, y la
    // suma de su columna Total tiene que coincidir con este numero. La
    // etiqueta de la pantalla lo aclara.
    const suma = await Sale.sum('total', { where, include: incluirCliente([]) });

    const data = rows.map((venta) => {
      const fila = venta.toJSON();
      const estado = estadoVenta(fila);

      // El texto del rechazo no viaja en el listado: es largo, solo lo usa el
      // panel de detalle, y en la fila ya esta representado por
      // estado.codigo === 'rechazada'.
      delete fila.afip_ultimo_error;

      return { ...fila, estado };
    });

    res.json({
      ok: true,
      data,
      total: count,
      total_periodo: totalDelPeriodo(suma),
      page: filtro.page,
      totalPages: Math.max(1, Math.ceil(count / filtro.limit)),
      // El rango efectivamente aplicado: la pantalla inicializa sus campos de
      // fecha con esto en la primera carga.
      rango: filtro.rango,
      sucursales: await sucursalesDelResultado(where, req.empresaId),
    });
  } catch (err) {
    if (respondioErrorDeFiltro(res, err)) return;
    fallo(req, res, err, 'Error al listar las ventas');
  }
});

// GET /api/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD — Resumen por período
router.get('/summary', checkPermission('ventas.ver'), async (req, res) => {
  try {
    const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];

    const summary = await Sale.findAll({
      attributes: [
        'date',
        'payment_method',
        [sequelize.fn('COUNT', sequelize.col('Sale.id')), 'count'],
        [sequelize.fn('SUM', sequelize.col('total')), 'total'],
      ],
      where: {
        empresa_id: req.empresaId,
        date: { [Op.between]: [from, to] },
        status: 'active',
      },
      group: ['date', 'payment_method'],
      order: [['date', 'DESC']],
      raw: true,
    });

    res.json({ ok: true, data: summary });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular el resumen de ventas');
  }
});

// ════════════════════════════════════════════
//  El export
// ════════════════════════════════════════════

/** Mas de esto no se baja en un solo archivo. */
const LIMITE_EXPORT = 5000;

// Lo que decide QUE dice cada celda del archivo vive en utils/exportVentas.js.
// Estaba aca adentro, y adentro de un handler no lo alcanza ningun test: la
// verificacion pudo revertir la etiqueta de estado, el CAE a numero y el total
// a texto sin que fallara una sola prueba.

// ⚠ ORDEN DE DECLARACIÓN ⚠
//
// Toda ruta literal —/summary, /export— tiene que declararse ANTES que
// GET /:id. Express resuelve por orden: con /:id arriba, ":id" se come la
// palabra "export" y el endpoint del export devuelve «Venta no encontrada».

// GET /api/sales/export — Todo el resultado del filtro, sin paginar
router.get('/export', checkPermission('ventas.ver'), async (req, res) => {
  try {
    const filtro = filtroVentas(req.query, {
      hoy: await hoyDelNegocio(req.empresaId),
      puntoDeVentaId: req.puntoDeVentaId,
    });

    const where = scoped(filtro.where, req.empresaId);

    // El COUNT va primero para no cargar 5.001 filas en memoria y despues
    // descartarlas. La pantalla ademas avisa antes de llamar, comparando
    // contra el total que ya trajo el listado: este tope es la red de abajo.
    const total = await Sale.count({
      where,
      include: incluirCliente([]),
      distinct: true,
      col: 'id',
    });

    if (total > LIMITE_EXPORT) {
      return res.status(400).json({
        ok: false,
        error: 'LIMITE_EXPORT_SUPERADO',
        message: `El filtro devuelve ${total} comprobantes y el máximo por archivo es ${LIMITE_EXPORT}. Acotá el rango de fechas o la sucursal.`,
        total,
        limite: LIMITE_EXPORT,
      });
    }

    const ventas = await Sale.findAll({
      where,
      // Solo lo que arman las diez columnas. Traer la fila entera de 5.000
      // ventas para escribir diez campos es trabajo y memoria de mas.
      attributes: [
        'id', 'date', 'time', 'total', 'payment_method',
        'customer_id', 'customer_name',
        'afip_type', 'afip_pv', 'afip_nro', 'afip_cae',
        // No es una columna del archivo: hace falta para derivar el estado.
        'status', 'afip_ultimo_error',
      ],
      include: [
        { model: Customer, as: 'customer', required: false, attributes: ['id', 'name'] },
        { model: PuntoDeVenta, as: 'puntoDeVenta', required: false, attributes: ['id', 'name'] },
      ],
      // El mismo orden que el listado: el archivo tiene que poder compararse
      // fila por fila contra la pantalla.
      order: filtro.order,
    });

    res.json({
      ok: true,
      total,
      data: ventas.map((venta) => filaDeExport(venta.toJSON())),
    });
  } catch (err) {
    if (respondioErrorDeFiltro(res, err)) return;
    fallo(req, res, err, 'Error al preparar la exportación de ventas');
  }
});

// GET /api/sales/:id — Detalle de un comprobante, para el panel lateral
router.get('/:id', checkPermission('ventas.ver'), async (req, res) => {
  try {
    const sale = await findScoped(Sale, req.params.id, req.empresaId, {
      include: [
        { model: SaleItem, as: 'items' },
        { model: Customer, as: 'customer', required: false },
        { model: PuntoDeVenta, as: 'puntoDeVenta', required: false },
      ],
    });

    // 404 y no 403, tambien cuando la venta existe pero es de otra empresa: un
    // 403 confirmaria que el id existe en otro cliente y permitiria enumerar
    // ids ajenos. No se distinguen los dos casos.
    if (!sale) return res.status(404).json({ ok: false, error: 'Venta no encontrada' });

    const data = sale.toJSON();

    // Acá SÍ viaja afip_ultimo_error: es lo que el panel muestra cuando la
    // venta está Rechazada, junto con la fecha del intento. En el listado no,
    // porque es texto largo y la fila ya lo representa con el badge.
    res.json({ ok: true, data: { ...data, estado: estadoVenta(data) } });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener la venta');
  }
});

// POST /api/sales — Registrar venta (con descuento de stock)
router.post('/', checkPermission('ventas.crear'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id, date, time, total, payment_method, notes, location, seller, items, afip_cae, afip_nro, afip_vto, afip_type, customer_id, customer_name, is_credit } = req.body;

    const lineas = Array.isArray(items) ? items : [];

    // Una cantidad negativa pasaba el control de stock (available < -5 es
    // falso) y despues hacia quantity - (-5), es decir SUMABA inventario.
    // Registrar una venta con cantidad -5 creaba mercaderia de la nada.
    const invalida = lineas
      .map((item, i) => ({ i, ...normalizarItem(item) }))
      .find((l) => l.quantity <= 0 || l.unit_price < 0);

    if (invalida) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        error: 'ITEM_INVALIDO',
        message: `El item "${invalida.product_name}" tiene cantidad o precio inválidos (cantidad ${invalida.quantity}, precio ${invalida.unit_price}).`,
      });
    }

    // El total se recalcula a partir de las lineas y NO se toma del body. Es
    // el registro contable de la operacion: si el cliente lo manda y el
    // servidor lo guarda sin mirar, cualquier bug del frontend —o cualquier
    // request armado a mano— queda asentado como si fuera real.
    //
    // Si el declarado no cierra contra las lineas se rechaza en vez de
    // corregirlo en silencio: en un punto de venta, guardar un total distinto
    // al que vio el operador y le cobro al cliente es peor que fallar.
    const advertencias = [];

    // Las filas de stock que esta venta efectivamente descontó, para que el POS
    // actualice el catálogo sin volver a pedirlo entero (FR-047).
    //
    // Es complementario de `advertencias` y ninguno de los dos hay que
    // parsearlo: el producto que NO tenía fila de stock aparece en las
    // advertencias y **no** acá. Sin este arreglo, el navegador tendría que
    // restar `available - qty` por su cuenta —el cliente recalculando
    // inventario— y se equivocaría justo en ese caso, que es el único que
    // importa: ahí no se descontó nada.
    const filasDeStock = [];

    const verificacion = verificarTotal(total, lineas);

    if (!verificacion.ok) {
      await t.rollback();
      logger.warn(
        { empresaId: req.empresaId, declarado: verificacion.declarado, calculado: verificacion.total },
        'sales: el total declarado no coincide con las lineas'
      );
      return res.status(400).json({
        ok: false,
        error: 'TOTAL_INCONSISTENTE',
        message: `El total enviado ($${verificacion.declarado}) no coincide con la suma de los items ($${verificacion.total}).`,
      });
    }

    // La fecha y la hora las decide el SERVIDOR, en la zona horaria del
    // negocio. Antes venian del navegador con toISOString(), que devuelve UTC:
    // en Argentina (UTC-3), una venta de las 21:30 quedaba asentada al dia
    // siguiente. Eso corre el cierre de caja, el listado del dia y los reportes.
    //
    // Que las decida el servidor ademas evita que el reloj de una caja
    // desconfigurada meta ventas con fecha equivocada.
    const empresa = await Empresa.findByPk(req.empresaId, {
      attributes: ['timezone'],
      transaction: t,
    });
    const zona = empresa && empresa.timezone;

    // ── Idempotencia por id ──
    //
    // El `id` lo genera el navegador y es la clave primaria: ya es una clave de
    // idempotencia, no hace falta una cabecera aparte. Antes, un reintento del
    // mismo ticket —la red se cortó despues de guardar la venta pero antes de
    // que llegara la respuesta— chocaba contra la restriccion unica y salia por
    // fallo() como un 500 «Error al registrar la venta»: el operador leia que no
    // se habia registrado nada y volvia a cobrar.
    //
    // Es el mismo molde que POST /:id/facturar usa para el CAE: un reintento
    // sobre una venta ya facturada devuelve el CAE que tiene en vez de pedir
    // otro y duplicar el comprobante.
    //
    // `warnings: []` y `stock: []` van vacios A PROPOSITO: la venta ya existe y
    // su stock ya se descontó cuando se creó. Devolver los avisos de aquella vez
    // los mostraria dos veces y el navegador escribiria de nuevo un stock viejo.
    //
    // El findScoped lleva req.empresaId, asi que un id que existe en OTRA
    // empresa no se encuentra y la venta se crea normalmente. Es lo correcto:
    // los ids son de la empresa, no globales.
    //
    // Va ANTES de resolver la sucursal a proposito: un reintento de una venta ya
    // registrada tiene que responder lo mismo aunque la empresa se haya quedado
    // sin sucursales entre medio.
    const yaExistente = await findScoped(Sale, id, req.empresaId, { transaction: t });

    if (yaExistente) {
      await t.rollback();
      return res.json({ ok: true, yaRegistrada: true, data: yaExistente, warnings: [], stock: [] });
    }

    // La sucursal se resuelve UNA vez para toda la venta: cabecera
    // `X-Punto-De-Venta-Id` si vino, y si no el punto de venta por defecto de la
    // empresa. **Es obligatoria, no opcional**, y `resolverSucursal` nunca
    // devuelve null.
    //
    // Se resuelve ACA, antes del Sale.create, y no adentro del `if
    // (lineas.length)` donde estaba. Antes la sucursal se decidia dos veces y de
    // dos maneras distintas: el stock salia de `resolverSucursal(...)` y la
    // venta se guardaba con `req.puntoDeVentaId || null`. Sin la cabecera, la
    // mercaderia salia de una sucursal concreta y la venta quedaba diciendo que
    // no fue de ninguna.
    //
    // Eso no se ve al cobrar: se ve al anular. `sucursalDeAnulacion` cae
    // entonces al tercer escalon —el por defecto de la empresa—, que **no es
    // estable**: alcanza con crear una sucursal `principal`, o con dar de baja
    // la que era el default, para que la devolucion de stock de una venta vieja
    // aterrice en OTRO local. No falla nada y se descubre en un recuento fisico.
    //
    // Como el bucle de stock usa esta misma variable, **por construccion** la
    // venta queda asentada en la sucursal de la que salio la mercaderia. Y como
    // esta afuera del `if`, una venta SIN lineas tambien queda atribuida.
    const sucursal = await resolverSucursal({
      empresaId: req.empresaId,
      puntoDeVentaId: req.puntoDeVentaId,
      transaction: t,
    });

    const saleData = {
      id,
      date: date || fechaDelNegocio(zona),
      time: time || horaDelNegocio(zona),
      notes, location, seller,
      total: verificacion.total,
      // El metodo de pago sale de las lineas cuando todas coinciden. Antes el
      // frontend mandaba el del PRIMER item, con lo cual una venta con lineas
      // de distinto metodo quedaba registrada entera bajo el de la primera.
      // Si las lineas difieren, no se puede deducir uno solo y se respeta el
      // declarado, que es el comportamiento historico.
      payment_method: metodoDePago(lineas) || payment_method || 'ef',
      afip_cae, afip_nro, afip_vto, afip_type,
      empresa_id: req.empresaId,
      // La sucursal RESUELTA, no la cabecera cruda: ver el comentario de arriba.
      punto_de_venta_id: sucursal.id,
      status: 'active',
    };
    // El nombre del cliente se guarda exista o no la ficha: es lo que se
    // imprime en un remito y lo que se busca en el historial. Antes solo se
    // persistia junto con customer_id, y el POS terminaba metiendolo adentro
    // de `notes`, donde ninguna busqueda lo encuentra y de donde la columna
    // Cliente no lo puede leer.
    saleData.customer_name = normalizarNombreDeCliente(customer_name);

    if (customer_id) {
      saleData.customer_id = customer_id;
      // Al contado salvo que se pida lo contrario. is_credit sigue atado a
      // customer_id y NO al nombre: sin ficha no hay a quien cobrarle despues,
      // asi que un nombre libre no puede generar una deuda sin deudor.
      saleData.is_credit = is_credit === true || is_credit === 'true';
    }

    if (esPagoMixto(lineas)) {
      // Queda registrado para poder dimensionar cuantas ventas mixtas hay
      // antes de decidir como representarlas.
      logger.info(
        { empresaId: req.empresaId, metodoDeclarado: saleData.payment_method },
        'sales: venta con lineas de distinto metodo de pago'
      );
    }

    const sale = await Sale.create(saleData, { transaction: t });

    if (lineas.length) {
      const saleItems = lineas.map((item) => ({
        sale_id: sale.id,
        ...normalizarItem(item),
      }));
      await SaleItem.bulkCreate(saleItems, { transaction: t });

      for (const si of saleItems) {
        if (!si.product_id) continue;

        const stock = await Stock.findOne({
          where: {
            product_id: si.product_id,
            empresa_id: req.empresaId,
            punto_de_venta_id: sucursal.id,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        // Sin fila de stock para ese punto de venta, la venta se registraba y
        // no se descontaba nada, sin ningun aviso. Es el caso tipico cuando el
        // stock se cargo sin sucursal y el POS opera con una: el inventario
        // nunca baja y el faltante aparece recien en un recuento fisico.
        //
        // No se rechaza la venta —hay rubros que venden servicios sin stock—
        // pero se avisa en la respuesta y queda en el log.
        if (!stock) {
          advertencias.push(
            `No hay stock cargado para "${si.product_name}" en este punto de venta: no se descontó inventario.`
          );
          logger.warn(
            { empresaId: req.empresaId, productId: si.product_id, puntoDeVentaId: sucursal.id },
            'sales: venta sin fila de stock, no se descuenta'
          );
        }

        if (stock) {
          const qty = si.quantity;
          if (stock.available < qty) {
            throw new Error(`Stock insuficiente para "${si.product_name}": disponible ${stock.available}, requerido ${qty}`);
          }
          const oldQty = stock.quantity;
          const oldAvail = stock.available;
          await stock.update({
            quantity: stock.quantity - qty,
            available: stock.available - qty,
          }, { transaction: t });

          await StockMovement.create({
            empresa_id: req.empresaId,
            product_id: si.product_id,
            // La sucursal resuelta y no la cabecera cruda: el movimiento tiene
            // que decir de qué estantería salió la mercadería. Con la cabecera
            // ausente quedaba en `null`, y un movimiento que no dice dónde
            // pasó no sirve para reconstruir un descuadre.
            punto_de_venta_id: sucursal.id,
            tipo: 'sale',
            referencia_id: sale.id,
            cantidad_anterior: oldQty,
            cantidad_nueva: stock.quantity,
            disponible_anterior: oldAvail,
            disponible_nuevo: stock.available,
            usuario_id: req.userId,
          }, { transaction: t });

          // La fila se lee DESPUES del update y DENTRO de la transaccion. Leerla
          // despues del commit devolveria valores que otra caja ya pudo cambiar,
          // y el catalogo quedaria mostrando el stock de la venta de otro.
          //
          // `punto_de_venta_id` va en cada fila aunque sea siempre el mismo: es
          // lo que le permite a la pantalla reemplazar ESA fila de
          // `producto.stock[]` y no la de otra sucursal.
          filasDeStock.push({
            product_id: si.product_id,
            punto_de_venta_id: sucursal.id,
            quantity: stock.quantity,
            available: stock.available,
          });
        }
      }
    }

    await t.commit();
    res.status(201).json({ ok: true, data: sale, warnings: advertencias, stock: filasDeStock });
  } catch (err) {
    await t.rollback();
    if (err.message.startsWith('Stock insuficiente')) {
      return res.status(400).json({ ok: false, error: err.message });
    }

    // La otra mitad de la idempotencia, y la que de verdad sostiene la garantia.
    // El findScoped de arriba NO es atomico: dos requests en vuelo al mismo
    // tiempo pasan los dos por el findOne y el que pierde choca contra la clave
    // primaria. La guardia real es la restriccion de la base; el findOne es el
    // camino normal, el que evita abrir el insert cuando ya se sabe la respuesta.
    //
    // Se relee la venta en vez de confiar en el nombre del constraint: si el
    // choque fue por otra cosa, no se encuentra nada y el error sale por fallo()
    // como cualquier otro. Cuando el que perdio la carrera llega hasta aca, el
    // que gano ya commiteo —Postgres lo hizo esperar en el indice—, asi que la
    // fila esta.
    if (err.name === 'SequelizeUniqueConstraintError') {
      const registrada = await findScoped(Sale, req.body.id, req.empresaId);

      if (registrada) {
        logger.info(
          { empresaId: req.empresaId, saleId: req.body.id },
          'sales: dos requests con el mismo id, se devuelve la venta ya registrada'
        );
        return res.json({ ok: true, yaRegistrada: true, data: registrada, warnings: [], stock: [] });
      }
    }

    // Registrar una venta es la operacion mas critica del sistema: si falla y
    // no queda rastro, no hay forma de reconstruir que paso en la caja.
    fallo(req, res, err, 'Error al registrar la venta');
  }
});

// PUT /api/sales/:id/void — Anular venta (restaurar stock)
router.put('/:id/void', checkPermission('ventas.anular'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Sin el filtro por empresa, este endpoint permitia anular la venta de
    // otra empresa cliente — y la anulacion devuelve stock, asi que ademas de
    // leer, alteraba su inventario.
    //
    // El lock va SIN include a proposito. Con un include, Sequelize arma
    // "SELECT ... LEFT OUTER JOIN sale_items ... FOR UPDATE", y PostgreSQL lo
    // rechaza: "FOR UPDATE cannot be applied to the nullable side of an outer
    // join". La consulta fallaba siempre y ninguna venta se podia anular.
    // Los items se traen aparte, ya con la venta bloqueada.
    const sale = await findScoped(Sale, req.params.id, req.empresaId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, error: 'Venta no encontrada' });
    }
    if (sale.status === 'voided') {
      await t.rollback();
      return res.status(400).json({ ok: false, error: 'Venta ya anulada' });
    }

    // ── Anular un comprobante con CAE queda bloqueado ──
    //
    // Anular acá no anula nada ante ARCA: el comprobante sigue vigente, sigue
    // declarado y sigue en la base imponible. La única forma de revertirlo es
    // una nota de crédito, que el sistema todavía no emite.
    //
    // Hasta ahora se permitía, y por eso taxService cuenta esas ventas como
    // `anuladas_con_cae_sin_nc`: es un desvío conocido. De acá en adelante no
    // se puede crear uno nuevo. Las que ya existen quedan como histórico y se
    // muestran con etiqueta y color propios.
    //
    // El bloqueo va ANTES de tocar el stock: si fuera después, una anulación
    // rechazada habría devuelto igual la mercadería al inventario.
    //
    // Y va en la API, no solo en la pantalla: sin esto, un curl sigue pudiendo
    // anular.
    if (sale.afip_cae) {
      throw new ErrorDeNegocio(
        'Esta venta tiene un comprobante con CAE: sigue vigente ante ARCA y anularla ' +
        'acá no lo da de baja. Hace falta una nota de crédito, que el sistema todavía ' +
        'no emite.'
      );
    }

    const items = await SaleItem.findAll({
      where: { sale_id: sale.id },
      transaction: t,
    });

    // A qué sucursal vuelve la mercadería, en este orden:
    //
    //  1. `sale.punto_de_venta_id`, si la venta lo tiene;
    //  2. `sale.location`, interpretado como código de sucursal;
    //  3. el punto de venta por defecto de la empresa.
    //
    // El segundo y el tercer escalón **no son adorno**: `punto_de_venta_id`
    // está en `null` en TODAS las ventas anteriores a esta funcionalidad, y
    // esta funcionalidad no migra la tabla `sales` (está Fuera de alcance).
    // Con la columna de `stock` ya en NOT NULL, buscar por `null` no encuentra
    // ninguna fila: anular una venta vieja devolvería el dinero y **no** la
    // mercadería, sin ningún error a la vista.
    //
    // `sale.location` puede ser un texto que no resuelve —lo escribía el
    // cliente—, así que se prueba y se cae al por defecto en vez de fallar: la
    // anulación no se puede rechazar por un dato viejo mal escrito.
    const sucursal = await sucursalDeAnulacion(sale, t);

    for (const item of items) {
      if (!item.product_id) continue;

      const stock = await Stock.findOne({
        where: {
          product_id: item.product_id,
          empresa_id: sale.empresa_id,
          punto_de_venta_id: sucursal.id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (stock) {
        const oldQty = stock.quantity;
        const oldAvail = stock.available;
        await stock.update({
          quantity: stock.quantity + item.quantity,
          available: stock.available + item.quantity,
        }, { transaction: t });

        await StockMovement.create({
          empresa_id: sale.empresa_id,
          product_id: item.product_id,
          // La sucursal a la que volvió la mercadería, que en una venta vieja
          // no es la de la venta: la venta no tiene ninguna.
          punto_de_venta_id: sucursal.id,
          tipo: 'sale_void',
          referencia_id: sale.id,
          cantidad_anterior: oldQty,
          cantidad_nueva: stock.quantity,
          disponible_anterior: oldAvail,
          disponible_nuevo: stock.available,
          usuario_id: req.userId,
        }, { transaction: t });
      }
    }

    await sale.update({
      status: 'voided',
      voided_at: new Date(),
      voided_by: req.userId,
    }, { transaction: t });

    await t.commit();
    res.json({ ok: true, message: 'Venta anulada y stock restaurado' });
  } catch (err) {
    await t.rollback();
    fallo(req, res, err, 'Error al anular la venta');
  }
});

/**
 * Tipo de comprobante, CUIT del receptor, condición de IVA y punto de venta.
 *
 * Lo que venga en el body manda; lo que falte lo deduce el servidor de la
 * venta que tiene delante y de la configuración de la empresa.
 *
 * Por qué acá y no en la pantalla: el panel tendría que traerse `settings` y
 * la ficha del cliente solo para reconstruir reglas fiscales que el servidor
 * ya puede deducir. Serían dos implementaciones de la misma regla, y la del
 * navegador es la que se puede editar desde la consola.
 *
 * El body sigue aceptando los cuatro campos, así que el POS no cambia su
 * llamada: el contrato se amplía, no se rompe.
 */
async function resolverComprobante(sale, body, empresaId, transaction) {
  const configuracion = await Setting.findAll({
    where: {
      key: { [Op.in]: ['tax_condition', 'afip_pv'] },
      empresa_id: empresaId,
    },
    transaction,
  });

  const ajuste = (clave) => {
    const fila = configuracion.find((c) => c.key === clave);
    return fila ? fila.value : null;
  };

  // Responsable Inscripto emite Factura B (6); Monotributo y Exento, Factura C
  // (11). Es el mismo criterio que ya usa el POS: cualquier condición que no
  // sea RI cae en C.
  const tipo = parseInt(body.type, 10) || (ajuste('tax_condition') === 'RI' ? 6 : 11);

  // ── La ficha del cliente ──
  //
  // Se lee UNA vez y alimenta DOS campos del comprobante: el CUIT y la
  // condición de IVA del receptor. Antes se pedía solo `tax_id`, y solo cuando
  // faltaba el CUIT en el body: `tax_condition` no se leía nunca, así que la
  // condición fiscal del comprador no podía salir de su ficha ni aunque la
  // ficha la tuviera cargada.
  const cliente = sale.customer_id
    ? await Customer.findOne({
      where: scoped({ id: sale.customer_id }, empresaId),
      attributes: ['id', 'tax_id', 'tax_condition'],
      transaction,
    })
    : null;

  // El CUIT sale de la ficha del cliente de la venta. Sin ficha, el
  // comprobante va a consumidor final: afipService manda DocTipo 99 cuando no
  // recibe CUIT.
  let cuit = body.customerCuit;

  if (cuit === undefined || cuit === null || cuit === '') {
    // Se sacan los separadores: la ficha guarda el CUIT como lo tipeó el
    // usuario ("20-12345678-9") y afipService decide DocTipo por el largo del
    // string. Con guiones, un CUIT de 11 dígitos mide 13 y el DocNro sale con
    // basura adentro.
    const guardado = cliente && cliente.tax_id ? String(cliente.tax_id).replace(/\D/g, '') : '';
    cuit = guardado || null;
  }

  // ── Condición de IVA del receptor (FR-043, AC 3.4) ──
  //
  // Sale de la ficha del cliente. Antes se derivaba del TIPO de comprobante
  // —1 para Factura A, 5 para el resto—, y eso es un error fiscal, no un
  // detalle: una venta a un Responsable Inscripto se declaraba ante ARCA como
  // Consumidor Final, con el CUIT del RI adjunto. El comprobante sale, ARCA lo
  // autoriza, y queda declarado con una condición que no es la del comprador.
  // Deshacerlo exige una nota de crédito, que el sistema todavía no emite.
  //
  // El orden es body → ficha → tipo de comprobante:
  //   - El body manda, porque es lo que sigue mandando el POS y lo que permite
  //     corregir a mano una ficha que esté mal.
  //   - La ficha, cuando la venta tiene cliente y la condición se reconoce.
  //   - La regla vieja por tipo queda como respaldo, para las ventas sin ficha
  //     y para una condición que el mapeo no conoce. `condicionIvaDeAfip`
  //     devuelve null ante lo desconocido justamente para poder caer acá en vez
  //     de inventar un 5.
  const condicionIva = parseInt(body.customerVatCondition, 10)
    || condicionIvaDeAfip(cliente && cliente.tax_condition)
    || ([1, 2, 3].includes(tipo) ? 1 : 5);

  // El punto de venta sale de la venta si ya tenía uno; si no, del configurado
  // para la empresa.
  //
  // La regla queda escrita con la forma que pide el requisito, aunque hoy
  // colapse siempre en settings.afip_pv: `puntos_de_venta` NO tiene columna
  // con el punto de venta de ARCA, y agregarla sería una columna que ninguna
  // pantalla puede completar. Queda como proyecto aparte. Consecuencia
  // vigente: una empresa con dos locales comparte numeración correlativa entre
  // ambos, que es el comportamiento actual.
  const pv = parseInt(body.pv, 10)
    || parseInt(sale.afip_pv, 10)
    || parseInt(ajuste('afip_pv'), 10);

  return { tipo, cuit, condicionIva, pv: Number.isInteger(pv) ? pv : null };
}

/**
 * Guarda el rechazo de AFIP en la venta.
 *
 * Va en un UPDATE propio y FUERA de la transacción del reintento, porque esa
 * transacción se revierte: lo que se escriba adentro se va con ella.
 *
 * Las dos condiciones del where no son decorativas:
 *   - `empresa_id`, porque toda escritura por id lo lleva.
 *   - `afip_cae IS NULL`, para que una escritura tardía —el intento que perdió
 *     una carrera— no le ponga un mensaje de rechazo a una venta que, entre
 *     medio, se facturó bien. Sin eso, la venta quedaría con CAE y con un
 *     error guardado al mismo tiempo.
 *
 * Si este UPDATE falla, se loguea y se sigue: el usuario tiene que ver el
 * mensaje de AFIP igual. Perder el registro del intento es malo; tapar el
 * motivo del rechazo con un 500 genérico es peor.
 */
async function registrarIntentoFallido(saleId, empresaId, mensaje) {
  try {
    await Sale.update(
      { afip_ultimo_error: mensaje, afip_ultimo_intento: new Date() },
      {
        where: {
          id: saleId,
          empresa_id: empresaId,
          afip_cae: { [Op.is]: null },
        },
      }
    );
  } catch (err) {
    logger.error(
      { err, empresaId, saleId },
      'sales: no se pudo guardar el error de AFIP del intento'
    );
  }
}

// POST /api/sales/:id/facturar — Pedir el CAE de una venta ya registrada
//
// ── Por qué existe ──
//
// El POS pedía el CAE a AFIP y DESPUÉS guardaba la venta. Si el guardado
// fallaba —red, validación, stock insuficiente— quedaba un comprobante fiscal
// emitido, con número de AFIP consumido, sin ningún registro en el sistema. El
// usuario veía un error genérico y no tenía forma de enterarse de que acababa
// de emitirse una factura a su nombre.
//
// Dando vuelta el orden, el peor caso cambia por completo:
//   - Si falla el guardado → no se pidió ningún CAE. No hay nada huérfano.
//   - Si falla AFIP → la venta existe sin comprobante, y se puede reintentar.
//
// Además el importe que se declara sale de la venta PERSISTIDA, no del carrito
// del navegador: antes podían diferir y nadie lo comparaba.
//
// ── Por qué la venta se toma con lock ──
//
// Sin lock había una carrera con la anulación: dos usuarios, uno reintenta y
// el otro anula. El reintento leía la venta, la veía activa, se iba treinta
// segundos a hablar con AFIP, y cuando volvía escribía el CAE sobre una venta
// que ya estaba anulada. Queda un comprobante fiscal emitido, con número de
// ARCA consumido, contra una operación que el sistema da por cancelada — y
// deshacerlo exige una nota de crédito, que el sistema todavía no emite.
//
// La transacción abarca la llamada a AFIP a propósito. Es lo que cierra las
// dos puntas:
//   - Si gana el reintento, la anulación espera y al entrar ve el CAE recién
//     escrito: la rechaza.
//   - Si gana la anulación, el reintento entra después, lee status 'voided' y
//     corta ANTES de llamar a AFIP.
//
// Está acotada por el timeout de 30 s del cliente SOAP (afipService.js:26),
// así que el lock no puede quedar tomado indefinidamente.
router.post('/:id/facturar', checkPermission('ventas.crear'), async (req, res) => {
  const t = await sequelize.transaction();
  let transaccionAbierta = true;

  /** Revierte solo si sigue abierta: rollback sobre una transacción ya
   *  terminada tira, y taparía el error real. */
  const revertir = async () => {
    if (!transaccionAbierta) return;
    transaccionAbierta = false;
    await t.rollback();
  };

  try {
    // El lock va SIN include, igual que en /void. Con un include, Sequelize
    // arma "SELECT ... LEFT OUTER JOIN ... FOR UPDATE" y PostgreSQL lo
    // rechaza: "FOR UPDATE cannot be applied to the nullable side of an outer
    // join". La consulta fallaría siempre y no se podría facturar nada.
    const sale = await findScoped(Sale, req.params.id, req.empresaId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!sale) {
      await revertir();
      return res.status(404).json({ ok: false, error: 'Venta no encontrada' });
    }

    // Las dos revalidaciones van DENTRO de la transacción, sobre la fila ya
    // bloqueada: lo que valía antes de pedir el lock puede haber cambiado
    // mientras se esperaba.
    if (sale.status === 'voided') {
      await revertir();
      return res.status(400).json({ ok: false, error: 'No se puede facturar una venta anulada' });
    }

    // Idempotente: un reintento sobre una venta ya facturada devuelve el CAE
    // que tiene, en vez de pedir otro y duplicar el comprobante. Con el lock,
    // esto además resuelve dos reintentos simultáneos: el segundo espera, y al
    // entrar encuentra el CAE que emitió el primero.
    if (sale.afip_cae) {
      await revertir();
      return res.json({
        ok: true,
        yaFacturada: true,
        data: {
          cae: sale.afip_cae,
          expiration: sale.afip_vto,
          voucherNumber: sale.afip_nro,
          type: sale.afip_type,
        },
      });
    }

    // El reintento desde el panel manda el body vacío: el servidor resuelve
    // los cuatro campos. El POS los sigue mandando y sigue mandando él.
    const comprobante = await resolverComprobante(sale, req.body, req.empresaId, t);

    if (!Number.isInteger(comprobante.pv)) {
      await revertir();
      return res.status(400).json({ ok: false, error: 'Falta el punto de venta de AFIP' });
    }

    // Una Factura A (o su nota de credito) se emite a un Responsable
    // Inscripto, y AFIP exige el CUIT del receptor. Sin validarlo, el
    // comprobante salia con DocTipo 99 (consumidor final) y AFIP lo rechazaba
    // con un error que el cajero no puede interpretar.
    const cuitReceptor = String(comprobante.cuit || '').replace(/\D/g, '');

    if ([1, 2, 3].includes(comprobante.tipo) && cuitReceptor.length !== 11) {
      await revertir();
      return res.status(400).json({
        ok: false,
        error: 'CUIT_REQUERIDO',
        message: 'Una Factura A necesita el CUIT del comprador (11 dígitos).',
      });
    }

    // ── El try acotado ──
    //
    // Solo la llamada a AFIP. Antes el catch abarcaba el handler entero y
    // devolvía `err.message` viniera de donde viniera: si fallaba el
    // sale.update, el usuario recibía un 502 con un mensaje de Sequelize —
    // nombres de tabla y de constraint— presentado como «lo que dijo AFIP».
    // Con la columna nueva, ese mismo texto además quedaría guardado y se
    // mostraría en el panel para siempre. La guardia estática no lo ve porque
    // no es un 500.
    let resultado;

    try {
      resultado = await afipService.createVoucher({
        type: comprobante.tipo,
        pv: comprobante.pv,
        customerCuit: comprobante.cuit,
        // El importe sale de la venta guardada, que es el que ya se validó
        // contra las líneas.
        amount: parseFloat(sale.total),
        customerVatCondition: comprobante.condicionIva,
        empresaId: req.empresaId,
      });
    } catch (errorDeAfip) {
      // El rechazo se guarda FUERA de esta transacción, porque la transacción
      // se revierte: lo escrito adentro se iría con ella.
      await revertir();
      await registrarIntentoFallido(req.params.id, req.empresaId, errorDeAfip.message);

      logger.error(
        { err: errorDeAfip, empresaId: req.empresaId, saleId: req.params.id },
        'sales: AFIP rechazó el comprobante'
      );

      // El mensaje de AFIP se devuelve tal cual: el usuario necesita saber por
      // qué le rechazaron el comprobante para poder corregirlo. La venta quedó
      // guardada, así que puede reintentar.
      return res.status(502).json({
        ok: false,
        error: errorDeAfip.message,
        message: 'La venta quedó registrada pero no se pudo emitir el comprobante. Podés reintentar desde el listado de ventas.',
      });
    }

    await sale.update({
      afip_cae: resultado.cae,
      afip_nro: resultado.voucherNumber,
      afip_vto: resultado.expiration,
      afip_type: resultado.type,
      // Sin esto no se puede identificar el comprobante mas adelante: la
      // numeracion de AFIP es correlativa POR PUNTO DE VENTA.
      afip_pv: comprobante.pv,
      // El rechazo guardado se limpia: si no, el panel seguiría mostrando el
      // error de un intento anterior sobre una venta que ya salió bien.
      afip_ultimo_error: null,
      afip_ultimo_intento: new Date(),
    }, { transaction: t });

    transaccionAbierta = false;
    await t.commit();

    logger.info(
      { empresaId: req.empresaId, saleId: sale.id, cae: resultado.cae },
      'sales: comprobante emitido'
    );

    res.json({ ok: true, data: resultado });
  } catch (err) {
    await revertir();
    // Cualquier cosa que no sea AFIP —leer la venta, escribir el CAE, la
    // transacción misma— sale por acá: 500 con requestId y sin nombres de
    // tabla, en vez de un 502 que le atribuye a ARCA un error nuestro.
    fallo(req, res, err, 'Error al facturar la venta');
  }
});

module.exports = router;
