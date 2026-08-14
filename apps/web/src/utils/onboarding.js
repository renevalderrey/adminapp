// ════════════════════════════════════════════
//  Las reglas del formulario de onboarding
//
//  Viven acá y no en `pages/Onboarding.jsx` por lo mismo que las de
//  `utils/catalogos.js`: se prueban sin montar nada —cien veces más barato— y
//  el test no se rompe cuando alguien mueve un `<div>`.
//
//  ── Qué se valida en el navegador y qué en la API ──
//
//  Lo mismo. No más: un campo obligatorio en la pantalla y opcional en la API
//  es una molestia inventada. No menos: si la API lo va a rechazar, que el
//  rechazo no cueste una ida y vuelta con la red de un teléfono.
//
//  Y esto **no reemplaza** la validación del servidor. Es la mitad cómoda; la
//  que manda es `routes/empresas.js`, porque a la ruta la puede llamar
//  cualquiera.
// ════════════════════════════════════════════

/** Sólo los dígitos de un texto. Un CUIT se escribe con guiones y con puntos. */
export const soloDigitos = (texto) => String(texto || '').replace(/\D/g, '')

/** Lo que el servidor acepta como logo, y el techo que aplica multer. */
export const LOGO_TIPOS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
export const LOGO_MAX_BYTES = 300 * 1024

/**
 * Los campos, en el orden en el que se dibujan.
 *
 * El orden importa: es el que decide a cuál se le manda el foco cuando hay más
 * de uno mal, y tiene que ser el orden visual y no el de un objeto.
 */
export const ORDEN_DE_CAMPOS = ['name', 'cuit', 'phone', 'address', 'city', 'state']

/**
 * Valida el formulario entero y devuelve `{campo: mensaje}`.
 *
 * Devuelve **todos** los errores y no el primero: que aparezcan de a uno es
 * pedirle a alguien que descubra el formulario a fuerza de reintentos.
 */
export function validarOnboarding(form) {
  const errores = {}
  const limpio = (valor) => String(valor || '').trim()

  if (!limpio(form.name)) {
    errores.name = 'Poné el nombre de tu empresa.'
  } else if (limpio(form.name).length > 120) {
    errores.name = 'El nombre no puede pasar de 120 caracteres.'
  }

  if (!limpio(form.phone)) {
    errores.phone = 'Poné un teléfono de contacto.'
  } else if (soloDigitos(form.phone).length < 6) {
    errores.phone = 'Ese teléfono parece incompleto.'
  }

  if (!limpio(form.address)) errores.address = 'Poné la dirección.'
  if (!limpio(form.city)) errores.city = 'Poné la ciudad.'
  if (!limpio(form.state)) errores.state = 'Poné la provincia.'

  // El CUIT es opcional —se puede empezar a usar el sistema sin él— pero si
  // viene tiene que servir: once dígitos es lo que AFIP acepta, y es el mismo
  // criterio de `utils/puestaEnMarchaAfip.js`.
  const cuit = soloDigitos(form.cuit)
  if (cuit && cuit.length !== 11) {
    errores.cuit = 'El CUIT tiene once dígitos. Dejalo vacío si no lo tenés a mano.'
  }

  return errores
}

/**
 * Qué está mal con el logo elegido, o `null` si está bien.
 *
 * Se mira acá y no sólo en el servidor: subir 3 MB desde un teléfono para que
 * la API conteste «máximo 300KB» es un minuto perdido y datos gastados, con el
 * error llegando cuando ya no se puede evitar.
 */
export function errorDelLogo(file) {
  if (!file) return null
  if (!LOGO_TIPOS.includes(file.type)) return 'El logo tiene que ser PNG, JPG, GIF, WEBP o SVG.'
  if (file.size > LOGO_MAX_BYTES) return 'El logo no puede pasar de 300 KB.'
  return null
}
