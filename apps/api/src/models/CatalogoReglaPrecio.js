// ════════════════════════════════════════════
//  FAVALIO · Modelo: CatalogoReglaPrecio
//  Cuatro ámbitos, tres columnas anulables y una FK por cada una.
//
//  Sin asociaciones declaradas, por el motivo escrito en `models/index.js`:
//  `analizarIncludes` clasificaría cualquier `include` como «hijo con
//  empresa_id» y movería un ancla que existe para no moverse.
//
//  ── Por qué tres columnas y no una `ambito_valor` polimórfica ──
//
//  Una columna que guarda «texto de categoría o brand_id o product_id» **no
//  puede tener clave foránea**. Sin FK, borrar una marca deja una regla
//  apuntando a un número que ya no existe. Con tres columnas cada una tiene la
//  suya y el motor las respeta: borrar el producto borra la regla; borrar la
//  marca deja `brand_id` en NULL y la regla queda «no alcanza a nadie».
//
//  Los cuatro índices únicos PARCIALES de la migración son los que garantizan
//  que un producto tenga como mucho **cuatro candidatas, una por ámbito**: por
//  eso «gana la más específica» no tiene empates que desempatar.
//
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CatalogoReglaPrecio = sequelize.define('CatalogoReglaPrecio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  // Está para que `findScoped(CatalogoReglaPrecio, id, empresaId)` funcione
  // directo en el ABM, sin tener que pasar por el catálogo.
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  catalogo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

  ambito: {
    type: DataTypes.ENUM('catalogo', 'categoria', 'marca', 'producto'),
    allowNull: false,
  },
  // Texto libre, como `products.category`: no hay tabla de categorías.
  categoria: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  brand_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },

  tipo: {
    type: DataTypes.ENUM('porcentaje_descuento', 'monto_descuento', 'precio_fijo'),
    allowNull: false,
  },
  valor: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  // Una regla desactivada se comporta como si no existiera. Es distinto de
  // borrarla: se puede volver a encender sin recordar qué decía.
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'catalogo_reglas_precio',
  indexes: [
    { name: 'idx_regla_empresa', fields: ['empresa_id'] },
  ],
});

module.exports = CatalogoReglaPrecio;
