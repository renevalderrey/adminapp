'use strict';

/**
 * sales: `afip_ultimo_error`, `afip_ultimo_intento` e índice (empresa_id, date).
 *
 * ── El problema ──
 *
 * Cuando AFIP rechaza una factura, el error se loguea y se devuelve en la
 * respuesta HTTP, pero no se guarda en ningún lado. Si el operador cierra la
 * pestaña, se perdió: la venta queda como `status = 'active'` con
 * `afip_cae = NULL`, que es exactamente lo mismo que una venta interna hecha a
 * propósito. No hay forma de distinguir «no se facturó porque no se quiso» de
 * «no se facturó porque ARCA la rechazó».
 *
 * Estas dos columnas son la única diferencia entre esos dos estados. Sin ellas
 * no existe el estado «Rechazada», y sin ese estado no hay nada que reintentar
 * ni nada que avisarle al usuario cuando vuelve al día siguiente.
 *
 * ── Por qué TEXT y no VARCHAR(255) ──
 *
 * El mensaje que se guarda es el que arma `afipService`, y ya trae un
 * JSON.stringify adentro (`afipService.js:286` y `:291`). Un rechazo con dos
 * observaciones pasa los 255 caracteres con facilidad, y lo que queda cortado
 * es el final, que es donde está el código del rechazo — el único pedazo
 * accionable. El requisito es mostrar el mensaje de AFIP tal cual; truncarlo
 * es incumplirlo.
 *
 * ── El índice ──
 *
 * La consulta del historial es siempre `empresa_id = X AND date BETWEEN a AND
 * b`. Hoy hay índices sueltos sobre `date` y sobre `empresa_id`: con ellos
 * separados Postgres elige uno y filtra el resto fila por fila. El compuesto
 * ataca las dos condiciones a la vez. Los sueltos se dejan: sacarlos es una
 * migración destructiva sobre una tabla caliente.
 *
 * ── El histórico ──
 *
 * Las dos columnas quedan en NULL para todas las ventas existentes. Eso
 * significa que toda venta activa sin CAE anterior a esta migración se muestra
 * como «Registrada», nunca como «Rechazada». Es correcto: no hay forma de
 * saber cuáles de esas fallaron, y adivinar sobre una obligación fiscal es
 * peor que no saber. No hay UPDATE de histórico: es aditiva y ninguna fila se
 * toca.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales', 'afip_ultimo_error', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('sales', 'afip_ultimo_intento', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex('sales', ['empresa_id', 'date'], {
      name: 'sales_empresa_date_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sales', 'sales_empresa_date_idx');
    await queryInterface.removeColumn('sales', 'afip_ultimo_intento');
    await queryInterface.removeColumn('sales', 'afip_ultimo_error');
  },
};
