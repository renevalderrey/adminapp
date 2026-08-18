const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Suscripcion = sequelize.define('Suscripcion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  plan: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'free',
  },
  status: {
    type: DataTypes.ENUM('trialing', 'active', 'past_due', 'cancelled', 'expired'),
    allowNull: false,
    defaultValue: 'trialing',
  },
  trial_starts_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  trial_ends_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  grace_period_ends: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  stripe_customer_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  stripe_subscription_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  cancel_at_period_end: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  /**
   * El aviso de vencimiento mas chico que ya se envio, en dias. NULL = ninguno.
   *
   * Entero y no booleano porque hay dos avisos —DIAS_DE_AVISO = [5, 1]— y el
   * segundo tiene que salir aunque el primero ya haya salido. El cron manda el
   * de `dias` solo si esto es NULL o mayor que `dias`: la secuencia es
   * NULL -> 5 -> 1 y ninguno se repite.
   *
   * Sin esta columna, un trial se queda VEINTICUATRO HORAS dentro de su
   * ventana de aviso y el tick horario le manda el mismo correo cada vez.
   */
  aviso_vencimiento_enviado: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'suscripciones',
  indexes: [
    { unique: true, fields: ['empresa_id'] },
  ],
});

module.exports = Suscripcion;
