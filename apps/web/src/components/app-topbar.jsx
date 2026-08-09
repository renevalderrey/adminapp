import { useLocation } from 'react-router-dom'
import useStore from '@/store/useStore'
import { itemDeRuta, alcanceDeRuta } from '@/components/navegacion'
import { SidebarMovil } from '@/components/app-sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { PanelLeft, ChevronRight, Building2, MapPin, ShieldAlert } from 'lucide-react'

// ════════════════════════════════════════════
//  Encabezado
//
//  60px, tres zonas: dónde estoy (miga de pan), sobre qué estoy trabajando
//  (empresa y sucursal), y las acciones globales.
//
//  El selector de empresa y sucursal vive acá y no en la barra lateral porque
//  es contexto de trabajo, no navegación: contesta "sobre qué datos estoy
//  operando", que es lo que uno necesita ver siempre, en cualquier pantalla.
// ════════════════════════════════════════════

export function AppTopbar({ sidebarAbierta, onAlternarSidebar }) {
  const { pathname } = useLocation()

  const empresaActiva = useStore((s) => s.empresaActiva)
  const empresas = useStore((s) => s.empresas)
  const setEmpresaActiva = useStore((s) => s.setEmpresaActiva)
  const puntoDeVentaActivo = useStore((s) => s.puntoDeVentaActivo)
  const setPuntoDeVentaActivo = useStore((s) => s.setPuntoDeVentaActivo)

  const item = itemDeRuta(pathname)
  const puntosDeVenta = empresaActiva?.puntosDeVenta || []

  // ⚠ El selector NO se dibuja en las pantallas cuyo alcance es la empresa.
  //
  // Estaba en las doce y significaba una cosa distinta en cada una: dos lo usan
  // de filtro, dos lo siembran, y ocho lo ignoraban. Alguien que cambia de
  // sucursal en Equipo espera ver otro equipo y ve el mismo, así que concluye
  // que el sistema no le hizo caso.
  //
  // La regla queda de una línea: **si está, hace algo.** El alcance de cada
  // pantalla lo declara `navegacion.js`, al lado de su nombre y su permiso.
  const miraLaSucursal = alcanceDeRuta(pathname) === 'sucursal'

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface pl-4 pr-5">

      <SidebarMovil />

      {/* Solo con la barra contraída: expandirla desde acá. Con la barra
          abierta el botón vive adentro, al lado del logo. */}
      {!sidebarAbierta && (
        <button
          onClick={onAlternarSidebar}
          title="Expandir barra lateral"
          className="hidden h-[30px] w-[30px] place-items-center rounded-[7px] text-fg-3
                     transition-colors hover:bg-surface-3 hover:text-fg-2 lg:grid"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}

      {/* Miga de pan */}
      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {item?.grupo && (
          <>
            <span className="hidden whitespace-nowrap text-fg-3 sm:inline">{item.grupo}</span>
            <ChevronRight className="hidden h-[13px] w-[13px] shrink-0 text-fg-3 sm:block" />
          </>
        )}
        <span className="truncate font-semibold">{item?.label || 'AdminApp'}</span>
      </div>

      <div className="flex-1" />

      {/* Estás en la empresa de un cliente, no en la tuya.
          Sin esto es cuestión de tiempo hasta que alguien cargue una venta en
          la empresa equivocada y no se entere hasta el cierre del día. */}
      {empresaActiva?.ajena && (
        <span className="hidden items-center gap-1.5 rounded-md border border-warn-line bg-warn-soft
                         px-2 py-1 text-[11.5px] font-semibold text-warn lg:inline-flex"
          title="Estás viendo la empresa de un cliente. Todo lo que hagas queda registrado con tu usuario.">
          <ShieldAlert className="h-3.5 w-3.5" />
          Empresa de cliente
        </span>
      )}

      {/* Contexto: empresa y sucursal */}
      <div className={`hidden items-center gap-2 rounded-lg border bg-surface-2 px-2.5 py-1
                      transition-colors hover:border-border-2 md:flex ${
                        empresaActiva?.ajena ? 'border-warn-line' : 'border-border'
                      }`}>
        <Building2 className="h-3.5 w-3.5 shrink-0 text-fg-3" />

        {empresas.length > 1 ? (
          <Select
            value={empresaActiva?.id?.toString()}
            onValueChange={(v) => setEmpresaActiva(parseInt(v, 10))}
          >
            <SelectTrigger className="h-6 border-0 bg-transparent px-0 text-[12.5px] font-semibold shadow-none focus:ring-0">
              <SelectValue placeholder="Empresa" />
            </SelectTrigger>
            <SelectContent>
              {empresas.map((e) => (
                <SelectItem key={e.id} value={e.id.toString()}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="whitespace-nowrap text-[12.5px] font-semibold">
            {empresaActiva?.name || '—'}
          </span>
        )}

        {puntosDeVenta.length > 0 && miraLaSucursal && (
          <>
            <span className="h-3.5 w-px bg-border" />
            <MapPin className="h-3.5 w-3.5 shrink-0 text-fg-3" />

            {puntosDeVenta.length > 1 ? (
              <Select
                value={puntoDeVentaActivo?.id?.toString()}
                onValueChange={(v) => {
                  const pv = puntosDeVenta.find((p) => p.id === parseInt(v, 10))
                  if (pv) setPuntoDeVentaActivo(pv)
                }}
              >
                <SelectTrigger className="h-6 border-0 bg-transparent px-0 text-[12.5px] text-fg-2 shadow-none focus:ring-0">
                  <SelectValue placeholder="Sucursal" />
                </SelectTrigger>
                <SelectContent>
                  {puntosDeVenta.map((pv) => (
                    <SelectItem key={pv.id} value={pv.id.toString()}>{pv.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="whitespace-nowrap text-[12.5px] text-fg-2">
                {puntoDeVentaActivo?.name || puntosDeVenta[0]?.name}
              </span>
            )}
          </>
        )}
      </div>

      <ThemeToggle />
    </header>
  )
}
