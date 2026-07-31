// ════════════════════════════════════════════
//  Migracion desde el sistema legacy (Comprafit)
//
//  Lo que se prueba es la parte que decide QUE se migra y ADONDE. La escritura
//  en la base se ejercita a mano contra una base de prueba: aca no hay
//  conexion.
//
//  El script anterior (src/migrate.js) no tenia ni un test, y empezaba con un
//  sync({ force: true }) que borraba todas las tablas.
// ════════════════════════════════════════════

const path = require('path');
const fs = require('fs');

const { categoriaDe, leerArgumentos, parsear, extraerDelHtml } =
  require('../../scripts/migrar-legacy');

describe('leerArgumentos', () => {
  const invocar = (...args) => leerArgumentos(['node', 'script', ...args]);

  it('sin --empresa deja el destino sin definir, para que el script corte', () => {
    expect(invocar().empresa).toBeNull();
  });

  it('no escribe si no esta --confirmar', () => {
    expect(invocar('--empresa=3').confirmar).toBe(false);
    expect(invocar('--empresa=3', '--confirmar').confirmar).toBe(true);
  });

  it('lee la empresa y la sucursal', () => {
    const args = invocar('--empresa=7', '--sucursal=ortiz');
    expect(args.empresa).toBe(7);
    expect(args.sucursal).toBe('ortiz');
  });

  it('una empresa no numerica queda invalida y no cae en la 1', () => {
    // El patron viejo del sistema era caer en la empresa 1 ante la duda, que
    // en produccion es un cliente real.
    expect(Number.isInteger(invocar('--empresa=abc').empresa)).toBe(false);
  });
});

describe('parsear', () => {
  it('acepta JSON en texto y objetos ya parseados', () => {
    expect(parsear('[1,2]')).toEqual([1, 2]);
    expect(parsear([1, 2])).toEqual([1, 2]);
  });

  it('ante un JSON roto devuelve el default en vez de explotar', () => {
    expect(parsear('{roto', [])).toEqual([]);
    expect(parsear(null, [])).toEqual([]);
  });
});

describe('categoriaDe', () => {
  it.each([
    ['Whey Protein 1kg - Star Nutrition', 'proteina'],
    ['Creatina Monohidrato 300g', 'creatina'],
    ['Pack Whey + Creatina', 'pack'],
    ['Shaker 600ml', 'acc'],
    ['Barra IronBar', 'barra'],
    ['Omega 3 90caps', 'vitamina'],
    ['BCAA 2000 120caps', 'colageno'],
    ['Algo que no existe', 'otro'],
  ])('%s → %s', (nombre, esperada) => {
    expect(categoriaDe(nombre)).toBe(esperada);
  });

  it('no rompe con nombre vacio', () => {
    expect(categoriaDe(undefined)).toBe('otro');
  });
});

describe('extraerDelHtml', () => {
  const RUTA = path.join(__dirname, '..', '..', '..', '..', 'legacy', 'index-legacy.html');
  const hayHtml = fs.existsSync(RUTA);

  // Si algun dia se saca el legacy del repo, el test se saltea en vez de
  // fallar: lo que se prueba es el extractor, no que el archivo siga ahi.
  const pruebaSiHay = hayHtml ? it : it.skip;

  pruebaSiHay('encuentra los cinco arrays semilla', () => {
    const datos = extraerDelHtml();

    expect(datos).not.toBeNull();
    expect(Object.keys(datos).sort()).toEqual(
      ['cf_db', 'cf_gf1', 'cf_gf2', 'cf_marcas', 'cf_stock']
    );
  });

  pruebaSiHay('los productos salen con nombre y costo utilizables', () => {
    const { cf_db: productos } = extraerDelHtml();

    expect(productos.length).toBeGreaterThan(0);

    for (const p of productos) {
      expect(typeof p.n).toBe('string');
      expect(p.n.length).toBeGreaterThan(0);
      expect(Number.isFinite(Number(p.c ?? 0))).toBe(true);
    }
  });

  pruebaSiHay('el stock sale con nombre y cantidad numerica', () => {
    const { cf_stock: stock } = extraerDelHtml();

    expect(stock.length).toBeGreaterThan(0);

    for (const s of stock) {
      expect(typeof s.n).toBe('string');
      expect(Number.isFinite(Number(s.cant ?? 0))).toBe(true);
    }
  });

  pruebaSiHay('los gastos fijos salen con nombre e importe', () => {
    const { cf_gf1: gastos } = extraerDelHtml();

    for (const g of gastos) {
      expect(typeof g.n).toBe('string');
      expect(Number.isFinite(Number(g.v))).toBe(true);
    }
  });
});
