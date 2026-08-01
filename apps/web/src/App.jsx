import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import api, { setAuthToken, setEmpresaContext, setOnUnauthorized, setOnSubscriptionExpired } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import useStore from '@/store/useStore'
import { AppSidebar } from '@/components/app-sidebar'
import { AppTopbar } from '@/components/app-topbar'
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
import Faltantes from '@/pages/Faltantes'
import Comparador from '@/pages/Comparador'

function RouteGuard({ children, requiredModule, soloSuperadmin }) {
  const usuario = useStore(s => s.usuario)
  const empresaActiva = useStore(s => s.empresaActiva)
  const { user } = useAuth0()

  // El gate más restrictivo va primero: si el módulo todavía no se liberó, no
  // existe para nadie salvo el operador de la plataforma — ni siquiera para el
  // dueño de la empresa.
  //
  // Esto no reemplaza al gate de la API (requireSuperadmin). Es la mitad
  // visible: evita que alguien llegue escribiendo la URL a mano y vea una
  // pantalla rota llena de 404.
  if (soloSuperadmin && usuario?.es_superadmin !== true) {
    return <Navigate to="/pos" replace />
  }

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
  const { isAuthenticated, isLoading, getAccessTokenSilently, getAccessTokenWithPopup, logout } = useAuth0()
  const loadEmpresaContext = useStore(s => s.loadEmpresaContext)
  const usuario = useStore(s => s.usuario)
  const empresaActiva = useStore(s => s.empresaActiva)
  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)
  const loadingUsuario = useStore(s => s.loadingUsuario)
  const contextError = useStore(s => s.contextError)
  const onboardingCompleted = empresaActiva?.onboarding_completed

  useEffect(() => {
    if (isAuthenticated) {
      setAuthToken(getAccessTokenSilently, getAccessTokenWithPopup)
    }
  }, [isAuthenticated, getAccessTokenSilently, getAccessTokenWithPopup])

  useEffect(() => {
    setOnUnauthorized(() => {
      logout({ logoutParams: { returnTo: window.location.origin } })
    })
  }, [logout])

  // La API devuelve 402 cuando la suscripcion vencio. Sin este manejo, cada
  // pantalla mostraba su propio error generico y el usuario veia la aplicacion
  // rota en vez de entender que tiene que renovar.
  //
  // Se avisa una sola vez por sesion: repetir el mismo toast en cada request
  // fallido tapa la pantalla.
  const [suscripcionVencida, setSuscripcionVencida] = useState(null)

  // Barra lateral contraída o no. Se recuerda entre sesiones: quien la contrae
  // lo hace porque prefiere el espacio, y volver a expandirla en cada carga es
  // pelearle al usuario.
  const [sidebarAbierta, setSidebarAbierta] = useState(
    () => localStorage.getItem('sidebarAbierta') !== 'false'
  )

  const alternarSidebar = () => {
    setSidebarAbierta((abierta) => {
      localStorage.setItem('sidebarAbierta', String(!abierta))
      return !abierta
    })
  }

  useEffect(() => {
    setOnSubscriptionExpired((mensaje) => {
      setSuscripcionVencida((actual) => actual || mensaje)
    })
  }, [])

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
  const showLoading = loadingUsuario || (isAuthenticated && !usuario && !contextError);

  if (showLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <img src="/logo_sin_fondo.png" alt="Admin App" className="h-16 w-16 object-contain mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">Cargando tu información...</p>
          <p className="text-xs text-muted-foreground mt-2">Esto puede tomar unos segundos en la primera carga</p>
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

  if (suscripcionVencida) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-4">
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-2xl font-black tracking-tight">Tu suscripción venció</h2>
          <p className="text-muted-foreground">{suscripcionVencida}</p>
          <p className="text-sm text-muted-foreground">
            <strong>Tus datos siguen guardados.</strong> Ventas, comprobantes, stock y clientes
            quedan intactos y vuelven a estar disponibles apenas se reactive la cuenta.
          </p>
          <button
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
            className="text-sm underline text-muted-foreground hover:text-foreground"
          >
            Cerrar sesión
          </button>
        </div>
        <Toaster />
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <AppSidebar abierta={sidebarAbierta} onAlternar={alternarSidebar} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AppTopbar sidebarAbierta={sidebarAbierta} onAlternarSidebar={alternarSidebar} />

          {/* El contenido se centra a 1320px: sin tope, una tabla en un monitor
              ancho deja el ojo viajando de un borde al otro. */}
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1320px] px-5 py-7 lg:px-9 lg:py-8">
            <Routes>
              <Route path="/" element={<Navigate to="/pos" replace />} />
              <Route path="/pos" element={<Billing />} />
              <Route path="/ventas" element={<InvoicesList />} />
              <Route path="/inventario" element={<Inventory />} />
              <Route path="/recetas" element={<RouteGuard soloSuperadmin requiredModule="recetas"><Recipes /></RouteGuard>} />
              <Route path="/produccion" element={<RouteGuard soloSuperadmin requiredModule="produccion"><Production /></RouteGuard>} />
              <Route path="/clientes" element={<RouteGuard soloSuperadmin requiredModule="clientes"><Customers /></RouteGuard>} />
              <Route path="/caja" element={<RouteGuard soloSuperadmin requiredModule="caja"><CashFlow /></RouteGuard>} />
              <Route path="/impuestos" element={<RouteGuard soloSuperadmin requiredModule="impuestos"><Taxes /></RouteGuard>} />
              <Route path="/proveedores" element={<Orders />} />
              <Route path="/ordenes-compra" element={<RouteGuard requiredModule="ordenes-compra"><PurchaseOrders /></RouteGuard>} />
              <Route path="/faltantes" element={<Faltantes />} />
              <Route path="/comparador" element={<Comparador />} />
              <Route path="/reportes" element={<RouteGuard soloSuperadmin requiredModule="reportes"><Reports /></RouteGuard>} />
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
      </div>
      <Toaster />
    </ErrorBoundary>
  )
}

export default App
