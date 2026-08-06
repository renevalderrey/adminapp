// ════════════════════════════════════════════
//  Los alias de include tienen que existir
//
//  Sequelize valida los alias de las asociaciones recien al ejecutar la
//  consulta. Un include con as:'sale' cuando la asociacion se llama 'Sale'
//  no falla al arrancar ni al cargar el modulo: falla con un 500 la primera
//  vez que alguien abre esa pantalla.
//
//  Asi estuvieron caidos /api/reports/sales y /api/reports/profit: la
//  asociacion se declaraba como SaleItem.belongsTo(Sale, { foreignKey })
//  sin `as`, con lo cual quedaba registrada bajo el nombre del modelo, y
//  reports.js pedia as:'sale' en minuscula.
//
//  Este test recorre el codigo, extrae los pares (modelo, alias) de cada
//  include y verifica contra las asociaciones reales.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const models = require('../models');

const SRC = path.join(__dirname, '..');

/** Extrae los pares { model: X, as: 'y' } de un archivo. */
function extraerIncludes(contenido) {
  const encontrados = [];

  // Los includes se escriben como { model: Algo, as: 'alias', ... }, a veces
  // con atributos intercalados entre ambas claves.
  const re = /model:\s*(\w+)\s*,\s*(?:[^{}]*?\s)?as:\s*'([^']+)'/g;

  for (const m of contenido.matchAll(re)) {
    encontrados.push({ modelo: m[1], alias: m[2] });
  }

  return encontrados;
}

function archivosDeCodigo() {
  const salida = [];
  for (const dir of ['routes', 'services']) {
    for (const f of fs.readdirSync(path.join(SRC, dir))) {
      if (!f.endsWith('.js')) continue;
      salida.push({
        nombre: `${dir}/${f}`,
        contenido: fs.readFileSync(path.join(SRC, dir, f), 'utf8'),
      });
    }
  }
  return salida;
}

describe('Alias de asociaciones usados en includes', () => {
  it.each(archivosDeCodigo())('$nombre', ({ contenido }) => {
    const problemas = [];

    for (const { modelo, alias } of extraerIncludes(contenido)) {
      const Modelo = models[modelo];

      // El identificador puede no ser un modelo (variables locales, etc.).
      if (!Modelo || !Modelo.associations) continue;

      // El alias tiene que existir en ALGUN modelo: el include puede estar
      // anidado y colgar de otro. Se verifica de forma laxa a proposito, para
      // no dar falsos positivos en includes anidados.
      const existeEnAlguno = Object.values(models).some(
        (m) => m && m.associations && Object.keys(m.associations).includes(alias)
      );

      if (!existeEnAlguno) {
        problemas.push(`include de ${modelo} con as: '${alias}' — ese alias no existe en ninguna asociacion`);
      }
    }

    expect(problemas).toEqual([]);
  });
});

describe('Asociaciones que el codigo da por sentadas', () => {
  // Estas se rompieron antes o son las que sostienen los reportes. Se fijan
  // de forma explicita para que renombrarlas falle el test en vez de un 500.
  it.each([
    ['SaleItem', 'sale'],
    ['SaleItem', 'product'],
    ['Sale', 'items'],
    ['Sale', 'customer'],
    ['Customer', 'sales'],
    ['Customer', 'payments'],
    ['Recipe', 'items'],
    ['RecipeItem', 'ingredient'],
    ['Product', 'recipe'],
    ['Product', 'stock'],
    ['ProductionOrder', 'items'],
    ['Empresa', 'puntosDeVenta'],
    // Estas tres estaban declaradas sin `as`, con lo cual quedaban registradas
    // como 'Supplier' (el nombre del modelo) y purchaseService las pedia como
    // 'supplier'. Las tres rutas de ordenes de compra respondian 500 con un
    // SequelizeEagerLoadingError: es el mismo error que dejo caidos
    // /api/reports/sales y /api/reports/profit. La comprobacion laxa de mas
    // arriba no lo veia porque el alias 'supplier' SI existe... en Product.
    ['SupplierOrder', 'supplier'],
    ['SupplierMovement', 'supplier'],
    ['SupplierDocument', 'supplier'],
  ])('%s.%s existe', (modelo, alias) => {
    expect(Object.keys(models[modelo].associations)).toContain(alias);
  });
});

describe('Los cinco modelos de TiendaNube', () => {
  // Los cinco son de la funcionalidad 013 y son un caso al reves de todo lo de
  // arriba: aca lo que hay que fijar no es que una asociacion exista, sino que
  // NO exista ninguna.
  const NUEVOS = [
    'TiendanubeTienda',
    'TiendanubeEstadoOauth',
    'TiendanubeVariante',
    'TiendanubePedido',
    'TiendanubeCorrida',
  ];

  it('los cinco estan registrados en index.js', () => {
    // `scripts/verificar-esquema.js` hace un `findOne` POR MODELO de src/models
    // (:288). Una tabla cuyo modelo no este registrado aca NO se compara contra
    // information_schema, asi que una columna que la migracion se olvide pasa
    // desapercibida hasta que alguien recrea la base. Ese es el unico motivo por
    // el que estos cinco se registran, y alcanza.
    expect(NUEVOS.filter((nombre) => !models[nombre])).toEqual([]);
  });

  const DE_TIENDANUBE = [...NUEVOS, 'TiendanubeMapping'];

  it('ninguno declara asociaciones: el ancla de includes no se mueve', () => {
    // Declarar `Product.hasOne(TiendanubeVariante)` o
    // `Product.hasMany(TiendanubeMapping)` haria que `analizarIncludes`
    // (aislamientoEmpresas.test.js) clasificara cualquier include de esas tablas
    // como «hijo con empresa_id» y subiria su ancla de toBe(4). Ninguna consulta
    // del hito 013 usa include: se traen las filas planas y se unen en JS, que
    // es el mismo corte que tomo la funcionalidad 012.
    for (const nombre of DE_TIENDANUBE) {
      expect(Object.keys(models[nombre].associations)).toEqual([]);
    }
  });

  it('y NINGUN otro modelo las apunta: `Product.hasOne(TiendanubeVariante)` tampoco', () => {
    // La mitad que el caso de arriba no cubre, y es la que importa. Una
    // asociacion se registra en el modelo que la DECLARA, no en el destino: con
    // `Product.hasOne(TiendanubeVariante)` escrito en index.js,
    // `TiendanubeVariante.associations` sigue vacio y el caso anterior pasa en
    // verde — verificado ejecutandolo. Lo que `analizarIncludes` mira es
    // justamente el destino (`asoc.target`), asi que esa forma es exactamente la
    // que movería el ancla sin que nada avisara.
    const tablas = new Set(DE_TIENDANUBE.map((n) => models[n].getTableName()));
    const apuntando = [];

    for (const [nombre, Modelo] of Object.entries(models)) {
      if (!Modelo || !Modelo.associations) continue;

      for (const [alias, asoc] of Object.entries(Modelo.associations)) {
        if (asoc.target && tablas.has(asoc.target.getTableName())) {
          apuntando.push(`${nombre}.${alias} → ${asoc.target.name}`);
        }
      }
    }

    expect(apuntando).toEqual([]);
  });
});
