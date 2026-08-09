// ════════════════════════════════════════════
//  FAVALIO · Modelo: Stock
//  Migra STOCK[], STOCK_ORTIZ[], STOCK_MAYO[]
//  Campos originales: { n, sku, t, cant, disp, marca }
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const logger = require('../utils/logger');

const Stock = sequelize.define('Stock', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // Espejo del punto de venta, no la identidad (FR-041). Lo escribe siempre el
  // servidor a partir de `code` (o `name`) de la sucursal; el cliente ya no lo
  // manda. Se conserva porque hay consultas y exportaciones que lo leen, pero
  // el dato autoritativo es `punto_de_venta_id`.
  location: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'general',
  },
  // La identidad de la sucursal (FR-040). Obligatorio desde la migración 14:
  // una fila de stock que no dice en qué sucursal está es mercadería que la
  // pantalla no puede mostrar y que una venta no puede descontar.
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'puntos_de_venta', key: 'id' },
  },
  quantity: {
    type: DataTypes.INTEGER, // Campo "cant" original
    allowNull: false,
    defaultValue: 0,
  },
  available: {
    type: DataTypes.INTEGER, // Campo "disp" original
    allowNull: false,
    defaultValue: 0,
  },
  min_stock: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  current_batch: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  expiration_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  purchase_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
}, {
  tableName: 'stock',
  // Esta lista tiene que decir lo que la base REALMENTE tiene después de la
  // migración 14, y no lo que estaría bueno que tuviera.
  //
  // Sequelize solo la aplica con `sync()`, que este proyecto no usa: acá es
  // documentación. Antes declaraba el único `(product_id, punto_de_venta_id)`
  // —que la base no tenía, porque el que existía era el único
  // `(product_id, location)` que puso `20260531-initial-schema.js:544`— y esa
  // mentira es la que hizo que la spec diagnosticara mal el problema: FR-042
  // dice «el índice no separa por los nulos» cuando el motivo real era que no
  // existía. Un modelo que describe un esquema que nadie aplicó es peor que no
  // documentar nada.
  indexes: [
    { unique: true, fields: ['product_id', 'punto_de_venta_id'] },
    { fields: ['location'] },
    { fields: ['empresa_id'] },
    { fields: ['punto_de_venta_id'] },
  ],
});

// ════════════════════════════════════════════
//  TiendaNube · el encolado de la variante mapeada
//
//  ── Por qué es un hook y no una llamada en cada escritor de stock ──
//
//  Hay ocho caminos que escriben en `stock` —venta, anulación, recepción, pedido
//  de TiendaNube, transferencia, producción, importación CSV y alta masiva—. El
//  encabezado de `utils/sucursalDeStock.js` ya dejó escrito qué pasa cuando una
//  regla vive en ocho lugares: «hoy hay diez lugares que escriben en `stock` y
//  cada uno decide la sucursal a su manera», y el resultado fueron filas sin
//  sucursal. **El noveno escritor no se va a acordar de encolar**, y el síntoma
//  sería una variante desfasada en silencio y para siempre, que es justamente lo
//  que la sincronización ante cada movimiento vino a evitar.
//
//  Los ocho usan `instancia.update()` o `Modelo.create()` —ninguno usa
//  `Stock.update()` de clase—, así que estos dos hooks los alcanzan a todos.
//
//  ── Por qué el agrupado sale gratis ──
//
//  `uq_tn_variante (empresa_id, tiendanube_variant_id)` deja **una fila por
//  variante**: cien movimientos del mismo producto en diez segundos actualizan
//  cien veces la misma fila y producen **un** PUT. No hay ningún temporizador en
//  memoria, que es lo que se descartó: un `setTimeout` de debounce muere con el
//  proceso, y en el free tier el servicio se reinicia y se duerme.
//
//  Los cinco segundos de `proximo_intento_en` son esa ventana de agrupado: lo
//  que se escribió recién no se empuja en el mismo instante, para que una
//  importación de lista no salga variante por variante.
// ════════════════════════════════════════════

/**
 * Marca como pendiente la variante mapeada de este producto.
 *
 * Toca **una sola fila**: `uq_tn_mapping_product` garantiza un mapeo por
 * (empresa, producto) y `uq_tn_variante` una fila por (empresa, variante). El
 * `WHERE` no es decorativo — sin él, un movimiento de un producto encolaría el
 * catálogo entero de la empresa y la corrida siguiente gastaría la cuota de la
 * tienda para dejar todo igual.
 *
 * `COALESCE(pendiente_desde, NOW())` y no `NOW()` a secas: si ya estaba
 * esperando, lo que interesa es **hace cuánto** espera —es lo que la pantalla
 * muestra como «la más vieja»—, no cuándo fue la última vez que alguien la
 * volvió a encolar.
 *
 * El `LEAST(...)` adelanta el reintento de una fila que venía con una espera
 * creciente larga: hay stock nuevo que publicar, así que la espera que se había
 * ganado por fallar ya no corresponde.
 */
const ENCOLAR_LA_VARIANTE_DEL_PRODUCTO = `
  UPDATE tiendanube_variantes v
     SET pendiente_desde = COALESCE(v.pendiente_desde, NOW()),
         proximo_intento_en = LEAST(
           COALESCE(v.proximo_intento_en, NOW() + INTERVAL '5 seconds'),
           NOW() + INTERVAL '5 seconds'
         ),
         updated_at = NOW()
    FROM tiendanube_mappings m
   WHERE m.empresa_id = $1
     AND m.product_id = $2
     AND v.empresa_id = m.empresa_id
     AND v.tiendanube_variant_id = m.tiendanube_variant_id
  RETURNING v.id`;

/**
 * Programa el drenaje de la cola de esa empresa, **fuera** de la transacción.
 *
 * ⚠ `afterCommit` y no una llamada directa: el encolado corre dentro de la
 * transacción del que escribió, así que un drenaje disparado ahí mismo leería
 * una fila que todavía nadie commiteó —y no la vería—. Y empujar de forma
 * síncrona adentro de esa transacción sería atar el tiempo de una venta al
 * tiempo de respuesta de TiendaNube: un 429 haría fallar el cobro.
 *
 * El `require` es diferido a propósito: `services/tiendanubeSincronizacion.js`
 * importa `models/index.js`, que importa este archivo. Pedirlo arriba dejaría un
 * ciclo de módulos con exportaciones a medio armar.
 */
function programarElDrenaje(empresaId, transaction) {
  const lanzar = () => {
    // `setImmediate` y no `await`: quien escribió stock ya respondió, y nadie
    // tiene que esperar a que TiendaNube conteste para que su venta termine.
    setImmediate(() => {
      try {
        require('../services/tiendanubeSincronizacion').dispararDrenaje(empresaId);
      } catch (err) {
        logger.error({ err, empresaId }, 'tiendanube: no se pudo disparar el drenaje de la cola');
      }
    });
  };

  if (!transaction || typeof transaction.afterCommit !== 'function') return lanzar();

  try {
    transaction.afterCommit(lanzar);
  } catch (err) {
    // La transacción ya terminó: pasa cuando alguien pasa un `transaction` ya
    // commiteado en `options`. Se dispara igual, que es lo que corresponde.
    lanzar();
  }
}

/**
 * El hook, para `afterCreate` **y** `afterUpdate`.
 *
 * ⚠ `afterCreate` no es simetría: una variante mapeada **sale de la cola** con
 * `motivo_no_publicado = 'sin_stock_en_sucursal'` cuando no hay fila de stock en
 * la sucursal designada. Si el hook solo cubriera `afterUpdate`, el día que
 * apareciera esa fila —la primera recepción de ese producto en esa sucursal—
 * nadie la volvería a encolar y esa variante no se publicaría nunca más.
 *
 * ⚠⚠ **El `catch` no revierte, y eso es deliberado.** Una tabla de cola con un
 * problema no puede impedir cobrar. Lo que hace aceptable este `catch` —y sin lo
 * cual sería un `sendEmail` devolviendo `ok: true`— es la reconciliación diaria
 * de `POST /api/tareas/ejecutar`, que compara los tres números y corrige lo que
 * el encolado perdió: **la red es lo que permite que esto sea best-effort**.
 */
async function encolarParaTiendanube(stock, options) {
  // La MISMA transacción del que escribió: si la venta se cae, el encolado se
  // cae con ella. Sin esto quedaría una variante pendiente de publicar un
  // movimiento que nunca ocurrió.
  const externa = (options && options.transaction) || null;

  try {
    // ⚠⚠ **El SAVEPOINT es lo que hace que el `catch` sirva de algo, y sin él
    // este `try` es decoración.** En Postgres, una sentencia que falla **aborta
    // la transacción entera**: todo lo que venga después responde «current
    // transaction is aborted» y el `COMMIT` se convierte en `ROLLBACK`. O sea
    // que atrapar el error acá no alcanzaría —la venta ya estaría condenada— y
    // el caso concreto no es hipotético: un despliegue donde la migración
    // `20260811` todavía no corrió no tiene `tiendanube_variantes`, y sin el
    // savepoint **ninguna venta se podría registrar**.
    //
    // `sequelize.transaction({ transaction })` abre un SAVEPOINT sobre la
    // transacción del que llamó y lo revierte solo si el bloque tira: la
    // transacción de la venta queda intacta y sigue.
    const filas = externa
      ? await sequelize.transaction({ transaction: externa }, (punto) => encolar(stock, punto))
      : await encolar(stock, null);

    // Sin mapeo no hay nada que publicar, y sobre todo: no hay a quién
    // molestar. Es lo que deja el drenaje sin disparar en las empresas que no
    // usan TiendaNube, que son casi todas.
    if (!filas.length) return;

    programarElDrenaje(stock.empresa_id, externa);
  } catch (err) {
    logger.error(
      { err, empresaId: stock.empresa_id, productId: stock.product_id },
      'tiendanube: no se pudo encolar la variante de este producto'
    );
  }
}

/** El `UPDATE` en sí, para que el savepoint tenga un bloque que envolver. */
async function encolar(stock, transaction) {
  const [filas] = await sequelize.query(ENCOLAR_LA_VARIANTE_DEL_PRODUCTO, {
    bind: [stock.empresa_id, stock.product_id],
    transaction: transaction || undefined,
  });

  return filas || [];
}

Stock.addHook('afterCreate', 'tiendanubeEncolarVariante', encolarParaTiendanube);
Stock.addHook('afterUpdate', 'tiendanubeEncolarVariante', encolarParaTiendanube);

module.exports = Stock;
