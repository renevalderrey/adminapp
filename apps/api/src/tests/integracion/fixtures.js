// ════════════════════════════════════════════
//  Dos empresas con datos: la fixture mínima del proyecto 5c
//
//  Es la pieza que permite escribir «esto es de la empresa A y la B no lo ve»
//  **ejecutándolo**, en vez de verificarlo con una guardia que lee el código
//  fuente.
//
//  ── Por qué la empresa A tiene que ser la id 1 ──
//
//  `server.js` arma la cadena de autenticación de otra manera cuando
//  `BYPASS_AUTH=true`: en vez de resolver la empresa desde el token, clava
//  `req.empresaId = 1` y busca el usuario `test-user-id`. O sea que **la sesión
//  de estos tests es siempre la empresa 1**, y no hay cabecera que la mueva.
//
//  Eso no limita nada: la pregunta que importa es «con la sesión de A, ¿puedo
//  tocar algo de B?», y para hacerla alcanza con que A sea la empresa de la
//  sesión. Lo que sí exige es que la empresa A se cree primero y sobre las
//  secuencias reiniciadas — de ahí el `RESTART IDENTITY` de `limpiarLaBase()`.
//  Si algún día eso se rompe, la aserción de `sembrarDosEmpresas` lo dice con
//  todas las letras en vez de dejar 40 tests fallando por motivos raros.
//
//  ── Las fixtures están elegidas para poder distinguir defectos ──
//
//  Varios defectos de este proyecto sobrevivieron porque los datos de prueba no
//  podían distinguirlos. Acá, a propósito:
//
//  - **Los importes tienen centavos que no cierran solos.** 1234,56 + 0,10 +
//    0,20 da 1234,8600000000001 en punto flotante. Un saldo que tiene que dar
//    exactamente cero solo prueba algo si las partes no son enteras.
//  - **Las dos empresas tienen un proveedor con el MISMO nombre.** Un `GROUP BY`
//    al que se le escape el `empresa_id` devuelve números distintos, y con
//    nombres distintos el error se leería como «apareció uno de más» en vez de
//    «los importes están mal».
//  - **Hay cuatro proveedores en A**, no uno: una lista de una sola página no
//    puede mostrar que la paginación ordena estable ni que el total es el de la
//    búsqueda y no el de la página.
//  - **Hay acentos y una eñe en los nombres.** La búsqueda sin acentos se
//    resuelve con `translate()` en SQL: contra un doble no se ejecuta nunca.
//  - **Hay una orden anulada con importe grande.** Sin ella, «pendiente de
//    recibir» daría el mismo número filtrando por estado y sin filtrar.
//  - **La sucursal designada de TiendaNube NO es la que elegiría
//    `sucursalPorDefecto`.** Si lo fuera, «se descontó de la designada» y «se
//    cayó al escalón por defecto» darían el mismo número, que es exactamente el
//    defecto que la sucursal designada viene a cerrar. Hay una guarda que lo
//    verifica y tira con el motivo escrito.
//  - **`available` es distinto de `quantity` en la sucursal designada.** Los
//    ocho caminos que escriben stock los mueven juntos, así que en cualquier
//    otro dato publicar uno u otro da el mismo número.
// ════════════════════════════════════════════

const { modelos } = require('./baseDePruebas');
const { elegirPorDefecto } = require('../../utils/sucursalDeStock');

const {
  Empresa,
  PuntoDeVenta,
  Usuario,
  UsuarioEmpresa,
  Product,
  Stock,
  Supplier,
  SupplierMovement,
  SupplierDocument,
  SupplierOrder,
  Sale,
  SaleItem,
  TiendanubeTienda,
  TiendanubeMapping,
  TiendanubeVariante,
} = modelos;

/** El `auth0_sub` que busca el bypass de `server.js`. */
const USUARIO_DE_LA_SESION = 'test-user-id';

/**
 * Siembra las dos empresas y devuelve todo lo que los tests necesitan nombrar.
 *
 * Se llama después de `limpiarLaBase()`, en un `beforeEach`.
 */
async function sembrarDosEmpresas() {
  // ── Empresa A: la de la sesión ──
  const empresaA = await Empresa.create({
    name: 'Panadería del Centro',
    cuit: '30111111118',
    timezone: 'America/Argentina/Buenos_Aires',
  });

  if (empresaA.id !== 1) {
    throw new Error(
      `La empresa A quedó con id ${empresaA.id} y tiene que ser la 1: el bypass de ` +
      'autenticación de server.js clava req.empresaId = 1. ¿Se truncó la base sin ' +
      'RESTART IDENTITY?'
    );
  }

  const empresaB = await Empresa.create({
    name: 'Kiosco de la Esquina',
    cuit: '30222222227',
    timezone: 'America/Argentina/Buenos_Aires',
  });

  // ── Sucursales ──
  // A tiene dos: sin una segunda sucursal no se puede distinguir «se descontó
  // del depósito correcto» de «se descontó del único que había».
  const centroA = await PuntoDeVenta.create({ empresa_id: empresaA.id, name: 'Centro', code: 'centro' });
  const norteA = await PuntoDeVenta.create({ empresa_id: empresaA.id, name: 'Sucursal Norte', code: 'norte' });
  const localB = await PuntoDeVenta.create({ empresa_id: empresaB.id, name: 'Kiosco', code: 'kiosco' });

  // ── Usuarios ──
  const usuarioA = await Usuario.create({
    auth0_sub: USUARIO_DE_LA_SESION,
    email: 'dev@favalio.com',
    nombre: 'Usuario de pruebas',
  });

  await UsuarioEmpresa.create({
    usuario_id: usuarioA.id,
    empresa_id: empresaA.id,
    role: 'admin',
    is_default: true,
    is_active: true,
  });

  const usuarioB = await Usuario.create({
    auth0_sub: 'auth0|duenio-del-kiosco',
    email: 'duenio@kiosco.example',
    nombre: 'Dueño del kiosco',
  });

  await UsuarioEmpresa.create({
    usuario_id: usuarioB.id,
    empresa_id: empresaB.id,
    role: 'admin',
    is_default: true,
    is_active: true,
  });

  // ── Productos y stock ──
  const harina = await Product.create({
    empresa_id: empresaA.id,
    name: 'Harina 000',
    sku: 'HAR-000',
    cost: 1234.56,
    price_override: 1500.00,
    unit_type: 'kg',
  });

  const levadura = await Product.create({
    empresa_id: empresaA.id,
    name: 'Levadura fresca',
    sku: 'LEV-001',
    cost: 33.33,
    price_override: 33.33,
    unit_type: 'unidad',
  });

  await Stock.create({
    empresa_id: empresaA.id, product_id: harina.id, punto_de_venta_id: centroA.id,
    location: 'centro', quantity: 20, available: 20,
  });
  // ⚠ `available` distinto de `quantity`, y **en la sucursal designada de
  // TiendaNube**. Es lo que hace distinguible «se publica lo disponible» de «se
  // publica la cantidad»: con los dos numeros iguales —que es como quedan los
  // ocho caminos que escriben stock— publicar uno u otro da el mismo resultado y
  // el test pasa con y sin la decision.
  await Stock.create({
    empresa_id: empresaA.id, product_id: harina.id, punto_de_venta_id: norteA.id,
    location: 'norte', quantity: 7, available: 5,
  });
  await Stock.create({
    empresa_id: empresaA.id, product_id: levadura.id, punto_de_venta_id: centroA.id,
    location: 'centro', quantity: 50, available: 50,
  });

  const golosinaB = await Product.create({
    empresa_id: empresaB.id,
    name: 'Chocolate',
    sku: 'CHO-001',
    cost: 500.00,
    unit_type: 'unidad',
  });

  await Stock.create({
    empresa_id: empresaB.id, product_id: golosinaB.id, punto_de_venta_id: localB.id,
    location: 'kiosco', quantity: 30, available: 30,
  });

  // Un producto **sin ninguna fila de stock**. Mapeado contra la tienda, es el
  // caso de «no hay stock en la sucursal designada»: lo que corresponde ahi es
  // NO publicar nada, y no publicar cero — publicar cero es una decision, y la
  // que se tomo es que una variante sin fila de stock queda con su motivo
  // escrito. Sin este producto, ese camino no se ejecuta nunca.
  const sal = await Product.create({
    empresa_id: empresaA.id,
    name: 'Sal fina',
    sku: 'SAL-001',
    cost: 120.50,
    unit_type: 'kg',
  });

  // ── Proveedores de A ──
  //
  // Los cuatro nombres arrancan con letras distintas y en orden alfabético dan
  // Almacén, Distribuidora, Molino, Zeta: así una página de dos dice cuál es
  // cuál sin ambigüedad.
  const molino = await Supplier.create({
    empresa_id: empresaA.id, name: 'Molino Río de la Plata', cuit: '30333333336',
  });
  const distribuidora = await Supplier.create({
    empresa_id: empresaA.id, name: 'Distribuidora Ñandú',
  });
  const almacen = await Supplier.create({
    empresa_id: empresaA.id, name: 'Almacén Sin Movimientos',
  });
  const zeta = await Supplier.create({
    empresa_id: empresaA.id, name: 'Zeta Insumos',
  });

  // Molino: cuatro movimientos, tres deudas y un pago, que dan saldo CERO
  // exacto. Los importes no son redondos a propósito.
  //
  // ⚠ **Dos de ellos son del MISMO día**, y eso también es a propósito. El
  // saldo inicial de una página se calcula con «todo lo anterior al movimiento
  // más viejo de esta página», y ese «anterior» desempata por id. Con cuatro
  // fechas distintas, el desempate no hace falta y sacarlo no rompería ningún
  // test: los dos del 02/07 son los que hacen que la página 1 y la página 2
  // caigan justo en el medio de un empate.
  await SupplierMovement.bulkCreate([
    { empresa_id: empresaA.id, supplier_id: molino.id, type: 'deuda', date: '2026-07-01', amount: 1234.56 },
    { empresa_id: empresaA.id, supplier_id: molino.id, type: 'deuda', date: '2026-07-02', amount: 0.10 },
    { empresa_id: empresaA.id, supplier_id: molino.id, type: 'deuda', date: '2026-07-02', amount: 0.20 },
    { empresa_id: empresaA.id, supplier_id: molino.id, type: 'pago', date: '2026-07-10', amount: 1234.86 },
  ]);

  // Distribuidora: tres pagos que suman exactamente la deuda. 33,33 × 3 da
  // 99,99000000000001 sumado en punto flotante.
  await SupplierMovement.bulkCreate([
    { empresa_id: empresaA.id, supplier_id: distribuidora.id, type: 'deuda', date: '2026-07-05', amount: 100.00 },
    { empresa_id: empresaA.id, supplier_id: distribuidora.id, type: 'pago', date: '2026-07-06', amount: 33.33 },
    { empresa_id: empresaA.id, supplier_id: distribuidora.id, type: 'pago', date: '2026-07-07', amount: 33.33 },
    { empresa_id: empresaA.id, supplier_id: distribuidora.id, type: 'pago', date: '2026-07-08', amount: 33.34 },
  ]);

  // Zeta: la única que queda debiendo.
  await SupplierMovement.bulkCreate([
    { empresa_id: empresaA.id, supplier_id: zeta.id, type: 'deuda', date: '2026-07-11', amount: 500.50 },
    { empresa_id: empresaA.id, supplier_id: zeta.id, type: 'pago', date: '2026-07-12', amount: 100.25 },
  ]);

  // Almacén no tiene ni un movimiento: es el caso del proveedor sin compras,
  // el que se pintaba «Saldado» comparando un string contra cero.

  await SupplierDocument.bulkCreate([
    { empresa_id: empresaA.id, supplier_id: molino.id, name: 'Factura A 0001-00001234', type: 'factura', date: '2026-07-01' },
    { empresa_id: empresaA.id, supplier_id: molino.id, name: 'Remito 0001-00005678', type: 'remito', date: '2026-07-01' },
  ]);

  await SupplierOrder.bulkCreate([
    {
      empresa_id: empresaA.id, supplier_id: molino.id, date: '2026-07-20', status: 'pending',
      total: 123.40,
      detail: [{ product_name: 'Harina 000', quantity: 10, quantity_received: 4, unit_price: 12.34 }],
    },
    {
      // Anulada: su importe NO tiene que sumar en «pendiente de recibir».
      empresa_id: empresaA.id, supplier_id: molino.id, date: '2026-07-21', status: 'cancelled',
      total: 99999.99,
      detail: [{ product_name: 'Harina 000', quantity: 100, quantity_received: 0, unit_price: 999.99 }],
    },
  ]);

  // ── Proveedor de B, con el MISMO nombre y números distintos ──
  const molinoB = await Supplier.create({
    empresa_id: empresaB.id, name: 'Molino Río de la Plata', cuit: '30444444445',
  });

  await SupplierMovement.bulkCreate([
    { empresa_id: empresaB.id, supplier_id: molinoB.id, type: 'deuda', date: '2026-07-01', amount: 77777.77 },
    { empresa_id: empresaB.id, supplier_id: molinoB.id, type: 'pago', date: '2026-07-02', amount: 11.11 },
  ]);

  // ── Una venta de cada empresa ──
  const ventaA = await Sale.create({
    id: 'VENTA-A-0001', empresa_id: empresaA.id, punto_de_venta_id: centroA.id,
    date: '2026-07-15', time: '10:30', total: 2469.12, payment_method: 'ef', status: 'active',
  });
  await SaleItem.create({
    sale_id: ventaA.id, product_id: harina.id, product_name: 'Harina 000',
    quantity: 2, unit_price: 1234.56,
  });

  const ventaB = await Sale.create({
    id: 'VENTA-B-0001', empresa_id: empresaB.id, punto_de_venta_id: localB.id,
    date: '2026-07-15', time: '11:45', total: 1500.00, payment_method: 'ef', status: 'active',
  });
  await SaleItem.create({
    sale_id: ventaB.id, product_id: golosinaB.id, product_name: 'Chocolate',
    quantity: 3, unit_price: 500.00,
  });

  // ════════════════════════════════════════════
  //  TiendaNube
  //
  //  Una tienda por empresa, con `tiendanube_user_id` distinto: el UNIQUE de esa
  //  columna es lo que impide que dos empresas vinculen la misma tienda, y con un
  //  solo valor sembrado no habria contra que chocar.
  // ════════════════════════════════════════════

  // ⚠ La sucursal designada de A es **norte**, que NO es la que elegiria
  // `sucursalPorDefecto`. Es lo unico que hace distinguible «se desconto de la
  // designada» de «se descontó de la por defecto»: con las dos siendo la misma,
  // el defecto de hoy —el webhook pasa null y cae al escalon por defecto— daria
  // exactamente el mismo numero y el test pasaria con y sin el arreglo.
  const designadaA = norteA;
  const porDefectoA = elegirPorDefecto([centroA, norteA]);

  if (!porDefectoA || Number(porDefectoA.id) === Number(designadaA.id)) {
    throw new Error(
      `La sucursal designada de la empresa A (${designadaA.code}) es la misma que elegiria ` +
      `sucursalPorDefecto (${porDefectoA ? porDefectoA.code : 'ninguna'}). Asi la fixture NO puede ` +
      'distinguir «se uso la designada» de «se cayo al escalon por defecto», que es justamente el ' +
      'defecto que la sucursal designada viene a cerrar. Si se renombraron las sucursales —por ' +
      'ejemplo, si centro paso a llamarse principal— hay que elegir otra designada.'
    );
  }

  const tiendaA = await TiendanubeTienda.create({
    empresa_id: empresaA.id,
    tiendanube_user_id: 4455667,
    nombre: 'Panadería del Centro Online',
    punto_de_venta_id: designadaA.id,
    vinculada_en: new Date('2026-08-01T12:00:00.000Z'),
    catalogo_refrescado_en: new Date('2026-08-05T09:00:00.000Z'),
  });

  const tiendaB = await TiendanubeTienda.create({
    empresa_id: empresaB.id,
    tiendanube_user_id: 9988776,
    nombre: 'Kiosco Online',
    punto_de_venta_id: localB.id,
    vinculada_en: new Date('2026-08-02T12:00:00.000Z'),
  });

  // Tres mapeos en A y uno en B. Los tres de A cubren tres situaciones
  // distintas a proposito:
  //
  //  - harina: tiene stock en la sucursal designada, con available ≠ quantity;
  //  - levadura: tiene stock, pero **solo en centro**, que NO es la designada;
  //  - sal: no tiene ninguna fila de stock.
  //
  // Con tres productos que tuvieran stock en la designada, «no publica cero» y
  // «no publica nada» serian el mismo caso.
  const mapeoHarina = await TiendanubeMapping.create({
    empresa_id: empresaA.id, product_id: harina.id,
    tiendanube_variant_id: 5000001, tiendanube_product_id: 700001,
  });
  const mapeoLevadura = await TiendanubeMapping.create({
    empresa_id: empresaA.id, product_id: levadura.id,
    tiendanube_variant_id: 5000002, tiendanube_product_id: 700001,
  });
  const mapeoSal = await TiendanubeMapping.create({
    empresa_id: empresaA.id, product_id: sal.id,
    tiendanube_variant_id: 5000003, tiendanube_product_id: 700002,
  });
  const mapeoB = await TiendanubeMapping.create({
    empresa_id: empresaB.id, product_id: golosinaB.id,
    tiendanube_variant_id: 6000001, tiendanube_product_id: 800001,
  });

  // La instantanea del catalogo de A. Las dos primeras variantes son del mismo
  // producto de TiendaNube —un producto con talles tiene varias— y la cuarta
  // tiene `vista_en` ANTERIOR al `catalogo_refrescado_en` de la tienda: es «esta
  // variante ya no esta en tu tienda», que sin una fila asi no se puede
  // distinguir de una que si esta.
  await TiendanubeVariante.bulkCreate([
    {
      empresa_id: empresaA.id, tiendanube_variant_id: 5000001, tiendanube_product_id: 700001,
      nombre_producto: 'Harina', nombre_variante: '1 kg', sku: 'HAR-000',
      stock_en_tienda: 20, vista_en: new Date('2026-08-05T09:00:00.000Z'),
    },
    {
      empresa_id: empresaA.id, tiendanube_variant_id: 5000002, tiendanube_product_id: 700001,
      nombre_producto: 'Harina', nombre_variante: '5 kg', sku: '',
      stock_en_tienda: 4, vista_en: new Date('2026-08-05T09:00:00.000Z'),
    },
    {
      empresa_id: empresaA.id, tiendanube_variant_id: 5000003, tiendanube_product_id: 700002,
      nombre_producto: 'Sal fina', nombre_variante: null, sku: 'SAL-001',
      stock_en_tienda: 0, vista_en: new Date('2026-08-05T09:00:00.000Z'),
    },
    {
      empresa_id: empresaA.id, tiendanube_variant_id: 5000004, tiendanube_product_id: 700003,
      nombre_producto: 'Producto que se borro de la tienda', nombre_variante: null, sku: 'VIEJO-1',
      stock_en_tienda: 3, vista_en: new Date('2026-07-01T09:00:00.000Z'),
    },
  ]);

  return {
    empresaA, empresaB,
    centroA, norteA, localB,
    usuarioA, usuarioB,
    harina, levadura, sal, golosinaB,
    molino, distribuidora, almacen, zeta, molinoB,
    ventaA, ventaB,
    tiendaA, tiendaB, designadaA,
    mapeoHarina, mapeoLevadura, mapeoSal, mapeoB,
  };
}

module.exports = { sembrarDosEmpresas, USUARIO_DE_LA_SESION };
