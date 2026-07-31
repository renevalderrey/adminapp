const { randomUUID } = require('crypto');

// ════════════════════════════════════════════
//  Identificador de request
//
//  Sin esto no habia forma de atar el reporte de un usuario —"me dio error a
//  las tres de la tarde"— con una linea del log. Los 500 salian sin ninguna
//  referencia, y el log tenia miles de lineas de ese rango horario.
//
//  Ahora cada request lleva un id que viaja en tres lugares a la vez:
//
//   - En la cabecera `X-Request-Id` de la respuesta.
//   - En el cuerpo del error que ve el usuario.
//   - En cada linea de log que emite ese request.
//
//  El usuario copia el id del mensaje de error y con eso se encuentra la
//  linea exacta.
// ════════════════════════════════════════════

// Un id que llega de afuera se acepta solo si es inofensivo: sin saltos de
// linea (que partirian una entrada del log en dos y permitirian inyectar
// lineas falsas) y sin largo arbitrario. Si no cumple, se genera uno nuevo.
const ID_VALIDO = /^[A-Za-z0-9._-]{8,64}$/;

function requestId(req, res, next) {
  // Los proxies y la mayoria de los agregadores de logs ya propagan alguno de
  // estos. Reusarlo permite seguir el mismo request a traves de varios saltos.
  const entrante = req.headers['x-request-id'] || req.headers['x-correlation-id'];

  req.id = (typeof entrante === 'string' && ID_VALIDO.test(entrante))
    ? entrante
    : randomUUID();

  res.setHeader('X-Request-Id', req.id);

  next();
}

module.exports = requestId;
