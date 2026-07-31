'use strict';

/**
 * sales: nueva columna `is_credit`.
 *
 * ── El problema ──
 *
 * No había forma de saber si una venta se cobró en el momento o quedó en la
 * cuenta corriente del cliente. El código lo deducía de `customer_id`: TODA
 * venta con cliente asignado contaba como deuda hasta que alguien registrara
 * un pago a mano.
 *
 * Pero en el mostrador lo normal es identificar al cliente y cobrarle igual en
 * el acto —para el historial de compras, para la factura, para el programa de
 * fidelidad—. Con la regla anterior, cada una de esas ventas quedaba como
 * deuda impaga: los saldos de cuenta corriente estaban inflados con
 * operaciones ya cobradas, y el "por cobrar" del tablero no servía.
 *
 * ── La decisión ──
 *
 * Las ventas son al contado salvo que se marquen explícitamente como cuenta
 * corriente. El default `false` refleja el caso normal.
 *
 * ── El histórico ──
 *
 * Las ventas anteriores a esta migración quedan todas en `false`, o sea al
 * contado. Es lo correcto para la mayoría, pero significa que una deuda real
 * ya cargada desaparece del saldo del cliente.
 *
 * No se puede distinguir automáticamente: `customer_id` no alcanza, que es
 * justamente el problema que esta columna viene a resolver. Quien tenga cuentas
 * corrientes en uso tiene que marcar a mano las ventas impagas:
 *
 *   UPDATE sales SET is_credit = true
 *   WHERE empresa_id = <id> AND customer_id IS NOT NULL AND date >= '<fecha>';
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales', 'is_credit', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Las consultas de cuenta corriente filtran por empresa + credito + cliente.
    await queryInterface.addIndex('sales', ['empresa_id', 'is_credit'], {
      name: 'sales_empresa_is_credit_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sales', 'sales_empresa_is_credit_idx');
    await queryInterface.removeColumn('sales', 'is_credit');
  },
};
