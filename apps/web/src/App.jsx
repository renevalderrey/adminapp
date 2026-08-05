import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import api, { setAuthToken, setEmpresaContext, setOnUnauthorized, setOnSubscriptionExpired } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import useStore from '@/store/useStore'
import { AppSidebar } from '@/components/app-sidebar'
import { AppTopbar } from '@/components/app-topbar'
import ErrorBoundary from '@/components/ErrorBoundary'
import MarcoDePantalla from '@/components/MarcoDePantalla'
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

          {/* ── El marco de 1320px ya no lo pone el shell ──

              Antes este `<main>` scrolleaba entero y adentro había un solo
              `<div>` que centraba TODAS las pantallas a 1320px. El punto de
              venta es la primera que no entra en ese marco: ocupa el alto
              completo y administra sus dos zonas de scroll —el catálogo por un
              lado y la lista del ticket por el otro—, con la barra de búsqueda y
              el pie de cobro siempre a la vista. Un ticket que scrollea con la
              página deja de estar visible justo cuando tiene ocho ítems, que es
              cuando hace falta mirarlo.

              Así que el marco bajó a `<MarcoDePantalla>` —con el scroll
              adentro— y cada ruta lo aplica. `/pos` es la ÚNICA que no, y esa
              excepción está escrita en `docs/REGLAS-DISENO.md` y verificada por
              `tests/marcoDePantalla.test.js`: si mañana alguien saca otra
              pantalla del marco, ese test se pone en rojo hasta que lo declare.

              El `<main>` pasa a `overflow-hidden` porque el scroll ahora es del
              marco. Las alternativas —márgenes negativos en `Billing.jsx`, o
              una ruta fuera del shell— están descartadas en la decisión 6 del
              plan: las dos son peores y no hay que volver a intentarlas. */}
          <main className="min-h-0 flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Navigate to="/pos" replace />} />
              <Route path="/pos" element={<div className="h-full"><Billing /></div>} />
              <Route path="/ventas" element={<MarcoDePantalla><InvoicesList /></MarcoDePantalla>} />
              <Route path="/inventario" element={<MarcoDePantalla><Inventory /></MarcoDePantalla>} />
              <Route path="/recetas" element={<MarcoDePantalla><RouteGuard soloSuperadmin requiredModule="recetas"><Recipes /></RouteGuard></MarcoDePantalla>} />
              <Route path="/produccion" element={<MarcoDePantalla><RouteGuard soloSuperadmin requiredModule="produccion"><Production /></RouteGuard></MarcoDePantalla>} />
              <Route path="/clientes" element={<MarcoDePantalla><RouteGuard soloSuperadmin requiredModule="clientes"><Customers /></RouteGuard></MarcoDePantalla>} />
              <Route path="/caja" element={<MarcoDePantalla><RouteGuard soloSuperadmin requiredModule="caja"><CashFlow /></RouteGuard></MarcoDePantalla>} />
              <Route path="/impuestos" element={<MarcoDePantalla><RouteGuard soloSuperadmin requiredModule="impuestos"><Taxes /></RouteGuard></MarcoDePantalla>} />
              <Route path="/proveedores" element={<MarcoDePantalla><RouteGuard requiredModule="proveedores"><Orders /></RouteGuard></MarcoDePantalla>} />
              <Route path="/ordenes-compra" element={<MarcoDePantalla><RouteGuard requiredModule="ordenes-compra"><PurchaseOrders /></RouteGuard></MarcoDePantalla>} />
              <Route path="/faltantes" element={<MarcoDePantalla><Faltantes /></MarcoDePantalla>} />
              <Route path="/comparador" element={<MarcoDePantalla><Comparador /></MarcoDePantalla>} />
              <Route path="/reportes" element={<MarcoDePantalla><RouteGuard soloSuperadmin requiredModule="reportes"><Reports /></RouteGuard></MarcoDePantalla>} />
              <Route path="/gastos" element={<MarcoDePantalla><Expenses /></MarcoDePantalla>} />
              <Route path="/panel" element={<MarcoDePantalla><Dashboard /></MarcoDePantalla>} />
              <Route path="/facturacion" element={<MarcoDePantalla><Settings /></MarcoDePantalla>} />
              <Route path="/team" element={<MarcoDePantalla><Team /></MarcoDePantalla>} />
              <Route path="/suscripcion" element={<MarcoDePantalla><SubscriptionSettings /></MarcoDePantalla>} />
              <Route path="/calculator" element={<Navigate to="/panel" replace />} />
              <Route path="/billing" element={<Navigate to="/pos" replace />} />
              <Route path="/invoices" element={<Navigate to="/ventas" replace />} />
              <Route path="/inventory" element={<Navigate to="/inventario" replace />} />
              <Route path="/orders" element={<Navigate to="/proveedores" replace />} />
              <Route path="/expenses" element={<Navigate to="/gastos" replace />} />
              <Route path="/settings" element={<Navigate to="/facturacion" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      <Toaster />
    </ErrorBoundary>
  )
}

export default App
