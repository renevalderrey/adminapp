const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  «Buscá, y si no está creálo» — la carrera que devuelve 500 en una LECTURA
//
//  ── El molde ──
//
//    let x = await Modelo.findOne({ where: { ... } });
//    if (!x) x = await Modelo.create({ ... });
//
//  Se lee bien y funciona el 99 % de las veces. Falla cuando **dos pedidos
//  llegan juntos**: los dos hacen el `findOne`, los dos no encuentran nada, y
//  los dos crean. El segundo choca con el UNIQUE y el endpoint responde **500**.
//
//  Lo que lo hace peor que un 500 cualquiera es DÓNDE pasa: siempre es la
//  PRIMERA vez. Una fila que se autocrea solo existe una vez por empresa o por
//  usuario, así que la carrera es imposible después — y el único momento en que
//  se puede dar es el estreno.
//
//  ── Los dos que había, y cómo aparecieron ──
//
//   · `services/taxService.js` → `getConfig`. Un GET —una LECTURA— devolviendo
//     error de servidor. No lo encontró una lectura del código: apareció en el
//     log de la API mientras corrían las pruebas de navegador del hito 9, la
//     primera vez que se abrió `/impuestos` contra una base limpia. El
//     `useEffect` de React en desarrollo corre dos veces y eso alcanzó.
//
//     ⚠ Y `updateConfig`, dos funciones más abajo del MISMO archivo, ya usaba
//     `findOrCreate`. La corrección estaba escrita al lado del defecto.
//
//   · `middleware/auth.js`. Éste es peor: es el **primer ingreso de alguien
//     nuevo**, y el navegador no manda un pedido sino varios juntos —el
//     contexto de la empresa, los permisos, la suscripción—. Dos de ellos
//     alcanzan para que la aplicación **no abra**, en el único momento que no
//     se puede reintentar sin que la persona piense que el sistema no anda.
//
//     Se encontró buscando el molde del primero. No estaba en ninguna lista.
//
//  ── Por qué una guardia estática y no un test de carrera ──
//
//  Porque una carrera se reproduce cuando se reproduce. Un test que dispare dos
//  llamadas y espere el choque pasa en verde el día que el planificador las
//  ordena distinto, y entonces informa «no hay carrera» sobre un código que sí
//  la tiene. Lo que sí se puede afirmar siempre es que **el molde no está**.
// ════════════════════════════════════════════

const RAIZ = path.join(__dirname, '..');

/**
 * Los archivos del servidor, bajando por las carpetas.
 *
 * ⚠ Recursivo. Una guardia que lee un solo nivel pasa en verde para siempre el
 * día que alguien crea `services/afip/`, y no avisa: informa cero hallazgos
 * sobre cero archivos mirados.
 */
function archivosDelServidor(dir = RAIZ, acumulado = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);

    if (entrada.isDirectory()) {
      // `tests/` y `migrations/` quedan afuera: un test que documenta el molde
      // no puede hacer fallar la guardia, y una migración corre sola.
      if (entrada.name === 'tests' || entrada.name === 'migrations') continue;
      archivosDelServidor(ruta, acumulado);
      continue;
    }

    if (entrada.name.endsWith('.js')) acumulado.push(ruta);
  }

  return acumulado;
}

/** El texto sin comentarios, conservando los saltos para no correr las líneas. */
function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * Lo que se sabe que NO es una carrera, con el motivo.
 *
 * ⚠ Es una lista de EXCEPCIONES ANOTADAS, no de permisos. Cada entrada dice por
 * qué ese `create` no compite con nada. Agregar una sin motivo es cómo una
 * guardia se convierte en decoración.
 */
const NO_SON_CARRERAS = [
  {
    archivo: 'routes/tiendanube.js',
    motivo:
      'el `if (!enElCatalogo)` LANZA un error de negocio; no crea la fila que buscó. '
      + 'El `create` de abajo es de otra tabla (el mapeo) y tiene su propio manejo del UNIQUE.',
  },
  {
    archivo: 'services/tiendanubeSincronizacion.js',
    motivo:
      'crea una CORRIDA nueva a propósito: cada reconciliación es una fila distinta, '
      + 'así que dos simultáneas tienen que dar dos filas y no una.',
  },
];

const ARCHIVOS = archivosDelServidor().map((ruta) => ({
  nombre: path.relative(RAIZ, ruta).split(path.sep).join('/'),
  contenido: fs.readFileSync(ruta, 'utf8'),
}));

/** Los `findOne` seguidos, dentro de la misma función, de un `create` bajo `if (!x)`. */
function moldesDeCarrera({ nombre, contenido }) {
  const lineas = sinComentarios(contenido).split('\n');
  const hallazgos = [];

  lineas.forEach((linea, i) => {
    if (!/\.findOne\(/.test(linea)) return;

    // La ventana: catorce líneas alcanzan para el `where` de varias líneas, el
    // `if` y el `create`. Más que eso empieza a cruzar funciones.
    const ventana = lineas.slice(i, i + 14).join('\n');

    if (!/if \(!\w+\)/.test(ventana)) return;
    if (!/\.create\(/.test(ventana)) return;

    hallazgos.push(`${nombre}:${i + 1}`);
  });

  return hallazgos;
}

describe('Nada se crea con «buscá, y si no está creálo»', () => {
  const exceptuados = NO_SON_CARRERAS.map((e) => e.archivo);

  const carreras = ARCHIVOS
    .filter(({ nombre }) => !exceptuados.includes(nombre))
    .flatMap(moldesDeCarrera);

  it('ningún archivo usa `findOne` + `create` donde va `findOrCreate`', () => {
    expect(carreras).toEqual([]);
  });

  it('la guardia miró de verdad: hay archivos y hay `findOrCreate`', () => {
    // Ancla. Cero hallazgos se lee igual que «no encontré ningún archivo», y así
    // es como estas guardias se quedan verdes para siempre.
    expect(ARCHIVOS.length).toBeGreaterThan(40);

    const conFindOrCreate = ARCHIVOS.filter(({ contenido }) => /findOrCreate\(/.test(contenido));
    expect(conFindOrCreate.length).toBeGreaterThan(2);
  });

  it('los dos que se corrigieron usan `findOrCreate`', () => {
    // Enumerados y no contados: una cuenta pasa igual si alguien revierte uno y
    // otro archivo empieza a usarlo.
    for (const nombre of ['services/taxService.js', 'middleware/auth.js']) {
      const archivo = ARCHIVOS.find((a) => a.nombre === nombre);

      // ⚠ `expect` de Jest NO acepta el mensaje como segundo argumento —eso es
      // de vitest, que es lo que usa la web—. Sin este comentario, el proximo
      // que copie una guardia de `apps/web` se come el mismo error.
      expect(ARCHIVOS.map((a) => a.nombre)).toContain(nombre);
      expect(archivo.contenido).toMatch(/findOrCreate\(/);
    }
  });

  it('cada excepción dice por qué NO es una carrera', () => {
    // Una lista de excepciones sin motivo es una lista de permisos, y lo que
    // sigue es que alguien agregue la suya.
    for (const { archivo, motivo } of NO_SON_CARRERAS) {
      expect(ARCHIVOS.some((a) => a.nombre === archivo)).toBe(true);
      expect(motivo.length).toBeGreaterThan(40);
    }
  });

  it('la muestra sintética del molde SÍ da hallazgo', () => {
    // Sin esto, un detector que dejó de detectar pasa las cuatro de arriba: la
    // primera porque no encuentra, las otras porque miran otra cosa.
    const malo = {
      nombre: 'muestra.js',
      contenido: [
        'async function traer(id) {',
        '  let fila = await Modelo.findOne({ where: { id } });',
        '  if (!fila) {',
        '    fila = await Modelo.create({ id });',
        '  }',
        '  return fila;',
        '}',
      ].join('\n'),
    };

    const bueno = {
      nombre: 'muestra.js',
      contenido: [
        'async function traer(id) {',
        '  const [fila] = await Modelo.findOrCreate({ where: { id }, defaults: { id } });',
        '  return fila;',
        '}',
      ].join('\n'),
    };

    expect(moldesDeCarrera(malo)).toHaveLength(1);
    expect(moldesDeCarrera(bueno)).toEqual([]);
  });
});
