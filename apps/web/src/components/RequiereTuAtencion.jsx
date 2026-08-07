import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  PackageX,
  ReceiptText,
  ShieldAlert,
} from 'lucide-react'
import { etiquetaDeAviso, ordenarAvisos, tonoDeAviso } from '@/utils/panel'

// ════════════════════════════════════════════
//  ADMINAPP · «Requiere tu atención»
//
//  Lo que hay que mirar hoy, ordenado por urgencia, y **cada renglón lleva a la
//  pantalla que lo detalla**.
//
//  ── Por qué el enlace es la mitad del bloque ──
//
//  Un aviso que dice «12 productos por debajo del mínimo» y no lleva a ningún
//  lado obliga a buscar cuáles a mano, que es lo que este bloque vino a evitar.
//  Y llevar a una pantalla que muestra OTRO número es peor todavía: por eso el
//  aviso de faltantes es de la sucursal activa —igual que `GET /api/faltantes`—
//  y **lo dice** debajo del título (FR-057, FR-059).
//
//  ── Un aviso con cero casos no llega hasta acá ──
//
//  El servidor no lo manda (FR-065). Un bloque con cuatro renglones que dicen
//  «0» entrena a no leerlo, y el día que uno diga «3» nadie lo va a ver.
//
//  ── Y sin ningún aviso, el bloque DICE que no hay nada ──
//
//  No se dibuja el encabezado sobre el vacío: eso se lee como «no cargó». El
//  estado vacío de este bloque dice algo distinto del de las otras pantallas
//  (FR-019): acá «no hay nada» es una buena noticia, no una lista sin resultados.
//
//  Todos los datos llegan por props: la severidad, el orden y el texto salen de
//  `utils/panel.js`, y acá no se recalcula ninguno.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/** El ícono de cada tipo. El desconocido tiene el suyo y no desaparece. */
const ICONOS = {
  faltantes: PackageX,
  sin_cae: ReceiptText,
  vencimientos: CalendarClock,
  certificado_afip: ShieldAlert,
}

export default function RequiereTuAtencion({ avisos = [] }) {
  const ordenados = ordenarAvisos(avisos)

  return (
    <section
      data-bloque="requiere-atencion"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <h2>Requiere tu atención</h2>

        {/* El contador NO se dibuja en cero: un badge que dice «0» al lado de un
            título en rojo es la forma más rápida de que el bloque deje de
            leerse. */}
        {ordenados.length > 0 && (
          <span className="num rounded-full bg-danger-soft px-[7px] py-px text-[11px] font-semibold text-danger">
            {ordenados.length}
          </span>
        )}
      </div>

      {ordenados.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-fg-3" strokeWidth={1.6} />
          <p className="mt-2 font-semibold">No hay nada que atender ahora mismo.</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-sm text-fg-2">
            Ni faltantes, ni comprobantes que AFIP haya rechazado, ni lotes por vencer
            en los próximos 30 días.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {ordenados.map((aviso) => {
            const { titulo, alcance, accion } = etiquetaDeAviso(aviso)
            const Icono = ICONOS[aviso.tipo] || AlertCircle

            return (
              <li key={aviso.tipo} className="border-b border-border last:border-b-0">
                <Link
                  to={aviso.ruta || '#'}
                  className="flex w-full items-center gap-3.5 px-5 py-[15px] text-left
                             transition-colors hover:bg-surface-2"
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border ${tonoDeAviso(aviso)}`}
                  >
                    <Icono className="h-4 w-4" />
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[13.5px] font-medium">{titulo}</span>
                    {/* De dónde sale el número. Sin esto, el Panel diría 12 y la
                        pantalla a la que lleva mostraría 7. */}
                    <span className="text-[12.5px] text-fg-2">{alcance}</span>
                  </span>

                  <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-brand">
                    {accion}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
