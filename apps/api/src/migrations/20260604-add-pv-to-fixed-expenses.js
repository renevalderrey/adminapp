'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('fixed_expenses', 'punto_de_venta_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'puntos_de_venta', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addIndex('fixed_expenses', ['punto_de_venta_id'], {
      name: 'idx_fixed_expenses_pv',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('fixed_expenses', 'idx_fixed_expenses_pv');
    await queryInterface.removeColumn('fixed_expenses', 'punto_de_venta_id');
  },
};
