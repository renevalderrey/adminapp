const { Empresa, PuntoDeVenta, Sale, ProductionOrder, StockTransfer } = require('./models');
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

    const empresas = await Empresa.findAll({ attributes: ['id'], raw: true });
    if (empresas.length === 0) {
      logger.info('No empresas found, skipping PuntoDeVenta seed');
      return;
    }

    const locationCodes = ['general', 'ortiz', 'mayo'];
    const locationNames = {
      general: 'Casa Central',
      ortiz: 'Ortiz',
      mayo: 'Mayo',
    };

    for (const { id: empresaId } of empresas) {
      const existingCount = await PuntoDeVenta.count({ where: { empresa_id: empresaId } });
      if (existingCount > 0) {
        logger.info(`Empresa ${empresaId} already has ${existingCount} PVs, skipping defaults`);
        continue;
      }
      for (const code of locationCodes) {
        await PuntoDeVenta.create({
          empresa_id: empresaId,
          code,
          name: locationNames[code] || code,
          is_active: true,
        });
      }
    }

    logger.info('PuntoDeVenta records ensured for all empresas');

    // El mapeo de `Stock` **ya no está acá**, y es a propósito.
    //
    // Lo resuelve la migración 14, que además de mapear por `code` cae al punto
    // de venta por defecto, consolida los duplicados y archiva lo que borra.
    // El seeder no puede hacer nada de eso: solo mapeaba lo que coincidía
    // exacto y dejaba el resto en `null`.
    //
    // Y no es que quede redundante: `Dockerfile:44` es
    // `node scripts/migrar.js && node src/server.js`, así que la migración
    // corre **antes** que el seeder en todos los arranques y no queda ninguna
    // fila de stock sin sucursal que mapear. Dejarlo sería una consulta por
    // boot cuyo único efecto es sugerirle a quien lea este archivo que el
    // seeder sigue mandando sobre el stock.
    //
    // Los tres de abajo se quedan: `sales`, `production_orders` y
    // `stock_transfers` **no** se migran (Fuera de alcance de la
    // funcionalidad 010) y siguen dependiendo de este mapeo.
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
    // Se loguea Y se relanza.
    //
    // Antes el catch se tragaba el error y el arranque seguía como si nada. El
    // alcance de ese catch son las 70 líneas enteras: un error mapeando `Sale`
    // dejaba sin mapear `ProductionOrder` y `StockTransfer`, y la API levantaba
    // con la mitad del trabajo hecho y ningún síntoma. Un seeder que falla a
    // medias y no avisa es peor que uno que no corre.
    //
    // El precio de esto es que un error acá tumba el arranque, que es lo
    // buscado: es preferible un contenedor que no levanta —y se ve— a uno que
    // levanta con datos a medio mapear.
    logger.error({ err }, 'Error in seedPuntosDeVenta');
    throw err;
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
