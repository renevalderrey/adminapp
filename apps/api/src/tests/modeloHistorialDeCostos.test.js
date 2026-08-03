// ════════════════════════════════════════════
//  El historial de costos tiene que decir de quién y de qué empresa
//
//  `product_cost_history` no tenía `empresa_id`. Toda consulta que no pasara por
//  `products` para filtrar era una consulta **sin scoping**, que es la clase de
//  agujero que este proyecto ya pagó tres veces. Y no tenía `usuario_id`: con
//  cinco caminos distintos que mueven costos, «quién» es la mitad de la
//  pregunta.
//
//  Estos tests atan el modelo a la migración 15. Un modelo que declara una
//  columna que la base no tiene no falla al arrancar: falla con un 500 la
//  primera vez que alguien abre el panel, porque Sequelize pide en el SELECT una
//  columna que no existe. Es exactamente lo que pasó con los índices de `Stock`.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const models = require('../models');

const ProductCostHistory = models.ProductCostHistory;

const MIGRACION = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '20260805-historial-de-costos-con-autor.js'),
  'utf8'
);

/**
 * El archivo sin sus comentarios.
 *
 * Las afirmaciones en negativo —«no crea foreign keys», «no toca stock»— tienen
 * que mirar el código y no la prosa que explica por qué no lo hace. Si no, el
 * comentario que documenta la decisión hace fallar el test que la protege.
 */
const CODIGO = MIGRACION
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

describe('la migración 15 agrega las dos columnas y las deja nulables', () => {
  it.each(['usuario_id', 'empresa_id'])('agrega %s a product_cost_history', (columna) => {
    expect(MIGRACION).toMatch(
      new RegExp(`addColumn\\(TABLA, '${columna}'[\\s\\S]{0,120}?allowNull: true`)
    );
  });

  it('NINGUNA de las dos es NOT NULL', () => {
    // `empresa_id` queda en null para las filas cuyo producto ya no existe:
    // obligarla sería inventar de qué empresa era un producto borrado. Y
    // `usuario_id` no se puede backfillear en absoluto.
    expect(CODIGO).not.toMatch(/allowNull: false/);
    expect(CODIGO).not.toMatch(/SET NOT NULL/);
  });

  it('no crea foreign keys: el historial sobrevive a lo que referencia', () => {
    // Una FK a `usuarios` con RESTRICT impediría dar de baja a quien alguna vez
    // tocó un costo; con SET NULL borraría la respuesta a «quién» justo cuando
    // hace falta.
    expect(CODIGO).not.toMatch(/addConstraint/);
    expect(CODIGO).not.toMatch(/references:/);
  });
});

describe('el backfill de empresa_id', () => {
  it('sale de products y no de un valor inventado', () => {
    expect(MIGRACION).toMatch(/UPDATE product_cost_history h/);
    expect(MIGRACION).toMatch(/SET empresa_id = p\.empresa_id/);
    expect(MIGRACION).toMatch(/FROM products p/);
    expect(MIGRACION).toMatch(/WHERE p\.id = h\.product_id/);
  });

  it('solo toca las filas que todavía no tienen empresa', () => {
    // Sin esta condición, correr la migración dos veces —o correrla mientras el
    // código nuevo ya escribe filas con empresa— pisaría datos buenos con el
    // resultado de un join.
    expect(MIGRACION).toMatch(/AND h\.empresa_id IS NULL/);
  });

  it('usuario_id NO se backfillea: ese dato no existe', () => {
    // Rellenarlo con «el admin de la empresa» o con el primer usuario sería
    // inventar un autor, y una firma falsa en un registro de auditoría es peor
    // que no tener firma.
    expect(CODIGO).not.toMatch(/SET usuario_id/);
    expect(CODIGO).not.toMatch(/usuario_id\s*=/);
  });
});

describe('el índice y la reversibilidad', () => {
  it('crea (empresa_id, change_date), que es la consulta que la columna habilita', () => {
    expect(CODIGO).toMatch(/CREATE INDEX IF NOT EXISTS \$\{INDICE_EMPRESA_FECHA\}/);
    expect(CODIGO).toMatch(/ON \$\{TABLA\} \(empresa_id, change_date\)/);
    expect(CODIGO).toMatch(
      /INDICE_EMPRESA_FECHA = 'product_cost_history_empresa_id_change_date'/
    );
  });

  it('el down saca el índice y las dos columnas, en orden inverso', () => {
    const down = CODIGO.slice(CODIGO.indexOf('async down('));

    expect(down).toMatch(/DROP INDEX IF EXISTS/);
    expect(down).toMatch(/removeColumn\(TABLA, 'empresa_id'/);
    expect(down).toMatch(/removeColumn\(TABLA, 'usuario_id'/);

    // El índice cuelga de `empresa_id`: sacarlo después de borrar la columna
    // sería sacar algo que Postgres ya se llevó puesto.
    expect(down.indexOf('DROP INDEX')).toBeLessThan(down.indexOf("removeColumn(TABLA, 'empresa_id'"));
  });
});

describe('el modelo declara exactamente lo que creó la migración 15', () => {
  it.each(['usuario_id', 'empresa_id'])('%s existe en el modelo y es INTEGER', (columna) => {
    // Si el nombre o el tipo no coinciden con la columna real, Sequelize pide
    // en el SELECT una columna que no existe: el panel tira en runtime, no en
    // build, y recién se ve cuando un usuario lo abre.
    const atributo = ProductCostHistory.rawAttributes[columna];

    expect(atributo).toBeDefined();
    expect(atributo.type.constructor.key).toBe('INTEGER');
  });

  it.each(['usuario_id', 'empresa_id'])('%s admite nulos, igual que la columna', (columna) => {
    expect(ProductCostHistory.rawAttributes[columna].allowNull).not.toBe(false);
  });

  it('declara el índice (empresa_id, change_date) que crea la migración', () => {
    const declarados = (ProductCostHistory.options.indexes || [])
      .map((i) => i.fields.join(','));

    expect(declarados).toContain('empresa_id,change_date');
  });
});

describe('las asociaciones, que son la parte que se olvida siempre', () => {
  // Sin ellas la columna existe, se escribe bien, y el endpoint igual no puede
  // contestar «quién»: el include de T1025 tira en runtime.
  it.each([
    ['usuario', 'Usuario', 'usuario_id'],
    ['empresa', 'Empresa', 'empresa_id'],
  ])('ProductCostHistory.%s apunta a %s por %s', (alias, modelo, fk) => {
    const asociacion = ProductCostHistory.associations[alias];

    expect(asociacion).toBeDefined();
    expect(asociacion.target.name).toBe(modelo);
    expect(asociacion.foreignKey).toBe(fk);
  });

  it('el include de usuario con { id, nombre, email } resuelve', () => {
    // Los tres campos son los que devuelve el contrato de
    // `GET /api/products/:id/cost-history`. Pedir uno que el modelo no tiene es
    // otro 500 en runtime.
    for (const campo of ['id', 'nombre', 'email']) {
      expect(models.Usuario.rawAttributes[campo]).toBeDefined();
    }
  });
});

describe('la 15 es independiente de la 14', () => {
  it('no toca stock ni puntos_de_venta', () => {
    // Es la razón por la que son dos archivos: esta es aditiva y reversible sin
    // riesgo, la 14 es el punto sin retorno. Atarlas significaría que el cambio
    // inofensivo no se puede desplegar sin el peligroso, y que el `down` del
    // peligroso se lleva puesto al inofensivo.
    expect(CODIGO).not.toMatch(/\bstock\b/);
    expect(CODIGO).not.toMatch(/puntos_de_venta/);
  });
});
