// ════════════════════════════════════════════
//  FAVALIO · Lectura de importes escritos por una persona
//
//  Un importe argentino se escribe 1.234,50: el punto separa los miles y la
//  coma es el decimal. Leerlo al reves —que es lo que hace parseFloat, que
//  corta en la coma— convierte $1.234 en $1,234. Mil veces menos, y no falla
//  nada: el producto queda cargado, el margen que muestra el POS es mentira y
//  nadie se entera hasta que se compara contra la factura del proveedor.
//
//  La funcion vivia adentro de comparadorService.js, que la usa para las
//  listas de proveedores pegadas como texto. El otro camino que lee importes
//  —la importacion de productos— usaba parseFloat, o sea que tenia
//  exactamente el error que esta funcion existe para evitar. Se movio aca
//  para que haya UN solo lector de importes en el sistema: dos lectores del
//  mismo formato empiezan iguales y terminan discrepando, que es como el
//  sistema viejo termino con dos parsers en el mismo archivo.
// ════════════════════════════════════════════

/**
 * Convierte un importe escrito por una persona a numero.
 *
 * Reglas, en orden:
 *  - Se descarta todo lo que no sea digito, separador o signo: simbolos de
 *    moneda, espacios (incluido el duro que pegan las planillas) y letras.
 *  - Si estan la coma y el punto, el decimal es **el que aparece ultimo**:
 *    1.234,50 es argentino, 1,234.50 es ingles.
 *  - Si solo hay coma, la coma es el decimal (0,99).
 *  - Si solo hay puntos y el ultimo grupo es de 3 digitos, son miles (1.234).
 *  - Si solo hay puntos y el ultimo grupo no es de 3, es decimal (1234.5).
 *
 * @param {string|number|null|undefined} texto
 * @returns {number|null} null cuando no hay ningun numero que leer. **No 0**:
 *   una celda de costo vacia leida como cero pone el costo de un producto en
 *   cero y el margen del POS pasa a ser mentira (FR-099).
 */
function aNumero(texto) {
  // Una planilla .xlsx devuelve numeros, no texto. Pasarlos por el parser de
  // separadores los rompe: String(1234.567) tiene el ultimo grupo de 3
  // digitos y se leeria como 1.234.567.
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;

  if (texto === null || texto === undefined) return null;

  let limpio = String(texto).replace(/[^\d,.-]/g, '');

  // Sin un solo digito no hay importe: celda vacia, un guion, "s/d", "$".
  if (!/\d/.test(limpio)) return null;

  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    if (ultimaComa > ultimoPunto) {
      limpio = limpio.replace(/\./g, '').replace(/,/g, '.');
    } else {
      limpio = limpio.replace(/,/g, '');
    }
  } else if (ultimaComa >= 0) {
    limpio = limpio.replace(/,/g, '.');
  } else if (ultimoPunto >= 0) {
    const partes = limpio.split('.');
    const ultima = partes[partes.length - 1];

    if (partes.length > 1 && ultima.length === 3) limpio = partes.join('');
  }

  const numero = Number(limpio);

  return Number.isFinite(numero) ? numero : null;
}

module.exports = { aNumero };
