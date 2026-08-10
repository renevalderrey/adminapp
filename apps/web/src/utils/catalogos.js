import { pesosDeLista } from '@/utils/formato'

// ════════════════════════════════════════════
//  FAVALIO · Lo que la pantalla de Catálogos decide sin dibujar
//
//  ── Por qué esto existe antes que la pantalla ──
//
//  Un test de render que verifica una regla —«un catálogo pausado no se dibuja
//  con el mismo tono que uno publicado»— monta un árbol de React, espera dos
//  efectos y busca un nodo. Cuesta diez veces más que llamar a una función, y
//  se rompe el día que alguien mueve un `<div>` sin cambiar ninguna regla. Lo
//  que se puede decidir sin dibujar se decide acá, y la pantalla se limita a
//  poner el resultado en un `className`.
//
//  Adentro hay tres grupos, y los tres tienen el mismo motivo:
//
//   · **El estado del catálogo**: los tres tonos y las tres etiquetas juntos,
//     con las mismas claves, como manda `docs/REGLAS-DISENO.md` → «Badge de
//     estado».
//   · **El slug**: una copia de `apps/api/src/utils/slugDeCatalogo.js`. El
//     motivo de la copia y lo que la sostiene está más abajo, en su propio
//     bloque — no es un descuido y no se resuelve creando un paquete.
//   · **El color de marca**: una copia de `apps/tienda/src/tema.js`, por lo
//     mismo. El texto encima del color **se calcula por contraste** (FR-060).
//
//  ⚠ Los hexadecimales de este archivo son deliberados y son los únicos de la
//  pantalla. `guardiasDeDiseno.test.js` prohíbe el hex en los componentes
//  —`pages/Catalogos.jsx` y los tres de las pestañas están en su lista— y esa
//  regla existe porque un color elegido en un componente no tiene modo oscuro.
//  Acá no se está eligiendo ningún color de la aplicación: se está
//  reconstruyendo **cómo se ve la tienda pública**, que tiene un solo tema y no
//  sigue el del panel. Pintar la previsualización con los tokens del panel haría
//  que en modo oscuro el comercio viera una portada negra que ningún visitante
//  va a ver nunca — o sea, una previsualización que miente.
// ════════════════════════════════════════════

// ════════════════════════════════════════════
//  El estado del catálogo (FR-054)
//
//  Tres, y ninguno más. `borrador` es «el enlace da 404», `publicado` es «está
//  en la calle» y `pausado` es «el visitante llega y ve el cartel de volvemos
//  pronto». Son tres cosas distintas para quien tiene el QR pegado en la pared,
//  así que se dibujan con tres tonos distintos.
// ════════════════════════════════════════════

/** Los tres estados, en el orden en que un catálogo los recorre. */
export const ESTADOS = ['borrador', 'publicado', 'pausado']

/**
 * Las etiquetas van al lado de los tonos, con las mismas claves.
 *
 * Así, agregar un cuarto estado sin su etiqueta es imposible: el badge dibujaría
 * el código crudo, que es lo que ya pasó con `tc3` en los comprobantes.
 */
export const ETIQUETAS_DE_ESTADO = {
  borrador: 'Borrador',
  publicado: 'Publicado',
  pausado: 'Pausado',
}

/**
 * Las TRES clases juntas —línea, fondo y texto—, nunca una sola.
 *
 * Un color de estado suelto sobre el fondo de la tarjeta se lee como un error de
 * estilo y no como un estado (`REGLAS-DISENO.md` → «Estados»).
 */
const TONOS = {
  // Neutro y no gris de alarma: un borrador no está mal, está sin publicar.
  borrador: 'border-border bg-surface-3 text-fg-2',
  publicado: 'border-ok-line bg-ok-soft text-ok',
  // Ámbar y no rojo: pausado es reversible con un clic, y el rojo se reserva
  // para lo que no se puede deshacer.
  pausado: 'border-warn-line bg-warn-soft text-warn',
}

/**
 * El tono del badge de estado.
 *
 * Un estado desconocido cae en el neutro y NO devuelve `undefined`: un badge sin
 * pintar es un defecto visible, un `className` con `undefined` adentro es una
 * fila rota.
 */
export function tonoDeCatalogo(estado) {
  return TONOS[estado] || TONOS.borrador
}

/** «Publicado». El código crudo nunca se dibuja. */
export function etiquetaDeEstado(estado) {
  return ETIQUETAS_DE_ESTADO[estado] || ETIQUETAS_DE_ESTADO.borrador
}

/**
 * Si la dirección pública de este catálogo lleva a algún lado.
 *
 * `pausado` cuenta: la tienda contesta 200 y dibuja el cartel de pausa, así que
 * quien escanea el QR llega al lugar correcto. `borrador` no: contesta el mismo
 * 404 que un slug inventado (FR-055), y por eso el QR de un borrador es un
 * cartel que manda a la nada.
 */
export function llevaAlgunLado(estado) {
  return estado === 'publicado' || estado === 'pausado'
}

// ════════════════════════════════════════════
//  El slug — una copia de `apps/api/src/utils/slugDeCatalogo.js`
//
//  ── Por qué se copia, y por qué la copia se acepta ──
//
//  El formulario propone el slug mientras alguien escribe el nombre, y el
//  servidor lo normaliza otra vez antes de guardarlo (FR-051). Si las dos
//  normalizaciones no dan lo mismo, el comercio apretó «Publicar» sobre
//  `comprafit-fitnet` y quedó publicada otra dirección: **el QR ya está impreso
//  y pegado en la pared del gimnasio**, el enlace no abre nada y nada falló en
//  ningún log. Alcanza con que un lado colapse los guiones repetidos y el otro
//  no.
//
//  Son ocho líneas sin dependencias. Un tercer paquete compartido para ellas
//  —después de `@favalio/precios` y de `packages/pedido`— obliga a tocar dos
//  `package.json`, el build de Vite, el de Node y la resolución entre CommonJS y
//  ESM, o sea engorda el corte de workspaces **sin resolver nada que la guardia
//  no resuelva**. Lo que las ata es `src/tests/slugDeCatalogo.test.js`, que lee
//  el archivo de la API **como texto** y compara la lista de reservados y el
//  regex — el mismo molde que `src/tests/mediosDePago.test.js`.
//
//  ⚠ Por eso `RESERVADOS` y `FORMATO` son constantes con nombre y literales
//  planos, igual que del otro lado: hay un test que los lee como texto. Si
//  aparece una tercera regla compartida, ahí nace `packages/comun`.
// ════════════════════════════════════════════

/** Los nombres que un catálogo no puede tomar (FR-052). */
export const RESERVADOS = [
  'c',
  'api',
  'assets',
  'admin',
  'robots.txt',
  'favicon.ico',
  'img',
  'static',
  'public',
]

/**
 * La forma que tiene un slug ya normalizado.
 *
 * Escrito como «grupos separados por un guión» y no como `/^[a-z0-9-]+$/`, para
 * que el propio regex prohíba las tres cosas que `normalizarSlug` saca: el
 * guión del principio, el del final y los repetidos.
 */
export const FORMATO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const LARGO_MINIMO = 3
export const LARGO_MAXIMO = 60

/**
 * Un texto cualquiera llevado a la forma que puede vivir en una URL.
 *
 * «Comprafít / Fitnet» da `comprafit-fitnet`. Puede quedar vacío: normalizar no
 * es validar, y el vacío lo rechaza `validarSlug`.
 */
export function normalizarSlug(texto) {
  return (
    String(texto ?? '')
      // NFD separa cada letra acentuada en letra + marca combinante, y el
      // segundo replace se lleva las marcas. Es lo que convierte «í» en «i».
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Todo lo que no sea letra o número es un separador, uno por carácter,
      // para que el colapso de la línea siguiente sea el que hace el trabajo.
      .replace(/[^a-z0-9]/g, '-')
      // ⚠ Sin esta línea, «Comprafit / Fitnet» sale `comprafit---fitnet`: el
      // panel mostraría una dirección y el servidor guardaría otra.
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  )
}

/**
 * Si un slug se puede usar, y si no, por qué no.
 *
 * ⚠ **Los reservados se miran antes que el largo, y ese orden importa.** `c`
 * mide un carácter: con el largo primero, el motivo sería «tiene que tener entre
 * 3 y 60 caracteres» y quien lo lea volvería a intentar con `cc` sin enterarse
 * nunca de que el problema real es que `c` está tomado por el sistema.
 *
 * @returns {{ ok: boolean, motivo: string|null }}
 */
export function validarSlug(slug) {
  const candidato = String(slug ?? '')

  if (RESERVADOS.includes(candidato)) {
    return {
      ok: false,
      motivo: `La dirección «${candidato}» está reservada por el sistema. Elegí otra.`,
    }
  }

  if (candidato.length < LARGO_MINIMO || candidato.length > LARGO_MAXIMO) {
    return {
      ok: false,
      motivo: `La dirección tiene que tener entre ${LARGO_MINIMO} y ${LARGO_MAXIMO} caracteres.`,
    }
  }

  if (!FORMATO.test(candidato)) {
    return {
      ok: false,
      motivo:
        'La dirección sólo admite letras sin acento, números y guiones, sin '
        + 'guiones repetidos ni al principio o al final.',
    }
  }

  return { ok: true, motivo: null }
}

// ════════════════════════════════════════════
//  La dirección pública
// ════════════════════════════════════════════

/**
 * Dónde vive la tienda pública.
 *
 * Sale del entorno y no está escrita a mano en la pantalla: el enlace que el
 * comercio copia y el QR que imprime salen los dos de acá, así que en un entorno
 * de prueba apuntan al mismo lugar que la aplicación que se está probando.
 */
export const BASE_DE_LA_TIENDA = (
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_TIENDA_URL)
  || 'https://tienda.favalio.com'
).replace(/\/+$/, '')

/**
 * El enlace completo, **con protocolo**: es lo que se pega en WhatsApp.
 *
 * Sin `https://`, WhatsApp no lo convierte en enlace y el socio recibe un texto
 * gris que tiene que copiar a mano.
 */
export function urlDelCatalogo(slug) {
  return `${BASE_DE_LA_TIENDA}/c/${normalizarSlug(slug)}`
}

/**
 * El mismo enlace, con el parámetro de origen.
 *
 * `?f=qr` es lo que después permite separar las visitas que llegaron por el
 * cartel de las que llegaron por WhatsApp. Sin él, la pestaña de métricas del QR
 * mostraría el total de visitas del catálogo y lo llamaría «escaneos».
 */
export function urlDelQr(slug) {
  return `${urlDelCatalogo(slug)}?f=qr`
}

// ════════════════════════════════════════════
//  El color de marca — una copia de `apps/tienda/src/tema.js`
//
//  El catálogo tiene **un** color configurable y el color del texto encima
//  **se calcula, no se elige** (FR-060). La previsualización del panel tiene que
//  decidirlo con la MISMA función que la tienda, o el comercio elige un amarillo,
//  el panel le muestra el botón con texto blanco y la tienda se lo dibuja con
//  texto oscuro: la previsualización deja de previsualizar.
//
//  `apps/web` no puede importar de `apps/tienda` —son dos aplicaciones del
//  workspace, sin dependencia declarada entre ellas— así que la copia es la
//  misma decisión que la del slug, con la misma contrapartida: un test que lee
//  `apps/tienda/src/tema.js` como texto y compara los dos colores de texto y la
//  forma de decidir (`utils/catalogos.test.js`).
// ════════════════════════════════════════════

/** El turquesa de la maqueta. Es también el `DEFAULT` de `catalogos.color_marca`. */
export const MARCA_POR_DEFECTO = '#00B4B6'

/** Los dos únicos colores de texto posibles. */
export const TEXTO_OSCURO = '#101418'
export const TEXTO_CLARO = '#FFFFFF'

/**
 * `#abc` y `#AABBCC` valen; cualquier otra cosa cae en el color por defecto.
 *
 * No es cosmética: `color_marca` viene de un formulario y termina metido tal
 * cual en una propiedad CSS. Lo que sale de acá es siempre un `#rrggbb`.
 */
function normalizarColor(hex) {
  const limpio = String(hex ?? '').trim().replace('#', '')
  const seis = limpio.length === 3 ? limpio.split('').map((c) => c + c).join('') : limpio

  return /^[0-9a-fA-F]{6}$/.test(seis) ? seis.toLowerCase() : MARCA_POR_DEFECTO.slice(1).toLowerCase()
}

/** El color de marca ya validado. */
export const colorDeMarca = (hex) => `#${normalizarColor(hex)}`

/** Luminancia relativa (WCAG 2.x), con los coeficientes de la maqueta. */
function luminancia(hex) {
  const v = normalizarColor(hex)
  const r = parseInt(v.slice(0, 2), 16) / 255
  const g = parseInt(v.slice(2, 4), 16) / 255
  const b = parseInt(v.slice(4, 6), 16) / 255
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** La razón de contraste de WCAG entre dos luminancias. */
const contraste = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/**
 * El color que se lee encima del color de marca.
 *
 * Se decide **comparando los dos contrastes**, igual que la tienda, y no con un
 * umbral: los dos candidatos están acá arriba, se mide contra los dos y gana el
 * que mide más. No hay ningún número mágico que quede descalibrado si mañana el
 * texto oscuro deja de ser el que es.
 */
export function textoSobre(hex) {
  const fondo = luminancia(hex)

  return contraste(fondo, luminancia(TEXTO_OSCURO)) >= contraste(fondo, luminancia(TEXTO_CLARO))
    ? TEXTO_OSCURO
    : TEXTO_CLARO
}

/**
 * Los colores con los que se dibuja la previsualización de la tienda.
 *
 * ⚠ Son fijos y claros **siempre**, incluso con el panel en modo oscuro, y eso
 * es lo que hace que la previsualización sirva: la tienda pública tiene un solo
 * tema, así que pintarla con los tokens del panel le mostraría al comercio una
 * portada negra que ningún visitante va a ver.
 *
 * El color aparece en los dos lugares en los que aparece en la tienda real
 * —portada y botón— y **nunca de fondo de una zona grande**.
 */
export function estiloDePrevisualizacion(hex) {
  const marca = colorDeMarca(hex)

  return {
    marca,
    textoSobreLaMarca: textoSobre(marca),
    // El damero de la maqueta (`:829`) más el degradado del color, los dos
    // rebajados contra blanco: es el color en la portada, no el color como
    // fondo.
    portada:
      'repeating-linear-gradient(135deg,rgba(0,0,0,.045) 0 5px,rgba(0,0,0,0) 5px 11px),'
      + `linear-gradient(160deg,color-mix(in srgb,${marca} 30%,#fff),`
      + `color-mix(in srgb,${marca} 12%,#fff))`,
    papel: '#FFFFFF',
    borde: '#E5E8EA',
    tinta: '#101418',
    tintaMedia: '#5A646E',
  }
}

// ════════════════════════════════════════════
//  Las reglas de precio
//
//  ── La sangría no es un adorno ──
//
//  Es lo que hace visible la única regla del sistema: **gana la más específica y
//  no se acumulan**. Un producto con regla propia ignora la de su marca, una
//  marca ignora la de su categoría, y todas ignoran la del catálogo entero. Con
//  las cuatro filas alineadas al mismo margen, eso hay que leerlo en un manual;
//  con la sangría, se ve.
// ════════════════════════════════════════════

/** Los cuatro ámbitos, del más general al más específico. */
export const AMBITOS = ['catalogo', 'categoria', 'marca', 'producto']

export const ETIQUETAS_DE_AMBITO = {
  catalogo: 'Todo el catálogo',
  categoria: 'Categoría',
  marca: 'Marca',
  producto: 'Producto',
}

/**
 * Cuánto manda cada ámbito. Más alto gana.
 *
 * Es la misma escala que `apps/api/src/utils/reglasDePrecio.js`, y acá **no se
 * usa para calcular nada**: los precios y las coberturas los resuelve el
 * servidor (H2). Se usa sólo para ordenar y para sangrar.
 */
export const ESPECIFICIDAD = {
  catalogo: 0,
  categoria: 1,
  marca: 2,
  producto: 3,
}

/** Cuántos píxeles se corre la fila hacia la derecha. 18 por nivel. */
export function sangriaDeAmbito(ambito) {
  return (ESPECIFICIDAD[ambito] ?? 0) * 18
}

/** Las reglas ordenadas de la más general a la más específica. */
export function ordenarPorEspecificidad(reglas = []) {
  return [...reglas].sort(
    (a, b) => (ESPECIFICIDAD[a.ambito] ?? 0) - (ESPECIFICIDAD[b.ambito] ?? 0) || (a.id - b.id)
  )
}

export const TIPOS = ['porcentaje_descuento', 'monto_descuento', 'precio_fijo']

export const ETIQUETAS_DE_TIPO = {
  porcentaje_descuento: 'Descuento en %',
  monto_descuento: 'Descuento en $',
  precio_fijo: 'Precio fijo',
}

/** «12 %», «$1.500», «$9.900». Lo que va en la columna Valor. */
export function textoDeValor(regla = {}) {
  const valor = Number(regla.valor) || 0

  if (regla.tipo === 'porcentaje_descuento') return `${pesosDeLista(valor)} %`

  return `$${pesosDeLista(valor)}`
}

/**
 * «4 de 8»: sobre cuántos de los que alcanza termina mandando.
 *
 * Los dos números salen del servidor y la pantalla no calcula ninguno. La
 * diferencia entre ellos es la que cuenta la historia: una regla de catálogo que
 * alcanza a ocho productos y gana en cuatro es una regla a la que otras cuatro
 * más específicas le pisaron la mitad.
 */
export function textoDeCobertura(cobertura = {}) {
  return `${Number(cobertura.gana) || 0} de ${Number(cobertura.alcanza) || 0}`
}

/**
 * Una regla que hoy no toca ningún producto.
 *
 * Es el caso de la regla cuya marca alguien borró, y el de la que apunta a una
 * categoría que ya no existe. **Se sigue dibujando** —atenuada y con «0 de 0»—
 * porque hacerla desaparecer dejaría una fila en la base que nadie puede ver
 * para borrarla, y una columna «Gana en» que no suma lo que debería sin ninguna
 * explicación a la vista.
 */
export function esReglaSinEfecto(regla = {}) {
  return (Number(regla.cobertura?.alcanza) || 0) === 0
}

// ════════════════════════════════════════════
//  Los avisos de un producto
// ════════════════════════════════════════════

const AVISOS = {
  SIN_PRECIO: 'Sin precio: no va a salir aunque esté publicado',
  FOTO_EXTERNA: 'Foto externa, no se publica',
  QUEDA_EN_CERO: 'La regla lo deja en $0',
}

/**
 * El texto de un aviso, o el código crudo si no lo conocemos.
 *
 * Devolver el código y no `null` es a propósito: un aviso nuevo del servidor
 * tiene que verse feo en la pantalla, no desaparecer.
 */
export function etiquetaDeAviso(codigo) {
  return AVISOS[codigo] || codigo
}

// ════════════════════════════════════════════
//  Lo que falta para publicar
// ════════════════════════════════════════════

const REQUISITOS = {
  nombre_visible: 'El nombre',
  slug: 'La dirección web',
  punto_de_venta: 'La sucursal',
  productos: 'Los productos',
}

/** El título de cada renglón de la lista del 409 `FALTAN_REQUISITOS`. */
export function tituloDeRequisito(que) {
  return REQUISITOS[que] || 'Falta algo'
}
