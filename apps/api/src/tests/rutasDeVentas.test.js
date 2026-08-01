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
const router = require('../routes/sales');

const FUENTE = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sales.js'), 'utf8');

/** El cuerpo del handler que empieza en `marca`, hasta el final del archivo. */
function desde(marca) {
  const i = FUENTE.indexOf(marca);
  expect(i).toBeGreaterThanOrEqual(0);
  return FUENTE.slice(i);
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
