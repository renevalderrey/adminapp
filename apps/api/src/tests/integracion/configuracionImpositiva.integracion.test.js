// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const { sembrarDosEmpresas } = require('./fixtures');
const taxService = require('../../services/taxService');

// ════════════════════════════════════════════
//  Un GET que devolvía 500 la primera vez que dos pedidos llegaban juntos
//
//  ── El defecto ──
//
//  `taxService.getConfig` hacía `findOne` y, si no encontraba nada, `create`.
//  Con los dos pasos separados, **dos llamadas que llegan juntas hacen las dos
//  el `findOne`, las dos no encuentran nada, y las dos intentan crear**: la
//  segunda choca con el UNIQUE de `(empresa_id, tax_type)` y el endpoint que la
//  llama responde 500.
//
//  Es un GET. Una LECTURA devolviendo un error de servidor.
//
//  ── Cómo apareció ──
//
//  No lo encontró una lectura del código: apareció en el log de la API mientras
//  corrían las pruebas de navegador del hito 9, la primera vez que se abrió
//  `/impuestos` contra una base limpia. El `useEffect` de React en desarrollo
//  corre dos veces y eso alcanzó. En producción alcanza con dos pestañas, o con
//  un doble clic en el menú.
//
//  ⚠ Y `updateConfig`, dos funciones más abajo en el mismo archivo, ya usaba
//  `findOrCreate`. **La corrección estaba escrita al lado del defecto** — que es
//  la forma exacta en que aparecieron los tres peores hallazgos de este hito.
//
//  ── Por qué contra el SERVICIO y no contra la ruta ──
//
//  Porque `/api/taxes` está detrás de `requireSuperadmin` —es una pantalla que
//  todavía no se liberó a los clientes— así que un `request(app).get(...)` con
//  el usuario de la fixture come un 403 y nunca llega al defecto. La carrera
//  vive en el servicio; el gate de la ruta es otra cosa y ya tiene su prueba.
//
//  ── Y por qué de integración y no unitario ──
//
//  Porque lo que falla es el UNIQUE de Postgres. Los dobles de
//  `tests/helpers/modelosFalsos.js` no tienen índices: contra ellos las dos
//  creaciones funcionan y el test pasa con y sin la corrección.
// ════════════════════════════════════════════

const { TaxConfig } = modelos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  await sembrarDosEmpresas();
});

afterAll(async () => {
  await cerrar();
});

describe('La configuración impositiva se crea sola, una sola vez', () => {
  it('la primera lectura la crea con los valores por defecto', async () => {
    const config = await taxService.getConfig('monotributo', 1);

    expect(config.tax_type).toBe('monotributo');
    // Las escalas por defecto: sin ellas la pantalla no puede calcular nada.
    expect(Array.isArray(config.config.scales)).toBe(true);
    expect(config.config.scales.length).toBeGreaterThan(0);
  });

  it('dos lecturas SIMULTÁNEAS no rompen, y crean UNA sola fila', async () => {
    // ⚠ Las dos salen juntas, sin `await` en el medio. Con un `await` entre
    // ellas la primera ya creó la fila y la segunda la encuentra: el test
    // pasaría con y sin la corrección, que es exactamente lo que hace que este
    // defecto sobreviva a una suite entera.
    const [uno, dos] = await Promise.all([
      taxService.getConfig('monotributo', 1),
      taxService.getConfig('monotributo', 1),
    ]);

    expect(uno.id).toBe(dos.id);

    const filas = await TaxConfig.count({ where: { tax_type: 'monotributo', empresa_id: 1 } });
    expect(filas).toBe(1);
  });

  it('cinco simultáneas tampoco', async () => {
    // Dos es el caso del `useEffect` que corre dos veces. Cinco es el de un
    // navegador que reintenta, o el de alguien que abre el menú varias veces
    // mientras la primera respuesta viaja.
    const configs = await Promise.all(
      Array.from({ length: 5 }, () => taxService.getConfig('iva', 1))
    );

    expect(new Set(configs.map((c) => c.id)).size).toBe(1);

    const filas = await TaxConfig.count({ where: { tax_type: 'iva', empresa_id: 1 } });
    expect(filas).toBe(1);
  });

  it('el tipo que NO es monotributo arranca con una alícuota en cero', async () => {
    // La otra rama del valor por defecto. Sin este caso, una corrección que
    // creara siempre las escalas del monotributo pasaría todo lo de arriba.
    const config = await taxService.getConfig('iva', 1);

    expect(config.config).toEqual({ rate: 0 });
  });

  it('la segunda lectura devuelve la MISMA fila, no una nueva', async () => {
    // El caso de todos los días, y el que un `findOrCreate` mal escrito rompe:
    // con `defaults` en el lugar equivocado se crearía una fila por lectura.
    const primera = await taxService.getConfig('monotributo', 1);
    const segunda = await taxService.getConfig('monotributo', 1);

    expect(segunda.id).toBe(primera.id);
    expect(await TaxConfig.count({ where: { empresa_id: 1 } })).toBe(1);
  });

  it('cada empresa tiene la suya: crearla para una no se la crea a la otra', async () => {
    // Si el UNIQUE fuera solo por `tax_type`, la segunda empresa leería la
    // configuración de la primera — y en impuestos eso son los números de otro
    // CUIT.
    await taxService.getConfig('monotributo', 1);

    expect(await TaxConfig.count({ where: { empresa_id: 2 } })).toBe(0);

    await taxService.getConfig('monotributo', 2);

    expect(await TaxConfig.count({ where: { empresa_id: 1 } })).toBe(1);
    expect(await TaxConfig.count({ where: { empresa_id: 2 } })).toBe(1);
  });
});
