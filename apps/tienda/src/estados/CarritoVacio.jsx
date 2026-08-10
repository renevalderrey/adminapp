// ════════════════════════════════════════════
//  Carrito vacío
//
//  ⚠ **Sin barra inferior** (maqueta, `:541-558`). El carrito con líneas tiene
//  una barra fija abajo con el total y el botón de seguir; acá no hay total que
//  mostrar, y dejar la barra con «$0» y un botón que no lleva a ningún lado es
//  dibujar un camino que no existe. El único camino posible es el botón del medio,
//  y por eso está en el medio.
//
//  El encabezado con el «volver» **sí** queda: se llegó acá desde algún lado y
//  hay que poder volver sin usar el gesto del navegador.
// ════════════════════════════════════════════

import { Aviso, BotonDeMarca, IconoCarrito, Marco } from './plantilla.jsx'

export default function CarritoVacio({ catalogo, alVolverAlCatalogo }) {
  return (
    <Marco
      estado="carrito_vacio"
      catalogo={catalogo}
      encabezado={
        <div
          style={{
            height: '50px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '0 12px',
            borderBottom: '1px solid var(--borde)',
          }}
        >
          <button
            type="button"
            className="t-foco"
            onClick={alVolverAlCatalogo}
            aria-label="Volver al catálogo"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '9px',
              border: '1px solid var(--borde)',
              background: 'var(--papel)',
              color: 'var(--tinta)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
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
              style={{ width: '16px', height: '16px', display: 'block' }}
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span style={{ fontSize: '15px', fontWeight: 640 }}>Tu pedido</span>
        </div>
      }
    >
      <Aviso
        icono={<IconoCarrito />}
        titulo="Tu pedido está vacío"
        detalle="Agregá productos del catálogo y los vas a ver acá antes de pagar."
        acciones={<BotonDeMarca onClick={alVolverAlCatalogo}>Ver el catálogo</BotonDeMarca>}
      />
    </Marco>
  )
}
