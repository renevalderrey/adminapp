// ════════════════════════════════════════════
//  ADMINAPP · Las reglas del Panel de control
//
//  El servidor manda **hechos** —`{ tipo, cantidad, alcance, ruta }`— y acá se
//  decide qué severidad tiene cada aviso, en qué orden van y qué dice cada uno.
//  Es a propósito y es FR-066: si el título viniera armado del servidor habría
//  dos escrituras del mismo texto, una acá y otra allá, y se separarían sin que
//  nada avise. Es exactamente lo que ya pasó con las alertas del Panel, que se
//  calculaban en `kpis.alerts` y se dibujaban desde `GET /api/alerts` con otro
//  criterio (hallazgo P11).
//
//  ── Por qué el alcance se dice en la pantalla y no se supone ──
//
//  Los avisos siguen el alcance de la pantalla a la que llevan: el de faltantes
//  es **de la sucursal activa**, porque `GET /api/faltantes` lo es. Los
//  indicadores de arriba son de toda la empresa. Con las dos cosas en la misma
//  pantalla y sin decirlo, el aviso diría 12, Faltantes mostraría 7, y no habría
//  forma de saber cuál creer (FR-057, FR-059).
//
//  ── Y por qué el sparkline se dibuja con divs ──
//
//  FR-069: sin librería de gráficos. Son doce barras de altura porcentual; una
//  dependencia nueva en el bundle para eso es cara y no se puede sacar después.
//  Lo único que hay que resolver bien es la escala, y esa es una función pura.
// ════════════════════════════════════════════

import { nombreDeRuta } from '@/components/navegacion'

/**
 * Qué tan urgente es cada aviso.
 *
 * `faltantes` y `sin_cae` son altos porque cuestan plata hoy: lo que no está no
 * se vende, y una venta que ARCA rechazó no tiene comprobante. Los otros dos
 * avisan de algo que **va a** pasar y todavía hay tiempo.
 */
const SEVERIDAD_POR_TIPO = {
  faltantes: 'alta',
  sin_cae: 'alta',
  vencimientos: 'media',
  certificado_afip: 'media',
}

/** Días de certificado por debajo de los cuales el aviso pasa a ser alto. */
const DIAS_CRITICOS_DEL_CERTIFICADO = 7

/** Las tres severidades, de más a menos urgente. Es el orden de la lista. */
const ORDEN_DE_SEVERIDAD = ['alta', 'media', 'baja']

/**
 * Las tres clases del badge de cada severidad, en un solo string.
 *
 * Las tres juntas —borde, fondo y texto— porque separadas se olvida una y el
 * badge queda con fondo de color y texto del color por defecto
 * (`REGLAS-DISENO.md`, «Badge de estado»).
 */
const TONOS_DE_SEVERIDAD = {
  alta: 'border-danger-line bg-danger-soft text-danger',
  media: 'border-warn-line bg-warn-soft text-warn',
  // Un aviso que no es urgente **no se pinta de gris**: sigue siendo algo que
  // hay que mirar. El azul informativo lo separa del ruido sin gritar.
  baja: 'border-info-line bg-info-soft text-info',
}

/**
 * La severidad de un aviso. **Nunca devuelve `undefined`.**
 *
 * Un tipo que esta versión de la pantalla no conoce —porque el servidor agregó
 * uno— cae en `media`: no se esconde y no grita. Devolver `undefined` haría que
 * `TONOS[severidad]` quedara vacío y el badge saliera sin ningún color, que es
 * cómo un aviso nuevo se vuelve invisible.
 */
export function severidadDeAviso(aviso) {
  if (!aviso || !aviso.tipo) return 'media'

  // El certificado escala solo: a una semana de vencer ya no hay margen para el
  // trámite en ARCA, así que deja de ser un recordatorio y pasa a ser urgente.
  if (aviso.tipo === 'certificado_afip') {
    return Number(aviso.dias) <= DIAS_CRITICOS_DEL_CERTIFICADO ? 'alta' : 'media'
  }

  return SEVERIDAD_POR_TIPO[aviso.tipo] || 'media'
}

/** Las tres clases del badge de un aviso. */
export function tonoDeAviso(aviso) {
  return TONOS_DE_SEVERIDAD[severidadDeAviso(aviso)] || TONOS_DE_SEVERIDAD.media
}

/**
 * Los avisos ordenados: primero los urgentes, y dentro de cada severidad el de
 * más casos.
 *
 * **No muta la entrada.** El arreglo viene del estado de React y ordenarlo en el
 * lugar es cómo una lista cambia sin que nadie haya pedido que cambie.
 *
 * El desempate por cantidad no es cosmético: con dos avisos altos, el que tiene
 * doce casos y el que tiene uno no son igual de urgentes, y sin desempate el
 * orden lo decide el que armó el arreglo del lado del servidor.
 */
export function ordenarAvisos(avisos) {
  const lista = Array.isArray(avisos) ? [...avisos] : []

  return lista.sort((a, b) => {
    const porSeveridad =
      ORDEN_DE_SEVERIDAD.indexOf(severidadDeAviso(a)) -
      ORDEN_DE_SEVERIDAD.indexOf(severidadDeAviso(b))

    if (porSeveridad !== 0) return porSeveridad

    return (Number(b?.cantidad) || 0) - (Number(a?.cantidad) || 0)
  })
}

/** «12 productos» / «1 producto», sin el «(s)» que nadie escribe a mano. */
function plural(cantidad, singular, pluralizado) {
  return `${cantidad} ${Number(cantidad) === 1 ? singular : pluralizado}`
}

/**
 * De dónde sale el número, dicho con palabras.
 *
 * Es la mitad de FR-059. La otra mitad es que el servidor mande el alcance de
 * verdad; acá lo único que se hace es no esconderlo.
 */
function textoDeAlcance(alcance) {
  return alcance === 'sucursal' ? 'en esta sucursal' : 'en toda la empresa'
}

/** Cuánto le queda al certificado, en castellano. */
function textoDelCertificado(dias) {
  const n = Number(dias)

  if (!Number.isFinite(n)) return 'El certificado de AFIP está por vencer'
  if (n < 0) return `El certificado de AFIP venció hace ${plural(Math.abs(n), 'día', 'días')}`
  if (n === 0) return 'El certificado de AFIP vence hoy'

  return `El certificado de AFIP vence en ${plural(n, 'día', 'días')}`
}

/**
 * Qué dice un aviso: el título, de dónde sale el número y qué botón lleva.
 *
 * Devuelve siempre las tres cosas. Un tipo desconocido se dibuja con lo que el
 * servidor mandó en vez de desaparecer: un aviso que la pantalla no sabe rotular
 * sigue siendo un aviso, y esconderlo es peor que rotularlo mal.
 */
/**
 * El botón del aviso, con el nombre REAL de la pantalla a la que lleva.
 *
 * ── Por qué no se escribe a mano ──
 *
 * El Panel tenía su propia idea de cómo se llaman las otras pantallas: «Ver
 * ventas» para `/ventas` —que en el menú es **Historial de ventas**—, «Ir a
 * Facturación» para `/facturacion` —que es **Facturación AFIP**—, y en otro
 * bloque «Historial completo» para esa misma ruta. Tres nombres para dos
 * pantallas.
 *
 * Alguien que lee «Ver ventas» y va a buscar esa pantalla en el menú no la
 * encuentra. El nombre de una pantalla es cómo se la busca.
 *
 * Sale de `nombreDeRuta`, o sea de la MISMA lista que dibuja la barra lateral,
 * así que un aviso nuevo no puede inventar un nombre: si la ruta está en el
 * menú, dice lo que dice el menú.
 */
function accionDelAviso(ruta) {
  const nombre = nombreDeRuta(ruta)

  // Una ruta que no está en el menú —o un aviso sin ruta— no se queda sin
  // botón: «Ver» es genérico pero no miente, que es lo que hacía el nombre
  // inventado.
  return nombre ? `Ir a ${nombre}` : 'Ver'
}

export function etiquetaDeAviso(aviso) {
  const cantidad = Number(aviso?.cantidad) || 0
  const alcance = textoDeAlcance(aviso?.alcance)
  const accion = accionDelAviso(aviso?.ruta)

  switch (aviso?.tipo) {
    case 'faltantes':
      return {
        titulo: `${plural(cantidad, 'producto', 'productos')} por debajo del mínimo`,
        alcance,
        accion,
      }

    case 'sin_cae':
      return {
        // ⚠ NO dice «sin CAE» a secas. El servidor cuenta las que AFIP
        // **rechazó** —las que tienen `afip_ultimo_error`—, no las ventas
        // internas que nadie quiso facturar. Rotularlo mal haría que alguien
        // fuera a buscar doscientas ventas que están bien.
        titulo: `${plural(cantidad, 'venta', 'ventas')} que AFIP rechazó y siguen sin comprobante`,
        alcance,
        accion,
      }

    case 'vencimientos':
      return {
        titulo: `${plural(cantidad, 'lote', 'lotes')} vencen dentro de ${aviso?.dias || 30} días`,
        alcance,
        accion,
      }

    case 'certificado_afip':
      return {
        titulo: textoDelCertificado(aviso?.dias),
        alcance: 'Sin certificado vigente no se puede facturar',
        accion,
      }

    default:
      return {
        titulo: cantidad > 0 ? `${cantidad} pendientes` : 'Hay algo para revisar',
        alcance,
        accion,
      }
  }
}

/** La barra más baja que se dibuja, en porcentaje: un cero tiene que verse. */
const ALTURA_MINIMA = 6

/**
 * Las alturas del sparkline, en porcentaje, una por punto.
 *
 * ── Por qué la base es el mínimo y no el cero ──
 *
 * El saldo de caja puede ser **negativo**. Escalando contra el máximo a secas,
 * un mes en −50.000 daría una altura negativa y el navegador la dibujaría como
 * cero: doce barras iguales para una serie que se hundió.
 *
 * La base es `min(0, mínimo)` y no el mínimo a secas para que una serie que
 * arranca en 100 y termina en 110 no se vea como un salto del 0 % al 100 %. Con
 * el cero adentro de la escala, el ojo lee la proporción real.
 *
 * ── Y las tres guardas ──
 *
 * Serie vacía, serie de un solo punto y serie toda en cero. Las tres existen: un
 * negocio nuevo, un mes con una sola venta, un mes sin movimiento. Sin la guarda
 * del rango cero, `(0 − 0) / (0 − 0)` es `NaN`, y un `height: NaN%` no dibuja
 * nada — la tarjeta queda con un hueco y nadie sabe si es un dato o un error.
 */
export function alturasDelSparkline(serie) {
  const puntos = (Array.isArray(serie) ? serie : [])
    .map((p) => (Number.isFinite(Number(p)) ? Number(p) : 0))

  if (!puntos.length) return []

  const base = Math.min(0, ...puntos)
  const maximo = Math.max(...puntos)
  const rango = maximo - base

  if (rango === 0) return puntos.map(() => ALTURA_MINIMA)

  return puntos.map((p) => {
    const proporcion = ((p - base) / rango) * 100

    return Math.max(ALTURA_MINIMA, Math.round(proporcion))
  })
}
