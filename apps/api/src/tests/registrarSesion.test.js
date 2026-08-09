const fs = require('fs');
const path = require('path');

const registrarSesion = require('../middleware/registrarSesion');

const { GRACIA_HASTA, sinCabecera } = registrarSesion;

// ════════════════════════════════════════════
//  FAVALIO · Las dos cosas de `registrarSesion` que no necesitan Postgres
//
//  Lo que sí lo necesita —que una sesión cerrada corte con 401, que dos requests
//  simultáneos creen UNA fila, y **cuántas consultas cuesta**— vive en
//  `integracion/sesiones.integracion.test.js`: son garantías del motor y un doble
//  no entiende ni restricciones únicas ni conteo de consultas.
//
//  Acá quedan las dos que son de forma:
//
//   1. **El período de gracia**, que es la respuesta a «¿qué pasa con las sesiones
//      abiertas el día del deploy?». Es una decisión con fecha y hay que poder
//      afirmar **los dos lados** sin esperar un mes.
//   2. **Que el corte se revierta quitando UNA línea de `server.js`**. Es un
//      requisito escrito del corte 8 —«es el único cambio del hito que puede
//      dejar la aplicación entera sin funcionar»— y sin guardia se pierde en la
//      primera refactorización que reparta el montaje en las dos cadenas.
// ════════════════════════════════════════════

describe('el período de gracia: el deploy no echa a nadie, y vence solo', () => {
  // El identificador de dispositivo lo genera el **bundle**, y una pestaña
  // abierta sigue corriendo el bundle viejo hasta que alguien la recarga. Con la
  // regla estricta desde el minuto cero, el primer request de cada pestaña
  // abierta responde 401 y el interceptor manda al login: a quien estaba
  // cobrando se le vacía el ticket a medio armar.
  const UN_DIA = 24 * 60 * 60 * 1000;

  it('antes de la fecha, un request sin la cabecera SIGUE', () => {
    expect(sinCabecera(GRACIA_HASTA.getTime() - UN_DIA)).toBe('seguir');
  });

  it('después de la fecha, CORTA', () => {
    // La mitad que impide que la gracia sea permanente. Un período sin fecha
    // apaga la funcionalidad entera: mientras dure, cerrar una sesión no cierra
    // nada porque alcanza con no mandar la cabecera.
    expect(sinCabecera(GRACIA_HASTA.getTime() + UN_DIA)).toBe('cortar');
  });

  it('en el instante exacto ya corta: el borde no queda del lado permisivo', () => {
    // Un `<=` en vez de un `<` haría que el último milisegundo sea gracia. No
    // cambia nada en la práctica y sí cambia qué dice el código: la fecha es
    // «hasta», no «inclusive».
    expect(sinCabecera(GRACIA_HASTA.getTime())).toBe('cortar');
  });

  it('acepta un Date además de un número, porque el llamador pasa Date.now()', () => {
    expect(sinCabecera(new Date(GRACIA_HASTA.getTime() - UN_DIA))).toBe('seguir');
  });

  it('la fecha está escrita en el código y no en una variable de entorno', () => {
    // Una variable de entorno que hay que acordarse de apagar es la que nadie
    // apaga, y además no se ve en ningún diff. Acá la fecha se lee en la
    // revisión y vence sola.
    const fuente = fs.readFileSync(
      path.join(__dirname, '..', 'middleware', 'registrarSesion.js'),
      'utf8'
    );

    expect(fuente).not.toMatch(/process\.env\.\w*GRACIA/);
    expect(GRACIA_HASTA instanceof Date).toBe(true);
    expect(Number.isNaN(GRACIA_HASTA.getTime())).toBe(false);
  });
});

describe('el corte 8 se revierte quitando UNA línea de server.js', () => {
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  /** Las líneas de código, sin las de comentario: el motivo ocupa veinte. */
  const CODIGO = SERVER.split('\n').filter((linea) => {
    const texto = linea.trim();
    return !texto.startsWith('//') && !texto.startsWith('*') && !texto.startsWith('/*');
  });

  it('server.js nombra el middleware exactamente una vez', () => {
    // Es el requisito, no una preferencia de estilo: repartido en las dos
    // cadenas —`authEmpresa` y `authSinEmpresa`— revertir el corte pasarían a
    // ser dos ediciones, y la que se olvide deja media aplicación con sesiones y
    // media sin.
    const menciones = CODIGO.filter((linea) => linea.includes('middleware/registrarSesion'));

    expect(menciones).toHaveLength(1);
  });

  it('esa línea se empuja sobre `authMiddleware`, que es de donde salen las dos cadenas', () => {
    // Así las dos lo heredan sin escribirlo dos veces. Si alguien lo moviera a
    // `authEmpresa`, `POST /api/empresas/onboarding` y aceptar una invitación
    // —que van por `authSinEmpresa`— dejarían de registrar sesión, y el
    // dispositivo con el que alguien entra por primera vez no aparecería en la
    // lista.
    const [linea] = CODIGO.filter((l) => l.includes('middleware/registrarSesion'));

    expect(linea).toMatch(/authMiddleware\.push\(/);
  });

  it('el middleware queda DESPUÉS de loadEmpresaContext: necesita req.usuario', () => {
    // `authMiddleware` termina en `loadEmpresaContext`, que es quien resuelve
    // `req.usuario`. Empujar antes de esa declaración no compila; empujarlo
    // después de que las cadenas ya están armadas no tendría efecto. Lo que se
    // fija es que la línea esté entre las dos.
    const iCadena = SERVER.indexOf('const authMiddleware =');
    const iPush = SERVER.indexOf('authMiddleware.push(');
    const iEmpresa = SERVER.indexOf('const authEmpresa =');

    expect(iCadena).toBeGreaterThan(-1);
    expect(iPush).toBeGreaterThan(iCadena);
    expect(iPush).toBeLessThan(iEmpresa);
  });
});

describe('sin Authorization no toca nada: es lo que hace invisible al middleware', () => {
  // Es la regla 1 y la que compra que el cron, el webhook de TiendaNube y los
  // ~1400 tests con BYPASS_AUTH no se enteren de que esto existe. Se ejercita
  // con un doble porque no hay base de por medio: si el middleware llamara al
  // servicio, la llamada fallaría acá mismo.
  const respuestaFalsa = () => {
    const res = { status: null, cuerpo: null };
    res.status = (codigo) => { res.codigo = codigo; return res; };
    res.json = (cuerpo) => { res.cuerpo = cuerpo; return res; };
    return res;
  };

  it('un request sin cabecera Authorization pasa derecho', async () => {
    const res = respuestaFalsa();
    let siguio = false;

    await registrarSesion({ headers: {}, usuario: { id: 7 } }, res, () => { siguio = true; });

    expect(siguio).toBe(true);
    expect(res.cuerpo).toBeNull();
  });

  it('con token pero sin usuario resuelto tampoco: ahí ya corta requireEmpresa', async () => {
    const res = respuestaFalsa();
    let siguio = false;

    await registrarSesion(
      { headers: { authorization: 'Bearer lo-que-sea' } },
      res,
      () => { siguio = true; }
    );

    expect(siguio).toBe(true);
    expect(res.cuerpo).toBeNull();
  });
});
