import { esStockBajo } from '@/utils/stockBajo'

// ════════════════════════════════════════════
//  ADMINAPP · La lógica de la pantalla de Inventario, fuera del componente
//
//  Todo lo que la pantalla **decide** —qué filas entran, cuánto suma cada
//  indicador, de qué color va cada badge, qué sucursales pueden ser columna—
//  vive acá y no adentro de `pages/Inventory.jsx`. Es el mismo movimiento que
//  ya se hizo con `estadoVenta.js` y `exportarVentas.js`, y por el mismo
//  motivo: `apps/web` no tiene entorno de tests de render (ni jsdom ni
//  testing-library), así que una regla escrita adentro del componente es una
//  regla **sin ninguna cobertura posible**.
//
//  No es una hipótesis. Cuatro incumplimientos de la spec —el badge con la
//  regla vieja, el filtro de sucursal que no filtraba, el conteo de sucursales
//  con stock negativo y las unidades comprometidas calculadas sobre lo que se
//  estaba tipeando— pasaron los 274 tests de la web sin ponerse en rojo, porque
//  no había forma de llamarlos.
//
//  Montar el entorno de render sigue haciendo falta y sigue siendo otro
//  proyecto (`docs/PROXIMOS-PROYECTOS.md`, 5d). Lo que este archivo consigue es
//  que lo que quede sin cubrir sea el **dibujo** —que el badge esté en la celda
//  que corresponde— y no la **regla** —de qué color va—.
// ════════════════════════════════════════════

/** El valor del filtro de sucursal que significa «mostralas todas». */
export const TODAS_LAS_SUCURSALES = 'todas'

/** El valor del filtro de categoría que significa «no filtres». */
export const TODAS_LAS_CATEGORIAS = 'todas'

/**
 * Un texto comparable: sin acentos, sin mayúsculas.
 *
 * «Colágeno» y «colageno» tienen que dar lo mismo. Sin esto, el usuario que
 * escribe rápido —o el que copia del proveedor, que escribe sin tilde— no
 * encuentra el producto y concluye que no está cargado.
 */
export function comparable(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * La fila de stock de un producto en una sucursal, o `undefined`.
 *
 * Por **`punto_de_venta_id`** y nunca por el texto `location` (FR-061): dos
 * sucursales distintas pueden haber tenido el mismo texto, y una fila con un
 * `location` que no corresponde a ninguna sucursal no aparecía en ninguna
 * columna. Los ids se comparan como texto porque el de la sucursal viene del
 * `<select>` como string y el de la fila como número.
 */
export function filaDeStock(producto, sucursalId) {
  return (producto?.stock || [])
    .find((s) => String(s.punto_de_venta_id) === String(sucursalId))
}

/**
 * Las filas de stock que entran en el alcance del filtro de sucursal.
 *
 * Todo lo que la pantalla cuenta —los cuatro indicadores y el conmutador de
 * stock bajo— sale de acá, así que hay un solo lugar donde el alcance está
 * definido. Con la lógica repetida en cada cálculo, el indicador y el filtro
 * terminan contando conjuntos distintos y el usuario ve «7 en stock bajo» y
 * cinco filas al filtrar.
 */
export function filasEnAlcance(producto, sucursalElegida) {
  const filas = producto?.stock || []

  if (sucursalElegida === TODAS_LAS_SUCURSALES
    || sucursalElegida === null
    || sucursalElegida === undefined) {
    return filas
  }

  const fila = filaDeStock(producto, sucursalElegida)

  return fila ? [fila] : []
}

/**
 * Si el producto pertenece al inventario de la sucursal elegida.
 *
 * Con «Todas», todos. Con una sucursal, **los que tienen fila de stock ahí** —
 * tener la fila en cero cuenta: es el producto que esa sucursal maneja y hoy no
 * tiene, que es justo el que hay que reponer.
 *
 * Sin este predicado el selector de sucursal no acotaba nada (FR-064): con 500
 * productos y una sucursal que maneja 3, la pantalla decía «Productos activos:
 * 500 · Sin stock: 497» para esa sucursal, y la tabla listaba los 500. El
 * requisito estaba en la spec y se perdió al bajar a las tareas.
 */
export function estaEnLaSucursal(producto, sucursalElegida) {
  if (sucursalElegida === TODAS_LAS_SUCURSALES
    || sucursalElegida === null
    || sucursalElegida === undefined) {
    return true
  }

  return filaDeStock(producto, sucursalElegida) !== undefined
}

/**
 * Si el producto cuenta como «stock bajo» dentro del alcance elegido.
 *
 * Es la MISMA pregunta que contestan el indicador, el conmutador del filtro, el
 * color del badge y `GET /api/faltantes` (FR-016), y por eso es una sola
 * función y no cuatro comparaciones parecidas.
 *
 * ⚠ Sin ninguna fila en el alcance el producto se trata como si estuviera en
 * cero. Con el filtro en una sucursal ese caso no llega —`estaEnLaSucursal` ya
 * lo dejó afuera—, así que solo ocurre con «Todas» y con un producto que **no
 * tiene ninguna fila de stock en ninguna sucursal**. Ese producto Faltantes no
 * lo lista, porque recorre `Stock.findAll`. Es el residuo del defecto que
 * arregla el alta de `PanelProducto`: los productos creados a partir de ahora
 * nacen con su fila, los anteriores no.
 */
export function hayStockBajo(producto, sucursalElegida, umbral) {
  const filas = filasEnAlcance(producto, sucursalElegida)

  return filas.length === 0
    ? esStockBajo({ quantity: 0, min_stock: 0 }, umbral)
    : filas.some((s) => esStockBajo(s, umbral))
}

/**
 * El resultado del listado: sucursal, categoría, stock bajo y texto.
 *
 * @param {Array} catalogo Los productos ya cargados en la pantalla.
 * @param {object} filtros
 * @param {string} filtros.texto Lo que se escribió en la búsqueda.
 * @param {string} filtros.categoria `TODAS_LAS_CATEGORIAS` o una categoría.
 * @param {boolean} filtros.soloStockBajo El conmutador.
 * @param {string} filtros.sucursalElegida `TODAS_LAS_SUCURSALES` o un id.
 * @param {number} filtros.umbral El `umbral_stock_bajo` de `settings`.
 */
export function filtrarInventario(catalogo = [], {
  texto = '',
  categoria = TODAS_LAS_CATEGORIAS,
  soloStockBajo = false,
  sucursalElegida = TODAS_LAS_SUCURSALES,
  umbral,
} = {}) {
  // Los tokens se normalizan UNA vez y no una por producto: con mil productos y
  // cinco campos, normalizar adentro del bucle son cinco mil llamadas a
  // `normalize()` por tecla.
  const tokens = comparable(texto).trim().split(/\s+/).filter(Boolean)

  return (catalogo || []).filter((p) => {
    if (!estaEnLaSucursal(p, sucursalElegida)) return false

    if (categoria !== TODAS_LAS_CATEGORIAS && p.category !== categoria) return false

    if (soloStockBajo && !hayStockBajo(p, sucursalElegida, umbral)) return false

    if (tokens.length === 0) return true

    // Todos los campos con `?? ''`: un producto sin marca, sin categoría o sin
    // SKU no puede romper la búsqueda por los demás campos.
    const buscable = [p.name, p.brand?.name, p.category, p.sku, p.barcode]
      .map(comparable)
      .join(' ')
    const costo = parseFloat(p.cost)

    return tokens.every((token) => buscable.includes(token)
      || (!isNaN(Number(token)) && costo === parseFloat(token)))
  })
}

/**
 * Los cuatro indicadores, sobre el RESULTADO FILTRADO y la sucursal elegida.
 *
 * Que se refieran al filtro y no al catálogo entero es lo que los hace útiles:
 * filtrando por una marca, «Valor del stock» contesta cuánto vale lo de esa
 * marca. Referidos al catálogo entero serían cuatro números que no cambian
 * nunca y que nadie mira (FR-015, FR-064).
 */
export function calcularIndicadores(productos = [], { sucursalElegida = TODAS_LAS_SUCURSALES, umbral } = {}) {
  let valor = 0
  let bajo = 0
  let sin = 0

  for (const p of productos || []) {
    const filas = filasEnAlcance(p, sucursalElegida)
    const cantidad = filas.reduce((suma, s) => suma + (Number(s.quantity) || 0), 0)

    valor += cantidad * (parseFloat(p.cost) || 0)

    if (cantidad <= 0) sin++

    if (hayStockBajo(p, sucursalElegida, umbral)) bajo++
  }

  return { productos: (productos || []).length, valor, bajo, sin }
}

/**
 * El badge de una celda de stock: texto, fondo y línea, juntos.
 *
 * `danger` en cero o negativo, `warn` por debajo del límite de reposición,
 * neutro si está bien. Los tres tonos van juntos —texto, fondo y línea—: un
 * color de estado suelto sobre el fondo de la tarjeta se lee como un error de
 * estilo.
 *
 * ⚠ El `warn` sale de **`esStockBajo`** y no de una comparación escrita acá.
 * Antes decía `minimo > 0 && cantidad <= minimo`, que es literalmente la regla
 * vieja de `GET /api/alerts`: un producto sin mínimo cargado no se pintaba
 * nunca. Con `quantity: 2`, `min_stock: 0` y umbral 3, el indicador lo contaba,
 * el filtro lo mostraba, la hoja impresa lo marcaba **y el badge quedaba
 * neutro**: el usuario filtraba por «Stock bajo» y veía una tabla de badges
 * neutros. FR-016 pide la misma regla en los cuatro lugares, y el color del
 * badge es uno de los cuatro.
 *
 * @param {{quantity?: number|string, min_stock?: number|string}|undefined} fila
 * @param {number} umbral El `umbral_stock_bajo` de `settings`.
 */
export function tonoDeStock(fila, umbral) {
  const cantidad = Number(fila?.quantity) || 0

  // Cero o negativo gana sobre «bajo»: son dos urgencias distintas y la de
  // arriba es la que hay que ver primero.
  if (cantidad <= 0) return 'border-danger-line bg-danger-soft text-danger'

  if (esStockBajo(fila, umbral)) return 'border-warn-line bg-warn-soft text-warn'

  return 'border-border bg-surface-3 text-fg-2'
}

/**
 * Las sucursales que pueden ser columna de la tabla y del archivo.
 *
 * Las activas siempre; las dadas de baja **solo si tienen mercadería adentro**
 * (FR-066). Una sucursal cerrada y vacía es ruido en la tabla; una cerrada con
 * stock es un problema pendiente, y esconderla es esconder el problema.
 *
 * ⚠ «Tener mercadería» es `!== 0`, no `> 0`. Con `> 0`, una sucursal inactiva
 * con una fila en -3 no generaba columna, pero ese -3 **sí** sumaba en «Valor
 * del stock» y en el `.xlsx`: quedaba una diferencia entre el total y la suma
 * de las columnas visibles que no se podía explicar mirando la pantalla — que
 * es exactamente el «stock invisible» que esta funcionalidad vino a eliminar.
 * Un stock negativo es dato roto y hay que poder verlo para arreglarlo;
 * esconderlo no lo arregla.
 */
export function sucursalesComparables(sucursales = [], catalogo = []) {
  const conMercaderia = new Set()

  for (const p of catalogo || []) {
    for (const s of p.stock || []) {
      // `|| 0` antes de comparar: una cantidad ilegible da NaN, y `NaN !== 0`
      // es `true`, así que sin esto un dato roto agregaría la columna sola.
      const cantidad = Number(s.quantity) || 0

      if (cantidad !== 0) conMercaderia.add(String(s.punto_de_venta_id))
    }
  }

  return (sucursales || []).filter((s) => s.is_active !== false || conMercaderia.has(String(s.id)))
}

/**
 * Los `POST /api/stock` que dispara un alta de producto, uno por sucursal.
 *
 * **Todas las sucursales del panel, aunque la cantidad sea cero.** Antes se
 * filtraba por `quantity > 0 || min_stock > 0` con el argumento de no llenar la
 * tabla de filas que no dicen nada, y ese argumento estaba equivocado: una fila
 * en cero sí dice algo. Un producto dado de alta sin cantidad quedaba con cero
 * filas de stock, e Inventario lo contaba como stock bajo mientras
 * `GET /api/faltantes` —que recorre `Stock.findAll`— no podía listarlo nunca.
 * El producto que había que comprar era justo el que no aparecía en la pantalla
 * con la que se arma el pedido al proveedor (criterio de éxito 19).
 *
 * `punto_de_venta_id` va en cada cuerpo: una fila de stock sin sucursal es
 * mercadería que la pantalla no muestra nunca (FR-049).
 *
 * @param {Array<{punto_de_venta_id: number|string, quantity: number|string, min_stock: number|string}>} filasDeStock
 * @param {number|string} productId El id que devolvió `POST /api/products`.
 */
export function cuerposDeStockAlCrear(filasDeStock = [], productId) {
  return (filasDeStock || []).map((fila) => ({
    product_id: productId,
    punto_de_venta_id: fila.punto_de_venta_id,
    // `|| 0` y no `Number(...)` a secas: el `<input type="number">` vacío
    // devuelve `''`, y un `NaN` viaja como `null` y hace fallar el INSERT.
    quantity: Number(fila.quantity) || 0,
    min_stock: Number(fila.min_stock) || 0,
  }))
}

/**
 * Las unidades que hay pero no se pueden vender: `quantity - available`.
 *
 * Se calcula sobre la fila **guardada** y nunca sobre lo que el usuario está
 * tipeando. `quantity` está atado al `<input>` del panel y `available` es de
 * solo lectura: escribir 15 en un renglón que tenía 10/10 hacía aparecer «Hay 5
 * unidades comprometidas en ventas o producción» —no había ninguna—, y bajar la
 * cantidad hacía aparecer el mensaje contrario sobre una fila sana. El panel
 * afirmaba un hecho del servidor a partir de una tecla del usuario.
 *
 * @param {{quantity?: number|string, available?: number|string}|undefined} filaGuardada
 * @returns {number} Positivo: comprometidas. Negativo: el disponible quedó por
 *   encima de la cantidad física, que es dato para revisar.
 */
export function unidadesComprometidas(filaGuardada) {
  const cantidad = Number(filaGuardada?.quantity) || 0
  const disponible = Number(filaGuardada?.available) || 0

  return cantidad - disponible
}
