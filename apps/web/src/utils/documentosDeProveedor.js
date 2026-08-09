// ════════════════════════════════════════════
//  FAVALIO · Documentos de proveedor: qué enlace se acepta y de qué nube salió
//
//  Favalio NO guarda archivos: guarda el enlace a la nube donde el usuario ya
//  tiene la factura. Es lo mismo que hacía el sistema viejo
//  (`legacy:2516-2518`) y está escrito en «Fuera de alcance» de la spec 012:
//  almacenar facturas de terceros trae obligaciones que nadie evaluó, y el
//  modelo `SupplierDocument` guarda una `url`, no un archivo.
//
//  ── Por qué la validación es tan floja, y por qué eso está bien ──
//
//  Lo único que se puede afirmar desde el navegador es que el texto pegado
//  PARECE un enlace. Si el archivo existe, si es público, si el permiso alcanza
//  para que lo abra el contador — nada de eso se sabe sin credenciales sobre la
//  cuenta de Drive del usuario, y Favalio no las tiene ni las quiere. La spec
//  lo dice en dos lugares: «Documento con enlace roto o privado» entre los
//  casos de borde, y «Verificar que un enlace de Drive funcione o sea público»
//  en «Fuera de alcance».
//
//  Así que se verifica lo que el legacy verificaba (`legacy:7930`) y nada más.
//  Lo que sí evita es la llamada al servidor que no puede salir bien: pegar el
//  NOMBRE del archivo en vez del enlace, o dejar el campo vacío y guardar un
//  documento que no lleva a ninguna parte.
//
//  ── Por qué «otro» es una etiqueta y no un rechazo ──
//
//  La lista de nubes NO es una lista blanca. Un enlace a Box, a un WeTransfer o
//  al servidor de la contadora se guarda igual y se muestra como «Otro»: es el
//  caso de borde que la spec resolvió explícitamente («Se acepta si empieza con
//  `http` y se etiqueta otro»).
//
//  Si esto se convirtiera en lista blanca, quien no usa las tres nubes grandes
//  no podría cargar ninguna factura, y el aviso de «sin factura» del proveedor
//  (FR-086) le quedaría encendido para siempre sin forma de apagarlo — un aviso
//  que no se puede apagar deja de mirarse, y con él dejan de mirarse los que sí
//  importan.
// ════════════════════════════════════════════

/**
 * Los cuatro tipos de documento, los del modelo
 * (`apps/api/src/models/Supplier.js:163`).
 *
 * El orden importa: el primero es el `defaultValue` de la columna, así que es
 * el que el formulario deja elegido. La columna es un `STRING(30)` sin
 * validación en el servidor — un quinto tipo se guardaría igual y nadie se
 * enteraría hasta que alguien filtre por tipo y no encuentre nada.
 */
export const TIPOS = [
  { codigo: 'factura', etiqueta: 'Factura' },
  { codigo: 'remito', etiqueta: 'Remito' },
  { codigo: 'presupuesto', etiqueta: 'Presupuesto' },
  { codigo: 'otro', etiqueta: 'Otro' },
]

/**
 * Las tres nubes conocidas, por dominio.
 *
 * El legacy miraba el enlace entero con `includes('dropbox')`
 * (`legacy:8190-8193`), y eso etiqueta como Dropbox a
 * `https://mi-servidor.com/dropbox/factura.pdf`. Acá se compara contra el
 * HOST, que es el único lugar donde el dominio significa de quién es el
 * archivo.
 *
 * `docs.google.com` entra en Drive porque una factura compartida como Google
 * Doc o como planilla vive en el mismo Drive; separarla en una cuarta
 * categoría no le dice nada a nadie.
 *
 * `sharepoint.com` entra en OneDrive por lo mismo que en el legacy: OneDrive
 * para empresas sirve los archivos desde el SharePoint de la organización, y
 * el usuario que pegó el enlace cree que lo sacó de OneDrive.
 */
const NUBES = [
  {
    codigo: 'drive',
    etiqueta: 'Google Drive',
    dominios: ['drive.google.com', 'docs.google.com'],
  },
  {
    codigo: 'dropbox',
    etiqueta: 'Dropbox',
    dominios: ['dropbox.com'],
  },
  {
    codigo: 'onedrive',
    etiqueta: 'OneDrive',
    dominios: ['onedrive.com', 'onedrive.live.com', '1drv.ms', 'sharepoint.com'],
  },
]

/** Lo que se muestra cuando el enlace no es de ninguna de las tres. */
const NUBE_DESCONOCIDA = { codigo: 'otro', etiqueta: 'Otro' }

/**
 * El host de un enlace, en minúsculas, o `null` si no se puede leer.
 *
 * `new URL` tira con cualquier cosa que no sea un enlace absoluto, así que el
 * try/catch no es decoración: `nubeDelEnlace` se llama también mientras el
 * usuario está tipeando, con el campo a medio escribir.
 */
function hostDelEnlace(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** true si `host` es el dominio o algo que cuelga de él. */
function perteneceA(host, dominio) {
  return host === dominio || host.endsWith(`.${dominio}`)
}

/**
 * De qué nube es un enlace: `{ codigo, etiqueta }`.
 *
 * Nunca devuelve `undefined` ni tira: un enlace que no se puede leer es «Otro»,
 * igual que uno de una nube que no está en la lista. La fila de un documento
 * tiene que dibujarse siempre — el enlace es lo importante, la etiqueta de la
 * nube es una ayuda para reconocerlo de un vistazo.
 */
export function nubeDelEnlace(url) {
  const host = hostDelEnlace(url)
  if (!host) return NUBE_DESCONOCIDA

  const nube = NUBES.find((n) => n.dominios.some((dominio) => perteneceA(host, dominio)))
  if (!nube) return NUBE_DESCONOCIDA

  return { codigo: nube.codigo, etiqueta: nube.etiqueta }
}

/**
 * ¿Se puede mandar este enlace al servidor? (FR-082)
 *
 * Tres motivos para decir que no, y ninguno más:
 *
 * - **No empieza con `http`.** Es la regla del legacy (`legacy:7930`) y la que
 *   la spec escribió tal cual. Alcanza para atajar el error real: pegar
 *   «Factura 0001-00043212.pdf» en el campo del enlace.
 * - **Tiene espacios adentro.** Un enlace con un espacio en el medio es un
 *   enlace cortado — el chat lo partió en dos y se pegó la primera mitad más
 *   una palabra suelta. Guardarlo produce un documento que abre en una página
 *   de error, y el aviso de «sin factura» se apaga igual: peor que no tener
 *   nada, porque nadie vuelve a mirarlo.
 * - **Está vacío**, o son todos espacios.
 *
 * Los espacios de los bordes SÍ se toleran: pegar desde WhatsApp arrastra un
 * espacio o un salto de línea al final, y rechazar eso es hacerle perder el
 * tiempo a alguien por algo que se arregla solo. **Quien guarda tiene que
 * guardar `url.trim()`**, no el texto crudo del campo.
 *
 * Lo que esta función NO puede decir es si el enlace lleva a algún lado. Eso
 * está en «Fuera de alcance» y no hay forma de averiguarlo desde acá.
 */
export function esEnlaceAceptable(url) {
  if (typeof url !== 'string') return false

  const limpio = url.trim()
  if (limpio === '') return false
  if (/\s/.test(limpio)) return false

  // Minúsculas porque el esquema de una URL no distingue mayúsculas: quien
  // escribe `HTTPS://` a mano tiene un enlace perfectamente válido.
  return limpio.toLowerCase().startsWith('http')
}
