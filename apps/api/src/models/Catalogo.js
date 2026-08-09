// ════════════════════════════════════════════
//  FAVALIO · Modelo: Catalogo
//  La cara pública de una empresa: lo que ve quien escanea el QR.
//
//  ── Sin asociaciones declaradas, a propósito ──
//
//  Es el mismo criterio que `models/index.js` documenta para TiendaNube.
//  `analizarIncludes` de `aislamientoEmpresas.test.js` clasifica cualquier
//  `include` de una tabla asociada que tenga `empresa_id` como «hijo con
//  empresa_id», y el ancla de ese archivo cuenta exactamente tres. Declarar un
//  `hasMany` acá la movería sin que nadie haya escrito un `include`.
//
//  Las consultas que necesitan el punto de venta o los productos lo hacen con
//  su propio `where`, que además es lo que obliga a pensar el `empresa_id` cada
//  vez.
//
//  ── El ENUM va declarado ENUM ──
//
//  `DataTypes.ENUM` acá y `enum_catalogos_estado` en la migración, con los
//  mismos valores en el mismo orden. Si acá dijera STRING, el
//  `sync({ alter: true })` del arranque en desarrollo intentaría convertir la
//  columna y el job `navegador` del CI se caería.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Catalogo = sequelize.define('Catalogo', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // De esta sucursal sale el stock que se publica. `ON DELETE RESTRICT` en la
  // base: un catálogo sin punto de venta no sabe de dónde leer.
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

  // La dirección pública. Único GLOBAL, no por empresa: la URL lo es.
  slug: {
    type: DataTypes.STRING(60),
    allowNull: false,
  },
  nombre_visible: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // Rutas relativas `/img/aa/bb/…`, nunca absolutas: mudarse de dominio no
  // puede exigir migrar datos.
  logo_url: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  portada_url: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // El único color que define el comercio. El color del texto encima se
  // calcula por contraste, no se configura: dos colores configurables son dos
  // formas de que la tienda quede ilegible.
  color_marca: {
    type: DataTypes.STRING(7),
    allowNull: false,
    defaultValue: '#00B4B6',
  },

  // Por catálogo y no global: el pedido de Fitnet puede ir a un número y el de
  // otro socio a otro.
  whatsapp_destino: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  email_avisos: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  datos_transferencia: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },

  retiro_socio: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  retiro_socio_direccion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  retiro_local: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  envio: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  envio_costo: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  // ⚠ NULL o 0 significa «no hay envío gratis», nunca «todo gratis». Es la
  // clase de default que, leído al revés, regala el envío de cada pedido.
  envio_gratis_desde: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  coordinar_whatsapp: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },

  pide_nro_socio: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // Se crea y queda apagada, sin exponerse en el checkout, hasta que existan
  // los Términos y la Política de Privacidad.
  pide_dni: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },

  // El default seguro es NO publicar el margen: el precio tachado le muestra a
  // cualquiera con el enlace cuánto se descontó. Encenderlo es una decisión
  // consciente del comercio.
  mostrar_precio_lista: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // Se conserva y queda siempre en false: la pasarela es la etapa 3.
  mp_habilitado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },

  estado: {
    type: DataTypes.ENUM('borrador', 'publicado', 'pausado'),
    allowNull: false,
    defaultValue: 'borrador',
  },
  publicado_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'catalogos',
  indexes: [
    // El nombre es idéntico al de la migración, o `verificar-esquema.js` lo
    // reporta como faltante.
    { unique: true, name: 'uq_catalogo_slug', fields: ['slug'] },
    { name: 'idx_catalogo_empresa', fields: ['empresa_id'] },
    // Lo consulta la validación que rechaza desactivar una sucursal usada por
    // un catálogo publicado, y esa validación corre en CADA intento.
    { name: 'idx_catalogo_punto_de_venta', fields: ['punto_de_venta_id'] },
  ],
});

module.exports = Catalogo;
