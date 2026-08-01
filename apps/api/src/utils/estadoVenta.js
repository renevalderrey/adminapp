// ════════════════════════════════════════════
//  ADMINAPP · Los cinco estados de una venta
//
//  `status` tiene dos valores ('active' / 'voided') pero para el usuario hay
//  cinco situaciones distintas, y confundirlas tiene consecuencias fiscales:
//
//   A. Autorizada                    activa, con CAE
//   B. Registrada                    activa, sin CAE, sin intento fallido
//   C. Rechazada                     activa, sin CAE, con intento fallido
//   D. Anulada                       anulada, sin CAE
//   E. Anulada · vigente ante ARCA   anulada, CON CAE
//
//  Por que en el servidor y no en la pantalla: el badge de la fila, la columna
//  «Estado» del archivo exportado y lo que cuente el panel de control tienen
//  que decir lo mismo. Tres derivaciones separadas de la misma regla es el
//  camino conocido a que dos digan una cosa y la tercera otra.
//
//  Por que sin colores: el color es una decision de diseño y su fuente es
//  REGLAS-DISENO.md. Si la API devolviera un hexadecimal, el frontend dejaria
//  de poder cambiar la paleta sin tocar el backend. El significado va en el
//  servidor, el color en el frontend.
//
//  Por que no es una columna: los cinco estados son una funcion pura de tres
//  campos que ya existen. Persistirlos crea un cuarto dato que puede
//  contradecir a los otros tres, y la primera contradiccion va a ser una venta
//  que dice «Rechazada» y tiene CAE.
// ════════════════════════════════════════════

/** Los cinco codigos, para no escribirlos sueltos en cada consumidor. */
const CODIGOS = {
  AUTORIZADA: 'autorizada',
  REGISTRADA: 'registrada',
  RECHAZADA: 'rechazada',
  ANULADA: 'anulada',
  ANULADA_CON_CAE: 'anulada_con_cae',
};

const ETIQUETAS = {
  [CODIGOS.AUTORIZADA]: 'Autorizada',
  [CODIGOS.REGISTRADA]: 'Registrada',
  [CODIGOS.RECHAZADA]: 'Rechazada',
  [CODIGOS.ANULADA]: 'Anulada',
  [CODIGOS.ANULADA_CON_CAE]: 'Anulada · vigente ante ARCA',
};

/** true si el campo trae algo utilizable. '' y '   ' no cuentan. */
function tieneValor(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/**
 * Cual de los cinco estados es una venta.
 *
 * EL ORDEN DE LAS COMPARACIONES IMPORTA Y NO ES INTERCAMBIABLE:
 *
 *  1. `voided` primero. Una venta anulada es D o E sin mirar el error: un
 *     rechazo viejo guardado no la vuelve «Rechazada» despues de anulada.
 *
 *  2. Dentro de cada rama, `afip_cae` ANTES que `afip_ultimo_error`. Una venta
 *     con CAE es Autorizada aunque tenga guardado el rechazo de un intento
 *     anterior. Al reves, la venta que fallo y despues se facturo bien se
 *     mostraria Rechazada para siempre, con CAE y todo.
 *
 * El estado E existe porque hasta ahora se podia anular un comprobante con
 * CAE. Anular en AdminApp no lo da de baja ante ARCA: sigue declarado y sigue
 * en la base imponible hasta que se emita una nota de credito, que el sistema
 * todavia no emite. `taxService` ya los cuenta como `anuladas_con_cae_sin_nc`
 * justamente porque es un desvio conocido. Mostrarlos como una anulada comun
 * seria mentirle al usuario.
 *
 * @param {{ status?: string, afip_cae?: string|null, afip_ultimo_error?: string|null }} venta
 * @returns {{ codigo: string, etiqueta: string }}
 */
function estadoVenta(venta = {}) {
  const { status, afip_cae, afip_ultimo_error } = venta || {};

  const conCae = tieneValor(afip_cae);

  if (status === 'voided') {
    return conCae ? estado(CODIGOS.ANULADA_CON_CAE) : estado(CODIGOS.ANULADA);
  }

  if (conCae) return estado(CODIGOS.AUTORIZADA);

  return tieneValor(afip_ultimo_error)
    ? estado(CODIGOS.RECHAZADA)
    : estado(CODIGOS.REGISTRADA);
}

function estado(codigo) {
  return { codigo, etiqueta: ETIQUETAS[codigo] };
}

module.exports = { estadoVenta, CODIGOS, ETIQUETAS };
