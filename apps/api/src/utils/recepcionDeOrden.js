// ════════════════════════════════════════════
//  ADMINAPP · Qué pasa con el detalle de una orden cuando llega mercadería
//
//  Esta es la aritmética de la recepción, sin base de datos y sin transacción.
//  Existe aparte porque el defecto que viene a cerrar es de identidad, no de
//  persistencia, y se demuestra con un arreglo:
//
//      detail.find((d) => d.product_id === received.product_id)
//
//  Esa línea —purchaseService.js, hasta este corte— resolvía la línea de la
//  orden **por producto**. Con dos líneas del mismo producto, la primera se
//  llevaba todo; con dos líneas sin producto, `undefined === undefined`
//  matcheaba la primera. La cantidad entraba en la línea equivocada, la deuda
//  se valoraba con el `unit_price` equivocado, y la pantalla decía «Mercadería
//  recibida».
//
//  La identidad de una línea es **su posición en `detail`** (decisión 1 del
//  plan). `detail` es un JSONB sin tabla de líneas: no hay id que usar, y la
//  posición es lo único que distingue dos líneas idénticas.
//
//  ── Por qué devuelve avisos y no solo números ──
//
//  Tres de las reglas de abajo —cantidad cero, cantidad mayor a lo pendiente,
//  línea sin producto— el servidor **ya las aplicaba** y no las decía. El
//  usuario escribía 9 y el sistema cargaba 4 mostrando «Mercadería recibida»
//  (FR-033).
// ════════════════════════════════════════════

const { ErrorDeNegocio } = require('./errores');
const { sumaEnCentavos } = require('./centavos');

/**
 * Un error del cuerpo del request, con código para que la pantalla lo
 * distinga sin parsear castellano.
 *
 * @param {string} codigo
 * @param {string} mensaje
 * @returns {ErrorDeNegocio & {codigo: string}}
 */
function errorDeCuerpo(codigo, mensaje) {
  const err = new ErrorDeNegocio(mensaje, 400);
  err.codigo = codigo;
  return err;
}

/**
 * Aplica una recepción sobre el detalle de una orden. **Pura.**
 *
 * @param {Array<object>} detail El `detail` JSONB de la orden. No se muta.
 * @param {Array<{linea: number, cantidad: number|string, actualizar_costo?: boolean}>} items
 * @returns {{
 *   detalle: Array<object>,
 *   totalRecibido: number,
 *   estado: 'partial'|'received',
 *   lineas: Array<object>,
 *   avisos: string[],
 * }}
 * @throws {ErrorDeNegocio} `LINEA_INEXISTENTE` si un índice no está en `detail`.
 */
function aplicarRecepcion(detail = [], items = []) {
  // Copia profunda de un nivel. La original no se toca: quien llama sigue
  // necesitando el detalle de antes para comparar, y una función pura que muta
  // su argumento es una que no se puede testear dos veces seguidas.
  const detalle = (detail || []).map((linea) => ({ ...linea }));

  const lineas = [];
  const avisos = [];
  const importes = [];

  for (const item of items || []) {
    const indice = Number(item.linea);

    // Un índice que no existe NO es un `continue`. Con el `find` viejo, un
    // producto que no estaba en la orden se salteaba en silencio y el usuario
    // veía «recibido» sin que hubiera entrado nada. Si la pantalla manda una
    // línea que no existe es porque se quedó con un detalle viejo, y eso hay
    // que decirlo antes de tocar stock.
    if (!Number.isInteger(indice) || indice < 0 || indice >= detalle.length) {
      throw errorDeCuerpo(
        'LINEA_INEXISTENTE',
        `La orden no tiene una línea en la posición ${item.linea}. `
        + 'Volvé a abrir la orden: el detalle cambió desde que la cargaste.'
      );
    }

    const linea = detalle[indice];
    const nombre = linea.product_name || 'un ítem sin nombre';

    const cantidad = parseFloat(item.cantidad) || 0;

    if (cantidad <= 0) {
      avisos.push(`Se ignoró una cantidad de cero o negativa en «${nombre}».`);
      continue;
    }

    const pedido = parseFloat(linea.quantity) || 0;
    const yaRecibido = parseFloat(linea.quantity_received) || 0;
    const pendiente = pedido - yaRecibido;

    if (pendiente <= 0) {
      avisos.push(`«${nombre}» ya estaba recibido por completo: no se cargó nada.`);
      continue;
    }

    const entra = Math.min(cantidad, pendiente);

    if (entra < cantidad) {
      avisos.push(
        `Se cargaron ${cantidad} de «${nombre}» y quedaban ${pendiente} pendientes: `
        + `se cargaron ${entra}.`
      );
    }

    linea.quantity_received = yaRecibido + entra;
    importes.push(entra * (parseFloat(linea.unit_price) || 0));

    lineas.push({
      linea: indice,
      product_id: linea.product_id ?? null,
      product_name: linea.product_name || null,
      pedido,
      recibido_ahora: entra,
      recibido_total: linea.quantity_received,
      pendiente: pedido - linea.quantity_received,
      unit_price: parseFloat(linea.unit_price) || 0,
      actualizar_costo: item.actualizar_costo === true,
    });
  }

  // El estado se decide mirando TODAS las líneas del detalle, no solo las que
  // vinieron en esta recepción: recibir una línea de tres marcaba la orden como
  // completa y la guarda del servicio impedía recibir el resto para siempre.
  //
  // Y `[].every(...)` es `true` por vacuidad: un detalle vacío —una orden sin
  // ítems— quedaría marcada `received` sin que hubiera llegado nada. Lo mismo
  // una línea de cantidad cero, que cumple `recibido >= pedido` con los dos en
  // cero.
  const hayAlgoQueRecibir = detalle.some((l) => (parseFloat(l.quantity) || 0) > 0);

  const todoRecibido = hayAlgoQueRecibir && detalle.every((l) => {
    const pedido = parseFloat(l.quantity) || 0;
    const recibido = parseFloat(l.quantity_received) || 0;
    return recibido >= pedido;
  });

  return {
    detalle,
    // La suma va en centavos: veinte líneas sumadas en pesos dejan un residuo
    // que después se guarda como el importe de la deuda.
    totalRecibido: sumaEnCentavos(importes),
    estado: todoRecibido ? 'received' : 'partial',
    lineas,
    avisos,
  };
}

module.exports = { aplicarRecepcion, errorDeCuerpo };
