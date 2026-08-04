// ════════════════════════════════════════════
//  ADMINAPP · El control segmentado del medio de pago
//
//  ⚠ VACÍO A PROPÓSITO. Lo llena la fase 9.
//
//  Va a ser: tres segmentos —Efectivo · Tarjeta · Alianza— que se reparten el
//  ancho y comparten borde. Un clic elige el segmento y le pone su medio por
//  defecto; un segundo clic sobre el segmento ya activo abre el medio exacto,
//  que en «Efectivo» son transferencia, QR, débito y crédito en un pago.
//
//  Los segmentos son NIVELES DE PRECIO y no formas de pagar: por eso «Créd. 1
//  pago» vive adentro de «Efectivo». La lista y sus reglas están en
//  `utils/mediosDePago.js`, que es la única fuente del lado del navegador.
//
//  Nueve segmentos no entran: en 400px de ticket dan menos de 40px cada uno, y
//  el encabezado del catálogo fija TRES columnas de precio — nueve controles
//  sobre tres precios le dicen al operador que hay nueve precios.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta. Hay una
//  guardia estática que lo verifica.
// ════════════════════════════════════════════

export default function SegmentoDePago() {
  return null
}
