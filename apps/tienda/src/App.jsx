import { useCallback, useEffect, useState } from 'react'

// ════════════════════════════════════════════
//  Las cinco pantallas, y por qué no hay librería de ruteo
//
//      /c/:slug              el catálogo
//      /p/:id                la ficha de un producto
//      /carrito              el carrito
//      /checkout             los datos del comprador
//      /confirmado/:numero   el pedido hecho
//
//  Cinco rutas, dos niveles, tres parámetros. El emparejador de abajo son unas
//  quince líneas. `react-router-dom` —el que usa `apps/web`— serían unos 20 kB
//  comprimidos **antes** de que se dibuje nada, en una página que se abre
//  escaneando un QR pegado en un mostrador: con datos móviles, en el peor
//  teléfono del gimnasio, y con el comprador parado esperando. La regla del
//  `package.json` de esta app —`dependencies` solo `react` y `react-dom`— no es
//  minimalismo por gusto: es lo que hace que la respuesta a «¿le agregamos
//  X?» tenga que justificarse contra ese teléfono.
//
//  Si algún día hacen falta rutas anidadas, cargas por ruta o transiciones, la
//  librería entra —como una dependencia más, escrita en el `package.json`—. No
//  hoy.
//
//  ⚠ Ninguna de estas rutas es privada y **ninguna guarda una sesión**: no hay
//  redirección al login, no hay `<RutaProtegida>`, no hay estado de
//  autenticación que consultar. Es la diferencia estructural con `App.jsx` de
//  `apps/web`, que corta en `!isAuthenticated` antes de dibujar nada.
// ════════════════════════════════════════════

export const RUTAS = [
  { nombre: 'catalogo', patron: '/c/:slug' },
  { nombre: 'producto', patron: '/p/:id' },
  { nombre: 'carrito', patron: '/carrito' },
  { nombre: 'checkout', patron: '/checkout' },
  { nombre: 'confirmado', patron: '/confirmado/:numero' },
]

const trozos = (ruta) => ruta.split('/').filter(Boolean)

/** `%` suelto en la URL hace estallar `decodeURIComponent`; una URL rota no puede tumbar la tienda. */
const descifrar = (t) => {
  try {
    return decodeURIComponent(t)
  } catch {
    return t
  }
}

/**
 * Devuelve `{ nombre, parametros }` o `null` si la ruta no es ninguna de las
 * cinco. `null` es una respuesta legítima —la pantalla «no encontrado»— y no un
 * error: alguien pega una URL a mano y llega a `/carrito/algo`.
 */
export function resolverRuta(camino) {
  const partes = trozos(camino || '/').map(descifrar)

  for (const { nombre, patron } of RUTAS) {
    const molde = trozos(patron)
    if (molde.length !== partes.length) continue

    const parametros = {}
    const coincide = molde.every((pieza, i) => {
      if (!pieza.startsWith(':')) return pieza === partes[i]
      parametros[pieza.slice(1)] = partes[i]
      return partes[i] !== ''
    })

    if (coincide) return { nombre, parametros }
  }
  return null
}

/** Cambiar de pantalla sin recargar. El `popstate` propio es lo que despierta a `useRuta`. */
export function navegar(camino) {
  window.history.pushState({}, '', camino)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRuta() {
  const [camino, setCamino] = useState(() => window.location.pathname)

  useEffect(() => {
    const alCambiar = () => setCamino(window.location.pathname)
    window.addEventListener('popstate', alCambiar)
    return () => window.removeEventListener('popstate', alCambiar)
  }, [])

  return { camino, ruta: resolverRuta(camino), ir: useCallback(navegar, []) }
}

// Las pantallas llegan en T1444 (catálogo), T1445 (ficha) y T1446 (los estados);
// el carrito, el checkout y la confirmación en el corte F2. Hasta entonces cada
// ruta dibuja su nombre, que es lo que le permite a la prueba de navegador de
// T1447 verificar que el ruteo resuelve antes de que exista una sola pantalla.
function Pendiente({ nombre, parametros }) {
  return (
    <main data-pantalla={nombre} style={{ padding: '24px', color: 'var(--marca)' }}>
      <h1>{nombre}</h1>
      {Object.entries(parametros).map(([clave, valor]) => (
        <p key={clave} data-parametro={clave}>
          {clave}: {valor}
        </p>
      ))}
    </main>
  )
}

export default function App() {
  const { ruta } = useRuta()

  if (!ruta) return <Pendiente nombre="no-encontrado" parametros={{}} />
  return <Pendiente nombre={ruta.nombre} parametros={ruta.parametros} />
}
