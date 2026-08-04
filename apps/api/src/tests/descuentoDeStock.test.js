// ════════════════════════════════════════════
//  Las rutas que descuentan stock tienen que encontrar la fila
//
//  Después de la migración 14, `stock.punto_de_venta_id` es NOT NULL. Una
//  consulta que busque `punto_de_venta_id: null` —o `req.puntoDeVentaId || null`,
//  que es lo mismo cuando no vino la cabecera— **no matchea ninguna fila
//  jamás**.
//
//  Los tres caminos que descuentan inventario buscaban así:
//
//    · `POST /api/sales`            (venta desde el POS)
//    · `PUT /api/sales/:id/void`    (anulación)
//    · `tiendanubeService`          (pedido de la tienda online)
//
//  Es el riesgo 1 del plan, y lo grave no es que falle: es que **no falla**.
//  La venta se registra, el comprobante sale, el cliente paga, y el inventario
//  no baja. Lo único que avisa es una línea de log que nadie lee, y el problema
//  aparece en un recuento físico tres meses después, cuando ya no se puede
//  reconstruir qué pasó.
//
//  Por eso esto es una guardia estática y no una nota en la spec: el error no
//  tiene síntoma, así que la única forma de detectarlo es impedir que se
//  escriba.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const leer = (relativo) => fs.readFileSync(path.join(SRC, relativo), 'utf8');

/**
 * Los bloques de una búsqueda de Stock: la línea de la llamada y las
 * siguientes, hasta cerrar el objeto `where`.
 */
function bloquesDeBusquedaDeStock(contenido) {
  const lineas = contenido.split('\n');
  const bloques = [];

  lineas.forEach((linea, i) => {
    if (!/Stock\.(findOne|findAll|findOrCreate)\s*\(/.test(linea)) return;
    if (linea.trim().startsWith('//') || linea.trim().startsWith('*')) return;

    bloques.push({ n: i + 1, texto: lineas.slice(i, i + 9).join('\n') });
  });

  return bloques;
}

/** Lo que no puede aparecer como sucursal de una búsqueda de stock. */
const NUNCA = [
  // La cabecera cruda: sin ella, `|| null` no matchea nada.
  /punto_de_venta_id:\s*req\.puntoDeVentaId/,
  // La columna de la venta: está en null en todas las ventas anteriores.
  /punto_de_venta_id:\s*sale\.punto_de_venta_id/,
  // Cualquier caída explícita a null.
  /punto_de_venta_id:\s*[^,\n]*\|\|\s*null/,
  /punto_de_venta_id:\s*null/,
];

describe('POST /api/sales y PUT /api/sales/:id/void descuentan de una sucursal real', () => {
  const sales = leer('routes/sales.js');
  const bloques = bloquesDeBusquedaDeStock(sales);

  it('encuentra las dos búsquedas de stock que tiene que vigilar', () => {
    // El ancla. Una guardia que pasa porque no encontró nada que mirar es peor
    // que no tenerla: nadie vuelve a mirarla. Si este número cambia, hay una
    // búsqueda de stock nueva y **hay que leerla**, no ajustar el número.
    expect(bloques.length).toBeGreaterThan(0);
    expect(bloques.length).toBe(2);
  });

  it('ninguna busca la fila por una sucursal que puede ser nula', () => {
    const malas = bloques
      .filter(({ texto }) => NUNCA.some((patron) => patron.test(texto)))
      .map(({ n }) => `L${n}`);

    expect(malas).toEqual([]);
  });

  it('las dos filtran por sucursal: buscar sin ella traería la fila de otra', () => {
    const sinSucursal = bloques
      .filter(({ texto }) => !/punto_de_venta_id:/.test(texto))
      .map(({ n }) => `L${n}`);

    expect(sinSucursal).toEqual([]);
  });

  it('la sucursal sale de utils/sucursalDeStock y no de una regla propia', () => {
    // Diez lugares escriben stock y cada uno decidía la sucursal a su manera.
    // Que la decida siempre la misma función es FR-049; si acá se vuelve a
    // resolver a mano, las rutas y la migración pueden mapear distinto.
    expect(sales).toMatch(/require\('\.\.\/utils\/sucursalDeStock'\)/);
    expect(sales).toMatch(/resolverSucursal\(/);
    expect(sales).toMatch(/sucursalPorDefecto\(/);
  });

  it('la anulación prueba los tres escalones antes de rendirse', () => {
    // `sale.punto_de_venta_id` → `sale.location` → por defecto. Sin el
    // segundo y el tercero, anular una venta anterior a esta funcionalidad
    // devuelve el dinero y no la mercadería.
    const anulacion = sales.slice(sales.indexOf('async function sucursalDeAnulacion'));
    const cuerpo = anulacion.slice(0, anulacion.indexOf('\n}\n'));

    expect(cuerpo).toMatch(/sale\.punto_de_venta_id/);
    expect(cuerpo).toMatch(/code:\s*sale\.location/);
    expect(cuerpo).toMatch(/sucursalPorDefecto\(/);
  });
});

// ════════════════════════════════════════════
//  La venta queda asentada en la sucursal de la que salió la mercadería
//
//  Es el mismo defecto que arriba, por el otro lado. `POST /api/sales` resolvía
//  la sucursal DOS veces y de dos maneras distintas: el stock salía de
//  `resolverSucursal(...)` —que nunca devuelve null— y la venta se guardaba con
//  `req.puntoDeVentaId || null`. Con la cabecera presente coincidían; sin ella,
//  la mercadería salía de una sucursal concreta y la venta quedaba diciendo que
//  no fue de ninguna.
//
//  Eso no se ve al cobrar: se ve al anular. `sucursalDeAnulacion` cae entonces
//  al tercer escalón —el punto de venta por defecto de la empresa—, que **no es
//  estable**: alcanza con crear una sucursal `principal`, o con dar de baja la
//  que era el default, para que la devolución de stock de una venta vieja
//  aterrice en OTRO local. No falla nada, no avisa nada, y se descubre en un
//  recuento físico.
// ════════════════════════════════════════════

describe('POST /api/sales asienta la venta en la sucursal de la que descontó', () => {
  const sales = leer('routes/sales.js');

  const alta = () => {
    const i = sales.indexOf("router.post('/', checkPermission");
    const j = sales.indexOf("router.put('/:id/void'", i);

    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);

    return sales.slice(i, j);
  };

  const saleData = () => {
    const bloque = alta();
    const i = bloque.indexOf('const saleData = {');

    expect(i).toBeGreaterThanOrEqual(0);

    return bloque.slice(i, bloque.indexOf('\n    };', i));
  };

  it('el Sale.create NO escribe punto_de_venta_id como req.puntoDeVentaId || null', () => {
    // La columna quedaba en null en toda venta hecha sin la cabecera, y ese dato
    // no se puede reconstruir después: `sale.location` es texto libre que
    // escribía el cliente.
    expect(saleData()).not.toMatch(/punto_de_venta_id:\s*req\.puntoDeVentaId/);
    expect(saleData()).not.toMatch(/punto_de_venta_id:\s*[^,\n]*\|\|\s*null/);
    expect(saleData()).toMatch(/punto_de_venta_id:\s*sucursal\.id/);
  });

  it('la sucursal se resuelve ANTES del Sale.create', () => {
    // Es lo que cubre el escenario 6.3: una venta SIN líneas también tiene que
    // quedar atribuida. Con la llamada adentro del `if (lineas.length)` —de
    // donde salió— esa venta se registra sin sucursal, y es exactamente lo que
    // se pierde si alguien «ordena» el handler y la devuelve adentro del `if`.
    // Se busca la LLAMADA y no el texto: el comentario de arriba nombra a
    // `resolverSucursal(...)`, y con un indexOf crudo esta guardia pasaba con la
    // llamada devuelta adentro del `if` — un test que pasa con y sin el cambio.
    const bloque = alta();
    const resuelve = bloque.search(/^\s*const \w+ = await resolverSucursal\(/m);
    const crea = bloque.search(/^\s*const sale = await Sale\.create\(/m);

    expect(resuelve).toBeGreaterThanOrEqual(0);
    expect(crea).toBeGreaterThanOrEqual(0);
    expect(resuelve).toBeLessThan(crea);
  });

  it('el bucle de stock usa la MISMA sucursal que se guardó en la venta', () => {
    // Por construcción y no por coincidencia: si el bucle resolviera la suya, un
    // día las dos podrían diferir y la anulación devolvería a otro local.
    const bloque = alta();
    // Solo las llamadas de verdad: el `resolverSucursal(...)` que aparece en el
    // comentario de arriba no cuenta.
    const llamadas = bloque.match(/^\s*const \w+ = await resolverSucursal\(/gm) || [];

    expect(llamadas).toHaveLength(1);
    expect(bloque).toMatch(/punto_de_venta_id:\s*sucursal\.id/);
  });

  it('la respuesta de POST / NO obliga al navegador a restar available - qty', () => {
    // Sin el campo `stock`, el POS tendría que recalcular el inventario por su
    // cuenta para no recargar el catálogo entero después de cada venta, y se
    // equivocaría justo en el caso que importa: el producto SIN fila de stock,
    // donde no se descontó nada. Ese aparece en `warnings` y no en `stock`; los
    // dos arreglos son complementarios y ninguno hay que parsear.
    const bloque = alta();
    const respuesta = bloque.match(/res\.status\(201\)\.json\([^\n]*\)/);

    expect(respuesta).not.toBeNull();
    expect(respuesta[0]).toMatch(/stock:/);

    // Y se arma DENTRO del bloque que hace `stock.update(`, no después del
    // commit: leerlo después devuelve valores que otra caja ya pudo cambiar, y
    // el catálogo quedaría mostrando el stock de la venta de otro.
    const actualiza = bloque.search(/^\s*await stock\.update\(/m);
    const arma = bloque.search(/^\s*filasDeStock\.push\(/m);
    const commit = bloque.search(/^\s*await t\.commit\(\)/m);

    expect(actualiza).toBeGreaterThanOrEqual(0);
    expect(arma).toBeGreaterThan(actualiza);
    expect(arma).toBeLessThan(commit);
  });

  it('los tres escalones de la anulación quedan intactos para las ventas viejas', () => {
    // Las ventas anteriores a esta funcionalidad NO se migran: el dato no
    // existe. Sacar los escalones dos y tres las dejaría sin forma de devolver
    // la mercadería.
    const anulacion = sales.slice(sales.indexOf('async function sucursalDeAnulacion'));
    const cuerpo = anulacion.slice(0, anulacion.indexOf('\n}\n'));

    expect(cuerpo).toMatch(/sale\.punto_de_venta_id/);
    expect(cuerpo).toMatch(/code:\s*sale\.location/);
    expect(cuerpo).toMatch(/sucursalPorDefecto\(/);
  });
});

describe('un pedido de TiendaNube también descuenta stock', () => {
  const tiendanube = leer('services/tiendanubeService.js');
  const bloques = bloquesDeBusquedaDeStock(tiendanube);

  it('encuentra la búsqueda de stock que tiene que vigilar', () => {
    // El ancla, igual que arriba.
    expect(bloques.length).toBeGreaterThan(0);
    expect(bloques.length).toBe(1);
  });

  it('no busca la fila por una sucursal que puede ser nula', () => {
    // Un pedido de la tienda NUNCA trae cabecera de punto de venta: acá
    // `|| null` no era un caso raro, era el caso normal.
    const malas = bloques
      .filter(({ texto }) => NUNCA.some((patron) => patron.test(texto))
        || /punto_de_venta_id:\s*puntoDeVentaId/.test(texto))
      .map(({ n }) => `L${n}`);

    expect(malas).toEqual([]);
  });

  it('la sucursal sale de utils/sucursalDeStock', () => {
    expect(tiendanube).toMatch(/require\('\.\.\/utils\/sucursalDeStock'\)/);
    expect(tiendanube).toMatch(/resolverSucursal\(/);
  });
});

