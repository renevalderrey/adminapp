// ════════════════════════════════════════════
//  Comparador de proveedores
//
//  El problema: cada proveedor manda su lista con el nombre que se le ocurre.
//  "Whey Protein 1kg Vainilla - Star", "STAR WHEY 1 KG VAINILLA" y
//  "Proteina Whey Star 1kg vainilla" son el mismo producto, y hay que poder
//  decir cual de los tres proveedores lo tiene mas barato.
//
//  No hay codigo comun entre proveedores, asi que el emparejamiento es por
//  nombre. La medida es Jaccard sobre las palabras: cuantas comparten sobre
//  cuantas hay en total. Es la misma que usaba el sistema anterior — se
//  mantuvo a proposito, porque ya estaba calibrada contra los nombres reales
//  de este rubro.
//
//  Dos diferencias con el sistema anterior, las dos por errores que producia:
//
//   1. Para cada grupo se elige el MEJOR candidato de cada proveedor, no el
//      primero que supera el umbral. Con dos productos parecidos del mismo
//      proveedor ("Whey 1kg" y "Whey 2kg"), tomar el primero emparejaba el
//      que estuviera antes en la lista.
//   2. El SKU, cuando los dos lo tienen y coincide, gana sobre el nombre. Un
//      SKU igual es una afirmacion del proveedor; el nombre es una heuristica.
// ════════════════════════════════════════════

// El lector de importes se mudo a utils/importes.js: lo necesita tambien la
// importacion de productos, que hasta ahora usaba parseFloat y leia 1.234,50
// como 1.234. Se sigue reexportando desde aca para no tocar a sus
// consumidores ni al test que ya lo cubre.
const { aNumero } = require('../utils/importes');

/** Debajo de esto, dos nombres no son el mismo producto. */
const UMBRAL_POR_DEFECTO = 0.45;

/** Palabras mas cortas que esto no aportan: "de", "x", "kg" queda, "g" no. */
const LARGO_MINIMO_PALABRA = 3;

/**
 * Normaliza un nombre para poder compararlo.
 *
 * Minusculas, sin acentos, sin puntuacion, sin espacios repetidos. Es lo que
 * convierte "Proteína  Whey 1Kg." y "PROTEINA WHEY 1KG" en la misma cadena.
 */
function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    // Marcas diacriticas: lo que NFD separo de las letras acentuadas. Escrito
    // con escapes y no con los caracteres literales, que son invisibles en un
    // editor y se rompen al copiar el archivo entre sistemas.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Las palabras significativas de un nombre. */
function palabrasDe(texto) {
  return new Set(
    normalizar(texto)
      .split(' ')
      .filter((p) => p.length >= LARGO_MINIMO_PALABRA)
  );
}

/**
 * Cuanto se parecen dos nombres, entre 0 y 1.
 *
 * Jaccard: palabras compartidas sobre palabras totales. Penaliza que uno tenga
 * mucho texto que el otro no —que es justo lo que distingue "Whey 1kg" de
 * "Whey 1kg + Creatina 300g de regalo".
 */
function similitud(a, b) {
  const pa = palabrasDe(a);
  const pb = palabrasDe(b);

  if (pa.size === 0 || pb.size === 0) return 0;

  let comunes = 0;
  for (const palabra of pa) if (pb.has(palabra)) comunes++;

  const union = pa.size + pb.size - comunes;

  return union === 0 ? 0 : comunes / union;
}

/** Dos SKU son el mismo si coinciden una vez normalizados. */
function mismoSku(a, b) {
  if (!a || !b) return false;

  const na = normalizar(a).replace(/ /g, '');
  const nb = normalizar(b).replace(/ /g, '');

  return na.length > 0 && na === nb;
}

/**
 * Parsea una lista pegada como texto.
 *
 * Los proveedores mandan de todo: "Producto  $1.234,50", "Producto;1234.5",
 * "Producto<tab>1234", "Producto - 1234". El precio es siempre lo ultimo de la
 * linea, asi que se busca el ultimo numero y lo de antes es el nombre.
 *
 * Los importes argentinos usan punto para miles y coma para decimales
 * (1.234,50). Interpretarlos al reves convierte $1.234 en $1,234 y arruina la
 * comparacion entera sin que se note.
 *
 * @returns {{items: object[], ignoradas: number}}
 */
function parsearTexto(texto) {
  const items = [];
  let ignoradas = 0;

  for (const lineaCruda of String(texto || '').split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (!linea) continue;

    // El ultimo numero de la linea, con o sin separadores de miles.
    const coincidencias = [...linea.matchAll(/(\d[\d.,]*)/g)];

    if (coincidencias.length === 0) { ignoradas++; continue; }

    const ultima = coincidencias[coincidencias.length - 1];
    const precio = aNumero(ultima[1]);

    if (precio === null || precio <= 0) { ignoradas++; continue; }

    const nombre = linea
      .slice(0, ultima.index)
      .replace(/[\s$;,:|.\-–—]+$/, '')
      .trim();

    if (!nombre) { ignoradas++; continue; }

    items.push({ nombre, precio });
  }

  return { items, ignoradas };
}

/**
 * Arma la comparacion entre listas.
 *
 * @param {object[]} listas [{ id, nombre, items: [{nombre, precio, sku, marca}] }]
 * @param {object} [opciones]
 * @param {number} [opciones.umbral]
 * @returns {{grupos: object[], soloEnUno: number, proveedores: object[]}}
 */
function comparar(listas = [], { umbral = UMBRAL_POR_DEFECTO } = {}) {
  // Se aplana todo a una sola lista de candidatos, cada uno sabiendo de que
  // proveedor viene.
  const candidatos = [];

  for (const lista of listas) {
    for (const item of lista.items || []) {
      const precio = Number(item.precio);
      if (!Number.isFinite(precio) || precio <= 0) continue;

      candidatos.push({
        listaId: lista.id,
        listaNombre: lista.nombre,
        nombre: item.nombre,
        sku: item.sku || null,
        marca: item.marca || null,
        precio,
      });
    }
  }

  const usados = new Set();
  const grupos = [];

  for (let i = 0; i < candidatos.length; i++) {
    if (usados.has(i)) continue;

    const base = candidatos[i];
    usados.add(i);

    // Un producto por proveedor y por grupo: el mejor candidato de cada uno.
    const mejorPorLista = new Map([[base.listaId, { indice: i, puntaje: 1, item: base }]]);

    for (let j = i + 1; j < candidatos.length; j++) {
      if (usados.has(j)) continue;

      const otro = candidatos[j];
      if (otro.listaId === base.listaId) continue;

      const puntaje = mismoSku(base.sku, otro.sku) ? 1 : similitud(base.nombre, otro.nombre);
      if (puntaje < umbral) continue;

      const actual = mejorPorLista.get(otro.listaId);
      if (!actual || puntaje > actual.puntaje) {
        mejorPorLista.set(otro.listaId, { indice: j, puntaje, item: otro });
      }
    }

    const precios = [];

    for (const { indice, puntaje, item } of mejorPorLista.values()) {
      usados.add(indice);

      precios.push({
        lista_id: item.listaId,
        proveedor: item.listaNombre,
        nombre: item.nombre,
        precio: item.precio,
        // Se expone que tan seguro es el emparejamiento: con 0.5 conviene que
        // alguien lo mire antes de decidir una compra.
        coincidencia: Math.round(puntaje * 100) / 100,
      });
    }

    precios.sort((a, b) => a.precio - b.precio);

    const masBarato = precios[0];
    const masCaro = precios[precios.length - 1];

    // El nombre mas largo suele ser el mas descriptivo: "Whey 1kg" vs
    // "Whey Protein 1kg Vainilla".
    const nombre = precios.reduce(
      (mejor, p) => (p.nombre.length > mejor.length ? p.nombre : mejor),
      base.nombre
    );

    const diferencia = precios.length > 1
      ? Math.round((masCaro.precio - masBarato.precio) * 100) / 100
      : 0;

    const diferenciaPct = precios.length > 1 && masBarato.precio > 0
      ? Math.round(((masCaro.precio - masBarato.precio) / masBarato.precio) * 1000) / 10
      : 0;

    grupos.push({
      nombre,
      marca: base.marca || null,
      precios,
      cantidad_proveedores: precios.length,
      mas_barato: masBarato.lista_id,
      precio_minimo: masBarato.precio,
      precio_maximo: masCaro.precio,
      diferencia,
      diferencia_pct: diferenciaPct,
    });
  }

  // Primero lo comparable, y dentro de eso lo que mas plata mueve: es el orden
  // en el que alguien quiere leerlo para decidir a quien comprarle.
  grupos.sort((a, b) => (
    b.cantidad_proveedores - a.cantidad_proveedores ||
    b.diferencia - a.diferencia ||
    a.nombre.localeCompare(b.nombre)
  ));

  const soloEnUno = grupos.filter((g) => g.cantidad_proveedores === 1).length;

  const proveedores = listas.map((l) => {
    const gana = grupos.filter((g) => g.cantidad_proveedores > 1 && g.mas_barato === l.id).length;

    return {
      lista_id: l.id,
      nombre: l.nombre,
      items: (l.items || []).length,
      // En cuantos productos comparables es el mas barato. Es el numero que
      // responde "a quien le conviene comprarle".
      gana,
    };
  });

  return {
    grupos,
    total: grupos.length,
    comparables: grupos.length - soloEnUno,
    solo_en_uno: soloEnUno,
    proveedores,
    umbral,
  };
}

module.exports = {
  UMBRAL_POR_DEFECTO,
  normalizar,
  similitud,
  mismoSku,
  parsearTexto,
  aNumero,
  comparar,
};
