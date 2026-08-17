// ════════════════════════════════════════════
//  FAVALIO · Cantidades
//
//  ── Por qué existe este archivo ──
//
//  Las columnas de cantidad —`sale_items.quantity`, las tres de `stock`, las
//  cuatro de `stock_movements` y `pedido_items.cantidad`— pasan de `INTEGER` a
//  `DECIMAL(14,4)`. `pg` devuelve un `NUMERIC` como **texto**, con la escala
//  puesta: un stock de doce vuelve como la cadena `"12.0000"`, y este
//  repositorio no registra —ni puede registrar— ningún `setTypeParser` global
//  (FR-027: los importes viajan como texto a propósito, y
//  `tests/integracion/centavoDelSaldo.integracion.test.js:243` lo fija).
//
//  Con un valor de texto **el operador decide, no el valor**:
//
//      '100' - 5              → 95        (la resta fuerza a número)
//      '100' + 5              → '1005'    (la suma concatena)
//      Math.max(0, '100' + 5) → 1005      (convierte DESPUÉS de concatenar)
//      '0.0000'               → truthy    (todo `|| 0` cambia de rama)
//      parseInt('0.4')        → 0         (truncar no avisa)
//
//  ── Por qué una función y no un `Number(a) + Number(b)` en cada sitio ──
//
//  El defecto nació justamente de tener la misma cuenta escrita en cuatro
//  lugares y arreglada en ninguno. Y un `Number(x) || 0` suelto convierte en
//  silencio un dato ilegible en un cero de inventario: acá hay **un solo
//  lugar** donde se decide qué pasa con `null`, con `''` y con `'tres'`, y un
//  test que lo dice. Además la guardia estática
//  (`tests/aritmeticaDeCantidades.test.js`) puede exigir la forma:
//  `sumarCantidades(` es un literal que se busca; «que hayan convertido bien»
//  no lo es.
// ════════════════════════════════════════════

/**
 * Los decimales que admite una línea de venta.
 *
 * ⚠ En la 016 vale **0**: la columna pasa a poder representar una fracción y
 * la puerta del endpoint sigue cerrada, así que se puede afirmar que ninguna
 * venta tiene una cantidad que no podía tener antes (PENDIENTE 2 de la spec).
 *
 * **La 017 la mueve a 3** —un gramo, la unidad más chica que informa una
 * balanza comercial (PENDIENTE 1, resuelto: opción A)—. El número vive acá y
 * no adentro de la ruta para que la 017 sea una línea y no una búsqueda, y el
 * test de `motivoDeCantidadInvalida` ejercita **los dos valores** aunque el
 * endpoint todavía use uno solo: una decisión que se tomó y no quedó ejecutada
 * en ningún lado se vuelve a discutir.
 *
 * No es la escala de la columna: la columna es `DECIMAL(14,4)` y sigue siendo
 * 4 para que `recipe_items` y `production_orders` —que ya son `DECIMAL(12,4)`—
 * no se degraden. Esto es la regla de negocio; aquello, la capacidad.
 */
const DECIMALES_DE_UNA_LINEA_DE_VENTA = 0;

/** Los decimales que la columna `DECIMAL(14,4)` puede guardar sin cambiar el valor. */
const DECIMALES_DE_LA_COLUMNA = 4;

/**
 * El valor absoluto más grande que entra en `DECIMAL(14,4)`.
 *
 * 14 dígitos en total menos 4 de escala son 10 enteros. Por encima de esto
 * Postgres responde «numeric field overflow», que es un 500 con nombres de
 * columna adentro: se rechaza antes, con un mensaje que se lee.
 */
const MAXIMO_DE_LA_COLUMNA = 9999999999.9999;

/**
 * Una cantidad leída de la base, del cuerpo de un request o de una planilla,
 * como número.
 *
 * `null`, `undefined`, `''`, `'tres'`, un objeto y cualquier otra cosa
 * ilegible dan **0**, y ese es el único valor documentado para todos: es lo
 * que hace que la decisión esté en un lugar y no repartida en cuatro `|| 0`.
 *
 * ⚠ Devolver 0 ante lo ilegible **no sirve para decidir si escribir**. Quien
 * tenga que distinguir «la celda vino vacía» de «la celda decía cero» —la
 * importación de planillas— tiene que mirar el valor crudo ANTES de llamar
 * acá: para `aCantidad` las dos cosas son el mismo cero.
 *
 * @param {string|number|null|undefined} valor
 * @returns {number}
 */
function aCantidad(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor !== 'string') return 0;

  const numero = Number(valor.trim());
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Redondea a los 4 decimales que la columna puede guardar.
 *
 * El redondeo es **explícito y no un efecto del cast**: una cantidad calculada
 * en el navegador llega como `0.30000000000000004`, y dejar que Postgres la
 * acomode al asignar es literalmente el defecto que esta funcionalidad vino a
 * eliminar (`auditoria-frente2-hallazgos.json:335`), en chiquito. El
 * precedente está al lado: `utils/calculosVenta.js:12-14` hace lo mismo con
 * los centavos y por el mismo motivo.
 *
 * @param {string|number|null|undefined} valor
 * @returns {number}
 */
function redondearCantidad(valor) {
  const factor = 10 ** DECIMALES_DE_LA_COLUMNA;
  return Math.round(aCantidad(valor) * factor) / factor;
}

/**
 * Suma dos cantidades **como números**.
 *
 * Es la función que reemplaza a los cinco `+` desnudos. El síntoma tiene dos
 * formas y **la peligrosa no es la ruidosa**, así que conviene tenerlas
 * separadas (medido, no deducido):
 *
 *   1. **Los dos operandos salen de la base.** Los dos traen la escala puesta,
 *      así que la concatenación tiene DOS puntos:
 *      `'10.5000' + '0.2500'` → `'10.50000.2500'` → **`NaN`**. Postgres
 *      rechaza la escritura y el error se ve.
 *
 *   2. **Uno sale de la base y el otro es un número del request.** Un solo
 *      punto, o sea un número **válido**: `'7.0000' + 10` → `'7.000010'` →
 *      **7.00001**, cuando lo correcto era 17. Postgres lo acepta sin chistar.
 *
 * ⚠ En el caso 2 el resultado es **más chico** que el correcto, no más grande:
 * el inventario **pierde** la mercadería en silencio. Quien audite esto
 * buscando un stock inflado va a mirar el síntoma equivocado —y el comentario
 * de `services/tiendanubeService.js:81-83` induce justamente a ese error—.
 *
 * @returns {number}
 */
function sumarCantidades(a, b) {
  return redondearCantidad(aCantidad(a) + aCantidad(b));
}

/**
 * Una cantidad escrita para que la lea una persona, adentro de una frase.
 *
 * Máximo 3 decimales, sin ceros de relleno y con **coma** decimal:
 * `"9.6000"` → `9,6`, `"0.0000"` → `0`, `12` → `12` (PENDIENTE 4, resuelto).
 *
 * **No lleva separador de miles, y es a propósito**: «disponible 1.250»
 * adentro de una oración se lee como mil doscientos cincuenta o como uno coma
 * veinticinco según quién lo lea, y este repositorio ya pagó una vez el precio
 * de leer un número argentino al revés. En una columna alineada el separador
 * ayuda; en una frase, estorba.
 *
 * Se escribe acá y no con `toLocaleString('es-AR')` para no atar el texto de
 * un mensaje a que el contenedor tenga el ICU con el locale cargado.
 *
 * @returns {string}
 */
function textoDeCantidad(valor) {
  const factor = 10 ** 3;
  // El `+ 0` saca el `-0` que deja el redondeo de un negativo chiquito: sin
  // él, un disponible de `-0.0001` se dibujaría «-0».
  const redondeada = Math.round(aCantidad(valor) * factor) / factor + 0;

  return String(redondeada).replace('.', ',');
}

/**
 * Cuánto máximo se repite de lo que mandó el cliente, en un mensaje de rechazo.
 *
 * El valor viene del cuerpo de un request, así que puede ser cualquier cosa. Se
 * corta para que nadie use el mensaje de error como altavoz de diez kilobytes.
 */
const LARGO_DE_UNA_CANTIDAD_RECHAZADA = 20;

/**
 * La cantidad **tal como llegó**, para repetirla en un mensaje de rechazo.
 *
 * ⚠ No usa `textoDeCantidad`, y la diferencia importa: aquella redondea a 3
 * decimales porque describe una cantidad real —un stock, un disponible—, y acá
 * lo que se describe es **lo que el cliente escribió**, que justamente es
 * inválido. Medido: `textoDeCantidad(0.00004)` da `'0'`, o sea que el rechazo
 * de `0.00004` contestaba «cantidad 0» y mandaba a corregir un cero que nadie
 * había mandado.
 *
 * Hoy el caso es inalcanzable —el endpoint solo acepta enteros— y por eso se
 * arregla ahora: la **017** mueve `DECIMALES_DE_UNA_LINEA_DE_VENTA` a 3 y abre
 * la puerta, y entonces éste pasa a ser exactamente el caso que la regla nueva
 * existe para atajar. Un mensaje que miente justo ahí es peor que ninguno.
 *
 * Repetir un valor del request en la respuesta es lo que ya hace la misma
 * frase con el nombre del producto. Viaja como JSON y la pantalla lo dibuja
 * como texto, pero se acota igual por las dudas.
 *
 * ⚠ **Lo que esto NO arregla, porque se pierde antes.** En
 * `POST /api/sales` el valor pasa por `calculosVenta.js:30`, que hace
 * `Number.isFinite(cantidad) ? cantidad : 0`: un `'tres'` ya llegó acá
 * convertido en **0**, y el rechazo dice «cantidad 0» con el motivo «tiene que
 * ser mayor que cero» en vez de «tiene que ser un número». Es un defecto de
 * `normalizarItem` —aplanar lo ilegible antes de que alguien pueda
 * rechazarlo— y no de esta función, que recibe el cero ya hecho. Anotado y no
 * arreglado acá: tocar `normalizarItem` cambia el contrato de todas las
 * lineas de venta y no es de la 016.
 *
 * @returns {string}
 */
function textoDeCantidadRecibida(valor) {
  if (valor === null || valor === undefined) return '(vacío)';

  const crudo = String(valor).trim();
  if (crudo === '') return '(vacío)';

  const recortado = crudo.length > LARGO_DE_UNA_CANTIDAD_RECHAZADA
    ? `${crudo.slice(0, LARGO_DE_UNA_CANTIDAD_RECHAZADA)}…`
    : crudo;

  // Solo la coma decimal, y solo si es un número: cambiar puntos por comas en
  // un texto arbitrario lo desfigura sin ayudar a nadie.
  return Number.isFinite(Number(crudo)) ? recortado.replace('.', ',') : recortado;
}

/**
 * Por qué una cantidad **no** se puede aceptar, o `null` si se puede.
 *
 * Devuelve un fragmento en castellano para que quien llama arme el mensaje
 * completo con el producto y la cantidad delante. **No nombra la tabla, ni la
 * columna, ni la restricción** (FR-021): eso es lo que hace que el rechazo se
 * pueda leer.
 *
 * Rechaza, en este orden: lo que no es un número, el cero y lo negativo, lo
 * que no entra en la columna, y lo que tiene más decimales de los permitidos.
 * El orden importa: `'tres'` no es «menor o igual que cero», aunque
 * `aCantidad('tres')` valga 0.
 *
 * @param {string|number|null|undefined} valor
 * @param {number} decimalesPermitidos Normalmente `DECIMALES_DE_UNA_LINEA_DE_VENTA`.
 * @returns {string|null}
 */
function motivoDeCantidadInvalida(valor, decimalesPermitidos = DECIMALES_DE_UNA_LINEA_DE_VENTA) {
  // El valor crudo y no `aCantidad`: para `aCantidad` un `'tres'` vale 0, y
  // contestar «tiene que ser mayor que cero» ante una palabra manda a quien lo
  // lee a corregir lo que no está mal.
  const crudo = typeof valor === 'number' ? valor : Number(String(valor ?? '').trim());
  const vacio = valor === null || valor === undefined || String(valor).trim() === '';

  if (vacio || !Number.isFinite(crudo)) return 'tiene que ser un número';
  if (crudo <= 0) return 'tiene que ser mayor que cero';
  // El tope no se nombra en el mensaje a propósito: escribirlo obligaría a
  // meter un separador de miles adentro de una frase —la ambigüedad que
  // `textoDeCantidad` evita— y el número exacto no le sirve a nadie que haya
  // tipeado quince dígitos por error.
  if (crudo > MAXIMO_DE_LA_COLUMNA) return 'es demasiado grande';

  const factor = 10 ** decimalesPermitidos;
  if (Math.round(crudo * factor) / factor !== crudo) {
    return decimalesPermitidos === 0
      ? 'tiene que ser un número entero'
      : `admite como máximo ${decimalesPermitidos} decimales`;
  }

  return null;
}

module.exports = {
  aCantidad,
  sumarCantidades,
  redondearCantidad,
  textoDeCantidad,
  textoDeCantidadRecibida,
  motivoDeCantidadInvalida,
  DECIMALES_DE_UNA_LINEA_DE_VENTA,
  DECIMALES_DE_LA_COLUMNA,
  MAXIMO_DE_LA_COLUMNA,
};
