'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tiendanube_mappings', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false },
      product_id: { type: Sequelize.INTEGER, allowNull: false },
      tiendanube_variant_id: { type: Sequelize.INTEGER, allowNull: false },
      tiendanube_product_id: { type: Sequelize.INTEGER, allowNull: false },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // `field`, no `key`. addConstraint espera { table, field }; el que usa
    // { model, key } es la definicion de columna de addColumn. Con `key` esta
    // migracion tiraba "references object with table and field must be
    // specified" y cortaba la cadena: **una base nueva no se podia crear**.
    // El resto de las migraciones ya usaba la forma correcta.
    await queryInterface.addConstraint('tiendanube_mappings', {
      fields: ['empresa_id'],
      type: 'foreign key',
      references: { table: 'empresas', field: 'id' },
      onDelete: 'CASCADE',
    });

    await queryInterface.addConstraint('tiendanube_mappings', {
      fields: ['product_id'],
      type: 'foreign key',
      references: { table: 'products', field: 'id' },
      onDelete: 'CASCADE',
    });

    await queryInterface.addIndex('tiendanube_mappings', ['empresa_id', 'product_id'], {
      unique: true,
      name: 'uq_tn_mapping_product',
    });

    await queryInterface.addIndex('tiendanube_mappings', ['empresa_id', 'tiendanube_variant_id'], {
      unique: true,
      name: 'uq_tn_mapping_variant',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('tiendanube_mappings');
  },
};
