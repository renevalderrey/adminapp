'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('products', 'tiendanube_variant_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addIndex('products', ['tiendanube_variant_id'], {
      name: 'idx_products_tiendanube_variant',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('products', 'idx_products_tiendanube_variant');
    await queryInterface.removeColumn('products', 'tiendanube_variant_id');
  },
};
