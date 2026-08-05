const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  Ningun test de la API puede quedar fuera de la corrida
//
//  `jest.config.js` tiene `testMatch: ['**/__tests__/**/*.test.js',
//  '**/src/tests/**/*.test.js']`. Un archivo `*.test.js` en cualquier otra
//  carpeta de `src/` —`src/utils/`, `src/services/`, al lado de lo que prueba—
//  **jest no lo levanta nunca**: no falla, no avisa, simplemente no existe para
//  la suite.
//
//  Es una confusion facil de cometer y esta escrita en el repositorio:
//  `docs/specs/CONVENCIONES.md` dice, para la web, «funcion pura en `utils/`,
//  test en `utils/*.test.js`». En `apps/web` eso es correcto —vitest levanta
//  todo `src/**`—. En `apps/api` produce un archivo verde que nadie corre, que
//  es peor que no tener el test: alguien lee el nombre del archivo y da por
//  cubierto lo que nunca se ejecuto.
//
//  Aparecio mientras se implementaba la funcionalidad 012: dos tareas pedian
//  `src/utils/centavos.test.js` y `src/utils/recepcionDeOrden.test.js`.
//
//  Si esta guardia falla, hay dos salidas: mover el archivo a `src/tests/`, o
//  ampliar el `testMatch`. Lo que NO vale es agregar la carpeta a la lista de
//  abajo: esa lista es de carpetas que jest SI corre.
// ════════════════════════════════════════════

const RAIZ = path.join(__dirname, '..');

/** Las carpetas que `testMatch` levanta, relativas a `src/`. */
const CARPETAS_QUE_JEST_CORRE = ['tests', '__tests__'];

function archivosDeTest(directorio, encontrados = []) {
  for (const entrada of fs.readdirSync(directorio, { withFileTypes: true })) {
    const completo = path.join(directorio, entrada.name);

    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules') continue;
      archivosDeTest(completo, encontrados);
      continue;
    }

    if (entrada.name.endsWith('.test.js')) {
      encontrados.push(path.relative(RAIZ, completo).split(path.sep).join('/'));
    }
  }

  return encontrados;
}

describe('Ningun test de la API queda fuera de la corrida', () => {
  const todos = archivosDeTest(RAIZ);

  // Ancla. Sin esto, un refactor que mueva `src/tests/` a otro lado dejaria la
  // guardia recorriendo un arbol sin un solo `.test.js` y pasando por vacio —
  // que es exactamente como dos guardias de este repositorio dejaron de servir
  // sin que nadie lo notara.
  it('encuentra los archivos de test que dice revisar', () => {
    expect(todos.length).toBeGreaterThan(30);
    expect(todos).toContain('tests/todosLosTestsCorren.test.js');
  });

  it('NO hay un *.test.js en una carpeta que jest no levanta', () => {
    const huerfanos = todos.filter((relativo) => {
      const primeraCarpeta = relativo.split('/')[0];
      return !CARPETAS_QUE_JEST_CORRE.includes(primeraCarpeta);
    });

    expect(huerfanos).toEqual([]);
  });
});
