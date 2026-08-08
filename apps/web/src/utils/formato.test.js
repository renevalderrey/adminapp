import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pesos,
  pesosRedondos,
  pesosDeLista,
  importeOGuion,
  importeAbreviado,
  fechaCorta,
  fechaCortaDeMomento,
  fechaDeHoy,
} from './formato'

// ════════════════════════════════════════════
//  Los dos errores que no hacen fallar nada
//
//  Un importe mal formateado y una fecha corrida un día no rompen ninguna
//  pantalla: abren, se ven bien, y dicen otra cosa. Por eso los dos van
//  testeados con el número exacto y no con un `toMatch`.
// ════════════════════════════════════════════

describe('pesos escribe siempre dos decimales', () => {
  it('un importe entero se ve $1.234,00 y no $1.234', () => {
    // `toLocaleString('es-AR')` sin opciones —lo que hacía `Orders.jsx:302`—
    // devuelve «1.234» para el entero y «1.234,5» para el de un decimal: tres
    // formatos distintos en la misma columna.
    expect(pesos(1234)).toBe('1.234,00')
  })

  it('NO deja tres decimales', () => {
    // El defecto de `PurchaseOrders.jsx:156`, que fijaba el mínimo y no el
    // máximo: sin `maximumFractionDigits` el valor por defecto es 3 y esto sale
    // «1.234,567».
    expect(pesos(1234.567)).toBe('1.234,57')
  })

  it('cero y null dan 0,00 y no NaN', () => {
    // `undefined` y `NaN` entran por el mismo camino: los cuatro son falsy y
    // caen en el cero. Un «NaN» dibujado en una columna de plata parece un
    // error de carga.
    expect(pesos(0)).toBe('0,00')
    expect(pesos(null)).toBe('0,00')
    expect(pesos(undefined)).toBe('0,00')
    expect(pesos(NaN)).toBe('0,00')
  })
})

// ════════════════════════════════════════════
//  Las tres variantes que NO son `pesos` con otro nombre
//
//  Cada una venía de una pantalla y tenía una diferencia deliberada. Se
//  mudaron con su motivo escrito en vez de aplanarse, y estos tests son lo que
//  impide que alguien las «unifique» más adelante creyendo que sobran: si las
//  tres devolvieran lo mismo que `pesos`, tres de estos tests se ponen rojos.
// ════════════════════════════════════════════

describe('pesosRedondos: el valorizado del inventario, sin centavos', () => {
  it('un valorizado de siete cifras NO arrastra centavos', () => {
    // Venía de `Inventory.jsx:97`. Con `pesos` esto sería «1.234.567,89» y los
    // centavos ensanchan la celda del total para no decir nada.
    expect(pesosRedondos(1234567.89)).toBe('1.234.568')
    expect(pesosRedondos(1234567.89)).not.toBe(pesos(1234567.89))
  })

  it('un importe entero NO se rellena con ,00', () => {
    expect(pesosRedondos(1200)).toBe('1.200')
  })
})

describe('pesosDeLista: los centavos solo si el precio los tiene', () => {
  it('un precio redondo NO se rellena con ,00', () => {
    // Venía de `Comparador.jsx:29`. Las listas de proveedor son casi todas de
    // importes redondos y esa tabla se lee comparando filas enteras.
    expect(pesosDeLista(1200)).toBe('1.200')
    expect(pesosDeLista(1200)).not.toBe(pesos(1200))
  })

  it('un precio con centavos los muestra', () => {
    expect(pesosDeLista(1234.5)).toBe('1.234,5')
  })

  it('el máximo SÍ está fijo: el proveedor que manda tres decimales no ensancha su columna', () => {
    // La mitad que se olvida. `minimumFractionDigits: 0` sin el máximo deja
    // pasar «1.234,567» y desalinea la comparación.
    expect(pesosDeLista(1234.567)).toBe('1.234,57')
  })
})

describe('importeOGuion: el importe con signo, o «-» cuando no vino el dato', () => {
  it('NO deja tres decimales', () => {
    // ⚠ Éste es el defecto que estaba vivo en `Reports.jsx:85` y
    // `Dashboard.jsx:82`: fijaban `minimumFractionDigits: 2` y no el máximo,
    // cuyo valor por defecto es 3. Un costo de 1234.567 salía «$1.234,567» en
    // la misma columna que otro que salía «$1.200,00».
    expect(importeOGuion(1234.567)).toBe('$1.234,57')
  })

  it('un importe entero lleva sus dos decimales', () => {
    expect(importeOGuion(1234)).toBe('$1.234,00')
  })

  it('acepta el string que manda la API, porque DECIMAL vuelve como string', () => {
    expect(importeOGuion('1234.5')).toBe('$1.234,50')
  })

  it('el campo que el reporte NO trajo se escribe «-» y no «$0,00»', () => {
    // Es la diferencia deliberada con `pesos`, que devuelve «0,00». Escribir
    // «$0,00» donde no vino nada afirma que el período cerró en cero cuando lo
    // que pasó es que el reporte no trae el campo.
    expect(importeOGuion(undefined)).toBe('-')
    expect(importeOGuion(null)).toBe('-')
    expect(importeOGuion('')).toBe('-')
    expect(importeOGuion('sin dato')).toBe('-')
  })

  it('el cero SÍ es un dato y se escribe $0,00', () => {
    // La otra mitad: si el guión se comiera también al cero, un período sin
    // ventas se leería como un período sin datos.
    expect(importeOGuion(0)).toBe('$0,00')
    expect(importeOGuion('0')).toBe('$0,00')
  })
})

describe('importeAbreviado: los indicadores del panel', () => {
  it('el millón se abrevia', () => {
    // Seis tarjetas en una fila no tienen ancho para «$7.245.318,40». La
    // abreviatura es la diferencia deliberada con `importeOGuion`.
    expect(importeAbreviado(1234567)).toBe('$1,2M')
    expect(importeAbreviado(45600)).toBe('$45,6K')
  })

  it('la coma es el separador decimal, también en la abreviatura', () => {
    // `toFixed(1)` producía un punto —«$1.2M»— y en es-AR el punto es el
    // separador de MILES: el mismo error de lectura que convierte $1.234 en
    // $1,234.
    expect(importeAbreviado(1234567)).not.toBe('$1.2M')
    expect(importeAbreviado(45600)).not.toBe('$45.6K')
  })

  it('por debajo de mil NO deja tres decimales', () => {
    // El tramo que nadie miraba: escribía `toLocaleString('es-AR')` sin
    // opciones, o sea máximo 3 decimales. El ticket promedio es una división y
    // llega con tres, así que la tarjeta mostraba «$856,567» al lado de otra
    // que mostraba «$1,2M».
    expect(importeAbreviado(856.567)).toBe('$856,57')
  })

  it('los negativos se abrevian igual: un saldo de caja en rojo también es de siete cifras', () => {
    expect(importeAbreviado(-1234567)).toBe('$-1,2M')
  })

  it('sin dato escribe «-»', () => {
    expect(importeAbreviado(undefined)).toBe('-')
  })
})

describe('fechaCorta no corre el día', () => {
  it('el primero de mes NO se corre un día', () => {
    // `new Date('2026-08-01')` se interpreta en UTC y en Argentina (UTC−3) es
    // el 31 de julio a las 21: el movimiento del primero de agosto se leería en
    // el mes anterior del estado de cuenta.
    expect(fechaCorta('2026-08-01')).toBe('01/08/2026')
    expect(fechaCorta('2026-08-01')).not.toBe('31/07/2026')
  })

  it('un timestamp completo se recorta a su fecha y tampoco se corre', () => {
    // La API manda `DATEONLY` en unos endpoints y timestamps en otros; los dos
    // empiezan igual y el corte es por posición, no por parseo.
    expect(fechaCorta('2026-08-01T02:00:00.000Z')).toBe('01/08/2026')
  })

  it('una fecha con forma inválida devuelve el texto y no Invalid Date', () => {
    // Si la API cambia el formato se quiere ver qué mandó. «Invalid Date» no
    // dice nada y manda a buscar el problema al lugar equivocado.
    expect(fechaCorta('01/08/2026')).toBe('01/08/2026')
    expect(fechaCorta('sin fecha')).toBe('sin fecha')
    expect(fechaCorta(null)).toBe('—')
    expect(fechaCorta('')).toBe('—')
  })
})

// ════════════════════════════════════════════
//  `fechaCortaDeMomento` · la otra mitad, y por qué son dos
//
//  `fechaCorta` recorta los diez primeros caracteres A PROPÓSITO, y para un
//  `DATEONLY` eso es lo correcto: parsear «2026-08-01» lo correría al 31 de
//  julio. Hay un test acá arriba que lo fija.
//
//  Pero hay campos que NO son fechas, son MOMENTOS —`expires_at`, `createdAt`,
//  `validTo`, `recibido_en`—, y ahí esos diez caracteres son la fecha **en
//  UTC**. En Argentina, de las 21:00 en adelante, ya es el día siguiente allá.
//
//  ⚠ El caso que lo destapó: una invitación creada un jueves a las 22:00 vence
//  el jueves siguiente a las 22:00, y se dibujaba con la fecha del **viernes**.
//  Miente hacia adelante, así que alguien la iba a intentar usar muerta.
//
//  Las dos conviven porque hacen falta las dos, y confundirlas corre el día en
//  un sentido o en el otro.
// ════════════════════════════════════════════

describe('fechaCortaDeMomento lee el instante en hora local', () => {
  it('un vencimiento de las 22:00 NO se dibuja como del día siguiente', () => {
    // 2026-08-14T01:00:00Z son las 22:00 del 13 en Argentina. `fechaCorta`
    // decía 14/08 sobre un enlace que a esa hora ya no servía.
    const momento = new Date(2026, 7, 13, 22, 0, 0)

    expect(fechaCortaDeMomento(momento)).toBe('13/08/2026')
  })

  it('y las dos funciones difieren justo ahí, que es el motivo de que sean dos', () => {
    // Se afirma la DIFERENCIA y no solo el valor: si alguien «unificara» las dos
    // en una, este caso lo dice. Un ISO cuyo instante local es el 13 y cuya
    // fecha UTC es el 14.
    const iso = '2026-08-14T01:00:00.000Z'

    // Este test corre en la zona de la máquina. Solo tiene sentido donde el
    // instante cae en otro día que su fecha UTC — o sea al oeste de Greenwich,
    // que es donde está el negocio.
    const local = new Date(iso)
    const esOtroDia = local.getDate() !== 14

    if (esOtroDia) {
      expect(fechaCortaDeMomento(iso)).not.toBe(fechaCorta(iso))
    }

    // Lo que SÍ se afirma siempre: `fechaCorta` sigue devolviendo la fecha UTC
    // recortada, sin parsear. Es su contrato y no cambió.
    expect(fechaCorta(iso)).toBe('14/08/2026')
  })

  it('el mediodía coincide con `fechaCorta`, que es lo normal', () => {
    // El contra-caso. Si difirieran siempre, una de las dos estaría corriendo
    // el día en todas las pantallas y no solo de noche.
    expect(fechaCortaDeMomento('2026-08-14T15:00:00.000Z')).toBe('14/08/2026')
    expect(fechaCorta('2026-08-14T15:00:00.000Z')).toBe('14/08/2026')
  })

  it('lo ilegible devuelve el texto, y lo vacío un guión', () => {
    // Mismo criterio que `fechaCorta`: «Invalid Date» manda a buscar el problema
    // al lugar equivocado.
    expect(fechaCortaDeMomento('sin fecha')).toBe('sin fecha')
    expect(fechaCortaDeMomento(null)).toBe('—')
    expect(fechaCortaDeMomento('')).toBe('—')
  })
})

// ════════════════════════════════════════════
//  fechaDeHoy · el bug que solo aparece de noche
//
//  ⚠ **La zona horaria se fija a mano y no se hereda de la máquina.** Este
//  defecto es INVISIBLE en una máquina en UTC: ahí el día local y el día UTC
//  son siempre el mismo, así que el test pasaría con y sin la corrección y no
//  valdría nada. Se fuerza Buenos Aires, se verifica que el desplazamiento
//  quedó aplicado de verdad, y se restaura al terminar para no ensuciar a los
//  otros archivos de la suite que comparten el proceso.
// ════════════════════════════════════════════

describe('fechaDeHoy no adelanta el día', () => {
  let tzOriginal

  beforeAll(() => {
    tzOriginal = process.env.TZ
    process.env.TZ = 'America/Argentina/Buenos_Aires'
  })

  afterAll(() => {
    if (tzOriginal === undefined) delete process.env.TZ
    else process.env.TZ = tzOriginal
    vi.useRealTimers()
  })

  it('la zona horaria del test quedó realmente en UTC−3', () => {
    // Sin esto, si `process.env.TZ` dejara de tener efecto —cambio de runtime,
    // de pool de vitest— los dos tests de abajo pasarían por la razón
    // equivocada y nadie se enteraría.
    expect(new Date(2026, 6, 31, 23, 30).getTimezoneOffset()).toBe(180)
  })

  it('las 23:30 del 31 de julio son el 31 de julio y NO el 1 de agosto', () => {
    // El defecto: `new Date().toISOString().slice(0, 10)` pasa por UTC, y a las
    // 23:30 de Buenos Aires en UTC ya es el día siguiente. El pago cargado esa
    // noche quedaría fechado en agosto y saldría en el mes equivocado del
    // estado de cuenta.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 31, 23, 30))

    expect(fechaDeHoy()).toBe('2026-07-31')
    expect(fechaDeHoy()).not.toBe(new Date().toISOString().slice(0, 10))

    vi.useRealTimers()
  })

  it('el mes y el día van con cero adelante: la API espera AAAA-MM-DD', () => {
    // Sin `padStart` el 5 de enero sale «2026-1-5», que un `<input type="date">`
    // no muestra y el backend rechaza.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5, 10, 0))

    expect(fechaDeHoy()).toBe('2026-01-05')

    vi.useRealTimers()
  })
})

// ════════════════════════════════════════════
//  Guardia · las copias no vuelven
//
//  Sin esto, la próxima persona que necesite formatear un importe adentro de
//  una pantalla escribe las cuatro líneas ahí mismo en vez de importar nada —
//  que es cómo se llegó a tener siete `pesos`, seis `formatCurrency` y tres
//  `fechaDeHoy` escritas por separado, y cómo el defecto de los decimales
//  sobrevivió en dos pantallas después de haberse corregido en una tercera.
//
//  La guardia se generalizó a partir de la que cubría solo `PanelVenta`.
//  Revisa **todos** los archivos de `pages/` y `components/`, con recursión, y
//  afirma cuántos revisó: este repositorio ya tuvo dos guardias que pasaban por
//  vacío, una de ellas porque leía un directorio sin bajar a sus subcarpetas.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

const leer = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/**
 * Los archivos de código de una carpeta y de todas sus subcarpetas.
 *
 * La recursión es el punto: `components/pos/` tiene tres archivos y dos de
 * ellos formatean plata. Una guardia que lea solo el primer nivel los deja
 * afuera sin decirlo.
 */
function archivosDeCodigo(relativa) {
  const encontrados = []

  const bajar = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completa = path.join(dir, entrada.name)

      if (entrada.isDirectory()) {
        bajar(completa)
      } else if (/\.jsx?$/.test(entrada.name) && !/\.test\.jsx?$/.test(entrada.name)) {
        encontrados.push(path.relative(SRC, completa).replace(/\\/g, '/'))
      }
    }
  }

  bajar(path.join(SRC, relativa))

  return encontrados
}

/**
 * El archivo sin sus comentarios.
 *
 * Los comentarios de este cambio nombran `formatCurrency` y
 * `minimumFractionDigits` justamente para explicar qué se sacó de cada
 * pantalla. Buscando sobre el texto crudo, la guardia se dispararía con la nota
 * que documenta la corrección — y para callarla habría que borrar la
 * explicación, que es lo último que se quiere.
 */
function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linea) => !/^\s*(\/\/|\*)/.test(linea))
    .join('\n')
}

/**
 * Lo que ninguna pantalla ni componente puede declarar por su cuenta.
 *
 * Los dos primeros son por nombre y el último por contenido: sin él, copiar las
 * cuatro líneas con el nombre `formatearPlata` esquivaría la guardia entera.
 * Los decimales de un importe se deciden en `utils/formato.js` y en ningún
 * otro lado.
 */
const PROHIBIDO = [
  {
    que: 'una función `pesos` propia',
    patron: /(?:const|let|var|function)\s+pesos\w*\s*[=(]/,
  },
  {
    que: 'un `formatCurrency` propio',
    patron: /(?:const|let|var|function)\s+format(?:Currency|Full)\w*\s*[=(]/,
  },
  {
    que: 'una `fechaDeHoy` propia',
    patron: /(?:const|let|var|function)\s+(?:fechaDeHoy|hoy)\s*[=(]/,
  },
  {
    que: 'los decimales de un importe decididos en la pantalla',
    patron: /(?:minimum|maximum)FractionDigits/,
  },
  // ── La quinta: el formateo EN LÍNEA (FR-013) ──
  //
  // Las cuatro de arriba miran **funciones declaradas** y las opciones de
  // decimales. Ese es exactamente el camino por el que las cuatro pantallas de
  // la 014 esquivan la guardia: no declaran ninguna función y escriben
  // `${total.toLocaleString()}` adentro del JSX.
  //
  // Y no es un descuido cosmético. `toLocaleString()` **sin argumentos** usa la
  // configuración regional del navegador: en un navegador en inglés el gasto de
  // $1.234 sale «1,234», que es el error de lectura que convierte mil doscientos
  // treinta y cuatro en uno coma dos. `Dashboard.jsx:328` lo hace sobre los
  // gastos fijos con los que el simulador calcula el precio de venta.
  //
  // `toLocaleDateString` entra por lo mismo: `new Date('2026-08-01')` se lee
  // como medianoche UTC y en Argentina muestra el 31 de julio.
  {
    que: 'el formateo en línea de un importe o una fecha',
    patron: /\.toLocaleString\(|\.toLocaleDateString\(|new Intl\.NumberFormat\(/,
  },
]

/**
 * Lo que quedó sin mudar, y por qué.
 *
 * ⚠ **Esto no es una lista de permisos: es el registro de la deuda.** Cada
 * entrada es un archivo que esta corrección no tenía alcance para tocar. La
 * guardia verifica que cada uno SIGA teniendo su copia, así que cuando alguien
 * lo migre el test se pone rojo y la línea hay que borrarla — la lista solo
 * puede achicarse.
 *
 * ── El tercer campo, y por qué se agregó con la quinta regla ──
 *
 * Una entrada sin tercer campo excusa al archivo de **todas** las reglas, que
 * es como estaba escrita la lista. Eso alcanzaba con nueve entradas; con la
 * quinta regla entran once más, y varias son pantallas recién reescritas
 * —`Inventory.jsx`, `PanelVenta.jsx`— que hoy cumplen las otras cuatro. Excusar
 * el archivo entero por un `toLocaleDateString` significaría que mañana alguien
 * puede escribir ahí su propio `formatCurrency` y la guardia no diría nada.
 *
 * Por eso el tercer campo enumera **de qué reglas** se excusa, por el texto del
 * campo `que`. Las nueve entradas viejas no lo llevan y siguen valiendo para
 * todas, que es lo que decían antes.
 */
const PENDIENTES = [
  ['pages/CashFlow.jsx', 'formatCurrency propio, idéntico a los otros tres; fuera del alcance de este cambio'],
  ['pages/Customers.jsx', 'ídem CashFlow'],
  ['pages/Production.jsx', 'ídem CashFlow'],
  ['pages/Taxes.jsx', 'ídem CashFlow'],
  ['components/BloqueDeDocumentos.jsx', 'tercera copia de `hoy()`, la misma corrección del bug de UTC'],
  ['components/pos/CatalogoDelPos.jsx', '`pesos` sin centavos, del punto de venta; la pantalla la tiene otro frente'],
  ['components/pos/TicketDelPos.jsx', 'ídem CatalogoDelPos'],
  ['components/ImportWizard.jsx', 'formatea un importe de muestra en línea, sin declarar función'],
  // ⚠ Éste lo encontró la guardia, no una búsqueda: no declara ninguna función
  // y por eso no aparecía buscando `pesos` ni `formatCurrency`. Formatea tres
  // importes en línea con `toLocaleString(undefined, …)` —sin locale: en un
  // navegador en inglés el costo por unidad sale «1,234.57», que es el error de
  // lectura que convierte $1.234 en $1,234— y dos de los tres tampoco fijan el
  // máximo. Es peor que el defecto que este cambio vino a corregir y está
  // fuera de su alcance; queda anotado acá y reportado.
  ['pages/Recipes.jsx', 'formatea plata en línea, sin locale y sin máximo; fuera del alcance de este cambio'],

  // ════════════════════════════════════════════
  //  La deuda que destapó la quinta regla (T1369, hito 014)
  //
  //  Los once salieron de CORRER el detector, no de adivinar. Cada uno se
  //  excusa **solo** del formateo en línea y sigue sujeto a las otras cuatro.
  //
  //  ⚠ **Dos de ellos son de FR-005 y `tasks.md` dice que no pueden entrar.**
  //  `pages/Dashboard.jsx` y `pages/Settings.jsx` infringen la regla hoy y se
  //  reescriben en los cortes 6 y 9, o sea cinco cortes más tarde. Dejarlos
  //  afuera pone `npm run test:web` en rojo desde este commit y durante todo ese
  //  tramo, que es exactamente lo que el punto 7 del preámbulo de `tasks.md`
  //  prohíbe («ninguna guardia queda en rojo a propósito en este hito») y por el
  //  motivo que ahí se explica: con la suite roja, la próxima infracción de
  //  verdad entra sin que nadie la vea. Entran acá, con la tarea que los saca
  //  escrita al lado, y el `it('la lista de pendientes no junta polvo')` obliga
  //  a borrar la línea el día que se migren.
  //
  //  ✔ **`pages/Dashboard.jsx` ya salió** (T1381, corte 6): los cuatro importes
  //  en línea del simulador —`fixedExpenses.toLocaleString()` y
  //  `targetSales.toLocaleString()`, sin locale, o sea «1,234.5» en un navegador
  //  en inglés— ahora salen de `pesos`. La línea se borra y no se comenta: la
  //  lista es el registro de lo que falta, no de lo que faltó.
  //
  //  Los otros dos archivos de FR-005 NO están: `pages/Expenses.jsx` y
  //  `components/GastosVariables.jsx` se reescriben en ESTE corte (T1371 y
  //  T1372) y quedan limpios en el mismo commit. `pages/Team.jsx` no infringe
  //  esta regla.
  // ════════════════════════════════════════════
  //  ✔ **`pages/Settings.jsx` ya salió** (T1407, corte 9): el vencimiento del
  //  certificado se dibujaba con `new Date(certInfo.validTo).toLocaleDateString()`
  //  —un `DATEONLY` leído como medianoche UTC, o sea el día anterior en
  //  Argentina— y ahora sale de `fechaCorta`. La línea se borra y no se comenta:
  //  la lista es el registro de lo que falta, no de lo que faltó.
  ['pages/Billing.jsx', 'la fecha del ticket impreso, en línea; fuera del alcance de este cambio', ['el formateo en línea de un importe o una fecha']],
  ['pages/Faltantes.jsx', 'dos importes del pedido a pedir, en línea', ['el formateo en línea de un importe o una fecha']],
  ['pages/Inventory.jsx', '`unidades()` —que NO es plata— y la fecha de una transferencia', ['el formateo en línea de un importe o una fecha']],
  ['pages/InvoicesList.jsx', 'la fecha y hora del comprobante impreso, en línea', ['el formateo en línea de un importe o una fecha']],
  ['pages/SubscriptionSettings.jsx', 'las dos fechas de la prueba gratis, en línea', ['el formateo en línea de un importe o una fecha']],
  //  ✔ **`components/HistorialDeCostos.jsx` ya salió** (hito 9): tenía su propia
  //  `fechaCorta` con `toLocaleDateString`, y estaba bien —recibe un timestamp
  //  CON hora, no un `DATEONLY`, y aplanarla contra la compartida habría movido
  //  un día esa columna—. Lo que faltaba no era unificarlas: era que existiera
  //  la segunda forma. Ahora está, se llama `fechaCortaDeMomento`, y la copia
  //  local se borró. La línea se borra y no se comenta.
  ['components/PanelTransferencia.jsx', '`unidades()`, que no es plata', ['el formateo en línea de un importe o una fecha']],
  ['components/PanelVenta.jsx', 'la fecha y hora de la venta, en línea', ['el formateo en línea de un importe o una fecha']],
  ['components/PreciosMasivos.jsx', 'la fecha del último cambio y un importe de resumen', ['el formateo en línea de un importe o una fecha']],
]

/**
 * De qué reglas se excusa cada archivo pendiente.
 *
 * `null` significa «de todas», que es lo que decían las nueve entradas viejas.
 */
const EXCUSAS = new Map(PENDIENTES.map(([archivo, , reglas]) => [archivo, reglas || null]))

/** ¿Este archivo está excusado de esta regla? */
function estaExcusado(archivo, regla) {
  if (!EXCUSAS.has(archivo)) return false

  const reglas = EXCUSAS.get(archivo)
  return reglas === null || reglas.includes(regla)
}

const REVISADOS = [...archivosDeCodigo('pages'), ...archivosDeCodigo('components')]

describe('ninguna pantalla ni componente escribe su propio formateo', () => {
  it('la guardia revisó archivos de verdad, y bajó a las subcarpetas', () => {
    // El ancla. Dos guardias de este repositorio pasaron por vacío: una tenía
    // la ruta mal y comparaba contra una cadena vacía, la otra leía el
    // directorio sin recursión. Las dos afirmaciones de abajo son contra eso:
    // la cantidad, y que un archivo que SOLO existe en una subcarpeta esté.
    expect(REVISADOS.length).toBeGreaterThan(0)
    expect(REVISADOS.length).toBeGreaterThanOrEqual(55)

    expect(REVISADOS).toContain('pages/Reports.jsx')
    expect(REVISADOS).toContain('components/PanelVenta.jsx')
    // Sin recursión, `pages/` + `components/` dan 42 archivos y éste no está.
    expect(REVISADOS).toContain('components/pos/TicketDelPos.jsx')
    expect(REVISADOS).toContain('components/ui/card.jsx')
  })

  it('los archivos revisados se leyeron: ninguno vino vacío', () => {
    // Un `readFileSync` que devuelve '' hace pasar cualquier `not.toMatch`.
    const vacios = REVISADOS.filter((rel) => leer(rel).trim().length === 0)

    expect(vacios).toEqual([])
  })

  it('nadie declara su propio pesos, formatCurrency ni fechaDeHoy, ni formatea en línea', () => {
    const infractores = []

    for (const rel of REVISADOS) {
      const codigo = sinComentarios(leer(rel))

      for (const { que, patron } of PROHIBIDO) {
        if (estaExcusado(rel, que)) continue
        if (patron.test(codigo)) infractores.push(`${rel}: ${que}`)
      }
    }

    expect(infractores).toEqual([])
  })

  it('la lista de pendientes no junta polvo: cada entrada sigue teniendo su copia', () => {
    // Sin esto, la lista se convierte en un permiso permanente: alguien migra
    // el archivo, la línea queda, y el próximo que escriba su `pesos` ahí pasa
    // la guardia sin que nadie lo note.
    //
    // Se mira contra las reglas de las que la entrada se excusa, y no contra
    // las cinco: `pages/Inventory.jsx` está por el formateo en línea y no
    // declara ningún `pesos`, así que preguntar por las cinco lo dejaría
    // «vigente» para siempre por una regla que nunca infringió.
    const yaMigrados = PENDIENTES.filter(([archivo, , reglas]) => {
      const codigo = sinComentarios(leer(archivo))
      const suyas = reglas
        ? PROHIBIDO.filter(({ que }) => reglas.includes(que))
        : PROHIBIDO

      return !suyas.some(({ patron }) => patron.test(codigo))
    })

    expect(yaMigrados).toEqual([])
  })

  it('cada regla nombrada en un pendiente existe de verdad', () => {
    // Un nombre de regla mal escrito en el tercer campo excusaría de NADA —el
    // `includes` no matchea— o, peor, se leería como que el archivo está
    // cubierto cuando la guardia lo sigue mirando. Las dos lecturas son falsas
    // y el error es un typo.
    const nombres = PROHIBIDO.map(({ que }) => que)

    for (const [archivo, , reglas] of PENDIENTES) {
      for (const regla of reglas || []) {
        expect(nombres, `${archivo} nombra una regla que no existe: ${regla}`).toContain(regla)
      }
    }
  })
})

// ════════════════════════════════════════════
//  La quinta regla, contra una muestra sintética
//
//  El resto de este archivo verifica la guardia contra el repositorio, y el
//  repositorio va a dejar de tener el defecto: cuando los once pendientes se
//  migren, «no encontró nada» y «no está mirando nada» se leerán igual.
//
//  La muestra es lo que sostiene la regla ese día. Es exactamente la forma que
//  tenían las cuatro pantallas de la 014: **ninguna función declarada**, así que
//  las cuatro reglas anteriores pasan en verde sobre ella.
// ════════════════════════════════════════════

const MUESTRA_EN_LINEA_MALA = `
export default function Panel({ gastosFijos, vencimiento }) {
  return (
    <>
      <strong>\${gastosFijos.toLocaleString()}</strong>
      <span>{new Date(vencimiento).toLocaleDateString()}</span>
    </>
  )
}
`

const MUESTRA_EN_LINEA_BUENA = `
import { pesos, fechaCorta } from '@/utils/formato'

export default function Panel({ gastosFijos, vencimiento }) {
  return (
    <>
      <strong>\${pesos(gastosFijos)}</strong>
      <span>{fechaCorta(vencimiento)}</span>
    </>
  )
}
`

/** Qué reglas infringe un texto. */
function reglasQueInfringe(texto) {
  return PROHIBIDO.filter(({ patron }) => patron.test(sinComentarios(texto))).map(({ que }) => que)
}

describe('la guardia ve el formateo en línea, que es por donde se le escapaba', () => {
  it('un importe formateado en línea con toLocaleString, sin declarar ninguna función, no esquiva la guardia', () => {
    expect(reglasQueInfringe(MUESTRA_EN_LINEA_MALA)).toEqual([
      'el formateo en línea de un importe o una fecha',
    ])
  })

  it('las cuatro reglas viejas NO ven esa muestra: por eso hacía falta la quinta', () => {
    // Es la mitad que explica por qué la regla existe. Sin este caso, alguien
    // podría creer que la muestra ya la cubría `*FractionDigits` —no la cubre:
    // `toLocaleString()` sin argumentos no nombra ninguna opción— y borrar la
    // quinta por redundante.
    const viejas = PROHIBIDO.slice(0, 4)

    expect(viejas.filter(({ patron }) => patron.test(MUESTRA_EN_LINEA_MALA))).toEqual([])
  })

  it('la muestra que usa utils/formato no da ningún hallazgo', () => {
    // Sin esto la regla podría estar fallando siempre, que es tan inútil como
    // no fallar nunca: nadie convive con una guardia que no se puede poner en
    // verde.
    expect(reglasQueInfringe(MUESTRA_EN_LINEA_BUENA)).toEqual([])
  })
})

/**
 * Quién tiene que importar qué de `utils/formato`.
 *
 * Es la otra mitad de la guardia: sin ella, borrar la copia y dejar el archivo
 * sin formatear nada —o formateando a mano— también pasaría.
 */
const IMPORTAN = [
  ['pages/Reports.jsx', ['importeOGuion']],
  ['pages/Dashboard.jsx', ['importeAbreviado', 'importeOGuion']],
  ['pages/Comparador.jsx', ['pesosDeLista']],
  ['pages/Inventory.jsx', ['pesos', 'pesosRedondos']],
  ['pages/InvoicesList.jsx', ['pesos']],
  // El vencimiento del certificado y la fecha de la verificación. Sin esta
  // entrada, borrar el `toLocaleDateString` y dejar de mostrar la fecha también
  // pasaría la guardia — y la fecha del vencimiento es justamente el dato que
  // evita que un comercio deje de poder facturar de un día para el otro.
  // ⚠ Ahora es `fechaCortaDeMomento` y no `fechaCorta`: `validTo` y
  // `verificado_en` son INSTANTES, no `DATEONLY`. Con la función de `DATEONLY`
  // se dibujaba la fecha UTC, o sea un día de más para todo lo que pasa después
  // de las 21:00 hora argentina.
  ['pages/Settings.jsx', ['fechaCortaDeMomento']],
  ['pages/Orders.jsx', ['pesos', 'fechaCorta', 'fechaDeHoy']],
  ['pages/PurchaseOrders.jsx', ['pesos', 'fechaCorta', 'fechaDeHoy']],
  ['components/HistorialDeCostos.jsx', ['pesos', 'fechaCortaDeMomento']],
  ['components/PanelProducto.jsx', ['pesos']],
  ['components/PanelVenta.jsx', ['pesos', 'fechaCorta']],
  ['utils/impresionInventario.js', ['pesos']],
]

describe('los archivos migrados usan la fuente compartida', () => {
  it.each(IMPORTAN)('%s importa %s de utils/formato', (archivo, nombres) => {
    const importado = leer(archivo).match(
      /import\s*\{([^}]*)\}\s*from\s*'@\/utils\/formato'/
    )

    expect(importado, `${archivo} no importa nada de @/utils/formato`).not.toBeNull()

    const traidos = importado[1].split(',').map((n) => n.trim())

    for (const nombre of nombres) {
      expect(traidos).toContain(nombre)
    }
  })

  it('PanelVenta NO tiene su propia copia de fechaCorta', () => {
    // `fechaCorta` queda afuera de la lista prohibida a propósito —abajo se
    // explica por qué— así que la que cubría a `PanelVenta` se conserva acá:
    // su entrada SÍ es un DATEONLY y su copia sí sería la misma función.
    expect(leer('components/PanelVenta.jsx')).not.toMatch(/function\s+fechaCorta\b/)
  })

  it('HistorialDeCostos ya NO tiene su copia: ahora existe la compartida', () => {
    // Esta guardia decía lo contrario, y tenía razón: la copia de acá recibe un
    // timestamp CON hora —un instante real, que se muestra en la hora del
    // usuario— y la de `utils/formato.js` recibe un DATEONLY. Aplanarlas habría
    // movido un día una de las dos columnas, así que la duplicación quedó
    // anotada como deliberada.
    //
    // Lo que faltaba no era unificarlas: era que existiera **la segunda forma**.
    // `fechaCortaDeMomento` hace exactamente lo que hacía esta copia, y ahora
    // las dos viven en el mismo archivo, cada una con su motivo escrito.
    //
    // El defecto que lo destapó estaba en otro lado: una invitación creada a las
    // 22:00 mostraba un vencimiento del día SIGUIENTE, porque le aplicaba a un
    // instante la función que es correcta para un DATEONLY. Miente hacia
    // adelante, así que alguien iba a intentar usar un enlace ya muerto.
    expect(leer('components/HistorialDeCostos.jsx')).not.toMatch(/function\s+fechaCorta\b/)
  })

  it('y las dos formas siguen siendo dos, con su motivo escrito', () => {
    // Lo que la guardia anterior protegía sigue protegido, por el lado correcto:
    // que nadie las aplane. Si alguien borrara una de las dos, la otra correría
    // el día en la mitad de las pantallas.
    const fuente = leer('utils/formato.js')

    expect(fuente).toMatch(/export function fechaCorta\b/)
    expect(fuente).toMatch(/export function fechaCortaDeMomento\b/)
  })
})
