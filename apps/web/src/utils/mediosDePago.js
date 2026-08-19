// ════════════════════════════════════════════
//  FAVALIO · Los medios de pago del punto de venta
//
//  Esta lista estaba escrita TRES veces —acá no estaba, estaba adentro de
//  `Billing.jsx`, de `components/PanelVenta.jsx` y de
//  `apps/api/src/utils/exportVentas.js`— y las tres copias ya se habían
//  separado: el POS escribía `tc3`, un código que no existía en ninguna de las
//  otras dos, así que el historial y el archivo exportado lo mostraban crudo y
//  el panel de control lo imprimía tal cual. Nadie lo vio durante meses porque
//  nada falla cuando una etiqueta no está: se muestra el código.
//
//  Del lado del navegador, esta es la única fuente. `exportVentas.js` conserva
//  la suya —son dos paquetes y el monorepo no tiene todavía uno compartido— y
//  `src/tests/mediosDePago.test.js` verifica que las dos listas no se vuelvan a
//  separar.
//
//  ── Las dos cosas que no son obvias ──
//
//  1. `segmento` y `vuelto` son DOS EJES DISTINTOS. El segmento decide el
//     PRECIO; la bandera decide si aparece el bloque de vuelto. Una
//     transferencia cotiza como efectivo y NO lleva vuelto: hasta ahora se
//     registraba como `ef`, así que el bloque de vuelto aparecía cuando no
//     correspondía y el arqueo contaba como billetes plata que entró por CBU.
//
//  2. `MEDIOS` son los que el control OFRECE. Los históricos —`tc` y `tc3`—
//     están guardados en ventas reales y no se pueden ofrecer: viven en
//     `ETIQUETAS` y no en `MEDIOS`. Es la diferencia entre «se puede leer» y
//     «se puede elegir».
// ════════════════════════════════════════════

/**
 * Los tres niveles de precio, que son los tres segmentos del control.
 *
 * Son NIVELES DE PRECIO, no formas de pagar. Por eso «Créd. 1 pago» vive
 * adentro de «Efectivo»: en el sistema anterior cotiza a ese precio
 * (`legacy:6122`), y moverlo a «Tarjeta» le cambiaría el precio al cliente
 * respecto de lo que viene pagando. Es incómodo de leer y es correcto.
 */
export const SEGMENTOS = ['efectivo', 'tarjeta', 'alianza']

/**
 * Los nueve medios que el control ofrece, en el orden en que se muestran.
 *
 * `etiquetaCorta` es lo que muestra el segmento cuando el medio elegido NO es
 * el por defecto: en 400px de ticket no entra «Transferencia» adentro de un
 * botón que comparte fila con el control de cantidad.
 */
export const MEDIOS = [
  { codigo: 'ef', etiqueta: 'Efectivo', etiquetaCorta: 'Efectivo', segmento: 'efectivo', vuelto: true },
  { codigo: 'tr', etiqueta: 'Transferencia', etiquetaCorta: 'Transf.', segmento: 'efectivo', vuelto: false },
  { codigo: 'qr', etiqueta: 'QR', etiquetaCorta: 'QR', segmento: 'efectivo', vuelto: false },
  { codigo: 'td', etiqueta: 'T. Débito', etiquetaCorta: 'Débito', segmento: 'efectivo', vuelto: false },
  { codigo: 'tc1', etiqueta: 'Créd. 1 pago', etiquetaCorta: 'Créd. 1', segmento: 'efectivo', vuelto: false },
  { codigo: 'tc3v', etiqueta: 'Visa 3c', etiquetaCorta: 'Visa', segmento: 'tarjeta', vuelto: false },
  { codigo: 'tc3m', etiqueta: 'Master 3c', etiquetaCorta: 'Master', segmento: 'tarjeta', vuelto: false },
  { codigo: 'tc3n', etiqueta: 'Naranja 3c', etiquetaCorta: 'Naranja', segmento: 'tarjeta', vuelto: false },
  { codigo: 'al', etiqueta: 'Alianza', etiquetaCorta: 'Alianza', segmento: 'alianza', vuelto: false },
]

/**
 * Códigos que están GUARDADOS en ventas reales y que el control NO ofrece.
 *
 *  · `tc` viene del sistema anterior y significa «tarjeta, sin decir cuál».
 *  · `tc3` lo escribió este mismo POS durante meses (`Billing.jsx`), y no
 *    estaba en ninguna lista de etiquetas.
 *
 * Las ventas viejas NO se migran: nada en la fila dice si esa tarjeta fue Visa,
 * Master o Naranja, y reescribir el registro contable de una operación cerrada
 * a partir de una adivinanza es peor que dejarlo. Lo que se hace es que dejen
 * de mostrarse crudos.
 */
const ETIQUETAS_HISTORICAS = {
  tc: 'T. Crédito',
  tc3: 'T. Crédito 3c',
}

/**
 * Los once códigos legibles: los nueve elegibles más los dos históricos.
 *
 * Es el mapa que se compara contra `ETIQUETAS_DE_PAGO` de la API.
 */
export const ETIQUETAS = {
  ...Object.fromEntries(MEDIOS.map((m) => [m.codigo, m.etiqueta])),
  ...ETIQUETAS_HISTORICAS,
}

const POR_CODIGO = Object.fromEntries(MEDIOS.map((m) => [m.codigo, m]))

/**
 * El segmento de precio de un código.
 *
 * `tc3` está acá aunque NO sea elegible: la pantalla vieja lo sigue escribiendo
 * hasta que se reescribe, y sin esta entrada todas las ventas con tarjeta
 * cotizarían al precio de efectivo, en silencio y sin que nada falle.
 *
 * Un código desconocido cae a `efectivo`, que es el nivel más barato: cobrar de
 * menos por un código que nadie reconoce se descubre; cobrar de más, no.
 */
export function segmentoDe(codigo) {
  if (codigo === 'tc3') return 'tarjeta'
  return POR_CODIGO[codigo]?.segmento || 'efectivo'
}

/** Los medios de ese segmento, en el orden de `MEDIOS`. */
export function mediosDelSegmento(segmento) {
  return MEDIOS.filter((m) => m.segmento === segmento)
}

/** El medio que se pone al elegir el segmento: `ef`, `tc3v` o `al`. */
export function medioPorDefecto(segmento) {
  return mediosDelSegmento(segmento)[0]?.codigo || 'ef'
}

/**
 * Si ese medio se paga con billetes, que es lo único que hace aparecer el
 * bloque de vuelto. Solo `ef`.
 */
export function llevaVuelto(codigo) {
  return POR_CODIGO[codigo]?.vuelto === true
}

/** Cómo se lee un código en pantalla. Un código sin etiqueta se muestra crudo. */
export function etiquetaDePago(codigo) {
  return ETIQUETAS[codigo] || codigo || '—'
}

/**
 * El precio que le toca a una línea del ticket según su medio de pago.
 *
 * Reemplaza a los tres `priceMap` escritos a mano que había en el store
 * (`addToCart`, `updateCartMethod` y `updateCartPrice`). Tres literales iguales
 * empiezan iguales y terminan distintos, y con nueve medios en vez de tres hay
 * que tocar los tres a la vez. Y es plata: equivocar el mapa cobra el precio de
 * efectivo por una compra con tarjeta y nada falla.
 *
 * @param {string} codigo Uno de los nueve, o `tc3` mientras la pantalla vieja
 *   lo siga escribiendo.
 * @param {object} linea `{ base_cash, base_card, base_alliance, price,
 *   precio_manual }`.
 */
export function precioDeLinea(codigo, linea = {}) {
  // Un precio puesto a mano gana sobre cualquier nivel: se acordó $18.000 con
  // el cliente y tocar «Tarjeta» no puede devolver el precio de lista sin
  // avisar. Para volver al de lista hay que sacar la marca primero, que es lo
  // que hace `updateCartPrice` con el campo vacío.
  if (linea.precio_manual) return linea.price

  const porSegmento = {
    efectivo: linea.base_cash,
    tarjeta: linea.base_card,
    alianza: linea.base_alliance,
  }

  const precio = porSegmento[segmentoDe(codigo)]

  // `base_card` es `null` cuando el recargo configurado no deja un precio
  // finito (`utils/precios.js`), y ahí la línea tiene que cotizar al de
  // efectivo en vez de meter un `null` en el total.
  //
  // La comprobación es `Number.isFinite` y NO un `||`: con un descuento de
  // alianza del 100 % el precio legítimo es 0, y `0 || base_cash` le cobraba el
  // precio de efectivo a una línea regalada.
  return Number.isFinite(precio) ? precio : linea.base_cash
}

// ════════════════════════════════════════════
//  El medio se elige UNA vez, y agrupado por la lista con la que cotiza
//
//  El control anterior mostraba tres botones —«Efectivo · Tarjeta · Alianza»—
//  en CADA línea del ticket y otra vez en el pie, y los nueve medios reales
//  vivían escondidos adentro de un segundo clic. Eran dos preguntas distintas
//  dibujadas con el mismo control: el segmento decide el PRECIO, el medio
//  decide CÓMO ENTRA LA PLATA.
//
//  El rediseño se queda con una sola pregunta —«cómo cobra»— y la contesta con
//  el medio real. El nivel de precio deja de ser algo que se elige: sale del
//  medio, y se DICE («cotiza con la lista efectivo») en vez de pedirse.
// ════════════════════════════════════════════

/**
 * Los cuatro medios que el pie muestra sin abrir nada.
 *
 * No son «los primeros de `MEDIOS`»: son los cuatro con los que se cobra casi
 * siempre en un mostrador. El orden lo fija la maqueta y NO el orden interno de
 * `MEDIOS`, que está ordenado por segmento.
 *
 * Los otros cinco no desaparecen: se llegan por «Otros 5», agrupados bajo la
 * lista con la que cotizan. Ese agrupamiento es el que contesta la pregunta que
 * el control viejo dejaba abierta —por qué una transferencia cobra el precio de
 * efectivo—: está escrita arriba del grupo.
 */
export const DESTACADOS = ['ef', 'td', 'tr', 'qr']

/** Cómo se lee una lista de precios cuando hay que nombrarla en pantalla. */
const NOMBRE_DE_LISTA = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  alianza: 'Alianza',
}

/**
 * El nombre de la lista con la que cotiza un segmento.
 *
 * Se usa en dos lugares que tienen que decir lo mismo: el encabezado del pie
 * («cotiza con la lista efectivo») y los grupos de «Otros N».
 */
export function nombreDeLista(segmento) {
  return NOMBRE_DE_LISTA[segmento] || NOMBRE_DE_LISTA.efectivo
}

/** El medio completo de un código, o `undefined` si no es uno de los nueve. */
export function medioDe(codigo) {
  return POR_CODIGO[codigo]
}

/**
 * Los medios que el pie dibuja como botón, dado el que está elegido.
 *
 * El elegido va SIEMPRE, aunque no sea uno de los cuatro destacados: un ticket
 * cobrado con «Naranja 3c» no puede mostrar «Efectivo» resaltado y el medio
 * verdadero escondido atrás de un desplegable. Es el mismo defecto que la
 * etiqueta corta venía a tapar en el control anterior, resuelto de raíz.
 */
export function mediosALaVista(codigo) {
  const visibles = new Set(DESTACADOS)
  if (POR_CODIGO[codigo]) visibles.add(codigo)
  return MEDIOS.filter((m) => visibles.has(m.codigo))
}

/**
 * Los que quedan fuera de la vista, agrupados por la lista con la que cotizan.
 *
 * Devuelve `[{ segmento, lista, medios }]` y omite los grupos vacíos: un
 * encabezado «Cotizan con Tarjeta» sin nada debajo se lee como una opción que
 * no anda.
 */
export function mediosAgrupados(codigo) {
  const aLaVista = new Set(mediosALaVista(codigo).map((m) => m.codigo))

  return SEGMENTOS
    .map((segmento) => ({
      segmento,
      lista: nombreDeLista(segmento),
      medios: mediosDelSegmento(segmento).filter((m) => !aLaVista.has(m.codigo)),
    }))
    .filter((grupo) => grupo.medios.length > 0)
}
