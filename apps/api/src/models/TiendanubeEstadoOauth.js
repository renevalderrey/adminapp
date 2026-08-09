// ════════════════════════════════════════════
//  FAVALIO · Modelo: TiendanubeEstadoOauth — el `state` del OAuth
//
//  Una fila por flujo de vinculación iniciado. El `state` es un token opaco de
//  un solo uso, guardado del lado del servidor (decisión 1 del usuario).
//
//  ── Por qué no es el `empresaId` en claro ni un HMAC ──
//
//  En claro, cualquiera completa un OAuth con `state=1` y le cuelga **su**
//  tienda a la empresa 1, que en producción es un cliente real. Es la misma
//  familia del `|| 1` que este código ya tuvo. Firmado con HMAC no hace falta
//  fila, pero **no protege contra reusar el mismo `state` dentro de su
//  ventana**: uno capturado del historial del navegador sirve tantas veces como
//  quepan en su vida.
//
//  ── El consumo NO es un findOne seguido de un update ──
//
//  Es un `UPDATE … SET consumido_en = NOW() WHERE token = $1 AND consumido_en IS
//  NULL AND expira_en > NOW() RETURNING empresa_id, usuario_id`. Dos callbacks
//  con el mismo `state` —el usuario recarga la pestaña de vuelta— pasan los dos
//  por un `findOne` y canjean el `code` dos veces; un `UPDATE` condicional es
//  atómico y la base decide quién gana. Sin eso, «de un solo uso» es una
//  intención y no una garantía. Es la lección del CAE y la de `POST /api/sales`.
//
//  Cero filas devueltas = el `state` no sirve, sin distinguir si no existe, si
//  venció o si ya se usó — lo mismo que hace `findScoped` al responder 404 y por
//  el mismo motivo: distinguirlos le dice a quien prueba tokens cuál de las tres
//  acertó. En el log sí se distingue.
//
//  Sin asociaciones, por el motivo escrito en `TiendanubeTienda.js`.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TiendanubeEstadoOauth = sequelize.define('TiendanubeEstadoOauth', {
  // 32 bytes de `crypto.randomBytes` en hexadecimal: 64 caracteres.
  token: {
    type: DataTypes.STRING(64),
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // Quién inició el flujo. Mismo tipo que `stock_movements.usuario_id`: es el
  // `sub` de Auth0, no un entero.
  usuario_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  expira_en: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  consumido_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'tiendanube_estados_oauth',
  // La fila se escribe una vez y se consume una vez, y `consumido_en` ya dice
  // cuándo fue eso. La migración no crea `updated_at`: si el modelo lo declarara,
  // el `findOne` de `verificar-esquema.js` fallaría con «column does not exist».
  updatedAt: false,
  indexes: [
    // `name` explícito e idéntico al de la migración. Sequelize lo nombraría
    // `tiendanube_estados_oauth_expira_en` y un `sync({ alter: true })` en
    // desarrollo crearía un SEGUNDO índice sobre la misma columna.
    //
    // Es el único que hace falta: la lectura del callback es por la PK. Éste es
    // para el barrido diario de vencidos, sin el cual la tabla crece para
    // siempre.
    { name: 'idx_tn_estados_expira', fields: ['expira_en'] },
  ],
});

module.exports = TiendanubeEstadoOauth;
