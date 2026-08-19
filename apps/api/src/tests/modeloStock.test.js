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

// ── La migración 31, la que cambia la escala de las tres cantidades ──
const ARCHIVO_DE_CANTIDADES = '20260820-cantidades-decimales.js';
const CANTIDADES = require(`../migrations/${ARCHIVO_DE_CANTIDADES}`);
const FUENTE_DE_CANTIDADES = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', ARCHIVO_DE_CANTIDADES),
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

// ════════════════════════════════════════════
//  La escala de las tres cantidades, atada a la migración que la escribe
//
//  ⚠ Esto no lo puede ver `scripts/verificar-esquema.js`: compara `udt_name` y
//  nada más (`:204`), así que para él `numeric(14,4)` y `numeric(12,4)` son la
//  misma columna. O sea que alguien puede escribir `DECIMAL(12,4)` en el modelo,
//  el job «API — la imagen arranca y migra» sale en verde, y la degradación de
//  la escala solo aparece el día que un `sync({ alter: true })` de desarrollo la
//  aplique — o nunca, con el modelo mintiendo para siempre.
//
//  Las DOS mitades hacen falta y por separado no dicen nada: el modelo puede
//  declarar 14,4 y la migración escribir otra cosa, y al revés.
// ════════════════════════════════════════════
describe('quantity, available y min_stock son DECIMAL(14,4) y no INTEGER', () => {
  const LAS_TRES = ['quantity', 'available', 'min_stock'];

  it('la migración 31 declara la escala y la escribe en el SQL, no solo en una constante', () => {
    // Ancla y primera mitad. Una lista que dice 14,4 y un `ALTER` que escribe
    // otra cosa dejarían los cuatro casos de abajo pasando sobre una promesa que
    // la base nunca recibe — es el mismo par de mitades que
    // `reversibilidadDeMigraciones.test.js` exige para el UNIQUE de `sesiones`.
    expect(CANTIDADES.PRECISION).toBe(14);
    expect(CANTIDADES.ESCALA).toBe(4);
    expect(FUENTE_DE_CANTIDADES).toContain('TYPE NUMERIC(${PRECISION}, ${ESCALA})');
  });

  it.each(LAS_TRES)('el modelo declara stock.%s con la MISMA escala que la migración', (columna) => {
    const tipo = Stock.rawAttributes[columna].type;

    expect(tipo.key).toBe('DECIMAL');
    expect(tipo.options.precision).toBe(CANTIDADES.PRECISION);
    expect(tipo.options.scale).toBe(CANTIDADES.ESCALA);
  });

  it.each(LAS_TRES)('y la migración convierte stock.%s, o el modelo estaría solo', (columna) => {
    // La otra mitad: un modelo en `DECIMAL(14,4)` sobre una columna que ninguna
    // migración convirtió es una fila que Sequelize lee como texto de una
    // columna `INTEGER`, y nadie lo nota hasta la primera suma.
    expect(CANTIDADES.COLUMNAS).toContainEqual({ tabla: 'stock', columna });
  });
});
