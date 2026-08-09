const { dispositivoDeUserAgent, DISPOSITIVOS } = require('../utils/dispositivo');

// ════════════════════════════════════════════
//  FAVALIO · La etiqueta del aparato de una sesión
//
//  Va en `src/tests/` y no en `utils/dispositivo.test.js`: el `testMatch` de
//  `jest.config.js` solo levanta `src/tests/**`, así que un test al lado del
//  `utils/` **no lo corre nadie** —no falla, no avisa— y alguien lee el nombre
//  del archivo y da por cubierto lo que jamás se ejecutó.
//
//  ── Qué se está afirmando ──
//
//  No que la detección sea buena: que **nunca rompa y nunca devuelva
//  `undefined`**. Esta función la llama el listado de sesiones fila por fila, y
//  `sesiones.user_agent` es NULLABLE —un cliente puede no mandar la cabecera—.
//  Una sola fila sin user-agent tiene que dar «desconocido», no un 500 en la
//  pantalla de Equipo.
// ════════════════════════════════════════════

describe('un user-agent que no vino no rompe: dice «desconocido»', () => {
  // ⚠ Éste es el caso que sostiene el archivo. Sin la guarda del nulo,
  // `ua.trim()` tira `TypeError: Cannot read properties of null` **adentro del
  // map del listado**, y la respuesta del endpoint pasa a ser un 500 por una
  // fila cuyo navegador no mandó la cabecera.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['cadena vacía', ''],
    ['solo espacios', '   '],
    ['un número, porque el driver puede devolver cualquier cosa', 42],
    ['un objeto', {}],
  ])('%s → desconocido', (_caso, valor) => {
    expect(dispositivoDeUserAgent(valor)).toBe('desconocido');
  });

  it('nunca devuelve undefined, para ninguna entrada', () => {
    // La otra mitad: una función que devolviera `undefined` en el caso raro
    // dibujaría una celda vacía, y una celda vacía no se distingue de «no se
    // miró». Es la misma regla que `tonoDeProveedor`.
    const entradas = [null, undefined, '', 'lo que sea', 'curl/8.4.0', 'Mozilla/5.0'];

    for (const entrada of entradas) {
      expect(Object.values(DISPOSITIVOS)).toContain(dispositivoDeUserAgent(entrada));
    }
  });
});

describe('los de mano se reconocen ANTES que los de escritorio', () => {
  it('un Windows Phone NO es una computadora', () => {
    // El orden de las dos expresiones es la afirmación: `Windows Phone` contiene
    // `Windows`, así que evaluar el escritorio primero convertiría todos los
    // teléfonos con Windows en computadoras. Es el caso que la fixture necesita
    // para poder distinguir el orden — con solo un iPhone y un Windows de
    // escritorio, las dos versiones dan el mismo resultado.
    expect(dispositivoDeUserAgent(
      'Mozilla/5.0 (Mobile; Windows Phone 8.1; Android 4.0; ARM; Trident/7.0) like Gecko'
    )).toBe('celular');
  });

  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'],
    ['Android con Chrome', 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'],
  ])('%s → celular', (_caso, ua) => {
    expect(dispositivoDeUserAgent(ua)).toBe('celular');
  });

  it('un Android con Chrome dice «Linux» y aun así es un celular', () => {
    // Es el mismo cruce que el Windows Phone, del otro lado: el user-agent de
    // Android trae `Linux`, que es una de las señales de escritorio. Sin la
    // precedencia, todos los teléfonos Android serían computadoras — o sea, casi
    // todos los teléfonos.
    expect(dispositivoDeUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36'
    )).toBe('celular');
  });
});

describe('las computadoras, incluida la que no dice ni Windows ni Mac', () => {
  it.each([
    ['Windows 11 con Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'],
    ['Mac con Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15'],
    ['Ubuntu con Firefox', 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0'],
    ['ChromeOS', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'],
  ])('%s → computadora', (_caso, ua) => {
    expect(dispositivoDeUserAgent(ua)).toBe('computadora');
  });
});

describe('lo que no se reconoce se dice, en vez de adivinar', () => {
  it('un curl no se hace pasar por computadora', () => {
    // Decir «computadora» acá sería inventar. La lista muestra «desconocido» y
    // el user-agent crudo al lado, que es lo único que permite reconocerlo a
    // ojo cuando aparece algo que nadie esperaba.
    expect(dispositivoDeUserAgent('curl/8.4.0')).toBe('desconocido');
  });
});
