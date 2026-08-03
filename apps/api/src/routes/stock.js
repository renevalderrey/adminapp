const express = require('express');
const router = express.Router();
const { Stock, StockTransfer, Product, sequelize } = require('../models');
const { Op } = require('sequelize');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');

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
