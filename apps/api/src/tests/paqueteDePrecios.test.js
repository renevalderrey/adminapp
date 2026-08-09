const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  Guardia estática · la fórmula del precio está escrita UNA sola vez
//
//  ── Qué defecto cierra ──
//
//  Hasta el hito 10, `calcularPrecios` vivía únicamente en
//  `apps/web/src/utils/precios.js`. El servidor **nunca** devolvió un precio de
//  venta: los calculaba el navegador a partir del `cost` crudo que le mandaba
//  `GET /api/products`.
//
//  Eso deja de ser sostenible con el catálogo público, por dos motivos que van
//  juntos: una página pública **no puede recibir el costo de compra** del
//  comercio, y `apps/tienda` es una app distinta que no puede importar de
//  `apps/web`. La salida fácil —copiar la función al servidor, o a la tienda—
//  es exactamente el defecto que este repositorio ya tiene documentado en
//  `apps/web/src/tests/mediosDePago.test.js:46`: tres copias que empezaron
//  iguales y terminaron distintas, y un test que las ata en vez de borrarlas.
//
//  Con la fórmula en un paquete del workspace hay una sola copia de verdad. Lo
//  que esta guardia impide es que vuelva a haber dos.
//
//  ── Por qué cadenas literales y no expresiones regulares ──
//
//  Las tres marcas que se buscan están escritas tal cual aparecen en el código:
//
//      1 + aNumero(margen)     el corazón del cálculo del precio en efectivo
//      MODO_RECARGO = {        la tabla de modos de recargo por tarjeta
//      function calcularPrecios
//
//  Una expresión regular laxa —algo como /calcular\w*Precio/— se pondría en
//  rojo contra una variable que se llama parecido, y una guardia que falla por
//  algo sano es una guardia que alguien afloja el mismo día. Estas tres son
//  literales y no aparecen en ningún otro lado por casualidad.
//
//  ── El ancla, que es la regla que más importa ──
//
//  La regla 4 sola pasa en verde si alguien borra el paquete: no habría copia
//  en `apps/*` porque no habría fórmula en ningún lado. Por eso la regla 5
//  verifica que las tres marcas **estén** dentro de `packages/precios/index.js`.
//  Sin ella, un renombre del paquete dejaría la guardia revisando archivos que
//  no existen y reportando éxito.
//
//  ── Qué se revierte para verla en rojo ──
//
//  Pegar de vuelta `apps/web/src/utils/precios.js`. La reglas 3 y 4 lo nombran.
// ════════════════════════════════════════════

const RAIZ = path.join(__dirname, '..', '..', '..', '..');
const API_SRC = path.join(__dirname, '..');
const WEB_SRC = path.join(__dirname, '..', '..', '..', 'web', 'src');
const PAQUETE = path.join(RAIZ, 'packages', 'precios', 'index.js');

const MARCAS = ['1 + aNumero(margen)', 'MODO_RECARGO = {', 'function calcularPrecios'];

const EXTENSIONES = ['.js', '.jsx'];

/** Todos los archivos de código de un árbol, sin node_modules ni productos de build. */
function archivosDe(raiz) {
  if (!fs.existsSync(raiz)) return [];
  const salida = [];
  for (const entrada of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name === 'dist') continue;
    const completa = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosDe(completa));
    else if (EXTENSIONES.includes(path.extname(entrada.name))) salida.push(completa);
  }
  return salida;
}

const leerJson = (ruta) => JSON.parse(fs.readFileSync(ruta, 'utf8'));

describe('La fórmula del precio vive en un solo lugar', () => {
  // ── Regla 1 ──
  it('la raíz declara los workspaces, y packages/ entre ellos', () => {
    const raiz = leerJson(path.join(RAIZ, 'package.json'));

    expect(Array.isArray(raiz.workspaces)).toBe(true);
    expect(raiz.workspaces).toContain('apps/*');
    // Sin esto el paquete existe en el disco y no existe para npm: el
    // `require('@favalio/precios')` falla recién al arrancar.
    expect(raiz.workspaces).toContain('packages/*');
  });

  // ── Regla 2 ──
  it('la API y la web declaran el paquete como dependencia', () => {
    const api = leerJson(path.join(RAIZ, 'apps', 'api', 'package.json'));
    const web = leerJson(path.join(RAIZ, 'apps', 'web', 'package.json'));

    // Declararlo es lo que hace que npm cree el enlace del workspace. Sin la
    // línea, en la máquina de quien ya lo tenía instalado anda igual, y en un
    // clon limpio o en la imagen de Docker no.
    expect(api.dependencies?.['@favalio/precios']).toBeDefined();
    expect(web.dependencies?.['@favalio/precios']).toBeDefined();
  });

  // ── Regla 3 ──
  it('el archivo viejo de la web ya no existe', () => {
    const viejo = path.join(WEB_SRC, 'utils', 'precios.js');

    expect(fs.existsSync(viejo)).toBe(false);
  });

  // ── Regla 4 ──
  it('ningún archivo de apps/api ni de apps/web tiene la fórmula', () => {
    const hallazgos = [];

    for (const archivo of [...archivosDe(API_SRC), ...archivosDe(WEB_SRC)]) {
      const contenido = fs.readFileSync(archivo, 'utf8');
      for (const marca of MARCAS) {
        // Esta misma guardia nombra las tres marcas: se excluye a sí misma.
        if (archivo === __filename) continue;
        if (contenido.includes(marca)) {
          hallazgos.push(`${path.relative(RAIZ, archivo)} — «${marca}»`);
        }
      }
    }

    expect(hallazgos).toEqual([]);
  });

  // ── Regla 5 · el ancla ──
  it('las tres marcas están en packages/precios/index.js', () => {
    // Sin esto, borrar el paquete pondría la regla 4 en verde: no habría copia
    // en apps/* porque no habría fórmula en ninguna parte.
    expect(fs.existsSync(PAQUETE)).toBe(true);

    const paquete = fs.readFileSync(PAQUETE, 'utf8');
    for (const marca of MARCAS) {
      expect(paquete).toContain(marca);
    }
  });
});
