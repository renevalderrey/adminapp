import React from 'react'
import { Button } from '@/components/ui/button'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <span className="text-4xl">⚠️</span>
          </div>
          <h1 className="text-2xl font-bold">Algo salió mal</h1>
          <p className="max-w-md text-muted-foreground">
            Ocurrió un error inesperado. Reintentalo abajo.
          </p>
          {this.props.fallback || (
            <div className="flex gap-3">
              <Button onClick={() => window.location.reload()}>
                Recargar página
              </Button>
              <Button variant="outline" onClick={this.handleReload}>
                Reintentar
              </Button>
            </div>
          )}
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="mt-4 max-w-xl overflow-auto rounded-lg bg-muted p-4 text-left text-sm text-muted-foreground">
              {this.state.error.stack}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
