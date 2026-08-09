// ════════════════════════════════════════════
//  FAVALIO · Quien registra un cambio de costo
//
//  Hay CINCO caminos que cambian el costo de un producto: la edicion manual,
//  la carga masiva, la actualizacion masiva de precios (y su deshacer), la
//  importacion de listas de proveedor y la recepcion de ordenes de produccion.
//  Cada uno escribia —o no escribia— su fila de historial a su manera:
//
//   - dos de ellos, la importacion y la carga masiva, **no escribian nada**, y
//     son justamente los que mas costos mueven. La pantalla de historial
//     existiria y estaria vacia en el caso principal, que es la lista de
//     precios del proveedor;
//   - ninguno guardaba `empresa_id` ni `usuario_id`;
//   - el umbral de "esto es un cambio de costo" estaba escrito tres veces.
//
//  Esta es la unica funcion que escribe en `product_cost_history` (FR-104).
//
//  ── Por que el motivo es una constante y no un texto suelto ──
//
//  FR-105 pide distinguir el origen. Con cadenas escritas a mano en cada
//  lugar, la pregunta "cuantos costos cambiaron por importacion" no se puede
//  contestar: alcanza con que alguien escriba "Importacion de precios" en vez
//  de "Importación de lista de precios" para que la mitad de las filas
//  desaparezca del conteo, y nada avisa.
//
//  ── Por que no es un hook afterUpdate de Sequelize ──
//
//  Un hook no puede distinguir un recosteo en cascada de una edicion manual:
//  `recalculateCascadingCosts` actualiza costos dentro de la misma transaccion
//  que abrio el usuario al tocar un insumo, y el hook los registraria a todos
//  como ediciones suyas. El origen lo sabe quien llama, no el modelo.
// ════════════════════════════════════════════

const { assertEmpresaId } = require('./tenantScope');
// La conversión a centavos vive en utils/centavos.js y no acá: el saldo de un
// proveedor la necesita igual (FR-050), y dos definiciones de "cuántos centavos
// es esto" son dos redondeos que se pueden separar sin que nada falle.
const { aCentavos } = require('./centavos');

/**
 * Cuanto tiene que moverse un costo para que cuente como cambio.
 *
 * Es el mismo umbral que ya usaba `products.js` antes de este refactor. Los
 * costos son DECIMAL(12,2): por debajo de un centavo no hay diferencia que la
 * base pueda guardar, y registrarla llenaria el historial de filas que dicen
 * que el costo paso de 1200.00 a 1200.00.
 */
const UMBRAL_DE_CAMBIO = 0.01;

/**
 * Los siete origenes posibles de un cambio de costo.
 *
 * ⚠ **Los cuatro que ya estaban guardados no se pueden reescribir.** Son los
 * textos que el historico existente tiene en la columna `reason`, incluidas
 * sus faltas de acento (`Actualizacion`, no `Actualización`): cambiarlos haria
 * que dos filas del mismo origen se lean distinto segun cuando se grabaron, y
 * el usuario que abre el panel no tiene forma de saber que son lo mismo.
 *
 * Los dos primeros son prefijos y no el texto completo: la actualizacion
 * masiva y su deshacer llevan un detalle variable. Se arman con
 * `motivoActualizacionMasiva` y `motivoDeshacerMasiva`, que estan abajo, para
 * que el prefijo —lo unico contable— siga estando en un solo lugar.
 */
const MOTIVOS = {
  /** Prefijo. Ya guardado, sin acento. `preciosService.aplicarMasivo`. */
  ACTUALIZACION_MASIVA: 'Actualizacion masiva',
  /** Prefijo. Ya guardado, sin acento. `preciosService.deshacer`. */
  DESHACER_MASIVA: 'Deshacer actualizacion masiva',
  /** Ya guardado. `PUT /api/products/:id`. */
  EDICION_MANUAL: 'Edición manual de costo base',
  /** Ya guardado. `productionService.recibirOrden`. */
  ORDEN_DE_PRODUCCION: 'Actualización por orden de producción',
  /** Nuevo (FR-104). `POST /api/import/products`. */
  IMPORTACION: 'Importación de lista de precios',
  /** Nuevo (FR-104). `POST /api/products/bulk`. */
  CARGA_MASIVA: 'Carga masiva de productos',
  /** `costService.recalculateCascadingCosts`, la propagacion a las recetas. */
  RECOSTEO_DE_RECETA: 'Recosteo por cambio de un insumo',
  /**
   * Nuevo (FR-072). `purchaseService.receiveOrder`.
   *
   * Recibir una orden de compra no tocaba el costo del producto: comprar a
   * $1.200 lo costeado a $900 dejaba el costo en $900, y el margen del POS y el
   * punto de equilibrio del panel se calculaban sobre un numero que ya no era
   * cierto. La recepcion de una orden de PRODUCCION si lo hacia, y esa asimetria
   * no se podia defender: los dos son mercaderia que entra con un costo nuevo.
   */
  RECEPCION_DE_COMPRA: 'Actualización por recepción de compra',
};

/**
 * El motivo de una actualizacion masiva, con su detalle.
 *
 * Reproduce **exactamente** el texto que `preciosService` ya venia guardando.
 *
 * @param {{descripcion?: string|null, porcentaje?: number}} datos
 * @returns {string}
 */
function motivoActualizacionMasiva({ descripcion, porcentaje } = {}) {
  if (descripcion) return `${MOTIVOS.ACTUALIZACION_MASIVA}: ${descripcion}`;

  const n = Number(porcentaje) || 0;

  return `${MOTIVOS.ACTUALIZACION_MASIVA} de costos (${n > 0 ? '+' : ''}${n}%)`;
}

/**
 * El motivo de un deshacer, con el numero de la actualizacion revertida.
 *
 * @param {number|string} idActualizacion
 * @returns {string}
 */
function motivoDeshacerMasiva(idActualizacion) {
  return `${MOTIVOS.DESHACER_MASIVA} #${idActualizacion}`;
}

/**
 * Si el cambio de costo es lo bastante grande como para registrarlo.
 *
 * ⚠ **La comparacion es en centavos enteros y no `Math.abs(a - b) >= 0.01`.**
 *
 * Esa resta en punto flotante es la que estaba escrita en los cinco lugares, y
 * se come cambios reales: `Math.abs(1200 - 1200.01)` da 0.009999999999999787,
 * que **no** llega a 0.01, asi que subir un costo de $1.200,00 a $1.200,01 no
 * quedaba registrado. Y lo peor es que depende de la magnitud —con 10.00 a
 * 10.01 la misma cuenta da 0.010000000000000675 y si pasa—, o sea que el
 * historial se saltea filas para unos productos y no para otros, sin ningun
 * patron visible.
 *
 * Los costos son DECIMAL(12,2): un centavo es la unidad minima que la columna
 * puede guardar, y por lo tanto la unidad en la que hay que comparar.
 *
 * @param {number|string} costoAnterior
 * @param {number|string} costoNuevo
 * @returns {boolean}
 */
function esCambioSignificativo(costoAnterior, costoNuevo) {
  return Math.abs(aCentavos(costoAnterior) - aCentavos(costoNuevo))
    >= aCentavos(UMBRAL_DE_CAMBIO);
}

/**
 * Registra un cambio de costo, si lo hubo.
 *
 * @param {object} datos
 * @param {{id: number, empresa_id: number}} datos.producto El producto ya
 *   leido. Se pide la fila entera y no el id suelto porque de ahi sale el
 *   `empresa_id`: pedirlo aparte es pedir que alguien lo pase mal.
 * @param {number|string} datos.costoAnterior
 * @param {number|string} datos.costoNuevo
 * @param {string} datos.motivo Uno de `MOTIVOS`, o el resultado de los dos
 *   armadores. Nunca una cadena escrita a mano en el lugar de la llamada.
 * @param {number|null} [datos.usuarioId] `req.usuario.id`. Nulo donde no hay
 *   usuario: la recepcion de una orden de produccion disparada por un proceso,
 *   o el recosteo en cascada, que lo hace el sistema.
 * @param {object} [datos.transaction]
 * @returns {Promise<object|null>} La fila escrita, o `null` si el cambio no
 *   llegaba al umbral.
 */
async function registrarCambioDeCosto({
  producto,
  costoAnterior,
  costoNuevo,
  motivo,
  usuarioId = null,
  transaction,
} = {}) {
  if (!producto || producto.id === null || producto.id === undefined) {
    // No es un ErrorDeNegocio: llegar aca sin producto es un bug de quien
    // llama, no algo que el usuario pueda corregir.
    throw new Error('registrarCambioDeCosto necesita el producto con su id');
  }

  if (!motivo) {
    throw new Error(
      'registrarCambioDeCosto necesita un motivo de utils/historialDeCostos.MOTIVOS. '
      + 'Un motivo vacio deja una fila que no se puede atribuir a ningun origen.'
    );
  }

  // El empresa_id sale del producto y no de un parametro suelto, pero igual se
  // valida: una fila de historial sin empresa es una fila que despues solo se
  // puede leer con una consulta sin scoping.
  const empresaId = Number(producto.empresa_id);
  assertEmpresaId(empresaId);

  if (!esCambioSignificativo(costoAnterior, costoNuevo)) return null;

  const { ProductCostHistory } = require('../models');

  return ProductCostHistory.create({
    product_id: producto.id,
    old_cost: Number(costoAnterior) || 0,
    new_cost: Number(costoNuevo) || 0,
    reason: motivo,
    usuario_id: usuarioId ?? null,
    empresa_id: empresaId,
  }, { transaction });
}

module.exports = {
  UMBRAL_DE_CAMBIO,
  MOTIVOS,
  motivoActualizacionMasiva,
  motivoDeshacerMasiva,
  esCambioSignificativo,
  registrarCambioDeCosto,
};
