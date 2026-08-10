// ════════════════════════════════════════════
//  El molde de los estados · y qué NO es
//
//  ⚠ Esto **no es la pantalla genérica**. El molde no dice una sola palabra: no
//  tiene título por defecto, no tiene texto de respaldo, no tiene un icono que
//  aparezca si nadie pasa uno. Lo único que aporta es el maquetado —centrado,
//  con aire, con las acciones abajo—, que es idéntico en la maqueta para
//  «catálogo pausado», «sin resultados» y «carrito vacío» (`:500-558`).
//
//  La diferencia importa porque el defecto que T1446 evita es exactamente ese:
//  seis situaciones distintas que terminan en el mismo cartel de «algo salió
//  mal». Un molde **sin texto** no puede caer en eso: si alguien agrega un estado
//  y no escribe qué dice, la pantalla sale vacía y se ve. Un molde con un título
//  por defecto lo taparía, y esa es toda la distancia entre las dos cosas.
//
//  `src/tests/estados.test.jsx` lo fija desde afuera: recorre los estados y
//  verifica que no haya dos que digan lo mismo.
// ════════════════════════════════════════════

import Pie from '../pie.jsx'

/** El marco de pantalla completa: alto entero, el pie abajo de todo (FR-122). */
export function Marco({ estado, catalogo, children, encabezado }) {
  return (
    <main
      data-estado={estado}
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      {encabezado}
      <div className="t-ancho" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      <Pie catalogo={catalogo} />
    </main>
  )
}

/**
 * El bloque centrado. **Todo** lo que se lee llega por props.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.icono
 * @param {string} props.titulo   Lo que se lee primero. Obligatorio, a propósito.
 * @param {import('react').ReactNode} props.detalle Qué pasó y qué se puede hacer.
 * @param {import('react').ReactNode} [props.acciones] Los botones, si hay alguno.
 */
export function Aviso({ icono, titulo, detalle, acciones }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 32px 56px',
      }}
    >
      <span style={{ color: 'var(--tinta-suave)', display: 'grid', placeItems: 'center' }}>
        {icono}
      </span>
      <p style={{ margin: '12px 0 0', fontSize: '15px', fontWeight: 640 }}>{titulo}</p>
      <p
        style={{
          margin: '7px 0 0',
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--tinta-media)',
          maxWidth: '34ch',
        }}
      >
        {detalle}
      </p>
      {acciones ? (
        <div style={{ display: 'flex', gap: '8px', marginTop: '18px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {acciones}
        </div>
      ) : null}
    </div>
  )
}

// ── Los dos botones ──
//
// El de marca y el neutro. Están acá y no repetidos en cada estado porque el
// criterio de la maqueta —«el color aparece solo en lo que se toca»— se sostiene
// si hay **un** lugar donde se decide qué se pinta con `var(--marca)`.

const BASE_BOTON = {
  height: '44px',
  padding: '0 18px',
  borderRadius: '11px',
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
}

// ⚠ `style` se **funde**, no se reemplaza. Con `{...resto}` después del `style`,
// un `style={{ width: '100%' }}` de quien lo usa borraría el fondo, el borde y el
// color del texto de un plumazo: el botón sale transparente y sigue funcionando,
// que es la forma de romperse que nadie reporta.
export function BotonDeMarca({ children, style, ...resto }) {
  return (
    <button
      type="button"
      className="t-foco"
      {...resto}
      style={{
        ...BASE_BOTON,
        border: '1px solid transparent',
        background: 'var(--marca)',
        color: 'var(--marca-texto)',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

export function BotonNeutro({ children, style, ...resto }) {
  return (
    <button
      type="button"
      className="t-foco"
      {...resto}
      style={{
        ...BASE_BOTON,
        border: '1px solid var(--borde)',
        background: 'var(--papel)',
        color: 'var(--tinta)',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ── Los iconos ──
//
// Copiados de la maqueta, con `stroke="currentColor"` en vez del gris literal:
// así heredan el color del contenedor y no hay un hexadecimal suelto en un `svg`.

const svg = { width: '30px', height: '30px', display: 'block' }
const trazo = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  style: svg,
}

export const IconoPausa = () => (
  <svg {...trazo}>
    <circle cx="12" cy="12" r="10" />
    <path d="M4.929 4.929 19.07 19.071" />
  </svg>
)

export const IconoLupaVacia = () => (
  <svg {...trazo}>
    <path d="m13.5 8.5-5 5" />
    <path d="m8.5 8.5 5 5" />
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

export const IconoCarrito = () => (
  <svg {...trazo}>
    <circle cx="8" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
  </svg>
)

export const IconoReloj = () => (
  <svg {...trazo}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
)

export const IconoTienda = () => (
  <svg {...trazo}>
    <path d="M3 9h18l-1.5-4.5a2 2 0 0 0-1.9-1.5H6.4a2 2 0 0 0-1.9 1.5Z" />
    <path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
    <path d="m9.5 14.5 5 5" />
    <path d="m14.5 14.5-5 5" />
  </svg>
)

export const IconoAlerta = (props) => (
  <svg {...trazo} strokeWidth={1.8} style={{ ...svg, width: '19px', height: '19px', flex: 'none' }} {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
)
