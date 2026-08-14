// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { USUARIO_DE_LA_SESION } = require('./fixtures');

// ════════════════════════════════════════════
//  Una cuenta nueva no puede terminar con cuatro empresas
//
//  ── Lo que pasó ──
//
//  `POST /api/empresas/onboarding` creaba una empresa cada vez que se lo
//  llamaba, sin mirar si el usuario ya tenía una. Del lado del navegador, el
//  formulario llamaba a `loadEmpresaContext()` al terminar, esa función salía
//  sin recargar nada —el usuario ya estaba cargado—, `empresaActiva` seguía en
//  null, `App.jsx` seguía rindiendo `<Onboarding />` para toda ruta, y el botón
//  se volvía a habilitar. Cuatro clics, cuatro empresas, con su punto de venta
//  y su suscripción cada una.
//
//  ── Por qué el test vive acá y no en el navegador ──
//
//  Porque la garantía es del servidor. Un test del formulario probaría que el
//  botón se deshabilita, que es cierto y no alcanza: la ruta la vuelven a
//  llamar un reintento de la red, un F5, una segunda pestaña y cualquier
//  cliente futuro. Lo que hay que sostener es «dos llamadas no son dos
//  empresas», y eso sólo se puede afirmar del lado de la API.
//
//  ── Por qué también en paralelo ──
//
//  Es el mismo motivo que `idempotenciaDeVentas.integracion.test.js`. Con dos
//  llamadas seguidas, la segunda encuentra la empresa que la primera ya
//  commiteó y alcanza con el `findOne`. Dos clics rápidos son otra cosa: los
//  dos requests leen «no tiene empresa» antes de que ninguno escriba. Esa
//  carrera la cierra el `pg_advisory_xact_lock`, y un test secuencial no la
//  ejercita nunca — o sea que el día que alguien saque el lock «porque el
//  findOne ya chequea», el test seguiría en verde.
//
//  Y no se puede escribir con los dobles de `modelosFalsos.js`: no entienden
//  transacciones ni advisory locks, así que no hay carrera posible. Un test
//  sobre ellos probaría el doble.
// ════════════════════════════════════════════

const { Empresa, Usuario, UsuarioEmpresa, PuntoDeVenta, Suscripcion } = modelos;

/** Cuántos requests idénticos se disparan a la vez. */
//
// Cuatro, que es lo que pasó en producción.
const EN_PARALELO = 4;

/** El cuerpo que manda el formulario. */
const DATOS = {
  name: 'Panadería del Centro',
  cuit: '30111111118',
  phone: '1145678900',
  address: 'Av. Corrientes 1234',
  city: 'Buenos Aires',
  state: 'CABA',
  pv_name: 'Sucursal Principal',
};

const onboarding = () => request(app).post('/api/empresas/onboarding').send(DATOS);

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();

  // Un usuario SIN empresa, que es el estado del que acaba de registrarse. No
  // se usa `sembrarDosEmpresas()` a propósito: ese fixture le da una empresa al
  // usuario de la sesión, y entonces no habría onboarding que probar.
  await Usuario.create({
    auth0_sub: USUARIO_DE_LA_SESION,
    email: 'recien-llegado@favalio.com',
    nombre: 'Recién llegado',
  });
});

afterAll(async () => {
  await cerrar();
});

describe('POST /api/empresas/onboarding es idempotente', () => {
  it('la primera llamada crea la empresa, el punto de venta y la suscripción', async () => {
    const res = await onboarding();

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.empresa.name).toBe(DATOS.name);

    expect(await Empresa.count()).toBe(1);
    expect(await PuntoDeVenta.count()).toBe(1);
    expect(await Suscripcion.count()).toBe(1);
    expect(await UsuarioEmpresa.count()).toBe(1);
  });

  it('la segunda llamada NO crea una segunda empresa', async () => {
    const primera = await onboarding();
    const segunda = await onboarding();

    expect(await Empresa.count()).toBe(1);

    // Y lo que cuelga de ella tampoco se duplica: una empresa con dos
    // suscripciones es una cuenta que no se sabe cuándo vence.
    expect(await PuntoDeVenta.count()).toBe(1);
    expect(await Suscripcion.count()).toBe(1);
    expect(await UsuarioEmpresa.count()).toBe(1);

    // 200 y no 201: no se creó nada. Pero `ok:true` y la misma empresa, porque
    // para el que llama el resultado es el mismo —«tu empresa está creada,
    // seguí»— y un error sobre una cuenta que quedó perfecta es peor que nada.
    expect(segunda.status).toBe(200);
    expect(segunda.body.ok).toBe(true);
    expect(segunda.body.data.empresa.id).toBe(primera.body.data.empresa.id);
  });

  it('cuatro clics en paralelo tampoco son cuatro empresas', async () => {
    // El caso real: el botón se rehabilitaba y la persona clickeaba de nuevo
    // antes de que la anterior terminara.
    const respuestas = await Promise.all(
      Array.from({ length: EN_PARALELO }, () => onboarding())
    );

    expect(await Empresa.count()).toBe(1);
    expect(await PuntoDeVenta.count()).toBe(1);
    expect(await Suscripcion.count()).toBe(1);
    expect(await UsuarioEmpresa.count()).toBe(1);

    // Ninguna falla: las cuatro son respuestas útiles. Exactamente una creó.
    const creadas = respuestas.filter((r) => r.status === 201);
    const repetidas = respuestas.filter((r) => r.status === 200);

    expect(creadas).toHaveLength(1);
    expect(repetidas).toHaveLength(EN_PARALELO - 1);

    // Y todas apuntan a la misma empresa: si dos respondieran ids distintos,
    // dos pestañas quedarían operando sobre empresas diferentes.
    const ids = new Set(respuestas.map((r) => r.body?.data?.empresa?.id));
    expect(ids.size).toBe(1);
  });

  it('el usuario queda como admin de la empresa que existe, una sola vez', async () => {
    await onboarding();
    await onboarding();

    const membresias = await UsuarioEmpresa.findAll();

    expect(membresias).toHaveLength(1);
    expect(membresias[0].role).toBe('admin');
    expect(membresias[0].is_default).toBe(true);
  });
});

describe('POST /api/empresas/onboarding sigue validando', () => {
  it('sin nombre no crea nada', async () => {
    const res = await request(app)
      .post('/api/empresas/onboarding')
      .send({ ...DATOS, name: '' });

    expect(res.status).toBe(400);
    expect(await Empresa.count()).toBe(0);
  });

  it('sin teléfono no crea nada', async () => {
    const res = await request(app)
      .post('/api/empresas/onboarding')
      .send({ ...DATOS, phone: '' });

    expect(res.status).toBe(400);
    expect(await Empresa.count()).toBe(0);
  });
});
