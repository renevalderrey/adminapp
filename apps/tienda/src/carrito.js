import { useCallback, useEffect, useState } from 'react'

// ════════════════════════════════════════════
//  El carrito · funciones puras + un hook que las guarda
//
//  El corte está puesto a propósito: **las reglas son funciones puras** y el
//  hook no hace más que leer, escribir y llamarlas. Sumar el mismo producto dos
//  veces, acotar la cantidad a lo que hay, quedarse solo con `product_id` y
//  `cantidad` para el pedido — todo eso se prueba sin montar un componente, sin
//  jsdom y sin esperar un render. Un test que necesita dibujar la pantalla para
//  verificar que dos «agregar» suman en vez de duplicar es un test que se escribe
//  la mitad de las veces.
//
//  ── El carrito NO calcula precios (H2) ──
//
//  Guarda una instantánea de lo que el servidor mandó —nombre, marca, precio,
//  imagen— para poder dibujar el carrito sin volver a pedir, pero no suma
//  totales, no aplica descuentos y no recalcula nada. El total lo devuelve el
//  servidor al crear el pedido, y el 409 de stock trae hasta el `reintentar_con`
//  ya armado para no obligar al navegador a restar por su cuenta.
//
//  Y lo que sale hacia la API es **solo `product_id` y `cantidad`**
//  (`lineasParaElPedido`, FR-130): ningún precio viaja de vuelta, ni siquiera
//  para que el servidor lo ignore. No es una validación que se pueda olvidar; no
//  hay dato que olvidar.
// ════════════════════════════════════════════

/**
 * El techo duro. Es el mismo que rechaza el servidor con `ITEMS_INVALIDOS`, y
 * está acá para que el control de cantidad no deje llegar a ese error: una
 * cantidad imposible se frena donde se escribe, no después de completar el
 * checkout.
 */
export const CANTIDAD_MAXIMA = 999

/**
 * Una clave por catálogo, no una sola.
 *
 * El mismo teléfono escanea el QR del gimnasio y después el de la dietética de
 * al lado. Con una clave única, el segundo catálogo abre con los productos del
 * primero adentro — y sus `product_id` son de otra empresa, así que el pedido
 * moriría con un 404 genérico y sin nada que explicarle al comprador.
 */
export const claveDe = (slug) => `favalio.carrito.${slug}`

/**
 * Entero, nunca negativo, nunca más que `CANTIDAD_MAXIMA` y nunca más que el
 * stock cuando el servidor lo dijo.
 *
 * `maximo` ausente **no** significa cero: la grilla no manda `stock_disponible`
 * (solo la ficha lo hace), así que agregar desde el catálogo tiene que poder.
 * Lo que hay siempre es el techo duro.
 */
export function acotarCantidad(cantidad, maximo) {
  const pedida = Math.floor(Number(cantidad))
  if (!Number.isFinite(pedida) || pedida <= 0) return 0
  const declarado = Math.floor(Number(maximo))
  const techo = Number.isFinite(declarado) ? Math.max(0, Math.min(CANTIDAD_MAXIMA, declarado)) : CANTIDAD_MAXIMA
  return Math.min(pedida, techo)
}

/**
 * Lo único que se guarda de un producto, con lista blanca explícita.
 *
 * No es paranoia: lo que entra acá va a `localStorage` y sale de ahí semanas
 * después, cuando el precio ya cambió. Guardar el objeto entero del servidor
 * significa arrastrar campos que nadie mira y que después alguien lee creyendo
 * que están al día. Los campos ausentes siguen ausentes —`marca` e `imagen` no
 * vienen cuando no hay, y una clave con `undefined` es como se dibuja
 * «undefined» en una tarjeta—.
 */
function instantanea(producto) {
  const linea = {}
  for (const campo of ['nombre', 'marca', 'imagen', 'precio', 'precio_lista', 'stock_disponible']) {
    if (producto[campo] !== undefined && producto[campo] !== null) linea[campo] = producto[campo]
  }
  return linea
}

/**
 * ⚠ La regla que evita el defecto: **el mismo producto dos veces suma cantidad,
 * no agrega una línea**.
 *
 * Es el error natural de un `[...lineas, nueva]`, y en pantalla no se ve mal:
 * se ven dos renglones del mismo producto, que un comprador apurado lee como
 * «me lo agregó dos veces» y un comercio lee como dos ítems para preparar.
 */
export function agregarAlCarrito(lineas, producto, cantidad = 1) {
  const product_id = producto?.product_id ?? producto?.id
  const suma = acotarCantidad(cantidad, producto?.stock_disponible)
  if (product_id == null || suma <= 0) return lineas

  const previa = lineas.find((l) => l.product_id === product_id)
  const total = acotarCantidad((previa?.cantidad ?? 0) + suma, producto?.stock_disponible)
  const linea = { ...instantanea(producto), product_id, cantidad: total }

  return previa
    ? lineas.map((l) => (l.product_id === product_id ? linea : l))
    : [...lineas, linea]
}

/** Poner una cantidad exacta. Cero —o menos— saca la línea: es el «quitar» del control. */
export function cambiarCantidad(lineas, product_id, cantidad) {
  const linea = lineas.find((l) => l.product_id === product_id)
  if (!linea) return lineas
  const nueva = acotarCantidad(cantidad, linea.stock_disponible)
  return nueva <= 0
    ? lineas.filter((l) => l.product_id !== product_id)
    : lineas.map((l) => (l.product_id === product_id ? { ...l, cantidad: nueva } : l))
}

export const quitarDelCarrito = (lineas, product_id) => lineas.filter((l) => l.product_id !== product_id)

export const contarUnidades = (lineas) => lineas.reduce((suma, l) => suma + l.cantidad, 0)

/** El cuerpo del pedido: `product_id` y `cantidad`, y nada más (FR-130). */
export const lineasParaElPedido = (lineas) =>
  lineas.map(({ product_id, cantidad }) => ({ product_id, cantidad }))

/**
 * ⚠ Todo acceso a `localStorage` va envuelto.
 *
 * No es defensivo de más: en Safari con navegación privada `setItem` **lanza**
 * al pasarse de cuota, y hay navegadores que lo bloquean entero. Sin esto, un
 * comprador con la configuración equivocada no ve un carrito que no se guarda:
 * ve la tienda en blanco. Un carrito que se olvida es molesto; una tienda que no
 * abre es una venta perdida.
 *
 * Y lo que se lee se valida: un JSON de otra versión, o editado a mano, tiene
 * que caer en «carrito vacío» y no en una pantalla rota.
 */
export function leerCarrito(slug) {
  try {
    const crudo = localStorage.getItem(claveDe(slug))
    const datos = crudo ? JSON.parse(crudo) : null
    if (!Array.isArray(datos)) return []
    return datos.filter((l) => l && l.product_id != null && acotarCantidad(l.cantidad, l.stock_disponible) > 0)
  } catch {
    return []
  }
}

export function guardarCarrito(slug, lineas) {
  try {
    localStorage.setItem(claveDe(slug), JSON.stringify(lineas))
  } catch {
    /* El carrito vive en memoria hasta que se recargue. La tienda sigue abierta. */
  }
}

/**
 * El hook: estado + persistencia, y ni una regla propia.
 *
 * ⚠ El slug viaja **dentro** del estado y no en un `useEffect` aparte. Con dos
 * efectos —uno que relee al cambiar el slug y otro que guarda al cambiar las
 * líneas— los dos corren en la misma pasada cuando el slug cambia, y el que
 * guarda todavía ve las líneas viejas: escribe el carrito del catálogo anterior
 * **dentro de la clave del nuevo**. Es justo el caso que la clave por catálogo
 * existe para evitar.
 */
export function useCarrito(slug) {
  const [estado, setEstado] = useState(() => ({ slug, lineas: leerCarrito(slug) }))

  // Ajuste durante el render, el patrón que React documenta para «el estado
  // depende de una prop»: en el mismo commit el estado ya corresponde al slug
  // nuevo, así que el efecto de abajo nunca puede guardar cruzado.
  if (estado.slug !== slug) setEstado({ slug, lineas: leerCarrito(slug) })

  useEffect(() => {
    guardarCarrito(estado.slug, estado.lineas)
  }, [estado])

  const cambiar = useCallback((fn) => setEstado((e) => ({ ...e, lineas: fn(e.lineas) })), [])

  return {
    lineas: estado.lineas,
    unidades: contarUnidades(estado.lineas),
    agregar: useCallback((producto, cantidad) => cambiar((l) => agregarAlCarrito(l, producto, cantidad)), [cambiar]),
    poner: useCallback((id, cantidad) => cambiar((l) => cambiarCantidad(l, id, cantidad)), [cambiar]),
    quitar: useCallback((id) => cambiar((l) => quitarDelCarrito(l, id)), [cambiar]),
    vaciar: useCallback(() => cambiar(() => []), [cambiar]),
  }
}
