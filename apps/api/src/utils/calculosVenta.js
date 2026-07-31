// ════════════════════════════════════════════
//  ADMINAPP · Calculos de venta
//
//  El total de una venta es el registro contable de la operacion. Tiene que
//  salir del servidor a partir de las lineas, no llegar como un numero suelto
//  en el body: si el cliente lo manda y el servidor lo guarda sin mirar,
//  cualquier bug del frontend —o cualquier request armado a mano— queda
//  asentado como si fuera real.
// ════════════════════════════════════════════

/** Redondea a centavos. */
function aCentavos(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Normaliza un item de venta.
 *
 * El frontend historicamente mando los campos con varios nombres (product_name
 * / name / n, quantity / qty, unit_price / price / precio). Se aceptan todos
 * para no romper clientes viejos, pero la normalizacion vive en un solo lugar.
 */
function normalizarItem(item = {}) {
  const cantidad = Number(item.quantity ?? item.qty ?? 1);
  const precio = Number(item.unit_price ?? item.price ?? item.precio ?? 0);

  return {
    product_name: item.product_name || item.name || item.n || 'Producto',
    product_id: item.product_id || item.id || null,
    quantity: Number.isFinite(cantidad) ? cantidad : 0,
    unit_price: Number.isFinite(precio) ? precio : 0,
    payment_method: item.payment_method || item.method || item.mp || null,
  };
}

/**
 * Total de la venta a partir de sus lineas.
 *
 * Cada linea se redondea a centavos antes de sumar. Sumar en punto flotante y
 * redondear al final acumula error: con muchas lineas, el total puede diferir
 * en centavos de lo que muestra el ticket, que redondea linea por linea.
 */
function calcularTotal(items = []) {
  const total = items.reduce((acc, item) => {
    const { quantity, unit_price } = normalizarItem(item);
    return acc + aCentavos(quantity * unit_price);
  }, 0);

  return aCentavos(total);
}

/**
 * Tolerancia admitida entre el total que manda el cliente y el que calcula el
 * servidor.
 *
 * No es cero porque el frontend redondea para mostrar y puede arrastrar un
 * centavo por linea. Cualquier diferencia real —un precio distinto, una linea
 * de mas, un total inventado— es de otro orden de magnitud.
 */
function tolerancia(cantidadItems) {
  return 0.02 + 0.01 * cantidadItems;
}

/**
 * Verifica que el total declarado por el cliente coincida con las lineas.
 *
 * @returns {{ ok: true, total: number } | { ok: false, total: number, declarado: number, diferencia: number }}
 */
function verificarTotal(totalDeclarado, items = []) {
  const total = calcularTotal(items);

  // Sin total declarado no hay nada que verificar: manda el calculado.
  if (totalDeclarado === undefined || totalDeclarado === null || totalDeclarado === '') {
    return { ok: true, total };
  }

  const declarado = aCentavos(totalDeclarado);
  const diferencia = Math.abs(declarado - total);

  if (diferencia > tolerancia(items.length)) {
    return { ok: false, total, declarado, diferencia: aCentavos(diferencia) };
  }

  // Coincide dentro de la tolerancia: se guarda el calculado, que es el que
  // cierra contra las lineas.
  return { ok: true, total };
}

/**
 * Metodo de pago que se deduce de las lineas de la venta.
 *
 * Devuelve el metodo solo si TODAS las lineas coinciden. Si difieren, devuelve
 * null: la venta es de pago mixto y las lineas no alcanzan para decidir un
 * unico metodo.
 *
 * La ruta usa el valor declarado por el cliente como respaldo en ese caso, que
 * es el comportamiento historico. Registrar un valor nuevo tipo 'mixto' seria
 * mas correcto, pero payment_method es un STRING libre que los reportes
 * agrupan tal cual: agregar una categoria nueva es una decision de producto.
 * Ver la duda anotada en docs/ANALISIS.md.
 *
 * @returns {string|null} El metodo unanime, o null si las lineas difieren o no
 *   traen metodo.
 */
function metodoDePago(items = []) {
  const metodos = new Set(
    items.map((i) => normalizarItem(i).payment_method).filter(Boolean)
  );

  if (metodos.size === 1) return [...metodos][0];
  return null;
}

/** true si las lineas declaran mas de un metodo de pago distinto. */
function esPagoMixto(items = []) {
  const metodos = new Set(
    items.map((i) => normalizarItem(i).payment_method).filter(Boolean)
  );
  return metodos.size > 1;
}

module.exports = {
  aCentavos,
  normalizarItem,
  calcularTotal,
  verificarTotal,
  metodoDePago,
  esPagoMixto,
  tolerancia,
};
