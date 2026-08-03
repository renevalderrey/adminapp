// ════════════════════════════════════════════
//  ADMINAPP · Lectura de importes escritos por una persona (navegador)
//
//  Es la misma función que `apps/api/src/utils/importes.js`, y está duplicada a
//  propósito: no hay paquete compartido entre `apps/api` y `apps/web`, y la
//  alternativa —que el navegador no lea importes— es peor, porque entonces la
//  vista previa de la importación muestra un número distinto del que va a
//  quedar guardado.
//
//  ── Quién manda ──
//
//  **El servidor.** Lo que se sube es el texto tal cual lo pegó el usuario, y el
//  costo que se guarda lo interpreta `apps/api/src/utils/importes.js`. Esta
//  copia se usa SOLO para mostrar: la vista previa y el aviso de una columna que
//  no parece contener importes. Si las dos alguna vez discrepan, la que está mal
//  es esta, y lo que se ve es un número en pantalla distinto del guardado — no
//  un dato mal grabado.
//
//  Un importe argentino se escribe 1.234,50: el punto separa los miles y la coma
//  es el decimal. Leerlo al revés —que es lo que hace `parseFloat`, que corta en
//  la coma— convierte $1.234 en $1,234. Mil veces menos, y **no falla nada**.
// ════════════════════════════════════════════

/**
 * Convierte un importe escrito por una persona a número.
 *
 * Reglas, en orden:
 *  - Se descarta todo lo que no sea dígito, separador o signo: símbolos de
 *    moneda, espacios (incluido el duro que pegan las planillas) y letras.
 *  - Si están la coma y el punto, el decimal es **el que aparece último**:
 *    1.234,50 es argentino, 1,234.50 es inglés.
 *  - Si solo hay coma, la coma es el decimal (0,99).
 *  - Si solo hay puntos y el último grupo es de 3 dígitos, son miles (1.234).
 *  - Si solo hay puntos y el último grupo no es de 3, es decimal (1234.5).
 *
 * @param {string|number|null|undefined} texto
 * @returns {number|null} `null` cuando no hay ningún número que leer. **No 0**:
 *   una celda de costo vacía leída como cero pone el costo de un producto en
 *   cero y el margen del POS pasa a ser mentira (FR-099).
 */
export function aNumero(texto) {
  // Una planilla devuelve números, no texto. Pasarlos por el parser de
  // separadores los rompe: String(1234.567) tiene el último grupo de 3 dígitos
  // y se leería como 1.234.567.
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null

  if (texto === null || texto === undefined) return null

  let limpio = String(texto).replace(/[^\d,.-]/g, '')

  // Sin un solo dígito no hay importe: celda vacía, un guion, «s/d», «$».
  if (!/\d/.test(limpio)) return null

  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    if (ultimaComa > ultimoPunto) {
      limpio = limpio.replace(/\./g, '').replace(/,/g, '.')
    } else {
      limpio = limpio.replace(/,/g, '')
    }
  } else if (ultimaComa >= 0) {
    limpio = limpio.replace(/,/g, '.')
  } else if (ultimoPunto >= 0) {
    const partes = limpio.split('.')
    const ultima = partes[partes.length - 1]

    if (partes.length > 1 && ultima.length === 3) limpio = partes.join('')
  }

  const numero = Number(limpio)

  return Number.isFinite(numero) ? numero : null
}
