const requireModulo = require('../middleware/requireModulo');

// ════════════════════════════════════════════
//  El gate del módulo · las tres ramas, y por qué cada una es como es
//
//  Las tres decisiones de este middleware son incómodas por separado y
//  coherentes juntas. Los tests existen para que no se «arreglen» de a una:
//
//   1. **Sin lista, pasa.** Un default que abre. Cerrar por ausencia apagaría el
//      sistema entero, porque hoy NINGUNA empresa tiene `enabled_modules`.
//   2. **404 y no 403.** Un 403 confirma que el módulo existe.
//   3. **El dueño entra igual.** Porque `RouteGuard` lo deja entrar, y si los
//      dos lados no dicen lo mismo el resultado es una pantalla que carga y una
//      API que contesta 404 a todo.
// ════════════════════════════════════════════

/** Un `res` mínimo que registra qué se respondió. */
const resFalso = () => {
  const res = { statusCode: null, cuerpo: null };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (c) => { res.cuerpo = c; return res; };
  return res;
};

const correr = (gate, req) => {
  const res = resFalso();
  let siguio = false;
  gate(req, res, () => { siguio = true; });
  return { siguio, res };
};

describe('requireModulo', () => {
  it('una empresa sin enabled_modules entra: cerrar por ausencia apagaría el sistema entero', () => {
    // Es el estado de TODAS las empresas de hoy. Si este caso se pusiera en
    // rojo por «endurecer el default», el primer deploy dejaría a cada cliente
    // sin sus pantallas.
    const { siguio } = correr(requireModulo('catalogo'), { empresaSettings: {}, userId: 'auth0|x' });
    expect(siguio).toBe(true);

    // Ni siquiera `req.empresaSettings`: un request al que el middleware de
    // sesión no le puso nada tampoco se cae.
    expect(correr(requireModulo('catalogo'), { userId: 'auth0|x' }).siguio).toBe(true);
  });

  it('una lista guardada como algo que no es un arreglo también pasa', () => {
    // `settings` es JSONB libre: alguien puede haber guardado una cadena. Eso es
    // «no hay lista», no «lista vacía».
    for (const valor of ['catalogo', 42, {}, null]) {
      const req = { empresaSettings: { enabled_modules: valor }, userId: 'auth0|x' };
      expect(correr(requireModulo('catalogo'), req).siguio).toBe(true);
    }
  });

  it('con el módulo en la lista, entra', () => {
    const req = {
      empresaSettings: { enabled_modules: ['tiendanube', 'catalogo'] },
      userId: 'auth0|x',
    };

    expect(correr(requireModulo('catalogo'), req).siguio).toBe(true);
  });

  it('sin el módulo responde 404 y no 403, que confirmaría que existe', () => {
    const req = {
      empresaSettings: { enabled_modules: ['tiendanube'] },
      userId: 'auth0|x',
      originalUrl: '/api/catalogos',
    };

    const { siguio, res } = correr(requireModulo('catalogo'), req);

    expect(siguio).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.statusCode).not.toBe(403);
    // Y el mensaje no nombra el módulo: decir «el módulo catálogo no está
    // habilitado» es confirmarlo con otras palabras.
    expect(res.cuerpo).toEqual({ ok: false, error: 'No encontrado' });
    expect(JSON.stringify(res.cuerpo)).not.toMatch(/catalogo/i);
  });

  it('una lista vacía cierra: es distinto de no tener lista', () => {
    const req = { empresaSettings: { enabled_modules: [] }, userId: 'auth0|x' };

    expect(correr(requireModulo('catalogo'), req).res.statusCode).toBe(404);
  });

  it('el dueño de la empresa entra aunque el módulo no esté, igual que en RouteGuard', () => {
    // Es el que ata las dos ramas. `App.jsx:59` hace `if (isOwner) return
    // children` ANTES de mirar la lista: sin esta rama acá, el dueño abre la
    // pantalla y recibe 404 en cada llamada.
    const req = {
      empresaSettings: {
        enabled_modules: ['tiendanube'],
        owner_auth0_sub: 'auth0|dueño',
      },
      userId: 'auth0|dueño',
    };

    expect(correr(requireModulo('catalogo'), req).siguio).toBe(true);
  });

  it('otro usuario de la misma empresa NO entra por la puerta del dueño', () => {
    const req = {
      empresaSettings: {
        enabled_modules: ['tiendanube'],
        owner_auth0_sub: 'auth0|dueño',
      },
      userId: 'auth0|vendedora',
    };

    expect(correr(requireModulo('catalogo'), req).res.statusCode).toBe(404);
  });

  it('un owner_auth0_sub vacío no le abre la puerta a un request sin usuario', () => {
    // El caso feo: si la comparación fuera `settings.owner_auth0_sub ===
    // req.userId` a secas, dos `undefined` darían verdadero y CUALQUIERA
    // entraría a una empresa que nunca declaró dueño.
    const req = { empresaSettings: { enabled_modules: ['tiendanube'] } };

    expect(correr(requireModulo('catalogo'), req).res.statusCode).toBe(404);
  });
});
