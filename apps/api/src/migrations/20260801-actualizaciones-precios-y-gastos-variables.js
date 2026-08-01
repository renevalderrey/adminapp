'use strict';

// ════════════════════════════════════════════
//  Dos tablas que faltaban para cerrar la paridad con el sistema anterior:
//
//   - actualizaciones_precios: la foto previa a cada cambio de precios en
//     masa. Sin ella no hay "deshacer", y una actualizacion mal aplicada
//     sobre doscientos productos no tiene vuelta atras.
//   - gastos_variables: gastos por persona y por mes. Los fijos ya tenian
//     tabla; estos no, y se cargaban en el sistema viejo todos los meses.
// ════════════════════════════════════════════

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('actualizaciones_precios', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false },
      modo: { type: Sequelize.STRING(20), allowNull: false },
      valor: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      descripcion: { type: Sequelize.STRING(200), allowNull: true },
      usuario: { type: Sequelize.STRING(120), allowNull: true },
      cantidad_productos: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },

      // JSONB y no TEXT: permite consultar por producto adentro del historial
      // sin traerse todas las filas al proceso.
      cambios: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },

      revertida: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      revertida_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addConstraint('actualizaciones_precios', {
      fields: ['empresa_id'],
      type: 'foreign key',
      references: { table: 'empresas', field: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addIndex('actualizaciones_precios', ['empresa_id', 'created_at'], {
      name: 'idx_actualizaciones_empresa_fecha',
    });

    await queryInterface.createTable('gastos_variables', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false },
      persona: { type: Sequelize.STRING(120), allowNull: false },
      mes: { type: Sequelize.STRING(7), allowNull: false },
      nombre: { type: Sequelize.STRING(150), allowNull: false },
      monto: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      punto_de_venta_id: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addConstraint('gastos_variables', {
      fields: ['empresa_id'],
      type: 'foreign key',
      references: { table: 'empresas', field: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addConstraint('gastos_variables', {
      fields: ['punto_de_venta_id'],
      type: 'foreign key',
      references: { table: 'puntos_de_venta', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addIndex('gastos_variables', ['empresa_id', 'mes'], {
      name: 'idx_gastos_variables_empresa_mes',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('gastos_variables');
    await queryInterface.dropTable('actualizaciones_precios');
  },
};
