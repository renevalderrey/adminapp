'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('usuario_empresas');
    if (tableInfo.role.type === 'ENUM') {
      await queryInterface.changeColumn('usuario_empresas', 'role', {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'vendedor',
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('usuario_empresas', 'role', {
      type: Sequelize.ENUM('admin', 'vendedor', 'produccion', 'compras', 'gerente'),
      allowNull: false,
      defaultValue: 'vendedor',
    });
  },
};
