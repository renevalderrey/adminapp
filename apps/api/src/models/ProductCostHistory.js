const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProductCostHistory = sequelize.define('ProductCostHistory', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  change_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  old_cost: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  new_cost: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  reason: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  // Quien hizo el cambio (FR-108). INTEGER contra `usuarios.id` y no el `sub`
  // de Auth0: `StockMovement.usuario_id` es STRING(255) y tiene guardado el
  // literal 'tiendanube', o sea una columna que significa "id de usuario, o lo
  // que sea". Esa no se puede juntar con `usuarios` y no puede contestar quien.
  //
  // Nulo a proposito: las filas anteriores a la migracion 15 no tienen autor y
  // ese dato no se puede inferir. La pantalla lo muestra como dato viejo, no
  // como error.
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // De que empresa es la fila (FR-109). Sin esta columna, toda consulta que no
  // pase por `products` para filtrar es una consulta sin scoping.
  //
  // Nulo a proposito: el backfill la deja vacia para las filas cuyo producto ya
  // no existe, y obligarla seria inventar de que empresa era un producto
  // borrado.
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'product_cost_history',
  // Esta lista describe lo que la base TIENE, no lo que convendria tener: los
  // tres primeros los creo `20260531-initial-schema.js` y el compuesto lo crea
  // la migracion 15. Un modelo que declara un indice que nadie aplico se lee
  // como si fuera cierto y hace diagnosticar mal el problema siguiente — es
  // exactamente lo que paso con el unico de `Stock`.
  indexes: [
    { fields: ['product_id'] },
    { fields: ['change_date'] },
    { fields: ['empresa_id', 'change_date'] },
  ],
});

module.exports = ProductCostHistory;
