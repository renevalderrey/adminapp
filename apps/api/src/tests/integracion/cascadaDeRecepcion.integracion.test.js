// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, sequelize, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');
const { capturarConsultas, contra } = require('./espiaDeConsultas');

// ════════════════════════════════════════════
//  P11 · La recepción con cascada, medida por lo que crece
//
//  El paso manual decía dos cosas: **«¿el recosteo llega a todo el grafo?»** y
//  **«¿cuánto tarda?»**. La primera se puede afirmar acá y se afirma. La segunda
//  **no se convierte en test y es a propósito**:
//
//   - un umbral de tiempo no se puede elegir: la misma recepción tarda distinto
//     en la máquina de quien desarrolla, en CI y en el contenedor con otras dos
//     cosas corriendo. Un test así se pone en rojo por el reloj, alguien lo
//     marca inestable, y a partir de ahí no protege nada;
//   - y sin umbral no puede ponerse en rojo, que era exactamente el problema del
//     paso manual: «no tiene número de corte, así que es una medición y alguien
//     la interpreta».
//
//  ── Qué se mide en lugar del tiempo ──
//
//  **La cantidad de consultas**, que es lo que crece cuando esto se degrada y es
//  la misma en cualquier máquina. Tres magnitudes, y cada una protege una
//  decisión escrita en el código:
//
//   1. La sucursal se resuelve **una vez por recepción**, no una por línea
//      (T1204, hallazgo 5: estaba adentro del `for`, y una orden de veinte
//      líneas eran veinte resoluciones con la transacción abierta).
//   2. Los productos de la orden se leen **en una sola consulta**, no una por
//      línea.
//   3. Una línea más cuesta **un número fijo** de consultas. Si alguien mete una
//      lectura adentro del bucle, ese número sube y esto lo dice; el reloj no.
//
//  ── Y el fallo de correctitud que la verificación del hito 6 encontró ──
//
//  Con un grafo en **diamante** —Colágeno es insumo de la Premezcla, y el Combo
//  lleva Colágeno **y** Premezcla— la cascada respondía «Dependencia circular
//  detectada» sobre un grafo sin ningún ciclo, y era **intermitente**: el
//  `findAll` de las recetas dependientes no llevaba `ORDER BY`, así que el orden
//  de las filas decidía si la misma recepción respondía 200 o rompía.
//
//  Por eso el grafo de acá abajo se arma **en el orden que rompía** —la receta
//  de la Premezcla se crea primero, así su `recipe_item` tiene el id más chico y
//  sale primero del `ORDER BY id`—, y no en el que pasaba de casualidad.
// ════════════════════════════════════════════

const { Product, Recipe, RecipeItem, Stock } = modelos;

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();
});

afterAll(async () => {
  await cerrar();
});

/** Un producto de la empresa A con su costo. */
function crearProducto(name, sku, cost) {
  return Product.create({
    empresa_id: datos.empresaA.id, name, sku, cost, unit_type: 'unidad',
  });
}

/**
 * Una receta de `producto` con sus insumos, en el orden en que se pasan.
 *
 * El orden importa: `recostearDependientes` ordena por `recipe_items.id`, así
 * que el orden de creación es el orden en que se recorren las ramas.
 */
async function crearReceta(producto, insumos) {
  const receta = await Recipe.create({
    empresa_id: datos.empresaA.id,
    product_id: producto.id,
    yield: 1,
    loss_percentage: 0,
  });

  for (const [insumo, cantidad] of insumos) {
    await RecipeItem.create({
      recipe_id: receta.id,
      ingredient_product_id: insumo.id,
      quantity: cantidad,
    });
  }

  return receta;
}

/** Crea una orden por la API y devuelve su id. */
async function crearOrden(items) {
  const res = await request(app)
    .post(`/api/suppliers/${datos.molino.id}/orders`)
    .send({ date: '2026-07-25', items });

  expect(res.status).toBe(201);
  return res.body.data.id;
}

function recibir(orderId, items) {
  return request(app)
    .put(`/api/suppliers/orders/${orderId}/receive`)
    .send({ items, punto_de_venta_id: datos.centroA.id });
}

describe('El recosteo llega a todo el grafo', () => {
  it('un DIAMANTE no se lee como dependencia circular', async () => {
    const colageno = await crearProducto('Colágeno', 'COL-001', 900);
    const premezcla = await crearProducto('Premezcla', 'PRE-001', 1800);
    const combo = await crearProducto('Combo', 'CMB-001', 2700);

    // ⚠ La Premezcla PRIMERO: su `recipe_item` queda con el id más chico y el
    // `ORDER BY id` la recorre antes que el Combo. Es el orden en que la cascada
    // se caía: la primera rama marcaba el Combo, y la segunda —que llega al
    // mismo Combo por el otro lado del diamante— lo encontraba marcado.
    await crearReceta(premezcla, [[colageno, 2]]);
    await crearReceta(combo, [[colageno, 1], [premezcla, 1]]);

    const orderId = await crearOrden([
      { product_id: colageno.id, product_name: 'Colágeno', quantity: 10, unit_price: 1200 },
    ]);

    const res = await recibir(orderId, [{ linea: 0, cantidad: 10, actualizar_costo: true }]);

    expect(res.status).toBe(200);
    // Ningún aviso: el aviso de recosteo fallido es lo que aparecía cuando la
    // cascada se caía, y la recepción respondía 200 igual.
    expect(res.body.data.avisos).toEqual([]);
    expect(res.body.data.costos).toEqual([
      expect.objectContaining({
        linea: 0, costo_anterior: 900, costo_nuevo: 1200, aplicado: true, recosteos: 2,
      }),
    ]);

    // Y los costos de verdad, leídos de la base:
    //   Premezcla = 2 × 1.200 = 2.400
    //   Combo     = 1 × 1.200 + 1 × 2.400 = 3.600
    // El Combo solo da 3.600 si la Premezcla se recosteó ANTES, dentro de la
    // misma transacción: es la cascada llegando en profundidad y no solo a los
    // vecinos.
    expect((await Product.findByPk(premezcla.id)).cost).toBe('2400.00');
    expect((await Product.findByPk(combo.id)).cost).toBe('3600.00');
  });

  it('una CADENA de tres niveles se recostea hasta el final, aunque recosteos diga 1', async () => {
    const colageno = await crearProducto('Colágeno', 'COL-001', 900);
    const premezcla = await crearProducto('Premezcla', 'PRE-001', 1800);
    const combo = await crearProducto('Combo', 'CMB-001', 2700);

    // Cadena, no diamante: el Combo llega al Colágeno **solo** a través de la
    // Premezcla. Es la forma que cualquiera arma primero al probar a mano, y es
    // donde el defecto del diamante NO aparece: por eso el test del diamante
    // está arriba y este no lo reemplaza.
    await crearReceta(premezcla, [[colageno, 2]]);
    await crearReceta(combo, [[premezcla, 1]]);

    const orderId = await crearOrden([
      { product_id: colageno.id, product_name: 'Colágeno', quantity: 10, unit_price: 1200 },
    ]);

    const res = await recibir(orderId, [{ linea: 0, cantidad: 10, actualizar_costo: true }]);

    // `recosteos` cuenta los elaborados que dependen DIRECTAMENTE del insumo:
    // acá es uno solo. Lo que se propaga es más profundo que ese número, y por
    // eso el número solo no alcanza como afirmación.
    expect(res.body.data.costos[0].recosteos).toBe(1);
    expect((await Product.findByPk(premezcla.id)).cost).toBe('2400.00');
    expect((await Product.findByPk(combo.id)).cost).toBe('2400.00');
  });

  it('dos líneas del mismo insumo NO recostean el grafo dos veces', async () => {
    const colageno = await crearProducto('Colágeno', 'COL-001', 900);
    const premezcla = await crearProducto('Premezcla', 'PRE-001', 1800);

    await crearReceta(premezcla, [[colageno, 2]]);

    const orderId = await crearOrden([
      { product_id: colageno.id, product_name: 'Colágeno', quantity: 10, unit_price: 1200 },
      { product_id: colageno.id, product_name: 'Colágeno', quantity: 5, unit_price: 1200 },
    ]);

    const res = await recibir(orderId, [
      { linea: 0, cantidad: 10, actualizar_costo: true },
      { linea: 1, cantidad: 5, actualizar_costo: true },
    ]);

    // La segunda línea vuelve a pedir el mismo costo, y el servidor **reevalúa**
    // el umbral con el costo ya actualizado: no hay cambio, así que no escribe
    // ni recorre el grafo otra vez. Sin la reevaluación, una orden de veinte
    // líneas del mismo insumo recorrería el grafo veinte veces.
    expect(res.body.data.costos).toHaveLength(1);
    expect(res.body.data.costos[0].linea).toBe(0);
  });
});

describe('Lo que crece es la cantidad de consultas, y eso sí se puede afirmar', () => {
  /** Seis productos de la empresa A, con stock en Centro. */
  async function seisProductosConStock() {
    const productos = [];

    for (let i = 0; i < 6; i++) {
      const p = await crearProducto(`Insumo ${i}`, `INS-00${i}`, 100 + i);
      await Stock.create({
        empresa_id: datos.empresaA.id, product_id: p.id,
        punto_de_venta_id: datos.centroA.id, location: 'centro',
        quantity: 5, available: 5,
      });
      productos.push(p);
    }

    return productos;
  }

  /**
   * Mide DOS recepciones equivalentes, una de una línea y otra de seis.
   *
   * ⚠ **Todo lo que se afirma abajo se afirma comparando las dos, no mirando
   * una.** El número absoluto de consultas de una recepción incluye lo que
   * hacen los middlewares antes de llegar al servicio —la sesión, la empresa, la
   * sucursal de la cabecera—, y fijarlo convertiría cualquier cambio en el borde
   * en un rojo de este archivo, que no habla del borde. Lo que sí es una
   * afirmación sobre este código es **cuánto de eso crece con las líneas**.
   */
  async function medirUnaYSeisLineas() {
    const productos = await seisProductosConStock();

    const unaLinea = await crearOrden([{
      product_id: productos[0].id, product_name: productos[0].name, quantity: 2, unit_price: 10,
    }]);

    const seisLineas = await crearOrden(productos.map((p, i) => ({
      product_id: p.id, product_name: p.name, quantity: 2, unit_price: 10 + i,
    })));

    const conUna = await capturarConsultas(sequelize, () =>
      recibir(unaLinea, [{ linea: 0, cantidad: 2 }])
    );

    const conSeis = await capturarConsultas(sequelize, () =>
      recibir(seisLineas, productos.map((_, i) => ({ linea: i, cantidad: 2 })))
    );

    expect(conUna.resultado.status).toBe(200);
    expect(conSeis.resultado.status).toBe(200);

    return { conUna: conUna.consultas, conSeis: conSeis.consultas };
  }

  it('la sucursal se resuelve las MISMAS veces con una línea que con seis', async () => {
    const { conUna, conSeis } = await medirUnaYSeisLineas();

    // `resolverSucursal` subió antes del bucle (T1204, hallazgo 5). Adentro, una
    // orden de veinte líneas eran veinte resoluciones de la misma sucursal con
    // la transacción abierta.
    expect(contra(conSeis, 'puntos_de_venta').length)
      .toBe(contra(conUna, 'puntos_de_venta').length);
  });

  it('los productos de la orden se leen en UNA consulta, no una por línea', async () => {
    const { conUna, conSeis } = await medirUnaYSeisLineas();

    // Sin `actualizar_costo` la cascada no corre, así que la única lectura de
    // `products` es la clasificación de las líneas: la que decide, de una, cuál
    // es propia, cuál no está en el catálogo y cuál es de otra empresa.
    expect(contra(conSeis, 'products').length).toBe(contra(conUna, 'products').length);
  });

  it('cada línea de más cuesta un número FIJO de consultas', async () => {
    const { conUna, conSeis } = await medirUnaYSeisLineas();

    // Dos por línea: el `SELECT … FOR UPDATE` de la fila de stock y su `UPDATE`.
    // Todo lo demás —la orden, la empresa, la sucursal, los productos, el
    // movimiento de deuda— es fijo y no depende de cuántas líneas tenga.
    //
    // Es la magnitud que el paso manual buscaba y el reloj no podía dar: si
    // alguien mete una lectura adentro del bucle, este número sube y el test lo
    // dice en cualquier máquina.
    expect(conSeis.length - conUna.length).toBe(10);
  });
});
