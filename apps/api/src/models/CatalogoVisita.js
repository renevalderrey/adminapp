// ════════════════════════════════════════════
//  FAVALIO · Modelo: CatalogoVisita
//  El contador agregado del QR: una fila por día, no una por visita.
//
//  Sin asociaciones declaradas, por el motivo escrito en `models/index.js`:
//  `analizarIncludes` clasificaría cualquier `include` como «hijo con
//  empresa_id» y movería un ancla que existe para no moverse.
//
//  ── Lo que esta tabla no puede guardar ──
//
//  No hay IP, ni cookie, ni identificador de dispositivo. Contar no es
//  rastrear, y la tabla no tiene dónde poner un dato del visitante aunque
//  alguien quisiera. Es diseño, no omisión.
//
//  `estado_catalogo` es parte de la clave única para poder separar las visitas
//  que ocurrieron con el catálogo pausado: sin eso, una conversión en cero
//  durante una semana de pausa se lee como «la tienda no funciona».
//
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CatalogoVisita = sequelize.define('CatalogoVisita', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  catalogo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // La del negocio, con `fechaDelNegocio(zona)`: `toISOString()` manda una
  // visita de las 21:30 al día siguiente.
  fecha: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  origen: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'directo',
  },
  estado_catalogo: {
    type: DataTypes.ENUM('publicado', 'pausado', 'no_disponible'),
    allowNull: false,
  },
  cantidad: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'catalogo_visitas',
  indexes: [
    { unique: true, name: 'uq_visita', fields: ['catalogo_id', 'fecha', 'origen', 'estado_catalogo'] },
  ],
});

module.exports = CatalogoVisita;
