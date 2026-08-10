import { precioTexto } from '../formato.js'
import { acotarCantidad } from '../carrito.js'
import { faltaParaElEnvioGratis, subtotalDelCarrito } from '../totales.js'

// ════════════════════════════════════════════
//  El carrito (maqueta, `esCarrito`, `:199-255`)
//
//  ── Lo que esta pantalla NO hace ──
//
//  No calcula precios. El importe de cada línea es `precio × cantidad` con el
//  `precio` que resolvió el servidor, y el subtotal es la suma de esos importes
//  (`src/totales.js`). Si acá se sumara `precio_lista` —que es el número que está
//  al lado, tachado— el carrito mostraría un total más alto que el que el
//  servidor va a cobrar, y el comprador se enteraría en la confirmación.
//
//  ── El control de cantidad sale de `acotarCantidad` ──
//
//  La misma función que la ficha y que el propio carrito, por el mismo motivo que
//  está escrito en `Ficha.jsx`: si el tope del botón «más» se calculara acá,
//  serían dos reglas para el mismo número y la de arriba taparía a la de abajo.
//
//  ── El vacío no se dibuja acá ──
//
//  `CarritoVacio` es un estado propio y lo elige `App.jsx` antes de montar esta
//  pantalla. Dibujar los dos casos en el mismo componente deja un `if` que separa
//  dos pantallas que no comparten nada.
// ════════════════════════════════════════════

const iconoBase = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.9',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

function Linea({ linea, alPoner, alQuitar }) {
  const acotar = (n) => acotarCantidad(n, linea.stock_disponible)
  const importe = (Number(linea.precio) || 0) * linea.cantidad

  const botonCantidad = {
    width: '30px',
    height: '30px',
    border: 0,
    background: 'transparent',
    borderRadius: '7px',
    display: 'grid',
    placeItems: 'center',
    color: 'var(--tinta)',
    cursor: 'pointer',
  }

  return (
    <li
      data-linea={linea.product_id}
      style={{ display: 'flex', gap: '12px', padding: '14px 0', borderBottom: '1px solid var(--borde)' }}
    >
      {linea.imagen ? (
        <img
          src={linea.imagen}
          alt=""
          style={{ width: '64px', height: '64px', flex: 'none', borderRadius: '10px', objectFit: 'cover' }}
        />
      ) : (
        <div className="t-damero" style={{ width: '64px', height: '64px', flex: 'none', borderRadius: '10px' }} />
      )}

      {/* `minWidth: 0` es lo que deja que un nombre largo se corte en vez de
          empujar la fila y desbordar la pantalla a 390 px. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 600, lineHeight: 1.3 }}>{linea.nombre}</p>
            {/* Sin marca no va el renglón: la clave viene ausente, no vacía. */}
            {linea.marca ? (
              <p data-marca style={{ margin: '2px 0 0', fontSize: '11.5px', color: 'var(--tinta-suave)' }}>
                {linea.marca}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            className="t-foco"
            data-quitar
            aria-label={`Quitar ${linea.nombre}`}
            onClick={() => alQuitar(linea.product_id)}
            style={{
              width: '28px',
              height: '28px',
              flex: 'none',
              border: 0,
              background: 'transparent',
              borderRadius: '7px',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--tinta-suave)',
              cursor: 'pointer',
            }}
          >
            <svg {...iconoBase} style={{ width: '15px', height: '15px', display: 'block' }}>
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>

        <div style={{ marginTop: '9px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              border: '1px solid var(--borde)',
              borderRadius: '9px',
              padding: '2px',
            }}
          >
            <button
              type="button"
              className="t-foco"
              data-cantidad="menos"
              aria-label="Quitar uno"
              onClick={() => alPoner(linea.product_id, linea.cantidad - 1)}
              style={botonCantidad}
            >
              <svg {...iconoBase} style={{ width: '14px', height: '14px', display: 'block' }}>
                <path d="M5 12h14" />
              </svg>
            </button>

            <output
              data-cantidad="valor"
              aria-live="polite"
              style={{ minWidth: '26px', textAlign: 'center', fontSize: '13.5px', fontWeight: 640, fontVariantNumeric: 'tabular-nums' }}
            >
              {linea.cantidad}
            </output>

            <button
              type="button"
              className="t-foco"
              data-cantidad="mas"
              aria-label="Agregar uno"
              // El tope se decide con la **misma** función que acota el valor.
              disabled={acotar(linea.cantidad + 1) === linea.cantidad}
              onClick={() => alPoner(linea.product_id, linea.cantidad + 1)}
              style={botonCantidad}
            >
              <svg {...iconoBase} style={{ width: '14px', height: '14px', display: 'block' }}>
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </button>
          </div>

          <span data-importe style={{ fontSize: '14.5px', fontWeight: 640, fontVariantNumeric: 'tabular-nums' }}>
            {precioTexto(importe)}
          </span>
        </div>
      </div>
    </li>
  )
}

/**
 * @param {object} props
 * @param {Array} props.lineas Las del carrito, con su instantánea.
 * @param {object} [props.catalogo] El catálogo público, por la entrega.
 * @param {Function} props.alPoner `(product_id, cantidad)`.
 * @param {Function} props.alQuitar `(product_id)`.
 * @param {Function} props.alVolver
 * @param {Function} props.alContinuar
 */
export default function Carrito({ lineas = [], catalogo, alPoner, alQuitar, alVolver, alContinuar }) {
  const subtotal = subtotalDelCarrito(lineas)
  const entrega = (catalogo && catalogo.entrega) || {}
  const falta = faltaParaElEnvioGratis(entrega, subtotal)

  return (
    <main data-pantalla="carrito" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '0 12px',
          background: 'var(--papel)',
          borderBottom: '1px solid var(--borde)',
        }}
      >
        <button
          type="button"
          className="t-foco"
          data-volver
          aria-label="Volver al catálogo"
          onClick={alVolver}
          style={{
            width: '34px',
            height: '34px',
            flex: 'none',
            borderRadius: '9px',
            border: '1px solid var(--borde)',
            background: 'var(--papel)',
            color: 'var(--tinta)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
          }}
        >
          <svg {...iconoBase} style={{ width: '17px', height: '17px', display: 'block' }}>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span style={{ fontSize: '15px', fontWeight: 640 }}>Tu pedido</span>
      </div>

      <div className="t-ancho" style={{ flex: 1 }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: '6px 16px 24px' }}>
          {lineas.map((l) => (
            <Linea key={l.product_id} linea={l} alPoner={alPoner} alQuitar={alQuitar} />
          ))}
        </ul>
      </div>

      {/* El pie con el subtotal. **Subtotal y no total**: el envío depende de la
          entrega, que se elige en el paso siguiente, y mostrar un «total» que
          después cambia es peor que no mostrarlo. */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--papel)',
          borderTop: '1px solid var(--borde)',
          padding: '14px 16px 18px',
        }}
      >
        <div className="t-ancho">
          {falta !== null ? (
            <p data-falta-envio style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--tinta-media)' }}>
              Te faltan {precioTexto(falta)} para el envío gratis.
            </p>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px', gap: '8px' }}>
            <span style={{ fontSize: '13.5px', color: 'var(--tinta-media)' }}>Subtotal</span>
            <span data-subtotal style={{ fontSize: '19px', fontWeight: 660, fontVariantNumeric: 'tabular-nums' }}>
              {precioTexto(subtotal)}
            </span>
          </div>

          <button
            type="button"
            className="t-foco"
            data-continuar
            onClick={alContinuar}
            style={{
              width: '100%',
              height: '50px',
              borderRadius: '12px',
              border: '1px solid transparent',
              background: 'var(--marca)',
              color: 'var(--marca-texto)',
              font: 'inherit',
              fontSize: '15px',
              fontWeight: 640,
              cursor: 'pointer',
            }}
          >
            Continuar con mis datos
          </button>
        </div>
      </div>
    </main>
  )
}
