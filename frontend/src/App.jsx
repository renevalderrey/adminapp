import React, { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { setAuthToken, setEmpresaContext, setOnUnauthorized } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import useStore from '@/store/useStore'
import { AppSidebar } from '@/components/app-sidebar'
import ErrorBoundary from '@/components/ErrorBoundary'
import { Toaster } from '@/components/Toaster'

// Pages
import Dashboard from '@/pages/Dashboard'
import Inventory from '@/pages/Inventory'
import Billing from '@/pages/Billing'
import Orders from '@/pages/Orders'
import PurchaseOrders from '@/pages/PurchaseOrders'
import Reports from '@/pages/Reports'
import Expenses from '@/pages/Expenses'
import Login from '@/pages/Login'
import Settings from '@/pages/Settings'
import InvoicesList from '@/pages/InvoicesList'
import Recipes from '@/pages/Recipes'
import Production from '@/pages/Production'
import Customers from '@/pages/Customers'
import CashFlow from '@/pages/CashFlow'
import Taxes from '@/pages/Taxes'
import Onboarding from '@/pages/Onboarding'
import Team from '@/pages/Team'
import SubscriptionSettings from '@/pages/SubscriptionSettings'

function RouteGuard({ children, requiredModule }) {
  const usuario = useStore(s => s.usuario)
  const empresaActiva = useStore(s => s.empresaActiva)
  const { user } = useAuth0()

  const empresaSettings = empresaActiva?.settings || {}
  const enabledModules = empresaSettings.enabled_modules
  const ownerAuth0Sub = empresaSettings.owner_auth0_sub
  const isOwner = user?.sub === ownerAuth0Sub

  if (isOwner) return children

  if (enabledModules && Array.isArray(enabledModules) && requiredModule) {
    if (!enabledModules.includes(requiredModule)) {
      return <Navigate to="/pos" replace />
    }
  }

  return children
}

function App() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, getAccessTokenSilently, logout } = useAuth0()
  const loadEmpresaContext = useStore(s => s.loadEmpresaContext)
  const usuario = useStore(s => s.usuario)
  const empresaActiva = useStore(s => s.empresaActiva)
  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)
  const loadingUsuario = useStore(s => s.loadingUsuario)
  const contextError = useStore(s => s.contextError)
  const onboardingCompleted = empresaActiva?.onboarding_completed

  useEffect(() => {
    if (isAuthenticated) {
      setAuthToken(getAccessTokenSilently)
    }
  }, [isAuthenticated, getAccessTokenSilently])

  useEffect(() => {
    setOnUnauthorized(() => {
      logout({ logoutParams: { returnTo: window.location.origin } })
    })
  }, [logout])

  useEffect(() => {
    if (isAuthenticated && !usuario && !contextError) {
      loadEmpresaContext()
    }
  }, [isAuthenticated, usuario, contextError, loadEmpresaContext])

  useEffect(() => {
    setEmpresaContext(
      empresaActiva?.id,
      puntoDeVentaActivo?.id
    )
  }, [empresaActiva?.id, puntoDeVentaActivo?.id])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const inviteToken = params.get('invite')
    if (inviteToken) {
      localStorage.setItem('pendingInvite', inviteToken)
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('pendingInvite')
    if (token && usuario) {
      api.post(`/auth/accept-invite/${token}`)
        .then(() => {
          localStorage.removeItem('pendingInvite')
          loadEmpresaContext()
        })
        .catch(() => {
          localStorage.removeItem('pendingInvite')
        })
    }
  }, [usuario])

  // Si falla la carga del contexto, desloguear automáticamente
  useEffect(() => {
    if (contextError) {
      logout({ logoutParams: { returnTo: window.location.origin } })
    }
  }, [contextError, logout])

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-muted-foreground font-medium">Validando sesión...</p>
        </div>
        <Toaster />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <>
        <Login />
        <Toaster />
      </>
    )
  }

  // Cargando contexto del usuario
  if (loadingUsuario || (isAuthenticated && !usuario && !contextError)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <img src="/logo_sin_fondo.png" alt="Admin App" className="h-16 w-16 object-contain mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">Cargando tu información...</p>
        </div>
        <Toaster />
      </div>
    )
  }

  // Error al cargar contexto — mostrar pantalla de redirección
  if (contextError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground font-medium">Redirigiendo al inicio de sesión...</p>
        </div>
        <Toaster />
      </div>
    )
  }

  // Usuario autenticado sin empresa → Onboarding
  if (usuario && !onboardingCompleted) {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="*" element={<Onboarding />} />
        </Routes>
        <Toaster />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto p-6 lg:p-8 max-w-7xl">
            <Routes>
              <Route path="/" element={<Navigate to="/pos" replace />} />
              <Route path="/pos" element={<Billing />} />
              <Route path="/ventas" element={<InvoicesList />} />
              <Route path="/inventario" element={<Inventory />} />
              <Route path="/recetas" element={<RouteGuard requiredModule="recetas"><Recipes /></RouteGuard>} />
              <Route path="/produccion" element={<RouteGuard requiredModule="produccion"><Production /></RouteGuard>} />
              <Route path="/clientes" element={<RouteGuard requiredModule="clientes"><Customers /></RouteGuard>} />
              <Route path="/caja" element={<RouteGuard requiredModule="caja"><CashFlow /></RouteGuard>} />
              <Route path="/impuestos" element={<RouteGuard requiredModule="impuestos"><Taxes /></RouteGuard>} />
              <Route path="/proveedores" element={<Orders />} />
              <Route path="/ordenes-compra" element={<RouteGuard requiredModule="ordenes-compra"><PurchaseOrders /></RouteGuard>} />
              <Route path="/reportes" element={<RouteGuard requiredModule="reportes"><Reports /></RouteGuard>} />
              <Route path="/gastos" element={<Expenses />} />
              <Route path="/panel" element={<Dashboard />} />
              <Route path="/facturacion" element={<Settings />} />
              <Route path="/team" element={<Team />} />
              <Route path="/suscripcion" element={<SubscriptionSettings />} />
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
      <Toaster />
    </ErrorBoundary>
  )
}

export default App
