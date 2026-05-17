import { useAuth0 } from '@auth0/auth0-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Zap } from 'lucide-react'

function Login() {
  const { loginWithRedirect } = useAuth0()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center space-y-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Zap className="h-7 w-7" />
          </div>
          <div>
            <CardTitle className="text-2xl font-black tracking-tight">System</CardTitle>
            <CardDescription className="mt-1">
              Iniciá sesión para acceder al panel
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => loginWithRedirect()}
            className="w-full h-11 font-semibold"
            size="lg"
          >
            Iniciar Sesión
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default Login
