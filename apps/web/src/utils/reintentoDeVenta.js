// ════════════════════════════════════════════
//  ADMINAPP · El reintento que el servidor reconoce como ya registrada
//
//  `POST /api/sales` es idempotente por `id`: un reintento del mismo ticket
//  —la red se cortó DESPUÉS de que el servidor commiteó, que es la ventana que
//  la idempotencia existe para cubrir— devuelve `200 { yaRegistrada: true }` con
//  la venta que ya está, en vez de registrar una segunda.
//
//  ── Por qué hace falta comparar ──
//
//  El servidor está bien; el que no puede confiar a ciegas es el navegador. El
//  caso que rompe datos es este, y pasó tal cual:
//
//   1. Ticket con 1 unidad. Se cobra. La red se corta después del commit.
//   2. Sale el `catch`, `toast.error`, y el ticket queda entero, que es lo
//      correcto (FR-053). El operador lee «Error» y entiende que no se registró
//      nada.
//   3. El cliente dice «poneme dos». Sube la cantidad y vuelve a cobrar.
//   4. El id es el mismo —es uno por TICKET (FR-043)—, así que el servidor
//      responde la venta VIEJA: 1 unidad, $1.500.
//
//  Si la pantalla trata eso como éxito, vacía el ticket, ofrece imprimir y arma
//  el comprobante con las líneas de la pantalla (2 unidades) y el total del
//  servidor ($1.500). **Se entregan 2 unidades, se registró y se descontó 1**, y
//  el papel que se le da al cliente no cierra consigo mismo.
//
//  Nada falla, nada avisa, y se descubre en un recuento físico o en un reclamo.
//
//  ── Lo que esta función NO hace ──
//
//  No decide qué hacer. Devuelve **en qué difiere**, en castellano y con los
//  números concretos, para que el operador vea qué quedó registrado de verdad y
//  qué no. Un reintento que SÍ coincide es el caso para el que se construyó la
//  idempotencia y sigue siendo un éxito normal y silencioso.
// ════════════════════════════════════════════

/** Redondea a centavos, igual que `aCentavos` del servidor. */
const aCentavos = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Un importe argentino se escribe 1.234,50. Leerlo al revés es otro defecto. */
const pesos = (n) => aCentavos(n).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * La misma tolerancia que usa el servidor (`calculosVenta.js:60`).
 *
 * No es cero porque el navegador redondea para mostrar y puede arrastrar un
 * centavo por línea. Si el servidor aceptó el total declarado como coincidente,
 * la pantalla no puede después decir que no coincide por lo mismo. Una
 * diferencia real —una línea de más, otra cantidad, otro precio— es de otro
 * orden de magnitud.
 */
const tolerancia = (cantidadDeLineas) => 0.02 + 0.01 * cantidadDeLineas

/**
 * Con qué se identifica una línea al comparar.
 *
 * Por `product_id`, que es lo único estable: el nombre se guarda copiado en la
 * venta y puede haber cambiado en el catálogo entre una y otra. Un ítem sin
 * producto —el servidor los admite— cae al nombre, que es lo que queda.
 */
const claveDe = (linea) => {
  const id = linea.product_id ?? linea.id
  return id === null || id === undefined || id === '' ? `nombre:${nombreDe(linea)}` : `id:${id}`
}

const nombreDe = (linea) => linea.product_name || linea.name || 'Producto'

/** Las dos formas: `quantity`/`unit_price` del servidor, `qty`/`price` del ticket. */
const cantidadDe = (linea) => Number(linea.quantity ?? linea.qty ?? 0) || 0
const precioDe = (linea) => aCentavos(linea.unit_price ?? linea.price ?? 0)

/**
 * Compara la venta que el servidor dice que ya estaba registrada contra el
 * ticket que se acaba de mandar.
 *
 * @param {object} venta Lo que vino en `data`. `items` es lo que hace posible
 *   comparar: sin ese arreglo no se puede afirmar nada, y eso **no** se trata
 *   como coincidencia (ver el segundo motivo).
 * @param {{lineas: object[], total: number}} ticket Lo que había en pantalla.
 * @returns {{coincide: boolean, diferencias: string[]}} `diferencias` vacío
 *   cuando coincide. Cada texto es para el operador, con nombres e importes.
 */
export function comparacionDelReintento(venta = {}, ticket = {}) {
  const lineasDelTicket = Array.isArray(ticket.lineas) ? ticket.lineas : []
  const registradas = venta.items

  // Sin las líneas no se puede verificar, y **no verificable no es
  // coincidente**: dar por bueno lo que no se puede comparar es exactamente el
  // defecto que esta función existe para evitar. El servidor las manda en la
  // rama `yaRegistrada` de `POST /api/sales`; que falten significa que algo se
  // rompió, y ahí lo que corresponde es que el operador mire, no que la
  // pantalla adivine.
  if (!Array.isArray(registradas)) {
    return {
      coincide: false,
      diferencias: ['El servidor no devolvió las líneas de la venta ya registrada, '
        + 'así que no se puede confirmar que sea este mismo ticket.'],
    }
  }

  const diferencias = []

  const porClave = new Map()
  for (const item of registradas) porClave.set(claveDe(item), item)

  const vistas = new Set()

  for (const linea of lineasDelTicket) {
    const clave = claveDe(linea)
    vistas.add(clave)

    const registrada = porClave.get(clave)

    if (!registrada) {
      diferencias.push(`«${nombreDe(linea)}»: está en el ticket y NO quedó registrada.`)
      continue
    }

    const cantidadRegistrada = cantidadDe(registrada)
    const cantidadDelTicket = cantidadDe(linea)

    if (cantidadRegistrada !== cantidadDelTicket) {
      diferencias.push(
        `«${nombreDe(linea)}»: se registraron ${cantidadRegistrada} y el ticket lleva ${cantidadDelTicket}.`
      )
    }

    const precioRegistrado = precioDe(registrada)
    const precioDelTicket = precioDe(linea)

    if (precioRegistrado !== precioDelTicket) {
      diferencias.push(
        `«${nombreDe(linea)}»: se registró a $${pesos(precioRegistrado)} y el ticket dice $${pesos(precioDelTicket)}.`
      )
    }
  }

  // Y al revés: lo que quedó registrado y ya no está en el ticket. Es el caso
  // de la línea que el operador borró antes de reintentar, y es igual de grave:
  // el producto salió del inventario y no se va a entregar.
  for (const item of registradas) {
    if (vistas.has(claveDe(item))) continue
    diferencias.push(`«${nombreDe(item)}»: quedó registrada y ya no está en el ticket.`)
  }

  const totalRegistrado = aCentavos(venta.total)
  const totalDelTicket = aCentavos(ticket.total)

  if (Math.abs(totalRegistrado - totalDelTicket) > tolerancia(lineasDelTicket.length)) {
    diferencias.push(
      `El total registrado es $${pesos(totalRegistrado)} y el del ticket $${pesos(totalDelTicket)}.`
    )
  }

  return { coincide: diferencias.length === 0, diferencias }
}
