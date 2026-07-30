'use strict';

/**
 * settings: la clave primaria pasa de (key) a (key, empresa_id).
 *
 * ── El problema ──
 *
 * La tabla se creo con `key` como unica clave primaria y `empresa_id` como
 * columna comun con default 1. Eso significa que solo puede existir UNA fila
 * por clave en toda la base, compartida por todas las empresas cliente.
 *
 * Para la configuracion de AFIP el efecto es grave: afip_cuit, afip_cert,
 * afip_key y afip_environment son una sola fila global. routes/afip.js hacia
 * Setting.upsert({ key: 'afip_cert', ... }) sin empresa_id, con lo cual la
 * segunda empresa que cargaba su certificado pisaba el de la primera. A partir
 * de ahi, las facturas de la primera empresa salian firmadas con el
 * certificado y el CUIT de la segunda.
 *
 * Ademas afip_environment era global: una empresa pasando a produccion movia a
 * todas las demas.
 *
 * ── La migracion ──
 *
 * Con la PK compuesta cada empresa tiene su propia fila por clave. Las filas
 * existentes conservan su empresa_id (default 1), asi que la configuracion
 * actual queda asignada a la empresa 1.
 *
 * Se quita el default 1 de empresa_id: era el que permitia insertar sin decir
 * de que empresa es la configuracion.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      // Postgres nombra la PK como <tabla>_pkey.
      await queryInterface.removeConstraint('settings', 'settings_pkey', { transaction });

      await queryInterface.changeColumn('settings', 'empresa_id', {
        type: Sequelize.INTEGER,
        allowNull: false,
      }, { transaction });

      await queryInterface.addConstraint('settings', {
        fields: ['key', 'empresa_id'],
        type: 'primary key',
        name: 'settings_pkey',
        transaction,
      });

      // Las lecturas siempre filtran por empresa_id.
      await queryInterface.addIndex('settings', ['empresa_id'], {
        name: 'settings_empresa_id_idx',
        transaction,
      });
    });
  },

  async down(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('settings', 'settings_empresa_id_idx', { transaction });
      await queryInterface.removeConstraint('settings', 'settings_pkey', { transaction });

      // Revertir exige que no haya claves repetidas entre empresas. Si dos
      // empresas cargaron la misma clave, este paso falla a proposito: elegir
      // cual sobrevive es una decision de negocio, no de la migracion.
      await queryInterface.addConstraint('settings', {
        fields: ['key'],
        type: 'primary key',
        name: 'settings_pkey',
        transaction,
      });

      await queryInterface.changeColumn('settings', 'empresa_id', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      }, { transaction });
    });
  },
};
