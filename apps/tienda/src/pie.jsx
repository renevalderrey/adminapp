// ════════════════════════════════════════════
//  El pie · «powered by favalio» en todas las pantallas (FR-122)
//
//  Un archivo propio y no tres líneas repetidas en cada pantalla, por una razón
//  que no es la de siempre: **el requisito dice «todas»**, y una pantalla que se
//  agregue el mes que viene y se olvide del pie no falla, no se ve mal y nadie la
//  audita. Con el componente acá, la pregunta «¿le pusiste el pie?» se contesta
//  buscando el import; con las tres líneas repetidas, se contesta leyendo las
//  once pantallas.
//
//  Lleva además los datos del comercio —razón social, CUIT y teléfono— cuando
//  vienen: es lo que convierte al pie en algo que alguien lee, y no solo en la
//  firma de la plataforma.
// ════════════════════════════════════════════

/**
 * @param {object} props
 * @param {object} [props.catalogo] El catálogo público. Puede no estar: los
 *   estados que se dibujan **antes** de saber a qué comercio se llegó
 *   —«cargando», la tienda que no existe— también llevan pie.
 */
export default function Pie({ catalogo }) {
  const c = catalogo || {}

  return (
    <footer
      data-pie="favalio"
      style={{
        borderTop: '1px solid var(--borde)',
        background: 'var(--superficie)',
        padding: '22px 16px 24px',
        textAlign: 'center',
      }}
    >
      {c.nombre ? (
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--tinta-media)' }}>{c.nombre}</p>
      ) : null}

      {/* El WhatsApp del comercio se dibuja **solo si el comercio lo cargó**. La
          clave viene ausente cuando no hay (`utils/vistaPublica.js`), así que un
          `c.whatsapp &&` alcanza; lo que no se puede es dibujar el renglón con el
          valor vacío adentro. */}
      {c.whatsapp ? (
        <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--tinta-media)' }}>
          Preguntas al {c.whatsapp}
        </p>
      ) : null}

      <p style={{ margin: '16px 0 0', fontSize: '11.5px', color: 'var(--tinta-suave)' }}>
        powered by <strong style={{ fontWeight: 640, color: 'var(--tinta-media)' }}>favalio</strong>
      </p>
    </footer>
  )
}
