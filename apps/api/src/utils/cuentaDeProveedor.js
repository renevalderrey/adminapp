// ════════════════════════════════════════════
//  FAVALIO · La aritmética de la cuenta corriente de un proveedor
//
//  Decisión 4 del plan: **el saldo lo calcula el servidor**. Hasta este hito lo
//  sumaba el navegador (`Orders.jsx:93-98`), acumulando `parseFloat` sobre
//  DECIMAL que el driver devuelve como texto, sobre todos los movimientos que
//  le habían llegado. Es el mismo error que el total de una venta calculado por
//  el cliente.
//
//  ── Por qué la agregación va en SQL y la aritmética acá ──
//
//  El `GROUP BY supplier_id, type` lo tiene que hacer Postgres: traer todos los
//  movimientos para sumarlos en JS es exactamente el hallazgo 7 de la spec. Pero
//  los dobles de `tests/helpers/modelosFalsos.js` no entienden `group`, ni
//  `Op.*`, ni `order`, ni `limit` —lo dice su encabezado—, así que una suma
//  escrita adentro del handler **no la alcanza ningún test unitario**.
//
//  Partido así, la parte que decide plata se prueba con arreglos planos y la
//  parte que solo trae filas se verifica contra Postgres en un paso manual. Es
//  el mismo corte que hizo `exportVentas.js` y por el motivo escrito ahí.
//
//  ── Por qué todo suma en centavos ──
//
//  FR-050. `0.1 + 0.2` es `0.30000000000000004` y una cuenta de veinte
//  movimientos termina diciendo `1234.5600000000002`. De ese número cuelga el
//  badge «Saldado», que compara contra cero: un residuo de coma flotante
//  convierte una cuenta cancelada en una cuenta con deuda, y no falla nada.
//
//  ── Una sola fuente para el saldo ──
//
//  FR-101: el saldo del listado, el de la ficha, el que bloquea el borrado y el
//  `saldo_final` del archivo salen todos de `resumenDeCuenta`. Dos sumas
//  escritas por separado se separan, y el día que difieran en un centavo nadie
//  va a saber cuál de las dos está mal.
// ════════════════════════════════════════════

const { aCentavos, deCentavos, sumaEnCentavos } = require('./centavos');

/** Las dos etiquetas del archivo exportado, por tipo de movimiento. */
const ETIQUETAS_DE_MOVIMIENTO = {
  // «Pedido» y no «Deuda» porque es la palabra que el sistema viejo escribía en
  // el asiento (`legacy:8268`) y la que el contador de Comprafit viene leyendo.
  deuda: 'Pedido',
  pago: 'Pago',
};

/**
 * El importe de una fila, venga del `SUM` agrupado o de la fila cruda.
 *
 * La consulta agregada nombra la columna `total` (`[fn('SUM','amount'),'total']`)
 * y una lectura normal de `supplier_movements` la trae como `amount`. Aceptar
 * las dos es lo que permite que el listado, la ficha, el bloqueo del borrado y
 * el archivo exportado usen **la misma** función: si cada camino escribiera su
 * propia suma, FR-101 dependería de que nadie se distraiga.
 *
 * Los dos llegan como **string**: Postgres devuelve DECIMAL como texto y el
 * `SUM` también.
 */
function importeDe(fila) {
  if (!fila) return 0;
  return fila.total !== undefined && fila.total !== null ? fila.total : fila.amount;
}

/**
 * Los tres números de la cuenta, a partir de las filas de UN proveedor.
 *
 * @param {Array<{type: string, total?: string|number, amount?: string|number}>} filas
 *   Las del `GROUP BY supplier_id, type` —dos como mucho— o los movimientos
 *   crudos. Cualquier `type` que no sea `deuda` ni `pago` se ignora: el ENUM
 *   solo tiene esos dos y una tercera etiqueta sería un dato roto, no un tipo
 *   nuevo que haya que sumar a ciegas.
 * @returns {{deuda: number, pagado: number, saldo: number}}
 *   `saldo = deuda − pagado`. **Positivo = se le debe al proveedor.**
 */
function resumenDeCuenta(filas = []) {
  const lista = Array.isArray(filas) ? filas : [];

  const deudaEnCentavos = lista
    .filter((f) => f && f.type === 'deuda')
    .reduce((acc, f) => acc + aCentavos(importeDe(f)), 0);

  const pagadoEnCentavos = lista
    .filter((f) => f && f.type === 'pago')
    .reduce((acc, f) => acc + aCentavos(importeDe(f)), 0);

  return {
    deuda: deCentavos(deudaEnCentavos),
    pagado: deCentavos(pagadoEnCentavos),
    // La resta también va en centavos: restar los dos números en pesos
    // devolvería el residuo que las dos sumas acaban de sacar.
    saldo: deCentavos(deudaEnCentavos - pagadoEnCentavos),
  };
}

/**
 * Lo que se le pidió al proveedor y todavía no llegó.
 *
 * Es la decisión 2 de la spec hecha número: **la deuda es la mercadería
 * recibida**, así que una orden emitida y no entregada no genera deuda. Pero el
 * sistema viejo contaba al emitir, y ese número es el que Comprafit leyó durante
 * años: va **al lado** del saldo, con su etiqueta.
 *
 * ⚠ **Solo cuentan `pending` y `partial`.** Una orden anulada no espera nada, y
 * una recibida tampoco. Sin el filtro, anular una orden dejaría su importe
 * sumando para siempre en «pendiente de recibir».
 *
 * @param {Array<{status?: string, detail?: Array}>} ordenes
 * @returns {number} En pesos, con dos decimales exactos.
 */
function pendienteDeRecibir(ordenes = []) {
  const abiertas = (Array.isArray(ordenes) ? ordenes : [])
    .filter((o) => o && (o.status === 'pending' || o.status === 'partial'));

  const importes = [];

  for (const orden of abiertas) {
    for (const linea of orden.detail || []) {
      const pedido = Number(linea.quantity) || 0;
      const recibido = Number(linea.quantity_received) || 0;
      // Nunca negativo: el servidor recorta a lo pendiente, pero una orden
      // vieja puede tener más recibido que pedido de antes de ese recorte, y
      // esa línea no puede restarle a las demás.
      const falta = Math.max(pedido - recibido, 0);

      if (falta === 0) continue;

      importes.push(falta * (Number(linea.unit_price) || 0));
    }
  }

  return sumaEnCentavos(importes);
}

/**
 * Cada movimiento de la página con su saldo acumulado.
 *
 * @param {Array<{type: string, amount: string|number}>} movimientos
 *   Los de **esta página**, en el orden en que los devuelve el endpoint: del más
 *   nuevo al más viejo.
 * @param {number} saldoInicial El saldo al final del período anterior al
 *   movimiento más viejo de esta página.
 * @returns {Array<object>} Los mismos, descendentes, cada uno con `saldo`.
 *
 * ⚠ **El acumulado se calcula ASCENDENTE y se devuelve DESCENDENTE.** Un saldo
 * acumulado solo significa algo leído del más viejo al más nuevo; la pantalla lo
 * muestra al revés porque es como se lee una cuenta corriente.
 *
 * ⚠ **Y sin `saldoInicial` la página 2 arrancaría en cero**, o sea que sería la
 * suma de un subconjunto: la última fila del archivo no coincidiría con el saldo
 * grande de la pantalla. Es exactamente lo que FR-101 prohíbe.
 */
function conSaldoAcumulado(movimientos = [], saldoInicial = 0) {
  const descendentes = Array.isArray(movimientos) ? movimientos : [];

  let acumulado = aCentavos(saldoInicial);

  // Se recorre al revés —del más viejo al más nuevo— y se anota el saldo en cada
  // uno; el arreglo de salida conserva el orden de entrada.
  const conSaldo = new Array(descendentes.length);

  for (let i = descendentes.length - 1; i >= 0; i--) {
    const m = descendentes[i];
    const importe = aCentavos(m && m.amount);

    acumulado += m && m.type === 'pago' ? -importe : importe;

    conSaldo[i] = { ...m, saldo: deCentavos(acumulado) };
  }

  return conSaldo;
}

/**
 * Una fila del archivo del contador: las seis columnas más el CUIT.
 *
 * **No es un asiento contable formal** —eso necesita un plan de cuentas que
 * Favalio no tiene— y está escrito así en la spec para que nadie lo descubra en
 * la reunión con el contador.
 *
 * @param {object} movimiento
 * @param {number} saldo El acumulado después de este movimiento.
 * @param {{name?: string, cuit?: string}} proveedor
 */
function filaDeCuentaParaExport(movimiento = {}, saldo = 0, proveedor = {}) {
  const esPago = movimiento.type === 'pago';
  const importe = Number(movimiento.amount) || 0;

  return {
    // DATEONLY: viaja como '2026-07-28' y no se pasa por `new Date()` en ningún
    // punto del camino. `new Date('2026-08-01')` se interpreta en UTC y en
    // Argentina muestra el 31/07.
    fecha: movimiento.date,
    tipo: ETIQUETAS_DE_MOVIMIENTO[movimiento.type] || movimiento.type || '—',
    // Sin notas, la celda dice qué es la fila en vez de quedar vacía: una
    // columna «descripción» en blanco obliga a mirar Debe y Haber para saber
    // qué pasó.
    descripcion: movimiento.notes || (esPago ? 'Pago al proveedor' : 'Mercadería recibida'),
    // NÚMEROS, no strings. Es la trampa de los importes argentinos vista desde
    // el lado de la escritura: si la celda dice el texto «1.234,50», Excel la
    // toma como texto en un idioma y como 1234.5 en otro, la columna no suma, y
    // el archivo abre, se ve bien y está mal.
    debe: esPago ? 0 : importe,
    haber: esPago ? importe : 0,
    saldo: Number(saldo) || 0,
    // STRING, y a propósito (FR-099): once dígitos inferidos como número salen
    // en notación científica y pierden los últimos, igual que pasaba con el CAE.
    cuit: proveedor && proveedor.cuit ? String(proveedor.cuit) : '',
  };
}

// ── Lo que el listado necesita para armar una respuesta por proveedor ──

/**
 * Las filas de una consulta agrupada, indexadas por `supplier_id`.
 *
 * El listado hace una consulta por tabla para TODOS los proveedores de la
 * página y después reparte: una consulta por proveedor sería el problema N+1
 * que este corte viene a cerrar.
 *
 * @param {Array<{supplier_id: number}>} filas
 * @returns {Map<number, object[]>}
 */
function agruparPorProveedor(filas = []) {
  const porProveedor = new Map();

  for (const fila of Array.isArray(filas) ? filas : []) {
    if (!fila) continue;

    const id = fila.supplier_id;
    if (!porProveedor.has(id)) porProveedor.set(id, []);
    porProveedor.get(id).push(fila);
  }

  return porProveedor;
}

/**
 * Cuántas filas de la tabla representan estas filas.
 *
 * ⚠ **Acepta las dos formas a propósito.** Contra Postgres las filas vienen del
 * `COUNT` agrupado y traen `n`; contra los dobles de `modelosFalsos` —que no
 * entienden `group`— viene una fila por movimiento y no hay `n`. Sin esto, el
 * contador diría 2 donde hay 23, y solo en producción.
 */
function conteoAgrupado(filas = []) {
  return (Array.isArray(filas) ? filas : []).reduce((acc, f) => {
    if (!f) return acc;
    return acc + (f.n === undefined || f.n === null ? 1 : Number(f.n) || 0);
  }, 0);
}

// ── La búsqueda por nombre (FR-059) ──

/**
 * Los acentos que se normalizan, y su equivalente sin acento.
 *
 * Las dos cadenas se pasan tal cual al `translate()` de Postgres **y** las usa
 * `sinAcentos` del lado de JS: es la misma lista, escrita una sola vez. Si
 * fueran dos listas, el patrón que sale del navegador y la columna contra la
 * que se compara podrían normalizar distinto, y la búsqueda devolvería vacío
 * sin que nada falle.
 *
 * ⚠ **`translate()` es una función del núcleo de Postgres.** La alternativa
 * obvia —la extensión `unaccent`— necesita permisos de superusuario en una base
 * administrada, y por eso `utils/filtroVentas.js:152` dejó la búsqueda de
 * ventas sensible a acentos. Acá FR-059 lo pide explícitamente, así que se
 * resuelve sin extensión.
 */
const ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const SIN_ACENTOS = 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc';

/**
 * El texto en minúsculas y sin acentos, igual que lo deja el `translate()` de
 * la consulta.
 */
function sinAcentos(texto) {
  const bajo = String(texto == null ? '' : texto).toLowerCase();

  let salida = '';

  for (const caracter of bajo) {
    const i = ACENTOS.indexOf(caracter);
    salida += i === -1 ? caracter : SIN_ACENTOS[i];
  }

  return salida;
}

module.exports = {
  resumenDeCuenta,
  pendienteDeRecibir,
  conSaldoAcumulado,
  filaDeCuentaParaExport,
  agruparPorProveedor,
  conteoAgrupado,
  sinAcentos,
  ACENTOS,
  SIN_ACENTOS,
  ETIQUETAS_DE_MOVIMIENTO,
};
