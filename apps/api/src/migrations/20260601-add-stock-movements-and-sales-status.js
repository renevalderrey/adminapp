'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // ── 1. stock_movements ──
    await queryInterface.createTable('stock_movements', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false },
      product_id: { type: Sequelize.INTEGER, allowNull: false },
      punto_de_venta_id: { type: Sequelize.INTEGER, allowNull: true },
      tipo: { type: Sequelize.STRING(30), allowNull: false },
      referencia_id: { type: Sequelize.STRING(40), allowNull: true },
      cantidad_anterior: { type: Sequelize.INTEGER, allowNull: false },
      cantidad_nueva: { type: Sequelize.INTEGER, allowNull: false },
      disponible_anterior: { type: Sequelize.INTEGER, allowNull: false },
      disponible_nuevo: { type: Sequelize.INTEGER, allowNull: false },
      usuario_id: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addConstraint('stock_movements', {
      fields: ['empresa_id'],
      type: 'foreign key',
      references: { table: 'empresas', field: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addConstraint('stock_movements', {
      fields: ['product_id'],
      type: 'foreign key',
      references: { table: 'products', field: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addConstraint('stock_movements', {
      fields: ['punto_de_venta_id'],
      type: 'foreign key',
      references: { table: 'puntos_de_venta', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addIndex('stock_movements', ['product_id']);
    await queryInterface.addIndex('stock_movements', ['empresa_id']);
    await queryInterface.addIndex('stock_movements', ['created_at']);

    // ── 2. sales: status, voided_at, voided_by ──
    await queryInterface.addColumn('sales', 'status', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'active',
    });
    await queryInterface.addColumn('sales', 'voided_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('sales', 'voided_by', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.addIndex('sales', ['status']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('sales', ['status']);
    await queryInterface.removeColumn('sales', 'voided_by');
    await queryInterface.removeColumn('sales', 'voided_at');
    await queryInterface.removeColumn('sales', 'status');
    await queryInterface.dropTable('stock_movements');
  },
};
