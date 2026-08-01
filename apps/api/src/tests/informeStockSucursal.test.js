// ════════════════════════════════════════════
//  Guardia: el informe de sucursales no escribe nada
//
//  El informe existe para mirarlo ANTES de autorizar la migración que fusiona
//  filas de inventario. Si alguna vez escribiera algo, dejaría de ser una
//  vista previa y pasaría a ser un ensayo — y nadie lo correría contra la base
//  del cliente, que es justo donde hace falta.
//
//  Que hoy sea de solo lectura se ve leyendo el archivo. Que lo siga siendo
//  dentro de seis meses no se ve: por eso esta guardia. Es del mismo estilo
//  que las de aislamientoEmpresas.test.js — grosera a propósito.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, '..', '..', 'scripts', 'informe-stock-sucursal.js');

/**
 * Los patrones que convertirían el informe en una escritura.
 *
 * `updated_at` se lee y se imprime, así que "update" suelto no sirve: el
 * patrón pide la forma que escribe (`.update(`, o el SQL con su palabra
 * clave). Una guardia que salta con el nombre de una columna se termina
 * comentando.
 */
const ESCRITURAS = [
  ['INSERT', /\bINSERT\s+INTO\b/i],
  ['UPDATE', /\bUPDATE\s+\w/i],
  ['DELETE', /\bDELETE\s+FROM\b/i],
  ['TRUNCATE', /\bTRUNCATE\b/i],
  ['ALTER', /\bALTER\s+TABLE\b/i],
  ['DROP', /\bDROP\s+(TABLE|INDEX|COLUMN)\b/i],
  ['CREATE', /\bCREATE\s+(TABLE|INDEX|UNIQUE)\b/i],
  ['.create(', /\.create\(/],
  ['.update(', /\.update\(/],
  ['.destroy(', /\.destroy\(/],
  ['.bulkCreate(', /\.bulkCreate\(/],
  ['.findOrCreate(', /\.findOrCreate\(/],
  ['.save(', /\.save\(/],
  ['.increment(', /\.increment\(/],
  ['.decrement(', /\.decrement\(/],
  ['.upsert(', /\.upsert\(/],
  ['transaction', /transaction/i],
  ['sync(', /\bsync\(/],
];

describe('scripts/informe-stock-sucursal.js', () => {
  const contenido = fs.readFileSync(RUTA, 'utf8');

  it.each(ESCRITURAS)('no contiene ninguna escritura: %s', (_nombre, patron) => {
    const hallazgos = contenido
      .split('\n')
      .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
      .filter(({ texto }) => patron.test(texto))
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(hallazgos).toEqual([]);
  });

  it('corre la MISMA función que la migración, no una segunda opinión', () => {
    // Si el informe calculara las fusiones por su cuenta, sería una segunda
    // implementación de la misma regla, y la que importa —la que escribe— es
    // la que nadie miró.
    expect(contenido).toContain("require('../src/utils/consolidacionDeStock')");
    expect(contenido).toContain('planificar(');
  });

  it('está enganchado en package.json como informe:stock', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
    );

    expect(pkg.scripts['informe:stock']).toBe('node scripts/informe-stock-sucursal.js');
  });
});
