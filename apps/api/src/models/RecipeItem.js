const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RecipeItem = sequelize.define('RecipeItem', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  recipe_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  ingredient_product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  quantity: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
  },
}, {
  tableName: 'recipe_items',
  indexes: [
    { fields: ['recipe_id'] },
    { fields: ['ingredient_product_id'] },
  ],
});

module.exports = RecipeItem;
