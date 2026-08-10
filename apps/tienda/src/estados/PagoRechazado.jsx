// ════════════════════════════════════════════
//  Pago rechazado
//
//  ⚠ **El orden de lectura es el diseño** (maqueta, `:560-584`). Lo primero que
//  se lee no es «error», ni el código del banco: es que **no se cobró nada** y
//  que **el pedido no se perdió**, con su número. Recién después vienen las
//  alternativas.
//
//  El motivo es que las dos preguntas que tiene alguien a quien le rechazaron una
//  tarjeta son ésas, en ese orden, y una pantalla que las contesta al final —o
//  que no las contesta— produce la llamada al comercio que este módulo existe
//  para evitar. «Rechazada» arriba y las opciones abajo es la misma información
//  puesta al revés.
//
//  El rojo no es el color del comercio: sale de `--alerta`. Un rechazo del banco
//  se lee igual en un catálogo turquesa que en uno negro, y pintarlo con la marca
//  sería teñir la mala noticia con la cara del comercio.
// ════════════════════════════════════════════

import { BotonDeMarca, IconoAlerta } from './plantilla.jsx'
import Pie from '../pie.jsx'

/** Una opción de pago del catálogo. La rechazada lleva su marca al costado. */
function Medio({ etiqueta, rechazado, onClick }) {
  return (
    <button
      type="button"
      className="t-foco"
      onClick={onClick}
      style={{
        width: '100%',
        padding: '13px',
        border: `1px solid ${rechazado ? 'var(--alerta-borde)' : 'var(--borde)'}`,
        borderRadius: '12px',
        background: 'var(--papel)',
        font: 'inherit',
        fontSize: '13.5px',
        color: rechazado ? 'var(--tinta)' : 'var(--tinta-media)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '10px',
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span>{etiqueta}</span>
      {rechazado ? (
        <span
          style={{
            fontSize: '11.5px',
            fontWeight: 600,
            color: 'var(--alerta)',
            background: 'var(--alerta-fondo)',
            border: '1px solid var(--alerta-borde)',
            padding: '3px 8px',
            borderRadius: '6px',
            flex: 'none',
          }}
        >
          Rechazada
        </span>
      ) : null}
    </button>
  )
}

/**
 * @param {object} props
 * @param {string|number} props.numero El número del pedido, que ya existe: el
 *   pago falló, el pedido no. Es lo único que esa persona tiene para nombrarlo.
 * @param {Array<{clave: string, etiqueta: string, rechazado?: boolean}>} props.medios
 * @param {Function} props.alReintentar
 * @param {Function} [props.alElegirMedio]
 */
export default function PagoRechazado({ catalogo, numero, medios = [], alReintentar, alElegirMedio }) {
  return (
    <main data-estado="pago_rechazado" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          height: '50px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          borderBottom: '1px solid var(--borde)',
          fontSize: '15px',
          fontWeight: 640,
        }}
      >
        Pago
      </div>

      <div className="t-ancho" style={{ flex: 1, padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: '11px',
            padding: '14px',
            border: '1px solid var(--alerta-borde)',
            background: 'var(--alerta-fondo)',
            borderRadius: '12px',
            color: 'var(--alerta)',
          }}
        >
          <IconoAlerta />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 640, color: 'var(--alerta)' }}>
              El banco rechazó el pago
            </p>
            <p style={{ margin: '5px 0 0', fontSize: '12.5px', lineHeight: 1.5, color: 'var(--tinta-media)' }}>
              No se descontó nada de tu cuenta.{' '}
              {numero == null ? (
                'Tu pedido quedó guardado, podés intentar de nuevo o cambiar el medio de pago.'
              ) : (
                <>
                  Tu pedido quedó guardado con el número{' '}
                  <span data-numero style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 640 }}>
                    #{numero}
                  </span>
                  , podés intentar de nuevo o cambiar el medio de pago.
                </>
              )}
            </p>
          </div>
        </div>

        {medios.map((m) => (
          <Medio
            key={m.clave}
            etiqueta={m.etiqueta}
            rechazado={m.rechazado === true}
            onClick={alElegirMedio ? () => alElegirMedio(m.clave) : undefined}
          />
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--borde)', padding: '12px 14px 16px' }}>
        <div className="t-ancho">
          <BotonDeMarca onClick={alReintentar} style={{ width: '100%', height: '48px', fontSize: '15px' }}>
            Reintentar el pago
          </BotonDeMarca>
        </div>
      </div>

      <Pie catalogo={catalogo} />
    </main>
  )
}
