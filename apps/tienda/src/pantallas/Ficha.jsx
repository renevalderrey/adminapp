import { useState } from 'react'
import { acotarCantidad } from '../carrito.js'
import { precioTexto } from '../formato.js'
import Pie from '../pie.jsx'

// ════════════════════════════════════════════
//  La ficha de producto (maqueta, `esProducto`, `:160-197`)
//
//  Pantalla completa con «volver», y no una hoja que sube desde abajo: se llega
//  acá desde una tarjeta y también desde una URL pegada (`/p/:id`), y una hoja
//  modal abierta sobre nada es una pantalla de la que no se puede salir.
//
//  ── Las tres reglas que se prueban ──
//
//  1. **La descripción falta cuando está vacía.** No se dibuja el párrafo con
//     nada adentro: la clave viene **ausente** de la API cuando el producto no
//     tiene descripción, y un `<p>` vacío deja un hueco de 20 px entre el precio y
//     la cantidad que se lee como «acá iba algo y no cargó».
//  2. **El control de cantidad está acotado.** Nunca deja pedir más de lo que
//     hay. El tope sale de `acotarCantidad` (`src/carrito.js`), que es la misma
//     función que usa el carrito: si el tope se calculara acá, la ficha y el
//     carrito podrían discrepar y el que gana es el último que se tocó.
//  3. **El botón «Sin stock» es inerte.** `disabled` **y** sin `onClick`: las dos
//     cosas. Solo `disabled` alcanza para el navegador, pero deja el manejador
//     escrito y a la vista, y el próximo que lo lea va a poder «arreglar» el
//     botón sacándole el atributo sin darse cuenta de qué desbloquea.
//
//  ── ⚠ Sobre `stock_disponible` ──
//
//  El contrato (`contracts/api-endpoints.md:188-192`) dice que la ficha trae
//  `stock_disponible`. **La API implementada no lo manda todavía**: el handler de
//  `/productos/:id` devuelve el mismo objeto de la grilla, que lleva `agotado` y
//  ningún entero (`utils/vistaPublica.js:90-116`). Esto está escrito para las dos
//  situaciones y sin una rama: `acotarCantidad(n, undefined)` acota al techo duro
//  de 999 —el mismo que rechaza el servidor con `ITEMS_INVALIDOS`— y
//  `acotarCantidad(n, 3)` acota a 3 el día que el campo llegue. No hay nada que
//  cambiar acá cuando llegue, y mientras tanto el que decide es `agotado`.
// ════════════════════════════════════════════

/**
 * @param {Function} props.acotar La regla del tope, **una sola**. No se recibe el
 *   máximo y se compara acá: recibir `maximo` obliga a este componente a decidir
 *   por su cuenta cuándo deshabilitar el «más», y esa decisión y la que acota el
 *   valor terminan siendo dos reglas para el mismo número. Con dos, la de arriba
 *   tapa a la de abajo: se le puede sacar el tope al valor y el control sigue
 *   frenando, así que el test queda verde con la regla rota. Con `acotar`, las
 *   dos salen del mismo lugar y se rompen juntas.
 */
function Cantidad({ valor, acotar, alCambiar, inerte }) {
  const boton = {
    width: '36px',
    height: '36px',
    border: 0,
    background: 'transparent',
    borderRadius: '8px',
    display: 'grid',
    placeItems: 'center',
    color: 'var(--tinta)',
    cursor: inerte ? 'default' : 'pointer',
  }
  const icono = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.9',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: { width: '15px', height: '15px', display: 'block' },
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        border: '1px solid var(--borde)',
        borderRadius: '10px',
        padding: '3px',
      }}
    >
      <button
        type="button"
        className="t-foco"
        data-cantidad="menos"
        aria-label="Quitar uno"
        disabled={inerte || valor <= 1}
        onClick={() => alCambiar(valor - 1)}
        style={boton}
      >
        <svg {...icono}>
          <path d="M5 12h14" />
        </svg>
      </button>

      <output
        data-cantidad="valor"
        aria-live="polite"
        style={{
          minWidth: '34px',
          textAlign: 'center',
          fontSize: '15px',
          fontWeight: 640,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {valor}
      </output>

      <button
        type="button"
        className="t-foco"
        data-cantidad="mas"
        aria-label="Agregar uno"
        // El tope se decide con la **misma** función que acota el valor.
        disabled={inerte || acotar(valor + 1) === valor}
        onClick={() => alCambiar(valor + 1)}
        style={boton}
      >
        <svg {...icono}>
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
      </button>
    </div>
  )
}

/**
 * @param {object} props
 * @param {object} props.producto El objeto público del producto.
 * @param {object} [props.catalogo] Para el pie.
 * @param {Function} props.alVolver
 * @param {Function} props.alAgregar Recibe `(producto, cantidad)`.
 */
export default function Ficha({ producto, catalogo, alVolver, alAgregar }) {
  const p = producto || {}
  const agotado = p.agotado === true

  const [cantidad, setCantidad] = useState(1)

  // ⚠ **La única regla del tope de esta pantalla.** El «más» se deshabilita con
  // ella y el valor se acota con ella: romperla rompe las dos cosas a la vez, que
  // es lo que hace que un test lo vea.
  const acotar = (n) => Math.max(1, acotarCantidad(n, p.stock_disponible))
  const poner = (n) => setCantidad(acotar(n))

  return (
    <main data-pantalla="producto" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Volver ── */}
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
          onClick={alVolver}
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '9px',
            border: '1px solid var(--borde)',
            background: 'var(--papel)',
            color: 'var(--tinta)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ width: '17px', height: '17px', display: 'block' }}
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span style={{ fontSize: '13.5px', fontWeight: 600 }}>Volver al catálogo</span>
      </div>

      <div className="t-ancho" style={{ flex: 1 }}>
        {/* ── La foto grande ── */}
        {p.imagen ? (
          <img
            src={p.imagen}
            alt={p.nombre || ''}
            style={{ width: '100%', height: '300px', objectFit: 'cover', display: 'block', borderBottom: '1px solid var(--borde)' }}
          />
        ) : (
          <div
            className="t-damero"
            style={{
              height: '300px',
              display: 'grid',
              placeItems: 'center',
              borderBottom: '1px solid var(--borde)',
              fontSize: '11px',
              color: 'var(--tinta-suave)',
            }}
          >
            Sin foto
          </div>
        )}

        <div style={{ padding: '18px 16px 24px' }}>
          {/* Sin marca no va el renglón. Ausente, no `null`. */}
          {p.marca ? (
            <span
              data-marca
              style={{
                fontSize: '10.5px',
                fontWeight: 600,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'var(--tinta-suave)',
              }}
            >
              {p.marca}
            </span>
          ) : null}

          <h1 style={{ margin: '5px 0 0', fontSize: '21px', fontWeight: 660, letterSpacing: '-0.02em', lineHeight: 1.25 }}>
            {p.nombre}
          </h1>

          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'baseline', gap: '9px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '26px', fontWeight: 660, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
              {precioTexto(p.precio)}
            </span>
            {p.precio_lista ? (
              <span
                data-precio-lista
                style={{
                  fontSize: '14px',
                  color: 'var(--tinta-suave)',
                  textDecoration: 'line-through',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {precioTexto(p.precio_lista)}
              </span>
            ) : null}
            {p.ahorro_pct ? (
              <span data-ahorro style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--marca)' }}>
                {p.ahorro_pct}% de ahorro
              </span>
            ) : null}
            {p.unidad ? (
              <span style={{ fontSize: '12px', color: 'var(--tinta-suave)' }}>por {p.unidad}</span>
            ) : null}
          </div>

          {/* ⚠ Regla 1: ausente cuando está vacía. */}
          {p.descripcion ? (
            <p data-descripcion style={{ margin: '14px 0 0', fontSize: '13.5px', lineHeight: 1.55, color: 'var(--tinta-media)' }}>
              {p.descripcion}
            </p>
          ) : null}

          <div
            style={{
              marginTop: '18px',
              paddingTop: '16px',
              borderTop: '1px solid var(--borde)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>Cantidad</span>
            <Cantidad valor={cantidad} acotar={acotar} alCambiar={poner} inerte={agotado} />
          </div>
        </div>
      </div>

      {/* ── El botón de agregar ── */}
      <div style={{ borderTop: '1px solid var(--borde)', background: 'var(--papel)', padding: '12px 16px 18px' }}>
        <div className="t-ancho">
          <button
            type="button"
            className="t-foco"
            data-agregar
            disabled={agotado}
            // ⚠ Regla 3: sin stock, no hay manejador. No es `disabled` y además
            // el `onClick` escrito al lado.
            onClick={agotado ? undefined : () => alAgregar(p, cantidad)}
            style={{
              width: '100%',
              height: '50px',
              borderRadius: '12px',
              border: '1px solid transparent',
              background: agotado ? 'var(--marcador)' : 'var(--marca)',
              color: agotado ? 'var(--tinta-suave)' : 'var(--marca-texto)',
              font: 'inherit',
              fontSize: '15px',
              fontWeight: 640,
              cursor: agotado ? 'default' : 'pointer',
            }}
          >
            {agotado ? 'Sin stock' : 'Agregar al pedido'}
          </button>
        </div>
      </div>

      <Pie catalogo={catalogo} />
    </main>
  )
}
