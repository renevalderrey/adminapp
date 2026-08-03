// ════════════════════════════════════════════
//  Dos fugas entre empresas cliente, con su guardia
//
//  Las encontró el plan de la funcionalidad 010 leyendo el código, no una
//  auditoría. Son de la misma clase que las veinte del Frente 1 y las ocho que
//  aparecieron un mes después: el aislamiento no falla de golpe, se filtra por
//  los bordes que nadie mira.
//
//  Las dos son de escritura, que es lo que las hace peores que una lectura: no
//  muestran datos ajenos, los *crean* del lado equivocado. Nadie ve un error.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const leer = (relativo) => fs.readFileSync(path.join(SRC, relativo), 'utf8');

/** Las líneas que matchean, sin comentarios. */
function lineasQueMatchean(contenido, regex) {
  return contenido
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => regex.test(texto) && !texto.startsWith('//') && !texto.startsWith('*'));
}

describe('Un producto no se puede mover a otra empresa', () => {
  // `PUT /api/products/:id` hacía `product.update(req.body)`. findScoped
  // garantiza que el producto ENCONTRADO sea de la empresa del usuario, pero
  // no impide que el update lo saque de ahí: mandando `empresa_id` en el
  // cuerpo, el producto —con su historial de costos, sus recetas y su stock—
  // pasa a ser de otro cliente.
  const products = leer('routes/products.js');

  it('el update usa una lista blanca y no el cuerpo entero', () => {
    const crudos = lineasQueMatchean(products, /\.update\(\s*req\.body\s*[,)]/)
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(crudos).toEqual([]);
  });

  it('la lista blanca no incluye empresa_id ni id', () => {
    const { CAMPOS_EDITABLES } = require('../routes/products.js').__test__ || {};

    // Si el módulo no exporta la lista, se verifica sobre el texto: lo que
    // importa es que no esté, no cómo se comprueba.
    if (CAMPOS_EDITABLES) {
      expect(CAMPOS_EDITABLES).not.toContain('empresa_id');
      expect(CAMPOS_EDITABLES).not.toContain('id');
      return;
    }

    const bloque = products.slice(
      products.indexOf('const CAMPOS_EDITABLES'),
      products.indexOf('];', products.indexOf('const CAMPOS_EDITABLES'))
    );

    expect(bloque).not.toMatch(/'empresa_id'/);
    expect(bloque).not.toMatch(/'id'/);
    expect(bloque).toMatch(/'name'/);
  });
});

/**
 * Las llamadas a `Modelo.metodo(` de un archivo, con su texto completo.
 *
 * Cuenta paréntesis en vez de tomar «las N líneas siguientes». Esto **no es
 * elegancia**: la versión anterior de esta guardia miraba la forma exacta del
 * ternario `puntoDeVentaId ? {…} : {…}` que la funcionalidad 010 vino a
 * eliminar. Al desaparecer el ternario, sus expresiones habrían matcheado
 * **cero líneas** y el `expect([]).toEqual([])` habría pasado **en vacío**: la
 * guardia seguía verde sin verificar nada, que es la peor forma de fallar
 * porque nadie vuelve a mirarla.
 *
 * Leyendo la llamada entera, la guardia no depende de cómo esté escrita
 * adentro.
 */
function llamadasA(contenido, regexInicio) {
  const llamadas = [];
  const re = new RegExp(regexInicio.source, 'g');

  for (const m of contenido.matchAll(re)) {
    // Desde el paréntesis de apertura hasta el que lo cierra.
    let i = contenido.indexOf('(', m.index + m[0].length - 1);
    let nivel = 0;
    let fin = i;

    for (; fin < contenido.length; fin++) {
      if (contenido[fin] === '(') nivel++;
      else if (contenido[fin] === ')') {
        nivel--;
        if (nivel === 0) break;
      }
    }

    llamadas.push({
      linea: contenido.slice(0, m.index).split('\n').length,
      texto: contenido.slice(m.index, fin + 1),
    });
  }

  return llamadas;
}

describe('Producción no crea stock de otra empresa ni en una sucursal inventada', () => {
  // Las cinco consultas de Stock de productionService no llevaban `empresa_id`
  // ni en el where ni en los defaults. Como la columna tiene valor por defecto
  // 1, una fila creada al producir en la empresa 7 quedaba asignada a la
  // empresa 1: le aparece inventario a un cliente que no produjo nada, y a
  // quien produjo el stock le queda invisible.
  //
  // Y las cinco ubicaban la fila con un ternario propio
  // —`puntoDeVentaId ? {…punto_de_venta_id} : {…location}`—. La rama del
  // `location` busca una fila ubicada por texto que después de la migración 14
  // no existe: producir sin cabecera de punto de venta pasaba la validación de
  // stock **siempre** y creaba filas que la pantalla no muestra.
  const production = leer('services/productionService.js');
  const escrituras = llamadasA(production, /Stock\.(findOne|findOrCreate)\(/);

  it('la guardia encuentra las cinco consultas de Stock que tiene que mirar', () => {
    // **El ancla.** Sin esto, un refactor que renombre o reescriba estas
    // llamadas dejaría los tests de abajo recorriendo una lista vacía y
    // pasando sin verificar nada. Si este número cambia hay una consulta de
    // stock nueva y **hay que leerla**, no ajustar el número.
    expect(escrituras.length).toBeGreaterThan(0);
    expect(escrituras.length).toBe(5);

    // Cuatro son altas (findOrCreate) y una es la validación previa.
    expect(escrituras.filter(({ texto }) => /defaults:/.test(texto)).length).toBe(4);
  });

  it('las cinco filtran por empresa', () => {
    const sinEmpresa = escrituras
      .filter(({ texto }) => !/empresa_id/.test(texto))
      .map(({ linea }) => `L${linea}`);

    expect(sinEmpresa).toEqual([]);
  });

  it('los defaults de Stock traen empresa_id', () => {
    // Un `where` con empresa_id no alcanza: findOrCreate copia el where a la
    // fila nueva solo en Sequelize moderno y solo para igualdades simples.
    // Ponerlo explícito en defaults es lo que lo hace independiente de eso.
    const defaultsSinEmpresa = escrituras
      .filter(({ texto }) => /defaults:/.test(texto))
      .filter(({ texto }) => !/empresa_id/.test(texto.slice(texto.indexOf('defaults:'))))
      .map(({ linea }) => `L${linea}`);

    expect(defaultsSinEmpresa).toEqual([]);
  });

  it('las cinco ubican la fila por punto_de_venta_id y no por location', () => {
    const sinSucursal = escrituras
      .filter(({ texto }) => !/punto_de_venta_id/.test(texto))
      .map(({ linea }) => `L${linea}`);

    expect(sinSucursal).toEqual([]);

    const porTexto = escrituras
      .filter(({ texto }) => /location:\s*(loc|targetLocation)\b/.test(texto))
      .map(({ linea }) => `L${linea}`);

    expect(porTexto).toEqual([]);
  });

  it('la sucursal la decide utils/sucursalDeStock y no un ternario propio', () => {
    // Es FR-049 y la decisión 8: diez lugares escriben stock y cada uno
    // resolvía la sucursal a su manera. Si acá vuelve un ternario, producción
    // puede mapear distinto de como mapean las rutas y la migración.
    expect(production).toMatch(/require\('\.\.\/utils\/sucursalDeStock'\)/);
    expect(production).toMatch(/resolverSucursal\(/);
    expect(production).toMatch(/ubicacionDeStock\(/);

    const ternarios = lineasQueMatchean(production, /puntoDeVentaId\s*\?|pvId\s*\?/)
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(ternarios).toEqual([]);
  });
});
