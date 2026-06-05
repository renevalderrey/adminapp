const { PuntoDeVenta, Stock, Sale, ProductionOrder, StockTransfer, sequelize } = require('./models');
const { Op } = require('sequelize');
const logger = require('./utils/logger');

async function seedPuntosDeVenta() {
  try {
    const count = await PuntoDeVenta.count();
    if (count > 0) {
      logger.info('Puntos de venta already exist, running location→PV mapping...');
    } else {
      logger.info('No puntos de venta found, creating defaults...');
    }

    const empresasConStock = await Stock.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('empresa_id')), 'empresa_id']],
      where: { empresa_id: { [Op.ne]: null } },
      raw: true,
    });

    const empresasConSales = await Sale.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('empresa_id')), 'empresa_id']],
      where: { empresa_id: { [Op.ne]: null } },
      raw: true,
    });

    const empresasConProd = await ProductionOrder.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('empresa_id')), 'empresa_id']],
      where: { empresa_id: { [Op.ne]: null } },
      raw: true,
    });

    const empresaIds = new Set([
      ...empresasConStock.map(r => r.empresa_id),
      ...empresasConSales.map(r => r.empresa_id),
      ...empresasConProd.map(r => r.empresa_id),
    ]);
    if (empresaIds.size === 0) empresaIds.add(1);

    const locationCodes = ['general', 'ortiz', 'mayo'];
    const locationNames = {
      general: 'Casa Central',
      ortiz: 'Ortiz',
      mayo: 'Mayo',
    };

    for (const empresaId of empresaIds) {
      for (const code of locationCodes) {
        await PuntoDeVenta.findOrCreate({
          where: { empresa_id: empresaId, code },
          defaults: {
            empresa_id: empresaId,
            code,
            name: locationNames[code] || code,
            is_active: true,
          },
        });
      }
    }

    logger.info('PuntoDeVenta records ensured for all empresas');

    await mapLocationField(Stock, 'location', 'punto_de_venta_id', 'stock');
    await mapLocationField(Sale, 'location', 'punto_de_venta_id', 'sales');
    await mapLocationField(ProductionOrder, 'location', 'punto_de_venta_id', 'production_orders');

    const transfers = await StockTransfer.findAll({
      where: {
        [Op.or]: [
          { from_punto_de_venta_id: null },
          { to_punto_de_venta_id: null },
        ],
      },
    });

    for (const t of transfers) {
      const fromPv = await PuntoDeVenta.findOne({
        where: { empresa_id: t.empresa_id, code: t.from_location },
      });
      const toPv = await PuntoDeVenta.findOne({
        where: { empresa_id: t.empresa_id, code: t.to_location },
      });
      const updates = {};
      if (fromPv && !t.from_punto_de_venta_id) updates.from_punto_de_venta_id = fromPv.id;
      if (toPv && !t.to_punto_de_venta_id) updates.to_punto_de_venta_id = toPv.id;
      if (Object.keys(updates).length > 0) {
        await t.update(updates);
      }
    }

    logger.info('Location→PuntoDeVenta mapping complete');
  } catch (err) {
    logger.error({ err }, 'Error in seedPuntosDeVenta');
  }
}

async function mapLocationField(Model, locationField, pvField, tableLabel) {
  const records = await Model.findAll({
    where: { [pvField]: null },
    include: [],
  });

  let updated = 0;
  for (const record of records) {
    const location = record[locationField] || 'general';
    const pv = await PuntoDeVenta.findOne({
      where: { empresa_id: record.empresa_id, code: location },
    });
    if (pv) {
      await record.update({ [pvField]: pv.id });
      updated++;
    }
  }

  if (updated > 0) {
    logger.info({ table: tableLabel, updated }, `Mapped ${updated} ${tableLabel} records`);
  }
}

module.exports = seedPuntosDeVenta;
