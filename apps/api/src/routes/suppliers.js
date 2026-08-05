const express = require('express');
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const router = express.Router();
const { Supplier, SupplierOrder, SupplierMovement, SupplierDocument } = require('../models');
const sequelize = require('../config/database');
const purchaseService = require('../services/purchaseService');
const checkPermission = require('../middleware/checkPermission');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const { findScoped } = require('../utils/tenantScope');
// El saldo lo calcula el servidor (decisión 4 del plan). La aritmética vive en
// utils/ y no acá porque el GROUP BY no lo pueden ejecutar los dobles de
// modelosFalsos: una suma escrita adentro del handler no la alcanza ningún test.
const {
  resumenDeCuenta,
  pendienteDeRecibir,
  conSaldoAcumulado,
  filaDeCuentaParaExport,
  agruparPorProveedor,
  conteoAgrupado,
  sinAcentos,
  ACENTOS,
  SIN_ACENTOS,
} = require('../utils/cuentaDeProveedor');

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
  const { supplier_id, status, from, to, limit, offset, q } = query;

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

  // ── La búsqueda, que hasta este corte NO viajaba (FR-009) ──
  //
  // El endpoint aceptaba `supplier_id`, `status`, `from`, `to`, `limit` y
  // `offset`, y nada más, así que el buscador de `/ordenes-compra` filtraba
  // **solo la página cargada** mientras el servidor paginaba de a 50: buscar la
  // orden 77 —que existe, en la página 2— respondía «ninguna orden coincide con
  // el filtro» y la red ni se tocaba. Es un falso negativo, y un aviso que
  // afirma algo que no es cierto hace cerrar la búsqueda y dar la orden por
  // perdida.
  //
  // `q` viaja **tal cual**, y acá no se valida nada: a diferencia de los otros
  // cuatro, cualquier texto es un patrón legítimo —no hay forma de un `q` que
  // haga fallar la consulta— así que no hay nada que rechazar. Lo único que
  // hacía falta es que figure en este destructuring, que es una lista blanca: un
  // parámetro que no está acá no llega nunca al servicio, y por eso la búsqueda
  // no viajaba.
  //
  // ⚠ **Que un `q` vacío o de puros espacios no sea un filtro se decide en
  // `getOrders`**, y no acá, a propósito: es el que normaliza el texto, así que
  // es el único que puede saber si después de normalizarlo queda algo. Un
  // `if (q.trim())` de este lado sería una segunda red que **ningún test puede
  // poner en rojo** —sacarla no cambia una sola respuesta—, y este repositorio
  // ya juntó veinte tests que pasaban con y sin el código que decían proteger.
  if (q !== undefined) filtros.q = q;

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

// ⚠ **`type` NO está en la lista, y es una decisión, no un olvido.** Hasta este
// corte se podía convertir una deuda en un pago editando el movimiento: el saldo
// se movía por el DOBLE del importe y la fila quedaba mintiendo —sus `notes`
// siguen diciendo «Recepción orden #118» mientras cuenta como pago—.
//
// El tipo no es un dato que se corrija: es **de dónde salió la fila**. Una deuda
// la escribe `purchaseService.receiveOrder` cuando llega la mercadería y un pago
// lo escribe `POST /:id/payments`; ninguna pantalla manda `type` en la edición
// (`Orders.jsx`, `guardarMovimiento`). Si alguien cargó el movimiento
// equivocado, se borra y se vuelve a cargar: eso deja una cuenta coherente, y
// una conversión silenciosa deja un asiento que no se corresponde con nada.
const CAMPOS_DE_MOVIMIENTO = ['date', 'amount', 'payment_method', 'notes', 'due_date'];

/** Se queda con las claves permitidas que efectivamente vinieron. */
function soloCampos(cuerpo = {}, permitidos) {
  const salida = {};
  for (const campo of permitidos) {
    if (cuerpo[campo] !== undefined) salida[campo] = cuerpo[campo];
  }
  return salida;
}

/** El tope de una página del listado de proveedores. */
const TOPE_DE_PAGINA = 200;
const POR_PAGINA_POR_DEFECTO = 50;

/**
 * `page` y `limit` normalizados.
 *
 * Un valor fuera de rango **se recorta, no se rechaza**: el parámetro lo arma la
 * pantalla, no el usuario, y dejar a alguien sin ver a sus proveedores por eso
 * es peor que darle una página más chica.
 */
function paginacion(query = {}) {
  const pedido = parseInt(query.limit, 10);
  const limit = Number.isInteger(pedido) && pedido > 0
    ? Math.min(pedido, TOPE_DE_PAGINA)
    : POR_PAGINA_POR_DEFECTO;

  // 1-indexado, como `components/Pagination.jsx`.
  const pagina = Math.max(parseInt(query.page, 10) || 1, 1);

  return { limit, offset: (pagina - 1) * limit };
}

/**
 * La condición de búsqueda por nombre, sin distinguir mayúsculas ni acentos
 * (FR-059).
 *
 * ⚠ **`translate()` y no la extensión `unaccent`**: `unaccent` necesita
 * permisos de superusuario en una base administrada, que es la razón por la que
 * la búsqueda de ventas quedó sensible a acentos (`utils/filtroVentas.js:152`).
 * `translate` es del núcleo de Postgres y no pide nada.
 *
 * La misma lista de acentos normaliza los dos lados —la columna en SQL y el
 * texto que escribió el usuario en JS—, así que no pueden separarse.
 */
function condicionDeNombre(q) {
  const texto = sinAcentos(q).trim();
  if (!texto) return null;

  return sqlWhere(
    fn('translate', fn('lower', col('name')), ACENTOS, SIN_ACENTOS),
    { [Op.like]: `%${texto}%` }
  );
}

// GET /api/suppliers — Listar con el saldo ya calculado
//
// ── Lo que desaparece: `movements` y `documents` ──
//
// Es el hallazgo 7 de la spec. El endpoint traía TODOS los proveedores con
// TODOS sus movimientos y TODOS sus documentos, sin paginar: con tres años de
// operación son decenas de miles de filas en cada carga de pantalla. Y el único
// uso que tenían esos arreglos era que el navegador los sumara para mostrar un
// número —en punto flotante, sobre DECIMAL que el driver devuelve como texto—.
//
// Ahora son cuatro consultas planas, **ninguna con `include`**, y la aritmética
// la hacen las funciones puras de `utils/cuentaDeProveedor.js`. El saldo de acá
// y el de la ficha salen de la MISMA función: no pueden decir números distintos
// (FR-101).
//
// ⚠ Los índices que sostienen las tres consultas agregadas los crea
// `migrations/20260808-indices-de-empresa-en-proveedores.js`. Sin ellos, filtrar
// por empresa en estas tablas es un barrido secuencial de los movimientos de
// todas las empresas cliente.
router.get('/', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;
    const { limit, offset } = paginacion(req.query);

    const filtroDeNombre = condicionDeNombre(req.query.q);
    const where = { empresa_id: empresaId };
    if (filtroDeNombre) where[Op.and] = [filtroDeNombre];

    // El total es el de la búsqueda, no el de la página: sin él la paginación no
    // sabe cuántas páginas hay.
    const total = await Supplier.count({ where });

    const suppliers = await Supplier.findAll({
      where,
      order: [['name', 'ASC']],
      limit,
      offset,
    });

    // ── Las tres consultas agregadas ──
    //
    // Van por la empresa entera y no por la página: son tres consultas fijas
    // contra las N que saldrían de preguntar proveedor por proveedor, que es el
    // problema que este corte viene a cerrar.
    //
    // `status` va en los `attributes` de las órdenes aunque no se muestre:
    // `pendienteDeRecibir` vuelve a filtrar por estado —es pura y no puede
    // suponer que el `where` ya filtró— y sin la columna descartaría todas las
    // filas devolviendo cero, en silencio.
    const movimientos = await SupplierMovement.findAll({
      attributes: ['supplier_id', 'type', [fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'n']],
      where: { empresa_id: empresaId },
      group: ['supplier_id', 'type'],
      raw: true,
    });

    const documentos = await SupplierDocument.findAll({
      attributes: ['supplier_id', [fn('COUNT', col('id')), 'n']],
      where: { empresa_id: empresaId },
      group: ['supplier_id'],
      raw: true,
    });

    const ordenesAbiertas = await SupplierOrder.findAll({
      attributes: ['supplier_id', 'status', 'detail'],
      where: { empresa_id: empresaId, status: ['pending', 'partial'] },
      raw: true,
    });

    const movimientosPorProveedor = agruparPorProveedor(movimientos);
    const documentosPorProveedor = agruparPorProveedor(documentos);
    const ordenesPorProveedor = agruparPorProveedor(ordenesAbiertas);

    const data = suppliers.map((s) => {
      const filas = movimientosPorProveedor.get(s.id) || [];

      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        email: s.email,
        address: s.address,
        cuit: s.cuit,
        ...resumenDeCuenta(filas),
        pendiente_de_recibir: pendienteDeRecibir(ordenesPorProveedor.get(s.id) || []),
        // Conteos, no arreglos: alcanzan para el estado vacío y para el aviso
        // «sin factura» (FR-086), y no traen la contabilidad entera.
        movimientos: conteoAgrupado(filas),
        documentos: conteoAgrupado(documentosPorProveedor.get(s.id) || []),
      };
    });

    res.json({ ok: true, total, data });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los proveedores');
  }
});

/**
 * Los cuatro números de la cuenta de UN proveedor.
 *
 * Los calcula **la misma función** que el listado: ni la lista ni la ficha
 * pueden decir números distintos (FR-101). Por eso vive acá arriba y no adentro
 * de cada handler.
 */
async function cuentaDelProveedor(supplierId, empresaId) {
  const movimientos = await SupplierMovement.findAll({
    attributes: ['type', [fn('SUM', col('amount')), 'total']],
    where: { empresa_id: empresaId, supplier_id: supplierId },
    group: ['type'],
    raw: true,
  });

  // `status` va en los `attributes` aunque no se muestre: `pendienteDeRecibir`
  // vuelve a filtrar por estado —es pura y no puede suponer que el `where` ya
  // filtró— y sin la columna descartaría todas las filas devolviendo cero.
  const ordenesAbiertas = await SupplierOrder.findAll({
    attributes: ['status', 'detail'],
    where: { empresa_id: empresaId, supplier_id: supplierId, status: ['pending', 'partial'] },
    raw: true,
  });

  return {
    ...resumenDeCuenta(movimientos),
    pendiente_de_recibir: pendienteDeRecibir(ordenesAbiertas),
  };
}

// GET /api/suppliers/:id — La ficha, con los cuatro números y sus documentos
//
// ── Lo que se fue, y adónde ──
//
// `movements` pagina por `GET /api/suppliers/:id/movimientos`, que además trae
// el saldo acumulado ya calculado. `orders` sale de
// `GET /api/suppliers/orders?supplier_id=`, que ya existe, ya pagina y ya exige
// `ordenes_compra.ver`.
//
// ⚠ **Ese cambio de permiso es buscado, y es el riesgo 12 del plan**: un usuario
// con `proveedores.ver` y sin `ordenes_compra.ver` hasta hoy veía las órdenes del
// proveedor —porque venían en el include, que solo miraba `proveedores.ver`— y a
// partir de acá no. Es lo que la spec pide en su caso de borde, pero es una
// función que alguien puede estar usando: la mitigación es de la pantalla
// (T1242), que dice «No tenés permiso para ver las órdenes de compra» y **no**
// «Sin órdenes», que son cosas distintas.
//
// `documents` se queda —son pocos, no paginan y el bloque los muestra
// completos— y **es el único include de hijo que sobrevive en el archivo**. Su
// `where: { empresa_id }` no es decorativo: Sequelize une el hijo solo por
// `supplier_id`, así que sin él un documento cargado desde otra empresa cliente
// contra este mismo proveedor aparecería en esta ficha.
router.get('/:id', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const supplier = await findScoped(Supplier, req.params.id, req.empresaId, {
      include: [
        { model: SupplierDocument, as: 'documents', where: { empresa_id: req.empresaId }, required: false },
      ],
    });
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });

    const cuenta = await cuentaDelProveedor(supplier.id, req.empresaId);

    res.json({
      ok: true,
      data: {
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        cuit: supplier.cuit,
        ...cuenta,
        documents: supplier.documents || [],
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener el proveedor');
  }
});

/**
 * El rango de fechas de la cuenta, validado antes de llegar a la base.
 *
 * Mismo criterio que los filtros del listado de órdenes: un valor con la forma
 * equivocada no puede subir como 500 de Postgres.
 */
function rangoDeFechas(query = {}) {
  const rango = {};

  for (const [nombre, valor] of [['desde', query.desde], ['hasta', query.hasta]]) {
    if (valor === undefined || valor === '') continue;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      const err = new ErrorDeNegocio(`La fecha «${valor}» no tiene la forma AAAA-MM-DD.`, 400);
      err.codigo = 'FILTRO_INVALIDO';
      throw err;
    }

    rango[nombre] = valor;
  }

  return rango;
}

/** El `where` de fecha de un rango, o `null` si no hay rango. */
function condicionDeFecha({ desde, hasta }) {
  if (!desde && !hasta) return null;

  const cond = {};
  if (desde) cond[Op.gte] = desde;
  if (hasta) cond[Op.lte] = hasta;
  return cond;
}

// GET /api/suppliers/:id/movimientos — El historial de cuenta, paginado
//
// ⚠ **Cuelga de `/:id/…` a propósito.** `router.get('/:id')` está declarado más
// arriba y se come cualquier palabra literal que se declare después: un
// `GET /api/suppliers/export` iría a parar a `GET /:id` con `id = 'export'`. Es
// la misma trampa documentada en `routes/sales.js:226-230`. Una ruta de dos
// segmentos no tiene ese problema.
router.get('/:id/movimientos', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const supplier = await findScoped(Supplier, req.params.id, req.empresaId);
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });

    const rango = rangoDeFechas(req.query);
    const { limit, offset } = paginacion(req.query);

    const where = { empresa_id: req.empresaId, supplier_id: supplier.id };
    const porFecha = condicionDeFecha(rango);
    if (porFecha) where.date = porFecha;

    const total = await SupplierMovement.count({ where });

    // Descendente por fecha, **desempatando por id**. Sin el desempate, dos
    // movimientos del mismo día pueden salir en orden distinto en dos llamadas y
    // el saldo acumulado de la página cambiaría entre una y otra.
    const movimientos = await SupplierMovement.findAll({
      where,
      order: [['date', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    // ── El saldo con el que arranca esta página ──
    //
    // Sin él, el acumulado de la página 2 sería la suma de un subconjunto y la
    // última fila no coincidiría con el saldo grande de la pantalla (FR-101).
    //
    // Solo se consulta cuando puede haber algo más viejo: en la última página
    // sin filtro de fecha no hay nada abajo y el saldo inicial es cero.
    //
    // ⚠ El `desde` obliga a consultar igual aunque la página sea la última: los
    // movimientos anteriores al rango existen y son justamente el «saldo
    // anterior» del período.
    //
    // ⚠ **Este camino no lo puede ejercitar ningún test unitario** (riesgo 9):
    // los dobles de `modelosFalsos` no entienden `Op.or` ni `Op.lt`, así que
    // devolverían todas las filas y la cuenta daría cualquier cosa. Lo que sí
    // está testeado es la aritmética, en `conSaldoAcumulado`. Que la consulta
    // traiga las filas correctas es el paso manual P1.
    const masViejo = movimientos[movimientos.length - 1];
    const puedeHaberMasViejos = Boolean(masViejo)
      && (offset + movimientos.length < total || Boolean(rango.desde));

    let saldoInicial = 0;

    if (puedeHaberMasViejos) {
      const anteriores = await SupplierMovement.findAll({
        attributes: ['type', [fn('SUM', col('amount')), 'total']],
        where: {
          empresa_id: req.empresaId,
          supplier_id: supplier.id,
          // «Más viejo» con el MISMO desempate que el orden de la página: sin el
          // segundo término, dos movimientos de la misma fecha se contarían dos
          // veces o ninguna según de qué lado del corte caigan.
          [Op.or]: [
            { date: { [Op.lt]: masViejo.date } },
            { date: masViejo.date, id: { [Op.lt]: masViejo.id } },
          ],
        },
        group: ['type'],
        raw: true,
      });

      saldoInicial = resumenDeCuenta(anteriores).saldo;
    }

    res.json({
      ok: true,
      total,
      saldo_inicial: saldoInicial,
      data: conSaldoAcumulado(movimientos, saldoInicial),
    });
  } catch (err) {
    if (respondioConCodigo(res, err)) return;
    fallo(req, res, err, 'Error al obtener los movimientos del proveedor');
  }
});

// El mismo tope que el historial de ventas (`routes/sales.js:209`). Un archivo
// de cuenta corriente más grande que esto no lo abre nadie, y armarlo en memoria
// tampoco es gratis.
const LIMITE_EXPORT = 5000;

// GET /api/suppliers/:id/movimientos/export — Las filas del archivo del contador
//
// Mismo molde que `GET /api/sales/export`: **el servidor arma las filas, el
// navegador arma la hoja** (FR-097). La API no sabe cómo se llama la descarga ni
// qué tipo tiene cada celda; eso es de `utils/exportarProveedores.js`.
//
// ⚠ **Ascendente, al revés que la pantalla, y a propósito**: un saldo acumulado
// que crece hacia abajo es como se lee una cuenta en una planilla.
router.get('/:id/movimientos/export', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const supplier = await findScoped(Supplier, req.params.id, req.empresaId);
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });

    const rango = rangoDeFechas(req.query);

    const where = { empresa_id: req.empresaId, supplier_id: supplier.id };
    const porFecha = condicionDeFecha(rango);
    if (porFecha) where.date = porFecha;

    // El COUNT va primero para no cargar 5.001 filas en memoria y después
    // descartarlas.
    const total = await SupplierMovement.count({ where });

    if (total > LIMITE_EXPORT) {
      return res.status(400).json({
        ok: false,
        error: 'LIMITE_EXPORT_SUPERADO',
        message: `La cuenta tiene ${total} movimientos y el máximo por archivo es ${LIMITE_EXPORT}. Acotá el rango de fechas.`,
        total,
        limite: LIMITE_EXPORT,
      });
    }

    // Sin paginar: el archivo es todo el resultado del filtro.
    const ascendentes = await SupplierMovement.findAll({
      where,
      order: [['date', 'ASC'], ['id', 'ASC']],
      raw: true,
    });

    // ── El saldo con el que arranca el período ──
    //
    // **Acá había un `0` literal.** Con `?desde=`, el archivo del contador
    // arrancaba la cuenta en cero y cerraba en el NETO DEL PERÍODO: $22.000
    // sobre una cuenta que debe $122.000, mientras la pantalla mostraba el saldo
    // entero. Los dos números salían de este mismo hito y no coincidían, que es
    // exactamente lo que prohíben FR-101, el escenario 6 de US8 y
    // `contracts/api-endpoints.md:229` («`saldo_final` es **el mismo número**
    // que el `saldo` del listado»).
    //
    // El endpoint hermano ya lo resolvía así (`:494-517`): los movimientos
    // anteriores al rango existen, y son el «saldo anterior» de la cuenta.
    //
    // Sin `desde` no hay nada más viejo que consultar y el inicial es cero: una
    // consulta menos en el caso común, igual que en el historial paginado.
    let saldoInicial = 0;

    if (rango.desde) {
      const anteriores = await SupplierMovement.findAll({
        attributes: ['type', [fn('SUM', col('amount')), 'total']],
        where: {
          empresa_id: req.empresaId,
          supplier_id: supplier.id,
          // Sin desempate por id: el corte es una fecha, no una fila. Todo lo
          // anterior al primer día del rango queda del lado del saldo anterior.
          date: { [Op.lt]: rango.desde },
        },
        group: ['type'],
        raw: true,
      });

      saldoInicial = resumenDeCuenta(anteriores).saldo;
    }

    // ⚠ `conSaldoAcumulado` recibe DESCENDENTE y devuelve descendente, que es lo
    // que necesita la pantalla. Acá se le da vuelta el arreglo dos veces en vez
    // de escribir una segunda acumulación: dos acumulaciones son dos redondeos
    // que se separan, y entonces la última fila del archivo dejaría de coincidir
    // con el saldo grande de la pantalla.
    const descendentes = [...ascendentes].reverse();
    const conSaldo = [...conSaldoAcumulado(descendentes, saldoInicial)].reverse();

    // `saldo_final` es el acumulado de la **última fila del archivo**, salido de
    // la misma acumulación en centavos que las demás filas: no es un segundo
    // `reduce` y, por construcción, no puede separarse del número con el que
    // cierra la planilla (US8 escenario 6).
    //
    // Sin rango es **el mismo número que el `saldo` del listado y el de la
    // ficha** (FR-101): las dos cuentas suman lo mismo en centavos enteros. Con
    // `hasta` es el saldo **a esa fecha**, que es lo que significa cortar un
    // período: un archivo que cerrara en el saldo de hoy sobre filas que llegan
    // hasta julio no cuadraría con sus propias filas.
    const saldoFinal = conSaldo.length ? conSaldo[conSaldo.length - 1].saldo : saldoInicial;

    res.json({
      ok: true,
      total,
      proveedor: { name: supplier.name, cuit: supplier.cuit || '' },
      // El período puede arrancar con un saldo anterior, y la planilla tiene que
      // decirlo: sin este número, la primera fila del archivo parece el
      // principio de la cuenta y no lo es. Es el mismo campo que ya devuelve
      // `GET /:id/movimientos` (`:523`).
      saldo_inicial: saldoInicial,
      saldo_final: saldoFinal,
      data: conSaldo.map((m) => filaDeCuentaParaExport(m, m.saldo, supplier)),
    });
  } catch (err) {
    if (respondioConCodigo(res, err)) return;
    fallo(req, res, err, 'Error al preparar la exportación de la cuenta del proveedor');
  }
});

/**
 * El indice unico `(empresa_id, name)` traducido a una frase (T1246).
 *
 * `models/Supplier.js:44` no deja repetir el nombre de un proveedor dentro de
 * una empresa, y eso esta bien: dos «Distribuidora Norte» en la misma lista son
 * dos cuentas corrientes que nadie sabe cual es cual. Lo que estaba mal era lo
 * que se veia al chocar con el.
 *
 * `fallo()` ya impedia que el error crudo llegara al cliente —`err.message` de
 * un SequelizeUniqueConstraintError trae el nombre del indice y de la columna—,
 * pero lo tapaba con «Error al crear el proveedor», que es un 500 generico: no
 * dice que el problema es el nombre, no dice que hacer, y manda a mirar los
 * logs por una condicion prevista que el usuario puede corregir solo.
 *
 * Devuelve **el mismo error** si no es una violacion de unicidad, para que el
 * catch quede en una sola linea y ningun otro fallo se traduzca por accidente a
 * «ese nombre ya existe».
 *
 * @param {Error} err
 * @param {string} [nombre] El que venia en el cuerpo, si vino.
 * @returns {Error} Un ErrorDeNegocio 409, o `err` tal cual.
 */
function conNombreRepetido(err, nombre) {
  // El nombre del error lo pone Sequelize; el 23505 es el codigo de Postgres,
  // y va como respaldo porque el envoltorio depende del dialecto y de la
  // version, y quedarse solo con el nombre es como esta clase de traduccion
  // deja de funcionar en silencio despues de un upgrade.
  const esRepetido = err
    && (err.name === 'SequelizeUniqueConstraintError'
      || (err.parent && err.parent.code === '23505')
      || (err.original && err.original.code === '23505'));

  if (!esRepetido) return err;

  const escrito = typeof nombre === 'string' && nombre.trim() !== '' ? nombre.trim() : null;

  return new ErrorDeNegocio(
    escrito
      ? `Ya existe un proveedor llamado «${escrito}». Abrí el que ya está o usá otro nombre.`
      : 'Ya existe otro proveedor con ese nombre. Usá uno distinto.',
    409
  );
}

// POST /api/suppliers — Crear proveedor
router.post('/', checkPermission('proveedores.crear'), async (req, res) => {
  try {
    const supplier = await Supplier.create({
      ...soloCampos(req.body, CAMPOS_DE_PROVEEDOR),
      empresa_id: req.empresaId,
    });
    res.status(201).json({ ok: true, data: supplier });
  } catch (err) {
    fallo(req, res, conNombreRepetido(err, req.body && req.body.name), 'Error al crear el proveedor');
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
    fallo(req, res, conNombreRepetido(err, req.body && req.body.name), 'Error al actualizar el proveedor');
  }
});

/**
 * Un importe como lo escribe una persona en Argentina: `$64.000,00`.
 *
 * Los dos extremos de decimales van fijos. Sin el máximo, el valor por defecto
 * es 3 y `1234.567` sale «1.234,567»; sin el mínimo, `1234` sale «1.234» y la
 * misma columna termina con tres formatos distintos.
 */
function enPesos(n) {
  return `$${(Number(n) || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// DELETE /api/suppliers/:id — Eliminar proveedor
//
// ⚠⚠ **Las tres líneas de `destroy` NO se reformatean.** Están en la lista de
// excepciones de `observabilidad.test.js:186-190` como **match exacto sobre la
// línea recortada**: un cambio de espaciado rompe la exención y aparece como un
// hallazgo de aislamiento que no lo es. El chequeo del saldo va ANTES de ellas.
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

    // ── Con saldo distinto de cero, no se borra ──
    //
    // Hasta este corte el DELETE se llevaba la cuenta entera —órdenes,
    // movimientos y documentos— con una confirmación genérica. **Es borrar el
    // respaldo de una deuda**: después de eso no hay forma de saber cuánto se le
    // debía a ese proveedor ni por qué.
    //
    // El saldo sale de `resumenDeCuenta`, la misma función que el listado y la
    // ficha: si acá se escribiera una segunda suma, el día que difieran en un
    // centavo el borrado se bloquearía sobre un número que la pantalla no
    // muestra.
    const movimientos = await SupplierMovement.findAll({
      attributes: ['type', [fn('SUM', col('amount')), 'total']],
      where: { empresa_id: req.empresaId, supplier_id: supplier.id },
      group: ['type'],
      transaction: t,
      raw: true,
    });

    const { saldo } = resumenDeCuenta(movimientos);

    if (saldo !== 0) {
      // El número va adentro del mensaje: «no se puede» sin decir cuánto obliga
      // a ir a buscarlo a otra pantalla.
      throw new ErrorDeNegocio(
        `${supplier.name} tiene un saldo de ${enPesos(saldo)}. `
        + 'Saldá la cuenta antes de eliminarlo.',
        400
      );
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

/**
 * Un importe de plata, validado antes de que llegue a la base (FR-088).
 *
 * **Qué pasaba hasta este corte**: `Orders.jsx:125` mandaba
 * `parseFloat(payData.amount)` sin mirar nada, así que un formulario vacío
 * escribía **NaN en una columna DECIMAL(14,2)**. Nada fallaba: la fila entraba,
 * y a partir de ahí el saldo del proveedor, el badge de la lista, el saldo
 * grande de la cuenta y el archivo del contador decían todos «NaN».
 *
 * ── Y por qué la usa también la EDICIÓN de un movimiento ──
 *
 * `PUT /movements/:id` escribía `amount` sin mirarlo: un `-50000` sobre un pago
 * respondía **200 ok:true** y le sumaba $50.000 al saldo del proveedor, y un
 * `0` dejaba una fila que no dice nada. Es el único camino que **escribe un
 * número falso y lo deja escrito**: no revierte, no avisa, y el saldo corrupto
 * se propaga al listado, al badge, al bloqueo del borrado y al archivo del
 * contador, porque los cuatro salen de `resumenDeCuenta`. La regla ya estaba
 * escrita acá y aplicada en el endpoint hermano; lo único que faltaba era
 * llamarla desde el otro.
 *
 * ⚠ **Un importe mayor que el saldo SÍ se acepta** (FR-089): pagar por
 * adelantado es legítimo y deja el saldo negativo, que es la forma correcta de
 * decir «el proveedor me debe a mí» (US6 escenario 6). La confirmación con los
 * dos números es de la pantalla (T1244), no de acá. Bloquearlo sería «arreglar»
 * esto rompiendo un caso real.
 *
 * La validación va en los **dos** lados —navegador y servidor— porque el
 * requisito lo dice y porque el navegador no es una barrera.
 *
 * @param {number|string|null|undefined} valor
 * @param {string} [queEs] Cómo se nombra el importe en el mensaje: «del pago»,
 *   «del movimiento». El texto lo lee una persona, así que no puede decir
 *   «pago» cuando lo que está corrigiendo es una deuda.
 * @throws {ErrorDeNegocio} 400 con el mensaje que lee el usuario.
 */
function importePositivo(valor, queEs = 'del pago') {
  // `Number('')` es 0 y `Number(null)` también: los dos tienen que quedar
  // afuera por el `<= 0`, no por el `isFinite`.
  const monto = Number(valor);

  if (!Number.isFinite(monto) || monto <= 0) {
    throw new ErrorDeNegocio(`El monto ${queEs} tiene que ser un número mayor que cero`, 400);
  }

  return monto;
}

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

    // El importe se valida DESPUÉS del findScoped y no antes: ese findScoped es
    // lo que hace que `analizarCreates` dé por validado el create de abajo, y
    // moverlo —o interponerle un return— es la clase de reordenamiento que pone
    // una guardia en rojo sin que se entienda por qué.
    const { date, amount, payment_method, notes } = req.body;
    const monto = importePositivo(amount, 'del pago');

    const movement = await SupplierMovement.create({
      supplier_id: supplier.id,
      empresa_id: req.empresaId,
      type: 'pago',
      date,
      amount: monto,
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
    const cambios = soloCampos(req.body, CAMPOS_DE_MOVIMIENTO);

    // ── El importe, validado antes de escribirlo (FR-088) ──
    //
    // Entre el findScoped y este update no había NADA, y `SupplierMovement.amount`
    // es DECIMAL(14,2) sin `validate`: un `{amount: -50000}` respondía 200 y
    // dejaba el saldo del proveedor escrito mal, para siempre y en silencio.
    //
    // Se valida **solo si vino**: la edición es parcial —corregir la nota de un
    // movimiento no puede obligar a remandar el importe— y `soloCampos` ya dejó
    // afuera lo que no llegó.
    //
    // Y va DESPUÉS del findScoped por el mismo motivo que en el pago: un 400
    // delante del 404 confirmaría que ese movimiento existe en otra empresa.
    if (cambios.amount !== undefined) {
      cambios.amount = importePositivo(cambios.amount, 'del movimiento');
    }

    await movement.update(cambios);
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
