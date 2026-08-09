/**
 * Configuracion de la landing.
 *
 * Las VITE_* se resuelven en tiempo de build, no en runtime: cambiar
 * cualquiera de estas exige un rebuild del sitio.
 */

export const BRAND = 'Favalio';

/** URL de la app. En produccion, el subdominio app.<dominio>. */
export const APP_URL =
  import.meta.env.VITE_APP_URL || 'http://localhost:5173';

/**
 * Auth0 no distingue login de signup por ruta: se le pasa screen_hint=signup
 * en los authorizationParams. La app lee este query param en el arranque y lo
 * reenvia a loginWithRedirect.
 */
export const SIGNUP_URL = `${APP_URL}?signup=true`;
export const LOGIN_URL = APP_URL;

/** Contacto. Cambiar cuando haya dominio propio. */
export const CONTACT_EMAIL =
  import.meta.env.VITE_CONTACT_EMAIL || 'hola@favalio.com';
export const CONTACT_URL = `mailto:${CONTACT_EMAIL}`;
