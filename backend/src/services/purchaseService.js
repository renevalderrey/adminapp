const { Op } = require('sequelize');
const {
  Supplier,
  SupplierOrder,
  SupplierMovement,
  Stock,
  Product,
  sequelize,
} = require('../models');

class PurchaseService {
  async createOrder(supplierId, data, empresaId = 1) {
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

  async receiveOrder(orderId, itemsReceived, location = 'general', puntoDeVentaId = null, empresaId = 1) {
    const order = await SupplierOrder.findOne({
      where: { id: orderId, empresa_id: empresaId },
      include: [{ model: Supplier, as: 'supplier' }],
    });
    if (!order) throw new Error('Orden no encontrada');
    if (order.status === 'received') throw new Error('La orden ya fue recibida completa');
    if (order.status === 'cancelled') throw new Error('La orden está anulada');

    const detail = order.detail || [];
    let allReceived = true;
    let totalReceived = 0;

    for (const received of itemsReceived) {
      const match = detail.find(d => d.product_id === received.product_id);
      if (!match) continue;

      const qtyReceived = parseFloat(received.quantity_received) || 0;
      if (qtyReceived <= 0) continue;

      const ordered = parseFloat(match.quantity) || 0;
      const alreadyReceived = parseFloat(match.quantity_received) || 0;
      const remaining = ordered - alreadyReceived;
      const actualReceive = Math.min(qtyReceived, remaining);

      if (actualReceive <= 0) continue;

      match.quantity_received = (alreadyReceived + actualReceive);
      totalReceived += actualReceive * (parseFloat(match.unit_price) || 0);

      const stockLocation = location || 'general';
      const where = puntoDeVentaId
        ? { product_id: received.product_id, punto_de_venta_id: puntoDeVentaId }
        : { product_id: received.product_id, location: stockLocation };
      let stock = await Stock.findOne({ where });

      if (stock) {
        stock.quantity += actualReceive;
        stock.available += actualReceive;
        await stock.save();
      } else {
        const createData = {
          product_id: received.product_id,
          location: stockLocation,
          quantity: actualReceive,
          available: actualReceive,
          min_stock: 0,
        };
        if (puntoDeVentaId) createData.punto_de_venta_id = puntoDeVentaId;
        await Stock.create(createData);
      }

      if ((alreadyReceived + actualReceive) < ordered) {
        allReceived = false;
      }
    }

    const newStatus = allReceived ? 'received' : 'partial';
    order.detail = detail;
    order.status = newStatus;
    await order.save();

    if (totalReceived > 0 && (newStatus === 'received' || newStatus === 'partial')) {
      await SupplierMovement.create({
        supplier_id: order.supplier_id,
        empresa_id: order.empresa_id || 1,
        type: 'deuda',
        date: new Date().toISOString().split('T')[0],
        amount: Math.round(totalReceived * 100) / 100,
        notes: `Recepción orden #${order.id}${newStatus === 'partial' ? ' (parcial)' : ''}`,
      });
    }

    return order;
  }

  async cancelOrder(orderId, empresaId = 1) {
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

  async getOrderDetail(orderId, empresaId = 1) {
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
