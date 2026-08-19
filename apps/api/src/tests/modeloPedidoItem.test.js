const fs = require('fs');
const path = require('path');
const PedidoItem = require('../models/PedidoItem');

// ════════════════════════════════════════════
//  La cantidad de una línea de pedido, atada a la migración que la convierte
//
//  ── Por qué esta columna migra si nada escribe decimales en ella ──
//
//  Hoy nada lo hace: `apps/tienda/src/carrito.js:55` hace `Math.floor` y la
//  tienda pública sigue vendiendo por unidad. Lo que sí puede ser fraccionario
//  es de dónde sale el recorte por stock —`stock.quantity`—, así que dejarla en
//  `INTEGER` sería sembrar el mismo redondeo silencioso en la única columna de
//  cantidad que quedó afuera.
//
//  ── Por qué este archivo nace recién ahora ──
//
//  `pedido_items` es el otro modelo de esta funcionalidad que no tenía ninguna
//  guardia. Un modelo sin guardia es el que se degrada sin que nadie se entere,
//  y acá el defecto sería mudo por partida doble: la línea de pedido se guarda
//  redondeada y el pedido cierra igual.
//
//  ── Por qué no alcanza con `scripts/verificar-esquema.js` ──
//
//  Compara `udt_name` y nada más (`:204`): para él `numeric(14,4)` y
//  `numeric(12,4)` son la misma columna. Verifica que sea `numeric`, no que la
//  escala sea la correcta. El motivo de no tocarlo está en `plan.md`, decisión
//  «La escala de la columna se ata con una guardia estática».
// ════════════════════════════════════════════

const ARCHIVO = '20260820-cantidades-decimales.js';
const MIGRACION = require(`../migrations/${ARCHIVO}`);
const FUENTE = fs.readFileSync(path.join(__dirname, '..', 'migrations', ARCHIVO), 'utf8');

describe('pedido_items.cantidad es DECIMAL(14,4) en el modelo y en la migración', () => {
  it('la migración 31 declara la escala Y la escribe en el SQL', () => {
    // Ancla y primera mitad: una constante en 14,4 con un `ALTER` que escribe
    // otra cosa dejaría el caso de abajo verde sobre una promesa que la base
    // nunca recibe.
    expect(MIGRACION.PRECISION).toBe(14);
    expect(MIGRACION.ESCALA).toBe(4);
    expect(FUENTE).toContain('TYPE NUMERIC(${PRECISION}, ${ESCALA})');
  });

  it('el modelo declara la MISMA precisión y escala que la migración', () => {
    const tipo = PedidoItem.rawAttributes.cantidad.type;

    expect(tipo.key).toBe('DECIMAL');
    expect(tipo.options.precision).toBe(MIGRACION.PRECISION);
    expect(tipo.options.scale).toBe(MIGRACION.ESCALA);
  });

  it('y la columna está en la lista que la migración convierte', () => {
    // La otra mitad: un modelo en `DECIMAL(14,4)` sobre una columna que ninguna
    // migración convirtió es Sequelize leyendo texto de una columna `INTEGER`.
    expect(MIGRACION.COLUMNAS).toContainEqual({ tabla: 'pedido_items', columna: 'cantidad' });
  });

  it('los tres importes de la línea siguen en DECIMAL(12,2): esta spec no toca la plata', () => {
    // FR-008. Van acá porque son las columnas vecinas y el error más fácil de
    // cometer al editar este modelo es arrastrar la escala nueva a la de al
    // lado: un precio en `numeric(14,4)` no falla en ningún lado y deja los
    // importes con dos decimales de más contra los que sí son DECIMAL(12,2).
    for (const columna of ['precio_unitario', 'precio_lista', 'subtotal']) {
      const tipo = PedidoItem.rawAttributes[columna].type;

      expect(tipo.key).toBe('DECIMAL');
      expect([tipo.options.precision, tipo.options.scale]).toEqual([12, 2]);
    }
  });
});
