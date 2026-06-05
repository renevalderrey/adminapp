import { NavLink, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button, buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ShoppingCart,
  ClipboardList,
  Package,
  Truck,
  Wallet,
  BarChart3,
  FileCheck,
  FileSpreadsheet,
  LogOut,
  Menu,
  Zap,
  Factory,
  Users,
  DollarSign,
  Building2,
  Store,
  UserCog,
  CreditCard,
} from "lucide-react"
import { useAuth0 } from "@auth0/auth0-react"
import useStore from "@/store/useStore"
import { usePermission } from "@/hooks/usePermission"

const navSections = [
  {
    label: "Operaciones",
    permission: null,
    items: [
      { to: "/pos", icon: ShoppingCart, label: "Punto de Venta", permission: "ventas.crear" },
      { to: "/ventas", icon: ClipboardList, label: "Historial de Ventas", permission: "ventas.ver" },
      { to: "/clientes", icon: Users, label: "Clientes", permission: "clientes.ver" },
      { to: "/produccion", icon: Factory, label: "Producción", permission: "produccion.ver" },
    ],
  },
  {
    label: "Gestión",
    permission: null,
    items: [
      { to: "/inventario", icon: Package, label: "Inventario", permission: "stock.ver" },
      { to: "/recetas", icon: Zap, label: "Fórmulas / Recetas", permission: "recetas.ver" },
      { to: "/proveedores", icon: Truck, label: "Proveedores", permission: "proveedores.ver" },
      { to: "/ordenes-compra", icon: Package, label: "Órdenes de Compra", permission: "ordenes_compra.ver" },
      { to: "/gastos", icon: Wallet, label: "Gastos Fijos", permission: "gastos.ver" },
      { to: "/reportes", icon: FileSpreadsheet, label: "Reportes", permission: "reportes.ver" },
      { to: "/caja", icon: DollarSign, label: "Flujo de Caja", permission: "caja.ver" },
      { to: "/impuestos", icon: FileCheck, label: "Impuestos", permission: "config.ver" },
    ],
  },
  {
    label: "Equipo",
    permission: null,
    items: [
      { to: "/team", icon: UserCog, label: "Equipo", permission: "equipo.ver" },
    ],
  },
  {
    label: "Configuración",
    permission: null,
    items: [
      { to: "/panel", icon: BarChart3, label: "Panel de Control", permission: "dashboard.ver" },
      { to: "/facturacion", icon: FileCheck, label: "Facturación AFIP", permission: "config.ver" },
      { to: "/suscripcion", icon: CreditCard, label: "Suscripción", permission: "config.ver" },
    ],
  },
]

function NavItem({ to, icon: Icon, label }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger>
        <NavLink
          to={to}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              isActive && "bg-accent text-accent-foreground font-semibold"
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span>{label}</span>
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right" className="lg:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function SidebarContent() {
  const { user, logout } = useAuth0()
  const usuario = useStore(s => s.usuario)
  const empresaActiva = useStore(s => s.empresaActiva)
  const empresas = useStore(s => s.empresas)
  const setEmpresaActiva = useStore(s => s.setEmpresaActiva)
  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)
  const setPuntoDeVentaActivo = useStore(s => s.setPuntoDeVentaActivo)
  const { can } = usePermission()

  const displayName = user?.name || usuario?.nombre || "Usuario"
  const displayEmail = user?.email || usuario?.email || ""
  const displayPicture = user?.picture
  const displayInitial = (user?.name?.charAt(0) || usuario?.nombre?.charAt(0) || "U").toUpperCase()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-sm">
          <Zap className="h-5 w-5" />
        </div>
        <div className="flex flex-col">
          <span className="text-base font-bold tracking-tight">System</span>
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            Gestión Comercial
          </span>
        </div>
      </div>

      <Separator className="shrink-0" />

      {/* Scrollable middle section */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-2">
        {empresas.length > 0 && (
          <>
            <div>
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1">
                Empresa
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                {empresas.length > 1 ? (
                  <Select
                    value={empresaActiva?.id?.toString()}
                    onValueChange={(v) => setEmpresaActiva(parseInt(v))}
                  >
                    <SelectTrigger className="h-8 w-full text-sm">
                      <SelectValue placeholder="Seleccionar empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      {empresas.map(emp => (
                        <SelectItem key={emp.id} value={emp.id.toString()}>
                          {emp.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-8 w-full rounded-md border border-input bg-background px-3 flex items-center text-sm font-semibold">
                    {empresaActiva?.name}
                  </div>
                )}
              </div>
            </div>

            <div>
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1">
                Sucursal
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <Store className="h-4 w-4 text-muted-foreground shrink-0" />
                {(empresaActiva?.puntosDeVenta?.length ?? 0) > 1 ? (
                  <Select
                    value={puntoDeVentaActivo?.id?.toString()}
                    onValueChange={(v) => {
                      const pv = empresaActiva.puntosDeVenta.find(p => p.id === parseInt(v))
                      if (pv) setPuntoDeVentaActivo(pv)
                    }}
                  >
                    <SelectTrigger className="h-8 w-full text-sm">
                      <SelectValue placeholder="Sucursal" />
                    </SelectTrigger>
                    <SelectContent>
                      {empresaActiva.puntosDeVenta.map(pv => (
                        <SelectItem key={pv.id} value={pv.id.toString()}>
                          {pv.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-8 w-full rounded-md border border-input bg-background px-3 flex items-center text-sm font-semibold">
                    {puntoDeVentaActivo?.name || empresaActiva?.puntosDeVenta?.[0]?.name || '—'}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <Separator />

        <nav className="flex flex-col gap-6">
          {navSections.map((section) => {
            const visibleItems = section.items.filter(item => !item.permission || can(item.permission));
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label}>
                <h4 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  {section.label}
                </h4>
                <div className="flex flex-col gap-0.5">
                  {visibleItems.map((item) => (
                    <NavItem key={item.to} {...item} />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </div>

      <Separator className="shrink-0" />

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 min-h-[56px]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0 overflow-hidden">
            {displayPicture ? (
              <img src={displayPicture} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              displayInitial
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm text-foreground font-semibold truncate">
              {displayName}
            </span>
            <span className="text-[11px] text-muted-foreground truncate">
              {displayEmail}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ThemeToggle />
          <Tooltip delayDuration={0}>
            <TooltipTrigger
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-muted-foreground hover:text-destructive")}
              onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
            >
              <LogOut className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="top">Cerrar sesión</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export function AppSidebar() {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[260px] shrink-0 border-r border-border bg-sidebar text-sidebar-foreground">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      <div className="lg:hidden fixed top-0 left-0 z-40 p-3">
        <Sheet>
          <SheetTrigger className={cn(buttonVariants({ variant: "outline", size: "icon" }), "h-9 w-9")}>
            <Menu className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-[260px] p-0">
            <SidebarContent />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
