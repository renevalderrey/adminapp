// ════════════════════════════════════════════
//  El modelo Stock tiene que decir lo que la base realmente tiene
//
//  `models/Stock.js` declaraba un único `(product_id, punto_de_venta_id)` que
//  la base **no tenía**: esa lista de `indexes` solo la aplica `sequelize.sync()`,
//  que este proyecto no usa, y lo que Postgres tenía era el único
//  `(product_id, location)` que puso `20260531-initial-schema.js:544`.
//
//  Esa mentira no rompió nada visible, e hizo algo peor: la spec de esta
//  funcionalidad diagnosticó mal el problema. FR-042 dice «el índice no separa
//  por los nulos» cuando el motivo real era que el índice no existía. Un modelo
//  que describe un esquema que nadie aplicó es peor que no documentar nada,
//  porque se lee como si fuera cierto.
//
//  Estos tests atan el modelo a la migración 14, que es la que sí toca la base.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const Stock = require('../models/Stock');

const MIGRACION = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '20260804-identidad-de-sucursal-en-stock.js'),
  'utf8'
);

describe('punto_de_venta_id es la identidad de la sucursal', () => {
  it('NO admite nulos, como la columna en la base después de la migración 14', () => {
    // Una fila de stock sin sucursal es mercadería que la pantalla no puede
    // mostrar y que una venta no puede descontar: la consulta que busca por
    // `punto_de_venta_id` no la encuentra nunca. Si el modelo la sigue
    // declarando nullable, Sequelize deja pasar el insert y falla Postgres,
    // con un error de constraint en vez de una validación que diga qué falta.
    expect(Stock.rawAttributes.punto_de_venta_id.allowNull).toBe(false);
  });

  it('la migración 14 es la que aplica ese NOT NULL', () => {
    expect(MIGRACION).toMatch(/ALTER COLUMN punto_de_venta_id SET NOT NULL/);
  });
});

describe('la lista de indexes describe la base y no un deseo', () => {
  const declarados = Stock.options.indexes || [];
  const unicos = declarados.filter((i) => i.unique).map((i) => i.fields.join(','));

  it('declara el único (product_id, punto_de_venta_id) que crea la migración 14', () => {
    expect(unicos).toContain('product_id,punto_de_venta_id');
    expect(MIGRACION).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \$\{INDICE_NUEVO\}|stock_product_id_punto_de_venta_id/);
  });

  it('NO declara un único sobre (product_id, location): la migración lo elimina', () => {
    // Es la decisión 6: dos sucursales sin `code` y con el mismo `name`
    // producen el mismo espejo, y ese único haría fallar el INSERT de una fila
    // de stock legítima. Declararlo acá lo devolvería en el próximo `sync()`
    // de alguien.
    expect(unicos).not.toContain('product_id,location');
    expect(MIGRACION).toMatch(/DROP INDEX IF EXISTS \$\{INDICE_VIEJO\}|stock_product_id_location/);
  });

  it('los no únicos son los tres que existen en la base', () => {
    const comunes = declarados.filter((i) => !i.unique).map((i) => i.fields.join(','));

    expect(comunes.sort()).toEqual(['empresa_id', 'location', 'punto_de_venta_id']);
  });
});
