// ════════════════════════════════════════════
//  Código QR de los comprobantes electrónicos (RG 4892/2020)
//
//  Desde abril de 2021 todo comprobante electrónico tiene que llevar impreso
//  un QR con los datos de la operación codificados. Sin él, el comprobante no
//  cumple la resolución.
//
//  El QR apunta a https://www.afip.gob.ar/fe/qr/?p=<json en base64>, y ese
//  JSON tiene una estructura fija que ARCA valida al escanearlo.
//
//  Especificación: https://www.afip.gob.ar/fe/qr/especificaciones.asp
// ════════════════════════════════════════════

const BASE_QR = 'https://www.afip.gob.ar/fe/qr/?p=';

/**
 * Tipo de documento del receptor, según la tabla de ARCA.
 *  80 = CUIT · 86 = CUIL · 96 = DNI · 99 = Consumidor Final
 */
export function tipoDocumentoReceptor(documento) {
  const limpio = String(documento || '').replace(/\D/g, '');

  if (limpio.length === 11) return 80;
  if (limpio.length >= 7 && limpio.length <= 8) return 96;
  return 99; // Consumidor final: sin documento identificado.
}

/** Número de documento del receptor. 0 cuando es consumidor final. */
export function numeroDocumentoReceptor(documento) {
  const limpio = String(documento || '').replace(/\D/g, '');
  const tipo = tipoDocumentoReceptor(limpio);

  return tipo === 99 ? 0 : Number(limpio);
}

/**
 * Arma el objeto que ARCA espera dentro del QR.
 *
 * Los nombres de las claves y el orden son los de la especificación: no se
 * pueden renombrar ni omitir.
 *
 * @param {object} datos
 * @param {string} datos.fecha       Fecha de emisión, YYYY-MM-DD.
 * @param {string|number} datos.cuitEmisor
 * @param {number} datos.puntoDeVenta
 * @param {number} datos.tipoComprobante
 * @param {number} datos.numeroComprobante
 * @param {number} datos.importe     Importe total.
 * @param {string} [datos.documentoReceptor]
 * @param {string|number} datos.cae
 */
export function datosDelQr({
  fecha,
  cuitEmisor,
  puntoDeVenta,
  tipoComprobante,
  numeroComprobante,
  importe,
  documentoReceptor,
  cae,
}) {
  return {
    ver: 1,
    fecha,
    cuit: Number(String(cuitEmisor || '').replace(/\D/g, '')),
    ptoVta: Number(puntoDeVenta),
    tipoCmp: Number(tipoComprobante),
    nroCmp: Number(numeroComprobante),
    importe: Number(importe),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: tipoDocumentoReceptor(documentoReceptor),
    nroDocRec: numeroDocumentoReceptor(documentoReceptor),
    // 'E' = CAE (el que emite el WSFE). 'A' seria CAEA.
    tipoCodAut: 'E',
    codAut: Number(cae),
  };
}

/**
 * URL completa del QR, lista para codificar en la imagen.
 *
 * @returns {string|null} null si faltan datos obligatorios: es preferible no
 *   imprimir QR a imprimir uno que ARCA rechace al escanearlo.
 */
export function urlDelQr(datos) {
  const payload = datosDelQr(datos);

  // Number(null) es 0, que es finito: no alcanza con chequear que sea numero.
  // En estos campos el cero significa "falta el dato", no un valor valido.
  // El importe queda afuera a proposito: hay comprobantes en cero.
  const debenSerPositivos = ['cuit', 'ptoVta', 'tipoCmp', 'nroCmp', 'codAut'];
  for (const campo of debenSerPositivos) {
    const v = payload[campo];
    if (!Number.isFinite(v) || v <= 0) return null;
  }

  if (!payload.fecha) return null;
  if (!Number.isFinite(payload.importe)) return null;

  // btoa maneja solo latin-1; el payload es ASCII, así que alcanza.
  const base64 = btoa(JSON.stringify(payload));

  return BASE_QR + base64;
}

/**
 * Nombre legible del tipo de comprobante.
 *
 * La versión anterior hacía `type === 1 ? 'A' : type === 6 ? 'B' : 'C'`, con lo
 * cual cualquier tipo distinto de 1 y 6 se imprimía como "FACTURA TIPO C",
 * incluidas las notas de crédito.
 */
const TIPOS_COMPROBANTE = {
  1: 'FACTURA A',
  2: 'NOTA DE DÉBITO A',
  3: 'NOTA DE CRÉDITO A',
  6: 'FACTURA B',
  7: 'NOTA DE DÉBITO B',
  8: 'NOTA DE CRÉDITO B',
  11: 'FACTURA C',
  12: 'NOTA DE DÉBITO C',
  13: 'NOTA DE CRÉDITO C',
  51: 'FACTURA M',
  53: 'NOTA DE CRÉDITO M',
};

export function nombreComprobante(tipo) {
  return TIPOS_COMPROBANTE[Number(tipo)] || `COMPROBANTE TIPO ${tipo}`;
}

/**
 * Normaliza una línea del comprobante.
 *
 * Los items llegan con dos formas distintas: desde el carrito del POS usan
 * qty/price, y desde una venta ya guardada usan quantity/unit_price. La
 * versión anterior leía solo `item.qty`, así que al reimprimir un comprobante
 * desde el listado de ventas salía "undefined x Producto" y "$NaN".
 */
export function normalizarLinea(item = {}) {
  const cantidad = Number(item.quantity ?? item.qty ?? 0);
  const precio = Number(item.unit_price ?? item.price ?? 0);

  return {
    nombre: item.product_name || item.name || item.n || 'Producto',
    cantidad: Number.isFinite(cantidad) ? cantidad : 0,
    precio: Number.isFinite(precio) ? precio : 0,
    subtotal: Math.round((Number.isFinite(cantidad) ? cantidad : 0) * (Number.isFinite(precio) ? precio : 0) * 100) / 100,
  };
}
