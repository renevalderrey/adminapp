// ════════════════════════════════════════════
//  Cargando · la silueta del catálogo real, no un spinner
//
//  ⚠ **El servidor puede tardar en despertar.** La API vive en un plan que
//  suspende el contenedor cuando no hay tráfico, y el primer pedido después de un
//  rato quieto puede tardar decenas de segundos. Del otro lado hay alguien parado
//  en la puerta de un gimnasio, con datos móviles, que acaba de escanear un QR.
//
//  Un spinner en esa espera dice «esto se colgó»: gira igual a los dos segundos
//  que a los cuarenta y no informa de nada. La silueta dice otra cosa —dice **qué
//  va a llegar**: una portada, un logo, un buscador, unas categorías y una grilla
//  de dos columnas—, y a los cuatro segundos aparece además la línea que explica
//  la demora, para que la espera larga tenga una causa y no sea una falla.
//
//  Las medidas son las de la maqueta (`:477-498`) y las mismas que usa el
//  catálogo de verdad: si la silueta y la pantalla no coinciden, el momento en
//  que llegan los datos se ve como un salto y se lee como que algo se rompió.
// ════════════════════════════════════════════

import { useEffect, useState } from 'react'
import Pie from '../pie.jsx'

/** Cuánto se espera antes de admitir que está tardando. */
export const SEGUNDOS_HASTA_EXPLICAR = 4

const bloque = (estilo) => ({ borderRadius: '6px', background: 'var(--marcador)', ...estilo })

export default function Cargando({ tardaDesdeElPrimerRender = false }) {
  const [tarda, setTarda] = useState(tardaDesdeElPrimerRender)

  useEffect(() => {
    if (tardaDesdeElPrimerRender) return undefined
    const reloj = setTimeout(() => setTarda(true), SEGUNDOS_HASTA_EXPLICAR * 1000)
    return () => clearTimeout(reloj)
  }, [tardaDesdeElPrimerRender])

  return (
    <main data-estado="cargando" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Lo único que se anuncia. Un lector de pantalla no puede leer una
          silueta: sin esto, la espera es silencio. */}
      <p className="t-solo-lectores" role="status" aria-live="polite">
        Estamos abriendo el catálogo.
      </p>

      <div className="t-ancho" style={{ flex: 1 }} aria-hidden="true">
        {/* La portada */}
        <div className="t-esqueleto" style={{ height: '132px' }} />

        <div style={{ padding: '0 16px' }}>
          {/* El logo, montado sobre la portada como en el catálogo */}
          <div
            style={bloque({
              width: '76px',
              height: '76px',
              borderRadius: '18px',
              marginTop: '-38px',
              border: '3px solid var(--papel)',
            })}
          />

          {/* Nombre y descripción */}
          <div style={bloque({ width: '170px', height: '20px', marginTop: '14px' })} />
          <div style={bloque({ width: '100%', maxWidth: '250px', height: '11px', marginTop: '9px' })} />

          {/* El buscador */}
          <div style={bloque({ height: '40px', borderRadius: '10px', marginTop: '14px' })} />

          {/* Las píldoras de categoría */}
          <div style={{ display: 'flex', gap: '7px', marginTop: '11px' }}>
            <div style={bloque({ width: '64px', height: '28px', borderRadius: '999px' })} />
            <div style={bloque({ width: '80px', height: '28px', borderRadius: '999px' })} />
            <div style={bloque({ width: '72px', height: '28px', borderRadius: '999px' })} />
          </div>

          {/* La grilla: dos columnas en el teléfono, tres en escritorio, igual
              que la de verdad. Cuatro tarjetas alcanzan para ocupar la primera
              pantalla sin fingir un catálogo entero. */}
          <div className="t-grilla" style={{ marginTop: '14px', paddingBottom: '24px' }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="t-esqueleto" style={{ height: '190px', borderRadius: '12px' }} />
            ))}
          </div>

          {tarda ? (
            <p
              data-tarda="si"
              style={{
                margin: '0 0 28px',
                textAlign: 'center',
                fontSize: '12.5px',
                lineHeight: 1.5,
                color: 'var(--tinta-media)',
              }}
            >
              Estamos despertando la tienda. Puede tardar unos segundos más.
            </p>
          ) : null}
        </div>
      </div>

      <Pie />
    </main>
  )
}
