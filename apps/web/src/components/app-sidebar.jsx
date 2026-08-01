import { NavLink, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { cn } from '@/lib/utils'
import useStore from '@/store/useStore'
import { usePermission } from '@/hooks/usePermission'
import { gruposVisibles } from '@/components/navegacion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { PanelLeft, LogOut, Menu } from 'lucide-react'

// ════════════════════════════════════════════
//  Barra lateral
//
//  Sigue la maqueta del rediseño: 240px abierta, 60px contraída, ítems de 34px
//  agrupados bajo etiquetas en mayúsculas.
//
//  El selector de empresa y sucursal se movió al encabezado. Estaba acá
//  adentro, arriba del menú, empujando la navegación hacia abajo — y es un
//  control que se usa dos veces por día, no cada vez que se cambia de
//  pantalla.
//
//  Las reglas de estilo están en docs/REGLAS-DISENO.md.
// ════════════════════════════════════════════

function ItemDeNavegacion({ to, icon: Icono, label, abierta, activa }) {
  const contenido = (
    <NavLink
      to={to}
      className={cn(
        'flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors',
        abierta ? 'justify-start' : 'justify-center',
        activa
          ? 'bg-brand-soft font-semibold text-brand-dark'
          : 'font-medium text-fg-2 hover:bg-surface-3 hover:text-foreground'
      )}
    >
      <Icono
        className={cn('h-[16.5px] w-[16.5px] shrink-0', activa ? 'text-brand-dark' : 'text-fg-3')}
        strokeWidth={1.7}
      />
      {abierta && <span className="truncate">{label}</span>}
    </NavLink>
  )

  // Contraída, el nombre solo existe en el tooltip: sin él la barra es una
  // columna de íconos que hay que adivinar.
  if (abierta) return contenido

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{contenido}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function Contenido({ abierta = true, onAlternar }) {
  const { user, logout } = useAuth0()
  const { pathname } = useLocation()
  const usuario = useStore((s) => s.usuario)
  const empresaActiva = useStore((s) => s.empresaActiva)
  const { can } = usePermission()

  // El ítem activo se calcula acá y no con el render-prop de NavLink: la barra
  // marca por prefijo, para que una sub-ruta como /inventario/123 siga
  // resaltando Inventario.
  const estaActivo = (to) => pathname === to || pathname.startsWith(`${to}/`)

  const ajustes = empresaActiva?.settings || {}
  const esDueño = user?.sub === ajustes.owner_auth0_sub

  const grupos = gruposVisibles(can, {
    esSuperadmin: usuario?.es_superadmin === true,
    modulosHabilitados: ajustes.enabled_modules,
    esDueño,
  })

  const nombre = user?.name || usuario?.nombre || 'Usuario'
  const inicial = (nombre.charAt(0) || 'U').toUpperCase()

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">

      {/* Marca */}
      <div className="flex h-[60px] shrink-0 items-center gap-2.5 px-3.5">
        <img
          src={empresaActiva?.logo || '/logo_sin_fondo.png'}
          alt=""
          className="h-7 w-7 shrink-0 rounded-[7px] object-contain"
        />
        {abierta && (
          <>
            <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-[-0.01em]">
              {empresaActiva?.name || 'AdminApp'}
            </span>
            {onAlternar && (
              <button
                onClick={onAlternar}
                title="Contraer barra lateral"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-fg-3
                           transition-colors hover:bg-surface-3 hover:text-fg-2"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto overflow-x-hidden px-3 pb-3">
        {grupos.map((grupo) => (
          <div key={grupo.label} className="flex flex-col gap-0.5">
            {abierta && (
              <div className="eyebrow px-2 pb-1.5">{grupo.label}</div>
            )}
            {grupo.items.map((item) => (
              <ItemDeNavegacion
                key={item.to}
                {...item}
                abierta={abierta}
                activa={estaActivo(item.to)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Usuario */}
      <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-3 py-2.5">
        <div className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border
                        border-brand-line bg-brand-soft text-[11.5px] font-semibold text-brand-dark">
          {user?.picture
            ? <img src={user.picture} alt="" className="h-full w-full object-cover" />
            : inicial}
        </div>

        {abierta && (
          <>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[12.5px] font-semibold">{nombre}</span>
              <span className="truncate text-[11px] text-fg-3">
                {usuario?.email || user?.email || ''}
              </span>
            </div>

            <Tooltip delayDuration={0}>
              <TooltipTrigger
                onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-fg-3
                           transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <LogOut className="h-[15px] w-[15px]" />
              </TooltipTrigger>
              <TooltipContent side="top">Cerrar sesión</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}

export function AppSidebar({ abierta, onAlternar }) {
  return (
    <aside
      className={cn(
        'hidden shrink-0 border-r border-border transition-[width] duration-200 lg:flex',
        abierta ? 'w-[240px]' : 'w-[60px]'
      )}
    >
      <Contenido abierta={abierta} onAlternar={onAlternar} />
    </aside>
  )
}

/** Disparador y panel de la barra lateral en pantallas chicas. */
export function SidebarMovil() {
  const { pathname } = useLocation()

  return (
    <Sheet key={pathname}>
      <SheetTrigger
        className="grid h-[30px] w-[30px] place-items-center rounded-[7px] text-fg-2
                   transition-colors hover:bg-surface-3 lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-4 w-4" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[240px] p-0">
        <Contenido abierta />
      </SheetContent>
    </Sheet>
  )
}
