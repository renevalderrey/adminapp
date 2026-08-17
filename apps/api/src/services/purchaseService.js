const { Op, fn, col, cast, where: sqlWhere } = require('sequelize');
const {
  Supplier,
  SupplierOrder,
  SupplierMovement,
  Stock,
  Product,
  Recipe,
  RecipeItem,
  sequelize,
} = require('../models');
const { assertEmpresaId, findScoped } = require('../utils/tenantScope');
const { ErrorDeNegocio } = require('../utils/errores');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');
const { aplicarRecepcion, errorDeCuerpo } = require('../utils/recepcionDeOrden');
// El MISMO par de listas de acentos que usa la búsqueda de `GET /suppliers`
// (FR-059), y por eso se importa en vez de copiarse: normaliza los dos lados
// —la columna, en SQL, y el texto que escribió el usuario, en JS— y dos listas
// escritas por separado se separan. Buscar «Norté» encontraría «Norte» en una
// pantalla y no en la otra, sin que nada falle.
const { sinAcentos, ACENTOS, SIN_ACENTOS } = require('../utils/cuentaDeProveedor');
// La fecha de un asiento la decide el SERVIDOR, con la zona de la empresa. Con
// `new Date().toISOString()` una recepción de las 21:30 del 31 de julio genera
// un movimiento de deuda fechado el 1 de agosto —Argentina es UTC-3—, que se va
// al mes siguiente del estado de cuenta y del archivo exportado. No falla nada.
const { hoyDelNegocio } = require('../utils/fechas');
// La comparación de importes en centavos enteros vive ahí y no se vuelve a
// escribir: `Math.abs(1200 - 1200.01)` da 0.009999999999999787 y se come
// cambios de costo reales según la magnitud del número.
const {
  esCambioSignificativo,
  registrarCambioDeCosto,
  MOTIVOS,
} = require('../utils/historialDeCostos');
// El motivo real de un recosteo que se cae no puede quedarse solo en el aviso
// del usuario: «revisá esa receta» no dice cuál de las dos cosas pasó, y el
// aviso es lo único que quedaba si el error se traga en silencio.
const logger = require('../utils/logger');
// La suma de cantidades pasa por una función y no por un `+`: `stock.quantity`
// viene de la base y, con la columna en DECIMAL, el driver la entrega como
// texto.
const { sumarCantidades } = require('../utils/cantidades');

/**
 * Propaga el costo nuevo de un insumo a los elaborados que lo usan.
 *
 * ⚠ **Va en el mismo paso que la actualización del costo, no en uno siguiente.**
 * Un insumo que pasa a $1.200 mientras el producto elaborado que lo usa sigue
 * costeado con $900 es el mismo defecto corrido un nivel: el margen que muestra
 * el POS y el precio recomendado del Comparador se calculan sobre un número que
 * dejó de ser cierto, y no falla nada.
 *
 * El molde es `productionService.recibirOrden`, que hace exactamente esto sobre
 * el mismo grafo desde siempre. `visited` corta los ciclos.
 *
 * `costService` se requiere adentro para no cerrar el ciclo de imports en la
 * carga del módulo, igual que ahí.
 *
 * ── Por qué el `visited` se clona por rama ──
 *
 * Hasta este corte había **un solo Set** para todas las ramas, y encima se le
 * agregaba cada elaborado ya recosteado. Con un grafo en diamante —Colágeno es
 * insumo de la Premezcla, y el Combo lleva Colágeno **y** Premezcla— la segunda
 * rama se encontraba el Combo ya marcado por la primera, y `costService`
 * respondía «Dependencia circular detectada» sobre un grafo **que no tiene
 * ningún ciclo**.
 *
 * El Set contesta «por dónde vine», que es una pregunta por camino. Compartirlo
 * entre ramas hermanas lo convierte en «quién pasó antes», que es otra cosa y
 * no corta ciclos: los inventa. `costService.js` ya clonaba por rama; acá no, y
 * esa era toda la diferencia.
 *
 * Y era intermitente, que es lo peor que podía ser: el `findAll` no llevaba
 * `ORDER BY`, así que con la fila de la Premezcla primero la misma recepción
 * respondía 200.
 *
 * ── Qué pasa si el recosteo falla de verdad ──
 *
 * **La recepción vale igual, y el recosteo se informa como aviso.** Es una
 * decisión de producto y no el resultado accidental de dónde cayó el `try`:
 *
 *  - la mercadería entró y la deuda existe: son hechos del mundo, no
 *    conclusiones del sistema, y una receta mal cargada hace meses no los borra;
 *  - abortar revierte la transacción **entera** —stock, costo, historial y
 *    deuda—, o sea que deja al depósito sin poder registrar el camión hasta que
 *    alguien arregle una receta que quien recibe mercadería casi nunca puede
 *    tocar, y con un 500 que no nombra ni el producto ni la receta;
 *  - y lo que se revertía incluía el costo del insumo, que es justamente lo que
 *    la decisión 1 de la spec vino a resolver.
 *
 * Lo que **no** se hace es callarlo: el aviso nombra el elaborado y viaja en
 * `avisos`, la misma lista que la pantalla ya dibuja, y el motivo real queda en
 * el log del servidor.
 *
 * ⚠ Lo que queda afuera: la cascada pudo haber escrito algunos costos antes de
 * fallar y eso **no** se deshace —haría falta un SAVEPOINT—. Sobre un grafo con
 * un ciclo real esos costos ya eran indefendibles antes de esta recepción; el
 * aviso es lo que hace que alguien vaya a mirarlos.
 *
 * @param {number} productId El insumo cuyo costo acaba de cambiar.
 * @param {object} transaction La MISMA de la recepción.
 * @param {{empresaId?: number, avisos?: string[]}} [contexto] `avisos` se muta:
 *   es la lista que se le devuelve al usuario.
 * @returns {Promise<number>} Cuántos elaborados **distintos** se recostearon.
 */
async function recostearDependientes(productId, transaction, { empresaId = null, avisos = [] } = {}) {
  const costService = require('./costService');

  const dependientes = await RecipeItem.findAll({
    where: { ingredient_product_id: productId },
    include: [{ model: Recipe, as: 'recipe', attributes: ['product_id'] }],
    // Sin `ORDER BY`, el orden de las filas lo elige Postgres, y con él cambiaba
    // el resultado de la recepción: la misma orden respondía 200 o 500 según qué
    // rama del diamante saliera primero. Hoy ya no cambia el resultado, pero sí
    // el orden de los avisos, y un aviso que aparece en distinto lugar en cada
    // recepción es un aviso que nadie termina de leer.
    order: [['id', 'ASC']],
    transaction,
  });

  let recosteos = 0;

  // Una misma receta puede listar el mismo insumo dos veces: `recipe_items` no
  // tiene índice único por (recipe_id, ingredient_product_id). Recostear dos
  // veces el mismo elaborado da exactamente el mismo número y lo contaba doble.
  const yaRecosteados = new Set();

  for (const dep of dependientes) {
    if (!dep.recipe || !dep.recipe.product_id) continue;

    const elaborado = dep.recipe.product_id;

    if (yaRecosteados.has(elaborado)) continue;
    yaRecosteados.add(elaborado);

    try {
      // Un Set NUEVO por rama, con el insumo adentro para cortar los ciclos que
      // sí existen. Ver arriba por qué no puede ser el mismo de la rama anterior.
      await costService.recalculateCascadingCosts(
        elaborado,
        new Set([productId]),
        transaction
      );
      recosteos += 1;
    } catch (err) {
      logger.warn(
        { err, insumo: productId, elaborado, empresaId },
        'No se pudo recostear un elaborado durante una recepción de compra'
      );

      avisos.push(await avisoDeRecosteoFallido(elaborado, empresaId, transaction));
    }
  }

  return recosteos;
}

/**
 * El aviso de un elaborado que no se pudo recostear.
 *
 * **Nombra el producto.** Lo que había antes era un 500 «Error al recibir la
 * orden de compra»: no decía ni qué producto ni qué receta, así que ni siquiera
 * se sabía qué abrir para arreglarlo.
 *
 * `findScoped` y no `findByPk`: el id sale del grafo de recetas y no del
 * cliente, pero `recipe_items` no tiene `empresa_id`, así que una fila cruzada
 * entre empresas pondría el nombre de un producto ajeno en la respuesta.
 */
async function avisoDeRecosteoFallido(productId, empresaId, transaction) {
  const elaborado = empresaId
    ? await findScoped(Product, productId, empresaId, { transaction })
    : null;

  const nombre = elaborado && elaborado.name
    ? `«${elaborado.name}»`
    : `el producto #${productId}`;

  return `No se pudo recalcular el costo de ${nombre}: su receta tiene una `
    + 'dependencia circular o un rendimiento que no deja producto terminado. '
    + 'La mercadería y la deuda se registraron igual; revisá esa receta.';
}

/**
 * Valida que el cuerpo de una recepción venga «por línea».
 *
 * La identidad de una línea es su **posición en `detail`** (decisión 1 del
 * plan). `detail` es un JSONB sin tabla de líneas: no hay id que usar, y la
 * posición es lo único que distingue dos líneas idénticas.
 *
 * ⚠ **Acá vivía el respaldo que aceptaba el cuerpo viejo
 * `{ product_id, quantity_received }`, y T1239 lo borró.** Existió durante un
 * solo corte y con un motivo acotado: entre el despliegue de la API y el de las
 * dos pantallas, un navegador abierto desde antes seguía mandando esa forma, y
 * rechazarla habría dejado a alguien sin poder recibir mercadería hasta
 * recargar. Con la pantalla nueva arriba ya no hay quien la mande.
 *
 * **Por qué se borra y no se deja «por las dudas»**: es el camino ambiguo que
 * este hito viene a cerrar —`{ product_id }` no alcanza para distinguir dos
 * líneas del mismo producto ni dos líneas sin producto— y **un camino que nadie
 * usa es un camino que nadie mira cuando cambia**. Dejarlo vivo significa que
 * el día que alguien toque la resolución de líneas, la mitad de los casos que
 * se rompen no los ejercita ninguna pantalla.
 *
 * A partir de acá `linea` es obligatorio: un cuerpo sin él responde
 * **`400 LINEA_REQUERIDA`**, sea la orden ambigua o no.
 *
 * @param {Array<object>} items Los del cuerpo del request.
 * @param {Array<object>} detalle El `detail` de la orden.
 * @returns {Array<{linea: number, cantidad: number, actualizar_costo?: boolean}>}
 */
function itemsPorLinea(items, detalle = []) {
  const lista = Array.isArray(items) ? items : [];

  if (lista.length === 0) return [];

  // Se exige en TODOS los ítems y no en «alguno»: un cuerpo mixto —dos líneas
  // con posición y una sin— caería en `aplicarRecepcion` como
  // `LINEA_INEXISTENTE`, que le dice al usuario que su detalle está viejo
  // cuando lo que está mal es el cuerpo que manda su pantalla.
  const sinLinea = lista.some((i) => !i || i.linea === undefined || i.linea === null);

  if (sinLinea) {
    throw errorDeCuerpo(
      'LINEA_REQUERIDA',
      'Falta decir a qué línea de la orden va cada cantidad. Recargá la pantalla '
      + 'y volvé a cargar la recepción.'
    );
  }

  // Red contra una pantalla que se quedó con un detalle viejo: si manda la
  // línea Y el producto y no coinciden, el índice apunta a otra cosa de la que
  // el usuario cree, y eso hay que decirlo antes de mover stock.
  for (const item of lista) {
    if (item.product_id === undefined || item.product_id === null) continue;

    const indice = Number(item.linea);
    const enLaOrden = Number.isInteger(indice) ? detalle[indice] : undefined;
    if (!enLaOrden) continue; // `aplicarRecepcion` lo rechaza con su código.

    const deLaLinea = enLaOrden.product_id ?? null;

    if (Number(item.product_id) !== Number(deLaLinea)) {
      throw errorDeCuerpo(
        'LINEA_INCONSISTENTE',
        `La línea ${indice} de la orden no es del producto que se está recibiendo. `
        + 'Volvé a abrir la orden: el detalle cambió desde que la cargaste.'
      );
    }
  }

  return lista;
}

class PurchaseService {
  async createOrder(supplierId, data, empresaId) {
    assertEmpresaId(empresaId);

    // El proveedor se valida contra la empresa ANTES de crear la orden.
    //
    // La orden se creaba con el empresa_id de quien la mandaba, asi que a
    // primera vista no se escapaba nada. El problema estaba del otro lado: el
    // include de GET /api/suppliers/:id une por supplier_id y nada mas, con lo
    // cual la orden aparecia colgada de un proveedor de otra empresa cliente.
    //
    // 404 y no 403: un 403 confirmaria que ese proveedor existe en otra
    // empresa, y con eso se enumeran ids ajenos.
    const supplier = await findScoped(Supplier, supplierId, empresaId);
    if (!supplier) throw new ErrorDeNegocio('Proveedor no encontrado', 404);

    const { date, notes, items } = data;

    let total = 0;
    const detail = [];
    if (Array.isArray(items)) {
      for (const item of items) {
        const qty = parseFloat(item.quantity) || 0;
        const price = parseFloat(item.unit_price) || 0;
        total += qty * price;
        detail.push({
          product_id: item.product_id || null,
          product_name: item.product_name || 'Producto',
          quantity: qty,
          unit_price: price,
        });
      }
    }

    // FR-062. Todo product_id del detalle tiene que ser de la empresa.
    //
    // Antes se guardaba `item.product_id || null` sin mirar nada, así que una
    // empresa podía dejar en su propio `detail` una línea que apunta al producto
    // de otro cliente. La consecuencia se veía al recibir: el `Stock.findOne`
    // lleva empresa_id, así que no encuentra la fila del otro, pero el
    // `Stock.create` **creaba una fila de stock propia para un producto ajeno**.
    //
    // 400 y no 404: acá el proveedor sí es propio y el error es del cuerpo, no
    // del recurso.
    //
    // ⚠ Este findAll con empresa_id en el `where` es además lo que el detector
    // `analizarCreates` acepta como validación previa
    // (/find(One|All)\(\s*\{[^;]*?empresa_id/), así que el SupplierOrder.create
    // de acá abajo sigue limpio. **No reformatearlo a varias líneas sin volver a
    // correr aislamientoEmpresas.**
    const ids = [...new Set(detail.map((l) => l.product_id).filter(Boolean))];

    if (ids.length) {
      const propios = await Product.findAll({ where: { id: ids, empresa_id: empresaId }, attributes: ['id'] });

      if (propios.length !== ids.length) {
        const conocidos = new Set(propios.map((p) => p.id));
        const ajenos = detail
          .filter((l) => l.product_id && !conocidos.has(l.product_id))
          .map((l) => `«${l.product_name}»`);

        throw new ErrorDeNegocio(
          `Estos productos no son de esta empresa: ${[...new Set(ajenos)].join(', ')}. `
          + 'No se creó la orden.',
          400
        );
      }
    }

    const order = await SupplierOrder.create({
      supplier_id: supplier.id,
      empresa_id: empresaId,
      date: date || await hoyDelNegocio(empresaId),
      total: Math.round(total * 100) / 100,
      notes: notes || null,
      detail,
      status: 'pending',
    });

    return order;
  }

  /**
   * Registra la recepción (total o parcial) de una orden de compra.
   *
   * Suma el stock recibido, actualiza las cantidades en el detalle de la orden
   * y genera la deuda con el proveedor por lo efectivamente recibido.
   *
   * Todo va dentro de una transacción: antes el stock se sumaba, y si fallaba
   * el guardado de la orden o el alta de la deuda, quedaba mercadería cargada
   * sin la contrapartida.
   */
  async receiveOrder(orderId, cuerpo = {}, empresaId, usuarioId = null) {
    assertEmpresaId(empresaId);

    // `location` ya no se lee. Su valor por defecto era el literal 'general',
    // que en una empresa cuyos códigos son otros no coincide con ninguna
    // sucursal, y desde que existe `resolverSucursal` no ubicaba nada (FR-104).
    //
    // `punto_de_venta_id` es la sucursal que se eligió en la pantalla (US10).
    // Llega ya decidida por la ruta, que aplica los dos primeros escalones de la
    // precedencia: el id del cuerpo, y si no vino, la cabecera
    // `X-Punto-De-Venta-Id`. El tercero —la sucursal por defecto de la empresa—
    // lo resuelve `resolverSucursal` y **no se repite acá**: esa regla vive en
    // un solo lugar (FR-049), y tenerla escrita en cada escritura de stock es
    // como se llegó a diez lugares que decidían la sucursal cada uno a su
    // manera, con filas que la pantalla no muestra.
    const { items, punto_de_venta_id: puntoDeVentaId = null } = cuerpo || {};

    // La fecha del negocio se resuelve ANTES de abrir la transacción. Es una
    // lectura de la zona horaria de la empresa, y hacerla adentro pediría una
    // segunda conexión del pool mientras la primera está tomada: con el pool
    // chico, eso es una espera que nadie va a poder explicar.
    const fechaDelMovimiento = await hoyDelNegocio(empresaId);

    return sequelize.transaction(async (t) => {
      const order = await SupplierOrder.findOne({
        where: { id: orderId, empresa_id: empresaId },
        include: [{ model: Supplier, as: 'supplier' }],
        transaction: t,
      });
      // ErrorDeNegocio y no Error: el helper de errores solo respeta
      // `err.status` cuando `err.publico` es verdadero (errores.js:60-73), así
      // que estos tres mensajes —los únicos que saben el contexto— llegaban al
      // usuario como 500 «Error al recibir la orden de compra». 404 y no 403 en
      // el primero: un 403 confirmaría que esa orden existe en otra empresa.
      //
      // ⚠ En este archivo el nombre de ese helper no se escribe seguido de un
      // paréntesis, ni siquiera en un comentario: la guardia «Todo archivo que
      // lo llama lo importa» de aislamientoEmpresas.test.js busca el patrón en
      // el texto crudo, sin sacar los comentarios, y lo toma por una llamada
      // real. El servicio no responde HTTP y no tiene por qué importarlo.
      if (!order) throw new ErrorDeNegocio('Orden no encontrada', 404);
      if (order.status === 'received') throw new ErrorDeNegocio('La orden ya fue recibida completa', 409);
      if (order.status === 'cancelled') throw new ErrorDeNegocio('La orden está anulada', 409);

      const original = order.detail || [];

      // La aritmética de la recepción vive en `utils/recepcionDeOrden.js`, que
      // es pura y se testea con arreglos. Acá queda lo que necesita base:
      // scoping, lock, transacción y escritura.
      //
      // De ahí sale también la copia profunda del detalle. `detail` es una
      // columna JSONB: mutar los objetos que devuelve Sequelize y después
      // reasignar la MISMA referencia no marca el campo como modificado, y el
      // UPDATE salía sin la columna. Las cantidades recibidas nunca se
      // persistían: cada recepción parcial se perdía y el detalle quedaba
      // siempre en cero.
      const { detalle, totalRecibido, estado, lineas, avisos } =
        aplicarRecepcion(original, itemsPorLinea(items, original));

      // ── Cada línea se clasifica ANTES de tocar nada ──
      //
      // Tres casos y tres resultados distintos, y hasta este corte los dos
      // últimos terminaban igual: el `Stock.create` con `product_id: null`
      // chocaba contra la columna, la transacción se revertía entera y no
      // entraba nada, ni de las otras líneas.
      const ids = [...new Set(
        lineas.map((l) => l.product_id).filter((id) => id !== null && id !== undefined)
      )];

      const propios = ids.length
        ? await Product.findAll({
          where: { id: ids, empresa_id: empresaId },
          transaction: t,
        })
        : [];

      const porId = new Map(propios.map((p) => [p.id, p]));
      const faltantes = ids.filter((id) => !porId.has(id));

      if (faltantes.length) {
        // ⚠ Esta lectura NO lleva empresa_id, y es a propósito. La única
        // pregunta que contesta es si ese id existe en OTRA empresa cliente,
        // porque «producto borrado» y «producto ajeno» piden respuestas
        // opuestas: el borrado genera deuda sin mover stock, y el ajeno rechaza
        // la recepción entera. No devuelve ningún dato del producto ajeno —solo
        // su id, que ya lo teníamos— y nada de esto sale en la respuesta.
        //
        // Sin la distinción, un `product_id` de otro cliente en el `detail` de
        // una orden vieja —posible, porque FR-062 recién lo impide desde este
        // hito— haría que el `Stock.create` cree una fila de stock propia para
        // un producto ajeno.
        const ajenos = await Product.findAll({
          where: { id: faltantes },
          attributes: ['id'],
          transaction: t,
        });

        if (ajenos.length) {
          throw new ErrorDeNegocio(
            'La orden tiene líneas que apuntan a productos que no son de esta '
            + 'empresa. No se registró ninguna recepción.',
            400
          );
        }
      }

      // `resolverSucursal` sube ANTES del bucle. Estaba adentro: una orden de
      // veinte líneas eran veinte resoluciones de la misma sucursal, con la
      // transacción abierta.
      //
      // Solo se resuelve si hay stock que mover: una orden que es toda flete no
      // tiene por qué fallar en una empresa sin sucursales cargadas.
      let ubicacion = null;

      if (lineas.some((l) => porId.has(l.product_id))) {
        ubicacion = ubicacionDeStock(await resolverSucursal({
          empresaId,
          puntoDeVentaId,
          transaction: t,
        }));
      }

      const costos = [];

      for (const linea of lineas) {
        const producto = porId.get(linea.product_id);

        if (!producto) {
          // Un flete, un servicio, o un producto que ya no está en el catálogo:
          // se debe igual, y el stock no se toca.
          avisos.push(
            `«${linea.product_name || 'Un ítem'}» no está en el catálogo: `
            + 'se registró la deuda y no se movió stock.'
          );
          continue;
        }

        // `empresa_id` sigue en el where Y en el alta: sin él, la búsqueda
        // podía encontrar —y sumarle stock a— la fila de otra empresa cliente,
        // y el alta creaba filas que caían en la empresa 1 por el default de la
        // columna. El lock evita que dos recepciones simultáneas de la misma
        // fila se pisen.
        const stock = await Stock.findOne({
          where: {
            product_id: producto.id,
            empresa_id: empresaId,
            punto_de_venta_id: ubicacion.punto_de_venta_id,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (stock) {
          // `sumarCantidades` y no `+`: lo de la izquierda sale de la base y lo
          // de la derecha del cuerpo del request. Con la columna en DECIMAL el
          // primero llega como texto, así que `'7.0000' + 10` concatena y da
          // «7.000010», que como número es **7.00001** cuando lo correcto era
          // 17.
          //
          // ⚠ El resultado es más CHICO que el correcto, no más grande: recibir
          // diez unidades dejaría el stock casi igual que antes, o sea que la
          // mercadería del camión se pierde en silencio. Y como tiene un solo
          // punto es un número válido: Postgres lo acepta y nada avisa. El
          // recuento físico es lo único que lo encuentra.
          await stock.update({
            quantity: sumarCantidades(stock.quantity, linea.recibido_ahora),
            available: sumarCantidades(stock.available, linea.recibido_ahora),
          }, { transaction: t });
        } else {
          await Stock.create({
            product_id: producto.id,
            empresa_id: empresaId,
            punto_de_venta_id: ubicacion.punto_de_venta_id,
            location: ubicacion.location,
            quantity: linea.recibido_ahora,
            available: linea.recibido_ahora,
            min_stock: 0,
          }, { transaction: t });
        }

        // ── El costo del producto ──
        //
        // Comprar a $1.200 lo costeado a $900 dejaba el costo en $900, y el
        // margen del POS, el punto de equilibrio del panel y el precio
        // recomendado del Comparador se calculaban sobre eso. La recepción de
        // una orden de PRODUCCIÓN sí lo actualizaba desde siempre.
        //
        // Se actualiza **confirmando, línea por línea** (decisión 1 de la spec):
        // a veces se compra más caro por urgencia y eso no tiene que mover los
        // precios de venta.
        if (!linea.actualizar_costo) continue;

        const costoAnterior = Number(producto.cost) || 0;
        const costoNuevo = Number(linea.unit_price) || 0;

        // El servidor VUELVE a evaluar el umbral: la casilla del cliente es un
        // pedido, no una orden. Sin esto, una pantalla desactualizada podría
        // escribir un cambio de medio centavo, que la columna DECIMAL(12,2) ni
        // siquiera puede guardar.
        if (!esCambioSignificativo(costoAnterior, costoNuevo)) continue;

        await producto.update({ cost: costoNuevo }, { transaction: t });

        // `registrarCambioDeCosto` es la única función que escribe en
        // `product_cost_history`, y el motivo es una constante: con textos
        // sueltos, «cuántos costos cambiaron por compras» no se puede contestar.
        await registrarCambioDeCosto({
          producto,
          costoAnterior,
          costoNuevo,
          motivo: MOTIVOS.RECEPCION_DE_COMPRA,
          usuarioId,
          transaction: t,
        });

        costos.push({
          linea: linea.linea,
          product_id: producto.id,
          costo_anterior: costoAnterior,
          costo_nuevo: costoNuevo,
          aplicado: true,
          // Está en la respuesta para que **se vea que pasó**: recostear tres
          // elaborados sin decirlo es un cambio de márgenes invisible.
          //
          // `avisos` se pasa por referencia a propósito: si una receta rota
          // impide recostear un elaborado, la recepción no se cae y el motivo
          // aparece en la misma lista que la pantalla ya dibuja.
          recosteos: await recostearDependientes(producto.id, t, { empresaId, avisos }),
        });
      }

      // FR-037: una recepción en la que no entró nada válido no cambia el
      // estado de la orden ni crea movimiento. Antes el estado se recalculaba
      // igual, así que confirmar un formulario en cero podía dejar una orden en
      // `partial` sin que hubiera llegado nada.
      if (lineas.length > 0) {
        order.detail = detalle;
        order.status = estado;
        // JSONB: aunque `detalle` sea un array nuevo, se marca explícitamente
        // por las dudas. Es barato y no depende de cómo Sequelize compare el
        // campo.
        order.changed('detail', true);
        await order.save({ transaction: t });
      }

      let deuda = null;

      if (totalRecibido > 0) {
        deuda = await SupplierMovement.create({
          supplier_id: order.supplier_id,
          empresa_id: order.empresa_id,
          type: 'deuda',
          date: fechaDelMovimiento,
          amount: totalRecibido,
          notes: `Recepción orden #${order.id}${order.status === 'partial' ? ' (parcial)' : ''}`,
        }, { transaction: t });
      }

      return {
        id: order.id,
        status: order.status,
        recibido: lineas.map((l) => ({
          linea: l.linea,
          product_id: l.product_id,
          product_name: l.product_name,
          pedido: l.pedido,
          // FR-033: lo que entró **de verdad**, que no siempre es lo que el
          // usuario escribió. Hasta este corte la pantalla decía «Mercadería
          // recibida» y nada más.
          recibido_ahora: l.recibido_ahora,
          recibido_total: l.recibido_total,
          pendiente: l.pendiente,
        })),
        deuda: deuda
          ? { id: deuda.id, amount: Number(deuda.amount), date: deuda.date }
          : null,
        // Solo las líneas cuya casilla se aceptó Y que además superaron el
        // umbral: si el cliente la marcó y el cambio no llegaba al centavo, la
        // línea no aparece acá porque no pasó nada.
        costos,
        avisos,
      };
    });
  }

  async cancelOrder(orderId, empresaId) {
    // Sin esto, una llamada con empresaId undefined arma
    // `where: { empresa_id: undefined }`. Sequelize lo rechaza, pero como un
    // error de parametro que termina en un 500 sin explicacion; assertEmpresaId
    // dice que falta el middleware requireEmpresa, que es el problema real.
    assertEmpresaId(empresaId);

    const order = await SupplierOrder.findOne({ where: { id: orderId, empresa_id: empresaId } });
    // Mismo motivo que en receiveOrder: sin ErrorDeNegocio los tres salían como
    // 500 «Error al anular la orden de compra», y el usuario no tenía cómo
    // saber que la orden ya estaba anulada.
    if (!order) throw new ErrorDeNegocio('Orden no encontrada', 404);
    if (order.status === 'received') throw new ErrorDeNegocio('No se puede anular una orden ya recibida', 409);
    if (order.status === 'cancelled') throw new ErrorDeNegocio('La orden ya está anulada', 409);

    order.status = 'cancelled';
    await order.save();
    return order;
  }

  async getOrders(filters = {}) {
    const { supplier_id, status, from, to, q, limit, offset, empresa_id } = filters;

    // El filtro por empresa es obligatorio, no condicional. Con
    // `if (empresa_id) where.empresa_id = empresa_id` una llamada sin empresa
    // resuelta no fallaba ni avisaba: devolvia las ordenes de compra de TODAS
    // las empresas cliente en la misma respuesta, paginadas y con el nombre del
    // proveedor. El resto de los filtros —proveedor, estado, fechas— si son
    // opcionales; este no.
    assertEmpresaId(empresa_id);
    const where = { empresa_id };

    if (supplier_id) where.supplier_id = supplier_id;
    if (status) where.status = status;
    if (from || to) {
      where.date = {};
      if (from) where.date[Op.gte] = from;
      if (to) where.date[Op.lte] = to;
    }

    // ── La búsqueda, por nombre de proveedor Y por número de orden (FR-009) ──
    //
    // Hasta este corte el endpoint no aceptaba `q`, así que la pantalla buscaba
    // sobre las 50 filas que tenía cargadas: la orden 77 —que existe, en la
    // página 2— salía como «ninguna orden coincide». Con la búsqueda acá, la
    // lista, el `total`, la cantidad de páginas y los contadores de los
    // segmentos salen todos de la misma consulta y no pueden contradecirse.
    //
    // ⚠⚠ **Se SUMA al `where`, no lo reemplaza.** `empresa_id` sigue arriba y la
    // condición entra en un `Op.and` al lado: un filtro nuevo escrito como
    // `const where = { [Op.and]: [...] }` es exactamente la fuga que la
    // auditoría encontró en veinte endpoints.
    //
    // ⚠ El criterio sin acentos es **el mismo** que el de `GET /suppliers`
    // (`routes/suppliers.js`, `condicionDeNombre`): `translate()` del núcleo de
    // Postgres sobre la columna, y `sinAcentos` sobre el texto, con el mismo par
    // de listas. La extensión `unaccent` queda descartada por lo de siempre:
    // pide superusuario en una base administrada, que es la razón por la que la
    // búsqueda de ventas quedó sensible a acentos (`utils/filtroVentas.js:152`).
    //
    // El `#` inicial se saca porque la pantalla escribe «#118» y quien copia el
    // número se lo lleva puesto.
    const texto = sinAcentos(q).trim().replace(/^#/, '').trim();

    if (texto !== '') {
      where[Op.and] = [{
        [Op.or]: [
          // `supplier.name` es el alias del include de abajo, y por eso esta
          // condición vive acá y no en la ruta: escrita en otro archivo, el día
          // que ese alias cambie la consulta se rompería desde lejos.
          sqlWhere(
            fn('translate', fn('lower', col('supplier.name')), ACENTOS, SIN_ACENTOS),
            { [Op.like]: `%${texto}%` }
          ),
          // El número se compara como TEXTO y no con `id = 77`: escribir «11»
          // tiene que seguir encontrando la #112, que es lo que hacía la
          // pantalla con `String(id).includes(texto)`. Y con un `Number(texto)`
          // una búsqueda por nombre mandaría NaN a una columna INTEGER, que es
          // el 500 de Postgres que este mismo listado ya cerró una vez.
          sqlWhere(cast(col('SupplierOrder.id'), 'text'), { [Op.like]: `%${texto}%` }),
        ],
      }];
    }

    // El `limit` se recorta, no se rechaza: un valor fuera de rango es de la
    // pantalla, no del usuario, y hacer fallar el listado por eso deja a alguien
    // sin ver sus órdenes. Sin el tope, `?limit=999999` pide la tabla entera con
    // el include del proveedor: una consulta que nadie escribió a propósito.
    const TOPE_DE_PAGINA = 200;

    // Un limit que no es un entero positivo cae al por defecto y no a 1: pedir
    // «-5» no significa «una orden», significa que el parámetro no dice nada.
    const pedido = parseInt(limit, 10);
    const pageLimit = Number.isInteger(pedido) && pedido > 0
      ? Math.min(pedido, TOPE_DE_PAGINA)
      : 50;
    const pageOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const { count, rows } = await SupplierOrder.findAndCountAll({
      where,
      // FR-067. El include unia por supplier_id y nada mas: el `supplier_name`
      // de cada fila del listado podia venir del proveedor de otro cliente.
      //
      // `required: false` no es decorativo: Sequelize convierte el include en
      // INNER JOIN apenas ve un `where`, y sin el las ordenes de un proveedor
      // borrado desaparecerian del listado —el total seguiria contandolas y la
      // pantalla mostraria menos filas de las que dice—.
      //
      // ⚠ Esto NO mueve el ancla de `analizarIncludes`: es un belongsTo, y ese
      // detector solo clasifica HasMany y HasOne.
      include: [{ model: Supplier, as: 'supplier', attributes: ['id', 'name'], where: { empresa_id }, required: false }],
      order: [['date', 'DESC'], ['id', 'DESC']],
      limit: pageLimit,
      offset: pageOffset,
    });

    const data = rows.map(o => ({
      id: o.id,
      supplier_id: o.supplier_id,
      supplier_name: o.supplier?.name,
      date: o.date,
      total: o.total,
      status: o.status,
      notes: o.notes,
      items: o.detail || [],
      createdAt: o.createdAt,
    }));

    return { data, total: count };
  }

  async getOrderDetail(orderId, empresaId) {
    assertEmpresaId(empresaId);

    const order = await SupplierOrder.findOne({
      where: { id: orderId, empresa_id: empresaId },
      include: [{ model: Supplier, as: 'supplier', attributes: ['id', 'name'] }],
    });
    if (!order) throw new ErrorDeNegocio('Orden no encontrada', 404);

    const detalle = order.detail || [];

    // Cada línea se enriquece con lo que la propuesta de costo necesita.
    //
    // `linea` va EXPLÍCITA y no la deduce la pantalla del orden del arreglo:
    // así el cuerpo de la recepción es copiar un número, y no contar posiciones
    // en un JSONB que además puede llegar filtrado.
    //
    // `propone_costo` se decide ACÁ y no en el navegador. Poner una copia de
    // `esCambioSignificativo` en la web crearía una cuarta implementación de la
    // comparación de importes —la que su propio comentario documenta como la
    // que se comía cambios reales según la magnitud— y una que puede discrepar
    // con la del servidor: una casilla dibujada que al confirmar no hace nada,
    // o una línea sin casilla que sí habría cambiado el costo.
    //
    // No se agrega al listado `GET /api/suppliers/orders`: serían N consultas
    // de producto para dibujar una tabla que no muestra costos.
    const items = [];

    for (const [indice, linea] of detalle.entries()) {
      // findScoped y no findByPk: un product_id de otra empresa en el detalle
      // de una orden vieja —posible, porque FR-062 recién lo impide desde este
      // hito— no puede terminar mostrando el costo de otro cliente.
      const producto = linea.product_id
        ? await findScoped(Product, linea.product_id, empresaId)
        : null;

      const costoActual = producto ? Number(producto.cost) || 0 : null;

      items.push({
        ...linea,
        linea: indice,
        costo_actual: costoActual,
        propone_costo: costoActual !== null
          && esCambioSignificativo(costoActual, linea.unit_price),
      });
    }

    return {
      id: order.id,
      supplier_id: order.supplier_id,
      supplier_name: order.supplier?.name,
      date: order.date,
      total: order.total,
      status: order.status,
      notes: order.notes,
      items,
      createdAt: order.createdAt,
    };
  }
}

module.exports = new PurchaseService();
