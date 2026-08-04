// ════════════════════════════════════════════
//  ADMINAPP · Quién está usando la aplicación
//
//  Es el `Auth0Provider` que hasta ahora estaba escrito adentro de `main.jsx`.
//  Bajó a un archivo propio para que exista **una sola costura** por la que se
//  puede entrar a la aplicación, y para que esa costura tenga nombre.
//
//  ── Por qué importa que sea un archivo y no cuatro líneas en `main.jsx` ──
//
//  Las pruebas de navegador (`pruebas-de-navegador/`) necesitan abrir cualquier
//  pantalla sin una sesión de Auth0 real: `App.jsx:172` corta en
//  `!isAuthenticated` y no hay forma de pasar de ahí sin un tenant, un usuario y
//  un redirect. La forma de resolverlo es reemplazar **este** módulo por uno que
//  devuelva una sesión falsa, y eso se hace con un alias de Vite que
//  `vite.config.js` **solo** declara cuando `command === 'serve'`.
//
//  O sea: el reemplazo no puede ocurrir en un `vite build`. No es una condición
//  en tiempo de ejecución que alguien pueda encender con una variable de
//  entorno mal puesta en el servidor — es que el archivo del bypass **no entra
//  al grafo de módulos** de ningún bundle. La guardia
//  `src/tests/guardiaDeSesionDePrueba.test.js` lo verifica de tres formas.
//
//  Es el mismo criterio que la API aplica a `BYPASS_AUTH`
//  (`server.js:264`, `middleware/checkPermission.js:5`), llevado un paso más
//  allá: allá el código del bypass existe en producción y se niega a correr;
//  acá directamente no se compila, porque un bundle se sirve a cualquiera que
//  pida la página y no hay `NODE_ENV` que lo proteja.
// ════════════════════════════════════════════

import { Auth0Provider } from '@auth0/auth0-react'

const domain = import.meta.env.VITE_AUTH0_DOMAIN?.trim()
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID?.trim()
// Audience es necesario para obtener un JWT válido.
const audience = (import.meta.env.VITE_AUTH0_AUDIENCE || 'https://api.sistema-de-facturacion.com').trim()

export default function ProveedorDeSesion({ children }) {
  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      cacheLocation="localstorage"
      useRefreshTokens={true}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: audience,
        scope: 'openid profile email offline_access',
      }}
    >
      {children}
    </Auth0Provider>
  )
}
