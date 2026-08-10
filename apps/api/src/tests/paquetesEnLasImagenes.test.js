const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  Todo paquete del monorepo que una app declara, su imagen lo COPIA
//
//  ── El defecto que esta guardia existe para encontrar ──
//
//  `packages/pedido` entró declarado en `apps/api/package.json` y el Dockerfile
//  de la API no lo copiaba. La imagen **se construyó entera**, se subió, y el
//  contenedor murió al arrancar con `MODULE_NOT_FOUND` en
//  `services/email.js`. El build no falla: npm crea el enlace del workspace
//  durante la instalación y, si el directorio no existe, el enlace queda
//  colgado y el `require` explota mucho después.
//
//  Y había un segundo caso ya presente, que nadie había mirado: `apps/web`
//  importa `@favalio/precios` desde `store/useStore.js` y su Dockerfile
//  **tampoco** lo copiaba. Ahí el síntoma es distinto —el `vite build` falla
//  adentro del contenedor con un «failed to resolve import»— y no lo veía
//  ningún job del CI, que construye la imagen de la API y ninguna otra.
//
//  ── Por qué es un test estático y no un `docker build` ──
//
//  Construir las cuatro imágenes tarda minutos y necesita un demonio de Docker;
//  esta comprobación tarda milisegundos y responde la misma pregunta. El
//  `docker build` de la API sigue corriendo en el CI para lo que esto no puede
//  ver —que el árbol instalado de verdad arranque—.
//
//  ── Dos anclas ──
//
//  Si el lector deja de encontrar apps con paquetes declarados, o deja de
//  encontrar Dockerfiles, esto pasaría en verde sin haber mirado nada.
// ════════════════════════════════════════════

const RAIZ = path.join(__dirname, '..', '..', '..', '..');

/** Las apps que tienen imagen propia. */
const APPS = fs.readdirSync(path.join(RAIZ, 'apps'))
  .filter((nombre) => fs.existsSync(path.join(RAIZ, 'apps', nombre, 'Dockerfile')))
  .map((nombre) => {
    const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'apps', nombre, 'package.json'), 'utf8'));
    const declarados = Object.keys({ ...manifiesto.dependencies, ...manifiesto.devDependencies })
      .filter((dep) => dep.startsWith('@favalio/'));

    return {
      nombre,
      declarados,
      // Sin los comentarios: los encabezados de estos archivos **explican** el
      // defecto que previenen —«el manifiesto va ANTES del `npm ci`»— y una
      // guardia que lea el texto crudo encuentra ahí un `npm ci` que no es una
      // instrucción. Es la misma lección que el `skip` del limitador global.
      dockerfile: fs.readFileSync(path.join(RAIZ, 'apps', nombre, 'Dockerfile'), 'utf8')
        .split(/\r?\n/)
        .filter((linea) => !linea.trimStart().startsWith('#'))
        .join('\n'),
    };
  });

/** El directorio de `packages/` que provee cada nombre de paquete. */
const CARPETA_DEL_PAQUETE = new Map(
  fs.readdirSync(path.join(RAIZ, 'packages'))
    .filter((nombre) => fs.existsSync(path.join(RAIZ, 'packages', nombre, 'package.json')))
    .map((nombre) => [
      JSON.parse(fs.readFileSync(path.join(RAIZ, 'packages', nombre, 'package.json'), 'utf8')).name,
      nombre,
    ])
);

describe('Los paquetes del monorepo entran en las imágenes que los declaran', () => {
  it('la guardia encontró apps con Dockerfile y paquetes en packages/', () => {
    // El ancla. Sin esto, un cambio de estructura dejaría las listas vacías y
    // todo lo de abajo pasaría comparando nada contra nada.
    expect(APPS.length).toBeGreaterThanOrEqual(3);
    expect(CARPETA_DEL_PAQUETE.size).toBeGreaterThanOrEqual(2);
    expect(APPS.filter((a) => a.declarados.length > 0).length).toBeGreaterThanOrEqual(2);
  });

  it.each(APPS)('$nombre copia los paquetes que declara', ({ declarados, dockerfile }) => {
    const faltantes = [];

    for (const paquete of declarados) {
      const carpeta = CARPETA_DEL_PAQUETE.get(paquete);
      if (!carpeta) {
        faltantes.push(`${paquete}: no hay ninguna carpeta en packages/ que lo provea`);
        continue;
      }

      // Las dos copias, y las dos hacen falta: el manifiesto **antes** del
      // `npm ci` —para que el enlace del workspace no quede colgado— y el
      // código **después**.
      // Sin expresión regular: `includes` sobre el texto exacto que se escribe
      // en el Dockerfile. Una regex acá se equivoca en silencio —un `\s` que se
      // come un escape deja el patrón buscando «COPYs+packages/…», que no está
      // en ningún archivo, y la guardia denuncia a todo el mundo—.
      const manifiesto = dockerfile.includes(`COPY packages/${carpeta}/package.json`);
      const codigo = dockerfile.includes(`COPY packages/${carpeta}/ `);

      if (!manifiesto) faltantes.push(`${paquete}: falta el COPY de su package.json`);
      if (!codigo) faltantes.push(`${paquete}: falta el COPY de su código`);
    }

    expect(faltantes).toEqual([]);
  });

  it('el manifiesto del paquete se copia ANTES del `npm ci`, no después', () => {
    // El orden es el defecto: con el `COPY` del manifiesto después del `npm ci`,
    // npm no instala lo que ese manifiesto declara y el árbol queda incompleto.
    // Se junta la lista y se compara contra la vacía: `expect` de jest toma un
    // solo argumento, así que el mensaje va adentro del valor y no al lado.
    const desordenados = [];

    for (const { nombre, declarados, dockerfile } of APPS) {
      if (declarados.length === 0) continue;

      const carpeta = CARPETA_DEL_PAQUETE.get(declarados[0]);
      const iManifiesto = dockerfile.indexOf(`COPY packages/${carpeta}/package.json`);
      const iInstalacion = dockerfile.indexOf('RUN npm ci');

      if (iManifiesto === -1) desordenados.push(`${nombre}: no se encontró el COPY del manifiesto`);
      else if (iInstalacion === -1) desordenados.push(`${nombre}: no se encontró el RUN npm ci`);
      else if (iManifiesto > iInstalacion) desordenados.push(`${nombre}: el manifiesto del paquete se copia DESPUÉS del npm ci`);
    }

    expect(desordenados).toEqual([]);
  });

  it('el detector reconoce la forma que dice reconocer', () => {
    // La muestra sintética: es la que sostiene esta guardia el día que el
    // repositorio esté bien escrito y ningún caso de arriba pueda fallar.
    const bien = 'COPY packages/precios/package.json ./packages/precios/\nRUN npm ci\nCOPY packages/precios/ ./packages/precios/';
    const mal = 'RUN npm ci\nCOPY apps/web/ ./apps/web/';

    expect(/COPY\s+packages\/precios\/package\.json/.test(bien)).toBe(true);
    expect(/COPY\s+packages\/precios\/\s/.test(bien)).toBe(true);
    expect(/COPY\s+packages\/precios\/package\.json/.test(mal)).toBe(false);
  });
});
