import { mensajeDeError } from './erroresDeApi'

// ════════════════════════════════════════════
//  Qué hacer cuando aceptar una invitación falla
//
//  ── El eslabón número tres ──
//
//  `App.jsx` tenía esto:
//
//      api.post(`/auth/accept-invite/${token}`)
//        .then(() => { localStorage.removeItem('pendingInvite'); … })
//        .catch(() => { localStorage.removeItem('pendingInvite') })
//
//  El `catch` **borraba el token pase lo que pase y no decía nada**. O sea que un
//  500 del servidor, la API dormida en el free tier de Render —cincuenta segundos
//  de arranque en frío— o el wifi del local cortándose un segundo tenían el mismo
//  efecto que una invitación vencida: la invitación se perdía para siempre, en
//  silencio, y quien la recibió no tenía forma de saber que había pasado algo. El
//  reintento nunca ocurría porque ya no quedaba token que reintentar.
//
//  ── Por qué es una función pura y no un `if` adentro del `catch` ──
//
//  Porque la regla —«qué errores son definitivos y cuáles no»— es lo que hay que
//  poder afirmar, y adentro de un `useEffect` con `localStorage` y un `toast` no
//  se puede escribir un test que la mire sin montar media aplicación. Acá se
//  contesta con cuatro objetos y el test se lee.
//
//  ── La regla, y de dónde sale ──
//
//  El servidor (`apps/api/src/routes/auth.js`) contesta cada motivo permanente
//  con **404** o **409**, y eso es contrato:
//
//    404  la invitación no existe, venció, la cancelaron, o es para otro email
//    409  ya se usó, o el miembro está desactivado
//
//  Los dos son definitivos: reintentarlos mil veces da lo mismo, así que el token
//  se descarta y se explica por qué. **Cualquier otra cosa** —500, 502, un
//  timeout, la red caída, la API despertándose— es transitoria por definición y
//  el token se conserva: el próximo arranque de la aplicación lo vuelve a
//  intentar solo.
//
//  Descartar el token no es irreversible: el enlace del mail sigue llevando a
//  `/?invite=<token>` y volver a abrirlo lo rearma. Por eso el caso «entraste con
//  otra cuenta» puede borrarlo y explicarlo sin dejar a nadie afuera.
// ════════════════════════════════════════════

/**
 * Lo que se muestra cuando el servidor no mandó un motivo propio.
 *
 * Cada rama tiene el suyo porque las tres piden cosas distintas: pedir una
 * invitación nueva, entrar normalmente, o no hacer nada y esperar.
 */
const POR_DEFECTO = {
  invalida: 'Esa invitación ya no es válida o venció. Pedile a quien te invitó que te mande una nueva.',
  yaResuelta: 'Esa invitación ya no se puede usar. Si ya sos parte del equipo, entrá normalmente.',
  transitoria: 'No pudimos aceptar la invitación ahora. La guardamos y lo intentamos de nuevo al volver a entrar.',
}

/**
 * Qué hacer con el token pendiente después de que la aceptación falló.
 *
 * @param {unknown} error Lo que atrapó el `catch`. Puede ser cualquier cosa:
 *   un error de axios, un `TypeError` de la red, `undefined`.
 * @returns {{borrarToken: boolean, mensaje: string, tono: 'error'|'aviso'|'espera'}}
 *   **Nunca `undefined`.** Un `undefined` acá lo desestructura el llamador y
 *   revienta adentro de un `useEffect`, que es de los errores más difíciles de
 *   leer que puede tener la aplicación.
 */
export function decidirTrasAceptar(error) {
  const status = error?.response?.status

  // El 404 junta los cuatro motivos definitivos que el servidor distingue por su
  // código —inexistente, vencida, revocada, de otro email—. El texto de cada uno
  // lo escribe el servidor y `mensajeDeError` lo saca del cuerpo: repetir esa
  // tabla acá la desincroniza el día que alguien agregue un caso.
  if (status === 404) {
    return {
      borrarToken: true,
      mensaje: mensajeDeError(error, POR_DEFECTO.invalida),
      tono: 'error',
    }
  }

  // 409 no es un error de quien está del otro lado: la invitación ya se usó, o
  // su acceso está desactivado y hay alguien que se lo tiene que reactivar. Por
  // eso el tono es distinto del 404, aunque las dos descarten el token.
  if (status === 409) {
    return {
      borrarToken: true,
      mensaje: mensajeDeError(error, POR_DEFECTO.yaResuelta),
      tono: 'aviso',
    }
  }

  // Todo lo demás: 500, 502, 401 mientras el token de Auth0 se renueva, un
  // timeout, la red caída, o algo que ni siquiera es un error de axios. El token
  // **se queda**.
  return {
    borrarToken: false,
    mensaje: mensajeDeError(error, POR_DEFECTO.transitoria),
    tono: 'espera',
  }
}
