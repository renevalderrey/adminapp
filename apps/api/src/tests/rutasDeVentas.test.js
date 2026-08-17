// ════════════════════════════════════════════
//  El orden de declaración de las rutas de ventas
//
//  Express resuelve por orden de declaración, no por especificidad. Con
//  `GET /:id` declarado arriba, el parámetro `:id` se come la palabra
//  "export": pedir /api/sales/export entra al handler del detalle, que busca
//  una venta con id "export", no la encuentra y responde 404.
//
//  No falla al arrancar, no falla en el build, y el mensaje que se ve —«Venta
//  no encontrada»— manda a buscar el problema al lado equivocado. Es el error
//  más fácil de cometer al agregar rutas a este router.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { crearModelo } = require('./helpers/modelosFalsos');

// ── Los dobles ──
//
// Se declaran ANTES del `require('../routes/sales')` porque `jest.mock` se
// iza al tope del archivo y el router se arma con lo que haya en `../models`
// en ese momento. Las guardias estáticas de más abajo no los usan: leen el
// fuente y el stack del router, que no cambian por estar mockeado.
const mockSale = crearModelo([]);
const mockSaleItem = crearModelo([]);
const mockStock = crearModelo([]);
const mockStockMovement = crearModelo([]);
const mockPuntoDeVenta = crearModelo([]);
const mockProduct = crearModelo([]);
const mockEmpresa = crearModelo([]);
const mockCustomer = crearModelo([]);
const mockSetting = crearModelo([]);

// `Sale.id` es STRING(40) —el navegador genera «sale_1738012345»— y
// `normalizarId` lo mira para decidir si castea a entero. Sin esto, findScoped
// devolvería null y la anulación daría 404 por el motivo equivocado.
mockSale.primaryKeyAttribute = 'id';
mockSale.rawAttributes = { id: { type: { key: 'STRING' } } };

jest.mock('../models', () => ({
  Sale: mockSale,
  SaleItem: mockSaleItem,
  Stock: mockStock,
  StockMovement: mockStockMovement,
  PuntoDeVenta: mockPuntoDeVenta,
  Product: mockProduct,
  Empresa: mockEmpresa,
  Customer: mockCustomer,
  Setting: mockSetting,
}));

// `config/database` construye la conexión al importarse. Acá se reemplaza por
// una transacción de mentira: se registran commit y rollback para poder
// afirmar cuál se llamó, y no hay base contra la cual abrir nada.
const mockTransaccion = { commits: 0, rollbacks: 0 };

jest.mock('../config/database', () => ({
  transaction: async () => ({
    LOCK: { UPDATE: 'UPDATE' },
    commit: async () => { mockTransaccion.commits++; },
    rollback: async () => { mockTransaccion.rollbacks++; },
  }),
}));

const router = require('../routes/sales');

const FUENTE = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sales.js'), 'utf8');

/** El cuerpo del handler que empieza en `marca`, hasta el final del archivo. */
function desde(marca) {
  const i = FUENTE.indexOf(marca);
  expect(i).toBeGreaterThanOrEqual(0);
  return FUENTE.slice(i);
}

/** El texto entre dos marcas del archivo. */
function entre(inicio, fin) {
  const i = FUENTE.indexOf(inicio);
  const j = FUENTE.indexOf(fin, i);

  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThan(i);

  return FUENTE.slice(i, j);
}

/** Los paths en el orden en que Express los va a evaluar. */
function rutasDeclaradas() {
  return router.stack
    .filter((capa) => capa.route)
    .map((capa) => ({
      metodo: Object.keys(capa.route.methods)[0].toUpperCase(),
      path: capa.route.path,
    }));
}

function posicionDe(metodo, path) {
  return rutasDeclaradas().findIndex((r) => r.metodo === metodo && r.path === path);
}

describe('Las rutas literales se declaran antes que GET /:id', () => {
  it('están declaradas las tres rutas de lectura', () => {
    const paths = rutasDeclaradas().filter((r) => r.metodo === 'GET').map((r) => r.path);

    expect(paths).toContain('/');
    expect(paths).toContain('/summary');
    expect(paths).toContain('/export');
    expect(paths).toContain('/:id');
  });

  it.each(['/summary', '/export'])('%s se evalúa antes que /:id', (literal) => {
    const posicionLiteral = posicionDe('GET', literal);
    const posicionParametro = posicionDe('GET', '/:id');

    expect(posicionLiteral).toBeGreaterThanOrEqual(0);
    expect(posicionParametro).toBeGreaterThanOrEqual(0);
    expect(posicionLiteral).toBeLessThan(posicionParametro);
  });
});

// ════════════════════════════════════════════
//  Guardias estáticas de la idempotencia de POST /api/sales
//
//  El `id` de la venta lo genera el navegador y es la clave primaria: ya es una
//  clave de idempotencia. Antes, un reintento del mismo ticket —la red se cortó
//  después de guardar pero antes de que llegara la respuesta— chocaba contra la
//  restricción única y salía como un 500 «Error al registrar la venta». El
//  operador leía que no se había registrado nada y volvía a cobrar: dos ventas y
//  dos descuentos de stock por una sola operación.
//
//  Son guardias estáticas y no tests de comportamiento **porque los dobles de
//  `tests/helpers/modelosFalsos.js` no entienden `lock` ni transacciones** —lo
//  dice su propio encabezado—: un test de idempotencia escrito sobre ellos
//  probaría el doble. El comportamiento se verifica contra Postgres, en el paso
//  manual 6a de `docs/specs/011-punto-de-venta/tasks.md`.
// ════════════════════════════════════════════

describe('POST / no registra dos veces la misma venta', () => {
  const antesDelCreate = () => entre("router.post('/', checkPermission", 'Sale.create(');

  const catchDelAlta = () => {
    const inicioDelHandler = FUENTE.indexOf("router.post('/', checkPermission");
    const fin = FUENTE.indexOf("fallo(req, res, err, 'Error al registrar la venta')", inicioDelHandler);
    const inicio = FUENTE.lastIndexOf('} catch (err) {', fin);

    expect(inicio).toBeGreaterThan(inicioDelHandler);

    return FUENTE.slice(inicio, fin);
  };

  it('POST / busca la venta por id ANTES de crearla, y con findScoped', () => {
    // Con findByPk, un `id` que existe en OTRA empresa cliente devolvería esa
    // venta y el POS imprimiría un comprobante ajeno. La idempotencia es POR
    // EMPRESA: los ids se buscan acotados.
    //
    // ⚠ Lo que este test NO afirma —y el comentario del archivo decía mal— es
    // que un id de otra empresa se cree normalmente. `Sale.id` es la clave
    // primaria GLOBAL: el findScoped no lo encuentra, el insert choca contra la
    // PK y la respuesta es un 500, también en el reintento. Es despreciable
    // —mismo milisegundo Y los mismos 8 hexadecimales de `nuevoIdDeVenta()`— y
    // está anotado en `sales.js`, no resuelto.
    const bloque = antesDelCreate();

    expect(bloque).toMatch(/findScoped\(Sale,\s*id,\s*req\.empresaId/);
    expect(bloque).not.toMatch(/Sale\.findByPk\(/);
  });

  it('la respuesta del reintento NO vuelve a descontar stock ni repite los avisos', () => {
    // `warnings: []` y `stock: []` van vacíos a propósito: la venta ya existe y
    // su stock ya se descontó cuando se creó. Devolver los de aquella vez los
    // mostraría dos veces.
    expect(antesDelCreate()).toMatch(/yaRegistrada:\s*true/);
    expect(antesDelCreate()).toMatch(/warnings:\s*\[\]/);
    expect(antesDelCreate()).toMatch(/stock:\s*\[\]/);
  });

  it('el reintento devuelve las LINEAS de la venta ya registrada, no solo la cabecera', () => {
    // Sin `items`, «ya registrada» es una afirmación que el navegador NO PUEDE
    // VERIFICAR. El caso real: se cobra un ticket de 1 unidad, la red se corta
    // después del commit, el operador lee «Error», el cliente pide una segunda
    // unidad y se vuelve a cobrar con el MISMO id. El servidor responde la venta
    // vieja y la pantalla no tiene con qué darse cuenta: se entregan 2 unidades,
    // se registró y se descontó 1, y el comprobante sale con dos líneas y el
    // total de una.
    //
    // El `include` acá es seguro porque este findScoped NO lleva `lock`: es el
    // LEFT OUTER JOIN … FOR UPDATE lo que PostgreSQL rechaza, y por eso
    // `POST /:id/facturar` no puede traerlas.
    expect(antesDelCreate()).toMatch(/include:\s*\[\{\s*model:\s*SaleItem,\s*as:\s*'items'\s*\}\]/);
  });

  it('el catch de POST / no responde 500 ante una clave primaria repetida', () => {
    // El findScoped previo NO es atómico: dos requests en vuelo pasan los dos
    // por el findOne y el que pierde choca contra la restricción de la base. La
    // guardia real es la base; el findOne es el camino normal.
    const bloque = catchDelAlta();

    expect(bloque).toMatch(/SequelizeUniqueConstraintError/);
    expect(bloque).toMatch(/yaRegistrada:\s*true/);
    // Y con las líneas, igual que la rama de arriba: las dos ramas responden lo
    // mismo, así que las dos tienen que poder verificarse igual.
    expect(bloque).toMatch(/include:\s*\[\{\s*model:\s*SaleItem,\s*as:\s*'items'\s*\}\]/);
  });
});

// ════════════════════════════════════════════
//  Guardias estáticas del reintento de facturación
//
//  El lock y la carrera solo se pueden comprobar de verdad contra Postgres, y
//  eso queda como paso manual. Lo que sí se puede fijar acá es que las piezas
//  que lo hacen posible no desaparezcan en una edición futura: son groseras a
//  propósito, igual que las guardias de aislamiento.
// ════════════════════════════════════════════

describe('POST /:id/facturar toma la venta con lock', () => {
  const facturar = () => desde("router.post('/:id/facturar'");

  // Sin lock, dos usuarios —uno reintenta, otro anula— dejan un CAE emitido
  // contra una venta anulada. Deshacerlo exige una nota de crédito.
  it('abre transacción y bloquea la fila', () => {
    expect(facturar()).toMatch(/sequelize\.transaction\(\)/);
    expect(facturar()).toMatch(/lock:\s*t\.LOCK\.UPDATE/);
  });

  // Con include, Sequelize arma un LEFT OUTER JOIN … FOR UPDATE que PostgreSQL
  // rechaza y la consulta falla SIEMPRE. Es el mismo motivo por el que /void
  // trae los items aparte.
  it('el findScoped con lock no lleva include', () => {
    const bloque = facturar().slice(0, facturar().indexOf('if (!sale)'));

    expect(bloque).toMatch(/findScoped\(Sale/);
    // `include:` con dos puntos es código; el comentario que explica por qué no
    // va no lleva dos puntos.
    expect(bloque).not.toMatch(/include:/);
  });

  // Lo que valía antes de pedir el lock puede haber cambiado mientras se
  // esperaba: revalidar afuera es no haber puesto el lock.
  it('revalida status y afip_cae después de tomar el lock', () => {
    const bloque = facturar();
    const posicionLock = bloque.indexOf('lock: t.LOCK.UPDATE');

    expect(bloque.indexOf("sale.status === 'voided'")).toBeGreaterThan(posicionLock);
    expect(bloque.indexOf('if (sale.afip_cae)')).toBeGreaterThan(posicionLock);
  });
});

describe('PUT /:id/void rechaza las ventas con CAE', () => {
  const anular = () => {
    const i = FUENTE.indexOf("router.put('/:id/void'");
    expect(i).toBeGreaterThanOrEqual(0);
    return FUENTE.slice(i, FUENTE.indexOf("router.post('/:id/facturar'"));
  };

  // Anular acá no da de baja nada ante ARCA: el comprobante sigue declarado
  // hasta que exista una nota de crédito, que el sistema todavía no emite.
  it('tira un ErrorDeNegocio cuando la venta tiene afip_cae', () => {
    const bloque = anular();

    expect(bloque).toMatch(/if \(sale\.afip_cae\)/);
    expect(bloque).toMatch(/throw new ErrorDeNegocio\(/);
  });

  it('el mensaje explica el motivo en castellano y nombra la nota de crédito', () => {
    expect(anular()).toMatch(/vigente ante ARCA/);
    expect(anular()).toMatch(/nota de crédito/);
  });

  // Si el bloqueo fuera después, una anulación rechazada habría devuelto igual
  // la mercadería al inventario: el stock quedaría inflado sin que la venta se
  // haya anulado.
  it('el bloqueo va ANTES de tocar el stock', () => {
    const bloque = anular();

    expect(bloque.indexOf('if (sale.afip_cae)')).toBeLessThan(bloque.indexOf('SaleItem.findAll'));
    expect(bloque.indexOf('if (sale.afip_cae)')).toBeLessThan(bloque.indexOf('Stock.findOne'));
  });

  // Con el lock tomado antes: lo que valía al entrar puede haber cambiado
  // mientras se esperaba a un reintento que estaba emitiendo el CAE.
  it('se evalúa con la fila ya bloqueada', () => {
    const bloque = anular();

    expect(bloque.indexOf('lock: t.LOCK.UPDATE')).toBeLessThan(bloque.indexOf('if (sale.afip_cae)'));
  });
});

describe('El 502 dice lo que dijo AFIP y nada más', () => {
  // El catch ancho anterior devolvía err.message viniera de donde viniera: un
  // fallo del sale.update salía como 502 con nombres de tabla y de constraint,
  // presentados al usuario como «lo que dijo AFIP». Con la columna nueva, ese
  // texto además quedaría guardado para siempre.
  it('el único 502 del archivo devuelve el error de AFIP, no un err.message cualquiera', () => {
    const respuestas502 = FUENTE.match(/res\.status\(502\)[\s\S]{0,200}?\}\);/g) || [];

    expect(respuestas502).toHaveLength(1);
    expect(respuestas502[0]).toContain('errorDeAfip.message');
    expect(respuestas502[0]).not.toMatch(/\berr\.message\b/);
  });

  it('el catch de afuera sale por fallo(), que no filtra el error interno', () => {
    expect(desde("router.post('/:id/facturar'")).toMatch(/fallo\(req, res, err, 'Error al facturar la venta'\)/);
  });
});

describe('El error de AFIP se persiste fuera de la transacción', () => {
  const helper = () => {
    const i = FUENTE.indexOf('async function registrarIntentoFallido');
    expect(i).toBeGreaterThanOrEqual(0);
    return FUENTE.slice(i, FUENTE.indexOf('\n}\n', i));
  };

  it('escribe el error y la fecha del intento', () => {
    expect(helper()).toMatch(/afip_ultimo_error: mensaje/);
    expect(helper()).toMatch(/afip_ultimo_intento: new Date\(\)/);
  });

  // Toda escritura por id lleva empresa_id.
  it('acota por empresa', () => {
    expect(helper()).toMatch(/empresa_id: empresaId/);
  });

  // Sin esta condición, un intento que perdió una carrera le pisa el estado a
  // una venta que entre medio se facturó bien: quedaría con CAE y con un
  // mensaje de rechazo al mismo tiempo.
  it('solo escribe si la venta sigue sin CAE', () => {
    expect(helper()).toMatch(/afip_cae:\s*\{\s*\[Op\.is\]:\s*null\s*\}/);
  });

  it('se llama después de revertir la transacción, no adentro', () => {
    const bloque = desde('} catch (errorDeAfip) {');
    const revertir = bloque.indexOf('await revertir()');
    const registrar = bloque.indexOf('await registrarIntentoFallido(');

    expect(revertir).toBeGreaterThanOrEqual(0);
    expect(registrar).toBeGreaterThan(revertir);
  });
});

// ════════════════════════════════════════════
//  Lo que el handler decide y ninguna funcion pura puede fijar
//
//  Estos tres son los que la verificacion pudo revertir sin que fallara nada:
//  el orden del export, la suma del periodo sin su filtro, y la condicion de
//  IVA que no salia del cliente. No son calculos —son decisiones de la
//  consulta— asi que no hay funcion pura donde probarlos: van como guardia
//  estatica, igual que el lock y el orden de declaracion de las rutas.
// ════════════════════════════════════════════

/** Las lineas `order:` de un bloque, tal como estan escritas. */
function ordenesDe(bloque) {
  return (bloque.match(/order:[^\n]*/g) || []).map((linea) => linea.trim());
}

describe('El archivo exportado se puede comparar fila por fila contra la pantalla', () => {
  const listado = () => entre("router.get('/', checkPermission", "router.get('/summary'");
  const exportar = () => entre("router.get('/export'", "router.get('/:id'");

  // Con dos criterios de orden distintos, el archivo y la pantalla listan las
  // mismas ventas en distinto orden: comparar una fila contra la otra deja de
  // ser posible justo cuando alguien necesita hacerlo.
  it('el listado ordena por el filtro, no por un criterio escrito a mano', () => {
    expect(ordenesDe(listado())).toEqual(['order: filtro.order,']);
  });

  it('el export ordena EXACTAMENTE igual que el listado', () => {
    expect(ordenesDe(exportar())).toEqual(['order: filtro.order,']);
  });

  // El orden lo decide filtroVentas y esta testeado ahi: `date DESC, time
  // DESC, id DESC`. Lo que se fija aca es que los dos handlers lo usen.
  it('el filtro es el mismo objeto en los dos: se arma una sola vez por handler', () => {
    expect(listado()).toMatch(/const filtro = filtroVentas\(req\.query/);
    expect(exportar()).toMatch(/const filtro = filtroVentas\(req\.query/);
  });

  // La fila del archivo se arma en utils/exportVentas.js, donde la alcanzan
  // los tests. Volver a escribirla adentro del handler la saca de cobertura.
  it('las filas las arma filaDeExport, no el handler', () => {
    expect(exportar()).toMatch(/filaDeExport\(venta\.toJSON\(\)\)/);
  });
});

describe('El total del periodo corresponde al resultado filtrado (FR-079)', () => {
  const listado = () => entre("router.get('/', checkPermission", "router.get('/summary'");

  // Sin el `where`, el encabezado muestra el total de TODAS las ventas
  // historicas de la empresa mientras la tabla muestra las del filtro. Los dos
  // numeros se leen juntos y ninguno dice de que esta hablando.
  it('la suma va con el mismo where que el listado', () => {
    expect(listado()).toMatch(/Sale\.sum\('total',\s*\{\s*where\b/);
  });

  it('el where de la suma es el mismo objeto, ya acotado por empresa', () => {
    const bloque = listado();
    const scoped = bloque.indexOf('const where = scoped(filtro.where, req.empresaId)');
    const suma = bloque.indexOf("Sale.sum('total'");

    expect(scoped).toBeGreaterThanOrEqual(0);
    expect(suma).toBeGreaterThan(scoped);
  });

  // parseFloat vive en utils/exportVentas.js con su test: el DECIMAL vuelve
  // como string y la pantalla lo concatena en vez de sumarlo.
  it('el total se convierte a numero con totalDelPeriodo', () => {
    expect(listado()).toMatch(/total_periodo: totalDelPeriodo\(suma\)/);
  });
});

describe('La condicion de IVA del receptor sale de la ficha del cliente (FR-043)', () => {
  const resolver = () => entre('async function resolverComprobante', 'Guarda el rechazo de AFIP');

  // La ficha se consultaba pidiendo solo ['id', 'tax_id']: `tax_condition` no
  // se leia nunca, asi que la condicion no podia salir de ahi ni aunque
  // estuviera cargada.
  it('la ficha se consulta pidiendo tax_condition', () => {
    expect(resolver()).toMatch(/attributes:\s*\['id',\s*'tax_id',\s*'tax_condition'\]/);
  });

  // Derivarla del TIPO de comprobante declara a un Responsable Inscripto como
  // Consumidor Final, con el CUIT del RI adjunto. El comprobante sale, ARCA lo
  // autoriza, y queda mal declarado: deshacerlo exige una nota de credito.
  it('la condicion se traduce desde la ficha con condicionIvaDeAfip', () => {
    expect(resolver()).toMatch(/condicionIvaDeAfip\(cliente && cliente\.tax_condition\)/);
  });

  // El orden es body -> ficha -> tipo de comprobante. La regla vieja queda
  // como respaldo para las ventas sin ficha, no como primera opcion.
  it('la regla por tipo de comprobante queda DESPUES de la ficha', () => {
    const bloque = resolver();

    expect(bloque.indexOf('condicionIvaDeAfip('))
      .toBeLessThan(bloque.indexOf('[1, 2, 3].includes(tipo) ? 1 : 5'));
  });

  it('el body sigue mandando sobre las dos', () => {
    const bloque = resolver();

    expect(bloque.indexOf('parseInt(body.customerVatCondition, 10)'))
      .toBeLessThan(bloque.indexOf('condicionIvaDeAfip('));
  });

  // Toda lectura por un id que sale de un registro del cliente lleva empresa.
  it('la ficha se lee acotada por empresa', () => {
    expect(resolver()).toMatch(/scoped\(\{ id: sale\.customer_id \}, empresaId\)/);
  });
});

// ════════════════════════════════════════════
//  El arnés de comportamiento: la API con los dobles montados
//
//  Vive en el módulo y no adentro de un `describe` porque lo usan los tres
//  bloques de abajo —la anulación, la puerta de `POST /api/sales` y el aviso de
//  stock insuficiente—. Escribir un segundo arnés al lado del que ya existe es
//  cómo terminan dos suites que montan la misma ruta con dobles distintos y
//  contestan cosas distintas sobre el mismo handler.
// ════════════════════════════════════════════

const EMPRESA = 7;
const SUCURSAL = 31;

/**
 * `bulkCreate`, que `modelosFalsos` no trae.
 *
 * `POST /api/sales` escribe las líneas con `SaleItem.bulkCreate`. Sin esto la
 * ruta tira un TypeError, `fallo()` lo convierte en un 500 y un test que
 * afirmara «no quedó ninguna línea» pasaría **sin haber ejercitado nada**:
 * vería la tabla vacía y creería que la validación rechazó la venta.
 */
mockSaleItem.bulkCreate = async (filas = [], opciones = {}) => {
  mockSaleItem.llamadas.push({ metodo: 'bulkCreate', filas, ...opciones });

  const creadas = filas.map((datos, i) => ({ id: mockSaleItem.filas.length + i + 1, ...datos }));
  mockSaleItem.filas.push(...creadas);
  return creadas;
};

function levantarApi(empresaId = EMPRESA) {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = empresaId;
    req.userId = 'auth0|quien-anula';
    req.id = 'req-de-prueba';
    siguiente();
  });
  api.use('/api/sales', require('../routes/sales'));
  return api;
}

/** El producto que se cobra en los tickets de prueba. */
const PRODUCTO = 501;

/**
 * Deja los dobles en el estado desde el que se puede cobrar un ticket.
 *
 * `quantity` y `available` se pasan como los entrega el driver —número hoy,
 * texto con la columna en `DECIMAL`— porque los dos casos hacen falta: el
 * número es el control y el texto es el que distingue el defecto.
 */
function sembrarParaVender({ quantity = 20, available = 20 } = {}) {
  mockTransaccion.commits = 0;
  mockTransaccion.rollbacks = 0;

  mockEmpresa.filas = [{ id: EMPRESA, timezone: 'America/Argentina/Buenos_Aires' }];
  mockPuntoDeVenta.filas = [
    { id: SUCURSAL, empresa_id: EMPRESA, code: 'general', name: 'Principal', is_active: true },
  ];
  mockSale.filas = [];
  mockSaleItem.filas = [];
  mockStockMovement.filas = [];
  mockStock.filas = [{
    id: 1,
    product_id: PRODUCTO,
    empresa_id: EMPRESA,
    punto_de_venta_id: SUCURSAL,
    quantity,
    available,
  }];

  for (const doble of [mockSale, mockSaleItem, mockStock, mockStockMovement, mockPuntoDeVenta, mockEmpresa]) {
    doble.llamadas = [];
  }
}

/**
 * Un ticket de una línea, como lo manda el POS.
 *
 * **Sin `total` a propósito**: el servidor lo calcula a partir de las líneas, y
 * mandarlo hace que una cantidad disparatada salga rechazada por
 * `TOTAL_INCONSISTENTE` antes de llegar a la validación que se está probando —o
 * sea que el test pasaría por la rama equivocada—. Los casos que necesitan
 * afirmar el total lo pasan explícitamente.
 */
function vender(cantidad, cuerpo = {}) {
  return request(levantarApi())
    .post('/api/sales')
    .send({
      id: 'sale_1738099999',
      items: [{
        product_id: PRODUCTO,
        product_name: 'Creatina 300g',
        quantity: cantidad,
        unit_price: 1200,
      }],
      ...cuerpo,
    });
}

// ════════════════════════════════════════════
//  Anular una venta devuelve la mercadería, no una concatenación
//
//  `sales.js:722-723` sumaba con `+` dos valores que **los dos** vienen de la
//  base. Mientras `stock.quantity` sea `INTEGER`, `pg` devuelve números y la
//  suma es una suma. Con la columna en `DECIMAL(14,4)` el driver devuelve
//  texto —`"10.2500"`— y el `+` concatena: la anulación escribe
//  `"10.25000.2500"`, que no es «el stock un poco mal», es un valor que la
//  columna rechaza o —cuando el otro operando es entero— un número mucho
//  mayor. Anular pasaría a inventar mercadería.
//
//  ⚠ **Por qué acá y no en un test de integración.** Hoy la columna todavía es
//  `INTEGER`: contra Postgres el defecto **no existe todavía** y ninguna
//  integración lo puede mostrar. Un doble, en cambio, devuelve lo que se le
//  puso: inyectarle `'10.5000'` distingue el defecto **hoy**, que es lo que
//  hace desplegable esta fase sola. El mismo caso vuelve a correr contra la
//  base real en la Fase 3 (FR-028).
// ════════════════════════════════════════════

describe('PUT /api/sales/:id/void repone el stock sumando, no concatenando', () => {
  beforeEach(() => {
    mockTransaccion.commits = 0;
    mockTransaccion.rollbacks = 0;

    mockPuntoDeVenta.filas = [
      { id: SUCURSAL, empresa_id: EMPRESA, code: 'general', name: 'Principal', is_active: true },
    ];
    mockSale.filas = [{
      id: 'sale_1738012345',
      empresa_id: EMPRESA,
      status: 'completed',
      punto_de_venta_id: SUCURSAL,
      afip_cae: null,
      location: 'general',
    }];
    mockStockMovement.filas = [];

    for (const doble of [mockSale, mockSaleItem, mockStock, mockStockMovement, mockPuntoDeVenta]) {
      doble.llamadas = [];
    }
  });

  /** El stock y la línea, con los valores que el driver entrega como texto. */
  function sembrar({ stockQuantity, stockAvailable, itemQuantity }) {
    mockStock.filas = [{
      id: 1,
      product_id: 501,
      empresa_id: EMPRESA,
      punto_de_venta_id: SUCURSAL,
      quantity: stockQuantity,
      available: stockAvailable,
    }];
    mockSaleItem.filas = [{
      id: 1, sale_id: 'sale_1738012345', product_id: 501, quantity: itemQuantity,
    }];
  }

  const anular = () => request(levantarApi()).put('/api/sales/sale_1738012345/void');

  it('NO concatena cuando el driver devuelve la cantidad como texto', async () => {
    // El caso que manda de la funcionalidad: stock en 10,25 —lo que quedó
    // después de vender 0,250 sobre 10,5— y una línea de 0,250. Tiene que
    // volver a **exactamente 10,5**, y la aserción es de igualdad exacta y no
    // un `toBeLessThan`: revertida, la línea da la cadena «10.25000.2500».
    sembrar({ stockQuantity: '10.2500', stockAvailable: '10.2500', itemQuantity: '0.2500' });

    const res = await anular();

    expect(res.status).toBe(200);
    expect(mockStock.filas[0].quantity).toBe(10.5);
    expect(mockStock.filas[0].available).toBe(10.5);
    expect(mockStock.filas[0].quantity).not.toBe('10.25000.2500');
  });

  it('el caso que un revisor deja pasar: 100 + 3 escribe «100.00003», que es creíble', async () => {
    // Con la línea entera el resultado de concatenar **sí** es un número, y
    // encima parecido: 100,00003 en vez de 103. Ninguna restricción lo rechaza
    // y ningún log lo nombra; se ve tres meses después en un recuento físico.
    sembrar({ stockQuantity: '100.0000', stockAvailable: '100.0000', itemQuantity: 3 });

    const res = await anular();

    expect(res.status).toBe(200);
    expect(mockStock.filas[0].quantity).toBe(103);
    expect(mockStock.filas[0].available).toBe(103);
  });

  it('el movimiento de inventario registra el valor nuevo ya sumado', async () => {
    // `cantidad_nueva` es lo que después lee la auditoría de stock. Si la
    // reposición concatena, el movimiento deja asentada la concatenación.
    sembrar({ stockQuantity: '10.2500', stockAvailable: '10.2500', itemQuantity: '0.2500' });

    await anular();

    expect(mockStockMovement.filas).toHaveLength(1);
    expect(mockStockMovement.filas[0]).toMatchObject({
      tipo: 'sale_void',
      product_id: 501,
      punto_de_venta_id: SUCURSAL,
      cantidad_anterior: '10.2500',
      cantidad_nueva: 10.5,
      disponible_nuevo: 10.5,
    });
  });

  it('la venta queda anulada y la transacción se confirma', async () => {
    // Sin esto, los tres casos de arriba pasarían con un endpoint que responde
    // 200 y no hace nada.
    sembrar({ stockQuantity: '10.2500', stockAvailable: '10.2500', itemQuantity: '0.2500' });

    await anular();

    expect(mockSale.filas[0].status).toBe('voided');
    expect(mockTransaccion.commits).toBe(1);
    expect(mockTransaccion.rollbacks).toBe(0);
  });
});

// ════════════════════════════════════════════
//  La puerta de POST /api/sales
//
//  `sales.js:321-323` validaba `l.quantity <= 0` sobre el valor de JavaScript,
//  donde `0.4` es mayor que cero y **pasa**. La columna es `INTEGER`, así que
//  Postgres redondeaba al asignar y la venta quedaba asentada con cantidad
//  CERO: se descontaba cero de stock, el importe quedaba intacto y la respuesta
//  era un 201. **Eso pasa hoy, en producción.**
//
//  Migrar la columna no lo arregla: lo corre un escalón. Con `DECIMAL(14,4)` el
//  que se guardaría en cero pasa a ser `0.00004`, o sea el mismo defecto con
//  cuatro ceros más. Lo que estaba mal era aceptar lo que la columna no puede
//  representar.
//
//  ⚠ Lo que este bloque NO puede afirmar es que **no quedó ninguna fila**: los
//  dobles no tienen transacción de verdad, así que el rollback de la ruta no
//  borra nada. Acá se ve que el handler corta antes de escribir; que la base
//  quede como estaba es de `integracion/cantidadesDecimales.integracion.test.js`.
// ════════════════════════════════════════════

describe('POST /api/sales rechaza la cantidad que la columna no puede guardar', () => {
  beforeEach(() => {
    sembrarParaVender();
  });

  it('NO guarda 0,4 como una línea de venta en cero', async () => {
    const res = await vender(0.4);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'ITEM_INVALIDO' });

    // Corta antes de escribir: ni la venta, ni la línea, ni el movimiento, y el
    // stock sigue en 20. Con la validación vieja esto respondía 201 y dejaba una
    // línea en cero que descontaba cero de inventario.
    expect(mockSale.filas).toEqual([]);
    expect(mockSaleItem.filas).toEqual([]);
    expect(mockStockMovement.filas).toEqual([]);
    expect(mockStock.filas[0].quantity).toBe(20);
    expect(mockTransaccion.commits).toBe(0);
    expect(mockTransaccion.rollbacks).toBe(1);
  });

  it('el mensaje escribe «cantidad 0,4» y no «cantidad 0.4»', async () => {
    // El rechazo lo lee quien está cobrando. La cantidad pasa por
    // `textoDeCantidadRecibida`, que la escribe con coma y sin la escala de la
    // columna: un «0.4000» adentro de un mensaje al usuario sería el mismo
    // defecto de presentación que esta funcionalidad viene a evitar.
    const res = await vender(0.4);

    expect(res.body.message).toContain('"Creatina 300g"');
    expect(res.body.message).toContain('cantidad 0,4');
    expect(res.body.message).not.toContain('0.4');
  });

  it('NO le contesta «cantidad 0» a quien mandó 0,00004', async () => {
    // ⚠ Este caso es el ÚNICO que separa las dos funciones de texto, y por eso
    // existe: para 0,4 las dos contestan «0,4» y un test escrito solo con ese
    // valor pasa con `textoDeCantidad` y con `textoDeCantidadRecibida` por
    // igual — o sea que no afirma nada sobre cuál se usa.
    //
    // `textoDeCantidad` redondea a 3 decimales porque describe cantidades
    // reales; acá se describe lo que el cliente escribió, que justamente es
    // inválido. Con aquella, el rechazo decía «cantidad 0» y mandaba a
    // corregir un cero que nadie había mandado.
    //
    // Hoy la puerta solo acepta enteros y este valor no llega desde ninguna
    // pantalla. En la 017, con la constante en 3, pasa a ser exactamente el
    // caso que la regla nueva existe para atajar.
    const res = await vender(0.00004);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('cantidad 0,00004');
    // La salida con el defecto puesto, entera: `textoDeCantidad` deja «0» y la
    // frase sigue con el precio. Se nombra completa porque «cantidad 0,» es
    // subcadena del texto CORRECTO y no distinguiría nada.
    expect(res.body.message).not.toContain('cantidad 0, precio');
  });

  it('999999999999999 da 400 con un mensaje legible y no un 500 de Postgres', async () => {
    // Por encima de lo que entra en `DECIMAL(14,4)` el motor responde «numeric
    // field overflow», que es un 500 con nombres de columna adentro. Se rechaza
    // antes. Con la validación vieja este ticket pasaba la puerta y salía por
    // otra rama entera —el control de stock—, así que el código del error es lo
    // que distingue las dos.
    const res = await vender(999999999999999);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ITEM_INVALIDO');
    expect(mockSale.filas).toEqual([]);
  });

  it('el rechazo NO nombra la tabla, la columna ni la restricción (FR-021)', async () => {
    const res = await vender(0.4);
    const respuesta = JSON.stringify(res.body).toLowerCase();

    for (const filtracion of ['sale_items', 'quantity', 'numeric', 'decimal', 'constraint', 'column', 'overflow']) {
      expect(respuesta).not.toContain(filtracion);
    }
  });

  it.each([
    ['cero', 0],
    ['negativa', -5],
    ['«tres»', 'tres'],
  ])('la cantidad %s se sigue rechazando, con la misma forma de respuesta', async (_, cantidad) => {
    // US3.2, US3.3 y US3.4: los tres se rechazaban antes y se tienen que seguir
    // rechazando **igual**. Si la forma de la respuesta hubiera cambiado, esto
    // es lo que lo diría.
    const res = await vender(cantidad);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'ITEM_INVALIDO' });
    expect(mockSale.filas).toEqual([]);
  });

  it('la cantidad negativa —el defecto viejo— responde EXACTAMENTE el mismo texto', async () => {
    // Una cantidad negativa pasaba el control de stock y después hacía
    // `quantity - (-5)`: SUMABA inventario. El texto de ese rechazo está en
    // `contracts/api-endpoints.md` y no cambia con esta funcionalidad.
    const res = await vender(-5);

    expect(res.body.message)
      .toBe('El item "Creatina 300g" tiene cantidad o precio inválidos (cantidad -5, precio 1200).');
  });

  it('un precio negativo se sigue rechazando: la otra mitad de la condición', async () => {
    // La validación mira la cantidad **y** el precio. Sin este caso, cambiar la
    // condición podría llevarse puesta la mitad del precio sin que nada avise.
    const res = await vender(3, {
      items: [{ product_id: PRODUCTO, product_name: 'Creatina 300g', quantity: 3, unit_price: -1 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ITEM_INVALIDO');
  });

  it('una venta normal de 3 unidades se registra igual que antes', async () => {
    // Sin este caso, una validación que rechaza siempre pasaría todos los de
    // arriba y dejaría el punto de venta sin poder cobrar. Se afirman el total,
    // el descuento de stock y el movimiento: los tres que US3.6 nombra.
    const res = await vender(3, { total: 3600 });

    expect(res.status).toBe(201);
    expect(mockSale.filas).toHaveLength(1);
    expect(mockSale.filas[0]).toMatchObject({
      id: 'sale_1738099999',
      empresa_id: EMPRESA,
      punto_de_venta_id: SUCURSAL,
      total: 3600,
      status: 'active',
    });
    expect(mockSaleItem.filas).toHaveLength(1);
    expect(mockSaleItem.filas[0]).toMatchObject({ quantity: 3, unit_price: 1200 });
    expect(mockStock.filas[0].quantity).toBe(17);
    expect(mockStock.filas[0].available).toBe(17);
    expect(mockStockMovement.filas).toHaveLength(1);
    expect(mockStockMovement.filas[0]).toMatchObject({
      tipo: 'sale',
      cantidad_anterior: 20,
      cantidad_nueva: 17,
    });
    expect(mockTransaccion.commits).toBe(1);
  });
});

// ════════════════════════════════════════════
//  El aviso de stock insuficiente al vender
//
//  `sales.js:548` interpolaba `${stock.available}` crudo. Con la columna en
//  `DECIMAL` el driver entrega «5.0000» y el operador —que está con el cliente
//  enfrente— lee «disponible 5.0000». Es el punto 8 de los diez donde una
//  cantidad se dibuja, y el único de los dos que vive en el servidor junto con
//  el de la transferencia.
// ════════════════════════════════════════════

describe('El aviso de stock insuficiente al vender dice «disponible 5», no «disponible 5.0000»', () => {
  it('NO escribe la escala de la columna adentro del mensaje', async () => {
    sembrarParaVender({ quantity: '5.0000', available: '5.0000' });

    const res = await vender(8);

    expect(res.status).toBe(400);
    expect(res.body.error)
      .toBe('Stock insuficiente para "Creatina 300g": disponible 5, requerido 8');
    expect(res.body.error).not.toContain('5.0000');
  });

  it('una cantidad fraccionaria se escribe con coma: «disponible 9,6»', async () => {
    // El caso del insumo que pasó por producción: 9,6 y no 9.6, que es el punto
    // decimal de otro idioma en una frase en castellano.
    sembrarParaVender({ quantity: '9.6000', available: '9.6000' });

    const res = await vender(10);

    expect(res.body.error)
      .toBe('Stock insuficiente para "Creatina 300g": disponible 9,6, requerido 10');
  });

  it('el catch sigue reconociendo el error por el texto y responde 400, no 500', async () => {
    // `sales.js` distingue esta condición con
    // `err.message.startsWith('Stock insuficiente')`: no hay código de error que
    // la separe. Si el mensaje dejara de empezar así, el aviso saldría por
    // `fallo()` como un 500 «Error al registrar la venta» y el operador no se
    // enteraría de que lo que falta es mercadería. Leerlo en el fuente no
    // alcanza: acá se ejecuta.
    sembrarParaVender({ quantity: '5.0000', available: '5.0000' });

    const res = await vender(8);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Stock insuficiente/);
    expect(res.body.ok).toBe(false);
    expect(mockTransaccion.commits).toBe(0);
    expect(mockTransaccion.rollbacks).toBe(1);
  });

  it('con stock suficiente el aviso no aparece y la venta se registra', async () => {
    // El control: sin esto, un handler que respondiera 400 siempre pasaría los
    // tres casos de arriba.
    sembrarParaVender({ quantity: '20.0000', available: '20.0000' });

    const res = await vender(3, { total: 3600 });

    expect(res.status).toBe(201);
    expect(mockStockMovement.filas).toHaveLength(1);
  });
});
