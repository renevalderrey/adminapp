'use strict';

// ════════════════════════════════════════════
//  Operador de la plataforma
//
//  El modelo de permisos es por empresa: un usuario tiene un rol dentro de una
//  empresa y no existe nada por encima. Hace falta un nivel mas para quien
//  desarrolla y da soporte: poder entrar a la empresa de cualquier cliente y
//  ver los modulos que todavia no se liberaron.
//
//  Arranca en false para todos. Se activa solo con scripts/superadmin.js.
// ════════════════════════════════════════════

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('usuarios', 'es_superadmin', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Indice parcial: los superadmin son dos o tres sobre miles de usuarios, y
    // la consulta que importa es "traeme los superadmin". Un indice sobre toda
    // la columna seria casi todo filas en false.
    await queryInterface.sequelize.query(
      'CREATE INDEX idx_usuarios_superadmin ON usuarios (id) WHERE es_superadmin = true'
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_usuarios_superadmin');
    await queryInterface.removeColumn('usuarios', 'es_superadmin');
  },
};
