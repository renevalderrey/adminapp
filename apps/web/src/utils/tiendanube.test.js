import { describe, it, expect } from 'vitest'
import {
  ETIQUETAS_DE_CONEXION,
  ETIQUETAS_DE_MAPEO,
  ETIQUETAS_DE_MOTIVO,
  estadoDeLaConexion,
  estadoDeMapeo,
  etiquetaDeMotivo,
  filtrarVariantes,
  hayFiltro,
  resumenDeCorrida,
  tonoDeConexion,
  tonoDeMapeo,
} from './tiendanube'

// Cada `it` dice qué defecto evita, porque acá lo que se está protegiendo es
// una pantalla que hoy afirma cosas falsas: la tarjeta de `/facturacion` dice
// «no vinculada» cuando la llamada falla (`Settings.jsx:78`) y «sincronización
// bidireccional» sobre una integración que nunca descontó nada.

// ⚠ **La fixture tiene que poder distinguir el defecto**, que es donde este
// proyecto más se equivocó. Por eso el catálogo de prueba NO es «tres variantes
// todas mapeadas»: tiene una con acento en el nombre, una con SKU vacío, dos
// mapeadas y tres sin mapear, y **las mapeadas son la segunda y la cuarta** —con
// una sola mapeada, un filtro que devolviera la primera fila por casualidad
// pasaría igual—.
const CATALOGO = [
  {
    tiendanube_variant_id: 111,
    nombre_producto: 'Colágeno hidrolizado',
    nombre_variante: '300 g',
    sku: 'COL-300',
    en_la_tienda: true,
    mapeo: null,
    disponible: null,
    motivo_no_publicado: 'sin_stock_en_sucursal',
    pendiente_desde: null,
    ultimo_error: null,
  },
  {
    tiendanube_variant_id: 222,
    nombre_producto: 'Creatina monohidrato',
    nombre_variante: '300 g',
    sku: 'CRE-300',
    en_la_tienda: true,
    mapeo: { id: 12, product_id: 41, product_name: 'Creatina 300g', sku: 'CRE-300' },
    disponible: 7,
    motivo_no_publicado: null,
    pendiente_desde: null,
    ultimo_error: null,
  },
  {
    tiendanube_variant_id: 333,
    nombre_producto: 'Proteína de suero',
    nombre_variante: 'Vainilla 1 kg',
    // Una variante con SKU vacío: la sugerencia por SKU no puede proponer nada
    // y la búsqueda no puede romperse.
    sku: '',
    en_la_tienda: true,
    mapeo: null,
    disponible: null,
    motivo_no_publicado: null,
    pendiente_desde: null,
    ultimo_error: null,
  },
  {
    tiendanube_variant_id: 444,
    nombre_producto: 'Proteína de suero',
    nombre_variante: 'Chocolate 1 kg',
    sku: 'PRO-CHO-1K',
    en_la_tienda: true,
    mapeo: { id: 13, product_id: 42, product_name: 'Proteína chocolate 1kg', sku: 'PRO-CHO-1K' },
    disponible: 0,
    motivo_no_publicado: null,
    pendiente_desde: null,
    ultimo_error: null,
  },
  {
    tiendanube_variant_id: 555,
    nombre_producto: 'Barrita de maní',
    nombre_variante: 'Unidad',
    sku: 'BAR-MAN',
    en_la_tienda: true,
    mapeo: null,
    disponible: 12,
    motivo_no_publicado: null,
    pendiente_desde: null,
    ultimo_error: null,
  },
]

/** Una fila de variante mapeada y sana, para pisarle solo lo que cada caso mira. */
function mapeada(extra = {}) {
  return {
    tiendanube_variant_id: 999,
    nombre_producto: 'Colágeno hidrolizado',
    nombre_variante: '300 g',
    sku: 'COL-300',
    en_la_tienda: true,
    mapeo: { id: 12, product_id: 41, product_name: 'Colágeno 300g', sku: 'COL-300' },
    disponible: 7,
    motivo_no_publicado: null,
    pendiente_desde: null,
    ultimo_error: null,
    ...extra,
  }
}

// Las veintidós familias de la paleta de Tailwind con su escala, el mismo
// patrón que usa `tests/guardiasDeDiseno.test.js`. Un `text-red-500` es un
// `#ef4444` escrito de otra forma: un color que no existe en el sistema y que
// en modo oscuro queda igual que en claro.
const PALETA =
  /\b(?:text|bg|border|ring|from|via|to|fill|stroke|divide|accent|caret|placeholder|outline|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b/

describe('los cinco estados de la conexión', () => {
  // US1 escenario 9. Son dos problemas distintos con dos acciones distintas: al
  // servidor le falta `TIENDANUBE_CLIENT_ID` y **nadie puede conectar nada**,
  // contra una empresa que simplemente todavía no apretó el botón. Colapsarlos
  // deja a la primera con un botón «Conectar» que va a fallar siempre.
  it('«sin configurar en el servidor» NO es lo mismo que «no vinculada»', () => {
    const sinConfigurar = estadoDeLaConexion({ ok: true, estado: 'sin_configurar' })
    const noVinculada = estadoDeLaConexion({ ok: true, estado: 'no_vinculada' })

    expect(sinConfigurar).toBe('sin_configurar')
    expect(noVinculada).toBe('no_vinculada')
    expect(sinConfigurar).not.toBe(noVinculada)

    // Y no se pueden ver iguales tampoco: ni el texto ni el color.
    expect(ETIQUETAS_DE_CONEXION[sinConfigurar]).not.toBe(ETIQUETAS_DE_CONEXION[noVinculada])
    expect(tonoDeConexion(sinConfigurar)).not.toBe(tonoDeConexion(noVinculada))
  })

  // US1 escenario 10, y es el defecto que existe HOY: `Settings.jsx:78` hace
  // `console.error` y se queda con el booleano en `false`, así que una caída de
  // red se dibuja como «tu tienda no está conectada». El dueño vuelve a
  // vincular una tienda que ya estaba vinculada.
  it('un fallo de /status NO se muestra como «no vinculada»', () => {
    expect(estadoDeLaConexion(null)).toBe('no_comprobada')
    expect(estadoDeLaConexion(undefined)).toBe('no_comprobada')
    expect(estadoDeLaConexion({ ok: false, error: 'timeout' })).toBe('no_comprobada')

    // Un objeto de error de axios tampoco: no tiene `ok` ni `estado`.
    expect(estadoDeLaConexion(new Error('Network Error'))).toBe('no_comprobada')

    expect(estadoDeLaConexion(null)).not.toBe('no_vinculada')
  })

  // FR-006 y FR-049: «vinculada con error» quiere decir que el token dejó de
  // valer o que la última llamada falló, y la pantalla tiene que mandar a
  // volver a vincular. Un verde ahí es una tienda publicando números viejos.
  it('«vinculada con error» se distingue de «vinculada»', () => {
    const conError = estadoDeLaConexion({ ok: true, estado: 'vinculada_con_error' })
    const ok = estadoDeLaConexion({ ok: true, estado: 'vinculada' })

    expect(conError).toBe('vinculada_con_error')
    expect(ok).toBe('vinculada')
    expect(tonoDeConexion(conError)).not.toBe(tonoDeConexion(ok))
  })

  // Un estado que la pantalla no conoce —la API cambió, la respuesta vino
  // cortada— no puede leerse como «no está vinculada»: es «no sabemos».
  it('un estado que el contrato no tiene cae en «no se pudo comprobar», no en «no vinculada»', () => {
    expect(estadoDeLaConexion({ ok: true, estado: 'suspendida' })).toBe('no_comprobada')
    expect(estadoDeLaConexion({ ok: true })).toBe('no_comprobada')
  })

  it('los cinco estados tienen etiqueta, y ninguno más', () => {
    expect(Object.keys(ETIQUETAS_DE_CONEXION).sort()).toEqual([
      'no_comprobada',
      'no_vinculada',
      'sin_configurar',
      'vinculada',
      'vinculada_con_error',
    ])
  })
})

describe('los seis estados de una fila de variante', () => {
  // US3 escenario 11. La FK de `tiendanube_mappings` a `products` es
  // `ON DELETE CASCADE` (`20260606:31`), así que borrar el producto se lleva el
  // mapeo y la fila llega con `mapeo: null`. **Eso no es un error**: la
  // variante vuelve a «Sin mapear» y se puede volver a mapear. Un estado
  // «mapeo roto» sería una fila que la pantalla no puede dibujar porque no
  // existe.
  it('una variante mapeada a un producto que ya no existe no puede pasar por acá: el mapeo desapareció por CASCADE', () => {
    const estado = estadoDeMapeo(mapeada({ mapeo: null }))

    expect(estado).toBe('sin_mapear')
    expect(ETIQUETAS_DE_MAPEO[estado]).toBe('Sin mapear')
  })

  // La variante se borró en TiendaNube y el mapeo quedó colgado. Reintentar va
  // a fallar para siempre, así que no puede confundirse con «con error», que se
  // arregla solo cuando la API vuelve.
  it('una variante que ya no está en la tienda tiene su propio estado', () => {
    const estado = estadoDeMapeo(mapeada({ en_la_tienda: false }))

    expect(estado).toBe('fuera_de_la_tienda')
    expect(estado).not.toBe('con_error')
    expect(ETIQUETAS_DE_MAPEO[estado]).toBe('Ya no está en tu tienda')
  })

  // La causa gana sobre el síntoma: una variante borrada en la tienda deja
  // `ultimo_error` escrito en cada intento, y decir «con error» manda a esperar
  // un reintento que no puede funcionar nunca.
  it('«ya no está en la tienda» gana sobre «con error», porque es la causa', () => {
    expect(estadoDeMapeo(mapeada({ en_la_tienda: false, ultimo_error: '404 Not Found' })))
      .toBe('fuera_de_la_tienda')
  })

  // ⚠ FR-046 entero: `disponible: 0` es un dato —el producto está agotado y
  // publicar cero es lo correcto—, mientras que `disponible: null` es que **no
  // hay fila de stock** en la sucursal designada, y ahí publicar cero agota una
  // variante que sí tiene mercadería. Con `!disponible` los dos caerían juntos.
  it('disponible 0 es un dato y NO es «sin publicar»; disponible null sí lo es', () => {
    expect(estadoDeMapeo(mapeada({ disponible: 0 }))).toBe('mapeada')
    expect(estadoDeMapeo(mapeada({ disponible: null, motivo_no_publicado: null })))
      .toBe('sin_publicar')
    expect(estadoDeMapeo(mapeada({ disponible: 7, motivo_no_publicado: 'sin_stock_en_sucursal' })))
      .toBe('sin_publicar')
  })

  // Si el campo no vino —una respuesta vieja, un doble incompleto— no se puede
  // afirmar que la variante desapareció de la tienda. Decirlo sin saberlo manda
  // a rehacer un mapeo que estaba bien.
  it('sin el campo `en_la_tienda` NO se afirma que la variante desapareció', () => {
    const fila = mapeada()
    delete fila.en_la_tienda

    expect(estadoDeMapeo(fila)).toBe('mapeada')
  })

  it('una variante encolada dice que está pendiente, y no que está al día', () => {
    expect(estadoDeMapeo(mapeada({ pendiente_desde: '2026-08-12T09:44:10.000Z' })))
      .toBe('pendiente')
  })

  it('los seis estados tienen etiqueta, y ninguno más', () => {
    expect(Object.keys(ETIQUETAS_DE_MAPEO).sort()).toEqual([
      'con_error',
      'fuera_de_la_tienda',
      'mapeada',
      'pendiente',
      'sin_mapear',
      'sin_publicar',
    ])
  })
})

describe('los tonos de los badges', () => {
  const TODOS = [
    ...Object.keys(ETIQUETAS_DE_CONEXION).map((e) => ({ cual: `conexión·${e}`, tono: tonoDeConexion(e) })),
    ...Object.keys(ETIQUETAS_DE_MAPEO).map((e) => ({ cual: `mapeo·${e}`, tono: tonoDeMapeo(e) })),
  ]

  it.each(TODOS)('$cual trae las tres clases y ningún color suelto', ({ tono }) => {
    // Las tres van JUNTAS: texto de color sin fondo suave ni línea es
    // justamente «un color suelto», y se lee como un error de estilo.
    expect(tono).toMatch(/\bborder-\S+/)
    expect(tono).toMatch(/\bbg-\S+/)
    expect(tono).toMatch(/\btext-\S+/)

    expect(tono).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(tono).not.toMatch(PALETA)
    expect(tono).not.toMatch(/\bdark:/)
  })

  it('los cinco estados de la conexión NO comparten el mismo tono', () => {
    // Cinco badges iguales es no tener badge: el color es lo que se lee de
    // lejos, antes que el texto.
    const tonos = Object.keys(ETIQUETAS_DE_CONEXION).map(tonoDeConexion)

    expect(new Set(tonos).size).toBe(5)
  })

  it('los seis estados de mapeo usan cinco tonos: los dos rojos comparten a propósito', () => {
    const tonos = Object.keys(ETIQUETAS_DE_MAPEO).map(tonoDeMapeo)

    expect(new Set(tonos).size).toBe(5)
    // «Con error» y «ya no está en tu tienda» significan lo mismo para el ojo
    // —esta variante no se está publicando— y lo que las distingue es el texto.
    expect(tonoDeMapeo('con_error')).toBe(tonoDeMapeo('fuera_de_la_tienda'))
  })

  // Un `className` con `undefined` adentro deja el badge sin pintar y, según
  // dónde caiga, rompe la fila entera. Es el caso que un `switch` sin `default`
  // produce el día que alguien agrega un estado.
  it('ningún estado devuelve undefined, para ninguna entrada, ni null, ni {}', () => {
    for (const entrada of [undefined, null, '', {}, 0, 'inventado', NaN]) {
      expect(typeof tonoDeConexion(entrada)).toBe('string')
      expect(tonoDeConexion(entrada).length).toBeGreaterThan(0)

      expect(typeof tonoDeMapeo(entrada)).toBe('string')
      expect(tonoDeMapeo(entrada).length).toBeGreaterThan(0)

      expect(typeof estadoDeLaConexion(entrada)).toBe('string')
      expect(ETIQUETAS_DE_CONEXION[estadoDeLaConexion(entrada)]).toBeTruthy()
    }

    for (const entrada of [undefined, null, {}]) {
      expect(typeof estadoDeMapeo(entrada)).toBe('string')
      expect(ETIQUETAS_DE_MAPEO[estadoDeMapeo(entrada)]).toBeTruthy()
    }

    // Un estado desconocido cae en «no sabemos», que es lo honesto, y NO en el
    // neutro de «todavía no se conectó», que es un estado tranquilo.
    expect(tonoDeConexion('inventado')).toBe(tonoDeConexion('no_comprobada'))
  })
})

describe('los motivos por los que un ítem no descontó', () => {
  // Criterio 5 del lado de la pantalla. Hoy los cuatro son un `continue` en
  // silencio (`tiendanubeService.js:129,134,144`) y lo único que queda es que
  // el inventario está mal — que se descubre en un recuento físico tres meses
  // después, cuando ya no se puede reconstruir qué pasó.
  it('los cuatro motivos se leen en castellano y no como el código de la base', () => {
    for (const codigo of ['sin_mapeo', 'sin_stock_en_sucursal', 'sin_variante', 'cantidad_cero']) {
      const texto = etiquetaDeMotivo(codigo)

      expect(texto).toBe(ETIQUETAS_DE_MOTIVO[codigo])
      expect(texto).not.toContain('_')
      expect(texto.length).toBeGreaterThan(10)
    }
  })

  it('un motivo nuevo del servidor NO sale como código crudo', () => {
    const texto = etiquetaDeMotivo('variante_bloqueada')

    expect(texto).not.toContain('variante_bloqueada')
    expect(texto).not.toContain('_')
  })
})

describe('el resumen de la última corrida', () => {
  const EMPEZADA = '2026-08-12T09:31:00.000Z'
  const TERMINADA = '2026-08-12T09:31:47.000Z'

  function corrida(extra = {}) {
    return {
      id: 91,
      empezada_en: EMPEZADA,
      terminada_en: TERMINADA,
      disparador: 'manual',
      mandadas: 84,
      fallidas: 0,
      fallas: [],
      ...extra,
    }
  }

  // US5 escenario 2 y criterio 11. «84 actualizadas» y «84 actualizadas, 1 con
  // error» y «ninguna entró» son tres noticias distintas, y la del medio es la
  // que hoy no se puede dar: la primera variante que falla se lleva el conteo
  // (`controllers/tiendanube.js:197`).
  it('cero fallas, una falla y todas fallaron dicen cosas distintas', () => {
    const limpia = resumenDeCorrida(corrida({ mandadas: 84, fallidas: 0 }))
    const conUna = resumenDeCorrida(corrida({ mandadas: 84, fallidas: 1 }))
    const todas = resumenDeCorrida(corrida({ mandadas: 0, fallidas: 3 }))

    expect(new Set([limpia.titulo, conUna.titulo, todas.titulo]).size).toBe(3)
    expect(new Set([limpia.estado, conUna.estado, todas.estado]).size).toBe(3)
    expect(new Set([limpia.tono, conUna.tono, todas.tono]).size).toBe(3)

    // Y el conteo tiene que estar en el texto, no solo en el estado: es lo que
    // el dueño lee para saber si tiene que hacer algo.
    expect(limpia.titulo).toContain('84')
    expect(conUna.titulo).toContain('84')
    expect(conUna.titulo).toContain('1')
    expect(todas.titulo).toContain('3')
  })

  it('el singular no dice «1 variantes»', () => {
    expect(resumenDeCorrida(corrida({ mandadas: 1, fallidas: 0 })).titulo)
      .toBe('1 variante actualizada')
  })

  // US5 escenario 6: el proceso se cayó a la mitad. Lo que hay que decir no es
  // el conteo —quedó a medio escribir— sino que volver a apretar el botón es
  // seguro, porque el PUT manda el número absoluto y no una diferencia.
  it('una corrida sin terminada_en dice que quedó a medias', () => {
    const resumen = resumenDeCorrida(corrida({ terminada_en: null, mandadas: 40, fallidas: 0 }))

    expect(resumen.estado).toBe('a_medias')
    expect(resumen.titulo).not.toBe(resumenDeCorrida(corrida({ mandadas: 40 })).titulo)
    expect(resumen.detalle).toMatch(/seguro/i)
    // No se puede inventar cuánto tardó algo que no terminó.
    expect(resumen.duracion).toBeNull()
  })

  // «Nunca se sincronizó» y «se sincronizó y no había nada para mandar» son dos
  // problemas distintos: el primero es una tienda recién vinculada, el segundo
  // es una tienda sin ningún mapeo. Con el mismo texto se ven iguales.
  it('sin ninguna corrida se distingue de una corrida que mandó cero', () => {
    const nunca = resumenDeCorrida(null)
    const cero = resumenDeCorrida(corrida({ mandadas: 0, fallidas: 0 }))

    expect(nunca.estado).toBe('sin_corridas')
    expect(cero.estado).toBe('ok')
    expect(nunca.titulo).not.toBe(cero.titulo)
    expect(nunca.detalle).not.toBe(cero.detalle)
    expect(nunca.cuando).toBe('—')
  })

  // ⚠ Un contador que llegue como texto —un `COUNT` de Postgres vuelve como
  // string— hace que `fallidas === 0` sea `false`, y entonces una corrida
  // PERFECTA se anuncia como «con error». El estado más tranquilo se convierte
  // en el más alarmante sin que nada falle.
  it('un contador que llega como string NO convierte una corrida limpia en una con fallas', () => {
    const resumen = resumenDeCorrida(corrida({ mandadas: '84', fallidas: '0' }))

    expect(resumen.estado).toBe('ok')
    expect(resumen.titulo).toBe('84 variantes actualizadas')

    // Y los números que la pantalla dibuja son números, no las cadenas que
    // vinieron: `'84' + 1` es «841».
    expect(typeof resumen.mandadas).toBe('number')
    expect(typeof resumen.fallidas).toBe('number')
    expect(resumen.mandadas).toBe(84)
    expect(resumen.fallidas).toBe(0)
  })

  it('dice cuándo fue, cuánto tardó y quién la disparó, en castellano', () => {
    const manual = resumenDeCorrida(corrida())

    expect(manual.cuando).toBe('12/08/2026')
    expect(manual.duracion).toBe('47 s')
    expect(manual.disparador).toBe('A mano')

    const larga = resumenDeCorrida(corrida({ terminada_en: '2026-08-12T09:32:12.000Z' }))
    expect(larga.duracion).toBe('1 min 12 s')

    // US5 escenario 11: la automática se ve en el mismo lugar y se distingue.
    const auto = resumenDeCorrida(corrida({ disparador: 'reconciliacion' }))
    expect(auto.disparador).toBe('Reconciliación diaria')
    expect(auto.disparador).not.toBe(manual.disparador)
  })

  it('un disparador que la pantalla no conoce NO sale como código crudo', () => {
    expect(resumenDeCorrida(corrida({ disparador: 'webhook' })).disparador).toBe('—')
  })

  // La cola es la otra mitad y es la que contesta «qué está desfasado AHORA».
  // El empujón por movimiento de stock no escribe corridas, así que sin esto la
  // pantalla mostraría la última corrida de ayer sobre una cola con errores.
  it('la cola dice cuántas esperan y desde cuándo, y «todo al día» es distinto de «no hay cola»', () => {
    const conCola = resumenDeCorrida(corrida(), {
      pendientes: 2,
      con_error: 1,
      mas_vieja: '2026-08-12T09:44:10.000Z',
    })
    expect(conCola.cola).toContain('2 variantes esperando')
    expect(conCola.cola).toContain('12/08/2026')
    expect(conCola.cola).toContain('1 con error')

    const vacia = resumenDeCorrida(corrida(), { pendientes: 0, con_error: 0, mas_vieja: null })
    expect(vacia.cola).toBe('No hay ninguna variante esperando.')

    // Sin el dato, la pantalla no puede afirmar que no hay nada esperando.
    expect(resumenDeCorrida(corrida()).cola).toBeNull()
    expect(resumenDeCorrida(corrida(), { pendientes: '0', con_error: '0' }).cola)
      .toBe('No hay ninguna variante esperando.')
  })
})

describe('el filtro de la tabla de variantes', () => {
  // US3 escenario 13, y es lo que separa dos de los cuatro estados vacíos de
  // FR-055: «no hay resultados para lo que buscaste» —borrá el filtro— contra
  // «tu tienda no tiene productos» —cargalos en TiendaNube—. Con el mismo
  // texto, alguien va a buscar productos que están ahí.
  it('«solo sin mapear» con todo mapeado devuelve vacío, y eso NO es «no hay productos»', () => {
    const todasMapeadas = CATALOGO.map((v) => ({
      ...v,
      mapeo: { id: 1, product_id: 9, product_name: 'Alguno', sku: 'X' },
    }))

    const visibles = filtrarVariantes(todasMapeadas, { soloSinMapear: true })

    expect(visibles).toEqual([])
    // La lista SÍ tiene productos: lo que vació la tabla fue el filtro, y la
    // pantalla lo puede saber sin mirar el componente.
    expect(todasMapeadas.length).toBeGreaterThan(0)
    expect(hayFiltro({ soloSinMapear: true })).toBe(true)
    expect(hayFiltro({})).toBe(false)
  })

  // Sin la normalización, buscar «colageno» no encuentra «Colágeno
  // hidrolizado», que es como lo escribe cualquiera que no va a poner el acento
  // para filtrar una tabla: la pantalla diría que no hay resultados sobre un
  // catálogo que sí lo tiene.
  it('la búsqueda encuentra por nombre, por SKU y sin acentos', () => {
    const porNombre = filtrarVariantes(CATALOGO, { q: 'colageno' })
    expect(porNombre.map((v) => v.tiendanube_variant_id)).toEqual([111])

    const conAcento = filtrarVariantes(CATALOGO, { q: 'Colágeno' })
    expect(conAcento.map((v) => v.tiendanube_variant_id)).toEqual([111])

    // Por SKU, que es lo que la persona tiene en la mano cuando mapea.
    const porSku = filtrarVariantes(CATALOGO, { q: 'pro-cho' })
    expect(porSku.map((v) => v.tiendanube_variant_id)).toEqual([444])

    // Por nombre de variante: dos talles del mismo producto solo se distinguen
    // por ahí.
    const porVariante = filtrarVariantes(CATALOGO, { q: 'chocolate' })
    expect(porVariante.map((v) => v.tiendanube_variant_id)).toEqual([444])

    // Mayúsculas y espacios de sobra no cambian el resultado.
    expect(filtrarVariantes(CATALOGO, { q: '  CREATINA ' }).map((v) => v.tiendanube_variant_id))
      .toEqual([222])
  })

  // ⚠ Los filtros opcionales probados siempre por separado son una de las
  // trampas que este proyecto ya pisó. Con los dos puestos, la versión que
  // devuelve la unión en vez de la intersección pasa todos los casos de arriba
  // y en una tabla larga nadie lo nota.
  it('los dos filtros se aplican JUNTOS, no uno o el otro', () => {
    const visibles = filtrarVariantes(CATALOGO, { q: 'proteina', soloSinMapear: true })

    // «Proteína de suero» tiene dos variantes: la de vainilla sin mapear (333)
    // y la de chocolate mapeada (444). Con la unión saldrían las dos, más las
    // otras dos sin mapear del catálogo.
    expect(visibles.map((v) => v.tiendanube_variant_id)).toEqual([333])
  })

  it('sin filtro devuelve todo, y una lista vacía o ausente no rompe', () => {
    expect(filtrarVariantes(CATALOGO, {})).toHaveLength(CATALOGO.length)
    expect(filtrarVariantes(CATALOGO)).toHaveLength(CATALOGO.length)
    expect(filtrarVariantes(undefined, { q: 'algo' })).toEqual([])
    expect(filtrarVariantes([], { q: 'algo' })).toEqual([])
  })

  // La variante 333 tiene `sku: ''`. Si el vacío matcheara por ser vacío
  // —`''.includes(x)` no, pero `x.includes('')` sí, y es fácil invertir los dos
  // lados— saldría en TODAS las búsquedas y la tabla filtrada tendría siempre
  // una fila de más que nadie sabría explicar.
  it('un SKU vacío no matchea todo ni rompe la búsqueda', () => {
    expect(filtrarVariantes(CATALOGO, { q: 'creatina' }).map((v) => v.tiendanube_variant_id))
      .toEqual([222])
    expect(filtrarVariantes(CATALOGO, { q: 'zzz' })).toEqual([])

    // Y se la encuentra igual por lo que sí tiene: el nombre de la variante.
    expect(filtrarVariantes(CATALOGO, { q: 'vainilla' }).map((v) => v.tiendanube_variant_id))
      .toEqual([333])
  })

  // Si un `q` de solo espacios contara como filtro, escribir un espacio y
  // borrarlo dejaría la pantalla diciendo que el filtro no devolvió nada cuando
  // nadie filtró.
  it('un `q` de solo espacios NO cuenta como filtro', () => {
    expect(hayFiltro({ q: '   ' })).toBe(false)
    expect(filtrarVariantes(CATALOGO, { q: '   ' })).toHaveLength(CATALOGO.length)

    expect(hayFiltro({ q: 'col' })).toBe(true)
    expect(hayFiltro()).toBe(false)
  })
})
