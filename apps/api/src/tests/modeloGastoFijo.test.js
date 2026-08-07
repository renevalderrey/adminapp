// ════════════════════════════════════════════
//  El modelo del gasto fijo, y la columna que dejó de significar algo
//
//  `group` era «gf1» / «gf2», los dos bloques del sistema viejo de Comprafit
//  (`scripts/migrar-legacy.js:379`). Después de la 014 nadie la lee —el agrupado
//  sale de `punto_de_venta_id`— y nadie la escribe desde el cuerpo del request.
//
//  Lo que se le saca es el `defaultValue: 'gf1'` del MODELO. La columna se
//  queda: borrarla no es reversible y no gana nada, que es la misma decisión que
//  la 013 tomó con `products.tiendanube_variant_id`.
//
//  ── Qué protege este archivo, y qué NO ──
//
//  Protege el **efecto colateral** que ese cambio podría introducir el día del
//  deploy: la columna es `STRING(10) NOT NULL`, así que sin `defaultValue` en el
//  modelo un `create` sin `group` depende del `DEFAULT` de la BASE. Si ese
//  DEFAULT no estuviera, cada alta de gasto fijo respondería 500 con un
//  «null value in column "group" violates not-null constraint» — y sería el
//  primer alta después del deploy, no un caso raro.
//
//  ⚠⚠ **Y `data-model.md` describe mal la red que lo evita.** Dice que sin
//  `defaultValue` en el modelo un `FixedExpense.create({...})` sin `group`
//  «usa el DEFAULT de la base y no falla». **No es cierto, y se verificó
//  ejecutándolo**: `allowNull: false` hace que Sequelize valide ANTES de armar
//  el INSERT y tire `notNull Violation: FixedExpense.group cannot be null`. La
//  sentencia no se emite nunca, así que el `DEFAULT 'gf1'` de Postgres no llega
//  a intervenir.
//
//  Lo que de verdad evita el 500 es que **la ruta escriba la columna siempre**
//  (`grupoDe()` en `routes/general.js`). Eso se verifica ejecutado, en
//  `tests/integracion/gastos.integracion.test.js`. Acá queda la mitad estática:
//  que el modelo ya no siembra «gf1» y que el DEFAULT de la base sigue puesto
//  como segunda red para las escrituras que NO pasan por Sequelize —la
//  migración de datos del corte 5 y `scripts/migrar-legacy.js`—.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const FixedExpense = require('../models/FixedExpense');

const ESQUEMA_INICIAL = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '20260531-initial-schema.js'),
  'utf8'
);

describe('fixed_expenses.group es dato muerto, y sigue siendo NOT NULL', () => {
  it('el modelo YA NO le pone «gf1» por defecto', () => {
    // Con el `defaultValue` puesto, todo gasto nuevo seguía naciendo con el
    // grupo del legacy: una columna que nadie lee pero que sigue creciendo con
    // un valor que significa «Ortiz de Ocampo» en una empresa que no es
    // Comprafit.
    expect(FixedExpense.rawAttributes.group.defaultValue).toBeUndefined();
  });

  it('la columna sigue siendo NOT NULL: no se borra ni se afloja', () => {
    expect(FixedExpense.rawAttributes.group.allowNull).toBe(false);
  });

  it('el DEFAULT de la base sigue puesto, para las escrituras que no pasan por Sequelize', () => {
    // No es lo que salva al alta —eso lo hace `grupoDe()` en la ruta, porque
    // Sequelize valida el NOT NULL del lado del cliente— pero sí lo que salva a
    // un `INSERT` de la migración de datos o de `scripts/migrar-legacy.js`.
    expect(ESQUEMA_INICIAL).toMatch(
      /group:\s*\{\s*type:\s*Sequelize\.STRING\(10\),\s*allowNull:\s*false,\s*defaultValue:\s*'gf1'\s*\}/
    );
  });

  it('punto_de_venta_id sigue admitiendo nulos: «General» es un caso legítimo', () => {
    // Al revés que `stock.punto_de_venta_id`, que es NOT NULL. Un gasto fijo
    // sin sucursal se dibuja en «General» (FR-022), así que el día que alguien
    // le ponga NOT NULL «para que quede prolijo», la pantalla pierde su bucket
    // y el alta sin sucursal empieza a fallar.
    expect(FixedExpense.rawAttributes.punto_de_venta_id.allowNull).toBe(true);
  });
});
