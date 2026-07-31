// ════════════════════════════════════════════
//  Punto de equilibrio (BEP)
//
//  Responde "qué margen necesito para cubrir mis gastos fijos". De acá salen
//  las sugerencias de precio, así que un error se traduce directo en vender
//  por debajo del costo de operación.
//
//  ── La distinción que importa ──
//
//  Hay dos formas de expresar lo mismo y NO son intercambiables:
//
//    margen sobre la venta  = ganancia / precio       (cuánto de lo que
//                                                      facturo es margen)
//    recargo sobre el costo = ganancia / costo        (cuánto le sumo al
//                                                      costo para el precio)
//
//  Con costo 100 y precio 134: el recargo sobre costo es 34%, pero el margen
//  sobre la venta es 34/134 = 25,4%. Confundirlos subestima el precio que hace
//  falta.
//
//  El punto de equilibrio se plantea sobre la VENTA: los gastos fijos se
//  cubren con una fracción de lo facturado. Pero el comerciante fija precios
//  aplicando un recargo al COSTO. Por eso hay que dar los dos números, cada
//  uno con su nombre.
// ════════════════════════════════════════════

/**
 * Fracción de la facturación que tiene que ser margen bruto para cubrir los
 * gastos fijos.
 *
 * @returns {number} Porcentaje sobre la venta, o 0 si los datos no alcanzan.
 */
export function margenSobreVenta(gastosFijos, ventasObjetivo) {
  const gastos = Number(gastosFijos);
  const ventas = Number(ventasObjetivo);

  if (!Number.isFinite(gastos) || !Number.isFinite(ventas)) return 0;
  if (gastos <= 0 || ventas <= 0) return 0;

  return (gastos / ventas) * 100;
}

/**
 * Recargo que hay que aplicar sobre el costo para alcanzar un margen dado
 * sobre la venta.
 *
 *   recargo = margen / (100 - margen) * 100
 *
 * @returns {number|null} Porcentaje sobre el costo. null si el margen
 *   requerido es 100% o más: en ese caso ningún precio finito alcanza, porque
 *   los gastos fijos igualan o superan la facturación objetivo.
 */
export function recargoSobreCosto(margenVenta) {
  const margen = Number(margenVenta);

  if (!Number.isFinite(margen) || margen <= 0) return 0;
  if (margen >= 100) return null;

  return (margen / (100 - margen)) * 100;
}

/**
 * Calcula el punto de equilibrio a partir de los gastos fijos y la facturación
 * objetivo.
 *
 * @returns {{
 *   margenSobreVenta: number,
 *   recargoSobreCosto: number|null,
 *   viable: boolean,
 * }}
 */
export function calcularBep(gastosFijos, ventasObjetivo) {
  const margen = margenSobreVenta(gastosFijos, ventasObjetivo);
  const recargo = recargoSobreCosto(margen);

  return {
    margenSobreVenta: Math.round(margen * 10) / 10,
    recargoSobreCosto: recargo === null ? null : Math.round(recargo * 10) / 10,
    // Si los gastos fijos igualan o superan la facturación objetivo, no hay
    // precio que cierre: hay que bajar gastos o subir el objetivo de ventas.
    viable: recargo !== null && margen > 0,
  };
}

/**
 * Sugerencias de precio, expresadas como recargo sobre el costo.
 *
 * El "punto de equilibrio" cubre exactamente los gastos fijos. Las otras dos
 * agregan utilidad neta sobre la facturación, no puntos porcentuales al
 * recargo: sumar 10 puntos a un recargo sobre costo no da 10% de utilidad
 * neta, que es lo que la pantalla afirmaba.
 */
export function estrategiasDePrecio(gastosFijos, ventasObjetivo) {
  const base = margenSobreVenta(gastosFijos, ventasObjetivo);

  const construir = (utilidadNetaDeseada, clave, titulo, descripcion) => {
    const margen = base + utilidadNetaDeseada;
    const recargo = recargoSobreCosto(margen);

    return {
      clave,
      titulo,
      descripcion,
      margenSobreVenta: Math.round(margen * 10) / 10,
      recargoSobreCosto: recargo === null ? null : Math.round(recargo * 10) / 10,
    };
  };

  return [
    construir(0, 'equilibrio', 'Punto de equilibrio',
      'Cubre exactamente los gastos fijos. Sin utilidad.'),
    construir(10, 'recomendado', 'Recomendado',
      'Deja un 10% de utilidad neta sobre la facturación.'),
    construir(25, 'agresivo', 'Agresivo',
      'Deja un 25% de utilidad neta. Para productos exclusivos o de baja rotación.'),
  ];
}
