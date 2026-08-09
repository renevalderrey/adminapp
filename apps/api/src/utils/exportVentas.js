// ════════════════════════════════════════════
//  FAVALIO · Lo que se escribe en el archivo del historial de ventas
//
//  Estas funciones vivian adentro del handler de `GET /api/sales/export`. Ahi
//  no las tocaba ningun test: la verificacion aplico mutaciones que revertian
//  requisitos concretos —la etiqueta de estado, el CAE como numero, el total
//  como texto— y las 684 pruebas seguian pasando. Un archivo que sale mal no
//  falla: abre, se ve bien, y el total no da.
//
//  Son puras a proposito. Lo unico que hace el handler es consultar y mapear;
//  todo lo que decide QUE dice cada celda esta aca, donde se puede probar sin
//  base de datos.
// ════════════════════════════════════════════

const { estadoVenta } = require('./estadoVenta');

/**
 * Etiquetas de medio de pago. Son las del sistema anterior, que es lo que el
 * usuario leyo durante años en sus planillas: cambiarlas ahora hace que dos
 * exportaciones del mismo dato no se puedan comparar.
 *
 * Los dos ultimos son historicos: estan guardados en ventas reales y el control
 * del punto de venta NO los ofrece.
 *
 *  · `tc` viene del sistema anterior y significa «tarjeta, sin decir cual».
 *  · `tc3` lo escribio el propio punto de venta durante meses, y no estaba en
 *    ninguna lista: se exportaba crudo por el `|| venta.payment_method` de mas
 *    abajo, se veia crudo en el panel de detalle y aparecia como una clave sin
 *    etiqueta en el panel de control. Nadie lo vio porque una etiqueta que
 *    falta no hace fallar nada: se muestra el codigo.
 *
 * Las ventas viejas NO se migran: nada en la fila dice si esa tarjeta fue Visa,
 * Master o Naranja, y reescribir el registro contable de una operacion cerrada
 * a partir de una adivinanza es peor que dejarlo. El valor sigue significando
 * lo que significaba.
 *
 * ⚠ `apps/web/src/utils/mediosDePago.js` tiene la misma lista del lado del
 * navegador, y `apps/web/src/tests/mediosDePago.test.js` verifica que las dos
 * no se vuelvan a separar. Agregar un medio aca sin agregarlo alla —o al reves—
 * hace fallar ese test.
 */
const ETIQUETAS_DE_PAGO = {
  ef: 'Efectivo',
  tr: 'Transferencia',
  qr: 'QR',
  td: 'T. Débito',
  tc1: 'Créd. 1 pago',
  tc3v: 'Visa 3c',
  tc3m: 'Master 3c',
  tc3n: 'Naranja 3c',
  al: 'Alianza',
  tc: 'T. Crédito',
  tc3: 'T. Crédito 3c',
};

const ETIQUETAS_DE_TIPO = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' };

/**
 * El identificador del comprobante fiscal: «0005-00014882».
 *
 * Los tres campos juntos —punto de venta, tipo y numero— son lo que identifica
 * un comprobante ante ARCA; el numero suelto no identifica nada, porque la
 * numeracion es correlativa POR punto de venta. Una venta sin comprobante
 * fiscal no tiene numero: va el id de la operacion, que es lo unico que se
 * puede dictar por telefono para encontrarla.
 */
function numeroDeComprobanteFormateado(venta) {
  if (!venta.afip_cae || !venta.afip_nro) return venta.id;

  const pv = String(venta.afip_pv || 0).padStart(4, '0');
  const nro = String(venta.afip_nro).padStart(8, '0');
  return `${pv}-${nro}`;
}

/** Una fila del archivo: las diez columnas, en orden. */
function filaDeExport(venta) {
  return {
    fecha: venta.date,
    hora: venta.time,
    tipo: ETIQUETAS_DE_TIPO[venta.afip_type] || 'Sin comprobante fiscal',
    comprobante: numeroDeComprobanteFormateado(venta),
    // Como string: el navegador lo escribe como celda de texto para que Excel
    // no convierta 14 digitos a notacion cientifica y pierda los ultimos.
    cae: venta.afip_cae || '',
    cliente: (venta.customer && venta.customer.name) || venta.customer_name || 'Consumidor final',
    sucursal: (venta.puntoDeVenta && venta.puntoDeVenta.name) || '—',
    // La misma etiqueta que el badge de la fila: si se derivaran por separado,
    // el archivo terminaria diciendo algo distinto de la pantalla.
    estado: estadoVenta(venta).etiqueta,
    medio_de_pago: ETIQUETAS_DE_PAGO[venta.payment_method] || venta.payment_method || '—',
    // NUMERO, no string. El DECIMAL vuelve como texto del driver, y una
    // columna de texto no suma en la planilla: el archivo abre, se ve bien, y
    // el total no da.
    total: Number(venta.total) || 0,
  };
}

/**
 * El total del periodo que muestra la pantalla, a partir de lo que devolvio
 * `Sale.sum('total')`.
 *
 * El DECIMAL vuelve como STRING desde el driver de Postgres. Sin este paso la
 * pantalla recibe texto y lo concatena en vez de sumarlo, sin que nada falle:
 * el numero de arriba deja de coincidir con la columna Total del archivo.
 *
 * Un periodo sin ventas devuelve `null` desde Sequelize, y ahi el total es 0,
 * no «null» impreso en el encabezado.
 *
 * Vive junto a la fila del archivo porque los dos numeros tienen que decir lo
 * mismo: el total de la pantalla es la suma de la columna Total del `.xlsx`.
 */
function totalDelPeriodo(suma) {
  return parseFloat(suma) || 0;
}

module.exports = {
  filaDeExport,
  numeroDeComprobanteFormateado,
  totalDelPeriodo,
  ETIQUETAS_DE_PAGO,
  ETIQUETAS_DE_TIPO,
};
