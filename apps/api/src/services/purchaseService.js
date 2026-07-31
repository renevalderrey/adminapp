const { Op } = require('sequelize');
const {
  Supplier,
  SupplierOrder,
  SupplierMovement,
  Stock,
  Product,
  sequelize,
} = require('../models');
const { assertEmpresaId } = require('../utils/tenantScope');

class PurchaseService {
  async createOrder(supplierId, data, empresaId) {
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
      supplier_id: supplierId,
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

        const stockLocation = location || 'general';

        // Faltaba empresa_id: la búsqueda podía encontrar —y sumarle stock a—
        // la fila de otra empresa cliente, y el alta creaba filas que caían en
        // la empresa 1 por el default de la columna.
        const where = puntoDeVentaId
          ? { product_id: received.product_id, empresa_id: empresaId, punto_de_venta_id: puntoDeVentaId }
          : { product_id: received.product_id, empresa_id: empresaId, location: stockLocation };

        const stock = await Stock.findOne({ where, transaction: t, lock: t.LOCK.UPDATE });

        if (stock) {
          await stock.update({
            quantity: stock.quantity + actualReceive,
            available: stock.available + actualReceive,
          }, { transaction: t });
        } else {
          await Stock.create({
            product_id: received.product_id,
            empresa_id: empresaId,
            location: stockLocation,
            punto_de_venta_id: puntoDeVentaId || null,
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
    const where = {};
    if (empresa_id) where.empresa_id = empresa_id;

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
