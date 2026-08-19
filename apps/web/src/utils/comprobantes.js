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

// ════════════════════════════════════════════
//  Lo que el panel de emisión necesita saber
//
//  El pie de cobro preguntaba TODO siempre: condición frente al IVA, CUIT y
//  nombre estaban en pantalla aunque el comprobante elegido no los usara, y
//  cuáles de esos tres eran obligatorios no lo decía nadie —lo descubría el
//  servidor, después de registrar la venta, con `CUIT_REQUERIDO`—.
//
//  Acá se contesta antes: qué pide CADA comprobante, y qué queda fijo.
// ════════════════════════════════════════════

/**
 * Los comprobantes fiscales, que son los que viajan a ARCA.
 *
 * Se pregunta por el prefijo y no por una lista aparte: el valor lo arma
 * `comprobantesDisponibles` acá mismo, y una segunda lista se separa de la
 * primera el día que aparezca la nota de crédito.
 */
export function esFiscal(comprobante) {
  return typeof comprobante === 'string' && comprobante.startsWith('afip_')
}

/** Cómo se lee un comprobante cuando hay que nombrarlo adentro de una frase. */
const NOMBRES = {
  afip_a: 'Factura A',
  afip_b: 'Factura B',
  afip_c: 'Factura C',
  remito: 'Remito',
  recibo_x: 'Recibo X',
}

/**
 * El nombre del comprobante, para el botón que dice qué va a pasar.
 *
 * El botón de cobrar decía «Confirmar venta» para los cinco. Ahora dice «Cobrar
 * y emitir Factura C», que es la única forma de que quien aprieta sepa si esto
 * consume numeración de ARCA o imprime un papel interno.
 */
export function nombreDeComprobante(comprobante) {
  return NOMBRES[comprobante] || 'el comprobante'
}

/**
 * A partir de qué monto ARCA pide identificar al comprador en una venta a
 * consumidor final.
 *
 * ⚠ Es INFORMATIVO y nada más: ni esta pantalla ni el servidor lo exigen, y el
 * número lo mueve el organismo cada tanto. Se muestra para que el operador
 * sepa por qué le conviene pedir el DNI en una venta grande, no para frenarlo
 * —frenar una venta con un umbral desactualizado es peor que emitirla—.
 *
 * Lo único que SÍ se exige es el CUIT de una Factura A, y lo exige el servidor
 * (`routes/sales.js`, `CUIT_REQUERIDO`).
 */
export const UMBRAL_DE_IDENTIFICACION = 344000

/**
 * Qué datos del comprador pide cada comprobante.
 *
 * `condicionFija` no es «el valor inicial»: es que el comprobante NO admite
 * otra. Una Factura A se emite a un Responsable Inscripto y punto; dejar el
 * selector abierto ahí es ofrecer una combinación que ARCA rechaza.
 *
 * @returns {{fiscal: boolean, condicionFija: string|null, cuitObligatorio:
 *   boolean, pideCondicion: boolean, nota: string}}
 */
export function datosDelComprador(comprobante) {
  if (comprobante === 'afip_a') {
    return {
      fiscal: true,
      condicionFija: '1',
      cuitObligatorio: true,
      pideCondicion: false,
      nota: 'Una Factura A se emite a un Responsable Inscripto: el CUIT es obligatorio '
        + 'y la condición queda fija. Sin el CUIT, ARCA la rechaza.',
    }
  }

  if (esFiscal(comprobante)) {
    return {
      fiscal: true,
      condicionFija: null,
      cuitObligatorio: false,
      pideCondicion: true,
      nota: 'Sin CUIT ni DNI el comprobante sale a Consumidor final, que es lo normal en '
        + 'el mostrador.',
    }
  }

  return {
    fiscal: false,
    condicionFija: null,
    cuitObligatorio: false,
    pideCondicion: false,
    nota: 'Un Remito o un Recibo X no viajan a ARCA y no discriminan IVA: alcanza con el '
      + 'nombre, y es opcional.',
  }
}

/**
 * Por qué el botón de emitir NO se puede apretar, o `null` si sí se puede.
 *
 * Un botón deshabilitado sin motivo es un botón roto (FR-024). El único caso
 * real es el CUIT de la Factura A, y se dice acá y no después del rechazo del
 * servidor.
 */
export function motivoParaNoEmitir({ comprobante, cuit } = {}) {
  const { cuitObligatorio } = datosDelComprador(comprobante)
  if (!cuitObligatorio) return null

  const digitos = String(cuit || '').replace(/\D/g, '')
  if (digitos.length === 11) return null

  return 'Una Factura A necesita el CUIT del comprador, con sus 11 dígitos.'
}

/**
 * El detalle producto por producto que se ve ANTES de mandarlo a ARCA.
 *
 * ── Por qué las columnas de IVA no están siempre ──
 *
 * La maqueta dibuja «Neto u. · IVA 21% · Subtotal» en el panel de una **Factura
 * C**, y eso es un error del dibujo: una Factura C NO discrimina IVA —el
 * servidor le manda `ImpIVA: 0` (`afipService.js`)— y mostrarle a un
 * monotributista una columna de IVA es decirle que cobró algo que no cobró. Es
 * el mismo criterio que ya sostiene `desglosarIva`, y se mantiene: las columnas
 * aparecen solo cuando el comprobante discrimina de verdad.
 *
 * Lo que SÍ está siempre es el detalle: producto, cantidad, precio unitario y
 * subtotal. Eso es lo que el panel viene a resolver —ver qué se factura antes
 * de consumir un número correlativo—, y no depende de la alícuota.
 *
 * La cuenta por línea es la MISMA que la del total (`desglosarIva`): el precio
 * es IVA incluido, el neto sale de dividir por 1,21 y el IVA es la diferencia.
 * Los netos por línea se suman y el IVA total es `total − neto`, y no la suma
 * de los IVA de cada línea: sumar redondeos de a un centavo deja el pie del
 * comprobante sin cerrar contra el total que se cobra.
 *
 * @param {object} opciones
 * @param {Array<{id, name, qty, price}>} opciones.lineas Las del ticket.
 * @param {string} opciones.condicionFiscal De la empresa.
 * @param {string} opciones.comprobante El elegido.
 */
export function detalleDeEmision({ lineas = [], condicionFiscal, comprobante } = {}) {
  const total = lineas.reduce((suma, l) => suma + Number(l.price || 0) * Number(l.qty || 0), 0)

  const desglose = desglosarIva({
    total: parseFloat(total.toFixed(2)),
    condicionFiscal,
    comprobante,
  })

  const filas = lineas.map((l) => {
    const cantidad = Number(l.qty || 0)
    const unitario = Number(l.price || 0)
    const subtotal = parseFloat((unitario * cantidad).toFixed(2))

    return {
      id: l.id,
      nombre: l.name,
      cantidad,
      unitario,
      subtotal,
      // `null` y no 0: un cero se lee como «IVA cero», que es una afirmación
      // fiscal. Lo que pasa acá es que este comprobante no discrimina.
      neto: desglose ? parseFloat((unitario / (1 + desglose.alicuota / 100)).toFixed(2)) : null,
      iva: desglose
        ? parseFloat((subtotal - (unitario / (1 + desglose.alicuota / 100)) * cantidad).toFixed(2))
        : null,
    }
  })

  return {
    filas,
    total: parseFloat(total.toFixed(2)),
    unidades: lineas.reduce((suma, l) => suma + Number(l.qty || 0), 0),
    desglose,
  }
}
