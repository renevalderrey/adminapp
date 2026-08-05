const { Op } = require('sequelize');
const {
  Supplier,
  SupplierOrder,
  SupplierMovement,
  Stock,
  Product,
  sequelize,
} = require('../models');
const { assertEmpresaId, findScoped } = require('../utils/tenantScope');
const { ErrorDeNegocio } = require('../utils/errores');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');

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

    const order = await SupplierOrder.create({
      supplier_id: supplier.id,
      empresa_id: empresaId,
      date: date || new Date().toISOString().split('T')[0],
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
  async receiveOrder(orderId, itemsReceived, location = 'general', puntoDeVentaId = null, empresaId) {
    assertEmpresaId(empresaId);

    return sequelize.transaction(async (t) => {
      const order = await SupplierOrder.findOne({
        where: { id: orderId, empresa_id: empresaId },
        include: [{ model: Supplier, as: 'supplier' }],
        transaction: t,
      });
      if (!order) throw new Error('Orden no encontrada');
      if (order.status === 'received') throw new Error('La orden ya fue recibida completa');
      if (order.status === 'cancelled') throw new Error('La orden está anulada');

      // Copia profunda del detalle. `detail` es una columna JSONB: mutar los
      // objetos que devuelve Sequelize y despues reasignar la MISMA referencia
      // no marca el campo como modificado, y el UPDATE salia sin la columna.
      // Las cantidades recibidas nunca se persistian: cada recepción parcial
      // se perdía y el detalle quedaba siempre en cero.
      const detail = (order.detail || []).map((d) => ({ ...d }));
      let totalReceived = 0;

      for (const received of itemsReceived) {
        const match = detail.find((d) => d.product_id === received.product_id);
        if (!match) continue;

        const qtyReceived = parseFloat(received.quantity_received) || 0;
        if (qtyReceived <= 0) continue;

        const ordered = parseFloat(match.quantity) || 0;
        const alreadyReceived = parseFloat(match.quantity_received) || 0;
        const actualReceive = Math.min(qtyReceived, ordered - alreadyReceived);

        if (actualReceive <= 0) continue;

        match.quantity_received = alreadyReceived + actualReceive;
        totalReceived += actualReceive * (parseFloat(match.unit_price) || 0);

        // La sucursal sale de la función compartida: cabecera, si no el por
        // defecto de la empresa. La rama por `location` de antes creaba filas
        // sin sucursal cuando la orden se recibía sin cabecera —que es lo
        // normal, porque recibir mercadería no se hace desde el POS—, y esa
        // mercadería no aparecía en la pantalla.
        //
        // El parámetro `location` se conserva en la firma por compatibilidad y
        // **ya no ubica nada**: su valor por defecto era el literal `'general'`,
        // que en una empresa cuyos códigos son otros no coincide con ninguna
        // sucursal. Interpretarlo como código haría fallar la recepción entera
        // por un valor por defecto que nadie eligió.
        //
        // `empresa_id` sigue en el where Y en el alta: sin él, la búsqueda
        // podía encontrar —y sumarle stock a— la fila de otra empresa cliente,
        // y el alta creaba filas que caían en la empresa 1 por el default de la
        // columna.
        const ubicacion = ubicacionDeStock(await resolverSucursal({
          empresaId,
          puntoDeVentaId,
          transaction: t,
        }));

        const stock = await Stock.findOne({
          where: {
            product_id: received.product_id,
            empresa_id: empresaId,
            punto_de_venta_id: ubicacion.punto_de_venta_id,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (stock) {
          await stock.update({
            quantity: stock.quantity + actualReceive,
            available: stock.available + actualReceive,
          }, { transaction: t });
        } else {
          await Stock.create({
            product_id: received.product_id,
            empresa_id: empresaId,
            ...ubicacion,
            quantity: actualReceive,
            available: actualReceive,
            min_stock: 0,
          }, { transaction: t });
        }
      }

      // El estado se decide mirando TODAS las líneas del detalle, no solo las
      // que vinieron en esta recepción. Antes `allReceived` arrancaba en true y
      // solo se bajaba dentro del bucle: recibir una línea de tres marcaba la
      // orden como recibida completa, y a partir de ahí la guarda de arriba
      // impedía recibir el resto para siempre.
      const todoRecibido = detail.every((d) => {
        const pedido = parseFloat(d.quantity) || 0;
        const recibido = parseFloat(d.quantity_received) || 0;
        return recibido >= pedido;
      });

      const newStatus = todoRecibido ? 'received' : 'partial';

      order.detail = detail;
      order.status = newStatus;
      // JSONB: aunque `detail` sea un array nuevo, se marca explícitamente por
      // las dudas. Es barato y no depende de cómo Sequelize compare el campo.
      order.changed('detail', true);
      await order.save({ transaction: t });

      if (totalReceived > 0) {
        await SupplierMovement.create({
          supplier_id: order.supplier_id,
          empresa_id: order.empresa_id,
          type: 'deuda',
          date: new Date().toISOString().split('T')[0],
          amount: Math.round(totalReceived * 100) / 100,
          notes: `Recepción orden #${order.id}${newStatus === 'partial' ? ' (parcial)' : ''}`,
        }, { transaction: t });
      }

      return order;
    });
  }

  async cancelOrder(orderId, empresaId) {
    // Sin esto, una llamada con empresaId undefined arma
    // `where: { empresa_id: undefined }`. Sequelize lo rechaza, pero como un
    // error de parametro que termina en un 500 sin explicacion; assertEmpresaId
    // dice que falta el middleware requireEmpresa, que es el problema real.
    assertEmpresaId(empresaId);

    const order = await SupplierOrder.findOne({ where: { id: orderId, empresa_id: empresaId } });
    if (!order) throw new Error('Orden no encontrada');
    if (order.status === 'received') throw new Error('No se puede anular una orden ya recibida');
    if (order.status === 'cancelled') throw new Error('La orden ya está anulada');

    order.status = 'cancelled';
    await order.save();
    return order;
  }

  async getOrders(filters = {}) {
    const { supplier_id, status, from, to, limit, offset, empresa_id } = filters;

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

    const pageLimit = parseInt(limit) || 50;
    const pageOffset = parseInt(offset) || 0;

    const { count, rows } = await SupplierOrder.findAndCountAll({
      where,
      include: [{ model: Supplier, as: 'supplier', attributes: ['id', 'name'] }],
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
    if (!order) throw new Error('Orden no encontrada');

    return {
      id: order.id,
      supplier_id: order.supplier_id,
      supplier_name: order.supplier?.name,
      date: order.date,
      total: order.total,
      status: order.status,
      notes: order.notes,
      items: order.detail || [],
      createdAt: order.createdAt,
    };
  }
}

module.exports = new PurchaseService();
