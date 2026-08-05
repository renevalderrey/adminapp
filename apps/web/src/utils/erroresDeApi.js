// ════════════════════════════════════════════
//  ADMINAPP · Qué se le muestra al usuario cuando la API dice que no
//
//  Las dos pantallas de proveedores hacen hoy dos cosas, y las dos dejan a
//  quien está del otro lado sin saber qué pasó:
//
//    Orders.jsx:107, :118, :133, :185     toast.error(err.message)
//    PurchaseOrders.jsx:134, :180, :191   console.error(err)   ← mudo
//
//  `err.message` de axios es «Request failed with status code 500». No dice qué
//  falló, no dice qué corregir y no se puede dictar por teléfono. El texto que
//  sí sirve viaja en el cuerpo de la respuesta: es donde `fallo()` deja el
//  mensaje en castellano y donde `ErrorDeNegocio` deja el suyo. «La orden ya
//  fue recibida completa» sabe de qué orden habla; axios no sabe ni que existen
//  las órdenes. FR-095 y criterio de éxito 14.
//
//  ── Alternativa descartada ──
//
//  Mapear los códigos con un `switch` en la pantalla. Los mensajes ya están en
//  castellano del lado del servidor y son los únicos que saben el contexto; una
//  tabla de códigos en el navegador se separa del servidor el día que alguien
//  agrega un caso, y nadie se entera hasta que un usuario ve un código —que es
//  el mismo problema que ya tuvieron las etiquetas de estado copiadas en las
//  dos pantallas—.
// ════════════════════════════════════════════

/**
 * Lo que se muestra cuando el servidor no mandó nada legible.
 *
 * Existe como valor por defecto y no como responsabilidad de cada `catch`
 * porque un `catch` que se olvida del segundo argumento tiene que mostrar algo
 * igual: un aviso vacío es un fallo en silencio con más pasos, que es
 * exactamente lo que el criterio 14 viene a cerrar.
 */
export const MENSAJE_GENERICO = 'No se pudo completar la operación. Probá de nuevo.'

/**
 * Un código de máquina, no una frase para leer.
 *
 * ⚠ Esto no estaba previsto en la tarea y hace falta: desde este mismo hito la
 * API responde los errores de cuerpo y de filtro con la forma
 * `{ error: 'LINEA_REQUERIDA', message: 'La orden tiene dos líneas de …' }`
 * —`routes/suppliers.js:36-45` y el `respondioErrorDeFiltro` de
 * `routes/sales.js:59`, que es de donde se copió—. El código va en `error`
 * a propósito, para que la pantalla pueda decidir sin parsear castellano, y el
 * texto para el usuario queda en `message`.
 *
 * Leer `error` a ciegas, entonces, le pondría «LINEA_REQUERIDA» adentro de un
 * toast. No es «Request failed with status code 500», pero es igual de
 * ilegible, y FR-095 pide un aviso legible, no cualquier string.
 *
 * La forma es deliberadamente angosta —mayúsculas, dígitos y guiones bajos, sin
 * un solo espacio— para no confundirse con un mensaje real: todo lo que escribe
 * `fallo()` es una oración en castellano, con espacios y minúsculas, incluida
 * la que `services/api.js:87` completa con «(código: a1b2c3d4)».
 */
const CODIGO_DE_MAQUINA = /^[A-Z][A-Z0-9_]*$/

/** El valor solo sirve como aviso si es texto y tiene algo adentro. */
function textoUtil(valor) {
  return typeof valor === 'string' ? valor.trim() : ''
}

/**
 * El mensaje que se le muestra al usuario por un error de la API.
 *
 * Nunca `err.message`: ese es el de axios y es la frase que el usuario ve hoy.
 *
 * @param {unknown} err       Lo que atrapó el `catch`. Puede ser cualquier cosa.
 * @param {string} [generico] Qué estaba intentando hacer, en castellano.
 * @returns {string} Siempre una frase. Nunca `undefined` ni una cadena vacía.
 */
export function mensajeDeError(err, generico = MENSAJE_GENERICO) {
  const datos = err?.response?.data

  const delServidor = textoUtil(datos?.error)
  const legible = textoUtil(datos?.message)
  const porDefecto = textoUtil(generico) || MENSAJE_GENERICO

  // `error` primero, que es donde `fallo()` deja el mensaje de todo el resto de
  // la API; `message` después, que es donde lo dejan el 403 de
  // `checkPermission`, el 402 de la suscripción y los errores con código.
  if (delServidor && !CODIGO_DE_MAQUINA.test(delServidor)) return delServidor
  if (legible) return legible

  // Acá cae la red caída —no hay `response` ninguna— y también el código
  // huérfano, sin `message`. En los dos casos lo único honesto es decir qué se
  // estaba intentando hacer.
  return porDefecto
}
