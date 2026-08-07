import { Loader2, ShieldCheck } from 'lucide-react'
import { puestaEnMarchaAfip } from '@/utils/puestaEnMarchaAfip'

// ════════════════════════════════════════════
//  ADMINAPP · «Puesta en marcha», el checklist de facturación
//
//  Es el bloque que evita la llamada «no puedo facturar»: cuatro pasos, cada uno
//  con su estado real y con qué hacer si no está.
//
//  ── Acá NO se decide nada ──
//
//  Todo lo que este componente dibuja sale de `utils/puestaEnMarchaAfip.js`, que
//  es puro y tiene su test. Un `if` acá adentro sería una regla que solo se puede
//  verificar montando la pantalla entera.
//
//  ── El paso 4 es el que bloquea ──
//
//  «Circuito verificado» no se marca solo y no lo puede marcar el cliente: la
//  evidencia la escribe el servidor después de que AFIP contestó, y
//  `PUT /api/settings/afip_verificacion` la rechaza. Un paso de checklist que el
//  cliente puede marcar solo no es un paso de checklist — y de éste depende poder
//  pasar a producción.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

export default function PuestaEnMarchaAfip({
  configuracion,
  certificado,
  verificacion,
  verificando = false,
  puedeVerificar = true,
  onVerificar,
}) {
  const { pasos, completa, pendientes } = puestaEnMarchaAfip({
    configuracion,
    certificado,
    verificacion,
  })

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
        <h2>Puesta en marcha</h2>

        {/* El contador dice cuántos faltan, no cuántos hay: es lo que decide si
            hay algo que hacer. `completa` sale de la función pura y no de una
            cuenta acá, para que la pantalla no pueda decir «listo» sobre un
            checklist con un paso pendiente (FR-085). */}
        <span
          data-puesta-en-marcha={completa ? 'completa' : 'pendiente'}
          className={`num rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            completa ? 'bg-ok-soft text-ok' : 'bg-surface-3 text-fg-2'
          }`}
        >
          {completa ? 'Todo listo' : `${pendientes} sin resolver`}
        </span>
      </div>

      <ol className="divide-y divide-border">
        {pasos.map((paso) => (
          <li key={paso.codigo} className="flex flex-wrap items-start gap-3 px-5 py-4">
            <span
              className={`num grid h-7 w-7 shrink-0 place-items-center rounded-full border
                          text-[12px] font-semibold ${paso.tono}`}
            >
              {paso.numero}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13.5px] font-semibold">{paso.titulo}</p>
                <span
                  data-paso={paso.codigo}
                  data-estado-del-paso={paso.estado}
                  className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${paso.tono}`}
                >
                  {paso.etiqueta}
                </span>
              </div>

              <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-fg-2">
                {paso.detalle}
              </p>
            </div>

            {/* La acción vive en el paso que la necesita. Un botón «Verificar»
                arriba, lejos del renglón que dice qué falta, es el que nadie
                relaciona con el paso 4. */}
            {paso.codigo === 'circuito' && (
              <button
                type="button"
                className={BOTON_SECUNDARIO}
                onClick={onVerificar}
                disabled={verificando || !puedeVerificar}
                title={
                  puedeVerificar
                    ? 'Pide el ticket de acceso y consulta el último comprobante autorizado. No emite nada.'
                    : 'Necesitás el permiso «config.editar»'
                }
              >
                {verificando
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <ShieldCheck className="h-4 w-4 text-fg-3" />}
                {verificando ? 'Verificando…' : 'Verificar circuito'}
              </button>
            )}
          </li>
        ))}
      </ol>

      {/* ⚠ Lo que esta línea evita es una llamada, y está medida: pasar a
          producción sin verificar responde 400. Sin decirlo acá, el error
          aparece recién al guardar y se lee como que el sistema se rompió. */}
      <p className="border-t border-border bg-surface-2 px-5 py-3 text-[12.5px] text-fg-2">
        Mientras el paso 4 no esté cumplido no se puede pasar el ambiente a producción:
        el primer comprobante fiscal real no puede ser también la primera prueba del circuito.
        Verificar es una consulta —no emite ningún comprobante ni consume numeración—.
      </p>
    </section>
  )
}
