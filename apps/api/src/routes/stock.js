const express = require('express');
const router = express.Router();
const { Stock, StockTransfer, Product, PuntoDeVenta, sequelize } = require('../models');
const { Op } = require('sequelize');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');

// GET /api/stock/sucursales — Las sucursales de la empresa, INCLUIDAS las inactivas
//
// Es lo que define cuántas columnas de stock tiene la tabla (FR-060, FR-063) y
// qué ofrecen los selectores de la transferencia (FR-115).
//
// Existe porque los dos endpoints que hoy listan puntos de venta filtran por
// `is_active` —`GET /api/empresas/mi-contexto` (`empresas.js:195`) y
// `GET /api/empresas/:id/puntos-de-venta` (`empresas.js:561`)— y el segundo
// además pide `sucursales.ver`, un permiso que esta pantalla no exige. Sin
// esto, el stock de un local cerrado no llega al navegador por ningún camino.
//
// ⚠ **Esta ruta depende de que `routes/general.js` no declare un
// `GET /stock/:algo`.** `server.js:342` monta `general.js` en `/api` **antes**
// que `/api/stock` (`:354`), así que Express le da a `general.js` la primera
// oportunidad de contestar `/api/stock/sucursales`. Hoy sale por acá solo
// porque `general.js` declara `GET /stock` **exacto** (`:26`), que no matchea
// la subruta. El día que alguien agregue un `GET /stock/:id` allá, se come
// `/sucursales` y la tabla se queda sin columnas — sin que falle nada más.
router.get('/sucursales', checkPermission('stock.ver'), async (req, res) => {
  try {
    const sucursales = await PuntoDeVenta.findAll({
      // Sin `is_active` en el where, a propósito: cerrar un local no evapora su
      // mercadería, y ese stock es justamente el que hay que poder transferir a
      // otro lado (FR-066).
      where: { empresa_id: req.empresaId },
      attributes: ['id', 'name', 'code', 'is_active'],
      // Activas primero y después por nombre. El orden lo hace la base y no el
      // navegador porque es el mismo orden en el que se dibujan las columnas de
      // la tabla: dos criterios distintos harían que la columna 3 de una pantalla
      // no sea la columna 3 de la otra.
      order: [['is_active', 'DESC'], ['name', 'ASC']],
    });

    res.json({ ok: true, data: sucursales });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las sucursales');
  }
});

// POST /api/stock/transfer — Transferir stock entre sucursales
//
// Acepta `from_punto_de_venta_id` / `to_punto_de_venta_id` y sigue aceptando
// los `code` (`from_location` / `to_location`) por compatibilidad con lo que
// manda hoy el navegador. Los dos extremos se resuelven a un id **antes de
// tocar nada**: un código que no existe es un 400 con los códigos válidos, y no
// una caída a buscar por el texto `location` como era antes. Esa caída es la
// que movía mercadería entre filas que la pantalla no muestra.
router.post('/transfer', checkPermission('stock.transferir'), async (req, res) => {
  const {
    from_location, to_location,
    from_punto_de_venta_id, to_punto_de_venta_id,
    items,
  } = req.body;
  const empresaId = req.empresaId;

  // Las validaciones que no necesitan la base van ANTES de abrir la
  // transaccion. Antes estaban adentro y cada `return` de estos se iba sin
  // hacer rollback: la transaccion quedaba abierta reteniendo una conexion del
  // pool hasta que venciera el timeout.
  const hayOrigen = from_punto_de_venta_id || from_location;
  const hayDestino = to_punto_de_venta_id || to_location;

  if (!hayOrigen || !hayDestino) {
    return res.status(400).json({ ok: false, error: 'Origen y destino son requeridos' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Debe incluir al menos un producto' });
  }

  // Un ítem sin producto o con cantidad cero **falla**, no se saltea. Con el
  // `continue` de antes, una transferencia de un solo ítem en cantidad 0
  // quedaba registrada **sin ningún ítem**: un registro que dice que se movió
  // mercadería cuando no se movió nada, y que después nadie puede explicar.
  const invalido = items.findIndex((i) => !i.product_id || !(parseFloat(i.quantity) > 0));

  if (invalido >= 0) {
    return res.status(400).json({
      ok: false,
      error: `El ítem ${invalido + 1} no tiene producto o tiene cantidad cero. `
        + 'Una transferencia con ítems vacíos queda registrada como si hubiera movido '
        + 'mercadería.',
    });
  }

  const t = await sequelize.transaction();
  try {
    const [fromPv, toPv] = await Promise.all([
      resolverSucursal({
        empresaId,
        puntoDeVentaId: from_punto_de_venta_id,
        code: from_location,
        transaction: t,
      }),
      resolverSucursal({
        empresaId,
        puntoDeVentaId: to_punto_de_venta_id,
        code: to_location,
        transaction: t,
      }),
    ]);

    // La comparación es **por id** y no por los textos. Mandar el código de una
    // sucursal en un campo y su id en el otro pasaba la validación de arriba y
    // terminaba moviendo mercadería de una sucursal a sí misma.
    if (fromPv.id === toPv.id) {
      throw new ErrorDeNegocio('Origen y destino deben ser diferentes');
    }

    // Sacar mercadería de una sucursal inactiva **se permite**: es exactamente
    // lo que hay que poder hacer cuando se cierra un local (FR-115). Meterla no:
    // sería mandar stock a un lugar que ya no opera y que la pantalla no ofrece.
    if (toPv.is_active === false) {
      throw new ErrorDeNegocio(
        `La sucursal "${toPv.name}" está inactiva: no se puede mandar mercadería ahí. `
        + 'Sacarla sí se puede.'
      );
    }

    const destino = ubicacionDeStock(toPv);
    const transferItems = [];

    for (const item of items) {
      const productId = item.product_id;
      const qty = parseFloat(item.quantity);

      const sourceStock = await Stock.findOne({
        where: { product_id: productId, empresa_id: empresaId, punto_de_venta_id: fromPv.id },
        transaction: t,
      });

      if (!sourceStock || sourceStock.quantity < qty) {
        const product = await findScoped(Product, productId, empresaId);
        throw new ErrorDeNegocio(`Stock insuficiente en "${fromPv.name}" para "${product?.name || 'Producto'}" (disponible: ${sourceStock?.quantity || 0}, requerido: ${qty})`);
      }

      sourceStock.quantity -= qty;
      sourceStock.available -= qty;
      await sourceStock.save({ transaction: t });

      let destStock = await Stock.findOne({
        where: { product_id: productId, empresa_id: empresaId, punto_de_venta_id: toPv.id },
        transaction: t,
      });

      if (destStock) {
        destStock.quantity += qty;
        destStock.available += qty;
        await destStock.save({ transaction: t });
      } else {
        // Con `punto_de_venta_id` SIEMPRE. Antes iba solo si el destino había
        // resuelto por código: si no, se creaba una fila con el texto suelto y
        // sin sucursal, o sea mercadería que la pantalla nunca muestra.
        await Stock.create({
          product_id: productId,
          quantity: qty,
          available: qty,
          min_stock: 0,
          empresa_id: empresaId,
          ...destino,
        }, { transaction: t });
      }

      const product = await findScoped(Product, productId, empresaId, { transaction: t });
      transferItems.push({
        product_id: productId,
        product_name: product?.name || 'Unknown',
        quantity: qty,
      });
    }

    const transfer = await StockTransfer.create({
      // Los `_location` siguen siendo NOT NULL y se escriben desde la sucursal
      // resuelta, no desde lo que mandó el cliente: son el espejo, igual que en
      // `stock`.
      from_location: (fromPv.code || fromPv.name || '').slice(0, 30),
      to_location: destino.location,
      from_punto_de_venta_id: fromPv.id,
      to_punto_de_venta_id: toPv.id,
      items: transferItems,
      empresa_id: empresaId,
    }, { transaction: t });

    await t.commit();
    res.status(201).json({ ok: true, data: transfer });
  } catch (err) {
    await t.rollback();
    fallo(req, res, err, 'Error al transferir stock entre sucursales');
  }
});

// GET /api/stock/transfers — Historial
router.get('/transfers', checkPermission('stock.ver'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const { count, rows } = await StockTransfer.findAndCountAll({
      where: { empresa_id: req.empresaId },
      // Los nombres de las sucursales vienen del servidor para que el historial
      // los muestre sin cruzarlos en el navegador (FR-117).
      //
      // `required: false` en los dos: una transferencia **anterior** a esta
      // funcionalidad puede tener los dos ids en `null` —no se migran, está
      // Fuera de alcance—. Con un INNER JOIN, esas filas desaparecerían del
      // historial: el usuario vería que se le borraron transferencias que sí
      // ocurrieron. Ahí los objetos vienen en `null` y la pantalla cae a
      // `from_location` / `to_location`, que es el caso que hay que devolver,
      // no evitar.
      include: [
        {
          model: PuntoDeVenta,
          as: 'fromPuntoDeVenta',
          attributes: ['id', 'name'],
          required: false,
        },
        {
          model: PuntoDeVenta,
          as: 'toPuntoDeVenta',
          attributes: ['id', 'name'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.json({ ok: true, data: rows, total: count });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las transferencias de stock');
  }
});

module.exports = router;
