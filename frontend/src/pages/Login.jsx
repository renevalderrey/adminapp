import { useAuth0 } from '@auth0/auth0-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'


function Login() {
  const { loginWithRedirect } = useAuth0()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center space-y-3 pt-4">
          <div className="flex items-center justify-center">
            <img src="/logo_sin_fondo.png" alt="Admin App" className="h-36 w-36 object-contain" />
          </div>
          <div>
            <CardTitle className="text-2xl font-black tracking-tight">Admin App</CardTitle>
            <CardDescription className="mt-1">
              Iniciá sesión para acceder al panel
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => loginWithRedirect()}
            className="w-full h-11 font-semibold cursor-pointer hover:shadow-lg hover:shadow-cyan-500/30 hover:brightness-110"
            size="lg"
            style={{ backgroundColor: 'var(--color-brand)' }}
          >
            Iniciar Sesión
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default Login
