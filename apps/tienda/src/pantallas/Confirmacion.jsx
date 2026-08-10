import { precioTexto } from '../formato.js'
import Pie from '../pie.jsx'

// ════════════════════════════════════════════
//  El pedido hecho (maqueta, `esConfirmado`, `:391-429`)
//
//  ── Lo que esta pantalla NO promete ──
//
//  **No dice que mandamos nada por email** salvo que el email haya salido de
//  verdad. Son dos condiciones y las dos hacen falta: que el comprador haya
//  dejado un email (es opcional, FR-149) y que el servidor diga que lo mandó
//  (`email_enviado`, FR-182).
//
//  El defecto que esto evita ya pasó en este repositorio, con `sendEmail`
//  devolviendo `ok: true` sin haber enviado nada: la pantalla promete un correo,
//  el correo no llega, y el comprador espera un detalle que no va a existir. Peor
//  que no prometerlo es prometerlo y no cumplirlo, porque el que espera no
//  vuelve a preguntar.
//
//  ── El número ──
//
//  `#1042`. El numeral es de presentación y **no se guarda**; el formato es el
//  mismo en las seis superficies (FR-137b). La letra de la maqueta (`#A-1042`) se
//  descartó: los ocho ejemplos compartían la `A` siendo de dos catálogos
//  distintos.
//
//  ── El WhatsApp viene armado del servidor ──
//
//  El enlace llega en la respuesta (`pedido.whatsapp`) con los nombres y los
//  precios **congelados** del pedido. Si lo armara esta pantalla con lo que tiene
//  en memoria, el mensaje podría decir un precio y la base otro — y el que
//  discute con el cliente es el mensaje. Sin enlace, el botón **no se dibuja**:
//  un botón que abre WhatsApp sin destinatario es peor que ninguno.
// ════════════════════════════════════════════

const QUE_PASA = {
  transferencia: 'Te vamos a escribir por WhatsApp para coordinar. Cuando transfieras, mandanos el comprobante.',
  efectivo: 'Te avisamos por WhatsApp cuando esté listo para que lo pases a buscar.',
}

/**
 * @param {object} props
 * @param {object} props.pedido Lo que devolvió `POST …/pedidos`: `numero`,
 *   `total`, `envio_costo`, `entrega`, `medio_pago`, `lineas` y —si el servidor
 *   pudo armarlo— `whatsapp` y `email_enviado`.
 */
export default function Confirmacion({ pedido = {}, catalogo, alVolver }) {
  const lineas = pedido.lineas || []
  const envio = Number(pedido.envio_costo) || 0

  // Las dos condiciones. Ninguna alcanza sola.
  const prometeEmail = pedido.email_enviado === true && Boolean(pedido.email)

  return (
    <main data-pantalla="confirmado" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="t-ancho" style={{ flex: 1, padding: '32px 16px 24px' }}>
        <div style={{ textAlign: 'center' }}>
          <span
            aria-hidden="true"
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              background: 'var(--marca)',
              color: 'var(--marca-texto)',
              display: 'inline-grid',
              placeItems: 'center',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: '24px', height: '24px', display: 'block' }}
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>

          <p style={{ margin: '14px 0 0', fontSize: '13px', color: 'var(--tinta-media)' }}>Tu pedido</p>
          <p data-numero style={{ margin: '2px 0 0', fontSize: '30px', fontWeight: 680, letterSpacing: '-0.02em' }}>
            #{pedido.numero}
          </p>

          {prometeEmail ? (
            <p data-email style={{ margin: '10px 0 0', fontSize: '12.5px', lineHeight: 1.5, color: 'var(--tinta-media)' }}>
              Te mandamos el detalle por email a {pedido.email}
            </p>
          ) : null}
        </div>

        <div
          style={{
            marginTop: '22px',
            padding: '14px',
            borderRadius: '13px',
            border: '1px solid var(--borde)',
            background: 'var(--superficie)',
          }}
        >
          <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--tinta-suave)' }}>
            Resumen
          </p>

          {lineas.map((l, i) => (
            <div
              key={`${l.nombre}-${i}`}
              data-linea
              style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '5px 0', fontSize: '13px' }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ color: 'var(--tinta-suave)' }}>{l.cantidad}×</span> {l.nombre}
              </span>
              <span style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{precioTexto(l.subtotal)}</span>
            </div>
          ))}

          {/* Un renglón «Envío $0» le hace pensar al comprador que paga algo. */}
          {envio > 0 ? (
            <div data-envio style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '5px 0', fontSize: '13px' }}>
              <span>Envío a domicilio</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{precioTexto(envio)}</span>
            </div>
          ) : null}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '10px',
              marginTop: '9px',
              paddingTop: '10px',
              borderTop: '1px solid var(--borde)',
            }}
          >
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>Total</span>
            <span data-total style={{ fontSize: '19px', fontWeight: 660, fontVariantNumeric: 'tabular-nums' }}>
              {precioTexto(pedido.total)}
            </span>
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--tinta-suave)' }}>
            Qué pasa ahora
          </p>
          <p data-que-pasa style={{ margin: '6px 0 0', fontSize: '13px', lineHeight: 1.55, color: 'var(--tinta-media)' }}>
            {QUE_PASA[pedido.medio_pago] || 'Te vamos a escribir por WhatsApp para coordinar la entrega.'}
          </p>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--borde)', background: 'var(--papel)', padding: '13px 16px 18px' }}>
        <div className="t-ancho" style={{ display: 'grid', gap: '9px' }}>
          {/* Sin enlace no hay botón. Lo arma el servidor o no existe. */}
          {pedido.whatsapp ? (
            <a
              className="t-foco"
              data-whatsapp
              href={pedido.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'grid',
                placeItems: 'center',
                height: '50px',
                borderRadius: '12px',
                background: 'var(--marca)',
                color: 'var(--marca-texto)',
                fontSize: '15px',
                fontWeight: 640,
                textDecoration: 'none',
              }}
            >
              Mandar el detalle por WhatsApp
            </a>
          ) : null}

          <button
            type="button"
            className="t-foco"
            data-volver
            onClick={alVolver}
            style={{
              width: '100%',
              height: '46px',
              borderRadius: '12px',
              border: '1px solid var(--borde)',
              background: 'var(--papel)',
              color: 'var(--tinta)',
              font: 'inherit',
              fontSize: '14px',
              fontWeight: 620,
              cursor: 'pointer',
            }}
          >
            Volver al catálogo
          </button>
        </div>
      </div>

      <Pie catalogo={catalogo} />
    </main>
  )
}
