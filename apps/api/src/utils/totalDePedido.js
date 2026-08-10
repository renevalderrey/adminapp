// ════════════════════════════════════════════
//  Cuánto sale el pedido
//
//  Función pura y del **servidor**. La tienda calcula lo mismo para dibujar el
//  carrito, pero lo que se guarda sale de acá: el navegador puede tener precios
//  viejos —o mentir— y el número que se cobra no puede depender de eso.
//
//  Las tres cifras que devuelve son las tres columnas de `pedidos`:
//  `subtotal`, `envio_costo` y `total`. Se guardan las tres y no sólo el total
//  porque «¿el envío salió gratis?» es una pregunta que se hace después, y
//  restar no la contesta cuando el costo de envío del catálogo ya cambió.
// ════════════════════════════════════════════

/** Dos decimales, siempre. Lo que entra a una columna DECIMAL(12,2). */
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {Array<{precio_unitario: number|string, cantidad: number}>} lineas
 *   Ya resueltas: el precio de cada una salió de `resolverPrecios`, no del
 *   cuerpo del request.
 * @param {object} catalogo Con `envio`, `envio_costo` y `envio_gratis_desde`.
 * @param {string} entrega Uno de `retiro_socio` | `retiro_local` | `envio` |
 *   `coordinar`.
 * @returns {{subtotal: number, envio_costo: number, total: number, envio_gratis: boolean}}
 */
function totalDePedido(lineas, catalogo = {}, entrega = 'retiro_local') {
  const subtotal = centavos(
    (lineas || []).reduce(
      (acc, l) => acc + centavos(l.precio_unitario) * (Number(l.cantidad) || 0),
      0,
    ),
  );

  // Sólo se cobra envío si el comprador eligió que se lo lleven **y** el
  // catálogo tiene el envío habilitado. Cobrarlo por «coordinar» o por retiro es
  // el error que le llega al cliente como un cargo que nadie le explicó.
  const hayQueEnviar = entrega === 'envio' && catalogo.envio === true;

  if (!hayQueEnviar) {
    return { subtotal, envio_costo: 0, total: subtotal, envio_gratis: false };
  }

  const costo = centavos(catalogo.envio_costo);
  const umbral = catalogo.envio_gratis_desde;

  // NULL, undefined, '' o 0 significan **«no hay envío gratis»**.
  //
  // Es al revés de lo que sale solo: con `subtotal >= 0` todo pedido tendría el
  // envío gratis, y el comercio no cobraría un envío que sí hace. El umbral
  // tiene que ser un número mayor que cero para existir.
  const hayUmbral = umbral !== null && umbral !== undefined && umbral !== '' && Number(umbral) > 0;

  // `>=`, no `>`: «envío gratis desde $50.000» incluye los $50.000. Es lo que
  // dice el cartel, y el que compró exactamente eso lo va a reclamar.
  const gratis = hayUmbral && subtotal >= centavos(umbral);

  const envio_costo = gratis ? 0 : costo;

  return {
    subtotal,
    envio_costo,
    total: centavos(subtotal + envio_costo),
    envio_gratis: gratis,
  };
}

module.exports = { totalDePedido };
