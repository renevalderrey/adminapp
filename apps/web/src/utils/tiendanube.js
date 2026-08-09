// ════════════════════════════════════════════
//  FAVALIO · Las reglas de la pantalla de TiendaNube
//
//  Acá viven los estados, los tonos, el resumen de una corrida y el filtro de
//  variantes. **Ningún componente de `/tiendanube` calcula nada de esto**: un
//  test de render que verifica una regla es diez veces más lento y se pone en
//  rojo cuando alguien mueve un `<div>` —la regla no cambió y el test igual
//  quedó rojo—. El molde es `estadoVenta.js`, `inventario.js` y
//  `cuentaDeProveedor.js`.
//
//  ── El defecto que este archivo existe para evitar ──
//
//  `Settings.jsx:78` hace `console.error` cuando `GET /tiendanube/status`
//  falla, se queda con el booleano en `false` y la tarjeta dice **«no
//  vinculada»**. O sea: una empresa con la tienda conectada y una caída de red
//  se ven **idénticas**, y la que sale en pantalla es la mentira. FR-006 y US1
//  escenario 10 piden lo contrario, y por eso `estadoDeLaConexion` tiene un
//  quinto estado —`no_comprobada`— que **no existe en el contrato de la API**:
//  es de la pantalla, y es la diferencia entre «no sabemos» y «no está».
//
//  ── Por qué el estado de la conexión NO se recalcula acá ──
//
//  El servidor decide cuál de los cuatro es (`GET /status`, FR-006): es el
//  único que sabe si falta `TIENDANUBE_CLIENT_ID` y si la última comunicación
//  con la API de TiendaNube salió bien. Lo que esta función agrega es la lista
//  blanca: un `estado` que no está entre los cuatro —porque la API cambió,
//  porque la respuesta vino cortada, porque no hubo respuesta— cae en
//  `no_comprobada` y **nunca** en `no_vinculada`. Volver a decidir el estado
//  desde `ultima_comunicacion_ok` sería la segunda fuente de verdad de la misma
//  pregunta, y las dos se separan sin que nada avise.
//
//  ── Por qué los tonos traen las TRES clases juntas ──
//
//  `border-…-line`, `bg-…-soft` y `text-…` en un solo string, todas salidas de
//  los tokens de `index.css`. Un color de estado suelto sobre el fondo de la
//  tarjeta se lee como un error de estilo, y un hexadecimal o una clase de la
//  paleta de Tailwind —`text-blue-500`— es un color que el modo oscuro no
//  conoce. Se copia la forma de `tonoDeStock` (`utils/inventario.js:221`), no
//  la función: las clases del stock no son las del mapeo.
//
//  Y **ninguna devuelve `undefined`**: un `className` con `undefined` adentro
//  deja el badge sin pintar y, según dónde caiga, rompe la fila entera.
//
//  ── Por qué no se escribe una segunda función de fechas ──
//
//  `fechaCorta` de `utils/formato.js` es la única. El encabezado de ese archivo
//  cuenta cómo se llegó a tener siete funciones llamadas `pesos`; acá no se
//  empieza la octava.
// ════════════════════════════════════════════

import { fechaCorta } from '@/utils/formato'

// ────────────────────────────────────────────
//  El estado de la conexión
// ────────────────────────────────────────────

/**
 * Los cinco estados con su etiqueta.
 *
 * Los cuatro primeros son los de FR-006 y los decide el servidor; el quinto es
 * de la pantalla. Están junto a su texto para que agregar un sexto sin su
 * etiqueta sea imposible: el badge dibujaría el código crudo, que es lo que ya
 * pasó con `tc3` en los comprobantes.
 */
export const ETIQUETAS_DE_CONEXION = {
  sin_configurar: 'Sin configurar en el servidor',
  no_vinculada: 'Sin vincular',
  vinculada: 'Vinculada',
  vinculada_con_error: 'Vinculada, con error',
  no_comprobada: 'No se pudo comprobar',
}

/** Los cuatro que el servidor puede devolver. El quinto nunca viene de la API. */
const DEL_SERVIDOR = ['sin_configurar', 'no_vinculada', 'vinculada', 'vinculada_con_error']

const TONOS_DE_CONEXION = {
  vinculada: 'border-ok-line bg-ok-soft text-ok',
  // Rojo: el token dejó de valer o la última llamada falló. Hay que volver a
  // vincular, y eso es una acción, no un aviso (FR-049).
  vinculada_con_error: 'border-danger-line bg-danger-soft text-danger',
  // Neutro: todavía no se conectó. No es un error y no puede verse como uno,
  // porque es el estado normal de una empresa que recién empieza.
  no_vinculada: 'border-border bg-surface-3 text-fg-2',
  // Informativo: falta una variable de entorno del servidor. El usuario no lo
  // puede resolver desde la pantalla, así que pintarlo de rojo lo manda a
  // buscar un botón que no existe.
  sin_configurar: 'border-info-line bg-info-soft text-info',
  // Advertencia: no sabemos. Es distinto de las otras cuatro a propósito.
  no_comprobada: 'border-warn-line bg-warn-soft text-warn',
}

/**
 * Cuál de los cinco estados describe lo que contestó `GET /tiendanube/status`.
 *
 * @param {{ok?: boolean, estado?: string}|null|undefined} status La respuesta
 *   tal cual, o `null` / el error si la llamada no llegó a contestar.
 * @returns {'sin_configurar'|'no_vinculada'|'vinculada'|'vinculada_con_error'|'no_comprobada'}
 *
 * ⚠ **Todo lo que no sea uno de los cuatro del contrato cae en
 * `no_comprobada`, nunca en `no_vinculada`.** Es US1 escenario 10 y es el
 * defecto de hoy: con `status?.linked` en `false` por una caída de red, la
 * pantalla afirma que la tienda no está conectada y el dueño la vuelve a
 * vincular sobre una que ya estaba.
 */
export function estadoDeLaConexion(status) {
  if (!status || status.ok === false) return 'no_comprobada'

  return DEL_SERVIDOR.includes(status.estado) ? status.estado : 'no_comprobada'
}

/**
 * Las tres clases del badge de la conexión, en un solo string.
 *
 * Un código desconocido cae en `no_comprobada` —«no sabemos»— y **no** en el
 * tono neutro: un estado que la pantalla no reconoce no puede pintarse igual
 * que «todavía no se conectó», que es un estado tranquilo.
 */
export function tonoDeConexion(estado) {
  return TONOS_DE_CONEXION[estado] || TONOS_DE_CONEXION.no_comprobada
}

// ────────────────────────────────────────────
//  El estado de una fila de variante
// ────────────────────────────────────────────

/**
 * Los seis estados de una variante, con su etiqueta.
 *
 * La fila de la tabla es **por variante** (FR-052): la variante es la unidad
 * que tiene stock en TiendaNube, no el producto.
 */
export const ETIQUETAS_DE_MAPEO = {
  mapeada: 'Mapeada',
  pendiente: 'Pendiente de enviar',
  sin_publicar: 'Sin publicar',
  con_error: 'Con error',
  fuera_de_la_tienda: 'Ya no está en tu tienda',
  sin_mapear: 'Sin mapear',
}

const TONOS_DE_MAPEO = {
  mapeada: 'border-ok-line bg-ok-soft text-ok',
  // Informativo: está encolada y sale en segundos. No es un problema, y
  // pintarla de amarillo llenaría la tabla de advertencias que se apagan solas.
  pendiente: 'border-info-line bg-info-soft text-info',
  // Amarillo: hay stock que la tienda no conoce, pero nada está roto.
  sin_publicar: 'border-warn-line bg-warn-soft text-warn',
  // ⚠ Los dos rojos comparten tono **a propósito**: las dos significan «esta
  // variante no se está publicando y hace falta que alguien haga algo». Lo que
  // las distingue es la etiqueta, no el color.
  con_error: 'border-danger-line bg-danger-soft text-danger',
  fuera_de_la_tienda: 'border-danger-line bg-danger-soft text-danger',
  sin_mapear: 'border-border bg-surface-3 text-fg-2',
}

/**
 * Cómo está esta variante, mirando la fila que devuelve `GET /variantes`.
 *
 * @param {{mapeo?: object|null, en_la_tienda?: boolean, ultimo_error?: string|null,
 *          motivo_no_publicado?: string|null, disponible?: number|string|null,
 *          pendiente_desde?: string|null}|null|undefined} variante
 * @returns {'sin_mapear'|'fuera_de_la_tienda'|'con_error'|'sin_publicar'|'pendiente'|'mapeada'}
 *
 * **El orden de las condiciones es la regla y no se puede reordenar.**
 *
 * `sin_mapear` gana primero porque sin mapeo no hay nada más que decir: no hay
 * stock que publicar, no hay cola y no puede haber error. Es también donde cae
 * la variante cuyo **producto del sistema se borró del catálogo**: la FK es
 * `ON DELETE CASCADE` (`20260606:31`), así que el mapeo desaparece solo y la
 * fila llega con `mapeo: null`. **Eso no es un error** (US3 escenario 11) y por
 * eso no tiene un estado propio: la pantalla no puede mostrar una fila rota
 * porque una fila rota no existe.
 *
 * `fuera_de_la_tienda` gana sobre el error y sobre la cola porque es **la
 * causa**: la variante ya no está en TiendaNube, así que reintentar va a
 * fallar para siempre y lo que hay que hacer es volver a mapear, no esperar.
 */
export function estadoDeMapeo(variante) {
  const v = variante || {}

  if (!v.mapeo) return 'sin_mapear'

  // ⚠ `=== false` y no `!v.en_la_tienda`: si el campo no vino —una respuesta
  // vieja, un doble incompleto— no podemos afirmar que la variante desapareció
  // de la tienda. Decirlo sin saberlo manda a alguien a rehacer un mapeo que
  // estaba bien.
  if (v.en_la_tienda === false) return 'fuera_de_la_tienda'

  if (v.ultimo_error) return 'con_error'

  // ⚠ `== null` —no `!v.disponible`— y es la diferencia entera de FR-046.
  // `disponible: 0` es un dato: el producto está agotado y publicar cero es lo
  // correcto. `disponible: null` es la ausencia de la fila de stock en la
  // sucursal designada, y ahí publicar cero **agota una variante que sí tiene
  // mercadería**. Con `!v.disponible` las dos caerían en el mismo lugar.
  if (v.motivo_no_publicado || v.disponible == null) return 'sin_publicar'

  if (v.pendiente_desde) return 'pendiente'

  return 'mapeada'
}

/**
 * Las tres clases del badge de una fila, en un solo string.
 *
 * Un código desconocido cae en el neutro de `sin_mapear`, que es el estado «no
 * hay nada que informar» de esta tabla.
 */
export function tonoDeMapeo(estado) {
  return TONOS_DE_MAPEO[estado] || TONOS_DE_MAPEO.sin_mapear
}

// ────────────────────────────────────────────
//  Los motivos por los que algo no se descontó ni se publicó
// ────────────────────────────────────────────

/**
 * Los cuatro motivos de la base, en castellano.
 *
 * Son los que escribe el webhook en `pedido.items` cuando un ítem **no
 * descuenta** (FR-027) y el que escribe la sincronización en
 * `motivo_no_publicado` cuando una variante **no se manda** (FR-046). Hoy los
 * cuatro son un `continue` en silencio (`tiendanubeService.js:129,134,144`) y
 * lo único que queda es que el inventario está mal — que se descubre en un
 * recuento físico tres meses después, cuando ya no se puede reconstruir nada.
 */
export const ETIQUETAS_DE_MOTIVO = {
  sin_mapeo: 'La variante no está mapeada a ningún producto',
  sin_stock_en_sucursal: 'El producto no tiene stock en la sucursal de la tienda',
  sin_variante: 'El ítem del pedido no traía variante',
  cantidad_cero: 'El ítem vino con cantidad cero',
}

/**
 * El motivo en castellano, nunca el código de la base.
 *
 * Un motivo nuevo del servidor cae en un texto genérico y **no** en
 * `sin_stock_en_sucursal` crudo: un código de base en la pantalla se lee como
 * un error del sistema y manda a abrir un ticket por algo que está funcionando.
 */
export function etiquetaDeMotivo(codigo) {
  return ETIQUETAS_DE_MOTIVO[codigo] || 'No se pudo descontar'
}

// ────────────────────────────────────────────
//  El resumen de la última corrida
// ────────────────────────────────────────────

const TONOS_DE_CORRIDA = {
  ok: 'border-ok-line bg-ok-soft text-ok',
  con_fallas: 'border-warn-line bg-warn-soft text-warn',
  a_medias: 'border-warn-line bg-warn-soft text-warn',
  todo_fallo: 'border-danger-line bg-danger-soft text-danger',
  sin_corridas: 'border-border bg-surface-3 text-fg-2',
}

const DISPARADORES = {
  manual: 'A mano',
  reconciliacion: 'Reconciliación diaria',
}

/**
 * Un contador con su sustantivo en singular o en plural.
 *
 * «1 variantes actualizadas» es el detalle que hace que un texto generado se
 * lea como generado, y esta línea es lo primero que mira alguien que quiere
 * saber si la tienda está al día.
 */
function contar(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * Un entero que puede llegar como texto.
 *
 * ⚠ **No es defensivo de más.** Un contador que llegue como `'0'` —un `COUNT`
 * de Postgres vuelve como string, y un JSON armado a mano también puede— hace
 * que `fallidas === 0` sea `false`, y entonces una corrida **perfecta** se
 * anuncia como «con error». El estado más tranquilo se convierte en el más
 * alarmante sin que nada falle.
 */
function entero(valor) {
  return Number(valor) || 0
}

/**
 * Cuánto tardó, legible: «47 s», «1 min 12 s», «2 h 5 min».
 *
 * ⚠ Acá sí se usa `new Date()`, y es correcto: `empezada_en` y `terminada_en`
 * son timestamps ISO completos con zona, no los `DATEONLY` por los que
 * `fechaCorta` evita `Date` (ver el encabezado de `utils/formato.js`).
 *
 * Una diferencia negativa —relojes desfasados, dato roto— devuelve `null` en
 * vez de «-3 s»: un número imposible en pantalla manda a revisar el servidor.
 */
function duracionLegible(desde, hasta) {
  if (!desde || !hasta) return null

  const ms = new Date(hasta).getTime() - new Date(desde).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null

  const segundos = Math.round(ms / 1000)
  if (segundos < 60) return `${segundos} s`

  const minutos = Math.floor(segundos / 60)
  const resto = segundos % 60
  if (minutos < 60) return resto ? `${minutos} min ${resto} s` : `${minutos} min`

  const horas = Math.floor(minutos / 60)
  const restoMin = minutos % 60

  return restoMin ? `${horas} h ${restoMin} min` : `${horas} h`
}

/**
 * El texto de la cola: qué está desfasado **ahora**.
 *
 * Es la otra mitad del bloque, y es más útil que el registro de un lote: el
 * empujón por movimiento de stock no escribe corridas —serían cientos de filas
 * diarias que nadie lee— y su estado vive en la fila de cada variante.
 */
function textoDeCola(cola) {
  if (!cola) return null

  const pendientes = entero(cola.pendientes)
  const conError = entero(cola.con_error)

  if (pendientes === 0 && conError === 0) return 'No hay ninguna variante esperando.'

  const partes = []
  if (pendientes > 0) {
    const desde = cola.mas_vieja ? ` desde el ${fechaCorta(cola.mas_vieja)}` : ''
    partes.push(`${contar(pendientes, 'variante esperando', 'variantes esperando')}${desde}`)
  }
  if (conError > 0) partes.push(`${conError} con error`)

  return `${partes.join(', ')}.`
}

/**
 * El resumen legible de la última corrida de sincronización (FR-042, FR-043).
 *
 * @param {{empezada_en?: string, terminada_en?: string|null, disparador?: string,
 *          mandadas?: number|string, fallidas?: number|string, fallas?: Array}|null|undefined} corrida
 *   La fila de `tiendanube_corridas`, o `null` si nunca corrió ninguna.
 * @param {{pendientes?: number|string, con_error?: number|string, mas_vieja?: string|null}|null|undefined} cola
 *
 * ⚠ **«Hay una sincronización corriendo ahora» NO se contesta acá.** Eso es
 * `tienda.sincronizando` de `GET /status` —un booleano que manda el servidor,
 * que es el único que ve el arriendo de `sincronizando_desde`— y no una regla
 * que se pueda deducir de esta fila: una corrida en curso y una que se cortó
 * por la mitad tienen las dos `terminada_en` en `null`. Deducirlo de acá diría
 * «quedó a medias» de una corrida que está andando bien.
 */
export function resumenDeCorrida(corrida, cola) {
  const base = {
    duracion: null,
    disparador: '—',
    mandadas: 0,
    fallidas: 0,
    cola: textoDeCola(cola),
  }

  // Nunca corrió ninguna. Es distinto de una corrida que mandó cero: la
  // primera dice «no lo intentamos», la segunda «lo intentamos y no había
  // nada». Con el mismo texto, una tienda recién vinculada y una tienda sin
  // ningún mapeo se ven iguales, y son dos problemas distintos.
  if (!corrida) {
    return {
      ...base,
      estado: 'sin_corridas',
      titulo: 'Todavía no se sincronizó ninguna vez',
      detalle: 'No corrió ninguna sincronización de stock desde esta empresa.',
      cuando: '—',
      tono: TONOS_DE_CORRIDA.sin_corridas,
    }
  }

  const mandadas = entero(corrida.mandadas)
  const fallidas = entero(corrida.fallidas)

  const comun = {
    ...base,
    duracion: duracionLegible(corrida.empezada_en, corrida.terminada_en),
    disparador: DISPARADORES[corrida.disparador] || '—',
    mandadas,
    fallidas,
    cuando: fechaCorta(corrida.terminada_en || corrida.empezada_en),
  }

  // US5 escenario 6: el proceso se cayó, la red se cortó. Lo que hay que decir
  // no es cuántas entraron —el conteo quedó a medio escribir— sino que se puede
  // volver a apretar el botón sin miedo, porque el PUT manda el número
  // absoluto y no una diferencia (FR-045).
  if (!corrida.terminada_en) {
    return {
      ...comun,
      estado: 'a_medias',
      titulo: 'La última sincronización quedó a medias',
      detalle:
        'Se cortó antes de terminar. Volver a sincronizar es seguro: se manda el stock actual de cada variante, no una diferencia.',
      tono: TONOS_DE_CORRIDA.a_medias,
    }
  }

  if (fallidas === 0) {
    // «No se mandó ninguna variante» no es lo mismo que «todavía no se
    // sincronizó»: acá la corrida existió y no encontró nada para mandar.
    const titulo =
      mandadas === 0
        ? 'No se mandó ninguna variante'
        : contar(mandadas, 'variante actualizada', 'variantes actualizadas')

    return {
      ...comun,
      estado: 'ok',
      titulo,
      detalle:
        mandadas === 0
          ? 'La corrida terminó sin nada que mandar: no hay mapeos, o ninguno estaba desfasado.'
          : 'Terminó sin errores.',
      tono: TONOS_DE_CORRIDA.ok,
    }
  }

  // Todas fallaron. Casi siempre es una sola causa —el token dejó de valer, la
  // API no contesta— y por eso se dice distinto: «84 actualizadas, 3 con error»
  // se lee como un detalle, y «ninguna entró» se lee como lo que es.
  if (mandadas === 0) {
    return {
      ...comun,
      estado: 'todo_fallo',
      titulo: `Ninguna variante se pudo actualizar: ${fallidas} con error`,
      detalle: 'Ninguna llegó a la tienda. Mirá el motivo de las primeras: suele ser el mismo para todas.',
      tono: TONOS_DE_CORRIDA.todo_fallo,
    }
  }

  return {
    ...comun,
    estado: 'con_fallas',
    titulo: `${contar(mandadas, 'variante actualizada', 'variantes actualizadas')}, ${fallidas} con error`,
    detalle: 'Las que fallaron están abajo con su motivo. Las demás se mandaron igual.',
    tono: TONOS_DE_CORRIDA.con_fallas,
  }
}

// ────────────────────────────────────────────
//  El filtro de la tabla de variantes
// ────────────────────────────────────────────

/**
 * Un texto comparable: sin acentos, sin mayúsculas y sin espacios de sobra.
 *
 * Sin la normalización, buscar «colageno» no encuentra «Colágeno hidrolizado»,
 * que es como lo escribe cualquiera que no vaya a poner el acento para filtrar
 * una tabla. El resultado sería un estado vacío que dice «el filtro no devolvió
 * nada» sobre un catálogo que sí lo tiene.
 */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * ¿Hay algún filtro puesto?
 *
 * **Es lo que separa dos de los cuatro estados vacíos de FR-055**: una tabla
 * vacía con filtro dice «no hay resultados para lo que buscaste» y una tabla
 * vacía sin filtro dice «tu tienda no tiene productos». Son dos problemas
 * distintos y la acción que sugiere cada uno es distinta —borrar el filtro
 * contra cargar productos en TiendaNube—.
 *
 * Un `q` de solo espacios **no** cuenta como filtro: si contara, escribir un
 * espacio y borrarlo dejaría la pantalla diciendo que el filtro no devolvió
 * nada cuando nadie filtró.
 */
export function hayFiltro({ q, soloSinMapear } = {}) {
  return normalizar(q).length > 0 || Boolean(soloSinMapear)
}

/**
 * Las variantes que quedan después del filtro (FR-059).
 *
 * @param {Array<object>} variantes Las filas de `GET /variantes`.
 * @param {{q?: string, soloSinMapear?: boolean}} filtros
 *
 * Los dos filtros se aplican **juntos**: «solo sin mapear» + «colageno» tiene
 * que devolver las de colágeno que además no están mapeadas. Probar cada uno
 * por separado deja pasar la versión que devuelve la unión en vez de la
 * intersección, y en una tabla larga eso no se nota mirando.
 *
 * La búsqueda mira nombre de producto, nombre de variante **y SKU**: el SKU es
 * lo que la persona tiene en la mano cuando está mapeando, y es lo único que
 * distingue dos variantes de talle del mismo producto.
 */
export function filtrarVariantes(variantes, { q, soloSinMapear } = {}) {
  const buscado = normalizar(q)

  return (variantes || []).filter((v) => {
    // `!v.mapeo` cubre `null` y la ausencia del campo. Una variante mapeada
    // tiene el objeto entero (`GET /variantes` lo une en JS, sin `include`).
    if (soloSinMapear && v?.mapeo) return false

    if (!buscado) return true

    return (
      normalizar(v?.nombre_producto).includes(buscado) ||
      normalizar(v?.nombre_variante).includes(buscado) ||
      normalizar(v?.sku).includes(buscado)
    )
  })
}
