// ════════════════════════════════════════════
//  ADMINAPP · La condicion de IVA del receptor, como la espera ARCA
//
//  Son dos mundos distintos y hasta ahora nadie los unia:
//
//   - `Customer.tax_condition` guarda TEXTO. Es lo que elige el formulario de
//     Clientes ('consumidor_final', 'monotributo', 'ri', 'exento') y lo que
//     acepta la importacion masiva ('responsable_inscripto').
//   - El WSFE espera un CODIGO NUMERICO en `CondicionIVAReceptorId`.
//
//  Traducirlos mal no rompe nada visible: el comprobante sale, ARCA lo
//  autoriza, y queda declarado con una condicion fiscal que no es la del
//  comprador. Eso es lo que pasaba: la condicion se derivaba del TIPO de
//  comprobante, asi que una venta a un Responsable Inscripto se declaraba como
//  Consumidor Final con el CUIT del RI adjunto. Un comprobante emitido no se
//  corrige editandolo: hace falta una nota de credito, que el sistema todavia
//  no emite.
//
//  Por eso vive aca y no adentro de la ruta: es la pieza que hay que poder
//  testear valor por valor, incluido el valor que no se conoce.
// ════════════════════════════════════════════

/**
 * Los codigos de ARCA para la condicion frente al IVA del receptor.
 *
 * Solo los cuatro que este sistema puede producir. Los demas de la tabla de
 * ARCA (sujeto no categorizado, proveedor del exterior, cliente del exterior,
 * liberado, IVA no alcanzado) no tienen forma de cargarse en la ficha del
 * cliente, y agregarlos aca seria prometer algo que ninguna pantalla escribe.
 */
const CODIGOS_DE_ARCA = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
};

/**
 * Texto guardado en la ficha -> codigo de ARCA.
 *
 * Las claves estan normalizadas (minusculas, con guion bajo). `ri` y
 * `responsable_inscripto` son el mismo caso: el formulario de Clientes guarda
 * `ri` (`Customers.jsx:341`) y la plantilla de importacion documenta
 * `responsable_inscripto` (`import.js:108`). Aceptar uno solo dejaria a la
 * mitad de los clientes con la condicion equivocada segun por donde entraron.
 */
const CONDICIONES_CONOCIDAS = {
  ri: CODIGOS_DE_ARCA.RESPONSABLE_INSCRIPTO,
  responsable_inscripto: CODIGOS_DE_ARCA.RESPONSABLE_INSCRIPTO,
  exento: CODIGOS_DE_ARCA.EXENTO,
  consumidor_final: CODIGOS_DE_ARCA.CONSUMIDOR_FINAL,
  monotributo: CODIGOS_DE_ARCA.MONOTRIBUTO,
};

/**
 * El codigo de ARCA para la condicion fiscal escrita en la ficha del cliente.
 *
 * Devuelve `null` —y NO un valor por defecto— cuando la condicion no se
 * reconoce. La diferencia es todo el punto de esta funcion: `null` significa
 * «no se», y el que llama aplica la regla que tenia antes. Devolver 5
 * (Consumidor Final) ante un valor desconocido seria repetir en silencio
 * exactamente el error fiscal que esto vino a cerrar.
 *
 * @param {string|null|undefined} condicion Valor de `Customer.tax_condition`.
 * @returns {number|null} Codigo de ARCA, o null si no se reconoce.
 */
function condicionIvaDeAfip(condicion) {
  if (condicion === null || condicion === undefined) return null;

  // Se normaliza porque el mismo dato llego por tres puertas distintas: el
  // formulario, la importacion masiva y los datos migrados del sistema viejo.
  // 'RI', ' ri ' y 'Responsable Inscripto' son el mismo cliente.
  const clave = String(condicion)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  return CONDICIONES_CONOCIDAS[clave] || null;
}

module.exports = { condicionIvaDeAfip, CODIGOS_DE_ARCA, CONDICIONES_CONOCIDAS };
