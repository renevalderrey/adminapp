// ════════════════════════════════════════════
//  Las claves de configuracion que NO salen por la API
//
//  ── Que paso ──
//
//  `GET /api/settings` devolvia la tabla entera, sin excluir nada. Entre esas
//  filas viajaban **la clave privada de AFIP en claro**, su certificado y el
//  token de TiendaNube, a cualquiera con `config.ver` — que incluye al rol
//  `gerente`, no solo al dueño. Y la pantalla las pide al montar y las guarda en
//  el store global del navegador, o sea que ademas quedaban en memoria del lado
//  del cliente y en cualquier volcado de estado.
//
//  La clave privada de AFIP es lo que firma los comprobantes fiscales de la
//  empresa. Quien la tenga puede facturar en su nombre.
//
//  ── Lo que mas duele ──
//
//  **La lista ya estaba escrita.** `scripts/backup.js` la tenia hace meses,
//  porque ahi alguien penso «esto no va en un respaldo». El endpoint que se lo
//  manda al navegador no la usaba. Por eso vive aca ahora y la importan los dos:
//  dos listas iguales en dos archivos empiezan iguales y terminan distintas, que
//  es exactamente como nace la proxima fuga.
//
//  ── Por que no se devuelve el valor "enmascarado" ──
//
//  Nada de `afip_key: '****'`. Un valor enmascarado sigue siendo un campo que
//  alguien puede mandar de vuelta en un `PUT` creyendo que lo conserva, y termina
//  guardando los asteriscos encima de la clave. Lo que la pantalla necesita saber
//  es **si hay algo cargado**, no que hay, y para eso esta la bandera.
// ════════════════════════════════════════════

/** No salen nunca por la API ni entran en un respaldo. */
const SETTINGS_SECRETOS = ['afip_cert', 'afip_key', 'tiendanube_access_token'];

function esSecreto(clave) {
  return SETTINGS_SECRETOS.includes(clave);
}

/**
 * Saca los secretos de un objeto de configuracion y deja una bandera por cada
 * uno: `afip_key_cargado: true|false`.
 *
 * La bandera no es decorado. Sin ella, la pantalla de Ajustes AFIP no tiene como
 * distinguir «todavia no subiste el certificado» de «ya esta subido», y la unica
 * salida seria pedirle al usuario que lo vuelva a subir cada vez que entra —o
 * peor, dibujar «cargado» sin saberlo.
 *
 * @param {object} configuracion
 * @returns {object} Una copia. No muta lo que recibe.
 */
function sinSecretos(configuracion = {}) {
  const limpia = { ...configuracion };

  for (const clave of SETTINGS_SECRETOS) {
    const valor = limpia[clave];
    delete limpia[clave];
    limpia[`${clave}_cargado`] = Boolean(valor);
  }

  return limpia;
}

module.exports = { SETTINGS_SECRETOS, esSecreto, sinSecretos };
