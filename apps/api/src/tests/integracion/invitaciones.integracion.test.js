// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  La cadena de la invitación, ejecutada
//
//  ── Por qué este archivo es de integración y no de dobles ──
//
//  Porque lo que se afirma es que los dos endpoints **contesten**. El defecto E1
//  no estaba en el handler —el handler está bien desde siempre— sino en cómo
//  `server.js` montaba el router: con `app.get('/api/auth/invite/:token',
//  router)`, un Router resuelve la ruta relativa a su punto de montaje, adentro
//  buscaba `/` y las dos rutas respondían **404 siempre**. Un test con dobles
//  llama al handler y pasa en verde con el montaje roto: no hay servidor, no hay
//  montaje, no hay nada que romper. Es «el único nivel que podía encontrar E1»,
//  y es exactamente por eso que E1 llevaba ahí sin que nadie lo notara.
//
//  ── Y qué NO puede contestar, que hay que decirlo ──
//
//  El **orden** de los montajes. Con `BYPASS_AUTH=true`, `server.js` clava
//  `req.empresaId = 1` y `requireEmpresa` no dispara nunca: los mismos requests
//  de acá abajo pasan igual con `/api/auth` montado debajo del `/api` genérico,
//  que es donde estaba y donde responde 401 o 403 en producción. Eso lo sostiene
//  `tests/montajeDeRouters.test.js`, que es una guardia estática y es la única
//  red. No borrarla creyendo que este archivo la cubre.
//
//  ── Cómo están elegidas las fixtures ──
//
//  - El rol de la invitación es **`compras`**: distinto de `admin` —el que el
//    usuario de la sesión ya tiene en la empresa A— y distinto de `vendedor`,
//    que es el `defaultValue` de la columna. Con `vendedor`, un handler que se
//    olvidara de pasar el rol daría el mismo resultado que uno correcto.
//  - El miembro desactivado tiene rol `vendedor` y su invitación vieja es de
//    `admin`. Con los dos roles iguales, «no se re-promociona» no se podría
//    distinguir de «no se hizo nada».
//  - Las invitaciones se cuelgan de la empresa **B**: la membresía tiene que
//    poder aparecer donde no había ninguna. Contra la empresa A el usuario de la
//    sesión ya es miembro y el `findOrCreate` nunca crearía nada.
// ════════════════════════════════════════════

const { Invitacion, UsuarioEmpresa } = modelos;

/** El email del usuario que `BYPASS_AUTH` pone en la sesión. */
const EMAIL_DE_LA_SESION = 'dev@adminapp.app';

/** Un token que no está en la tabla. */
const TOKEN_INEXISTENTE = 'token-que-no-existe-en-ninguna-fila';

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();
});

afterAll(async () => {
  await cerrar();
});

/** Una invitación a la empresa B para el usuario de la sesión. */
async function invitar(atributos = {}) {
  return Invitacion.create({
    empresa_id: datos.empresaB.id,
    email: EMAIL_DE_LA_SESION,
    role: 'compras',
    token: `token-de-prueba-${Math.random().toString(36).slice(2)}`,
    invited_by: datos.usuarioB.id,
    ...atributos,
  });
}

/** Cuántas membresías tiene el usuario de la sesión en la empresa B. */
function membresiasEnB() {
  return UsuarioEmpresa.count({
    where: { usuario_id: datos.usuarioA.id, empresa_id: datos.empresaB.id },
  });
}

describe('GET /api/auth/invite/:token contesta, y no 404 siempre', () => {
  it('devuelve la empresa y el rol de una invitación válida SIN sesión', async () => {
    // Es el test que se pone en rojo con el montaje de antes: con
    // `app.get('/api/auth/invite/:token', router)` esto responde 404 para
    // cualquier token, válido o no.
    const invitacion = await invitar();

    const res = await request(app).get(`/api/auth/invite/${invitacion.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(EMAIL_DE_LA_SESION);
    expect(res.body.data.empresa.name).toBe(datos.empresaB.name);
    expect(res.body.data.role).toBe('compras');
  });

  it('un token que no existe da 404, y NO 401 ni 403', async () => {
    // El 404 es la respuesta correcta y las otras dos son el síntoma del
    // montaje: 401 si `checkJwt` corrió antes, 403 `NO_EMPRESA` si corrió
    // `requireEmpresa`. Quien abre el enlace del mail no tiene ni sesión ni
    // empresa, así que las dos serían un callejón sin salida.
    const res = await request(app).get(`/api/auth/invite/${TOKEN_INEXISTENTE}`);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('NO devuelve una invitación vencida', async () => {
    const invitacion = await invitar({ expires_at: new Date(Date.now() - 60 * 1000) });

    const res = await request(app).get(`/api/auth/invite/${invitacion.token}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/auth/accept-invite/:token crea la membresía', () => {
  it('crea la membresía con el rol de la invitación y la deja accepted', async () => {
    const invitacion = await invitar();

    const res = await request(app).post(`/api/auth/accept-invite/${invitacion.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.empresa.id).toBe(datos.empresaB.id);

    const membresia = await UsuarioEmpresa.findOne({
      where: { usuario_id: datos.usuarioA.id, empresa_id: datos.empresaB.id },
    });

    expect(membresia).not.toBeNull();
    // `compras`, no `vendedor`: el defaultValue de la columna es `vendedor`, así
    // que sin esta aserción un handler que no pasara el rol pasaría igual.
    expect(membresia.role).toBe('compras');
    expect(membresia.is_active).toBe(true);

    await invitacion.reload();
    expect(invitacion.status).toBe('accepted');
  });
});

describe('un token vencido, uno usado y uno inexistente NO dicen los tres lo mismo', () => {
  // Hasta este hito los tres —y el del email que no coincide— colapsaban en un
  // único `findOne` con las cuatro condiciones en el `where`, y los cuatro
  // recibían el mismo texto: «Invitación no encontrada, expirada o el email no
  // coincide». Los cuatro se arreglan de maneras distintas y quien lo leía no
  // sabía cuál era el suyo (FR-102).

  /** El cuerpo de la respuesta a aceptar cada uno de los cuatro casos. */
  async function respuestas() {
    const vencida = await invitar({ expires_at: new Date(Date.now() - 60 * 1000) });
    const usada = await invitar({ status: 'accepted' });
    const deOtro = await invitar({ email: 'otra.persona@example.com' });

    const pedir = async (token) => {
      const res = await request(app).post(`/api/auth/accept-invite/${token}`);
      return { status: res.status, error: res.body.error, message: res.body.message };
    };

    return {
      inexistente: await pedir(TOKEN_INEXISTENTE),
      vencida: await pedir(vencida.token),
      usada: await pedir(usada.token),
      deOtro: await pedir(deOtro.token),
    };
  }

  it('los cuatro motivos tienen mensajes distintos entre sí', async () => {
    const r = await respuestas();
    const mensajes = [r.inexistente.message, r.vencida.message, r.usada.message, r.deOtro.message];

    expect(new Set(mensajes).size).toBe(4);
    for (const mensaje of mensajes) {
      // Un mensaje vacío también sería «distinto» de los otros tres si los otros
      // tres lo fueran entre sí. Que cada uno diga algo es parte de la
      // afirmación.
      expect(typeof mensaje).toBe('string');
      expect(mensaje.length).toBeGreaterThan(20);
    }
  });

  it('cada motivo trae su propio código, y el del otro email nombra las dos direcciones', async () => {
    const r = await respuestas();

    expect(r.inexistente.error).toBe('INVITACION_INEXISTENTE');
    expect(r.vencida.error).toBe('INVITACION_VENCIDA');
    expect(r.usada.error).toBe('INVITACION_YA_USADA');
    expect(r.deOtro.error).toBe('INVITACION_DE_OTRO_EMAIL');

    expect(r.deOtro.message).toContain('otra.persona@example.com');
    expect(r.deOtro.message).toContain(EMAIL_DE_LA_SESION);
  });

  it('los cuatro son definitivos para el navegador: 404 o 409, nunca un 5xx', async () => {
    // `apps/web/src/utils/invitacion.js` borra el token pendiente con 404 y con
    // 409, y lo CONSERVA con cualquier otra cosa para reintentar. Un motivo
    // permanente devuelto con otro status deja al navegador reintentando para
    // siempre contra una invitación que no va a servir nunca.
    const r = await respuestas();

    for (const caso of [r.inexistente, r.vencida, r.usada, r.deOtro]) {
      expect([404, 409]).toContain(caso.status);
    }
  });

  it('ninguno de los cuatro crea una membresía', async () => {
    // FR-102. Es la mitad que importa: un mensaje distinto sobre una membresía
    // creada igual sería peor que el mensaje único de antes.
    await respuestas();

    expect(await membresiasEnB()).toBe(0);
  });
});

describe('una invitación de hace tres meses NO le devuelve el acceso a alguien a quien se desactivó a propósito', () => {
  // FR-120 / PENDIENTE N15. `auth.js` hacía
  // `ue.update({ is_active: true, role: invitacion.role })` en el `if (!created)`
  // y nada invalida las invitaciones `pending` al desactivar a un miembro: un
  // mail viejo lo reactivaba, y encima con el rol que ese mail trajera.

  /** El miembro desactivado de B, con una invitación vieja de rol más alto. */
  async function desactivadoConInvitacionDeAdmin() {
    const membresia = await UsuarioEmpresa.create({
      usuario_id: datos.usuarioA.id,
      empresa_id: datos.empresaB.id,
      role: 'vendedor',
      is_active: false,
    });

    const invitacion = await invitar({ role: 'admin' });

    return { membresia, invitacion };
  }

  it('la membresía sigue desactivada después de aceptar', async () => {
    const { membresia, invitacion } = await desactivadoConInvitacionDeAdmin();

    const res = await request(app).post(`/api/auth/accept-invite/${invitacion.token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('MIEMBRO_DESACTIVADO');

    await membresia.reload();
    expect(membresia.is_active).toBe(false);
  });

  it('y tampoco se le sube el rol de vendedor a admin', async () => {
    // Los dos roles son distintos a propósito: con la invitación pidiendo
    // `vendedor` —el que la fila ya tiene— este test pasaría con y sin el
    // arreglo.
    const { membresia, invitacion } = await desactivadoConInvitacionDeAdmin();

    await request(app).post(`/api/auth/accept-invite/${invitacion.token}`);

    await membresia.reload();
    expect(membresia.role).toBe('vendedor');
  });

  it('la invitación NO se consume: si mañana lo reactivan, el mismo enlace sirve', async () => {
    const { invitacion } = await desactivadoConInvitacionDeAdmin();

    await request(app).post(`/api/auth/accept-invite/${invitacion.token}`);

    await invitacion.reload();
    expect(invitacion.status).toBe('pending');
  });
});
