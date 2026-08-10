import { useCallback, useEffect, useState } from 'react'
import { crearPedido, traerCatalogo } from './api.js'
import { useCarrito } from './carrito.js'
import { PASOS, claveDeIntento, cuerpoDelPedido } from './checkout.js'
import { subtotalDelCarrito } from './totales.js'
import { MARCA_POR_DEFECTO, useTema } from './tema.js'
import Catalogo from './pantallas/Catalogo.jsx'
import Ficha from './pantallas/Ficha.jsx'
import CarritoPantalla from './pantallas/Carrito.jsx'
import Checkout from './pantallas/Checkout.jsx'
import Confirmacion from './pantallas/Confirmacion.jsx'
import Cargando from './estados/Cargando.jsx'
import CarritoVacio from './estados/CarritoVacio.jsx'
import SeAgoto from './estados/SeAgoto.jsx'
import DemasiadasPeticiones from './estados/DemasiadasPeticiones.jsx'
import { NoDisponible, NoEncontrada, Pausada } from './estados/CatalogoDetenido.jsx'

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

// ════════════════════════════════════════════
//  El envío del pedido
//
//  ── La clave de idempotencia se genera UNA VEZ por intento ──
//
//  Si se generara en cada envío, el segundo toque de «Confirmar» —el del
//  comprador impaciente, o el del teléfono que reintenta al recuperar señal—
//  llegaría con una clave nueva y el servidor lo tomaría como un pedido
//  distinto. Que es exactamente el defecto que la clave existe para evitar.
//
//  Vive en el estado y sólo cambia cuando **empieza otro pedido**: al volver al
//  catálogo después de confirmar, o al reintentar con el cuerpo que devolvió el
//  409 de stock —que trae su propia clave, porque es otro pedido—.
// ════════════════════════════════════════════

/**
 * Las líneas para la pantalla «se agotó», con las quitadas **en su lugar**.
 *
 * ⚠ El total sale de multiplicar el precio que ya resolvió el servidor por la
 * cantidad nueva, igual que el carrito. No hay otro número disponible: el 409 no
 * trae un total —no llegó a crearse ningún pedido— y lo que el comprador tiene
 * que ver antes de decidir es cuánto va a salir si sigue.
 */
function lineasDespuesDelRecorte(lineas, ajustes = []) {
  const porProducto = new Map(ajustes.map((a) => [a.product_id, a]))

  return lineas.map((l) => {
    const ajuste = porProducto.get(l.product_id)
    if (!ajuste) return l
    if (ajuste.accion === 'quitada') return { ...l, quitada: true }
    return { ...l, cantidad: ajuste.disponible, pedida: ajuste.pedida }
  })
}

// ════════════════════════════════════════════
//  El slug, y por qué hay que recordarlo
//
//  Cuatro de las cinco rutas **no lo llevan**: `/p/:id`, `/carrito`, `/checkout`
//  y `/confirmado/:numero`. La empresa sale del slug y de ningún otro lado, así
//  que sin él la ficha de un producto no se puede ni pedir.
//
//  Se guarda en `sessionStorage` y no en `localStorage` a propósito: el slug es
//  «en qué tienda estoy ahora», no «qué tienda visité alguna vez». Con
//  `localStorage`, abrir `/carrito` seis semanas después reviviría el catálogo del
//  gimnasio en la pestaña de la dietética. Con `sessionStorage` muere con la
//  pestaña, que es exactamente lo que dura una visita.
//
//  ⚠ Envuelto, como todo acceso al almacenamiento del navegador: en Safari con
//  navegación privada esto **lanza**, y una tienda que no abre es una venta
//  perdida (`src/carrito.js:120-130`).
// ════════════════════════════════════════════
const CLAVE_SLUG = 'favalio.slug'

export function recordarSlug(slug) {
  try {
    sessionStorage.setItem(CLAVE_SLUG, slug)
  } catch {
    /* La visita sigue: el slug ya está en la ruta que se está dibujando. */
  }
}

export function slugRecordado() {
  try {
    return sessionStorage.getItem(CLAVE_SLUG) || null
  } catch {
    return null
  }
}

/**
 * El origen de la visita (`?f=qr`), que se manda **una sola vez**, en la llamada
 * que abre el catálogo. Cualquier valor desconocido lo colapsa el servidor a
 * `otro`: acá no se valida nada que allá se vuelva a validar.
 */
const origenDeLaVisita = () => new URLSearchParams(window.location.search).get('f') || undefined

/**
 * La única carga de datos de la tienda.
 *
 * Una llamada por visita, no una por pantalla: la respuesta trae la marca, la
 * entrega, los pagos, las categorías **y la primera página de productos**, y de
 * ahí sale todo lo que se dibuja hasta que alguien aprieta «ver más».
 */
function useCatalogo(slug) {
  const [estado, setEstado] = useState({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!slug) return undefined

    let vivo = true
    setEstado({ fase: 'cargando' })

    traerCatalogo(slug, origenDeLaVisita())
      .then(({ data }) => {
        if (!vivo) return
        recordarSlug(slug)
        setEstado({ fase: 'listo', datos: data })
      })
      .catch((error) => {
        if (!vivo) return
        setEstado({ fase: 'error', codigo: error.codigo, http: error.http })
      })

    // El corte evita el defecto clásico de las respuestas cruzadas: alguien abre
    // un catálogo, vuelve atrás y abre otro, y la respuesta lenta del primero
    // llega después y pisa al segundo. La tienda mostraría los productos de una
    // empresa bajo el nombre de otra.
    return () => {
      vivo = false
    }
  }, [slug, intento])

  return { estado, reintentar: useCallback(() => setIntento((n) => n + 1), []) }
}

/** La pantalla que corresponde a un error del cliente HTTP. */
function PantallaDeError({ codigo, catalogo, reintentar }) {
  if (codigo === 'DEMASIADAS_PETICIONES') {
    return <DemasiadasPeticiones catalogo={catalogo} alReintentar={reintentar} />
  }
  if (codigo === 'NO_ENCONTRADO') return <NoEncontrada alReintentar={reintentar} />

  // `SIN_CONEXION`, `NO_DISPONIBLE_POR_UN_MOMENTO` y lo que venga: el estado
  // neutro. No dice de quién es la culpa porque no se sabe, y decirlo mal —«el
  // comercio no está disponible» cuando el que se quedó sin señal es el
  // teléfono— manda a alguien a llamar al gimnasio.
  return <NoDisponible catalogo={catalogo} />
}

export default function App() {
  const { ruta, ir } = useRuta()

  // El slug sale de la ruta cuando la ruta lo lleva, y de la sesión cuando no.
  const slugDeLaRuta = ruta && ruta.nombre === 'catalogo' ? ruta.parametros.slug : null
  const [slug] = useState(() => slugDeLaRuta || slugRecordado())
  const activo = slugDeLaRuta || slug

  const { estado, reintentar } = useCatalogo(activo)
  const carrito = useCarrito(activo || '')

  // El producto que se abrió desde la grilla viaja en memoria: abrir una ficha
  // desde el catálogo **no cuesta una llamada**, porque el objeto ya vino en la
  // primera página (FR-114).
  const [abierto, setAbierto] = useState(null)

  // ── El checkout ──
  const [paso, setPaso] = useState(0)
  const [formulario, setFormulario] = useState({})
  const [clave, setClave] = useState(claveDeIntento)
  const [enviando, setEnviando] = useState(false)
  const [pedido, setPedido] = useState(null)
  const [recorte, setRecorte] = useState(null)

  const [aviso, setAviso] = useState(null)

  const escribir = useCallback((campo, valor) => {
    setFormulario((f) => ({ ...f, [campo]: valor }))
  }, [])

  /**
   * Manda el pedido. Recibe el cuerpo **ya armado**, porque el reintento del 409
   * manda el que devolvió el servidor y no uno reconstruido acá.
   */
  const enviar = async (cuerpo) => {
    setAviso(null)
    setEnviando(true)

    try {
      const { data } = await crearPedido(activo, cuerpo)

      // El carrito se vacía **después** de que el pedido existe. Al revés, un
      // error de red deja al comprador sin carrito y sin pedido.
      carrito.vaciar()
      setPedido(data)
      ir(`/confirmado/${data.numero}`)
    } catch (error) {
      if (error.codigo === 'STOCK_INSUFICIENTE' && error.cuerpo) {
        setRecorte(error.cuerpo)
      } else if (error.codigo === 'SIN_LINEAS_DISPONIBLES') {
        setRecorte({ lineas: (error.cuerpo && error.cuerpo.lineas) || [], reintentar_con: null })
      } else if (error.codigo === 'DEMASIADAS_PETICIONES') {
        setAviso('Mandaste varios pedidos seguidos. Esperá unos minutos y probá de nuevo.')
      } else {
        // Sin culpar a nadie: no se sabe si fue el servidor o la señal del
        // teléfono, y decirlo mal manda a alguien a llamar al gimnasio.
        setAviso('No pudimos mandar el pedido. Probá de nuevo en un momento.')
      }
    } finally {
      setEnviando(false)
    }
  }

  const datos = estado.fase === 'listo' ? estado.datos : null
  const catalogo = datos ? datos.catalogo : undefined

  useTema(catalogo ? catalogo.color : MARCA_POR_DEFECTO)

  if (!ruta) return <NoEncontrada />
  if (!activo) return <NoEncontrada />

  if (estado.fase === 'cargando') return <Cargando />
  if (estado.fase === 'error') {
    return <PantallaDeError codigo={estado.codigo} catalogo={catalogo} reintentar={reintentar} />
  }

  // ⚠ `pausado` y `no_disponible` **no traen productos ni categorías**: las
  // claves no vienen vacías, no están. Por eso el corte va acá arriba, antes de
  // que ninguna pantalla lea `datos.productos`.
  if (datos.estado === 'pausado') return <Pausada catalogo={catalogo} />
  if (datos.estado !== 'publicado') return <NoDisponible catalogo={catalogo} />

  const abrir = (producto) => {
    setAbierto(producto)
    ir(`/p/${producto.id}`)
  }

  if (ruta.nombre === 'producto') {
    const producto =
      abierto && String(abierto.id) === String(ruta.parametros.id)
        ? abierto
        : (datos.productos || []).find((p) => String(p.id) === String(ruta.parametros.id))

    // El producto que no está en la primera página y se abrió por URL pegada
    // llega en el corte F2 con su propia llamada; hoy vuelve al catálogo, que es
    // una salida y no una pantalla rota.
    if (!producto) return <NoEncontrada alReintentar={() => ir(`/c/${activo}`)} />

    return (
      <Ficha
        producto={producto}
        catalogo={catalogo}
        alVolver={() => ir(`/c/${activo}`)}
        alAgregar={(p, cantidad) => {
          carrito.agregar(p, cantidad)
          ir(`/c/${activo}`)
        }}
      />
    )
  }

  const alCatalogo = () => ir(`/c/${activo}`)

  // ── Se agotó algo mientras compraba ──
  //
  // Va **antes** que las rutas: el 409 llega desde el checkout y lo que hay que
  // mostrar no es el paso en el que estaba, es qué se cayó.
  if (recorte) {
    return (
      <SeAgoto
        catalogo={catalogo}
        lineas={lineasDespuesDelRecorte(carrito.lineas, recorte.lineas)}
        total={subtotalDelCarrito(
          lineasDespuesDelRecorte(carrito.lineas, recorte.lineas).filter((l) => !l.quitada)
        )}
        alSeguir={() => {
          // ⚠ Se manda **`reintentar_con` tal cual vino**. Reconstruirlo acá
          // sería el cliente restando por su cuenta, y se equivocaría justo en
          // el caso que importa.
          setRecorte(null)
          enviar(recorte.reintentar_con)
        }}
      />
    )
  }

  if (ruta.nombre === 'confirmado' && pedido) {
    return (
      <Confirmacion
        pedido={pedido}
        catalogo={catalogo}
        alVolver={() => {
          // Otro pedido, otra clave.
          setPedido(null)
          setFormulario({})
          setPaso(0)
          setClave(claveDeIntento())
          alCatalogo()
        }}
      />
    )
  }

  // Un carrito vacío no tiene ni carrito ni checkout: los dos serían pantallas
  // sobre nada. La confirmación de arriba es la excepción, porque justamente
  // acaba de vaciarlo.
  if ((ruta.nombre === 'carrito' || ruta.nombre === 'checkout') && carrito.lineas.length === 0) {
    return <CarritoVacio catalogo={catalogo} alVolverAlCatalogo={alCatalogo} />
  }

  if (ruta.nombre === 'carrito') {
    return (
      <CarritoPantalla
        lineas={carrito.lineas}
        catalogo={catalogo}
        alPoner={carrito.poner}
        alQuitar={carrito.quitar}
        alVolver={alCatalogo}
        alContinuar={() => {
          setPaso(0)
          ir('/checkout')
        }}
      />
    )
  }

  if (ruta.nombre === 'checkout') {
    return (
      <Checkout
        paso={paso}
        catalogo={catalogo}
        lineas={carrito.lineas}
        formulario={formulario}
        enviando={enviando}
        aviso={aviso}
        alEscribir={escribir}
        alAtras={() => (paso === 0 ? ir('/carrito') : setPaso(paso - 1))}
        alAvanzar={() => {
          if (paso < PASOS.length - 1) return setPaso(paso + 1)
          return enviar(cuerpoDelPedido(formulario, carrito.lineas, clave))
        }}
      />
    )
  }

  if (ruta.nombre !== 'catalogo') return <NoEncontrada alReintentar={alCatalogo} />

  return (
    <Catalogo
      slug={activo}
      datos={datos}
      unidades={carrito.unidades}
      alAbrirProducto={abrir}
      alAgregar={(p) => carrito.agregar(p, 1)}
      alIrAlCarrito={() => ir('/carrito')}
    />
  )
}
