// ════════════════════════════════════════════
//  El cliente HTTP de la tienda · `fetch` nativo, no axios (FR-120)
//
//  ── La alternativa que se descartó, y por qué ──
//
//  Copiar `apps/web/src/services/api.js` y sacarle lo que sobra. Se descartó
//  **porque lo que sobra es exactamente lo que no se puede tener**: la cabecera
//  del portador, la del identificador de sesión, y el manejo del 401 que dispara
//  el cierre de sesión de Auth0 (`apps/web/src/services/api.js:150-167`). Un
//  archivo que arranca teniendo las tres cosas y se las quita es un archivo al
//  que alguien se las devuelve la próxima vez que copie un método de la app
//  privada — y nadie lo va a ver, porque el pedido va a seguir funcionando.
//
//  Treinta líneas de `fetch` **no pueden heredar una cabecera de sesión por
//  accidente**. No hay interceptor donde meterla, no hay instancia con
//  `defaults` a la que se le peguen, no hay un `use()` que la agregue tres
//  archivos más allá. En este archivo el objeto `headers` se arma en **un solo
//  lugar** —`pedir`, abajo— y tiene **una sola clave**, que es el tipo de
//  contenido del cuerpo. Se ve entero de un vistazo, y `src/tests/guardiaDeLaTienda.test.js`
//  falla si alguien le agrega otra.
//
//  Del otro lado tampoco hay dónde ponerla: el router público **no tiene cadena
//  de autenticación**, así que las cabeceras de sesión ni siquiera se leen
//  (contracts/api-endpoints.md, regla 1). La empresa sale del slug y de ningún
//  otro lado.
//
//  ── Contra su propio origen ──
//
//  Las rutas son **relativas** (`/api/publico/...`), no una URL absoluta armada
//  con una variable de entorno. `apps/web` habla con la API por `VITE_API_URL` y
//  con CORS de por medio; acá Caddy manda `/api/publico/*` al mismo origen que
//  sirvió el documento. Sin CORS no hay preflight que pueda fallar en silencio,
//  y no hay una variable de build que pueda quedar apuntando al entorno
//  equivocado — no existe.
// ════════════════════════════════════════════

const BASE = '/api/publico'

/**
 * El error que la tienda sabe dibujar.
 *
 * `codigo` es el que trae el cuerpo (`NO_ENCONTRADO`, `STOCK_INSUFICIENTE`,
 * `DEMASIADAS_PETICIONES`…) y es lo que elige la pantalla; `http` y `cuerpo`
 * quedan para los casos que necesitan el detalle —el 409 de stock trae las
 * líneas recortadas y el `reintentar_con`—.
 *
 * ⚠ Un `fetch` que no llega a destino (el teléfono perdió la señal a mitad del
 * checkout, que es el escenario normal y no el raro) rechaza con un `TypeError`
 * sin `status`. Sin traducirlo acá, la pantalla recibiría un error que no sabe
 * distinguir de un fallo del servidor y mostraría el mensaje equivocado.
 */
export class ErrorDeLaTienda extends Error {
  constructor(codigo, http, cuerpo) {
    super(codigo)
    this.name = 'ErrorDeLaTienda'
    this.codigo = codigo
    this.http = http
    this.cuerpo = cuerpo
  }
}

export async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const init = { method: metodo }
  if (cuerpo !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(cuerpo)
  }

  let respuesta
  try {
    respuesta = await fetch(BASE + ruta, init)
  } catch {
    throw new ErrorDeLaTienda('SIN_CONEXION', 0, null)
  }

  // El cuerpo se lee **siempre**, también cuando el estado no es 2xx: los
  // errores del público llevan su información adentro (el 409 de stock trae las
  // líneas). Y se lee tolerando que no sea JSON, porque un 502 de Caddy o una
  // página de error del proxy llegan en HTML y `.json()` revienta.
  const datos = await respuesta.json().catch(() => null)

  if (!respuesta.ok || datos?.ok === false) {
    throw new ErrorDeLaTienda(datos?.error ?? 'NO_DISPONIBLE_POR_UN_MOMENTO', respuesta.status, datos)
  }
  return datos
}

const cadena = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return q ? `?${q}` : ''
}

const deSlug = (slug) => `/c/${encodeURIComponent(slug)}`

/** Lo único que se pide al abrir: marca, entrega, pagos, categorías y la primera página. */
export const traerCatalogo = (slug, origen) => pedir(deSlug(slug) + cadena({ f: origen }))

/** Las páginas siguientes de la grilla. **No** se llama al buscar ni al cambiar de categoría (FR-114). */
export const traerProductos = (slug, { q, categoria, pagina } = {}) =>
  pedir(`${deSlug(slug)}/productos` + cadena({ q, categoria, pagina }))

export const traerProducto = (slug, id) => pedir(`${deSlug(slug)}/productos/${encodeURIComponent(id)}`)

export const crearPedido = (slug, pedido) =>
  pedir(`${deSlug(slug)}/pedidos`, { metodo: 'POST', cuerpo: pedido })
