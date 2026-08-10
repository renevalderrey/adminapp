import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ESTADOS,
  ETIQUETAS_DE_ESTADO,
  tonoDeCatalogo,
  etiquetaDeEstado,
  llevaAlgunLado,
  normalizarSlug,
  validarSlug,
  RESERVADOS,
  urlDelCatalogo,
  urlDelQr,
  BASE_DE_LA_TIENDA,
  MARCA_POR_DEFECTO,
  TEXTO_OSCURO,
  TEXTO_CLARO,
  colorDeMarca,
  textoSobre,
  estiloDePrevisualizacion,
  AMBITOS,
  ESPECIFICIDAD,
  sangriaDeAmbito,
  ordenarPorEspecificidad,
  ETIQUETAS_DE_AMBITO,
  ETIQUETAS_DE_TIPO,
  TIPOS,
  textoDeValor,
  textoDeCobertura,
  esReglaSinEfecto,
  etiquetaDeAviso,
  tituloDeRequisito,
} from '@/utils/catalogos'

// ════════════════════════════════════════════
//  FAVALIO · Lo que la pantalla de Catálogos decide sin dibujar
//
//  Todo lo de acá es una función pura y por eso se prueba acá y no montando la
//  pantalla: un test de render que verificara «el badge de un pausado no es el
//  de un publicado» tardaría diez veces más y se rompería el día que alguien
//  mueve un `<div>` sin cambiar ninguna regla.
// ════════════════════════════════════════════

describe('El badge de estado de un catálogo', () => {
  it('un catálogo pausado no se dibuja con el mismo tono que uno publicado', () => {
    // El caso que motiva el archivo. `pausado` y `publicado` son dos cosas
    // distintas para quien tiene el QR pegado en la pared: uno vende y el otro
    // muestra el cartel de «volvemos pronto». Con el mismo tono, el comercio no
    // tiene cómo ver de un vistazo cuál de sus tres catálogos está frenado.
    expect(tonoDeCatalogo('pausado')).not.toBe(tonoDeCatalogo('publicado'))
    expect(tonoDeCatalogo('borrador')).not.toBe(tonoDeCatalogo('publicado'))
    expect(tonoDeCatalogo('borrador')).not.toBe(tonoDeCatalogo('pausado'))

    // Y los tres son tonos DISTINTOS entre sí, no dos iguales y uno diferente.
    expect(new Set(ESTADOS.map(tonoDeCatalogo)).size).toBe(3)
  })

  it('cada tono trae las TRES clases juntas: línea, fondo y texto', () => {
    // Un color de estado suelto sobre el fondo de la tarjeta se lee como un
    // error de estilo, no como un estado (`REGLAS-DISENO.md` → «Estados»).
    for (const estado of ESTADOS) {
      const tono = tonoDeCatalogo(estado)

      expect(tono).toMatch(/\bborder-/)
      expect(tono).toMatch(/\bbg-/)
      expect(tono).toMatch(/\btext-/)
    }
  })

  it('un estado desconocido cae en el neutro y NO devuelve undefined', () => {
    // Un badge sin pintar es un defecto visible; un `className` con `undefined`
    // adentro es una fila rota.
    expect(tonoDeCatalogo('marciano')).toBe(tonoDeCatalogo('borrador'))
    expect(tonoDeCatalogo(undefined)).toBe(tonoDeCatalogo('borrador'))
    expect(etiquetaDeEstado('marciano')).toBe('Borrador')
  })

  it('son exactamente tres estados y los tres tienen etiqueta (FR-054)', () => {
    // Las etiquetas van al lado de los tonos y con las mismas claves: agregar un
    // cuarto estado sin su etiqueta tiene que ser imposible, o el badge dibuja
    // el código crudo — que es lo que ya pasó con `tc3` en los comprobantes.
    expect(ESTADOS).toEqual(['borrador', 'publicado', 'pausado'])
    expect(Object.keys(ETIQUETAS_DE_ESTADO).sort()).toEqual([...ESTADOS].sort())
    for (const estado of ESTADOS) expect(etiquetaDeEstado(estado)).not.toBe(estado)
  })

  it('sólo el borrador NO lleva a ningún lado', () => {
    // `pausado` contesta 200 y dibuja el cartel de pausa: quien escanea llega al
    // lugar correcto. `borrador` contesta el mismo 404 que un slug inventado.
    expect(llevaAlgunLado('publicado')).toBe(true)
    expect(llevaAlgunLado('pausado')).toBe(true)
    expect(llevaAlgunLado('borrador')).toBe(false)
  })
})

describe('El slug que propone el formulario', () => {
  it('«Comprafít / Fitnet» da `comprafit-fitnet`, sin guiones repetidos', () => {
    // El caso exacto por el que existe el colapso de guiones: espacio, barra,
    // espacio. Sin él sale `comprafit---fitnet` y el panel muestra una dirección
    // mientras el servidor guarda otra.
    expect(normalizarSlug('Comprafít / Fitnet')).toBe('comprafit-fitnet')
  })

  it('saca la tilde de la ñ: un slug tiene que poder dictarse por teléfono', () => {
    expect(normalizarSlug('Niño')).toBe('nino')
  })

  it('no deja guiones en los bordes', () => {
    expect(normalizarSlug('  -- Hola Mundo -- ')).toBe('hola-mundo')
  })

  it('normalizar no es validar: puede quedar vacío', () => {
    expect(normalizarSlug('///')).toBe('')
    expect(normalizarSlug(null)).toBe('')
    expect(validarSlug('').ok).toBe(false)
  })

  it('los reservados se rechazan ANTES que el largo', () => {
    // `c` mide un carácter. Con el largo primero, el motivo sería «entre 3 y 60
    // caracteres» y quien lo lea probaría con `cc` sin enterarse nunca de que el
    // problema real es que `c` es el prefijo de la propia URL pública.
    const motivo = validarSlug('c').motivo

    expect(validarSlug('c').ok).toBe(false)
    expect(motivo).toContain('reservada')
    expect(motivo).not.toContain('caracteres')
  })

  it('valida exactamente lo que recibe: no recorta ni baja a minúsculas', () => {
    // Es la última puerta antes de mandar. Si acá se arreglara la entrada en
    // silencio, `Comprafit` pasaría y se propondría un slug que `normalizarSlug`
    // nunca habría producido — o sea, distinto del que se va a guardar.
    expect(validarSlug('Comprafit').ok).toBe(false)
    expect(validarSlug(' comprafit ').ok).toBe(false)
    expect(validarSlug('comprafit--fitnet').ok).toBe(false)
    expect(validarSlug('comprafit-fitnet').ok).toBe(true)
  })

  it('los nueve reservados incluyen los seis que nombra FR-052', () => {
    for (const nombre of ['c', 'api', 'assets', 'admin', 'robots.txt', 'favicon.ico']) {
      expect(RESERVADOS).toContain(nombre)
    }
  })
})

describe('La dirección pública que se copia y se imprime', () => {
  it('el enlace lleva el protocolo: sin él WhatsApp no lo convierte en enlace', () => {
    expect(urlDelCatalogo('comprafit-fitnet')).toBe(`${BASE_DE_LA_TIENDA}/c/comprafit-fitnet`)
    expect(urlDelCatalogo('comprafit-fitnet')).toMatch(/^https?:\/\//)
  })

  it('el enlace se arma con el slug NORMALIZADO', () => {
    // Es la misma garantía del formulario, aplicada a la dirección que se pega
    // en WhatsApp: lo que se copia tiene que ser lo que el servidor va a buscar.
    expect(urlDelCatalogo('Comprafít / Fitnet')).toBe(urlDelCatalogo('comprafit-fitnet'))
  })

  it('la URL del QR lleva el parámetro de origen', () => {
    // Sin `?f=qr` no hay forma de separar las visitas que llegaron por el cartel
    // de las que llegaron por WhatsApp, y la pestaña de métricas mostraría el
    // total del catálogo llamándolo «escaneos».
    expect(urlDelQr('comprafit-fitnet')).toBe(`${urlDelCatalogo('comprafit-fitnet')}?f=qr`)
    expect(urlDelQr('comprafit-fitnet')).toContain('?f=qr')
  })
})

describe('El color de marca y el texto que va encima (FR-060)', () => {
  it('un color inválido cae en el turquesa y nunca en una cadena cruda', () => {
    // Lo que sale de acá entra a una propiedad CSS. Sin la validación, el
    // contenido de una columna elegiría qué declara la hoja de estilos.
    expect(colorDeMarca('rojo furioso')).toBe(MARCA_POR_DEFECTO.toLowerCase())
    expect(colorDeMarca(null)).toBe(MARCA_POR_DEFECTO.toLowerCase())
    expect(colorDeMarca('#ABC')).toBe('#aabbcc')
  })

  it('el texto se calcula por contraste y NO devuelve siempre lo mismo', () => {
    // El par junto es lo que hace al test: una función que devolviera el mismo
    // color para los dos casos pasaría cualquier afirmación suelta.
    expect(textoSobre('#FFFF00')).toBe(TEXTO_OSCURO)
    expect(textoSobre('#101418')).toBe(TEXTO_CLARO)
    expect(textoSobre('#FFFF00')).not.toBe(textoSobre('#101418'))
  })

  it('la previsualización usa el color en la portada y en el botón, y nada más', () => {
    const estilo = estiloDePrevisualizacion('#101418')

    expect(estilo.marca).toBe('#101418')
    expect(estilo.textoSobreLaMarca).toBe(TEXTO_CLARO)
    expect(estilo.portada).toContain('#101418')
    // El papel de la tarjeta NO se tiñe: `brand` nunca es fondo de una zona
    // grande, ni en la tienda ni en el panel.
    expect(estilo.papel).not.toBe(estilo.marca)
  })
})

// ════════════════════════════════════════════
//  La copia de `apps/tienda/src/tema.js`, atada por texto
//
//  `apps/web` no puede importar de `apps/tienda`. La guardia es la misma que la
//  del slug y por el mismo motivo: si las dos `textoSobre` se separan, el panel
//  le muestra al comercio un botón con texto blanco y la tienda se lo dibuja con
//  texto oscuro. La previsualización deja de previsualizar y nadie se entera.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))

const TEMA_DE_LA_TIENDA = fs.readFileSync(
  path.join(AQUI, '../../../tienda/src/tema.js'),
  'utf8'
)

describe('El color de la previsualización no se separó del de la tienda', () => {
  it('la lectura del archivo de la tienda encontró algo: no pasa por leer vacío', () => {
    // Una guardia que lee con la ruta equivocada compara dos vacíos y pasa
    // siempre. Si el archivo se mueve, esto falla acá y no en silencio.
    expect(TEMA_DE_LA_TIENDA.length).toBeGreaterThan(1000)
    expect(TEMA_DE_LA_TIENDA).toContain('export function textoSobre')
  })

  it('los tres colores son los mismos de los dos lados', () => {
    const leer = (nombre) =>
      TEMA_DE_LA_TIENDA.match(new RegExp(`export const ${nombre} = '([^']+)'`))?.[1]

    expect(leer('MARCA_POR_DEFECTO')).toBe(MARCA_POR_DEFECTO)
    expect(leer('TEXTO_OSCURO')).toBe(TEXTO_OSCURO)
    expect(leer('TEXTO_CLARO')).toBe(TEXTO_CLARO)
  })

  it('las dos deciden comparando contrastes, no con un umbral', () => {
    // La tienda documenta por qué el umbral de la maqueta estaba mal calibrado.
    // Si alguien vuelve a un `L > 0.45` de un solo lado, las dos funciones
    // empiezan a contestar distinto para los colores del medio.
    expect(TEMA_DE_LA_TIENDA).toMatch(/conOscuro\s*>=\s*conClaro/)
  })
})

describe('Las reglas de precio, del lado del dibujo', () => {
  it('la sangría crece con la especificidad y el catálogo entero no se sangra', () => {
    // Es lo que hace visible «gana la más específica»: con las cuatro filas al
    // mismo margen, esa regla hay que leerla en un manual.
    expect(sangriaDeAmbito('catalogo')).toBe(0)
    expect(sangriaDeAmbito('categoria')).toBeGreaterThan(sangriaDeAmbito('catalogo'))
    expect(sangriaDeAmbito('marca')).toBeGreaterThan(sangriaDeAmbito('categoria'))
    expect(sangriaDeAmbito('producto')).toBeGreaterThan(sangriaDeAmbito('marca'))
  })

  it('un ámbito desconocido no sangra en NaN', () => {
    expect(sangriaDeAmbito('marciano')).toBe(0)
  })

  it('las reglas se ordenan de la más general a la más específica', () => {
    const reglas = [
      { id: 4, ambito: 'producto' },
      { id: 1, ambito: 'catalogo' },
      { id: 3, ambito: 'marca' },
      { id: 2, ambito: 'categoria' },
    ]

    expect(ordenarPorEspecificidad(reglas).map((r) => r.ambito)).toEqual([
      'catalogo', 'categoria', 'marca', 'producto',
    ])
  })

  it('ordenar no muta el arreglo que recibe', () => {
    // La lista viene del estado de React: ordenarla en el lugar es una mutación
    // que no dispara un render y deja la pantalla mostrando el orden viejo.
    const reglas = [{ id: 2, ambito: 'producto' }, { id: 1, ambito: 'catalogo' }]
    ordenarPorEspecificidad(reglas)

    expect(reglas.map((r) => r.id)).toEqual([2, 1])
  })

  it('los cuatro ámbitos y los tres tipos tienen etiqueta', () => {
    expect(AMBITOS).toEqual(['catalogo', 'categoria', 'marca', 'producto'])
    expect(Object.keys(ESPECIFICIDAD).sort()).toEqual([...AMBITOS].sort())
    for (const ambito of AMBITOS) expect(ETIQUETAS_DE_AMBITO[ambito]).toBeTruthy()
    for (const tipo of TIPOS) expect(ETIQUETAS_DE_TIPO[tipo]).toBeTruthy()
  })

  it('el valor se lee con su unidad: un 12 sin nada al lado no dice nada', () => {
    expect(textoDeValor({ tipo: 'porcentaje_descuento', valor: 12 })).toBe('12 %')
    expect(textoDeValor({ tipo: 'monto_descuento', valor: 1500 })).toBe('$1.500')
    expect(textoDeValor({ tipo: 'precio_fijo', valor: 9900 })).toBe('$9.900')
  })

  it('«Gana en» dice los DOS números', () => {
    // El de la izquierda solo no cuenta la historia: una regla de catálogo que
    // alcanza a ocho y gana en cuatro es una a la que otras cuatro más
    // específicas le pisaron la mitad.
    expect(textoDeCobertura({ alcanza: 8, gana: 4 })).toBe('4 de 8')
    expect(textoDeCobertura(undefined)).toBe('0 de 0')
  })

  it('una regla huérfana se reconoce por su cobertura y no desaparece', () => {
    expect(esReglaSinEfecto({ cobertura: { alcanza: 0, gana: 0 } })).toBe(true)
    expect(esReglaSinEfecto({ cobertura: { alcanza: 8, gana: 0 } })).toBe(false)
    expect(esReglaSinEfecto({})).toBe(true)
  })
})

describe('Los avisos y los requisitos que faltan', () => {
  it('los tres avisos del servidor tienen texto en castellano', () => {
    for (const codigo of ['SIN_PRECIO', 'FOTO_EXTERNA', 'QUEDA_EN_CERO']) {
      expect(etiquetaDeAviso(codigo)).not.toBe(codigo)
    }
  })

  it('un aviso desconocido se dibuja crudo en vez de desaparecer', () => {
    // Que se vea feo es lo buscado: un aviso nuevo del servidor que la pantalla
    // no conoce tiene que llamar la atención, no evaporarse.
    expect(etiquetaDeAviso('MARCIANO')).toBe('MARCIANO')
  })

  it('los cuatro requisitos de publicar tienen título', () => {
    for (const que of ['nombre_visible', 'slug', 'punto_de_venta', 'productos']) {
      expect(tituloDeRequisito(que)).not.toBe('Falta algo')
    }

    expect(tituloDeRequisito('marciano')).toBe('Falta algo')
  })
})
