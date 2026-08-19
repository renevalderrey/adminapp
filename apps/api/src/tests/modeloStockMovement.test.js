const fs = require('fs');
const path = require('path');
const StockMovement = require('../models/StockMovement');

// ════════════════════════════════════════════
//  El historial de movimientos tiene que poder representar lo que fotografía
//
//  ── Por qué este archivo nace recién ahora ──
//
//  `stock_movements` es uno de los dos modelos de esta funcionalidad que **no
//  tenía ninguna guardia**, y por eso es de los que se degradan sin que nadie se
//  entere: sus cuatro columnas son la foto de `stock.quantity` y
//  `stock.available` antes y después de cada movimiento. Si la foto tuviera
//  menos precisión que lo fotografiado, el historial diría que un stock pasó de
//  10 a 10 cuando pasó de 10 a 9,6 — y el historial es lo único que queda para
//  contestar qué se movió.
//
//  ── Por qué no alcanza con `scripts/verificar-esquema.js` ──
//
//  Ese script compara `udt_name` y nada más (`:204`): para él `numeric(14,4)` y
//  `numeric(12,4)` son la misma columna. O sea que verifica que sea `numeric`,
//  **no que la escala sea la correcta**. Enseñarle la escala es tentador y son
//  diez líneas, pero pasaría a comparar todas las columnas `DECIMAL` del
//  repositorio contra la base real y bastaría un `DECIMAL(12,2)` viejo creado
//  como `numeric(10,2)` para poner en rojo el job por algo ajeno a esta
//  funcionalidad. El motivo está escrito en `plan.md`, decisión «La escala de la
//  columna se ata con una guardia estática».
//
//  ── Las dos mitades ──
//
//  Por separado no dicen nada: el modelo puede declarar 14,4 con la migración
//  escribiendo otra cosa, y al revés. Se leen las dos puntas.
// ════════════════════════════════════════════

const ARCHIVO = '20260820-cantidades-decimales.js';
const MIGRACION = require(`../migrations/${ARCHIVO}`);
const FUENTE = fs.readFileSync(path.join(__dirname, '..', 'migrations', ARCHIVO), 'utf8');

/** Las cuatro que migran. Son todas las cantidades de la tabla. */
const LAS_CUATRO = [
  'cantidad_anterior',
  'cantidad_nueva',
  'disponible_anterior',
  'disponible_nuevo',
];

describe('Las cuatro cantidades de stock_movements son DECIMAL(14,4)', () => {
  it('la migración 31 declara la escala Y la escribe en el SQL', () => {
    // Ancla y primera mitad. Una constante en 14,4 con un `ALTER` que escribe
    // otra cosa dejaría los cuatro casos de abajo verdes sobre una promesa que
    // la base nunca recibe.
    expect(MIGRACION.PRECISION).toBe(14);
    expect(MIGRACION.ESCALA).toBe(4);
    expect(FUENTE).toContain('TYPE NUMERIC(${PRECISION}, ${ESCALA})');
  });

  it.each(LAS_CUATRO)('el modelo declara %s con la MISMA escala que la migración', (columna) => {
    const tipo = StockMovement.rawAttributes[columna].type;

    expect(tipo.key).toBe('DECIMAL');
    expect(tipo.options.precision).toBe(MIGRACION.PRECISION);
    expect(tipo.options.scale).toBe(MIGRACION.ESCALA);
  });

  it.each(LAS_CUATRO)('y la migración convierte %s, o el modelo estaría solo', (columna) => {
    // La otra mitad: un modelo en `DECIMAL(14,4)` sobre una columna que ninguna
    // migración convirtió es Sequelize leyendo texto de una columna `INTEGER`.
    expect(MIGRACION.COLUMNAS).toContainEqual({ tabla: 'stock_movements', columna });
  });

  it('las cuatro siguen sin admitir nulos: un movimiento sin foto no explica nada', () => {
    // `ALTER COLUMN … TYPE` conserva el `NOT NULL`, así que esto describe lo que
    // la base tiene. Se fija acá porque un movimiento con la cantidad anterior
    // en `NULL` es una fila de auditoría que no dice de dónde vino el stock.
    for (const columna of LAS_CUATRO) {
      expect(StockMovement.rawAttributes[columna].allowNull).toBe(false);
    }
  });
});
