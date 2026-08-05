const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  Los índices que la migración crea son los que el modelo declara
//
//  El proyecto 0 de `docs/PROXIMOS-PROYECTOS.md` cierra con «faltan además tres
//  índices que los modelos declaran y las migraciones no crean». Este hito no
//  puede agregar un cuarto caso **al revés**: un índice que la migración crea y
//  el modelo no declara desaparecería la primera vez que alguien levante una
//  base con `sync({ alter: true })`, y nadie lo notaría porque el SELECT sigue
//  funcionando —solo tarda—.
//
//  Y hace falta que los NOMBRES coincidan. Sequelize nombra los índices de un
//  modelo como `<tabla>_<col>_<col>`; la migración los llama `idx_…`. Sobre una
//  base migrada, un `sync({ alter: true })` en desarrollo intentaría crear un
//  **segundo** índice con su propio nombre sobre las mismas columnas.
//
//  Es una comparación de texto y es grosera a propósito: el desajuste no lo ve
//  ningún test de comportamiento —un SELECT sin índice devuelve lo mismo— y
//  aparece meses después como una consulta lenta que nadie sabe de dónde salió.
//  `scripts/verificar-esquema.js` tampoco lo ve: hace un `findOne` por modelo.
// ════════════════════════════════════════════

const SRC = path.join(__dirname, '..');

const migracion = fs.readFileSync(
  path.join(SRC, 'migrations', '20260808-indices-de-empresa-en-proveedores.js'),
  'utf8'
);
const modelo = fs.readFileSync(path.join(SRC, 'models', 'Supplier.js'), 'utf8');

/** `{ nombre: 'idx_…', tabla: '…', columnas: 'a, b' }` de la migración. */
function indicesDeLaMigracion(texto) {
  return [...texto.matchAll(
    /\{\s*nombre:\s*'(idx_\w+)',\s*tabla:\s*'(\w+)',\s*columnas:\s*'([^']+)'\s*\}/g
  )].map((m) => ({
    nombre: m[1],
    tabla: m[2],
    columnas: m[3].split(',').map((c) => c.trim()),
  }));
}

/** `{ name: 'idx_…', fields: ['a', 'b'] }` del modelo. */
function indicesDelModelo(texto) {
  return [...texto.matchAll(
    /\{\s*name:\s*'(idx_\w+)',\s*fields:\s*\[([^\]]+)\]\s*\}/g
  )].map((m) => ({
    nombre: m[1],
    columnas: m[2].split(',').map((c) => c.trim().replace(/'/g, '')),
  }));
}

describe('Los cuatro índices de proveedores', () => {
  const deLaMigracion = indicesDeLaMigracion(migracion);
  const delModelo = indicesDelModelo(modelo);

  it('el lector encuentra los índices que dice leer', () => {
    // Ancla. Sin esto, un cambio de formato dejaría a las dos listas vacías y
    // el test pasaría comparando nada contra nada.
    expect(deLaMigracion).toHaveLength(4);
    expect(delModelo).toHaveLength(4);
  });

  it('los cuatro índices del modelo tienen el MISMO nombre que los de la migración', () => {
    expect([...delModelo.map((i) => i.nombre)].sort())
      .toEqual([...deLaMigracion.map((i) => i.nombre)].sort());
  });

  it('y las MISMAS columnas, en el mismo orden', () => {
    // El orden importa: `(empresa_id, status)` y `(status, empresa_id)` no son
    // el mismo índice, y solo el primero sirve para filtrar por empresa.
    const porNombre = new Map(delModelo.map((i) => [i.nombre, i.columnas]));

    for (const { nombre, columnas } of deLaMigracion) {
      expect(porNombre.get(nombre)).toEqual(columnas);
    }
  });

  it('los cuatro son de las tres tablas hijas y arrancan por empresa_id', () => {
    // `empresa_id` primero es lo que hace que el índice sirva: es la única
    // columna que está en las cuatro consultas.
    for (const { tabla, columnas } of deLaMigracion) {
      expect(['supplier_movements', 'supplier_orders', 'supplier_documents']).toContain(tabla);
      expect(columnas[0]).toBe('empresa_id');
    }
  });

  it('el down borra exactamente los mismos que el up crea', () => {
    // Un `down` que no revierte todo deja una base que el `up` no puede volver
    // a correr, y con eso la migración deja de poder recrear la base.
    expect(migracion).toMatch(/DROP INDEX IF EXISTS/);
    expect(migracion).toMatch(/\[\.\.\.INDICES\]\.reverse\(\)/);
  });
});
