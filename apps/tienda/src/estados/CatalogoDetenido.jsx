// ════════════════════════════════════════════
//  Los tres estados en los que no hay productos que mostrar
//
//  `pausado`, `no_disponible` y el slug que no existe. **Comparten el camino**
//  —el mismo marco, la misma portada apagada, el mismo molde— y **no comparten
//  una sola palabra**. Es la forma que pide T1446: un solo recorrido para que no
//  se desincronicen, textos propios para que nadie confunda uno con otro.
//
//  ── Por qué `no_disponible` no puede decir lo que dice `apps/web` ──
//
//  ⚠ `no_disponible` es lo que devuelve el router público cuando la suscripción
//  del comercio está bloqueada (`catalogoPublico.js:118-123`). En `apps/web` ese
//  mismo hecho es un 402 y una pantalla que habla de renovar el plan, porque del
//  otro lado está el comerciante. **Acá del otro lado está un socio del
//  gimnasio**, y contarle que el comercio le debe plata a Favalio no es asunto
//  suyo: es información del comercio, filtrada a cualquiera que escanee el QR.
//
//  Por eso este texto no nombra la suscripción, ni un vencimiento, ni un pago. Y
//  por eso `src/tests/estados.test.jsx` lo afirma buscando esas tres palabras: es
//  el defecto que se cuela solo, copiando el texto que ya existe del otro lado.
//
//  ── Y por qué la portada se queda ──
//
//  Apagada, pero se queda. El socio tiene que reconocer que **llegó al lugar
//  correcto** y que el problema es temporal; una pantalla en blanco con un cartel
//  se lee como «escaneaste mal» y manda a alguien a buscar otro QR que no existe.
//  (maqueta, «Catálogo pausado», `:500-513`)
// ════════════════════════════════════════════

import { Aviso, BotonDeMarca, IconoPausa, IconoTienda, Marco } from './plantilla.jsx'

/**
 * La portada del comercio, apagada.
 *
 * Sin `portada` cargada queda la banda con el color de marca desaturado, que
 * sigue siendo reconocible: el color es lo primero que se recuerda de un
 * catálogo que ya se abrió antes.
 */
function PortadaApagada({ catalogo }) {
  const c = catalogo || {}
  const fondo = c.portada
    ? { backgroundImage: `url(${JSON.stringify(c.portada)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {
        backgroundImage:
          'repeating-linear-gradient(135deg, color-mix(in srgb, var(--tinta) 5%, transparent) 0 5px, transparent 5px 11px), ' +
          'linear-gradient(160deg, color-mix(in srgb, var(--marca) 22%, var(--papel)), color-mix(in srgb, var(--marca) 9%, var(--papel)))',
      }

  return (
    <div
      data-portada="apagada"
      aria-hidden="true"
      style={{ height: '132px', filter: 'grayscale(.5)', opacity: 0.8, ...fondo }}
    />
  )
}

/** `whatsapp_destino` es un teléfono escrito a mano; `wa.me` quiere solo dígitos. */
export const enlaceDeWhatsapp = (numero) => {
  const digitos = String(numero ?? '').replace(/\D/g, '')
  return digitos ? `https://wa.me/${digitos}` : null
}

// ════════════════════════════════════════════
//  1 · Pausado
// ════════════════════════════════════════════
export function Pausada({ catalogo }) {
  const c = catalogo || {}
  const nombre = c.nombre || 'El comercio'
  const wa = enlaceDeWhatsapp(c.whatsapp)

  return (
    <Marco estado="pausado" catalogo={catalogo} encabezado={<PortadaApagada catalogo={catalogo} />}>
      <Aviso
        icono={<IconoPausa />}
        titulo="El catálogo está en pausa"
        detalle={
          <>
            {nombre} lo despausa cuando vuelve a tomar pedidos.
            {wa ? ' Podés escribirle mientras tanto.' : ''}
          </>
        }
        acciones={
          wa ? (
            // Un enlace y no un botón: abre otra aplicación. Un `<button>` que
            // navega es lo que rompe «abrir en otra pestaña» y la pulsación
            // larga del teléfono.
            <a
              className="t-foco"
              href={wa}
              rel="noreferrer noopener"
              target="_blank"
              style={{
                display: 'grid',
                placeItems: 'center',
                height: '44px',
                padding: '0 18px',
                borderRadius: '11px',
                border: '1px solid var(--borde)',
                background: 'var(--papel)',
                color: 'var(--tinta)',
                fontSize: '14px',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Escribir por WhatsApp
            </a>
          ) : null
        }
      />
    </Marco>
  )
}

// ════════════════════════════════════════════
//  2 · No disponible
//
//  El estado neutro. Sin WhatsApp: el comercio no pidió que le escriban, y
//  ofrecer un canal que nadie está mirando es peor que no ofrecer ninguno.
// ════════════════════════════════════════════
export function NoDisponible({ catalogo }) {
  return (
    <Marco estado="no_disponible" catalogo={catalogo} encabezado={<PortadaApagada catalogo={catalogo} />}>
      <Aviso
        icono={<IconoPausa />}
        titulo="El catálogo no está disponible"
        detalle="No lo podemos mostrar en este momento. Volvé a entrar más tarde con el mismo enlace."
      />
    </Marco>
  )
}

// ════════════════════════════════════════════
//  3 · La tienda que no existe
//
//  El 404 del router público, que contesta **lo mismo** para un slug inventado y
//  para un catálogo en borrador: si el borrador contestara distinto, probando
//  slugs se podría averiguar qué catálogos existen sin publicar
//  (`catalogoPublico.js:78-81`). Esta pantalla respeta eso y no distingue: dice
//  que el enlace no lleva a ninguna tienda, y nada más.
// ════════════════════════════════════════════
export function NoEncontrada({ alReintentar }) {
  return (
    <Marco estado="no_encontrada">
      <Aviso
        icono={<IconoTienda />}
        titulo="Este enlace no lleva a ninguna tienda"
        detalle="Revisá que esté completo, o volvé a escanear el código del mostrador."
        acciones={alReintentar ? <BotonDeMarca onClick={alReintentar}>Probar de nuevo</BotonDeMarca> : null}
      />
    </Marco>
  )
}
