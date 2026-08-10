// ════════════════════════════════════════════
//  Los ajustes de una empresa, mezclados como corresponde
//
//  ── Por qué existe este archivo ──
//
//  La configuración de una empresa vive en **dos lugares**: el JSON
//  `empresas.settings`, que son los valores por defecto que crea el onboarding, y
//  las filas de la tabla `settings`, que es lo que el comercio configuró después.
//  **Las filas ganan.** Al revés, un `margin_efectivo` guardado en el onboarding
//  taparía para siempre el que el comercio cargó.
//
//  Esa mezcla estaba escrita a mano en `routes/general.js:524-546`, y el
//  catálogo público la necesitaba para calcular precios. Copiarla habría dejado
//  dos copias de una regla de tres líneas —el defecto que ya está documentado en
//  `mediosDePago.test.js:46`—, y la copia que se desincroniza no avisa: devuelve
//  un precio, sólo que otro.
//
//  ── Lo que esto arregla, y que no era teórico ──
//
//  `routes/catalogoPublico.js` calculaba el precio de lista con `{}` como
//  ajustes. Sin `margin_efectivo`, `calcularPrecios` toma margen 0 y devuelve
//  **el costo**: la tienda pública mostraba los productos a precio de costo, y de
//  paso le contaba el costo de compra a cualquiera con el enlace.
// ════════════════════════════════════════════

const { Empresa, Setting } = require('../models');

/**
 * @param {number} empresaId
 * @param {{transaction?: object}} opciones
 * @returns {Promise<object>} El objeto plano que espera `calcularPrecios`.
 */
async function ajustesDeLaEmpresa(empresaId, opciones = {}) {
  const transaction = opciones.transaction;

  const empresa = await Empresa.findOne({
    attributes: ['id', 'settings'],
    where: { id: empresaId },
    transaction,
  });

  const filas = await Setting.findAll({
    attributes: ['key', 'value'],
    where: { empresa_id: empresaId },
    raw: true,
    transaction,
  });

  const ajustes = Object.assign({}, (empresa && empresa.settings) || {});

  for (const fila of filas) {
    // Una fila vacía no tapa el default: es un campo que alguien abrió y cerró
    // sin escribir nada.
    if (fila.value === null || fila.value === '') continue;
    ajustes[fila.key] = fila.value;
  }

  return ajustes;
}

module.exports = { ajustesDeLaEmpresa };
