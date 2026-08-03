// ════════════════════════════════════════════
//  El seeder de puntos de venta ya no manda sobre el stock, y avisa si falla
//
//  Dos cambios, y los dos son de los que no se ven:
//
//   1. **El mapeo de `Stock` se fue a la migración 14.** El seeder solo sabía
//      mapear lo que coincidía exacto por `code` y dejaba el resto en `null`.
//      La migración además cae al punto de venta por defecto, consolida los
//      duplicados y archiva lo que borra. Dejar el mapeo acá no rompía nada:
//      hacía algo peor, sugerirle a quien lee el archivo que el seeder sigue
//      siendo el dueño del stock.
//
//   2. **El `catch` relanza.** Se tragaba el error y el arranque seguía. El
//      alcance de ese catch son las 70 líneas enteras: un error mapeando
//      `Sale` dejaba sin mapear `ProductionOrder` y `StockTransfer`, y la API
//      levantaba con la mitad del trabajo hecho y ningún síntoma.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const FUENTE = fs.readFileSync(path.join(__dirname, '..', 'seedPuntosDeVenta.js'), 'utf8');

/** Los dobles: alcanza con lo que el seeder usa realmente. */
function modelosFalsos({ empresas = [], falla = null } = {}) {
  const vacio = {
    findAll: async () => [],
    findOne: async () => null,
    count: async () => 0,
    create: async () => ({}),
  };

  return {
    Empresa: {
      findAll: async () => {
        if (falla) throw falla;
        return empresas;
      },
    },
    PuntoDeVenta: { ...vacio, count: async () => 1 },
    Sale: vacio,
    ProductionOrder: vacio,
    StockTransfer: vacio,
  };
}

describe('el seeder no toca el stock', () => {
  it('NO mapea Stock: eso lo hace la migración 14', () => {
    // `Dockerfile:44` es `node scripts/migrar.js && node src/server.js`: la
    // migración corre antes que el seeder en todos los arranques, así que no
    // queda ninguna fila de stock sin sucursal que mapear.
    expect(FUENTE).not.toMatch(/mapLocationField\(Stock/);
    expect(FUENTE).not.toMatch(/require\('\.\/models'\)[\s\S]{0,120}\bStock\b/);
  });

  it('SÍ sigue mapeando sales, production_orders y stock_transfers', () => {
    // Esas tres tablas no se migran (Fuera de alcance). Si al sacar el mapeo
    // de `Stock` se llevara puesto alguno de estos, se rompería el punto de
    // venta de las ventas viejas y nada lo detectaría.
    expect(FUENTE).toMatch(/mapLocationField\(Sale/);
    expect(FUENTE).toMatch(/mapLocationField\(ProductionOrder/);
    expect(FUENTE).toMatch(/StockTransfer\.findAll/);
  });
});

describe('un error del seeder tumba el arranque en vez de esconderse', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock('../models');
    jest.resetModules();
  });

  /** Carga el seeder con los dobles puestos. `require` va DESPUÉS del doMock. */
  function seederCon(opciones) {
    jest.doMock('../models', () => modelosFalsos(opciones));
    return require('../seedPuntosDeVenta');
  }

  it('relanza el error en vez de tragárselo', async () => {
    const seed = seederCon({ falla: new Error('la base se cayó a mitad del mapeo') });

    await expect(seed()).rejects.toThrow('la base se cayó a mitad del mapeo');
  });

  it('y un arranque limpio NO tira', async () => {
    // La contracara, y hay que probarla: el precio de equivocarse con lo de
    // arriba es que la API no levanta.
    const seed = seederCon({ empresas: [] });

    await expect(seed()).resolves.toBeUndefined();
  });
});
