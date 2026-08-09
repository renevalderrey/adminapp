const fs = require('fs');
const path = require('path');
const { verificarQueEsDePrueba, URL_POR_DEFECTO } = require('./urlDeLaBaseDePruebas');

// ════════════════════════════════════════════
//  Que el arnés de integración siga corriendo
//
//  ⚠ **Esta guardia corre en la suite RÁPIDA, no con las demás de esta
//  carpeta.** Es a propósito: no toca la base y su nombre no termina en
//  `.integracion.test.js`, que es el sufijo que `npm test` excluye y que
//  `npm run test:integracion` selecciona.
//
//  ── Qué protege ──
//
//  Los tests de integración son lentos y necesitan Postgres, así que viven
//  aparte. Eso resuelve un problema y abre otro: **una suite que corre aparte
//  es una suite que puede dejar de correr sin que nadie lo note.** Es
//  exactamente el modo de falla que este repositorio viene juntando: un
//  `testMatch` que no levantaba nada y pasaba en verde, un `--passWithNoTests`,
//  y dos guardias recorriendo un árbol vacío.
//
//  Los cuatro huecos por los que el arnés se apagaría en silencio:
//
//   1. Que alguien saque el paso de CI. La suite local sigue verde y en el
//      servidor no corre nada.
//   2. Que los dos patrones —el que excluye y el que selecciona— dejen de ser
//      el mismo. Un archivo caería en las dos suites o en ninguna.
//   3. Que se agregue un test de integración con otro nombre: lo levantaría la
//      suite rápida, sin base.
//   4. Que se borren todos los tests de integración y la guardia siga en verde
//      porque no le quedó nada que revisar (el ancla del punto final).
// ════════════════════════════════════════════

const CARPETA = __dirname;
const RAIZ_API = path.join(CARPETA, '..', '..', '..');
const RAIZ_REPO = path.join(RAIZ_API, '..', '..');
const CI = path.join(RAIZ_REPO, '.github', 'workflows', 'ci.yml');

const paquete = JSON.parse(fs.readFileSync(path.join(RAIZ_API, 'package.json'), 'utf8'));

/**
 * El sufijo que separa las dos suites, escrito como aparece en los scripts.
 *
 * Está acá una sola vez y los dos scripts se comparan contra él: si alguien
 * cambia uno y se olvida del otro, esto lo dice.
 */
const PATRON = '\\.integracion\\.test\\.js$';

/** Los `*.test.js` de esta carpeta que NO son tests de integración. */
const NO_SON_DE_INTEGRACION = ['guardiaDelArnes.test.js'];

/** El bloque de un job del workflow, como texto. */
function jobDelWorkflow(nombre) {
  const texto = fs.readFileSync(CI, 'utf8');
  const lineas = texto.split('\n');
  const inicio = lineas.findIndex((l) => l === `  ${nombre}:`);

  if (inicio === -1) return null;

  const resto = lineas.slice(inicio + 1);
  const fin = resto.findIndex((l) => /^ {2}\S/.test(l));

  return (fin === -1 ? resto : resto.slice(0, fin)).join('\n');
}

describe('Las dos suites no se pisan ni se pierden', () => {
  it('`npm test` NO levanta los tests de integración', () => {
    expect(paquete.scripts.test).toContain('--testPathIgnorePatterns');
    expect(paquete.scripts.test).toContain(PATRON);
  });

  it('`npm test` sigue ignorando node_modules', () => {
    // `--testPathIgnorePatterns` en la línea de comandos REEMPLAZA el valor de
    // `jest.config.js`, no lo suma. Sin repetir `/node_modules/`, jest se
    // pondría a recorrer las dependencias.
    expect(paquete.scripts.test).toContain('/node_modules/');
  });

  it('`npm run test:integracion` corre exactamente los que la otra excluye', () => {
    const script = paquete.scripts['test:integracion'];

    expect(script).toBeDefined();
    expect(script).toContain('--testPathPatterns');
    expect(script).toContain(PATRON);
  });

  it('`npm run test:integracion` deja la base migrada ANTES de correr jest', () => {
    const script = paquete.scripts['test:integracion'];

    expect(script).toMatch(/prepararBase\.js\s*&&/);
  });

  it('los tests de integración corren en serie', () => {
    // Comparten una base y cada uno la trunca: en paralelo se borrarían las
    // filas entre ellos.
    expect(paquete.scripts['test:integracion']).toContain('--runInBand');
  });

  it('NINGÚN script que llame a jest se olvida de decidir de qué lado está', () => {
    // `test:watch` y `test:coverage` también levantan jest. Sin el patrón,
    // cualquiera de los dos arrastra los tests de integración a una corrida que
    // no tiene base: se ponen en rojo por el motivo equivocado y el que mira
    // aprende a ignorarlos.
    const conJest = Object.entries(paquete.scripts)
      .filter(([, cmd]) => /(^|\s|&&\s*)jest(\s|$)/.test(cmd));

    expect(conJest.length).toBeGreaterThanOrEqual(4);

    const sinDecidir = conJest
      .filter(([, cmd]) => !cmd.includes(PATRON))
      .map(([nombre]) => nombre);

    expect(sinDecidir).toEqual([]);
  });

  it('hay un comando para levantar la base y otro para bajarla', () => {
    expect(paquete.scripts['test:db:levantar']).toContain('--levantar');
    expect(paquete.scripts['test:db:bajar']).toContain('docker rm');
  });
});

describe('CI corre el arnés, y con una base de verdad', () => {
  it('el job de la API ejecuta test:integracion', () => {
    const job = jobDelWorkflow('api');

    expect(job).not.toBeNull();
    expect(job).toContain('npm run test:integracion');
  });

  it('ese mismo job levanta un servicio de Postgres', () => {
    const job = jobDelWorkflow('api');

    expect(job).toMatch(/image:\s*postgres:/);
  });

  it('la base de CI se llama de una forma que el arnés acepta truncar', () => {
    const job = jobDelWorkflow('api');
    const url = job.match(/DATABASE_URL_TEST:\s*(\S+)/);

    expect(url).not.toBeNull();
    // Si el nombre no dijera «integracion», el arnés cortaría en CI y el paso
    // fallaría con un mensaje sobre truncar bases ajenas.
    expect(() => verificarQueEsDePrueba(url[1])).not.toThrow();
  });
});

describe('El arnés se niega a truncar una base que no es de prueba', () => {
  it('acepta la base descartable del repositorio', () => {
    expect(() => verificarQueEsDePrueba(URL_POR_DEFECTO)).not.toThrow();
  });

  it('RECHAZA una base cuyo nombre no dice que es de prueba', () => {
    // Cada test hace TRUNCATE de todo el esquema. Esta es la única cosa entre
    // un `DATABASE_URL_TEST` mal copiado y los datos de alguien.
    expect(() => verificarQueEsDePrueba('postgresql://u:p@localhost:5432/favalio'))
      .toThrow(/se niega a trabajar/);
  });

  it('RECHAZA algo que no es una URL', () => {
    expect(() => verificarQueEsDePrueba('favalio_test')).toThrow(/no se puede interpretar/);
  });
});

describe('Los archivos de la carpeta', () => {
  const archivos = fs.readdirSync(CARPETA).filter((n) => n.endsWith('.test.js'));

  it('encuentra los tests de integración que dice revisar', () => {
    // Ancla. Sin esto, borrar todos los tests de integración dejaría a esta
    // guardia pasando por vacío — que es como dos guardias de este repositorio
    // dejaron de servir sin que nadie lo notara.
    const deIntegracion = archivos.filter((n) => n.endsWith('.integracion.test.js'));

    expect(deIntegracion.length).toBeGreaterThanOrEqual(4);
  });

  it('todo test de esta carpeta termina en .integracion.test.js', () => {
    const fuera = archivos.filter(
      (n) => !n.endsWith('.integracion.test.js') && !NO_SON_DE_INTEGRACION.includes(n)
    );

    // Un archivo con otro nombre lo levanta la suite RÁPIDA, que corre sin
    // Postgres: fallaría por «no hay base» y no por lo que quería probar.
    expect(fuera).toEqual([]);
  });
});
