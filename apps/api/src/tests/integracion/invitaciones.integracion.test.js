// ⚠ `services/email.js` lee RESEND_API_KEY **al importarse**, y `.env` la tiene
// puesta: sin estas dos líneas, `POST /:empresaId/invitar` mandaría un email de
// verdad cada vez que corren los tests. Van ANTES de `baseDePruebas` porque el
// require de ahí abajo arrastra a `server.js`, que arrastra a `email.js`.
//
// No viola la regla del primer require: lo que esa regla protege es que nadie
// importe `config/database` antes, y acá no se importa nada.
const RESEND_ANTERIOR = process.env.RESEND_API_KEY;
const FRONTEND_ANTERIOR = process.env.FRONTEND_URL;

delete process.env.RESEND_API_KEY;
process.env.FRONTEND_URL = 'https://app.adminapp.test';

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

const { Invitacion, Usuario, UsuarioEmpresa } = modelos;

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

  // Se devuelve el entorno como estaba: jest comparte `process.env` entre
  // archivos y dejar el email apagado para los que corren después sería
  // cambiarles el escenario sin decírselo.
  if (RESEND_ANTERIOR === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = RESEND_ANTERIOR;

  if (FRONTEND_ANTERIOR === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = FRONTEND_ANTERIOR;
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

// ════════════════════════════════════════════
//  El equipo, ejecutado (corte 7)
//
//  ── Por qué acá y no con dobles ──
//
//  Tres de las cinco cosas que siguen **no las puede contestar un doble**:
//
//   · que desactivar a alguien y revocar sus invitaciones pasen o no pasen
//     JUNTAS — es una transacción, y `tests/helpers/modelosFalsos.js` dice en su
//     encabezado que no entiende ninguna;
//   · que el `attributes` del `include` recorte de verdad lo que sale POR EL
//     CABLE, que es distinto de lo que devuelve el modelo;
//   · que el `where` del re-envío acote a la empresa: eso es un `SELECT` contra
//     filas de dos empresas, y el doble devuelve lo que le pidan.
//
//  ── El límite de BYPASS_AUTH, y cómo se rodea ──
//
//  La sesión es SIEMPRE `usuarioA`, admin de la empresa 1: `server.js` lo clava.
//  Entonces «degradar al último admin» no se puede armar con el target siendo
//  otra persona **mientras la sesión siga siendo admin**, porque ahí hay dos
//  admins y el último no es ninguno. Se rodea moviendo la membresía de la sesión
//  a otro rol **en la base**: con `BYPASS_AUTH`, `checkPermission` corta antes de
//  mirar permisos, así que la sesión sigue pudiendo llamar al endpoint. Es la
//  única forma de dejar UN solo admin activo que no sea uno mismo.
// ════════════════════════════════════════════

/** Una persona nueva, ya incorporada al equipo de la empresa A. */
async function miembroDeA({ email, nombre, role = 'vendedor', is_active = true }) {
  const usuario = await Usuario.create({
    auth0_sub: `auth0|${email}`,
    email,
    nombre,
  });

  const membresia = await UsuarioEmpresa.create({
    usuario_id: usuario.id,
    empresa_id: datos.empresaA.id,
    role,
    is_active,
  });

  return { usuario, membresia };
}

/** La membresía de quien tiene la sesión, en la empresa A. */
function membresiaDeLaSesion() {
  return UsuarioEmpresa.findOne({
    where: { usuario_id: datos.usuarioA.id, empresa_id: datos.empresaA.id },
  });
}

describe('PUT /api/empresas/usuarios/:id · no se puede dejar la empresa sin admin', () => {
  it('degradar al último admin responde 400 ULTIMO_ADMIN y la empresa sigue teniendo un admin', async () => {
    // La sesión pasa a `vendedor` para que el único admin activo sea otro. Sin
    // esto habría dos admins y el caso no existiría.
    const mia = await membresiaDeLaSesion();
    await mia.update({ role: 'vendedor' });

    const { membresia } = await miembroDeA({
      email: 'unica.admin@panaderia.test',
      nombre: 'Única Admin',
      role: 'admin',
    });

    const res = await request(app)
      .put(`/api/empresas/usuarios/${membresia.id}`)
      .send({ role: 'vendedor' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ULTIMO_ADMIN');
    expect(res.body.message).toContain('único administrador activo');

    // La mitad que importa: el 400 no sirve de nada si la fila igual se guardó.
    await membresia.reload();
    expect(membresia.role).toBe('admin');

    const admins = await UsuarioEmpresa.count({
      where: { empresa_id: datos.empresaA.id, role: 'admin', is_active: true },
    });
    expect(admins).toBe(1);
  });

  it('desactivar al último admin también se rechaza, no solo cambiarle el rol', async () => {
    // Es la otra mitad del mismo agujero: dejar la regla solo sobre `role`
    // permitiría vaciar la empresa de administradores con `is_active: false`.
    const mia = await membresiaDeLaSesion();
    await mia.update({ role: 'vendedor' });

    const { membresia } = await miembroDeA({
      email: 'unica.admin@panaderia.test',
      nombre: 'Única Admin',
      role: 'admin',
    });

    const res = await request(app)
      .put(`/api/empresas/usuarios/${membresia.id}`)
      .send({ is_active: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ULTIMO_ADMIN');

    await membresia.reload();
    expect(membresia.is_active).toBe(true);
  });

  it('con un SEGUNDO admin activo, degradar al primero sí se puede', async () => {
    // Sin este caso, «responde 400» pasaría igual sobre un endpoint que rechaza
    // todo. Y con dos admins ninguno es el último, que es exactamente la regla.
    const mia = await membresiaDeLaSesion();
    await mia.update({ role: 'vendedor' });

    const primero = await miembroDeA({
      email: 'admin.uno@panaderia.test', nombre: 'Admin Uno', role: 'admin',
    });
    await miembroDeA({
      email: 'admin.dos@panaderia.test', nombre: 'Admin Dos', role: 'admin',
    });

    const res = await request(app)
      .put(`/api/empresas/usuarios/${primero.membresia.id}`)
      .send({ role: 'gerente' });

    expect(res.status).toBe(200);

    await primero.membresia.reload();
    expect(primero.membresia.role).toBe('gerente');
  });

  it('un admin DESACTIVADO no cuenta como el segundo', async () => {
    // El caso que un chequeo por `role` a secas dejaría pasar: la empresa tiene
    // dos filas con rol `admin` y una sola persona que puede entrar.
    const mia = await membresiaDeLaSesion();
    await mia.update({ role: 'vendedor' });

    const { membresia } = await miembroDeA({
      email: 'unica.admin@panaderia.test', nombre: 'Única Admin', role: 'admin',
    });
    await miembroDeA({
      email: 'ex.admin@panaderia.test', nombre: 'Ex Admin', role: 'admin', is_active: false,
    });

    const res = await request(app)
      .put(`/api/empresas/usuarios/${membresia.id}`)
      .send({ role: 'vendedor' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ULTIMO_ADMIN');
  });

  it('uno NO se puede cambiar el rol a sí mismo', async () => {
    // Con BYPASS_AUTH la sesión es siempre `usuarioA`, así que el caso se arma
    // pidiendo el cambio sobre su PROPIA membresía.
    const mia = await membresiaDeLaSesion();

    const res = await request(app)
      .put(`/api/empresas/usuarios/${mia.id}`)
      .send({ role: 'vendedor' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NO_TE_PODES_TOCAR');

    await mia.reload();
    expect(mia.role).toBe('admin');
  });

  it('un rol que no está en el catálogo se rechaza, y el 400 dice cuáles valen', async () => {
    // `usuario_empresas.role` es un STRING(20) libre: sin esto, «Vendedor» con
    // mayúscula crea un miembro con CERO permisos y nadie se entera hasta que
    // esa persona no puede hacer nada.
    const { membresia } = await miembroDeA({
      email: 'nuevo@panaderia.test', nombre: 'Nuevo',
    });

    const res = await request(app)
      .put(`/api/empresas/usuarios/${membresia.id}`)
      .send({ role: 'Vendedor' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ROL_INVALIDO');
    expect(res.body.message).toContain('gerente');

    await membresia.reload();
    expect(membresia.role).toBe('vendedor');
  });

  it('no se puede tocar la membresía de otra empresa: 404, no 200', async () => {
    const ajena = await UsuarioEmpresa.findOne({
      where: { usuario_id: datos.usuarioB.id, empresa_id: datos.empresaB.id },
    });

    const res = await request(app)
      .put(`/api/empresas/usuarios/${ajena.id}`)
      .send({ role: 'vendedor' });

    expect(res.status).toBe(404);

    await ajena.reload();
    expect(ajena.role).toBe('admin');
  });
});

describe('desactivar a alguien revoca sus invitaciones pendientes', () => {
  it('un mail viejo no lo devuelve al equipo, y la invitación deja de figurar pendiente', async () => {
    // PENDIENTE N15, y cierra el círculo con T1350: `POST /accept-invite` ya
    // rechaza reactivar a un miembro desactivado, pero la invitación seguía
    // viva y figurando como pendiente en la pantalla del equipo.
    const { membresia } = await miembroDeA({
      email: 'se.fue@panaderia.test', nombre: 'Se Fue',
    });

    const suya = await Invitacion.create({
      empresa_id: datos.empresaA.id,
      email: 'se.fue@panaderia.test',
      role: 'vendedor',
      invited_by: datos.usuarioA.id,
    });

    // Misma dirección, OTRA empresa: revocar de más sería tocar los datos de
    // otro cliente, que es el error que este repositorio ya cometió veinte
    // veces.
    const enOtraEmpresa = await Invitacion.create({
      empresa_id: datos.empresaB.id,
      email: 'se.fue@panaderia.test',
      role: 'vendedor',
      invited_by: datos.usuarioB.id,
    });

    // Y otra dirección en la MISMA empresa: sin ella, un `UPDATE` que se
    // olvidara del filtro por email revocaría todas y el test pasaría igual.
    const deOtraPersona = await Invitacion.create({
      empresa_id: datos.empresaA.id,
      email: 'sigue@panaderia.test',
      role: 'vendedor',
      invited_by: datos.usuarioA.id,
    });

    const res = await request(app)
      .put(`/api/empresas/usuarios/${membresia.id}`)
      .send({ is_active: false });

    expect(res.status).toBe(200);

    await membresia.reload();
    expect(membresia.is_active).toBe(false);

    await suya.reload();
    expect(suya.status).toBe('revoked');

    await enOtraEmpresa.reload();
    expect(enOtraEmpresa.status).toBe('pending');

    await deOtraPersona.reload();
    expect(deOtraPersona.status).toBe('pending');
  });

  it('reactivar a alguien NO revoca nada', async () => {
    // La regla es «al desactivar», no «en cada PUT»: reactivar y de paso
    // revocarle una invitación pendiente sería un efecto que nadie pidió.
    const { membresia } = await miembroDeA({
      email: 'vuelve@panaderia.test', nombre: 'Vuelve', is_active: false,
    });

    const pendiente = await Invitacion.create({
      empresa_id: datos.empresaA.id,
      email: 'vuelve@panaderia.test',
      role: 'vendedor',
      invited_by: datos.usuarioA.id,
    });

    const res = await request(app)
      .put(`/api/empresas/usuarios/${membresia.id}`)
      .send({ is_active: true });

    expect(res.status).toBe(200);

    await pendiente.reload();
    expect(pendiente.status).toBe('pending');
  });
});

describe('GET /api/empresas/:empresaId/usuarios · qué sale por el cable', () => {
  it('NO trae auth0_sub ni es_superadmin', async () => {
    // Se afirma sobre el TEXTO del cuerpo y no sobre el objeto parseado: lo que
    // importa es lo que sale por el cable, y un campo que Sequelize incluye en
    // el JSON está ahí aunque nadie lo lea. `auth0_sub` es el identificador de
    // la persona en Auth0 y `es_superadmin` dice quién es operador de la
    // plataforma; ninguno de los dos lo usa la pantalla.
    await miembroDeA({ email: 'alguien@panaderia.test', nombre: 'Alguien' });

    const res = await request(app).get(`/api/empresas/${datos.empresaA.id}/usuarios`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('auth0_sub');
    expect(res.text).not.toContain('es_superadmin');

    // El ancla: sin esto, una respuesta vacía —o un 500 con cuerpo corto—
    // pasaría las dos negaciones de arriba.
    expect(res.text).toContain('alguien@panaderia.test');
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].usuario.nombre).toBeDefined();
  });

  it('lista también a los DESACTIVADOS, o no habría forma de reactivarlos', async () => {
    // Hasta la 014 el `where` traía `is_active: true`: quien quedaba
    // desactivado desaparecía de la pantalla y no había forma de volver.
    await miembroDeA({ email: 'inactivo@panaderia.test', nombre: 'Inactivo', is_active: false });

    const res = await request(app).get(`/api/empresas/${datos.empresaA.id}/usuarios`);

    const inactivo = res.body.data.find((m) => m.usuario.email === 'inactivo@panaderia.test');

    expect(inactivo).toBeDefined();
    expect(inactivo.is_active).toBe(false);
  });
});

describe('POST /api/empresas/invitaciones/:token/re-enviar · acotado a la empresa', () => {
  it('la empresa A no puede reenviar una invitación de la B: 404, no 200', async () => {
    const ajena = await invitar();

    const res = await request(app).post(`/api/empresas/invitaciones/${ajena.token}/re-enviar`);

    expect(res.status).toBe(404);
  });

  it('y la propia SÍ la encuentra: el 404 de arriba es por la empresa, no porque la ruta esté rota', async () => {
    // El ancla. Sin esto, montar mal la ruta —o romper el `where` entero—
    // devolvería 404 siempre y el caso anterior pasaría por el motivo
    // equivocado.
    //
    // La respuesta es **502** y no 200 a propósito: en este entorno
    // RESEND_API_KEY está borrada, así que el envío falla y el endpoint lo dice
    // en vez de mentir. Lo único que se afirma acá es que la invitación se
    // encontró.
    const propia = await Invitacion.create({
      empresa_id: datos.empresaA.id,
      email: 'invitado@panaderia.test',
      role: 'vendedor',
      invited_by: datos.usuarioA.id,
    });

    const res = await request(app).post(`/api/empresas/invitaciones/${propia.token}/re-enviar`);

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(502);
  });
});

describe('POST /api/empresas/:empresaId/usuarios ya no existe', () => {
  it('incorporar a alguien por auth0_sub, sin invitación, responde 404', async () => {
    // E11 / PENDIENTE N13. El handler creaba el `Usuario` si no existía, le
    // armaba la membresía con el rol que viniera —sin validarlo— y lo
    // reactivaba si estaba desactivado, que es justo la puerta que
    // `POST /accept-invite` cerró. No lo llamaba nadie.
    const antes = await UsuarioEmpresa.count({ where: { empresa_id: datos.empresaA.id } });

    const res = await request(app)
      .post(`/api/empresas/${datos.empresaA.id}/usuarios`)
      .send({ auth0_sub: 'auth0|colado', email: 'colado@example.com', role: 'admin' });

    expect(res.status).toBe(404);

    // Y no creó nada de paso.
    expect(await UsuarioEmpresa.count({ where: { empresa_id: datos.empresaA.id } })).toBe(antes);
    expect(await Usuario.count({ where: { auth0_sub: 'auth0|colado' } })).toBe(0);
  });
});

describe('POST /api/empresas/:empresaId/invitar · el enlace para pasarlo a mano', () => {
  it('cuando el mail no sale, la respuesta trae el enlace con el token', async () => {
    // FR-106. Sin RESEND_API_KEY, `sendEmail` devuelve `{ok:false}` —eso ya está
    // corregido y anclado en `observabilidad.test.js`— y hasta este corte lo
    // único que quedaba era un mensaje: la invitación existía y nadie tenía
    // forma de llegar a ella.
    const res = await request(app)
      .post(`/api/empresas/${datos.empresaA.id}/invitar`)
      .send({ email: 'nuevo.empleado@panaderia.test', role: 'vendedor' });

    expect(res.status).toBe(201);
    expect(res.body.email_enviado).toBe(false);
    expect(res.body.message).toContain('a mano');

    const invitacion = await Invitacion.findOne({
      where: { empresa_id: datos.empresaA.id, email: 'nuevo.empleado@panaderia.test' },
    });

    expect(res.body.enlace).toBe(`https://app.adminapp.test/?invite=${invitacion.token}`);
  });
});
