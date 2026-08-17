// ════════════════════════════════════════════
//  FAVALIO · Rutas: Stock, Marcas, Gastos, Settings
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Stock, Brand, Product, FixedExpense, Setting, Supplier, PuntoDeVenta } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { fallo } = require('../utils/errores');
const { sumaEnCentavos } = require('../utils/centavos');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');
const { UMBRAL_POR_DEFECTO, limiteDeStockBajo, esStockBajo } = require('../utils/stockBajo');
const { esSecreto, sinSecretos, esDeSoloLectura } = require('../utils/settingsSecretos');
// `aCantidad` y no `Number(x) || 0` inline: con las columnas de cantidad en
// DECIMAL el driver las entrega como texto, y acá hay dos sumas envueltas en un
// `Math.max` que **parecen** coercionadas y no lo están.
const { aCantidad } = require('../utils/cantidades');

// Los dos mensajes de stock negativo viven acá porque los usan las DOS puertas
// —`PUT /stock/:id` y `POST /stock`— y tienen que decir exactamente lo mismo.
// Antes solo validaba el PUT: la misma pantalla, con el mismo campo, aceptaba
// o rechazaba un -5 según si la fila ya existía. Es el defecto 4.
const STOCK_NEGATIVO = 'El stock no puede ser negativo';
const DISPONIBLE_NEGATIVO = 'El disponible no puede ser negativo';

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
      return res.status(400).json({ ok: false, error: STOCK_NEGATIVO });
    }
    if (available !== undefined && available < 0) {
      return res.status(400).json({ ok: false, error: DISPONIBLE_NEGATIVO });
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
    // `location` NO está en la lista blanca, y es a propósito: ahora es el
    // espejo del punto de venta y lo escribe el servidor (FR-041). Antes,
    // cambiarlo por acá movía la fila de sucursal sin dejar ningún registro
    // —ni movimiento, ni transferencia, ni nada—. Mover mercadería es
    // `POST /api/stock/transfer`, que es transaccional y deja constancia.
    if (req.body.current_batch !== undefined) cambios.current_batch = req.body.current_batch;
    if (req.body.expiration_date !== undefined) cambios.expiration_date = req.body.expiration_date;
    if (req.body.purchase_date !== undefined) cambios.purchase_date = req.body.purchase_date;

    // quantity y available describen el mismo inventario: available es lo que
    // se puede vender, quantity lo que hay fisicamente. Mover una sin la otra
    // las hace divergir hasta que available supera a quantity.
    //
    // ⚠ El `Math.max` de acá abajo es el peor de los cinco sitios de la 016 y
    // el que más fácil pasa una revisión: **convierte DESPUÉS de que el `+` ya
    // concatenó**. `Math.max(0, "100" + 5)` es 1005, no 105, y no lanza nada:
    // devuelve un número perfectamente creíble. Con `oldAvail` llegando como
    // «100.0000» desde la base, editar el stock a 105 dejaba el disponible en
    // mil y pico.
    //
    // El `Math.max(0, …)` **se conserva**: esta funcionalidad no cambia el
    // trato del disponible negativo, solo hace que la suma de adentro sea una
    // suma.
    if (cambios.quantity !== undefined && cambios.available === undefined) {
      const delta = aCantidad(cambios.quantity) - aCantidad(oldQty);
      cambios.available = Math.max(0, aCantidad(oldAvail) + delta);
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
    const { product_id, quantity, available, min_stock, punto_de_venta_id } = req.body;
    const empresaId = req.empresaId;
    if (!product_id) return res.status(400).json({ ok: false, error: 'product_id es requerido' });

    // Las dos validaciones van ANTES de tocar la base y valen para el alta y
    // para la actualización por igual. Hasta acá solo validaba el `PUT`: cargar
    // -5 sobre un producto que **ya** tenía stock en esa sucursal daba 400, y
    // sobre uno que no lo tenía creaba una fila en -5 sin decir nada.
    if (quantity !== undefined && quantity < 0) {
      return res.status(400).json({ ok: false, error: STOCK_NEGATIVO });
    }
    if (available !== undefined && available < 0) {
      return res.status(400).json({ ok: false, error: DISPONIBLE_NEGATIVO });
    }

    // Cuerpo → cabecera → por defecto de la empresa, siempre por la misma
    // función (FR-049). El `location` del cuerpo **se ignora**: era la forma de
    // crear una fila con un texto que no corresponde a ninguna sucursal, que la
    // pantalla —que lee por `punto_de_venta_id`— no muestra nunca. Así nacía
    // «una pila anotada dos veces».
    const sucursal = await resolverSucursal({
      empresaId,
      puntoDeVentaId: punto_de_venta_id || req.puntoDeVentaId,
    });

    // El producto se resuelve acotado a la empresa ANTES de escribir la fila.
    // Sin esto, `product_id` viajaba del cuerpo al `findOrCreate` sin que nadie
    // mirara de quién es: la fila salía con el `empresa_id` de quien la mandó
    // —así que revisando la tabla no se ve nada raro— pero colgada del producto
    // de otro cliente. Es la misma forma del defecto 1 de la funcionalidad 012,
    // y la consecuencia ya estaba escrita en `aislamientoDeProveedores.test.js`:
    // «el Stock.create crea una fila de stock propia para un producto ajeno».
    //
    // Apareció al ensanchar `analizarCreates` en el hito 013: la guardia exigía
    // dos puntos para leer las claves del objeto y este `where` usa la forma
    // corta de ES6, así que el create no se miraba nunca.
    const producto = await findScoped(Product, product_id, empresaId);
    if (!producto) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    const ubicacion = ubicacionDeStock(sucursal);

    const [stock, created] = await Stock.findOrCreate({
      where: { product_id: producto.id, punto_de_venta_id: ubicacion.punto_de_venta_id, empresa_id: empresaId },
      defaults: {
        quantity: quantity ?? 0,
        // `available` se manda siempre, aunque el cliente no lo mande: la
        // columna es NOT NULL con default 0, y una fila creada con cantidad 10
        // y disponible 0 es mercadería que existe y no se puede vender.
        available: available ?? quantity ?? 0,
        min_stock: min_stock ?? 0,
        ...ubicacion,
        empresa_id: empresaId,
      },
    });

    if (!created) {
      // Si solo viene quantity, available se mueve el mismo delta: son dos
      // vistas del mismo inventario y actualizar una sola las desincroniza.
      //
      // El mismo `Math.max` que engaña arriba, en la otra puerta: los dos
      // operandos de adentro salen de la base y con la columna en DECIMAL
      // llegan como texto. `aCantidad` en los tres es lo que hace que la suma
      // sume; el `Math.max(0, …)` queda como estaba.
      const nuevaQty = quantity ?? stock.quantity;
      const nuevaDisp = available ?? (
        quantity !== undefined
          ? Math.max(0, aCantidad(stock.available) + (aCantidad(quantity) - aCantidad(stock.quantity)))
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
    const { items, punto_de_venta_id } = req.body;
    const empresaId = req.empresaId;
    if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'Formato inválido' });

    // El `location` del cuerpo se sigue **aceptando y se ignora**, por
    // compatibilidad con quien todavía lo mande. La rama que buscaba la fila
    // por ese texto era la que escribía en una sucursal que no existe: la fila
    // quedaba con `punto_de_venta_id` en null y la pantalla no la mostraba
    // nunca.
    const sucursal = await resolverSucursal({
      empresaId,
      puntoDeVentaId: punto_de_venta_id || req.puntoDeVentaId,
    });

    const ubicacion = ubicacionDeStock(sucursal);

    // ── Los productos son de esta empresa, o no se escribe nada ──
    //
    // Sin esto, `Stock.findOrCreate` con el `product_id` que vino en el cuerpo
    // CREA una fila de stock —con el `empresa_id` de quien pide, asi que a
    // primera vista no se escapa nada— colgada de un producto de OTRO cliente.
    // Es la misma forma del defecto que ya aparecio en los pagos a proveedores:
    // un `create` bajo un padre que nadie valido.
    //
    // La guardia estatica NO lo ve, y por eso esta escrito aca: `analizarCreates`
    // reconoce `product_id: req.body.algo`, pero este id sale de un elemento del
    // arreglo (`item.product_id`), que es una indireccion mas. El hermano de
    // arriba —POST /api/stock, con un solo producto— si lo detecta.
    //
    // Se valida TODO junto y antes del bucle, no producto por producto adentro:
    // una carga masiva que escribe la mitad de las filas y falla en la otra
    // mitad deja un inventario que nadie puede explicar.
    const idsPedidos = [...new Set(
      items.map((item) => parseInt(item.product_id, 10)).filter(Number.isInteger)
    )];

    if (idsPedidos.length) {
      const propios = await Product.findAll({
        where: { id: { [Op.in]: idsPedidos }, empresa_id: empresaId },
        attributes: ['id'],
      });

      if (propios.length !== idsPedidos.length) {
        const conocidos = new Set(propios.map((p) => p.id));
        const ajenos = idsPedidos.filter((id) => !conocidos.has(id));

        // 404 y no 403: un 403 confirmaria que esos productos existen en otra
        // empresa. El mensaje nombra los ids que el cliente mando, que ya son
        // suyos, y ningun dato del producto ajeno.
        return res.status(404).json({
          ok: false,
          error: `No se encontraron ${ajenos.length} de los productos: ${ajenos.join(', ')}.`,
        });
      }
    }

    let updated = 0;
    for (const item of items) {
      const [stock, created] = await Stock.findOrCreate({
        where: {
          product_id: item.product_id,
          punto_de_venta_id: ubicacion.punto_de_venta_id,
          empresa_id: empresaId,
        },
        defaults: {
          quantity: item.quantity,
          available: item.quantity,
          ...ubicacion,
          empresa_id: empresaId,
        },
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

// ════════════════════════════════════════════
//  Los gastos fijos, y las tres cosas que cambiaron acá
//
//  1. **Los totales los calcula el servidor** (FR-026 a FR-028). `amount` es
//     DECIMAL(12,2) y el driver lo devuelve como STRING: sumarlo en el
//     navegador con `parseFloat` acumulado deja residuo —0,1 + 0,2 da
//     0,30000000000000004— en el número del que cuelga el punto de equilibrio.
//     Se suma en centavos enteros, con `sumaEnCentavos`, y **de la misma
//     lectura** que las filas: el total general y el de cada grupo salen del
//     mismo `findAll`, así que no pueden no cerrar.
//
//  2. **`group` deja de significar algo.** Es el resto de la migración del
//     legacy (`scripts/migrar-legacy.js:379` escribe 'gf1' y 'gf2'). El
//     agrupado sale de `punto_de_venta_id` y nadie lee la columna; el cuerpo
//     del request tampoco la puede escribir (FR-031). El filtro `?group=`
//     deja de aceptarse.
//
//  3. **`punto_de_venta_id` del cuerpo se valida contra la empresa** antes de
//     escribir (FR-029). Sin eso, un gasto queda colgado de la sucursal de
//     otra empresa cliente: la fila lleva el `empresa_id` correcto, así que no
//     parece una fuga, y aparece en cualquier pantalla que una por la clave
//     foránea.
// ════════════════════════════════════════════

/**
 * El `punto_de_venta_id` que el cliente mandó, ya validado contra su empresa.
 *
 * ⚠ **No se usa `resolverSucursal` de `utils/sucursalDeStock.js` aunque valide
 * exactamente esto**: esa función NUNCA devuelve null —cae a la sucursal por
 * defecto— y acá un gasto sin sucursal es un caso legítimo, el que se dibuja
 * en «General» (FR-022). Con `resolverSucursal`, elegir «General» pasaría a
 * guardar la sucursal por defecto y el bucket quedaría vacío para siempre.
 *
 * @returns {Promise<{ ok: true, id: number|null } | { ok: false }>}
 *   `ok:false` cuando el id es de otra empresa. La ruta responde **404 y no
 *   403**: un recurso ajeno no existe, y un 403 confirmaría que existe.
 */
async function sucursalDelCuerpo(valor, empresaId) {
  if (valor === undefined || valor === null || valor === '') return { ok: true, id: null };

  const sucursal = await findScoped(PuntoDeVenta, valor, empresaId);
  if (!sucursal) return { ok: false };

  return { ok: true, id: sucursal.id };
}

/**
 * El valor de la columna muerta `group`, que el servidor escribe SIEMPRE.
 *
 * ⚠ **`data-model.md` dice que sin `defaultValue` en el modelo un `create` sin
 * `group` «usa el DEFAULT de la base y no falla». Eso NO es cierto**, y se
 * verificó ejecutándolo: la columna es `allowNull: false` en el modelo, así que
 * Sequelize valida ANTES de armar el INSERT y tira
 * `notNull Violation: FixedExpense.group cannot be null`. El `DEFAULT 'gf1'`
 * de Postgres nunca llega a intervenir, porque la sentencia no se emite.
 *
 * O sea que sacarle el `defaultValue` al modelo —sin esto— convertiría el
 * primer alta de gasto fijo después del deploy en un 500. Por eso el servidor
 * escribe la columna en los dos casos: `'pv_<id>'` cuando hay sucursal y
 * `'general'` cuando no. Nadie la lee; lo único que se le pide es no ser nula.
 */
function grupoDe(puntoDeVentaId) {
  return puntoDeVentaId ? `pv_${puntoDeVentaId}` : 'general';
}

// GET /api/expenses
router.get('/expenses', checkPermission('gastos.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;
    // empresa_id es NOT NULL en las 22 tablas del schema: aceptar tambien
    // empresa_id IS NULL era codigo muerto, y se volveria una fuga el dia que
    // alguien haga la columna nullable.
    const where = { empresa_id: empresaId };
    if (req.query.punto_de_venta_id) where.punto_de_venta_id = req.query.punto_de_venta_id;

    const expenses = await FixedExpense.findAll({ where, order: [['id', 'ASC']] });

    // Un solo recorrido sobre LAS MISMAS filas que se devuelven. Un endpoint
    // aparte —o un SUM con GROUP BY— serían dos lecturas, y dos lecturas es
    // que las tarjetas y las filas se puedan dibujar con datos de momentos
    // distintos.
    const sinSucursal = [];
    const porGrupo = new Map();

    for (const gasto of expenses) {
      if (gasto.punto_de_venta_id === null || gasto.punto_de_venta_id === undefined) {
        sinSucursal.push(gasto.amount);
        continue;
      }

      const clave = String(gasto.punto_de_venta_id);
      if (!porGrupo.has(clave)) porGrupo.set(clave, []);
      porGrupo.get(clave).push(gasto.amount);
    }

    // ⚠ Los totales viajan como NÚMERO y no como el string del ejemplo de
    // `contracts/api-endpoints.md`. El motivo es que un `.toFixed(2)` redondea
    // el residuo del punto flotante justo antes de escribirlo, así que sumar en
    // centavos y sumar con `parseFloat` acumulado darían el mismo texto: la
    // corrección se podría sacar entera sin que ningún test se ponga en rojo.
    // Es la misma forma que ya devuelven `GET /api/suppliers` y
    // `GET /api/gastos-variables`, y `deCentavos` garantiza los dos decimales.
    const porSucursal = {};
    for (const [clave, importes] of porGrupo) porSucursal[clave] = sumaEnCentavos(importes);

    res.json({
      ok: true,
      data: expenses,
      totales: {
        // `general` es la suma de TODO, incluido lo que no tiene sucursal: la
        // tarjeta de «General» existe (FR-023) y la suma de las tarjetas tiene
        // que ser el total.
        general: sumaEnCentavos(expenses.map((g) => g.amount)),
        sin_sucursal: sumaEnCentavos(sinSucursal),
        por_sucursal: porSucursal,
      },
      // Siempre la empresa entera. `req.puntoDeVentaId` NO se aplica como
      // caída —a diferencia de `/faltantes`— porque el agrupado por sucursal es
      // la razón de ser de esta pantalla: recortar por la sucursal activa
      // dejaría los otros grupos vacíos sin decir por qué. FR-037 pide que
      // quede escrito cuál de las dos es, y la pantalla lo muestra.
      alcance: 'empresa',
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los gastos fijos');
  }
});

// POST /api/expenses
router.post('/expenses', checkPermission('gastos.crear'), async (req, res) => {
  try {
    // Campos explícitos, no `{ ...req.body }`. Con el spread, `group`,
    // `empresa_id` e `id` viajaban desde el cuerpo: el primero volvía a
    // escribir la columna muerta del legacy y los otros dos podían cambiarle
    // el dueño a la fila (FR-030, FR-031, FR-032).
    const { name, amount, punto_de_venta_id } = req.body;

    const sucursal = await sucursalDelCuerpo(punto_de_venta_id, req.empresaId);
    if (!sucursal.ok) return res.status(404).json({ ok: false, error: 'Punto de venta no encontrado' });

    const datos = {
      empresa_id: req.empresaId,
      name,
      amount,
      punto_de_venta_id: sucursal.id,
      // El servidor la escribe SIEMPRE, con o sin sucursal. Ver `grupoDe`.
      group: grupoDe(sucursal.id),
    };

    const expense = await FixedExpense.create(datos);
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

    // La misma lista blanca que el POST. Antes era `const { empresa_id, id,
    // ...cambios } = req.body`, que saca dos claves y deja pasar todas las
    // demás: `group` y `punto_de_venta_id` entraban crudos.
    const cambios = {};

    if (req.body.name !== undefined) cambios.name = req.body.name;
    if (req.body.amount !== undefined) cambios.amount = req.body.amount;

    if (req.body.punto_de_venta_id !== undefined) {
      const sucursal = await sucursalDelCuerpo(req.body.punto_de_venta_id, req.empresaId);
      if (!sucursal.ok) return res.status(404).json({ ok: false, error: 'Punto de venta no encontrado' });

      cambios.punto_de_venta_id = sucursal.id;
      // La columna muerta se mantiene coherente con la fila: si quedara el
      // `pv_3` viejo en un gasto que pasó a «General», el resto del legacy
      // diría lo contrario que el dato que sí se lee.
      cambios.group = grupoDe(sucursal.id);
    }

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

    // Campo DERIVADO y de solo lectura. Va DESPUES del bucle a proposito: asi
    // una fila guardada con esa clave —por `PUT /settings/:key`, que acepta
    // cualquiera— no lo puede pisar. Hacerlo configurable esta Fuera de
    // alcance, y un valor que se puede escribir pero no tiene efecto es peor
    // que uno que no se puede escribir.
    //
    // Existe para que la pantalla no repita el literal 3: FR-017 pide que
    // Inventario y Faltantes digan el mismo numero, y dos constantes iguales en
    // dos repositorios empiezan iguales y terminan distintas.
    obj.umbral_stock_bajo = UMBRAL_POR_DEFECTO;

    // La clave privada de AFIP, su certificado y el token de TiendaNube NO
    // salen de aca. Salian: este endpoint devolvia la tabla entera y la
    // pantalla los metia en el store del navegador. Ver utils/settingsSecretos.
    res.json({ ok: true, data: sinSecretos(obj) });
  } catch (err) {
    fallo(req, res, err, 'Error al leer la configuración');
  }
});

// GET /api/settings/:key — Una configuración específica
router.get('/settings/:key', checkPermission('config.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;

    // La otra puerta por la que salia la clave privada de AFIP. Cerrar solo
    // `GET /settings` habria dejado esta abierta, que ademas es mas comoda:
    // `GET /api/settings/afip_key` devolvia la clave sola, sin nada alrededor.
    //
    // Se contesta con la bandera y no con un 404: que la clave EXISTE no es el
    // secreto —la pantalla necesita saberlo para decir «certificado cargado»—,
    // el secreto es su contenido.
    if (esSecreto(req.params.key)) {
      const guardado = await Setting.findOne({
        where: { key: req.params.key, empresa_id: empresaId },
      });

      return res.json({
        ok: true,
        data: null,
        cargado: Boolean(guardado && guardado.value),
        error: 'Esa configuración no se puede leer por la API.',
      });
    }

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
    // El material fiscal NO se escribe por acá, y no es simetría con el GET.
    //
    // `POST /api/afip/setup` hace tres cosas que este endpoint genérico no hace:
    // valida que el certificado y la clave sean lo que dicen ser, comprueba que
    // se correspondan entre sí, e **invalida el ticket WSAA en curso**. Sin lo
    // último, AFIP sigue firmando con el ticket viejo hasta que vence y el
    // certificado nuevo no tiene efecto — con la pantalla diciendo que se guardó.
    //
    // O sea: por acá se podía dejar la facturación electrónica rota de una forma
    // que no falla en el momento y se descubre cuando hay que emitir.
    if (esSecreto(req.params.key)) {
      return res.status(400).json({
        ok: false,
        error: 'El certificado y la clave de AFIP se cargan desde Ajustes → Facturación, que los valida.',
      });
    }

    // La otra mitad del mismo agujero, y la que muerde más.
    //
    // Bloquear los secretos dejó `PUT /api/settings/afip_environment` con
    // `"production"` funcionando: por acá se pasaba una empresa a producción
    // —comprobantes fiscales reales, numeración correlativa consumida— sin pasar
    // por ninguna validación y **sin invalidar el ticket WSAA cacheado**, que se
    // había emitido contra homologación. Lo mismo `afip_pv`: un punto de venta
    // que ARCA no tiene declarado no falla acá, falla al emitir.
    //
    // No son secretas —la pantalla las lee para dibujarse— así que no van en
    // `SETTINGS_SECRETOS`: van en su propia lista. Ver `utils/settingsSecretos`.
    if (esDeSoloLectura(req.params.key)) {
      return res.status(400).json({
        ok: false,
        error: 'El ambiente y el punto de venta se cambian desde Ajustes → Facturación, '
          + 'que valida el punto de venta contra AFIP y renueva el ticket de acceso.',
      });
    }

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

// GET /api/faltantes — Que hay que reponer, listo para armar el pedido
//
// El sistema anterior tenia esta pantalla y era la rutina semanal: mirar que
// falta, poner cantidades, mandarlo por WhatsApp al proveedor. Favalio tenia
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
    // anterior, y ahora sale de `utils/stockBajo` en vez de estar escrito acá:
    // era el mismo numero repetido en el servidor y en la pantalla, y dos
    // constantes iguales en dos lugares empiezan iguales y terminan distintas
    // (FR-017).
    const umbral = Number.isFinite(Number(req.query.umbral))
      ? Number(req.query.umbral)
      : UMBRAL_POR_DEFECTO;

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

      // La regla —el minimo cargado manda; el umbral es solo para los que no
      // tienen— vive en `utils/stockBajo` y no acá. Es un refactor, no un
      // cambio de regla: si el numero de productos que devuelve esta ruta se
      // mueve, la funcion quedo distinta del literal que reemplaza.
      const limite = limiteDeStockBajo(fila, umbral);
      if (!esStockBajo(fila, umbral)) continue;

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
