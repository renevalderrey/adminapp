// ════════════════════════════════════════════
//  ADMINAPP · Rutas: Stock, Marcas, Gastos, Settings
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Stock, Brand, Product, FixedExpense, Setting, PuntoDeVenta, Supplier } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { fallo } = require('../utils/errores');

// ═══════ STOCK ═══════

// GET /api/stock — Stock (filtrado por punto de venta activo)
router.get('/stock', checkPermission('stock.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;
    // empresa_id es NOT NULL en las 22 tablas del schema: aceptar tambien
    // empresa_id IS NULL era codigo muerto, y se volveria una fuga el dia que
    // alguien haga la columna nullable.
    const where = { empresa_id: empresaId };
    if (req.puntoDeVentaId) {
      where.punto_de_venta_id = req.puntoDeVentaId;
    } else if (req.query.location) {
      where.location = req.query.location;
    }

    const stock = await Stock.findAll({
      where,
      include: [{ model: Product, as: 'product', include: [{ model: Brand, as: 'brand' }] }],
      order: [[{ model: Product, as: 'product' }, 'name', 'ASC']],
    });

    res.json({ ok: true, data: stock });
  } catch (err) {
    fallo(req, res, err, 'Error al listar el stock');
  }
});

// PUT /api/stock/:id — Actualizar cantidad (con validación y auditoría)
router.put('/stock/:id', checkPermission('stock.editar'), async (req, res) => {
  try {
    const stock = await findScoped(Stock, req.params.id, req.empresaId);
    if (!stock) return res.status(404).json({ ok: false, error: 'Registro de stock no encontrado' });

    const { quantity, available } = req.body;
    if (quantity !== undefined && quantity < 0) {
      return res.status(400).json({ ok: false, error: 'El stock no puede ser negativo' });
    }
    if (available !== undefined && available < 0) {
      return res.status(400).json({ ok: false, error: 'El disponible no puede ser negativo' });
    }

    const oldQty = stock.quantity;
    const oldAvail = stock.available;

    // Solo estos campos. Antes era update(req.body) crudo: el cliente podia
    // mandar empresa_id, product_id o punto_de_venta_id y mover la fila de
    // stock a otra empresa o a otro producto.
    const cambios = {};
    if (quantity !== undefined) cambios.quantity = quantity;
    if (available !== undefined) cambios.available = available;
    if (req.body.min_stock !== undefined) cambios.min_stock = req.body.min_stock;
    if (req.body.location !== undefined) cambios.location = req.body.location;
    if (req.body.current_batch !== undefined) cambios.current_batch = req.body.current_batch;
    if (req.body.expiration_date !== undefined) cambios.expiration_date = req.body.expiration_date;
    if (req.body.purchase_date !== undefined) cambios.purchase_date = req.body.purchase_date;

    // quantity y available describen el mismo inventario: available es lo que
    // se puede vender, quantity lo que hay fisicamente. Mover una sin la otra
    // las hace divergir hasta que available supera a quantity.
    if (cambios.quantity !== undefined && cambios.available === undefined) {
      const delta = cambios.quantity - oldQty;
      cambios.available = Math.max(0, oldAvail + delta);
    }

    await stock.update(cambios);

    if (quantity !== undefined || available !== undefined) {
      const StockMovement = require('../models/StockMovement');
      await StockMovement.create({
        empresa_id: stock.empresa_id,
        product_id: stock.product_id,
        punto_de_venta_id: stock.punto_de_venta_id,
        tipo: 'manual',
        referencia_id: null,
        cantidad_anterior: oldQty,
        cantidad_nueva: stock.quantity,
        disponible_anterior: oldAvail,
        disponible_nuevo: stock.available,
        usuario_id: req.userId,
      });
    }

    res.json({ ok: true, data: stock });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar el stock');
  }
});

// POST /api/stock — Crear o actualizar stock de un producto en una sucursal
router.post('/stock', checkPermission('stock.editar'), async (req, res) => {
  try {
    const { product_id, quantity, available, min_stock, location, punto_de_venta_id } = req.body;
    const empresaId = req.empresaId;
    if (!product_id) return res.status(400).json({ ok: false, error: 'product_id es requerido' });

    let loc = location;
    if (!loc && punto_de_venta_id) {
      // El punto de venta viene del body: hay que confirmar que sea de esta
      // empresa antes de usarlo para ubicar el stock.
      const pv = await findScoped(PuntoDeVenta, punto_de_venta_id, empresaId);
      if (!pv) {
        return res.status(400).json({ ok: false, error: 'Punto de venta inválido' });
      }
      loc = pv.code || pv.name || 'general';
    }

    const [stock, created] = await Stock.findOrCreate({
      where: { product_id, punto_de_venta_id: punto_de_venta_id || null, empresa_id: empresaId },
      defaults: {
        quantity: quantity ?? 0,
        available: available ?? quantity ?? 0,
        min_stock: min_stock ?? 0,
        location: loc || 'general',
        punto_de_venta_id: punto_de_venta_id || null,
        empresa_id: empresaId,
      },
    });

    if (!created) {
      // Si solo viene quantity, available se mueve el mismo delta: son dos
      // vistas del mismo inventario y actualizar una sola las desincroniza.
      const nuevaQty = quantity ?? stock.quantity;
      const nuevaDisp = available ?? (
        quantity !== undefined
          ? Math.max(0, stock.available + (quantity - stock.quantity))
          : stock.available
      );

      await stock.update({
        quantity: nuevaQty,
        available: nuevaDisp,
        min_stock: min_stock ?? stock.min_stock,
      });
    }

    res.json({ ok: true, data: stock });
  } catch (err) {
    fallo(req, res, err, 'Error al cargar el stock');
  }
});

// POST /api/stock/bulk — Carga masiva de stock por sucursal
router.post('/stock/bulk', checkPermission('stock.editar'), async (req, res) => {
  try {
    const { items, location } = req.body;
    const empresaId = req.empresaId;
    if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'Formato inválido' });
    const loc = location || 'general';
    const pvId = req.puntoDeVentaId || null;

    let updated = 0;
    for (const item of items) {
      const where = pvId
        ? { product_id: item.product_id, punto_de_venta_id: pvId, empresa_id: empresaId }
        : { product_id: item.product_id, location: loc, empresa_id: empresaId };
      const [stock, created] = await Stock.findOrCreate({
        where,
        defaults: { quantity: item.quantity, available: item.quantity, location: loc, empresa_id: empresaId, punto_de_venta_id: pvId },
      });
      if (!created) {
        await stock.update({ quantity: item.quantity, available: item.quantity });
      }
      updated++;
    }

    res.json({ ok: true, updated });
  } catch (err) {
    fallo(req, res, err, 'Error en la carga masiva de stock');
  }
});

// ═══════ MARCAS ═══════

// GET /api/brands
router.get('/brands', checkPermission('products.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;
    const brands = await Brand.findAll({
      where: { empresa_id: empresaId },
      order: [['name', 'ASC']],
    });
    res.json({ ok: true, data: brands });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las marcas');
  }
});

// POST /api/brands
router.post('/brands', checkPermission('products.crear'), async (req, res) => {
  try {
    const brand = await Brand.create({ ...req.body, empresa_id: req.empresaId });
    res.status(201).json({ ok: true, data: brand });
  } catch (err) {
    fallo(req, res, err, 'Error al crear la marca');
  }
});

// ═══════ GASTOS FIJOS ═══════

// GET /api/expenses?group=gf1
router.get('/expenses', checkPermission('gastos.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;
    // empresa_id es NOT NULL en las 22 tablas del schema: aceptar tambien
    // empresa_id IS NULL era codigo muerto, y se volveria una fuga el dia que
    // alguien haga la columna nullable.
    const where = { empresa_id: empresaId };
    if (req.query.group) where.group = req.query.group;
    if (req.query.punto_de_venta_id) where.punto_de_venta_id = req.query.punto_de_venta_id;
    const expenses = await FixedExpense.findAll({ where, order: [['id', 'ASC']] });
    res.json({ ok: true, data: expenses });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los gastos fijos');
  }
});

// POST /api/expenses
router.post('/expenses', checkPermission('gastos.crear'), async (req, res) => {
  try {
    const data = { ...req.body, empresa_id: req.empresaId };
    if (!data.group && data.punto_de_venta_id) {
      data.group = 'pv_' + data.punto_de_venta_id;
    }
    const expense = await FixedExpense.create(data);
    res.status(201).json({ ok: true, data: expense });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el gasto fijo');
  }
});

// PUT /api/expenses/:id
router.put('/expenses/:id', checkPermission('gastos.editar'), async (req, res) => {
  try {
    const expense = await findScoped(FixedExpense, req.params.id, req.empresaId);
    if (!expense) return res.status(404).json({ ok: false, error: 'Gasto no encontrado' });

    const { empresa_id, id, ...cambios } = req.body;
    await expense.update(cambios);
    res.json({ ok: true, data: expense });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar el gasto fijo');
  }
});

// DELETE /api/expenses/:id
router.delete('/expenses/:id', checkPermission('gastos.eliminar'), async (req, res) => {
  try {
    // Sin empresa_id esto borraba el gasto fijo de otra empresa cliente. Y los
    // gastos fijos son la base del punto de equilibrio: borrarle uno a otro
    // cliente le cambia el precio que el sistema le recomienda cobrar.
    const deleted = await FixedExpense.destroy({
      where: { id: req.params.id, empresa_id: req.empresaId },
    });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Gasto no encontrado' });
    res.json({ ok: true, message: 'Gasto eliminado' });
  } catch (err) {
    fallo(req, res, err, 'Error al eliminar el gasto fijo');
  }
});

// ═══════ SETTINGS ═══════

// GET /api/settings — Todas las configuraciones
router.get('/settings', checkPermission('config.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;
    // Antes esto aceptaba tambien empresa_id IS NULL, pero la columna es
    // allowNull:false desde la migracion inicial: esas filas no existen.
    const settings = await Setting.findAll({
      where: { empresa_id: empresaId },
    });
    // El JSON de empresa.settings son los VALORES POR DEFECTO que se crean en
    // el onboarding; las filas de la tabla settings son lo que el usuario
    // configuro despues. Las filas tienen que ganar.
    //
    // Antes el Object.assign iba al reves y el JSON pisaba a las filas. Como
    // ese JSON se crea con afip_cuit:'' y afip_pv:'' y nada lo vuelve a
    // escribir, la configuracion real de AFIP quedaba tapada para siempre: el
    // POS leia afip_cuit vacio, isAfipConfigured daba falso y la facturacion
    // electronica no se habilitaba nunca, por mas que estuviera bien cargada.
    const empresa = req.empresa;
    const obj = { ...((empresa && empresa.settings) || {}) };

    settings.forEach((s) => {
      // Una fila con valor vacio no debe tapar el default.
      if (s.value === null || s.value === '') return;
      obj[s.key] = s.value;
    });

    res.json({ ok: true, data: obj });
  } catch (err) {
    fallo(req, res, err, 'Error al leer la configuración');
  }
});

// GET /api/settings/:key — Una configuración específica
router.get('/settings/:key', checkPermission('config.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;
    const setting = await Setting.findOne({
      where: {
        key: req.params.key,
        empresa_id: empresaId,
      },
    });
    res.json({ ok: true, data: setting ? setting.value : null });
  } catch (err) {
    fallo(req, res, err, 'Error al leer la configuración');
  }
});

// PUT /api/settings/:key — Guardar configuración
router.put('/settings/:key', checkPermission('config.editar'), async (req, res) => {
  try {
    const [setting, created] = await Setting.findOrCreate({
      where: { key: req.params.key, empresa_id: req.empresaId },
      defaults: { value: req.body.value, empresa_id: req.empresaId },
    });
    if (!created) await setting.update({ value: req.body.value });
    res.json({ ok: true, data: setting });
  } catch (err) {
    fallo(req, res, err, 'Error al guardar la configuración');
  }
});

// GET /api/alerts — Alertas de stock mínimo y vencimientos próximos
router.get('/alerts', checkPermission('stock.ver'), async (req, res) => {
  try {
    const sequelize = require('../config/database');
    const today = new Date().toISOString().split('T')[0];
    const next30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const empresaId = req.empresaId;
    // empresa_id es NOT NULL en todo el schema; el OR con null era codigo muerto.
    const empresaOrNull = { empresa_id: empresaId };

    // Alertas de stock mínimo
    const lowStock = await Stock.findAll({
      where: {
        ...empresaOrNull,
        quantity: { [Op.lte]: sequelize.col('min_stock') },
        min_stock: { [Op.gt]: 0 },
      },
      include: [{ model: Product, as: 'product' }]
    });

    // Alertas de vencimiento (próximos 30 días)
    const expiringStock = await Stock.findAll({
      where: {
        ...empresaOrNull,
        expiration_date: {
          [Op.between]: [today, next30Days]
        },
      },
      include: [{ model: Product, as: 'product' }]
    });

    res.json({
      ok: true,
      data: {
        lowStock: lowStock.map(s => ({
          id: s.id,
          product_id: s.product_id,
          product_name: s.product ? s.product.name : 'Desconocido',
          location: s.location,
          punto_de_venta_id: s.punto_de_venta_id,
          quantity: s.quantity,
          min_stock: s.min_stock
        })),
        expiringStock: expiringStock.map(s => ({
          id: s.id,
          product_id: s.product_id,
          product_name: s.product ? s.product.name : 'Desconocido',
          location: s.location,
          punto_de_venta_id: s.punto_de_venta_id,
          quantity: s.quantity,
          expiration_date: s.expiration_date,
          current_batch: s.current_batch
        }))
      }
    });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular las alertas de stock');
  }
});

// GET /api/faltantes — Que hay que reponer, listo para armar el pedido
//
// El sistema anterior tenia esta pantalla y era la rutina semanal: mirar que
// falta, poner cantidades, mandarlo por WhatsApp al proveedor. AdminApp tenia
// la alerta de stock bajo en el panel, pero suelta: no traia el proveedor, ni
// el costo, ni una cantidad sugerida, asi que armar el pedido seguia siendo a
// mano.
//
// Se agrupa por proveedor porque es la unidad en la que se pide: a cada
// proveedor se le manda un pedido.
router.get('/faltantes', checkPermission('stock.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;

    // Para los productos que no tienen minimo cargado hace falta un umbral, o
    // no aparecerian nunca. 3 unidades es el valor que usaba el sistema
    // anterior.
    const umbral = Number.isFinite(Number(req.query.umbral)) ? Number(req.query.umbral) : 3;

    const where = { empresa_id: empresaId };

    // Sin punto de venta se mira el stock de toda la empresa. Con uno, solo
    // el de esa sucursal: lo que sobra en una no resuelve lo que falta en otra
    // hasta que alguien lo transfiera.
    if (req.query.punto_de_venta_id) {
      where.punto_de_venta_id = parseInt(req.query.punto_de_venta_id, 10);
    } else if (req.puntoDeVentaId) {
      where.punto_de_venta_id = req.puntoDeVentaId;
    }

    const filas = await Stock.findAll({
      where,
      include: [{
        model: Product,
        as: 'product',
        where: { is_active: true },
        required: true,
        include: [{ model: Brand, as: 'brand', attributes: ['id', 'name'] }],
      }],
    });

    const porProveedor = new Map();
    let totalEstimado = 0;

    for (const fila of filas) {
      const cantidad = Number(fila.quantity) || 0;
      const minimo = Number(fila.min_stock) || 0;

      // El minimo cargado manda; el umbral es solo para los que no tienen.
      const limite = minimo > 0 ? minimo : umbral;
      if (cantidad > limite) continue;

      const producto = fila.product;

      // Reponer hasta el minimo, y al menos una unidad: un producto en cero
      // sin minimo cargado igual hay que pedirlo.
      const sugerido = Math.max(Math.ceil(limite - cantidad), 1);
      const costo = Number(producto.cost) || 0;

      totalEstimado += costo * sugerido;

      const claveProveedor = producto.supplier_id || 'sin_proveedor';

      if (!porProveedor.has(claveProveedor)) {
        porProveedor.set(claveProveedor, {
          supplier_id: producto.supplier_id || null,
          proveedor: null,
          items: [],
          total_estimado: 0,
        });
      }

      const grupo = porProveedor.get(claveProveedor);

      grupo.items.push({
        product_id: producto.id,
        nombre: producto.name,
        sku: producto.sku,
        marca: producto.brand ? producto.brand.name : null,
        stock: cantidad,
        min_stock: minimo,
        sugerido,
        costo,
        punto_de_venta_id: fila.punto_de_venta_id,
        location: fila.location,
      });

      grupo.total_estimado += costo * sugerido;
    }

    // Los nombres de proveedor se resuelven en una sola consulta y no uno por
    // uno dentro del bucle.
    const idsProveedor = [...porProveedor.keys()].filter((k) => k !== 'sin_proveedor');

    if (idsProveedor.length) {
      const proveedores = await Supplier.findAll({
        where: { id: { [Op.in]: idsProveedor }, empresa_id: empresaId },
        attributes: ['id', 'name', 'phone'],
      });

      for (const p of proveedores) {
        const grupo = porProveedor.get(p.id);
        if (grupo) grupo.proveedor = { id: p.id, nombre: p.name, telefono: p.phone };
      }
    }

    const grupos = [...porProveedor.values()]
      .map((g) => ({
        ...g,
        total_estimado: Math.round(g.total_estimado * 100) / 100,
        items: g.items.sort((a, b) => a.stock - b.stock || a.nombre.localeCompare(b.nombre)),
      }))
      .sort((a, b) => b.items.length - a.items.length);

    res.json({
      ok: true,
      data: {
        umbral,
        total_items: grupos.reduce((s, g) => s + g.items.length, 0),
        total_estimado: Math.round(totalEstimado * 100) / 100,
        proveedores: grupos,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular los faltantes');
  }
});

module.exports = router;
