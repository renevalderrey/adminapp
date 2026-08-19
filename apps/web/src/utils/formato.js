// ════════════════════════════════════════════
//  FAVALIO · Cómo se escribe un importe y cómo se escribe una fecha
//
//  Las dos funciones estaban adentro de `components/PanelVenta.jsx` y son las
//  dos versiones correctas que había en el repositorio. Se sacan acá porque
//  FR-052 pide «reutilizando `fechaCorta`», y hasta hoy reutilizarla
//  significaba copiarla — que es exactamente cómo se llegó a tener siete
//  funciones llamadas `pesos` escritas por separado, más otras escritas como
//  `formatCurrency` en las pantallas viejas.
//
//  ── Qué se unificó en esta pasada, y qué NO ──
//
//  Se mudaron acá las de `Comparador.jsx`, `HistorialDeCostos.jsx`,
//  `Inventory.jsx`, `InvoicesList.jsx`, `PanelProducto.jsx` e
//  `impresionInventario.js`, más los `formatCurrency` de `Reports.jsx` y
//  `Dashboard.jsx`, y las dos `fechaDeHoy`/`hoy()` gemelas de `Orders.jsx` y
//  `PurchaseOrders.jsx`. Lo que queda afuera está anotado en la guardia de
//  `formato.test.js`, archivo por archivo y con su motivo: no es una lista de
//  permisos, es el registro de lo que falta.
//
//  **Las diferencias que había NO se aplanaron.** Tres de las copias no eran
//  la misma función con otro nombre y por eso cada una tiene acá su propia
//  entrada, con el motivo escrito:
//
//   · `pesosRedondos` — el valorizado del inventario entero, sin centavos.
//   · `pesosDeLista` — precios de proveedor: los centavos se muestran solo si
//     el precio los tiene.
//   · `importeAbreviado` — los indicadores del panel, en «$1,2M».
//
//  Aplanar una de esas habría cambiado lo que se ve en pantalla sin que
//  ningún test lo dijera, que es peor que la duplicación.
//
//  ── Por qué `maximumFractionDigits` NO es redundante ──
//
//  Es la mitad que se olvida, y se olvidó: `PurchaseOrders.jsx:156`,
//  `Reports.jsx:85` y `Dashboard.jsx:82` fijaban `minimumFractionDigits: 2` y
//  no el máximo. El máximo por defecto es 3, así que `1234.567` salía
//  «1.234,567»: en la misma columna de pesos convivían dos decimales y tres,
//  según qué decimales trajera el dato. Nada fallaba, la pantalla abría, y los
//  números no se podían comparar de un vistazo — que es para lo que están
//  alineados a la derecha y en `.num`.
//
//  Por eso ninguna función de este archivo llama a `toLocaleString` con las
//  opciones sueltas: todas pasan por `enEsAr`, que **exige los dos extremos**.
//  Un máximo no se puede olvidar cuando el parámetro es obligatorio.
//
//  ── Por qué `fechaDeHoy` vive acá y no en cada pantalla ──
//
//  `new Date().toISOString().slice(0, 10)` pasa por UTC: en Argentina (UTC−3)
//  toda la tarde del día 5 se guarda como día 6, así que el pago hecho a las
//  21:30 del 31 aparece en el mes siguiente. Estaba resuelto —bien— en tres
//  archivos distintos, cada uno con su copia. Tres copias de una corrección
//  son tres lugares donde puede volver el defecto y solo uno donde se arregla.
//
//  ── Por qué `fechaCorta` no pasa por `new Date()` ──
//
//  Un `DATEONLY` viaja como «2026-08-01», y `new Date('2026-08-01')` lo lee
//  como medianoche **UTC**: en Argentina (UTC−3) eso es el 31 de julio a las
//  21, así que el movimiento del primero de agosto se muestra en julio y se
//  lee en el mes equivocado del estado de cuenta. El string se parte a mano,
//  sin pasar por `Date`, y así no hay zona horaria que opine.
// ════════════════════════════════════════════

/**
 * El único lugar del que sale un número en formato argentino.
 *
 * Los dos extremos son parámetros **obligatorios y posicionales** a propósito:
 * es la forma de que no exista una llamada que fije el mínimo y se olvide el
 * máximo, que es exactamente el defecto que traían `Reports.jsx` y
 * `Dashboard.jsx`.
 *
 * ── El cuarto parámetro, y por qué existe (016) ──
 *
 * `toLocaleString('es-AR')` **agrupa los miles**: `enEsAr(1234, 0, 3)` devuelve
 * «1.234». Para un importe eso es lo correcto y por eso el valor por defecto es
 * `true`. Para una CANTIDAD no: hoy el stock de cuatro cifras se dibuja `1234`
 * —es un `{item.quantity}` crudo— y la 016 promete que después de migrar la
 * columna a `NUMERIC(14,4)` la pantalla se ve carácter por carácter como antes.
 * Con la agrupación puesta, el formateador que vino a que nada cambiara le
 * cambiaría el número a todo stock de cuatro cifras o más.
 *
 * Se agrega acá y no llamando a `toLocaleString` con las opciones sueltas
 * porque los dos extremos tienen que seguir siendo obligatorios: ese es el
 * defecto que este archivo vino a cerrar (ver el encabezado).
 */
function enEsAr(n, minimos, maximos, agrupa = true) {
  return Number(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: minimos,
    maximumFractionDigits: maximos,
    useGrouping: agrupa,
  })
}

/**
 * Una CANTIDAD de stock, de venta o de pedido: `12`, `9,6`, `0,251`, `1234`.
 *
 * Es la única función de cantidades de la web, y no es `pesos` con otro
 * formato. Tres diferencias, cada una con su motivo:
 *
 *  · **Sin ceros de relleno**: `9,6` y no `9,600`. En un ticket, «3,000 ×
 *    Creatina» se ve distinto de lo que Comprafit imprime hoy, y que nada se
 *    vea distinto es lo único que la 016 promete.
 *  · **Máximo tres decimales**: es lo que la columna `NUMERIC(14,4)` puede
 *    traer sin que el papel se llene de precisión que nadie cargó.
 *  · **Sin separador de miles**: hoy un stock de 1234 se dibuja `1234`, y
 *    agrupar los miles de las cantidades puede ser una buena idea pero no la
 *    decide una migración que promete que nada cambia.
 *
 * `Number.isFinite` corta antes de `enEsAr` a propósito: `enEsAr('tres', 0, 3)`
 * devuelve literalmente la cadena «NaN», y un «NaN» en la celda que dice «5 u.»
 * se lee como un error de carga. El cero es la lectura honesta porque la
 * columna es `NOT NULL DEFAULT 0` — la diferencia con `importeOGuion`, que sí
 * dibuja un guión, es que allá el campo puede no venir.
 */
export function cantidad(n) {
  const numero = Number(n)
  if (!Number.isFinite(numero)) return '0'

  return enEsAr(numero, 0, 3, false)
}

/**
 * Un importe en pesos argentinos, SIN el signo: `1234` → «1.234,00».
 *
 * El `$` lo pone quien la usa, porque en varias pantallas va en otro elemento
 * —con otro tamaño o en otro tono— que el número.
 *
 * `n || 0` cubre `null`, `undefined`, `''` y `NaN`: los cuatro tienen que dar
 * «0,00». Un `NaN` dibujado en una columna de plata parece un error de carga y
 * manda a revisar los datos cuando el dato es que no hay nada.
 */
export function pesos(n) {
  return enEsAr(n, 2, 2)
}

/**
 * Un importe SIN centavos: `1234567.89` → «1.234.568».
 *
 * Es el valorizado del inventario entero, que venía de `Inventory.jsx:97`. En
 * un total de siete cifras los centavos son ruido y además empujan la columna;
 * en la fila de un producto, en cambio, van, y por eso ahí se usa `pesos`.
 *
 * ⚠ **No es `pesos` con otro nombre.** Redondea, y redondear el importe de una
 * línea que después se suma es cómo un total deja de cerrar. Se usa para
 * mostrar agregados, nunca para una cuenta.
 */
export function pesosRedondos(n) {
  return enEsAr(n, 0, 0)
}

/**
 * Un precio de lista: los centavos se muestran **solo si el precio los tiene**.
 * `1200` → «1.200»; `1234.5` → «1.234,5»; `1234.567` → «1.234,57».
 *
 * Venía de `Comparador.jsx:29` y la diferencia con `pesos` es deliberada: esa
 * tabla pone una columna por proveedor y el ojo compara filas enteras. Las
 * listas de precios de proveedor son casi todas de importes redondos, así que
 * forzar «,00» en cada celda agrega dos caracteres de ruido por columna a la
 * pantalla cuyo trabajo es que se vea de un vistazo quién está más barato.
 *
 * El máximo SÍ está fijo: sin él, el proveedor que manda tres decimales
 * ensancharía su columna y desalinearía la comparación.
 */
export function pesosDeLista(n) {
  return enEsAr(n, 0, 2)
}

/**
 * El importe **con** el signo, o «-» cuando el dato no es un número.
 *
 * Es la forma que tienen las pantallas viejas (`Reports.jsx`, `Dashboard.jsx`,
 * y todavía `CashFlow`, `Customers`, `Production` y `Taxes`) y la diferencia
 * con `pesos` no es el `$`: es el guión.
 *
 * `pesos(undefined)` da «0,00» a propósito, porque en una grilla de ventas el
 * cero es el dato. Acá no: estos son campos de un reporte que la API puede no
 * mandar, y escribir «$0,00» donde no vino nada afirma que el período cerró en
 * cero cuando lo que pasó es que el reporte no trajo el campo. Son dos
 * preguntas distintas y por eso son dos funciones distintas.
 */
export function importeOGuion(val) {
  const n = parseFloat(val)
  if (Number.isNaN(n)) return '-'

  return '$' + pesos(n)
}

/**
 * El importe abreviado de los indicadores: `1234567` → «$1,2M», `45600` →
 * «$45,6K», `856.5` → «$856,50».
 *
 * Venía de `Dashboard.jsx:71`. La abreviatura es deliberada —seis tarjetas de
 * indicadores en una fila no tienen ancho para «$7.245.318,40»— y por eso no se
 * aplanó contra `importeOGuion`.
 *
 * ⚠ El tramo de menos de mil **sí** estaba mal y se corrige acá: escribía
 * `n.toLocaleString('es-AR')` sin opciones, o sea máximo tres decimales por
 * defecto. El ticket promedio es una división y llega con tres decimales, así
 * que la tarjeta mostraba «$856,567» al lado de otra que mostraba «$1,2M».
 */
export function importeAbreviado(val) {
  const n = parseFloat(val)
  if (Number.isNaN(n)) return '-'

  // El separador decimal de la abreviatura es la coma, igual que el del
  // importe entero: `toFixed` produce un punto y «$1.2M» se lee como miles.
  if (Math.abs(n) >= 1_000_000) return '$' + enEsAr(n / 1_000_000, 1, 1) + 'M'
  if (Math.abs(n) >= 1_000) return '$' + enEsAr(n / 1_000, 1, 1) + 'K'

  return '$' + pesos(n)
}

/**
 * «2026-08-01» → «01/08/2026», sin pasar por `Date` (ver el encabezado).
 *
 * Lo que no tiene forma de fecha se devuelve tal cual en vez de convertirse en
 * «Invalid Date»: si la API cambia el formato, se quiere ver qué mandó, no una
 * cadena que no dice nada.
 */
export function fechaCorta(iso) {
  const t = String(iso || '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return t || '—'
  const [a, m, d] = t.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/**
 * La fecha de un INSTANTE, leída en la zona horaria del usuario.
 *
 * ── Por qué no alcanza con `fechaCorta` ──
 *
 * `fechaCorta` recorta los diez primeros caracteres del ISO **a propósito**, y
 * eso es correcto para los `DATEONLY` que manda la API: `'2026-08-01'` es el 1
 * de agosto y parsearlo lo correría al 31 de julio. Hay un test que lo fija.
 *
 * Pero hay campos que NO son fechas: son momentos. `expires_at`, `createdAt`,
 * `validTo`, `recibido_en`. Ahí los diez primeros caracteres son la fecha **en
 * UTC**, y en Argentina —UTC−3— de las 21:00 en adelante ya es el día
 * siguiente allá.
 *
 * ⚠ El caso que lo destapó: una invitación creada un jueves a las 22:00 vence
 * siete días después, o sea el jueves siguiente a las 22:00 — pero se dibujaba
 * con la fecha del **viernes**. Miente hacia adelante, así que alguien la iba a
 * intentar usar muerta, con el enlace ya vencido y sin ninguna explicación.
 *
 * Las dos funciones conviven porque **hacen falta las dos**, y confundirlas
 * corre el día en un sentido o en el otro. Cuál usar sale de qué guarda la
 * columna: si tiene hora, es un momento.
 */
export function fechaCortaDeMomento(iso) {
  if (!iso) return '—'

  const momento = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(momento.getTime())) return String(iso)

  const dia = String(momento.getDate()).padStart(2, '0')
  const mes = String(momento.getMonth() + 1).padStart(2, '0')

  return `${dia}/${mes}/${momento.getFullYear()}`
}

/**
 * La fecha y hora que se IMPRIME en un comprobante: «08/08/2026, 21:47».
 *
 * ── Por qué no se arma con `new Date()` ──
 *
 * El punto de venta imprimía `new Date().toLocaleDateString('es-AR')`, o sea el
 * reloj del NAVEGADOR en el momento de imprimir. La carga fiscal, en cambio, va
 * a AFIP con `fechaParaAfip(zona de la empresa)`, que la calcula el servidor. Y
 * el QR del mismo papel usa `venta.date`.
 *
 * O sea que un solo comprobante tenía **tres fuentes de fecha**, y no tenían por
 * qué coincidir: una computadora con la zona mal puesta, un reloj atrasado, o
 * una venta registrada 23:59 e impresa 00:01 alcanzan para que el papel diga un
 * día y AFIP tenga otro. Sobre un comprobante fiscal eso no es un detalle de
 * presentación: es el papel que le queda al cliente.
 *
 * ⚠ Se parsea SIN `Z` a propósito. `date` y `time` son la fecha y la hora del
 * negocio tal como las guardó el servidor; leerlas como UTC las correría.
 *
 * @param {string} fecha `AAAA-MM-DD`, como la guarda la base.
 * @param {string} [hora] `HH:MM` o `HH:MM:SS`. Sin ella solo se imprime el día.
 */
export function fechaDeComprobante(fecha, hora) {
  if (!fecha) return '—'

  const momento = new Date(hora ? `${fecha}T${hora}` : `${fecha}T00:00:00`)
  if (Number.isNaN(momento.getTime())) return String(fecha)

  // ⚠ `hour12: false` explícito.
  //
  // `toLocaleString('es-AR')` a secas dibuja las 23:59 como «11:59:00» —reloj de
  // 12 horas y SIN el AM/PM—, así que en el papel una venta de las once de la
  // noche y una de las once de la mañana se leen igual. En un comprobante
  // fiscal esa hora es el dato que ubica la operación.
  //
  // Y los segundos se sacan: `time` es `HH:MM`, así que «:00» es un cero
  // inventado que se lee como precisión que no existe.
  return hora
    ? `${momento.toLocaleDateString('es-AR')}, ${momento.toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    })}`
    : momento.toLocaleDateString('es-AR')
}

/**
 * La fecha de hoy como `AAAA-MM-DD`, leída en la zona horaria del usuario.
 *
 * **No** es `new Date().toISOString().slice(0, 10)`: eso pasa por UTC, así que
 * en Argentina (UTC−3) toda la tarde del día 5 se guardaría como día 6. El pago
 * cargado a las 21:30 del 31 de julio quedaría fechado el 1 de agosto y
 * aparecería en el mes equivocado del estado de cuenta — todos los meses, y
 * solo a partir de las 21.
 *
 * Es el valor por defecto de los campos de fecha del alta, así que el error se
 * ve solo si alguien mira el campo, y a esa hora nadie lo mira.
 */
export function fechaDeHoy() {
  const ahora = new Date()
  const mes = String(ahora.getMonth() + 1).padStart(2, '0')
  const dia = String(ahora.getDate()).padStart(2, '0')

  return `${ahora.getFullYear()}-${mes}-${dia}`
}
