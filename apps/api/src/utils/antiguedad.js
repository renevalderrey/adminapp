// ════════════════════════════════════════════
//  FAVALIO · El reparto de un saldo impago por antigüedad
//
//  Vivía como método privado `_repartirPorAntiguedad` de `customerService`, que
//  ya lo usaba para DOS cosas —el aging de clientes y el de proveedores— y que
//  este hito necesita para una tercera: el Panel de control (decisión 4 del plan
//  de la 014).
//
//  Un método privado con tres consumidores no es privado: es una función pura
//  escondida adentro de un servicio que necesita base de datos para cargarse. Y
//  mientras estuvo ahí, el Panel escribió su PROPIO aging —los cuatro tramos
//  sumando lo facturado mientras el total de arriba sumaba lo impago—, que es el
//  defecto P3: dos números en la misma tarjeta, a cuarenta píxeles, que no
//  pueden cerrar nunca.
//
//  ── Es una aproximación, y eso tiene que llegar a la pantalla ──
//
//  No se imputa cada pago a un comprobante concreto: se prorratea el saldo
//  impago sobre cómo se distribuyen los comprobantes en el tiempo. Sirve para el
//  tablero; **no es respaldo contable**. La advertencia estaba escrita en el
//  docstring del método privado, donde no la lee nadie más que quien toca el
//  código: la nota al pie de la tarjeta tiene que decirlo.
//
//  ── Por qué el reparto va en centavos y con «mayor resto» ──
//
//  FR-045 pide que los cuatro tramos sumen EXACTAMENTE el total que la tarjeta
//  muestra. Redondear cada tramo por separado no lo garantiza: un saldo de
//  100,00 repartido en tres partes iguales da 33,33 × 3 = 99,99, y la tarjeta
//  vuelve a mostrar dos números que no cierran — que es justamente el defecto
//  que esta extracción viene a cerrar.
//
//  Por eso el reparto se hace en centavos enteros y el residuo se asigna por el
//  método del mayor resto: la suma de los cuatro tramos es, por construcción,
//  el saldo impago. Es la única diferencia con el método que reemplaza, y es
//  deliberada.
// ════════════════════════════════════════════

const { aCentavos, deCentavos } = require('./centavos');

/** Los cuatro tramos, en el orden en que se leen. Es también el desempate. */
const TRAMOS = ['0_30', '31_60', '61_90', '90_plus'];

const MILISEGUNDOS_POR_DIA = 1000 * 60 * 60 * 24;

/** Los cuatro tramos en cero. Nunca se devuelve `undefined` ni `NaN`. */
function tramosEnCero() {
  return { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
}

/**
 * El instante de referencia, venga como `Date` o como 'YYYY-MM-DD'.
 *
 * `hoyDelNegocio` devuelve texto y `customerService` pasa un `Date`. Restar un
 * `Date` de un string da `NaN`, y un `NaN` en `Math.floor` cae en el `else`
 * final: todo el saldo aterrizaría en «más de 90 días» sin que nada falle.
 */
function comoFecha(hoy) {
  if (hoy instanceof Date) return hoy;

  const fecha = new Date(hoy);

  return Number.isNaN(fecha.getTime()) ? new Date() : fecha;
}

/** En qué tramo cae un comprobante de `dias` de antigüedad. */
function tramoDe(dias) {
  // `<=` y no `<`: un comprobante de exactamente 30 días todavía es «0 a 30».
  // Los tres cortes son la definición del indicador, no un detalle: correr uno
  // mueve plata de una columna a otra en la tarjeta que el dueño mira.
  if (dias <= 30) return '0_30';
  if (dias <= 60) return '31_60';
  if (dias <= 90) return '61_90';
  return '90_plus';
}

/**
 * Reparte un saldo impago entre los cuatro tramos de antigüedad.
 *
 * @param {Array<object>} filas Los comprobantes que generaron la deuda —ventas a
 *   cuenta corriente, movimientos de deuda de proveedor—. Los importes pueden
 *   venir como string: los DECIMAL de Postgres llegan así.
 * @param {Date|string} hoy La fecha de referencia. **La del negocio**, no la del
 *   servidor (`utils/fechas.js`).
 * @param {object} opciones
 * @param {number} opciones.saldoImpago Lo que falta cobrar o pagar, en pesos. Es
 *   el número que la tarjeta muestra arriba, y el que los cuatro tramos suman.
 * @param {number} opciones.totalFacturado El total de los comprobantes, en pesos.
 *   Es el denominador del prorrateo.
 * @param {string} [opciones.fecha] Nombre del campo de fecha de cada fila.
 * @param {string} [opciones.importe] Nombre del campo de importe de cada fila.
 * @returns {{'0_30': number, '31_60': number, '61_90': number, '90_plus': number}}
 */
function repartirPorAntiguedad(filas, hoy, opciones = {}) {
  const {
    saldoImpago = 0,
    totalFacturado = 0,
    fecha = 'fecha',
    importe = 'monto',
  } = opciones;

  const saldoEnCentavos = aCentavos(saldoImpago);
  const totalEnCentavos = aCentavos(totalFacturado);

  // Se pregunta por `> 0` y no por `<= 0`: así un `NaN` —que no es ni mayor ni
  // menor— también cae acá. Un cliente sin ventas daba cuatro `NaN`, que
  // serializados a JSON salen como `null` y la pantalla dibuja vacío.
  if (!(saldoEnCentavos > 0) || !(totalEnCentavos > 0)) return tramosEnCero();

  const referencia = comoFecha(hoy);

  // Primera pasada: cuánto le toca a cada tramo, con fracción de centavo.
  const brutos = tramosEnCero();

  for (const fila of Array.isArray(filas) ? filas : []) {
    if (!fila) continue;

    const dias = Math.floor((referencia - new Date(fila[fecha])) / MILISEGUNDOS_POR_DIA);

    brutos[tramoDe(dias)] += aCentavos(fila[importe]) * (saldoEnCentavos / totalEnCentavos);
  }

  const sumaDeBrutos = TRAMOS.reduce((acc, t) => acc + brutos[t], 0);

  // Sin comprobantes con importe no hay sobre qué prorratear. Puede pasar si el
  // saldo viene de filas que la consulta no trajo; devolver ceros es mejor que
  // dividir por cero y devolver `NaN`.
  if (!(sumaDeBrutos > 0)) return tramosEnCero();

  // Segunda pasada: escalar a que sumen el saldo exacto y repartir en enteros.
  const escalados = TRAMOS.map((t) => (brutos[t] * saldoEnCentavos) / sumaDeBrutos);
  const enteros = escalados.map((n) => Math.floor(n));

  let residuo = saldoEnCentavos - enteros.reduce((a, b) => a + b, 0);

  // Mayor resto, desempatando por el orden de los tramos: el centavo suelto va
  // al tramo que más cerca estaba de merecerlo, y el resultado es determinista.
  const porResto = TRAMOS
    .map((t, i) => ({ i, resto: escalados[i] - enteros[i] }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  for (let k = 0; residuo > 0 && k < porResto.length * 2; k++) {
    enteros[porResto[k % porResto.length].i] += 1;
    residuo -= 1;
  }

  const tramos = tramosEnCero();

  TRAMOS.forEach((t, i) => { tramos[t] = deCentavos(enteros[i]); });

  return tramos;
}

module.exports = { repartirPorAntiguedad, TRAMOS };
