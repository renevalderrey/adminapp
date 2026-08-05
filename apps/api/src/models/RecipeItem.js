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
    // ── Un insumo aparece UNA vez por receta ──
    //
    // Sin esto, nada impedía que una receta listara el mismo insumo dos veces, y
    // `costService.calculateProductCost` recorre TODOS los ítems sumando
    // `cantidad × costo`: el insumo repetido se contaba dos veces y el elaborado
    // quedaba costeado de más, en silencio. De ese costo salen el margen que
    // muestra el POS y el precio que recomienda el Comparador, así que el número
    // que el usuario cree estaba mal y no fallaba nada.
    //
    // No era hipotético: es la razón por la que uno de los dos defectos de
    // diamante del hito 6 era determinístico en vez de depender del orden de las
    // filas que devolvía Postgres.
    //
    // El `name` va explícito y es el MISMO de la migración
    // `20260809-unico-de-insumo-por-receta`. Sequelize nombraría este índice
    // `recipe_items_recipe_id_ingredient_product_id`, así que sobre una base
    // creada por migraciones un `sync({ alter: true })` en desarrollo crearía un
    // SEGUNDO índice único sobre las mismas dos columnas. Lo compara
    // `tests/unicoDeInsumoPorReceta.test.js`.
    {
      name: 'idx_recipe_items_recipe_ingredient',
      unique: true,
      fields: ['recipe_id', 'ingredient_product_id'],
    },
  ],
});

module.exports = RecipeItem;
