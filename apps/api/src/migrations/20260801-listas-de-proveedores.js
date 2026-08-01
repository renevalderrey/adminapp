'use strict';

// ════════════════════════════════════════════
//  Listas de precios de proveedores, para el comparador.
//
//  Es la ultima funcion del sistema anterior que faltaba: cargar las listas de
//  varios proveedores y ver quien tiene cada producto mas barato.
// ════════════════════════════════════════════

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('listas_proveedores', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false },
      supplier_id: { type: Sequelize.INTEGER, allowNull: true },
      nombre: { type: Sequelize.STRING(150), allowNull: false },
      fecha: { type: Sequelize.DATEONLY, allowNull: false },
      items: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      activa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addConstraint('listas_proveedores', {
      fields: ['empresa_id'],
      type: 'foreign key',
      references: { table: 'empresas', field: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });

    // SET NULL y no CASCADE: si se borra el proveedor del sistema, la lista de
    // precios sigue siendo un dato historico util.
    await queryInterface.addConstraint('listas_proveedores', {
      fields: ['supplier_id'],
      type: 'foreign key',
      references: { table: 'suppliers', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addIndex('listas_proveedores', ['empresa_id', 'activa'], {
      name: 'idx_listas_proveedores_empresa_activa',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('listas_proveedores');
  },
};
