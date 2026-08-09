import { useEffect, useRef } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// Mismo default que main.jsx. Antes estaba hardcodeado solo aca, con lo cual
// si VITE_AUTH0_AUDIENCE apuntaba a otro lado el token pedido desde este boton
// salia con un audience distinto al del resto de la app y la API lo rechazaba.
const AUDIENCE = (
  import.meta.env.VITE_AUTH0_AUDIENCE || 'https://api.sistema-de-facturacion.com'
).trim()

const SCOPE = 'openid profile email offline_access'

function Login() {
  const { loginWithRedirect } = useAuth0()
  // StrictMode monta dos veces en desarrollo; sin esto el autoredirect dispara
  // loginWithRedirect duplicado.
  const autoRedirected = useRef(false)

  const irALogin = (screenHint) =>
    loginWithRedirect({
      authorizationParams: {
        audience: AUDIENCE,
        scope: SCOPE,
        ...(screenHint ? { screen_hint: screenHint } : {}),
      },
    })

  // La landing enlaza a <app>/?signup=true para el CTA de "Prueba gratis".
  // Auth0 no tiene una URL de registro separada: se pide con screen_hint.
  useEffect(() => {
    if (autoRedirected.current) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('signup') === 'true') {
      autoRedirected.current = true
      irALogin('signup')
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center space-y-3 pt-4">
          <div className="flex items-center justify-center">
            <img src="/logo_sin_fondo.png" alt="Favalio" className="h-36 w-36 object-contain" />
          </div>
          <div>
            <CardTitle className="text-2xl font-black tracking-tight">Favalio</CardTitle>
            <CardDescription className="mt-1">
              Iniciá sesión para acceder al panel
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => irALogin()}
            className="w-full h-11 font-semibold cursor-pointer hover:shadow-lg hover:shadow-cyan-500/30 hover:brightness-110"
            size="lg"
            style={{ backgroundColor: 'var(--color-brand)' }}
          >
            Iniciar Sesión
          </Button>
          <Button
            onClick={() => irALogin('signup')}
            variant="outline"
            className="w-full h-11 font-semibold cursor-pointer"
            size="lg"
          >
            Crear cuenta
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default Login
