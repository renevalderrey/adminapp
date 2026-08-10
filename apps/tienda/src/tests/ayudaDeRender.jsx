import { act } from 'react'
import { createRoot } from 'react-dom/client'

// ════════════════════════════════════════════
//  Cómo se dibuja un componente en los tests de esta app
//
//  ── La alternativa que se descartó, y por qué ──
//
//  `@testing-library/react`. Está instalado en la raíz del monorepo porque
//  `apps/web` lo declara, así que un `import` desde acá **funcionaría hoy** — y
//  esa es exactamente la razón para no hacerlo: sería una dependencia fantasma,
//  usada por `apps/tienda` y declarada por otra app. El día que `apps/web` la
//  actualice o la cambie, la suite de la tienda se rompe por un cambio en un
//  `package.json` que no la nombra.
//
//  Declararla en `apps/tienda/package.json` tampoco es gratis: obliga a tocar el
//  `package-lock.json` de la raíz, que es de todo el monorepo. Y el motivo de
//  fondo es el mismo que dejó a esta app con `dependencies` de dos líneas: cada
//  dependencia se justifica contra el peor teléfono del gimnasio.
//
//  Lo que se necesita son treinta líneas: montar, actuar dentro de `act` y leer
//  el DOM. React 19 exporta `act` desde el propio paquete, así que no hace falta
//  nada más que lo que ya está declarado — `react` y `react-dom`.
//
//  ⚠ `IS_REACT_ACT_ENVIRONMENT` es obligatorio: sin la bandera, React avisa en
//  cada render que se está actualizando fuera de `act` y las actualizaciones de
//  estado no se aplican antes de la afirmación. El test falla contando un valor
//  viejo y manda a mirar el componente, que está bien.
// ════════════════════════════════════════════

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const montados = []

/** Monta un elemento y devuelve el contenedor más las herramientas para leerlo. */
export function dibujar(elemento) {
  const contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  const raiz = createRoot(contenedor)

  act(() => {
    raiz.render(elemento)
  })

  montados.push({ raiz, contenedor })

  return {
    contenedor,
    texto: () => contenedor.textContent || '',
    ver: (selector) => contenedor.querySelector(selector),
    todos: (selector) => Array.from(contenedor.querySelectorAll(selector)),
    /** Busca por el texto exacto que se lee, que es como lo busca una persona. */
    porTexto: (texto, selector = 'button, a') =>
      Array.from(contenedor.querySelectorAll(selector)).find(
        (n) => (n.textContent || '').replace(/\s+/g, ' ').trim() === texto
      ),
    volverADibujar: (otro) =>
      act(() => {
        raiz.render(otro)
      }),
  }
}

/** Un clic con el `act` puesto. */
export function tocar(nodo) {
  act(() => {
    nodo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/**
 * Un clic que además espera a que se asiente lo que el manejador dejó pendiente.
 *
 * ⚠ Hace falta cuando el manejador es `async` —«ver más» pide una página—. Con
 * `tocar` a secas, la promesa se resuelve **después** de que el caso terminó y
 * React avisa que hubo una actualización fuera de `act`: el aviso es correcto y
 * lo que está mal es el test, que afirma sobre un DOM anterior a la respuesta.
 */
export async function tocarYEsperar(nodo) {
  await act(async () => {
    nodo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/**
 * Escribir en un `<input>` controlado por React.
 *
 * ⚠ No alcanza con `nodo.value = 'x'` + disparar `input`: React guarda el valor
 * anterior en el nodo y descarta el evento porque «no cambió nada». El
 * `setter` nativo del prototipo es la forma de que el cambio se vea, y es lo que
 * hace `@testing-library` por dentro.
 */
export function escribir(nodo, valor) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(nodo, valor)
    nodo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Deja el DOM limpio entre casos. Se llama desde un `afterEach`. */
export function desmontarTodo() {
  while (montados.length) {
    const { raiz, contenedor } = montados.pop()
    act(() => {
      raiz.unmount()
    })
    contenedor.remove()
  }
}
