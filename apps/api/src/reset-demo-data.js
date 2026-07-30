/**
 * Script para limpiar datos de demo y dejar la base lista para un cliente real.
 *
 * Uso: node src/reset-demo-data.js
 *
 * Lo que hace:
 * 1. Elimina empresa 2 ("Mi empresa SRL") y todos sus datos asociados
 * 2. Elimina productos, stock, ventas, clientes, proveedores, etc. de prueba
 * 3. Reinicia secuencias de IDs
 * 4. Deja: 1 empresa + 1 usuario admin + estructura vacía
 */

require('dotenv').config();
const { sequelize } = require('./models');
const logger = require('./utils/logger');

async function resetDemoData() {
  const t = await sequelize.transaction();
  try {
    // 1. Desvincular usuario dev de empresa 2
    logger.info('Removing dev user from empresa 2...');
    await sequelize.query(
      `DELETE FROM usuario_empresas WHERE empresa_id = 2`,
      { transaction: t }
    );

    // 2. Eliminar datos de la empresa 2
    logger.info('Deleting empresa 2 and all its data...');
    const tables = [
      'stock_transfers', 'production_order_items', 'production_orders',
      'sale_items', 'sales', 'customer_payments', 'customers',
      'recipe_items', 'recipes', 'product_cost_history',
      'stock', 'products', 'supplier_documents', 'supplier_movements',
      'supplier_orders', 'suppliers', 'brands',
      'cashflow_entries', 'tax_payments', 'tax_configs', 'fixed_expenses',
      'puntos_de_venta', 'suscripciones', 'invitaciones',
    ];
    for (const table of tables) {
      await sequelize.query(
        `DELETE FROM "${table}" WHERE empresa_id = 2`,
        { transaction: t }
      );
    }
    await sequelize.query(
      `DELETE FROM empresas WHERE id = 2`,
      { transaction: t }
    );

    // 3. Limpiar datos de demo de la empresa 1 (dejar estructura vacía)
    logger.info('Cleaning demo data from empresa 1...');
    for (const table of tables) {
      await sequelize.query(
        `DELETE FROM "${table}" WHERE empresa_id = 1`,
        { transaction: t }
      );
    }

    // 4. Limpiar registros huérfanos sin empresa
    await sequelize.query(`DELETE FROM usuario_permisos`, { transaction: t });
    await sequelize.query(`DELETE FROM rol_permisos`, { transaction: t });
    await sequelize.query(`DELETE FROM roles WHERE empresa_id IS NOT NULL`, { transaction: t });
    await sequelize.query(`DELETE FROM permisos`, { transaction: t });
    await sequelize.query(`DELETE FROM settings`, { transaction: t });

    // 5. Resetear secuencias
    logger.info('Resetting sequences...');
    const seqTables = [
      'brands', 'products', 'stock', 'customers', 'customer_payments',
      'suppliers', 'supplier_orders', 'supplier_movements', 'supplier_documents',
      'production_orders', 'production_order_items', 'stock_transfers',
      'cashflow_entries', 'tax_configs', 'tax_payments', 'fixed_expenses',
      'puntos_de_venta', 'recipe_items', 'usuario_permisos', 'rol_permisos',
    ];
    for (const table of seqTables) {
      await sequelize.query(
        `ALTER SEQUENCE "${table}_id_seq" RESTART WITH 1`,
        { transaction: t }
      ).catch(() => {}); // algunas tablas no tienen secuencia
    }

    await t.commit();
    logger.info('Demo data reset complete!');
    logger.info('Database is clean and ready for a real client.');
    logger.info('Empresa 1 is active with your admin user.');
    logger.info('');
    logger.info('Next step:');
    logger.info('  1. Restart the server');
    logger.info('  2. Download the import templates: GET /api/import/template/products');
    logger.info('  3. Upload client data: POST /api/import/products (file upload)');

    process.exit(0);
  } catch (err) {
    await t.rollback();
    logger.error({ err }, 'Reset failed');
    process.exit(1);
  }
}

resetDemoData();
