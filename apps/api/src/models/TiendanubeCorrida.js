// ════════════════════════════════════════════
//  ADMINAPP · Modelo: TiendanubeCorrida
//  El registro de las corridas EXPLÍCITAS de sincronización
//
//  Una fila por corrida **manual** —el botón— o de **reconciliación** —el cron
//  diario—. Es lo que contesta «el resultado de la última corrida», que el
//  pedido nombra explícitamente y que hoy no tiene dónde leerse.
//
//  ── El empujón por movimiento de stock NO escribe acá ──
//
//  Se sincroniza ante cada movimiento (decisión 4 del usuario), y eso puede
//  pasar cientos de veces por día: registrarlo acá produciría cientos de filas
//  diarias que nadie lee y que crecen sin tope. El estado de ese empujón vive en
//  la fila de la variante (`pendiente_desde`, `intentos`, `ultimo_error`), que
//  además es **más útil**: dice qué está desfasado ahora, no qué pasó en un lote.
//
//  ── `disparador` es VARCHAR con CHECK y no un ENUM, deliberadamente ──
//
//  El proyecto 0 de `PROXIMOS-PROYECTOS.md` dejó ocho columnas declaradas `ENUM`
//  en el modelo y creadas `VARCHAR` por las migraciones, y ese desajuste sigue
//  abierto: `sync({ alter: true })` en desarrollo muere en `products.unit_type`
//  antes de llegar a cualquier otra cosa. Agregar un `ENUM` nuevo es agregarle
//  una novena columna a ese problema. Acá el modelo dice `STRING(20)` y la
//  migración crea `VARCHAR(20)` con un `CHECK`: los dos archivos dicen lo mismo.
//
//  Sin asociaciones, por el motivo escrito en `TiendanubeTienda.js`.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/** Los dos únicos disparadores. El `CHECK` de la migración dice lo mismo. */
const DISPARADORES = ['manual', 'reconciliacion'];

const TiendanubeCorrida = sequelize.define('TiendanubeCorrida', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  empezada_en: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  // `NULL` = la corrida se cortó por la mitad. Es un estado que hay que poder
  // distinguir de «terminó con cero fallas»: el arriendo de
  // `tiendanube_tiendas.sincronizando_desde` vence a los diez minutos y la
  // pantalla tiene que poder decir qué pasó con la que no terminó.
  terminada_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  disparador: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: { isIn: [DISPARADORES] },
  },
  // Quién apretó el botón. `NULL` en la reconciliación, que no la aprieta nadie.
  usuario_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  mandadas: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  fallidas: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // `[{ variante, sku, motivo }]`, y **solo las que fallaron**: con un catálogo
  // grande, las que salieron bien son cientos de entradas que nadie lee.
  fallas: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'tiendanube_corridas',
  // Una fila se escribe al empezar y se cierra al terminar, y las dos fechas ya
  // dicen cuándo fue eso. La migración no crea `updated_at`.
  updatedAt: false,
  indexes: [
    // La pantalla pide **la última**: un `ORDER BY empezada_en DESC LIMIT 1` que
    // este índice resuelve sin leer la tabla. `name` explícito e idéntico al de
    // la migración, como los demás.
    { name: 'idx_tn_corridas_empresa', fields: ['empresa_id', 'empezada_en'] },
  ],
});

TiendanubeCorrida.DISPARADORES = DISPARADORES;

module.exports = TiendanubeCorrida;
