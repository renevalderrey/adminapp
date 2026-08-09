// ════════════════════════════════════════════
//  Cálculo de precios de venta
//
//  ── Por qué es un paquete y no un archivo de una app ──
//
//  Esta fórmula vivía en `apps/web/src/utils/precios.js` y el servidor nunca
//  devolvió un precio de venta: los calculaba el navegador a partir del `cost`
//  crudo. El catálogo público rompe ese arreglo por dos motivos que van juntos:
//  una página pública **no puede recibir el costo de compra** del comercio, y
//  `apps/tienda` es una app distinta que no puede importar de `apps/web`.
//
//  La salida fácil —copiar la función— es el defecto que este repositorio ya
//  tiene documentado en `mediosDePago.test.js:46`: tres copias que empezaron
//  iguales y terminaron distintas. Acá hay una sola, y
//  `apps/api/src/tests/paqueteDePrecios.test.js` se pone en rojo si aparece otra.
//
//  ── Por qué CommonJS ──
//
//  **Sin `"type": "module"`, a propósito.** `apps/api` hace
//  `require('@favalio/precios')` sin transpilación, sin
//  `--experimental-vm-modules` y sin `exports` condicionales. Del lado del
//  navegador, `apps/web/vite.config.js` lo declara en `optimizeDeps.include`,
//  que es lo que convierte esto a ESM para el servidor de desarrollo.
//
//  Y no hay paso de build: un paquete que no se construye no se puede construir
//  mal, y un `build` olvidado falla en silencio.
//
//  ── Convención de margen (decidida con el cliente) ──
//
//  "Margen 50%" significa RECARGO SOBRE EL COSTO: costo × (1 + 50/100).
//  Un costo de $100 con 50% de margen da un precio de $150.
//
//  Es la convención que usa el comerciante argentino cuando dice "le pongo un
//  50%", y es lo que el POS ya hacía. NO es margen sobre la venta: sobre esos
//  $150, la ganancia de $50 representa el 33% del precio, no el 50%.
//
//  La calculadora de punto de equilibrio (apps/web/src/utils/bep.js) trabaja con
//  la otra magnitud —qué fracción de lo facturado tiene que ser ganancia— y
//  convierte explícitamente a recargo sobre costo antes de mostrar nada. Las dos
//  viven en el sistema, pero cada una con su nombre.
// ════════════════════════════════════════════

/**
 * Cómo se aplica el recargo por pago con tarjeta.
 *
 * La diferencia no es cosmética: con un recargo del 20% sobre un precio de
 * $100, SOBRE_PRECIO da $120 y COMPENSA_COMISION da $125.
 */
const MODO_RECARGO = {
  /**
   * El recargo se le suma al cliente: precio × (1 + r/100).
   *
   * Es lo que se cobra en el mostrador cuando se dice "con tarjeta sale 20%
   * más". Default, porque es lo que espera la mayoría de los comercios.
   */
  SOBRE_PRECIO: 'sobre_precio',

  /**
   * El recargo compensa la comisión que retiene la tarjeta:
   * precio / (1 - r/100).
   *
   * Sirve cuando el número configurado es lo que la procesadora descuenta y el
   * comercio quiere terminar recibiendo el precio de lista completo. Con una
   * comisión del 20%, hay que cobrar $125 para que queden $100.
   */
  COMPENSA_COMISION: 'compensa_comision',
};

function aNumero(v, porDefecto = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : porDefecto;
}

/**
 * Precio con tarjeta, según el modo configurado.
 *
 * @returns {number|null} null si el recargo no se puede aplicar.
 */
function precioConRecargo(precioBase, recargoPct, modo = MODO_RECARGO.SOBRE_PRECIO) {
  const base = aNumero(precioBase);
  const r = aNumero(recargoPct);

  if (r <= 0) return base;

  if (modo === MODO_RECARGO.COMPENSA_COMISION) {
    // Con una comisión del 100% o más no hay precio finito que deje el neto
    // buscado. Antes esto daba Infinity y se propagaba al carrito.
    if (r >= 100) return null;
    return base / (1 - r / 100);
  }

  return base * (1 + r / 100);
}

/**
 * Precio con descuento de alianza.
 */
function precioConDescuento(precioBase, descuentoPct) {
  const base = aNumero(precioBase);
  const d = aNumero(descuentoPct);

  if (d <= 0) return base;
  // Un descuento del 100% o más deja el precio en cero, no en negativo.
  if (d >= 100) return 0;

  return base * (1 - d / 100);
}

/**
 * Calcula los tres precios de un producto.
 *
 * @param {object} producto
 * @param {object} settings Configuración de la empresa.
 * @returns {{
 *   cashPrice: number,
 *   cardPrice: number|null,
 *   alliancePrice: number,
 *   sinCosto: boolean,
 *   usaPrecioManual: boolean,
 * }}
 */
function calcularPrecios(producto = {}, settings = {}) {
  const cost = aNumero(producto.cost);

  const modo = settings.recargo_modo || MODO_RECARGO.SOBRE_PRECIO;
  const recargo = aNumero(settings.recargo_tarjeta);
  const descuento = aNumero(settings.descuento_alianza);

  // price_override es el precio de lista cargado a mano. Se guardaba, se
  // importaba y se editaba en el formulario, pero el POS lo ignoraba por
  // completo y siempre recalculaba desde el costo: el precio manual no tenía
  // ningún efecto.
  const precioManual = aNumero(producto.price_override, 0);
  const usaPrecioManual = precioManual > 0;

  const margen = producto.margin_override ?? settings.margin_efectivo;

  const cashPrice = usaPrecioManual
    ? Math.round(precioManual)
    : Math.round(cost * (1 + aNumero(margen) / 100));

  const conRecargo = precioConRecargo(cashPrice, recargo, modo);

  return {
    cashPrice,
    cardPrice: conRecargo === null ? null : Math.round(conRecargo),
    alliancePrice: Math.round(precioConDescuento(cashPrice, descuento)),

    // Un producto sin costo y sin precio manual sale a $0 en el POS y se puede
    // vender gratis sin que nada avise. La pantalla usa esta bandera para
    // marcarlo.
    sinCosto: cost <= 0 && !usaPrecioManual,
    usaPrecioManual,
  };
}

module.exports = {
  MODO_RECARGO,
  precioConRecargo,
  precioConDescuento,
  calcularPrecios,
};
