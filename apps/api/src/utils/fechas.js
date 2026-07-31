// ════════════════════════════════════════════
//  ADMINAPP · Fechas en la zona horaria del negocio
//
//  Todo el sistema guarda las fechas como texto YYYY-MM-DD y las obtenía con
//  new Date().toISOString().split('T')[0], que devuelve la fecha en UTC.
//
//  Argentina es UTC-3: a partir de las 21:00 hora local, UTC ya está en el día
//  siguiente. Una venta de las 21:30 del 31 de julio quedaba asentada el 1 de
//  agosto. Eso corre el cierre de caja, el listado del día, los reportes por
//  período y la fecha del comprobante que se declara a AFIP.
//
//  El modelo Empresa ya tiene una columna `timezone` con
//  'America/Argentina/Buenos_Aires' por defecto, que no se usaba en ningún
//  lado. Estas funciones la respetan.
// ════════════════════════════════════════════

const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires';

/**
 * Fecha del negocio en formato YYYY-MM-DD.
 *
 * @param {string} [zona] IANA timezone. Cae al default si no es válida.
 * @param {Date} [momento] Instante a convertir. Por defecto, ahora.
 */
function fechaDelNegocio(zona = ZONA_POR_DEFECTO, momento = new Date()) {
  // en-CA formatea como YYYY-MM-DD, que es exactamente lo que guarda la base.
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zona || ZONA_POR_DEFECTO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(momento);
  } catch {
    // Una zona inválida no debe romper una venta: se cae al default.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_POR_DEFECTO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(momento);
  }
}

/**
 * Hora del negocio en formato HH:MM, 24 horas.
 */
function horaDelNegocio(zona = ZONA_POR_DEFECTO, momento = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zona || ZONA_POR_DEFECTO,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(momento);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA_POR_DEFECTO,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(momento);
  }
}

/**
 * Fecha en el formato que espera AFIP: YYYYMMDD, sin separadores.
 */
function fechaParaAfip(zona = ZONA_POR_DEFECTO, momento = new Date()) {
  return fechaDelNegocio(zona, momento).replace(/-/g, '');
}

module.exports = {
  ZONA_POR_DEFECTO,
  fechaDelNegocio,
  horaDelNegocio,
  fechaParaAfip,
};
