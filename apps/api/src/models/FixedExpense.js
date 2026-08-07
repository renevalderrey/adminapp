// ════════════════════════════════════════════
//  ADMINAPP · Modelo: FixedExpense (Gasto Fijo)
//  Migra GF1[] y GF2[]
//  Campos originales: { n, v }
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FixedExpense = sequelize.define('FixedExpense', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  name: {
    type: DataTypes.STRING(150), // Campo "n" original
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2), // Campo "v" original
    allowNull: false,
    defaultValue: 0,
  },
  // ⚠ Columna muerta. Era «gf1» / «gf2», los dos bloques del legacy, y hoy no
  // significa nada: el agrupado sale de `punto_de_venta_id` (decisión 6 del
  // plan de la 014) y el cuerpo del request no la puede escribir (FR-031).
  //
  // **Se le saca el `defaultValue` y la columna se queda.** Borrarla no es
  // reversible y no gana nada — la misma decisión que la 013 tomó con
  // `products.tiendanube_variant_id`—, y el `DEFAULT 'gf1'` de la BASE sigue
  // puesto, así que un `create` sin `group` no viola el NOT NULL. Eso es lo
  // buscado: dato muerto con un valor cualquiera, no una fuente de
  // «null value in column "group"» el día del deploy.
  group: {
    type: DataTypes.STRING(10),
    allowNull: false,
  },
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'puntos_de_venta', key: 'id' },
  },
}, {
  tableName: 'fixed_expenses',
});

module.exports = FixedExpense;
