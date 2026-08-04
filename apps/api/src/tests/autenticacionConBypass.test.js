// ════════════════════════════════════════════
//  El bypass de autenticacion no puede exigir Auth0
//
//  `server.js:28` saltea la validacion de AUTH0_DOMAIN y AUTH0_AUDIENCE cuando
//  BYPASS_AUTH esta activo: el servidor declara ahi que con bypass esas
//  variables no hacen falta. `middleware/auth.js` las exigia igual, un nivel mas
//  abajo, porque construia `auth({...})` al importarse y esa llamada valida su
//  configuracion en el constructor.
//
//  El sintoma no nombra ni a Auth0 ni al bypass: un ERR_ASSERTION
//  «An 'audience' is required to validate the 'aud' claim» que mata el proceso
//  apenas se carga el modulo.
//
//  Mordio dos veces. La primera en `server.test.js`, que se arreglo poniendo
//  valores ficticios en `tests/setup.js` — o sea, en el borde. La segunda en el
//  job de pruebas de navegador de CI, que levanta la API con BYPASS_AUTH y sin
//  .env: noventa segundos de espera y el mismo error. Estos casos fijan el
//  arreglo del medio para que no haya una tercera.
// ════════════════════════════════════════════

describe('El bypass de autenticacion no puede exigir Auth0', () => {
  const entornoOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...entornoOriginal };
    jest.resetModules();
  });

  /**
   * Borra las variables de Auth0 **y** desactiva dotenv.
   *
   * Sin lo segundo el caso es una mentira que depende de la maquina:
   * `middleware/auth.js` llama a `require('dotenv').config()`, que vuelve a
   * poner AUTH0_DOMAIN y AUTH0_AUDIENCE desde `apps/api/.env`. En la maquina de
   * quien desarrolla ese archivo existe y las variables reaparecen; en CI no
   * existe y no reaparecen. O sea: el mismo test daba distinto en cada lado, que
   * es justo el modo de falla que este archivo viene a cerrar.
   */
  function sinAuth0() {
    jest.resetModules();
    jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
    delete process.env.AUTH0_AUDIENCE;
    delete process.env.AUTH0_DOMAIN;
  }

  it('NO revienta al importarse con BYPASS_AUTH y sin AUTH0_AUDIENCE', () => {
    sinAuth0();
    process.env.BYPASS_AUTH = 'true';

    // El require es la mitad del caso: el error del que se protege ocurre al
    // cargar el modulo, no al usarlo.
    expect(() => require('../middleware/auth')).not.toThrow();
  });

  it('SIN bypass sigue exigiendolas, que es lo correcto en produccion', () => {
    sinAuth0();
    delete process.env.BYPASS_AUTH;

    // Una API que arranca sin poder validar tokens es peor que una que no
    // arranca: el constructor tiene que seguir siendo ansioso fuera del bypass.
    // Si esto dejara de fallar, el bypass estaria decidiendose en otro lado.
    expect(() => require('../middleware/auth')).toThrow(/audience/i);
  });

  it('el checkJwt del bypass NIEGA en vez de dejar pasar', () => {
    sinAuth0();
    process.env.BYPASS_AUTH = 'true';

    const { checkJwt } = require('../middleware/auth');

    // Con bypass, `server.js:314` no usa checkJwt: la cadena es otra, asi que
    // esta funcion no se llama nunca. Justamente por eso niega — si algun dia
    // alguien la mete en una cadena que corre con bypass, un `next()`
    // autenticaria a cualquiera en silencio y nada lo mostraria.
    const siguiente = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    checkJwt({}, res, siguiente);

    expect(siguiente).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
