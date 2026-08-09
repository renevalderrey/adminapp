import { fechaCorta } from '@/utils/formato'

// ════════════════════════════════════════════
//  FAVALIO · Las reglas de la lista de sesiones
//
//  Función pura antes que test de render, como manda `CONVENCIONES.md`: qué dice
//  la etiqueta de un dispositivo y cómo se lee «hace cuánto» son **reglas**, y un
//  test de render que las verifique cuesta diez veces más y se rompe cuando
//  alguien mueve un `<div>`.
//
//  ── Por qué «hace cuánto» y no la hora ──
//
//  La lista muestra solo sesiones **abiertas**, así que casi todas las fechas son
//  de hoy: dos columnas con «06/08/2026» al lado no contestan la pregunta que se
//  está haciendo, que es «¿esta computadora se está usando ahora o quedó abierta
//  el viernes?». Un texto relativo la contesta de un vistazo.
//
//  ⚠ `vista_en` se refresca **como mucho cada cinco minutos** del lado del
//  servidor (FR-124), así que «recién» significa «en los últimos minutos» y no
//  «en este segundo». Está dicho acá para que nadie lea la lista como un
//  monitor en vivo.
// ════════════════════════════════════════════

/** Cómo se nombra cada aparato. Las tres del `utils/dispositivo.js` de la API. */
export const ETIQUETAS_DE_DISPOSITIVO = {
  computadora: 'Computadora',
  celular: 'Celular',
  desconocido: 'Desconocido',
}

/**
 * La etiqueta de un dispositivo. **Nunca devuelve `undefined`.**
 *
 * Es la misma regla que `tonoDeProveedor`: una celda vacía en una tabla no se
 * distingue de «no se miró». Un código que este archivo no conoce —porque la API
 * agregó uno y la pantalla todavía no— cae en «Desconocido», que es cierto.
 */
export function etiquetaDeDispositivo(codigo) {
  return ETIQUETAS_DE_DISPOSITIVO[codigo] || ETIQUETAS_DE_DISPOSITIVO.desconocido
}

const UN_MINUTO = 60 * 1000
const UNA_HORA = 60 * UN_MINUTO
const UN_DIA = 24 * UNA_HORA

/**
 * «hace 12 minutos», «hace 3 horas», «hace 5 días», o la fecha si es vieja.
 *
 * @param {string} iso  Un timestamp de la API.
 * @param {number} [ahora]  Se inyecta en los tests: sin esto, «hace 12 minutos»
 *   solo se puede afirmar contra el reloj de la máquina, que es la clase de test
 *   que falla un martes a la madrugada y nadie sabe por qué.
 * @returns {string} Nunca vacío.
 */
export function haceCuanto(iso, ahora = Date.now()) {
  const t = new Date(iso || '').getTime()

  // Lo que no tiene forma de fecha se dice, no se convierte en «Invalid Date».
  // Es la misma decisión que `fechaCorta`.
  if (Number.isNaN(t)) return '—'

  const diferencia = ahora - t

  // Negativo = el reloj del servidor va adelante del de esta computadora. Pasa,
  // y «hace -3 minutos» es peor que redondear a «recién».
  if (diferencia < UN_MINUTO) return 'recién'

  if (diferencia < UNA_HORA) {
    const minutos = Math.floor(diferencia / UN_MINUTO)
    return `hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`
  }

  if (diferencia < UN_DIA) {
    const horas = Math.floor(diferencia / UNA_HORA)
    return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`
  }

  const dias = Math.floor(diferencia / UN_DIA)

  // Pasado el mes, «hace 47 días» ya no ayuda a decidir nada y la fecha sí: es
  // el dato que alguien compara contra «esa persona dejó la empresa en junio».
  if (dias > 30) return fechaCorta(iso)

  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}
