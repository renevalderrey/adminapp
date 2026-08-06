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

// ════════════════════════════════════════════
//  Las que se LEEN por la API pero solo las escribe el servidor
//
//  Son otra cosa que las secretas y por eso son otra lista. `afip_environment`
//  y `afip_pv` **tienen que salir** por `GET /api/settings`: la pantalla de
//  Ajustes → Facturación necesita saber contra qué ambiente factura la empresa y
//  con qué punto de venta para poder dibujarse. Meterlas en `SETTINGS_SECRETOS`
//  las convertiria en `afip_pv_cargado: true`, que no sirve para nada.
//
//  ── Que pasaba, y por que no lo cerro la lista de secretos ──
//
//  `01fc77d` cerro la fuga de `afip_key` y de paso bloqueo su escritura por
//  `PUT /api/settings/:key`. Pero el agujero tenia dos mitades y la que muerde
//  quedo abierta: `PUT /api/settings/afip_environment` con `"production"`
//  seguia funcionando, y **no invalida el ticket WSAA cacheado**, que se emitio
//  contra homologacion.
//
//  O sea: por esa puerta se podia pasar una empresa a produccion —comprobantes
//  fiscales de verdad, numeracion correlativa consumida— sin pasar por ninguna
//  de las validaciones de `POST /api/afip/setup`, y con el ticket viejo todavia
//  en memoria. Y `afip_pv` es peor todavia: escribir un punto de venta que ARCA
//  no tiene declarado no falla en el momento, falla cuando hay que emitir.
//
//  `afip_verificacion` entra por un motivo distinto: es **evidencia**. La
//  escribe el servidor despues de que AFIP contesto, y una evidencia que el
//  cliente puede escribir no es evidencia de nada.
// ════════════════════════════════════════════

/** Salen por la API, pero la única mano que las escribe es la del servidor. */
const SETTINGS_DE_SOLO_LECTURA = ['afip_environment', 'afip_pv', 'afip_verificacion'];

function esDeSoloLectura(clave) {
  return SETTINGS_DE_SOLO_LECTURA.includes(clave);
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

module.exports = {
  SETTINGS_SECRETOS,
  esSecreto,
  sinSecretos,
  SETTINGS_DE_SOLO_LECTURA,
  esDeSoloLectura,
};
