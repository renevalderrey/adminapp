require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../src/models');

const EMPRESA_ID = 1;

async function main() {
  console.log('Cleaning all data for empresa_id =', EMPRESA_ID);

  // Tier 1: Deepest children
  console.log('  Tier 1: recipe_items, production_order_items, sale_items...');
  await sequelize.query('DELETE FROM recipe_items WHERE recipe_id IN (SELECT id FROM recipes WHERE empresa_id = $1)', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM production_order_items WHERE production_order_id IN (SELECT id FROM production_orders WHERE empresa_id = $1)', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE empresa_id = $1)', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM product_cost_history WHERE product_id IN (SELECT id FROM products WHERE empresa_id = $1)', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM customer_payments WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM supplier_orders WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM supplier_movements WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM supplier_documents WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM rol_permisos WHERE rol_id IN (SELECT id FROM roles WHERE empresa_id = $1)', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM usuario_permisos WHERE usuario_empresa_id IN (SELECT id FROM usuario_empresas WHERE empresa_id = $1)', { bind: [EMPRESA_ID] });

  // Tier 2: Intermediate
  console.log('  Tier 2: stock_movements, stock, transfers, cashflow, fixed_expenses, sales...');
  await sequelize.query('DELETE FROM stock_movements WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM stock WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM stock_transfers WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM cashflow_entries WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM fixed_expenses WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM sales WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM production_orders WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM recipes WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM tiendanube_mappings WHERE empresa_id = $1', { bind: [EMPRESA_ID] });

  // Tier 3: Business parents
  console.log('  Tier 3: products, customers, puntos_de_venta, brands, suppliers...');
  await sequelize.query('DELETE FROM products WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM customers WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM puntos_de_venta WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM brands WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM suppliers WHERE empresa_id = $1', { bind: [EMPRESA_ID] });

  // Tier 4: Single-dependency
  console.log('  Tier 4: invitaciones, suscripciones, settings, tax_configs, tax_payments, roles...');
  await sequelize.query('DELETE FROM invitaciones WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM suscripciones WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM settings WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM tax_configs WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM tax_payments WHERE empresa_id = $1', { bind: [EMPRESA_ID] });
  await sequelize.query('DELETE FROM roles WHERE empresa_id = $1', { bind: [EMPRESA_ID] });

  // Tier 5: User-empresa association
  console.log('  Tier 5: usuario_empresas...');
  const { rowCount: ueCount } = await sequelize.query('DELETE FROM usuario_empresas WHERE empresa_id = $1', { bind: [EMPRESA_ID] });

  // Also delete the user if they only belong to this empresa
  console.log('  Checking users...');
  const orphanedUsers = await sequelize.query(
    `SELECT u.id, u.auth0_sub, u.email FROM usuarios u 
     WHERE u.id NOT IN (SELECT usuario_id FROM usuario_empresas)`,
    { type: sequelize.QueryTypes.SELECT }
  );
  for (const u of orphanedUsers) {
    console.log(`  Deleting orphaned user: ${u.email} (${u.auth0_sub})`);
    await sequelize.query('DELETE FROM usuarios WHERE id = $1', { bind: [u.id] });
  }

  // Tier 6: Root
  console.log('  Tier 6: empresas...');
  await sequelize.query('DELETE FROM empresas WHERE id = $1', { bind: [EMPRESA_ID] });

  console.log('\n✅ Database cleaned successfully');
  await sequelize.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  sequelize.close().then(() => process.exit(1));
});
