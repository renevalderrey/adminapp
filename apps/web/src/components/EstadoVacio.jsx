import { Inbox } from 'lucide-react'

// ════════════════════════════════════════════
//  ADMINAPP · «Acá todavía no hay nada»
//
//  ── Por qué existe ──
//
//  Había TRES funciones llamadas `EstadoVacio`, escritas por separado en
//  `Team.jsx`, `Tiendanube.jsx` y `PurchaseOrders.jsx` —las dos primeras
//  idénticas salvo el ícono— y además tres pantallas que dibujaban el suyo a
//  mano, sin ícono: `Comparador`, `Dashboard` y `Faltantes`.
//
//  Seis formas de decir lo mismo, y tres de ellas sin el ícono que las otras
//  tres sí tenían.
//
//  ⚠ **El día 1 las doce pantallas están vacías.** Los estados vacíos no son un
//  caso de borde: son la primera pasada completa que ve el dueño del comercio
//  cuando abre el sistema por primera vez. Que la mitad tenga ícono y la otra
//  mitad no es lo primero que se ve, y es exactamente lo que hace que un sistema
//  nuevo parezca a medio terminar.
//
//  ── Las tres partes, y por qué son tres ──
//
//   · El **ícono** dice de un vistazo «esto está vacío» y no «esto falló». Sin
//     él, un bloque con dos renglones de texto gris se lee como un error.
//   · El **título** dice qué no hay.
//   · El **detalle** dice qué va a aparecer ahí, o qué hacer para que aparezca.
//     Es la parte que se saltea, y es la que convierte una pantalla vacía en una
//     instrucción.
//
//  `children` es para la acción: el botón que carga lo primero, o el que limpia
//  el filtro. Va abajo del detalle y no reemplaza a ninguno de los tres.
//
//  ⚠ `codigo` sale como `data-estado-vacio` para que los tests puedan
//  distinguir DOS vacíos de la misma pantalla —«no hay nada» y «el filtro no
//  devolvió nada» son cosas distintas y decir la primera sobre la segunda hace
//  concluir que se perdieron los datos—.
// ════════════════════════════════════════════

/**
 * @param {object} props
 * @param {React.ComponentType} [props.icono] Ícono de lucide. Por omisión, una bandeja.
 * @param {string} props.titulo Qué no hay.
 * @param {string} [props.detalle] Qué va a aparecer acá, o qué hacer.
 * @param {string} [props.codigo] Identificador para los tests.
 * @param {React.ReactNode} [props.children] La acción, si hay una.
 */
export default function EstadoVacio({ icono, titulo, detalle, codigo, children }) {
  // El componente pasa a una variable con mayúscula en vez de renombrarse en la
  // desestructuración: con `icono: Icono`, la única referencia queda adentro del
  // JSX y esta configuración de eslint —sin `eslint-plugin-react`— lo marca como
  // parámetro sin usar. Acá `icono` se usa de verdad y `Icono` cae bajo el
  // `varsIgnorePattern: '^[A-Z_]'` que ya existe.
  const Icono = icono || Inbox

  return (
    <div data-estado-vacio={codigo} className="px-5 py-12 text-center">
      <Icono className="mx-auto mb-2.5 h-7 w-7 text-fg-3" strokeWidth={1.6} />
      <p className="font-semibold">{titulo}</p>
      {detalle && <p className="mx-auto mt-1 max-w-[52ch] text-sm text-fg-2">{detalle}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
