// ════════════════════════════════════════════
//  Se agotó mientras compraba
//
//  ⚠ **La línea no desaparece** (maqueta, `:586-624`). Queda tachada, en su
//  lugar, arriba del total nuevo.
//
//  Es la regla entera de esta pantalla. Lo natural al programar el 409 de stock
//  es sacar del carrito lo que ya no hay y volver a dibujar: el resultado es un
//  pedido que vale menos y un comprador que no sabe por qué, y que lo primero que
//  piensa es que le cobraron mal. Un cambio de importe sin causa visible es la
//  clase de cosa que termina en una llamada al comercio, y el comercio tampoco
//  sabe qué pasó.
//
//  Con la línea tachada, el total nuevo tiene una explicación que está a la vista
//  y a dos centímetros del número. No hace falta leer nada más.
//
//  El ámbar no es el color del comercio: sale de `--aviso`. Esto no es un error
//  —nadie hizo nada mal—, es una novedad, y por eso no se pinta del rojo de
//  «pago rechazado».
// ════════════════════════════════════════════

import { precioTexto } from '../formato.js'
import { BotonDeMarca, IconoAlerta } from './plantilla.jsx'
import Pie from '../pie.jsx'

/** El marcador de foto, del mismo tamaño que la foto, para que nada se descuadre. */
function Miniatura({ imagen, nombre }) {
  return imagen ? (
    <img
      src={imagen}
      alt=""
      style={{ width: '56px', height: '56px', flex: 'none', borderRadius: '10px', objectFit: 'cover' }}
    />
  ) : (
    <div
      className="t-damero"
      aria-hidden="true"
      data-sin-foto={nombre}
      style={{ width: '56px', height: '56px', flex: 'none', borderRadius: '10px' }}
    />
  )
}

/**
 * @param {object} props
 * @param {Array} props.lineas Las del pedido, **todas**: las que quedan y las que
 *   se cayeron. Cada una `{ product_id, nombre, marca?, imagen?, precio, cantidad,
 *   quitada? }`. Que las quitadas viajen en la misma lista y no en un array aparte
 *   es deliberado: así el orden original se conserva y la que se cayó queda donde
 *   estaba, no amontonada arriba.
 * @param {number} props.total El total nuevo. **Lo manda el servidor** (H2): esta
 *   pantalla no suma las líneas que quedaron.
 */
export default function SeAgoto({ catalogo, lineas = [], total, alSeguir }) {
  const nombreDelComercio = (catalogo && catalogo.nombre) || 'el comercio'
  const cuantas = lineas.filter((l) => l.quitada).length

  return (
    <main data-estado="se_agoto" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
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
        Tu pedido
      </div>

      <div className="t-ancho" style={{ flex: 1, padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: '11px',
            padding: '13px',
            border: '1px solid var(--aviso-borde)',
            background: 'var(--aviso-fondo)',
            borderRadius: '12px',
            color: 'var(--aviso)',
          }}
        >
          <IconoAlerta />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 640, color: 'var(--aviso)' }}>
              {cuantas > 1 ? 'Se agotaron productos de tu pedido' : 'Se agotó un producto de tu pedido'}
            </p>
            <p style={{ margin: '5px 0 0', fontSize: '12.5px', lineHeight: 1.5, color: 'var(--tinta-media)' }}>
              {cuantas > 1 ? 'Los sacamos' : 'Lo sacamos'} del total. Podés seguir con el resto o avisarle a{' '}
              {nombreDelComercio} para que {cuantas > 1 ? 'los reponga' : 'lo reponga'}.
            </p>
          </div>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lineas.map((l) => (
            <li
              key={l.product_id}
              data-linea={l.quitada ? 'quitada' : 'queda'}
              style={{
                display: 'flex',
                gap: '11px',
                padding: '12px 0',
                borderBottom: '1px solid var(--borde)',
                // La línea caída se apaga, pero **se queda**. Es lo único que
                // explica el total de abajo.
                opacity: l.quitada ? 0.55 : 1,
              }}
            >
              <Miniatura imagen={l.imagen} nombre={l.nombre} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: '13.5px',
                    fontWeight: 600,
                    textDecoration: l.quitada ? 'line-through' : 'none',
                  }}
                >
                  {l.nombre}
                </p>

                {/* Sin marca no va el renglón. La clave viene **ausente**, no en
                    null, así que un `l.marca &&` alcanza — y es lo que evita el
                    «undefined» abajo del nombre. */}
                {l.marca ? (
                  <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: 'var(--tinta-suave)' }}>{l.marca}</p>
                ) : null}

                {l.quitada ? (
                  <p style={{ margin: '6px 0 0', fontSize: '11.5px', fontWeight: 600, color: 'var(--aviso)' }}>
                    Sin stock · quitado del pedido
                  </p>
                ) : (
                  <p
                    style={{
                      margin: '8px 0 0',
                      fontSize: '14px',
                      fontWeight: 640,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {precioTexto(l.precio)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ borderTop: '1px solid var(--borde)', padding: '12px 14px 16px' }}>
        <div className="t-ancho">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', color: 'var(--tinta-media)' }}>Nuevo total</span>
            <span data-total style={{ fontSize: '18px', fontWeight: 660, fontVariantNumeric: 'tabular-nums' }}>
              {precioTexto(total)}
            </span>
          </div>
          <BotonDeMarca onClick={alSeguir} style={{ width: '100%', height: '48px', fontSize: '15px' }}>
            Seguir con el resto
          </BotonDeMarca>
        </div>
      </div>

      <Pie catalogo={catalogo} />
    </main>
  )
}
