// ════════════════════════════════════════════
//  FAVALIO · Cómo se reparten los gastos fijos por sucursal
//
//  ── El defecto que esto cierra ──
//
//  `pages/Expenses.jsx` armaba los grupos así:
//
//    groups[pv.id].expenses = expenses.filter(
//      e => e.punto_de_venta_id === pv.id || e.group === 'gf' + puntosDeVenta.indexOf(pv))
//    groups.general.expenses = expenses.filter(
//      e => !e.punto_de_venta_id && !e.group?.startsWith('gf'))
//
//  Un gasto sin `punto_de_venta_id` y con `group = 'gf1'` —que es exactamente lo
//  que produce `scripts/migrar-legacy.js:379` y lo que tiene hoy Comprafit—
//  entraba en la primera rama SOLO si la empresa tenía dos sucursales o más, y
//  quedaba afuera de «General» siempre por el `!e.group?.startsWith('gf')`. Con
//  **una sola sucursal** —el caso de Comprafit— el gasto no se dibujaba en
//  ninguna parte: ni en su tarjeta, ni en «General», ni en ningún total. Y
//  seguía moviendo el punto de equilibrio, porque el simulador lo suma del lado
//  del servidor. Plata que decide precios y que la pantalla no muestra.
//
//  ── Por qué esta función NO mira `group` ──
//
//  `'gf1'` significa «Ortiz de Ocampo» y `'gf2'` «Uriburu» **en Comprafit**, y no
//  significa nada en general: es el resto de la migración del legacy. Traducirlo
//  acá sería escribir una regla que solo es cierta para un cliente adentro de un
//  archivo que sirve a todos, y quedaría muda o mintiendo para el segundo.
//
//  El reparto sale de `punto_de_venta_id` y de nada más. Los gastos que hoy no
//  lo tienen se asignan a la sucursal por defecto en una **migración de datos
//  aparte** (decisión 4). El orden importa: esta corrección tiene que ser
//  correcta **con los datos como están hoy**, para que revertir la migración no
//  vuelva a esconder la plata.
//
//  ── Los dos invariantes, que son lo que el test afirma ──
//
//   · La suma de todos los grupos es la suma de la entrada (FR-020).
//   · Ningún gasto aparece en dos grupos (FR-021).
//
//  Se afirman como propiedades sobre listas cualesquiera y no con tres casos
//  elegidos a mano: los dos defectos de arriba —el que descarta y el que
//  duplica— pasan un caso elegido a mano según cuál se elija.
// ════════════════════════════════════════════

/** La clave del bucket de los gastos que no tienen sucursal. */
export const CLAVE_GENERAL = 'general'

/**
 * El nombre del bucket sin sucursal.
 *
 * Está acá y no escrito en la pantalla porque la tarjeta de total y el
 * encabezado del bloque tienen que decir lo mismo, y porque el test lo nombra.
 */
export const NOMBRE_GENERAL = 'General'

/**
 * Reparte los gastos fijos en un grupo por sucursal más «General».
 *
 * @param {Array<{id:number, punto_de_venta_id:?number, amount:string|number}>} gastos
 *   Las filas tal cual las devuelve `GET /api/expenses`.
 * @param {Array<{id:number, name:string}>} sucursales
 *   Los puntos de venta de la empresa, en el orden en que se quieren dibujar.
 * @returns {Array<{clave:string, id:?number, nombre:string, gastos:Array, conocida:boolean}>}
 *   Un grupo por sucursal —incluidas las que no tienen ningún gasto, que
 *   necesitan su tarjeta en cero— y «General» **siempre al final**, exista o no
 *   algún gasto sin sucursal: FR-023 pide que «General» tenga su tarjeta y que
 *   los grupos no se filtren por su nombre.
 */
export function agruparGastosPorSucursal(gastos = [], sucursales = []) {
  const porSucursal = new Map()

  for (const sucursal of sucursales) {
    porSucursal.set(String(sucursal.id), {
      clave: `pv-${sucursal.id}`,
      id: sucursal.id,
      nombre: sucursal.name || `Sucursal #${sucursal.id}`,
      gastos: [],
      conocida: true,
    })
  }

  const general = {
    clave: CLAVE_GENERAL,
    id: null,
    nombre: NOMBRE_GENERAL,
    gastos: [],
    conocida: true,
  }

  // Las sucursales que aparecen en un gasto y NO están en la lista recibida.
  // No estaba previsto y hace falta: `empresaActiva.puntosDeVenta` puede no
  // traer una sucursal dada de baja, y descartar sus gastos sería el mismo
  // defecto que esta función viene a cerrar, con otra causa. Se les arma su
  // propio grupo —nunca «General», que significa «sin sucursal» y sería
  // falso— y se marcan `conocida: false` para que la pantalla lo pueda decir.
  const desconocidas = new Map()

  for (const gasto of gastos) {
    const id = gasto?.punto_de_venta_id

    if (id === null || id === undefined || id === '') {
      general.gastos.push(gasto)
      continue
    }

    const clave = String(id)
    const grupo = porSucursal.get(clave)

    if (grupo) {
      grupo.gastos.push(gasto)
      continue
    }

    if (!desconocidas.has(clave)) {
      desconocidas.set(clave, {
        clave: `pv-${clave}`,
        id,
        nombre: `Sucursal #${clave}`,
        gastos: [],
        conocida: false,
      })
    }

    desconocidas.get(clave).gastos.push(gasto)
  }

  return [...porSucursal.values(), ...desconocidas.values(), general]
}

// ════════════════════════════════════════════
//  El mes de los gastos variables
//
//  ── Los dos defectos que esto cierra ──
//
//  1. **El mes por defecto se calculaba en UTC.**
//     `new Date().toISOString().slice(0, 7)` era lo que había en
//     `GastosVariables.jsx:26`. Argentina es UTC−3, así que a partir de las
//     21:00 hora local UTC ya está en el día siguiente: el 31 a las 21:30 la
//     pantalla abría en el mes SIGUIENTE, vacío, y el gasto que se cargaba esa
//     noche se archivaba donde nadie lo iba a buscar. Pasa todos los meses y
//     solo a esa hora, que es cuando se cierra la caja. Sale de `fechaDeHoy`,
//     que usa la fecha local.
//
//  2. **El nombre del mes salía de `toLocaleDateString('es-AR', …)`**, que es
//     formateo en línea adentro de un componente: la guardia de
//     `formato.test.js` lo prohíbe desde FR-013. Y no alcanzaba con moverlo:
//     `toLocaleDateString` depende de los datos de localización que traiga el
//     entorno, así que el mismo mes podía salir «julio» en un navegador y
//     «July» en otro. Doce palabras escritas una vez no dependen de nada.
// ════════════════════════════════════════════

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * '2026-07' → 'julio 2026'.
 *
 * @param {string} mes YYYY-MM.
 * @returns {string} Siempre algo legible: con un mes fuera de rango devuelve lo
 *   que recibió, que es mejor que «undefined 2026» en un encabezado.
 */
export function nombreDelMes(mes) {
  const [anio, m] = String(mes || '').split('-')
  const nombre = MESES[Number(m) - 1]

  return nombre ? `${nombre} ${anio}` : String(mes || '—')
}

/**
 * El mes anterior o el siguiente, sin pasar por `Date`.
 *
 * `new Date(anio, mes - 1 + delta, 1)` funcionaba, pero mete una zona horaria en
 * una cuenta que es aritmética de enteros: doce meses por año y nada más.
 *
 * @param {string} mes YYYY-MM.
 * @param {number} delta Cuántos meses moverse. Negativo va para atrás.
 */
export function desplazarMes(mes, delta) {
  const [anio, m] = String(mes || '').split('-').map(Number)
  if (!Number.isFinite(anio) || !Number.isFinite(m)) return mes

  // Contar en meses absolutos desde el año 0 evita los dos casos de borde:
  // enero menos uno y diciembre más uno.
  const absolutos = anio * 12 + (m - 1) + delta

  const anioNuevo = Math.floor(absolutos / 12)
  const mesNuevo = absolutos - anioNuevo * 12 + 1

  return `${anioNuevo}-${String(mesNuevo).padStart(2, '0')}`
}
