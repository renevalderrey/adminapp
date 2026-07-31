'use strict';

/**
 * sales: nueva columna `afip_pv`.
 *
 * ── El problema ──
 *
 * La venta guardaba el CAE, el número y el tipo de comprobante, pero no el
 * punto de venta de AFIP con el que se emitió. Ese dato hace falta para
 * identificar un comprobante: la numeración de AFIP es correlativa POR PUNTO
 * DE VENTA, así que el número solo no alcanza.
 *
 * Consecuencias de no tenerlo:
 *  - La reimpresión desde el historial usaba el punto de venta 1, fijo.
 *  - La verificación contra AFIP usaba el punto de venta configurado HOY. Si
 *    el comercio lo cambia, los comprobantes anteriores dejan de poder
 *    consultarse.
 *  - El QR obligatorio lleva `ptoVta` entre sus datos: sin el valor real, el
 *    QR de un comprobante reimpreso apunta a otro comprobante.
 *
 * ── El histórico ──
 *
 * Las ventas anteriores quedan con `afip_pv` en NULL. No se puede inferir cuál
 * fue: sería adivinar. Para las que ya tienen CAE conviene completarlo a mano
 * con el punto de venta que el comercio estaba usando en esa fecha:
 *
 *   UPDATE sales SET afip_pv = <pv>
 *   WHERE empresa_id = <id> AND afip_cae IS NOT NULL AND afip_pv IS NULL;
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales', 'afip_pv', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('sales', 'afip_pv');
  },
};
