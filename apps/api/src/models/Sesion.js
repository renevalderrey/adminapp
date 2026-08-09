// ════════════════════════════════════════════
//  FAVALIO · Modelo: Sesion
//  Una fila por (usuario, dispositivo). NO por empresa.
//
//  ── Qué es un «dispositivo» acá ──
//
//  Un UUID v4 que el navegador genera **una vez**, guarda en `localStorage` y
//  manda en la cabecera `X-Sesion-Id`. No es el token ni deriva de él: Auth0 rota
//  el access token cada pocas horas, así que identificar la sesión con su hash
//  abriría una fila nueva en cada rotación, la lista mostraría siete filas del
//  mismo navegador, y cerrar una no serviría porque la rotación siguiente vuelve
//  a entrar.
//
//  ── ⚠ Sin `empresa_id`, a propósito ──
//
//  Una sesión es de una persona y su dispositivo; esa persona puede cambiar de
//  empresa con el selector sin cerrar nada. Poner `empresa_id` obligaría a elegir
//  cuál —¿la de cuando entró?— y quedaría mintiendo en cuanto use el selector.
//
//  El aislamiento sale de la membresía, encapsulado en
//  `services/sesionesService.js`: listar y cerrar pasan por
//  `usuario_id IN (SELECT usuario_id FROM usuario_empresas WHERE empresa_id = :id
//  AND is_active = true)`. Una sesión ajena da cero filas y **404**, igual que
//  `findScoped`.
//
//  Consecuencia, y la pantalla la dice con esas palabras: cerrar una sesión la
//  cierra en **todas** las empresas a las que esa persona tenga acceso.
//
//  ── El techo ──
//
//  Sin la Management API de Auth0 no se revoca un token. Esto cierra al navegador
//  que **coopera**: recibe 401, borra su identificador y vuelve al login. El corte
//  de verdad es `usuario_empresas.is_active = false`, que `loadEmpresaContext`
//  relee en cada request.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Sesion = sequelize.define('Sesion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // `STRING(64)` y no `UUID`: el valor lo elige el cliente y el servidor no lo
  // interpreta. Declararlo `UUID` haría que un valor cualquiera reviente el
  // INSERT con un error de tipo en el camino de TODOS los requests, en vez de
  // quedar guardado como el texto opaco que es.
  dispositivo: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  // Crudo. La etiqueta —«computadora» / «celular»— la deriva
  // `utils/dispositivo.js`, que es una función pura: se puede corregir sin
  // migrar un solo dato.
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // 45 = un IPv6 con notación mixta (`::ffff:192.168.0.1`) entra entero.
  ip: {
    type: DataTypes.STRING(45),
    allowNull: true,
  },
  iniciada_en: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  // El último acceso. Se actualiza **como mucho cada cinco minutos** (FR-124):
  // un UPDATE por request convertiría cada lectura en una escritura.
  vista_en: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  // `NULL` = abierta. Es lo único que el middleware mira para cortar.
  cerrada_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Quién la cerró. Sin esto, «me cerraron la sesión» no tiene respuesta.
  cerrada_por: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'sesiones',
  // Con `name` explícito e idéntico al de
  // `migrations/20260812-sesiones-de-usuario.js`: sin él Sequelize lo llamaría
  // `sesiones_usuario_id_dispositivo` y un `sync({ alter: true })` de desarrollo
  // crearía un segundo índice sobre las mismas columnas.
  //
  // El único no es una optimización: es el mecanismo. Dos requests en paralelo
  // del mismo navegador entran los dos por «no existe» y los dos insertan; el
  // que pierde atrapa `SequelizeUniqueConstraintError` y relee.
  indexes: [
    { unique: true, name: 'uq_sesion_dispositivo', fields: ['usuario_id', 'dispositivo'] },
  ],
});

module.exports = Sesion;
