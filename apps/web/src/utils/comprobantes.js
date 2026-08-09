// ════════════════════════════════════════════
//  FAVALIO · Qué comprobante puede emitir la empresa, y qué IVA se muestra
//
//  ⚠ NO es `utils/comprobanteAfip.js`. Los dos nombres empiezan igual y hacen
//  cosas que no tienen nada que ver:
//
//   · `comprobanteAfip.js` es el QR de la RG 4892/2020 y el nombre del
//     comprobante para imprimir. Se usa DESPUÉS de tener el CAE.
//   · este archivo decide qué comprobantes puede OFRECER el selector, cuál
//     viene elegido, y si corresponde discriminar IVA. Se usa ANTES de cobrar.
//
//  ── El defecto que esto cierra ──
//
//  La pantalla arrancaba con `settings.tax_condition === 'RI' ? 'afip_b' :
//  'afip_c'` y la lista de opciones solo ofrecía Factura C cuando la condición
//  era EXACTAMENTE `'Monotributo'`. Una empresa `Exento` —una de las tres
//  condiciones válidas— quedaba con el estado en `afip_c` y sin esa opción en
//  el `<select>`: se veía seleccionado «Remito» y se emitía una Factura C. Dos
//  cosas distintas en la misma pantalla, y la que mandaba era la que no se veía.
//
//  Del lado del servidor `Exento` YA emitía Factura C (`resolverComprobante`,
//  `routes/sales.js`), así que el defecto era solo del selector.
// ════════════════════════════════════════════

import { nombreDeRuta } from '@/components/navegacion'

/**
 * El comprobante que viene elegido para cada condición fiscal.
 *
 * `Exento` se comporta como `Monotributo` —lo decidió la funcionalidad 009— y
 * cualquier condición desconocida también: Factura C es la que no discrimina
 * IVA, y ofrecer de más acá significa emitir un comprobante que la empresa no
 * puede emitir.
 */
export function comprobanteInicial(condicionFiscal) {
  return condicionFiscal === 'RI' ? 'afip_b' : 'afip_c'
}

// ⚠ El nombre de la pantalla sale de la barra lateral. Decía «en Ajustes», y
// no hay ninguna pantalla que se llame así: es «Facturación AFIP». Este texto
// lo lee alguien que está por cobrar y descubre que no puede facturar, o sea
// justo cuando no tiene tiempo de buscar.
const SIN_AFIP =
  `Configurá el CUIT y el punto de venta de AFIP en ${nombreDeRuta('/facturacion')} `
  + 'para emitir comprobantes fiscales.'

/**
 * Los comprobantes que puede ofrecer el selector, en orden.
 *
 * Los internos —Remito y Recibo X— están SIEMPRE: no dependen de AFIP.
 *
 * Sin AFIP configurado, los fiscales van `disponible: false` **con motivo**, no
 * ausentes: un comprobante que no está no se puede pedir; uno deshabilitado que
 * dice por qué, sí. Y el aviso llega ANTES de cobrar, no después de haber
 * registrado la venta (FR-055).
 *
 * @param {object} opciones
 * @param {string} opciones.condicionFiscal `RI` · `Monotributo` · `Exento`.
 * @param {boolean} opciones.afipConfigurado CUIT y punto de venta cargados.
 * @returns {Array<{valor: string, etiqueta: string, fiscal: boolean,
 *   disponible: boolean, motivo: string|null}>}
 */
export function comprobantesDisponibles({ condicionFiscal, afipConfigurado } = {}) {
  const fiscales = condicionFiscal === 'RI'
    // El orden importa: el primero es el que viene elegido para un RI.
    ? [{ valor: 'afip_b', etiqueta: 'Factura B' }, { valor: 'afip_a', etiqueta: 'Factura A' }]
    // Monotributo, Exento y cualquier otra: Factura C. Es el defecto 1 entero.
    : [{ valor: 'afip_c', etiqueta: 'Factura C' }]

  return [
    ...fiscales.map((c) => ({
      ...c,
      fiscal: true,
      disponible: afipConfigurado === true,
      motivo: afipConfigurado === true ? null : SIN_AFIP,
    })),
    { valor: 'remito', etiqueta: 'Remito', fiscal: false, disponible: true, motivo: null },
    { valor: 'recibo_x', etiqueta: 'Recibo X', fiscal: false, disponible: true, motivo: null },
  ]
}

/** Los dos comprobantes de un Responsable Inscripto que llevan IVA discriminado. */
const CON_IVA_DISCRIMINADO = ['afip_a', 'afip_b']

/**
 * El desglose Subtotal / IVA del pie de cobro.
 *
 * Devuelve `null` —o sea: no se dibuja nada— salvo que la empresa sea `RI` **y**
 * el comprobante sea Factura A o B. Un monotributista no discrimina IVA
 * —`afipService` le manda `ImpIVA: 0`— y mostrarle una línea de IVA es decirle
 * que cobró algo que no cobró.
 *
 * La cuenta es la MISMA que hace el servidor (`afipService.js`): el total es IVA
 * **incluido**, el neto sale de dividir por 1,21 y el IVA es la diferencia. Se
 * calcula así y no como `neto × 0,21` para que los dos números sumen el total
 * al centavo: con la multiplicación, el redondeo deja diferencias de un centavo
 * que en un comprobante fiscal no cierran.
 *
 * ⚠ Supone 21 % para todo el ticket, igual que el servidor. Las alícuotas
 * distintas son el proyecto 3 de PROXIMOS-PROYECTOS.
 */
export function desglosarIva({ total, condicionFiscal, comprobante } = {}) {
  if (condicionFiscal !== 'RI') return null
  if (!CON_IVA_DISCRIMINADO.includes(comprobante)) return null

  // Se exige un número de verdad y no `Number(total)`: `Number(null)` y
  // `Number('')` valen 0, y un desglose de $0,00 dibujado a partir de un total
  // que nunca llegó se lee como un ticket vacío en vez de como un error.
  if (typeof total !== 'number' || !Number.isFinite(total)) return null

  const neto = parseFloat((total / 1.21).toFixed(2))
  const iva = parseFloat((total - neto).toFixed(2))

  return { neto, iva, alicuota: 21 }
}
