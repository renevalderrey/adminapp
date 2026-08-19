// ════════════════════════════════════════════
//  El modelo Sale y las migraciones tienen que decir lo mismo
//
//  Sequelize arma el SELECT con las columnas que declara el modelo. Si el
//  modelo declara una columna que la migracion no creo —o la crea con otro
//  nombre— nada falla al arrancar ni al hacer build: falla con un 500 la
//  primera vez que alguien abre el historial de ventas.
//
//  Este archivo es una guardia estatica del estilo de las de aislamiento: lee
//  el fuente de las migraciones y verifica que cada columna nueva del modelo
//  tenga quien la cree.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { Sale, SaleItem } = require('../models/Sale');

const MIGRACIONES = path.join(__dirname, '..', 'migrations');

// ── La migración 31, la que cambia la escala de `sale_items.quantity` ──
const ARCHIVO_DE_CANTIDADES = '20260820-cantidades-decimales.js';
const CANTIDADES = require(`../migrations/${ARCHIVO_DE_CANTIDADES}`);
const FUENTE_DE_CANTIDADES = fs.readFileSync(
  path.join(MIGRACIONES, ARCHIVO_DE_CANTIDADES),
  'utf8'
);

function fuenteDeMigraciones() {
  return fs.readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(MIGRACIONES, f), 'utf8'))
    .join('\n');
}

describe('Columnas del intento de facturacion', () => {
  // Son las dos columnas que separan «Registrada» de «Rechazada». Sin ellas
  // una venta que ARCA rechazo es indistinguible de una venta interna.
  it.each([
    ['afip_ultimo_error', 'TEXT'],
    ['afip_ultimo_intento', 'DATE'],
  ])('Sale declara %s con tipo %s', (columna, tipo) => {
    const atributo = Sale.rawAttributes[columna];

    expect(atributo).toBeDefined();
    expect(atributo.type.key).toBe(tipo);
    expect(atributo.allowNull).toBe(true);
  });

  it('las dos columnas las crea una migracion, no solo el modelo', () => {
    const fuente = fuenteDeMigraciones();

    expect(fuente).toContain("addColumn('sales', 'afip_ultimo_error'");
    expect(fuente).toContain("addColumn('sales', 'afip_ultimo_intento'");
  });

  // El mensaje de AFIP viene con un JSON.stringify adentro: un rechazo con dos
  // observaciones pasa los 255 caracteres y lo que se corta es el final, que
  // es donde esta el codigo. Un STRING(255) incumpliria «mostrar el mensaje de
  // AFIP tal cual» sin que nada lo avise.
  it('el error NO es un STRING acotado: un rechazo largo se guardaria truncado', () => {
    expect(Sale.rawAttributes.afip_ultimo_error.type.key).not.toBe('STRING');
  });
});

describe('Indice del historial', () => {
  // El listado siempre consulta empresa_id + rango de fechas. Con los indices
  // sueltos de date y empresa_id, Postgres elige uno y filtra el resto fila
  // por fila.
  it('Sale declara el compuesto (empresa_id, date)', () => {
    const indices = Sale.options.indexes || [];
    const compuesto = indices.find((i) => i.name === 'sales_empresa_date_idx');

    expect(compuesto).toBeDefined();
    expect(compuesto.fields).toEqual(['empresa_id', 'date']);
  });

  it('lo crea una migracion', () => {
    expect(fuenteDeMigraciones()).toContain('sales_empresa_date_idx');
  });

  // Sacar un indice de una tabla caliente es una migracion destructiva y estos
  // no molestan. Se fijan para que nadie los borre «de paso» al agregar el
  // compuesto.
  it('los indices sueltos anteriores se conservan', () => {
    const campos = (Sale.options.indexes || []).map((i) => JSON.stringify(i.fields));

    expect(campos).toContain(JSON.stringify(['date']));
    expect(campos).toContain(JSON.stringify(['empresa_id']));
  });
});

// ════════════════════════════════════════════
//  La cantidad de una línea de venta es DECIMAL(14,4)
//
//  ⚠ `scripts/verificar-esquema.js` no puede ver este caso: compara `udt_name`
//  y nada más (`:204`), o sea que para él `numeric(14,4)` y `numeric(12,4)` son
//  la misma columna. Un modelo escrito con menos escala que la migración
//  degradaría la columna en el próximo `sync({ alter: true })` sin que CI dijera
//  una palabra.
//
//  ── Lo que este tipo NO decide ──
//
//  Cuántos decimales admite una línea de venta lo impone un validador
//  (`utils/cantidades.js:DECIMALES_DE_UNA_LINEA_DE_VENTA`, hoy en 0), no la
//  columna. Acá está la capacidad; allá, la regla de negocio.
// ════════════════════════════════════════════
describe('sale_items.quantity y la migración dicen la misma escala', () => {
  it('la migración 31 declara 14,4 y lo escribe en el SQL, no solo en una constante', () => {
    // Las dos mitades: una lista que dice 14,4 y un `ALTER` que escribe otra
    // cosa dejarían el caso de abajo verde sobre una promesa que la base nunca
    // recibe.
    expect(CANTIDADES.PRECISION).toBe(14);
    expect(CANTIDADES.ESCALA).toBe(4);
    expect(FUENTE_DE_CANTIDADES).toContain('TYPE NUMERIC(${PRECISION}, ${ESCALA})');
  });

  it('el modelo declara DECIMAL con la MISMA precisión y escala que la migración', () => {
    const tipo = SaleItem.rawAttributes.quantity.type;

    expect(tipo.key).toBe('DECIMAL');
    expect(tipo.options.precision).toBe(CANTIDADES.PRECISION);
    expect(tipo.options.scale).toBe(CANTIDADES.ESCALA);
  });

  it('y la columna está en la lista que la migración convierte', () => {
    expect(CANTIDADES.COLUMNAS).toContainEqual({ tabla: 'sale_items', columna: 'quantity' });
  });

  it('el default sigue siendo 1: una línea sin cantidad es una unidad, no cero', () => {
    // `ALTER COLUMN … TYPE` convierte el `DEFAULT` al tipo nuevo —el 1 pasa a
    // 1.0000, que es el mismo valor—. Si alguien lo tocara al pasar, una línea
    // creada sin cantidad entraría en cero y la venta cobraría igual.
    expect(SaleItem.rawAttributes.quantity.defaultValue).toBe(1);
  });
});
