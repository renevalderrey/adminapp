const express = require('express');
const router = express.Router();
const { Supplier, SupplierOrder, SupplierMovement, SupplierDocument } = require('../models');
const sequelize = require('../config/database');
const purchaseService = require('../services/purchaseService');
const checkPermission = require('../middleware/checkPermission');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const { findScoped } = require('../utils/tenantScope');

/**
 * Responde con SU codigo los errores que lo llevan, para que la pantalla
 * distinga «esa linea no existe» de «esa linea no es de ese producto» sin
 * parsear un texto en castellano.
 *
 * Se separa de fallo() por el mismo motivo que `respondioErrorDeFiltro` en
 * routes/sales.js: fallo() manda solo el mensaje. Un aviso con el nombre del
 * producto adentro de una frase no se puede usar para decidir nada.
 *
 * @returns {boolean} true si el error tenia codigo y ya se respondio.
 */
function respondioConCodigo(res, err) {
  if (!err || !err.codigo) return false;

  res.status(err.status || 400).json({
    ok: false,
    error: err.codigo,
    message: err.message,
  });
  return true;
}

/** Los cuatro estados del ENUM de supplier_orders. */
const ESTADOS_DE_ORDEN = ['pending', 'partial', 'received', 'cancelled'];

/**
 * Valida los filtros del listado de órdenes antes de que lleguen a la base.
 *
 * `if (supplier_id) where.supplier_id = supplier_id` mandaba `' '` —un espacio,
 * que es el valor centinela con el que la pantalla dice «todos»— a una columna
 * INTEGER. Postgres respondia `invalid input syntax for type integer`, subia
 * como 500, y el catch de la pantalla hacia console.error: **la lista quedaba
 * con lo anterior y sin ningun aviso**. Volver a «Todos» despues de filtrar por
 * un proveedor no volvia a «Todos»: rompia.
 *
 * La correccion de fondo es de la pantalla —«todos» tiene que producir la
 * AUSENCIA del parametro— y esta validacion va igual, porque un valor del tipo
 * equivocado no puede subir como 500 y porque el navegador no es una barrera.
 *
 * @throws {Error & {codigo: string, status: number}}
 */
function filtrosDeOrdenes(query = {}) {
  const { supplier_id, status, from, to, limit, offset } = query;

  const invalido = (detalle) => {
    const err = new ErrorDeNegocio(detalle, 400);
    err.codigo = 'FILTRO_INVALIDO';
    return err;
  };

  const filtros = { limit, offset };

  if (supplier_id !== undefined && supplier_id !== '') {
    const n = Number(supplier_id);
    if (!Number.isInteger(n) || n <= 0) {
      throw invalido('El filtro de proveedor tiene que ser un número. Elegí «Todos» para no filtrar.');
    }
    filtros.supplier_id = n;
  }

  if (status !== undefined && status !== '') {
    if (!ESTADOS_DE_ORDEN.includes(status)) {
      throw invalido(`El estado «${status}» no existe. Los estados son: ${ESTADOS_DE_ORDEN.join(', ')}.`);
    }
    filtros.status = status;
  }

  for (const [nombre, valor] of [['from', from], ['to', to]]) {
    if (valor === undefined || valor === '') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      throw invalido(`La fecha «${valor}» no tiene la forma AAAA-MM-DD.`);
    }
    filtros[nombre] = valor;
  }

  return filtros;
}

// ── Órdenes de Compra (deben ir ANTES de /:id) ──

// GET /api/suppliers/orders — Lista global de órdenes
router.get('/orders', checkPermission('ordenes_compra.ver'), async (req, res) => {
  try {
    const result = await purchaseService.getOrders({
      ...filtrosDeOrdenes(req.query),
      empresa_id: req.empresaId,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (respondioConCodigo(res, err)) return;
    fallo(req, res, err, 'Error al listar las órdenes de compra');
  }
});

// GET /api/suppliers/orders/:id — Detalle de orden
router.get('/orders/:id', checkPermission('ordenes_compra.ver'), async (req, res) => {
  try {
    const order = await purchaseService.getOrderDetail(req.params.id, req.empresaId);
    res.json({ ok: true, data: order });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener la orden de compra');
  }
});

// PUT /api/suppliers/orders/:id/receive — Recibir orden
router.put('/orders/:id/receive', checkPermission('ordenes_compra.recibir'), async (req, res) => {
  try {
    const cuerpo = {
      ...req.body,
      // El id del cuerpo manda (FR-103); si no vino, cae a la cabecera
      // X-Punto-De-Venta-Id y despues a la sucursal por defecto, adentro de
      // resolverSucursal.
      punto_de_venta_id: req.body?.punto_de_venta_id ?? req.puntoDeVentaId ?? null,
    };

    // El autor del cambio de costo sale de la sesion, nunca del cuerpo: una
    // fila de historial firmada por quien diga el cliente no sirve de nada.
    const data = await purchaseService.receiveOrder(
      req.params.id,
      cuerpo,
      req.empresaId,
      req.usuario ? req.usuario.id : null
    );
    res.json({ ok: true, data });
  } catch (err) {
    if (respondioConCodigo(res, err)) return;
    fallo(req, res, err, 'Error al recibir la orden de compra');
  }
});

// PUT /api/suppliers/orders/:id/cancel — Anular orden
router.put('/orders/:id/cancel', checkPermission('ordenes_compra.anular'), async (req, res) => {
  try {
    const order = await purchaseService.cancelOrder(req.params.id, req.empresaId);
    res.json({ ok: true, data: { id: order.id, status: order.status } });
  } catch (err) {
    fallo(req, res, err, 'Error al anular la orden de compra');
  }
});

// ── Proveedores ──

// Las columnas que el cliente puede escribir, por modelo.
//
// El patron `update(req.body)` no solo escribe de mas: escribe `empresa_id` si
// viene en el cuerpo, y con eso el proveedor —con sus movimientos, sus ordenes
// y sus documentos— pasa a ser de otro cliente. Encontrar la fila con el
// scoping correcto no impide sacarla de la empresa despues. Es el mismo
// agujero que se cerro en PUT /api/products/:id.
const CAMPOS_DE_PROVEEDOR = ['name', 'phone', 'email', 'address', 'cuit'];
const CAMPOS_DE_MOVIMIENTO = ['type', 'date', 'amount', 'payment_method', 'notes', 'due_date'];

/** Se queda con las claves permitidas que efectivamente vinieron. */
function soloCampos(cuerpo = {}, permitidos) {
  const salida = {};
  for (const campo of permitidos) {
    if (cuerpo[campo] !== undefined) salida[campo] = cuerpo[campo];
  }
  return salida;
}

// GET /api/suppliers — Listar todos
router.get('/', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const suppliers = await Supplier.findAll({
      where: { empresa_id: req.empresaId },
      // ── Por que cada include lleva su propio where ──
      //
      // Sequelize une el hijo SOLO por supplier_id. Filtrar el padre por
      // empresa no filtra a los hijos: un movimiento creado desde otra empresa
      // cliente contra este mismo proveedor entraba igual en la cuenta
      // corriente y le cambiaba el saldo. La otra mitad del agujero —poder
      // crear ese movimiento— se cierra validando el proveedor antes de
      // escribir, mas abajo en este archivo.
      //
      // `required: false` no es decorativo: Sequelize convierte el include en
      // INNER JOIN apenas ve un `where`, y sin el los proveedores sin
      // movimientos ni documentos desaparecerian del listado.
      include: [
        { model: SupplierMovement, as: 'movements', where: { empresa_id: req.empresaId }, required: false },
        { model: SupplierDocument, as: 'documents', where: { empresa_id: req.empresaId }, required: false },
      ],
      order: [['name', 'ASC']],
    });
    res.json({ ok: true, data: suppliers });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los proveedores');
  }
});

// GET /api/suppliers/:id — Detalle
router.get('/:id', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const supplier = await findScoped(Supplier, req.params.id, req.empresaId, {
      // Mismo motivo que en el listado: el include une por supplier_id y nada
      // mas. Esta es la pantalla de cuenta corriente, asi que un movimiento
      // ajeno que se colara aca cambia un saldo que el usuario cree.
      include: [
        { model: SupplierOrder, as: 'orders', where: { empresa_id: req.empresaId }, required: false, order: [['date', 'DESC']] },
        { model: SupplierMovement, as: 'movements', where: { empresa_id: req.empresaId }, required: false, order: [['date', 'DESC']] },
        { model: SupplierDocument, as: 'documents', where: { empresa_id: req.empresaId }, required: false },
      ],
    });
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
    res.json({ ok: true, data: supplier });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener el proveedor');
  }
});

// POST /api/suppliers — Crear proveedor
router.post('/', checkPermission('proveedores.crear'), async (req, res) => {
  try {
    const supplier = await Supplier.create({
      ...soloCampos(req.body, CAMPOS_DE_PROVEEDOR),
      empresa_id: req.empresaId,
    });
    res.status(201).json({ ok: true, data: supplier });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el proveedor');
  }
});

// PUT /api/suppliers/:id — Actualizar proveedor
router.put('/:id', checkPermission('proveedores.editar'), async (req, res) => {
  try {
    const supplier = await findScoped(Supplier, req.params.id, req.empresaId);
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
    await supplier.update(soloCampos(req.body, CAMPOS_DE_PROVEEDOR));
    res.json({ ok: true, data: supplier });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar el proveedor');
  }
});

// DELETE /api/suppliers/:id — Eliminar proveedor
router.delete('/:id', checkPermission('proveedores.eliminar'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const supplier = await Supplier.findOne({ where: { id: req.params.id, empresa_id: req.empresaId }, transaction: t });
    if (!supplier) {
      // Sin este rollback la transaccion quedaba abierta y con ella la
      // conexion: cada 404 se llevaba una del pool hasta el timeout.
      await t.rollback();
      return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
    }
    await SupplierDocument.destroy({ where: { supplier_id: req.params.id }, transaction: t });
    await SupplierMovement.destroy({ where: { supplier_id: req.params.id }, transaction: t });
    await SupplierOrder.destroy({ where: { supplier_id: req.params.id }, transaction: t });
    await Supplier.destroy({ where: { id: req.params.id }, transaction: t });
    await t.commit();
    res.json({ ok: true, message: 'Proveedor eliminado' });
  } catch (err) {
    await t.rollback();
    fallo(req, res, err, 'Error al eliminar el proveedor');
  }
});

// ── Pedidos ──

// POST /api/suppliers/:id/orders — Crear pedido con items
router.post('/:id/orders', checkPermission('ordenes_compra.crear'), async (req, res) => {
  try {
    const order = await purchaseService.createOrder(req.params.id, req.body, req.empresaId);
    res.status(201).json({ ok: true, data: order });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el pedido al proveedor');
  }
});

// ── Pagos ──

// POST /api/suppliers/:id/payments — Registrar pago
router.post('/:id/payments', checkPermission('proveedores.crear'), async (req, res) => {
  try {
    // El proveedor se valida ANTES de escribir. La fila se creaba con el
    // empresa_id de quien mandaba el pago, asi que parecia inocua; el problema
    // era del otro lado: colgada de un proveedor ajeno, el include de
    // GET /:id la mostraba en la cuenta corriente del otro cliente y le movia
    // el saldo. Escribir en la empresa propia no alcanza si el padre es ajeno.
    //
    // 404 y no 403: un 403 confirmaria que ese proveedor existe en otra
    // empresa, que es justo lo que permite enumerar ids ajenos.
    const supplier = await findScoped(Supplier, req.params.id, req.empresaId);
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });

    const { date, amount, payment_method, notes } = req.body;
    const movement = await SupplierMovement.create({
      supplier_id: supplier.id,
      empresa_id: req.empresaId,
      type: 'pago',
      date,
      amount,
      payment_method,
      notes,
    });
    res.status(201).json({ ok: true, data: movement });
  } catch (err) {
    fallo(req, res, err, 'Error al registrar el pago al proveedor');
  }
});

// ── Movimientos ──

// PUT /api/suppliers/movements/:id — Editar movimiento
router.put('/movements/:id', checkPermission('proveedores.editar'), async (req, res) => {
  try {
    const movement = await findScoped(SupplierMovement, req.params.id, req.empresaId);
    if (!movement) return res.status(404).json({ ok: false, error: 'Movimiento no encontrado' });
    // Sin lista blanca, `supplier_id` y `empresa_id` viajaban en el cuerpo: un
    // pago propio se podia reasignar al proveedor de otro cliente sin crear
    // nada, solo editando.
    await movement.update(soloCampos(req.body, CAMPOS_DE_MOVIMIENTO));
    res.json({ ok: true, data: movement });
  } catch (err) {
    fallo(req, res, err, 'Error al editar el movimiento del proveedor');
  }
});

// DELETE /api/suppliers/movements/:id — Eliminar movimiento
router.delete('/movements/:id', checkPermission('proveedores.eliminar'), async (req, res) => {
  try {
    const deleted = await SupplierMovement.destroy({ where: { id: req.params.id, empresa_id: req.empresaId } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Movimiento no encontrado' });
    res.json({ ok: true, message: 'Movimiento eliminado' });
  } catch (err) {
    fallo(req, res, err, 'Error al eliminar el movimiento del proveedor');
  }
});

// ── Documentos ──

// POST /api/suppliers/:id/documents
router.post('/:id/documents', checkPermission('proveedores.editar'), async (req, res) => {
  try {
    // Este endpoint ya validaba el proveedor y es el modelo que siguen los
    // demas. Pasa por findScoped por lo mismo que el resto del repositorio:
    // normaliza el id al tipo de la clave primaria, asi que un id que no es un
    // numero da 404 en vez de un 500 de Postgres.
    const supplier = await findScoped(Supplier, req.params.id, req.empresaId);
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
    // Lista blanca en vez de `...req.body`. El spread iba DESPUES de las dos
    // claves de scoping, con lo cual mandar `empresa_id` o `supplier_id` en el
    // cuerpo las pisaba: el documento terminaba en la empresa que dijera el
    // cliente. Es el mismo agujero que se cerro en PUT /api/products/:id.
    const { name, type, url, date } = req.body;
    const doc = await SupplierDocument.create({
      supplier_id: supplier.id,
      empresa_id: req.empresaId,
      name, type, url, date,
    });
    res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    fallo(req, res, err, 'Error al adjuntar el documento del proveedor');
  }
});

// DELETE /api/suppliers/documents/:id
router.delete('/documents/:id', checkPermission('proveedores.eliminar'), async (req, res) => {
  try {
    const deleted = await SupplierDocument.destroy({ where: { id: req.params.id, empresa_id: req.empresaId } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
    res.json({ ok: true, message: 'Documento eliminado' });
  } catch (err) {
    fallo(req, res, err, 'Error al eliminar el documento del proveedor');
  }
});

module.exports = router;
