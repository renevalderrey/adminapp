import { useMemo, useState } from 'react'
import { entraEnElFiltro, normalizarTexto, precioTexto } from '../formato.js'
import { traerProductos } from '../api.js'
import SinResultados from '../estados/SinResultados.jsx'
import Pie from '../pie.jsx'

// ════════════════════════════════════════════
//  La pantalla del catálogo (maqueta, `esCatalogo`, `:89-158`)
//
//  ── La decisión que ordena este archivo: cero llamadas por tecla ──
//
//  ⚠ **El filtrado y el cambio de categoría se hacen acá, en el navegador**
//  (FR-114, US8 escenario 2). La primera página ya vino embebida en la respuesta
//  que abrió el catálogo, junto con la marca, las categorías y la entrega: una
//  visita normal son **dos** llamadas, no una por letra.
//
//  Lo cómodo es lo contrario —un `useEffect` que pide al servidor cuando cambia
//  la búsqueda—, y anda perfecto en la máquina de quien lo escribe. En el
//  teléfono del gimnasio, escribir «whey» son cuatro peticiones que llegan
//  desordenadas, y la lista parpadea mostrando los resultados de «whe» después de
//  los de «whey». Con un `debounce` sigue siendo una petición por pausa, y sigue
//  fallando cuando la señal se cae a mitad de la palabra: la grilla se vacía
//  aunque los productos estén acá, ya descargados.
//
//  La comparación usa `entraEnElFiltro`, que es la **misma normalización que el
//  servidor** (`utils/textoDeBusqueda.js`). No es un detalle: si difiere, la
//  píldora «Proteínas» muestra seis productos antes de «ver más» y ocho después,
//  y eso nadie lo lee como un error.
//
//  ── Y la que ordena la paginación ──
//
//  `traerProductos` se llama **solo** al apretar «ver más», y se pide la página
//  siguiente **sin filtro**. La lista acumulada queda siempre completa y el
//  filtro se aplica encima; así, borrar la búsqueda devuelve todo lo que ya se
//  había traído en vez de dejar la grilla con el resultado de la búsqueda
//  anterior. Una sola lista, una sola fuente de verdad.
//
//  ── Escritorio ──
//
//  No se abre a una grilla ancha: sube a tres columnas **dentro de los mismos
//  720px** (`.t-ancho` + `.t-grilla`, `src/tienda.css`, maqueta `:449-464`).
// ════════════════════════════════════════════

/** La píldora «Todos» no es una categoría del catálogo: es el filtro apagado. */
const TODOS = ''

function Pildora({ activa, children, ...resto }) {
  return (
    <button
      type="button"
      className="t-foco"
      aria-pressed={activa}
      style={{
        flex: 'none',
        height: '30px',
        padding: '0 13px',
        borderRadius: '999px',
        border: '1px solid transparent',
        background: activa ? 'var(--marca)' : 'var(--marcador)',
        color: activa ? 'var(--marca-texto)' : 'var(--tinta-media)',
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
      }}
      {...resto}
    >
      {children}
    </button>
  )
}

function Tarjeta({ producto, alAbrir, alAgregar }) {
  const p = producto

  return (
    <article
      data-producto={p.id}
      style={{
        border: '1px solid var(--borde)',
        borderRadius: '14px',
        overflow: 'hidden',
        background: 'var(--papel)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <button
        type="button"
        className="t-foco"
        onClick={() => alAbrir(p)}
        aria-label={`Ver ${p.nombre}`}
        style={{
          position: 'relative',
          height: '132px',
          border: 0,
          padding: 0,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          background: 'transparent',
        }}
      >
        {/* Sin foto va el marcador neutro **del mismo tamaño**: si la tarjeta se
            encogiera, la grilla se descuadraría fila por medio según qué producto
            tenga imagen propia (FR-030). */}
        {p.imagen ? (
          <img src={p.imagen} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span
            className="t-damero"
            style={{
              width: '100%',
              height: '100%',
              display: 'grid',
              placeItems: 'center',
              fontSize: '10.5px',
              color: 'var(--tinta-suave)',
            }}
          >
            Sin foto
          </span>
        )}

        {p.agotado ? (
          <span
            data-agotado
            style={{
              position: 'absolute',
              left: '8px',
              top: '8px',
              background: 'var(--tinta)',
              color: 'var(--papel)',
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              padding: '3px 7px',
              borderRadius: '6px',
            }}
          >
            Agotado
          </span>
        ) : null}
      </button>

      <div style={{ padding: '10px 10px 11px', display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
        {/* ⚠ El renglón de la marca **no se dibuja** cuando no hay marca, y no se
            dibuja vacío: la clave viene **ausente** de la API —no en `null`— para
            el 96 % de los productos migrables, y `{p.marca}` con la clave ausente
            deja un renglón de 10 px que descuadra la tarjeta contra las de al
            lado. `'marca' in p` sería equivalente acá; `p.marca === null` no,
            porque ese caso no existe. */}
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

        <button
          type="button"
          onClick={() => alAbrir(p)}
          className="t-foco"
          style={{
            border: 0,
            background: 'transparent',
            padding: 0,
            textAlign: 'left',
            font: 'inherit',
            fontSize: '13px',
            fontWeight: 600,
            lineHeight: 1.3,
            color: 'var(--tinta)',
            cursor: 'pointer',
          }}
        >
          {p.nombre}
        </button>

        <div style={{ marginTop: '6px', display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '15px', fontWeight: 660, fontVariantNumeric: 'tabular-nums' }}>
            {precioTexto(p.precio)}
          </span>
          {/* El tachado sale **solo si el servidor lo mandó**, y el servidor lo
              manda solo si hay algo tachado de verdad (interruptor encendido Y
              precio menor que el de lista). Acá no se decide nada. */}
          {p.precio_lista ? (
            <span
              data-precio-lista
              style={{
                fontSize: '11.5px',
                color: 'var(--tinta-suave)',
                textDecoration: 'line-through',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {precioTexto(p.precio_lista)}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className="t-foco"
          disabled={p.agotado === true}
          onClick={() => alAgregar(p)}
          style={{
            marginTop: 'auto',
            height: '36px',
            borderRadius: '9px',
            border: '1px solid transparent',
            background: p.agotado ? 'var(--marcador)' : 'var(--marca)',
            color: p.agotado ? 'var(--tinta-suave)' : 'var(--marca-texto)',
            font: 'inherit',
            fontSize: '13px',
            fontWeight: 600,
            cursor: p.agotado ? 'default' : 'pointer',
          }}
        >
          {p.agotado ? 'Sin stock' : 'Agregar'}
        </button>
      </div>
    </article>
  )
}

/**
 * @param {object} props
 * @param {string} props.slug
 * @param {object} props.datos La respuesta de `GET /c/:slug` completa: `catalogo`,
 *   `categorias`, `productos`, `pagina`, `hay_mas`, `total`.
 * @param {Function} props.alAbrirProducto
 * @param {Function} props.alAgregar
 * @param {Function} props.alIrAlCarrito
 * @param {number} props.unidades Cuántas hay en el carrito, para la barra de abajo.
 */
export default function Catalogo({ slug, datos, alAbrirProducto, alAgregar, alIrAlCarrito, unidades = 0 }) {
  const catalogo = datos.catalogo || {}
  const categorias = datos.categorias || []

  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState(TODOS)

  // La lista acumulada y su paginación. Arranca con la página que vino embebida.
  const [pagina, setPagina] = useState({
    productos: datos.productos || [],
    numero: datos.pagina || 1,
    hayMas: datos.hay_mas === true,
    trayendo: false,
    fallo: false,
  })

  const visibles = useMemo(
    () => pagina.productos.filter((p) => entraEnElFiltro(p, { q: busqueda, categoria })),
    [pagina.productos, busqueda, categoria]
  )

  // La única llamada que dispara esta pantalla, y la dispara un botón.
  async function verMas() {
    if (pagina.trayendo || !pagina.hayMas) return
    setPagina((p) => ({ ...p, trayendo: true, fallo: false }))

    try {
      const { data } = await traerProductos(slug, { pagina: pagina.numero + 1 })
      setPagina((p) => ({
        // `concat` y no un `Set` por id: el servidor devuelve páginas de una lista
        // ordenada y estable, así que no hay repetidos que deduplicar. Si algún
        // día los hubiera, el defecto sería del paginado y esconderlo acá lo
        // volvería invisible.
        productos: p.productos.concat(data.productos || []),
        numero: data.pagina || p.numero + 1,
        hayMas: data.hay_mas === true,
        trayendo: false,
        fallo: false,
      }))
    } catch {
      // Se pierde la señal a mitad del «ver más»: lo que ya está descargado se
      // queda en pantalla y el botón vuelve a estar. Vaciar la grilla por un
      // error de la página 2 sería castigar a alguien por pedir más.
      setPagina((p) => ({ ...p, trayendo: false, fallo: true }))
    }
  }

  const elegirCategoria = (clave) => {
    setCategoria(clave)
    setBusqueda('')
  }

  return (
    <main data-pantalla="catalogo" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Portada y logo ── */}
      <div
        style={{
          height: '132px',
          position: 'relative',
          backgroundImage: catalogo.portada
            ? `url(${JSON.stringify(catalogo.portada)})`
            : 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--tinta) 4.5%, transparent) 0 5px, transparent 5px 11px), ' +
              'linear-gradient(160deg, color-mix(in srgb, var(--marca) 30%, var(--papel)), color-mix(in srgb, var(--marca) 12%, var(--papel)))',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {catalogo.logo ? (
          <img
            src={catalogo.logo}
            alt={catalogo.nombre || ''}
            style={{
              position: 'absolute',
              left: '16px',
              bottom: '-30px',
              width: '76px',
              height: '76px',
              borderRadius: '18px',
              background: 'var(--papel)',
              border: '1px solid var(--borde)',
              objectFit: 'contain',
              padding: '9px',
            }}
          />
        ) : null}
      </div>

      <div className="t-ancho" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: catalogo.logo ? '40px 16px 0' : '16px 16px 0' }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 660, letterSpacing: '-0.02em' }}>
            {catalogo.nombre}
          </h1>
          {catalogo.descripcion ? (
            <p style={{ margin: '5px 0 0', fontSize: '13px', lineHeight: 1.45, color: 'var(--tinta-media)' }}>
              {catalogo.descripcion}
            </p>
          ) : null}
        </div>

        {/* ── Buscador y píldoras ── */}
        <div style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--papel)', padding: '14px 16px 10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              height: '40px',
              border: '1px solid var(--borde)',
              borderRadius: '10px',
              padding: '0 11px',
              background: 'var(--superficie)',
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
              style={{ width: '16px', height: '16px', flex: 'none', display: 'block', color: 'var(--tinta-suave)' }}
            >
              <path d="m21 21-4.34-4.34" />
              <circle cx="11" cy="11" r="8" />
            </svg>
            <input
              className="t-buscador"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              aria-label="Buscar producto o marca"
              placeholder="Buscar producto o marca"
              style={{
                border: 0,
                outline: 'none',
                background: 'transparent',
                font: 'inherit',
                fontSize: '14px',
                width: '100%',
                minWidth: 0,
                color: 'var(--tinta)',
              }}
            />
          </div>

          {categorias.length ? (
            <div
              role="group"
              aria-label="Categorías"
              style={{ display: 'flex', gap: '7px', overflowX: 'auto', padding: '10px 0 2px' }}
            >
              <Pildora activa={categoria === TODOS} onClick={() => elegirCategoria(TODOS)}>
                Todos
              </Pildora>
              {categorias.map((c) => (
                <Pildora
                  key={c.categoria}
                  data-categoria={c.categoria}
                  activa={normalizarTexto(categoria) === c.categoria}
                  onClick={() => elegirCategoria(c.categoria)}
                >
                  {c.etiqueta}
                </Pildora>
              ))}
            </div>
          ) : null}
        </div>

        {/* ── La grilla, o el estado vacío ── */}
        {visibles.length === 0 ? (
          <SinResultados
            consulta={busqueda || (categorias.find((c) => c.categoria === categoria) || {}).etiqueta || ''}
            categorias={categorias}
            alLimpiar={() => elegirCategoria(TODOS)}
            alElegirCategoria={elegirCategoria}
          />
        ) : (
          <div className="t-grilla" style={{ padding: '14px 16px 0' }}>
            {visibles.map((p) => (
              <Tarjeta key={p.id} producto={p} alAbrir={alAbrirProducto} alAgregar={alAgregar} />
            ))}
          </div>
        )}

        {/* ── «Ver más» ──
            Se dibuja si el servidor dijo que hay más, tenga o no filtro puesto:
            traer la página siguiente puede hacer aparecer resultados de la
            búsqueda que todavía no se descargaron. */}
        {pagina.hayMas ? (
          <div style={{ padding: '18px 16px 0', textAlign: 'center' }}>
            <button
              type="button"
              className="t-foco"
              data-ver-mas
              onClick={verMas}
              disabled={pagina.trayendo}
              style={{
                height: '44px',
                padding: '0 20px',
                borderRadius: '11px',
                border: '1px solid var(--borde)',
                background: 'var(--papel)',
                color: 'var(--tinta)',
                font: 'inherit',
                fontSize: '14px',
                fontWeight: 600,
                cursor: pagina.trayendo ? 'default' : 'pointer',
              }}
            >
              {pagina.trayendo ? 'Trayendo…' : 'Ver más productos'}
            </button>
            {pagina.fallo ? (
              <p role="status" style={{ margin: '8px 0 0', fontSize: '12.5px', color: 'var(--tinta-media)' }}>
                No pudimos traer más productos. Probá de nuevo.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* El aire de abajo es el alto de la barra fija: sin esto, la última fila
            de la grilla queda tapada por el carrito y no hay forma de tocarla. */}
        <div style={{ height: '96px', flex: 'none' }} />
      </div>

      <Pie catalogo={catalogo} />

      {/* ── La barra del carrito ──
          Solo cuando hay algo adentro. Una barra fija con «$0» ocupa el 12 % de
          una pantalla de 390px para no decir nada.

          ⚠ **Divergencia con la maqueta, y es a propósito.** Allá la barra dice
          «3 productos» a la izquierda y **el total** a la derecha (`:143-152`).
          Acá el total no está: para escribirlo habría que sumar precio × cantidad
          sobre las líneas del carrito, y **la tienda no calcula precios** (H2).
          Un total sumado en el navegador es un número que puede no coincidir con
          el que devuelve el servidor al crear el pedido —una regla de precio que
          cambió, una línea recortada por stock—, y el lugar donde se ve la
          diferencia es la pantalla de pago, que es el peor lugar posible. El
          total aparece cuando el servidor lo manda: en el carrito y en el
          checkout (corte F2). */}
      {unidades > 0 ? (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            background: 'var(--papel)',
            borderTop: '1px solid var(--borde)',
            padding: '10px 16px 18px',
            zIndex: 4,
          }}
        >
          <div className="t-ancho">
            <button
              type="button"
              className="t-foco"
              data-barra-carrito
              onClick={alIrAlCarrito}
              style={{
                width: '100%',
                height: '50px',
                borderRadius: '12px',
                border: '1px solid transparent',
                background: 'var(--marca)',
                color: 'var(--marca-texto)',
                font: 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 16px',
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ width: '17px', height: '17px', flex: 'none', display: 'block' }}
                >
                  <circle cx="8" cy="21" r="1" />
                  <circle cx="19" cy="21" r="1" />
                  <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                </svg>
                <span style={{ fontSize: '14px', fontWeight: 600 }}>
                  {unidades === 1 ? 'Ver mi pedido · 1 producto' : `Ver mi pedido · ${unidades} productos`}
                </span>
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </main>
  )
}
