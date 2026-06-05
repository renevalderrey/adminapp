const { sequelize } = require('./src/models');
async function run() {
  await sequelize.authenticate();
  await sequelize.query("DROP INDEX IF EXISTS uq_usuario_permisos");
  await sequelize.query("DROP INDEX IF EXISTS usuario_permisos_usuario_empresa_id_punto_de_venta_id_permiso_codigo");
  await sequelize.query('DROP INDEX IF EXISTS "usuario_permisos_usuario_empresa_id_punto_de_venta_id_permiso_c"');
  console.log('Dropped old indexes');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
