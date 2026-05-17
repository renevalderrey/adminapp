import React, { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { setAuthToken } from '@/services/api'
import { AppSidebar } from '@/components/app-sidebar'

// Pages
import Dashboard from '@/pages/Dashboard'
import Inventory from '@/pages/Inventory'
import Billing from '@/pages/Billing'
import Orders from '@/pages/Orders'
import Expenses from '@/pages/Expenses'
import Login from '@/pages/Login'
import Settings from '@/pages/Settings'
import InvoicesList from '@/pages/InvoicesList'

function App() {
  const { isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0()

  useEffect(() => {
    // Cuando el usuario se autentica, configuramos el token en Axios para las llamadas a la API
    if (isAuthenticated) {
      setAuthToken(getAccessTokenSilently)
    }
  }, [isAuthenticated, getAccessTokenSilently])

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-muted-foreground font-medium">Validando sesión...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Login />
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-6 lg:p-8 max-w-7xl">
          <Routes>
            <Route path="/" element={<Navigate to="/pos" replace />} />
            <Route path="/pos" element={<Billing />} />
            <Route path="/ventas" element={<InvoicesList />} />
            <Route path="/inventario" element={<Inventory />} />
            <Route path="/proveedores" element={<Orders />} />
            <Route path="/gastos" element={<Expenses />} />
            <Route path="/panel" element={<Dashboard />} />
            <Route path="/facturacion" element={<Settings />} />
            {/* Legacy redirects */}
            <Route path="/calculator" element={<Navigate to="/panel" replace />} />
            <Route path="/billing" element={<Navigate to="/pos" replace />} />
            <Route path="/invoices" element={<Navigate to="/ventas" replace />} />
            <Route path="/inventory" element={<Navigate to="/inventario" replace />} />
            <Route path="/orders" element={<Navigate to="/proveedores" replace />} />
            <Route path="/expenses" element={<Navigate to="/gastos" replace />} />
            <Route path="/settings" element={<Navigate to="/facturacion" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default App
