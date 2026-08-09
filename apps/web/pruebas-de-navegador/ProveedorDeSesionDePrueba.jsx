// ════════════════════════════════════════════
//  FAVALIO · La sesión falsa de las pruebas de navegador
//
//  ⚠⚠ ESTE ARCHIVO NO PUEDE ESTAR EN NINGÚN BUNDLE. ⚠⚠
//
//  Reemplaza a `src/sesion/ProveedorDeSesion.jsx` mediante un alias que
//  `vite.config.js` declara **únicamente** cuando `command === 'serve'` y
//  `FAVALIO_SESION_DE_PRUEBA=1`. `vite build` no ejecuta esa rama, así que el
//  archivo nunca entra al grafo de módulos de un `dist/`.
//
//  ── Por qué no alcanza con apagarlo en tiempo de ejecución ──
//
//  La API resuelve su bypass así: `BYPASS_AUTH` existe en el código de
//  producción y `checkPermission.js:5` responde 500 si alguien lo enciende con
//  `NODE_ENV=production`. Eso sirve **allá**, donde el código corre en un
//  servidor que el equipo controla y donde una variable mal puesta se puede
//  detectar y frenar.
//
//  Acá no sirve. Un bundle se descarga entero al navegador de cualquiera que
//  pida la página: un `if (algo) sesionFalsa()` compilado en `dist/` es una
//  puerta cuyo picaporte está del lado de afuera. Alcanza con que alguien
//  encuentre la condición —una variable de entorno, una clave en
//  `localStorage`, un parámetro en la URL— para entrar a la aplicación sin
//  autenticarse. Por eso lo que se verifica no es que esté apagado sino que
//  **no esté**.
//
//  La marca `BYPASS_DE_SESION_SOLO_PARA_PRUEBAS_DE_NAVEGADOR` de abajo es lo
//  que busca la guardia `src/tests/guardiaDeSesionDePrueba.test.js` dentro de
//  `dist/`. No la borres ni la cambies sin cambiarla también ahí: sin marca, la
//  guardia pasa a ser un test que siempre pasa.
//
//  ── Cómo funciona ──
//
//  `useAuth0()` no hace magia: lee `Auth0Context`, que el paquete exporta. Así
//  que la sesión falsa es un `Provider` de ese mismo contexto con los seis
//  valores que la aplicación consume. Ni `App.jsx` ni ninguna pantalla se
//  entera, y eso es a propósito: una prueba de navegador que exige tocar el
//  código de producción para poder correr deja de estar probando el código de
//  producción.
// ════════════════════════════════════════════

import { Auth0Context } from '@auth0/auth0-react'

/**
 * La marca, y por qué está adentro de un string que la aplicación USA.
 *
 * El primer intento fue `export const BYPASS_… = true`. No sirve: es un export
 * que nadie consume, así que el tree-shaking del build lo borra y la guardia
 * del `dist/` se queda buscando algo que la minificación ya sacó. Lo mismo pasa
 * con el nombre del componente, que el minificador renombra a una letra.
 *
 * Lo único que sobrevive intacto a un build es un **literal de texto que se
 * devuelve**. Por eso la marca va pegada al token falso: mientras el bypass
 * exista, este string existe, y la guardia lo encuentra.
 *
 * Verificado sacándole el `command === 'serve'` al alias de `vite.config.js` y
 * buildeando: de las tres marcas, la única que quedó en `dist/` fue esta.
 */
export const MARCA = 'BYPASS_DE_SESION_SOLO_PARA_PRUEBAS_DE_NAVEGADOR'

// El `sub` es el mismo que inyecta `BYPASS_AUTH` del lado de la API
// (`server.js:264`: `req.userId = 'test-user-id'`). Tiene que coincidir porque
// `RouteGuard` compara `user.sub` con `settings.owner_auth0_sub` para decidir
// si quien mira es el dueño de la empresa.
const USUARIO_DE_PRUEBA = {
  sub: 'test-user-id',
  name: 'Dev User',
  email: 'dev@favalio.com',
  email_verified: true,
}

// La API corre con `BYPASS_AUTH=true` y no mira el token, pero el interceptor
// de `services/api.js:104` igual lo pide y rechaza el request si la promesa
// falla. Devolver una cadena cualquiera es lo que hace que cada request salga.
const token = async () => `token-de-prueba-sin-firma-${MARCA}`

export default function ProveedorDeSesionDePrueba({ children }) {
  const sesion = {
    isAuthenticated: true,
    isLoading: false,
    user: USUARIO_DE_PRUEBA,
    error: undefined,
    getAccessTokenSilently: token,
    getAccessTokenWithPopup: token,
    getIdTokenClaims: async () => ({ __raw: `token-de-prueba-sin-firma-${MARCA}` }),
    loginWithRedirect: async () => {},
    loginWithPopup: async () => {},
    // `logout` se llama de verdad: `App.jsx:156` desloguea cuando falla la
    // carga del contexto. Si redirigiera, la prueba terminaría en una pantalla
    // en blanco y el error real —la API caída, por ejemplo— quedaría tapado.
    // Así, en cambio, queda la pantalla de «Redirigiendo…» y se ve qué pasó.
    logout: async () => {},
    handleRedirectCallback: async () => ({}),
  }

  return <Auth0Context.Provider value={sesion}>{children}</Auth0Context.Provider>
}
