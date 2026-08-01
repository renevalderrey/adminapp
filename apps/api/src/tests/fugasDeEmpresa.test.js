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

describe('Producción no crea stock de otra empresa', () => {
  // Las cuatro escrituras de Stock de productionService no llevaban
  // `empresa_id` ni en el where ni en los defaults. Como la columna tiene
  // valor por defecto 1, una fila creada al producir en la empresa 7 quedaba
  // asignada a la empresa 1: le aparece inventario a un cliente que no
  // produjo nada, y a quien produjo el stock le queda invisible.
  const production = leer('services/productionService.js');

  it('las cuatro consultas de Stock filtran por empresa', () => {
    const sinEmpresa = lineasQueMatchean(production, /(stockWhere|finishedWhere)\s*=|^\?\s*\{|^:\s*\{/)
      .filter(({ texto }) => /product_id/.test(texto) && !/empresa_id/.test(texto))
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(sinEmpresa).toEqual([]);
  });

  it('los defaults de Stock traen empresa_id', () => {
    // Un `where` con empresa_id no alcanza: findOrCreate copia el where a la
    // fila nueva solo en Sequelize moderno y solo para igualdades simples.
    // Ponerlo explícito en defaults es lo que lo hace independiente de eso.
    const bloques = production
      .split('Stock.findOrCreate')
      .slice(1)
      .map((b) => b.slice(0, 220));

    expect(bloques.length).toBe(4);

    for (const bloque of bloques) {
      expect(bloque).toMatch(/defaults:/);
    }

    const defaultsSinEmpresa = lineasQueMatchean(
      production,
      /(defaults:|stockDefaults\s*=|finishedDefaults\s*=|^\?\s*\{\s*quantity|^:\s*\{\s*quantity)/
    )
      .filter(({ texto }) => /quantity:\s*0/.test(texto) && !/empresa_id/.test(texto))
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(defaultsSinEmpresa).toEqual([]);
  });
});
