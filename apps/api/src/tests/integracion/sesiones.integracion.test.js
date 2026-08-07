// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, sequelize, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');
const { capturarConsultas, contra } = require('./espiaDeConsultas');
const sesionesService = require('../../services/sesionesService');

// ════════════════════════════════════════════
//  Las sesiones, ejecutadas contra Postgres
//
//  ── Por qué este archivo es de integración y no de dobles ──
//
//  Porque las tres garantías del corte 8 dependen del motor y de ninguna otra
//  cosa:
//
//   1. **Que dos requests simultáneos del mismo navegador creen UNA sola fila.**
//      Lo sostiene `uq_sesion_dispositivo`, y `tests/helpers/modelosFalsos.js` no
//      entiende restricciones únicas: lo dice su propio encabezado. Un test
//      secuencial tampoco la toca — los dos requests tienen que estar en vuelo a
//      la vez para que uno choque.
//   2. **Cuánto cuesta el middleware.** Corre en TODOS los requests y el plan
//      compró «+1 consulta». Un 20 % que nadie mide se convierte en un 60 % con
//      un `include` que alguien agrega; lo que no cambia de máquina a máquina es
//      la CANTIDAD, y por eso se mide con `capturarConsultas` y no con el reloj.
//   3. **El aislamiento ejecutado.** `sesiones` no tiene `empresa_id`: el filtro
//      es un `IN` contra la membresía. Una guardia estática ve que se llamó a
//      `sesionesDeLaEmpresa`; solo esto ve que la fila ajena siguió abierta.
//
//  ── ⚠ Cómo se hace que el middleware SE ACTIVE acá adentro ──
//
//  `tests/setup.js:13` fuerza `BYPASS_AUTH = 'true'` para las dos suites, así que
//  **ningún request de ningún test lleva `Authorization`** — y la primera regla de
//  `registrarSesion` es «sin `Authorization`, seguí sin tocar nada». Escrito
//  ingenuamente, el conteo mediría CERO consultas nuevas y este archivo pasaría en
//  verde con el middleware desconectado.
//
//  Lo que lo enciende es mandar la cabecera a mano: `.set('Authorization', …)`. La
//  cadena de bypass **no la mira** (`server.js` clava el usuario `test-user-id` y
//  la empresa 1), así que el request sigue resolviendo la empresa 1 y
//  `registrarSesion` sí corre. Los otros ~1400 tests no la mandan y no se enteran
//  de nada, que es exactamente lo que compra la regla 1.
//
//  ── Cómo están elegidas las fixtures ──
//
//  · **Tres dispositivos del mismo usuario**, no dos: con dos, «cerrar todas menos
//    ésta» cierra una sola y no se distingue de «cerrar la primera que encuentre».
//  · **La sesión ajena es de `usuarioB`, que es miembro SOLO de la empresa B.** Con
//    `BYPASS_AUTH` la sesión es siempre la empresa 1, así que «la B no puede cerrar
//    una de la A» se arma al revés: se pide cerrar una de B **desde** A.
//  · **Un miembro que nunca entró**, para que `ultimo_acceso: null` tenga contra qué
//    distinguirse de una fecha.
//  · **`vista_en` retrasado diez minutos** en un caso: sin él, la ventana de cinco
//    minutos nunca se cruza y «se refresca cuando corresponde» no se ejercita — el
//    test diría lo mismo con la ventana puesta en un siglo.
// ════════════════════════════════════════════

const { Sesion, Usuario, UsuarioEmpresa } = modelos;

/** Los tres dispositivos del usuario de la sesión. */
const ESTE = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const TERCERO = '33333333-3333-4333-8333-333333333333';

/**
 * Un identificador MÁS LARGO que la columna, que es `VARCHAR(64)`.
 *
 * El UUID lo elige el cliente y el servidor no lo interpreta: nada impide que
 * mande 96 caracteres. `middleware/registrarSesion.js` recorta a 64 antes de
 * escribir —si no, el INSERT reventaría en el camino de todos los requests— y
 * `routes/empresas.js` comparaba el valor **crudo**. Con los 36 caracteres de un
 * UUID normal el recorte no hace nada y las dos mitades coinciden por
 * casualidad: por eso este caso necesita un identificador largo, y por eso el
 * defecto no lo veía ninguno de los tests de arriba.
 */
const LARGUISIMO = `${ESTE}-con-una-cola-que-lo-empuja-mas-alla-de-los-64-de-la-columna`;

/** Lo que de ese identificador queda guardado en la fila. */
const RECORTADO = LARGUISIMO.slice(0, 64);

/** Un token de mentira: la cadena de bypass no lo mira, solo tiene que estar. */
const TOKEN = 'Bearer da-igual-lo-que-diga';

/**
 * Un GET barato y estable, para medir el costo del middleware.
 *
 * La comparación es del MISMO endpoint consigo mismo: sin `Authorization` el
 * middleware no hace nada (regla 1) y con `Authorization` + `X-Sesion-Id` hace
 * su consulta. Todo lo demás —el bypass, los permisos, la sucursal por
 * defecto— es idéntico en las dos corridas, así que la diferencia es
 * exactamente lo que cuesta esto.
 */
const RUTA = '/api/empresas/1/puntos-de-venta';

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

/** Un GET con la sesión encendida. */
const pedir = (dispositivo, ruta = RUTA) =>
  request(app).get(ruta).set('Authorization', TOKEN).set('X-Sesion-Id', dispositivo);

// ════════════════════════════════════════════
//  T1395 · la carrera del alta
// ════════════════════════════════════════════

describe('dos requests simultáneos del mismo navegador crean UNA sola sesión', () => {
  it('las dos llamadas en paralelo resuelven y queda una fila', async () => {
    // ⚠ Se llama al servicio y no al endpoint a propósito, y es la diferencia
    // entre un test que ve el defecto y uno que no: `registrarSesion` atrapa
    // cualquier error y deja pasar el request (falla abierto), así que por HTTP
    // sacar el `catch` del `SequelizeUniqueConstraintError` daría **el mismo
    // 200 y la misma fila única** — el test pasaría con el defecto puesto.
    //
    // Acá el rechazo llega hasta el `Promise.all` y se ve.
    const [uno, dos] = await Promise.all([
      sesionesService.registrar({ usuarioId: datos.usuarioA.id, dispositivo: ESTE, ip: '1.1.1.1' }),
      sesionesService.registrar({ usuarioId: datos.usuarioA.id, dispositivo: ESTE, ip: '1.1.1.1' }),
    ]);

    expect(await Sesion.count({ where: { usuario_id: datos.usuarioA.id } })).toBe(1);

    // Y las dos tienen que hablar de la MISMA fila: el que perdió releyó la del
    // que ganó, no se quedó con `null`. Sin esto, un `catch` que devolviera
    // `{ sesion: null }` pasaría el conteo de arriba.
    expect(uno.sesion.id).toBe(dos.sesion.id);
    expect(uno.cerrada).toBe(false);
    expect(dos.cerrada).toBe(false);
  });

  it('dos requests HTTP en vuelo a la vez tampoco duplican la fila', async () => {
    // La misma garantía por el camino real, que es el que ocurre: el Panel
    // dispara varios pedidos al montar y los primeros dos entran los dos por
    // «esta sesión no existe».
    const [a, b] = await Promise.all([pedir(ESTE), pedir(ESTE)]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await Sesion.count({ where: { dispositivo: ESTE } })).toBe(1);
  });
});

// ════════════════════════════════════════════
//  T1396 · lo que cuesta correr en todos los requests
// ════════════════════════════════════════════

describe('el middleware cuesta UNA consulta, y está anclado', () => {
  it('un GET representativo pasa de N a N+1 consultas, no a N+4', async () => {
    // Primero se calienta: la primera vez que este dispositivo aparece hay
    // SELECT + INSERT, que es +2 y ocurre una vez por navegador en su vida.
    await pedir(ESTE);

    const { consultas: sinSesion } = await capturarConsultas(sequelize, () =>
      request(app).get(RUTA)
    );

    const { consultas: conSesion } = await capturarConsultas(sequelize, () => pedir(ESTE));

    // El ancla se lee en las dos direcciones: el número de abajo tiene que ser
    // exactamente uno más. Un `toBeLessThan(sinSesion.length + 4)` dejaría pasar
    // que alguien meta un `include` y pase a costar tres.
    expect(conSesion.length).toBe(sinSesion.length + 1);

    // Y la consulta de más tiene que ser la de `sesiones`: sin esto, el número
    // podría cerrar por casualidad porque otra cosa hizo una consulta menos.
    expect(contra(sinSesion, 'sesiones')).toHaveLength(0);
    expect(contra(conSesion, 'sesiones')).toHaveLength(1);
  });

  it('el mismo request dos veces seguidas NO escribe vista_en', async () => {
    // FR-124. Sin la ventana de cinco minutos, cada lectura del sistema sería
    // también una escritura sobre la tabla que más se lee: una caja hace decenas
    // de requests por venta.
    await pedir(ESTE);

    const { consultas } = await capturarConsultas(sequelize, async () => {
      await pedir(ESTE);
      await pedir(ESTE);
    });

    const escrituras = contra(consultas, 'sesiones').filter((sql) => /^UPDATE/i.test(sql.trim()));

    expect(escrituras).toHaveLength(0);
  });

  it('pasados los cinco minutos sí lo escribe, UNA vez', async () => {
    // La mitad que impide que el caso de arriba pase por vago: una ventana de un
    // siglo —o un `vista_en` que no se actualiza nunca— también daría cero
    // escrituras, y «último acceso» quedaría clavado en el día que esa persona
    // estrenó el navegador.
    await pedir(ESTE);

    const sesion = await Sesion.findOne({ where: { dispositivo: ESTE } });
    const hace10 = new Date(Date.now() - 10 * 60 * 1000);
    await sesion.update({ vista_en: hace10 });

    const { consultas } = await capturarConsultas(sequelize, async () => {
      await pedir(ESTE);
      await pedir(ESTE);
    });

    const escrituras = contra(consultas, 'sesiones').filter((sql) => /^UPDATE/i.test(sql.trim()));

    // Una sola: la primera mueve `vista_en` a ahora y la segunda ya cae adentro
    // de la ventana.
    expect(escrituras).toHaveLength(1);

    await sesion.reload();
    expect(new Date(sesion.vista_en).getTime()).toBeGreaterThan(hace10.getTime());
  });

  it('sin Authorization no toca la tabla: el cron y el webhook no se enteran', async () => {
    const { consultas } = await capturarConsultas(sequelize, () => request(app).get(RUTA));

    expect(contra(consultas, 'sesiones')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════
//  T1397 · listar, cerrar, y el aislamiento ejecutado
// ════════════════════════════════════════════

describe('la lista de sesiones de la empresa', () => {
  it('trae solo las abiertas de los miembros, con el badge de este dispositivo', async () => {
    await pedir(ESTE);
    await pedir(OTRO);

    // Una cerrada, que no tiene que aparecer: una lista de sesiones muertas no
    // contesta ninguna pregunta.
    await Sesion.create({
      usuario_id: datos.usuarioA.id,
      dispositivo: TERCERO,
      cerrada_en: new Date(),
    });

    const res = await pedir(ESTE, '/api/empresas/1/sesiones');

    expect(res.status).toBe(200);

    const dispositivos = res.body.data.map((s) => s.es_este_dispositivo);

    expect(res.body.data).toHaveLength(2);
    expect(dispositivos.filter(Boolean)).toHaveLength(1);
    expect(res.body.data.find((s) => s.es_este_dispositivo).nombre).toBe(datos.usuarioA.nombre);
  });

  it('NO trae las de alguien que no es miembro de esta empresa', async () => {
    // `sesiones` no tiene `empresa_id`: si el filtro por membresía se cayera,
    // esta fila aparecería en la lista de la otra empresa cliente con el nombre
    // y la IP de su dueño.
    await Sesion.create({ usuario_id: datos.usuarioB.id, dispositivo: OTRO, ip: '9.9.9.9' });

    const res = await pedir(ESTE, '/api/empresas/1/sesiones');

    expect(res.body.data.map((s) => s.usuario_id)).not.toContain(datos.usuarioB.id);
  });
});

describe('cerrar una sesión ajena', () => {
  it('la empresa B no puede cerrar una sesión de la A: responde 404', async () => {
    // Armado al revés, porque con `BYPASS_AUTH` la sesión es siempre la empresa
    // 1: se siembra la sesión de alguien que es miembro SOLO de la B y se pide
    // cerrarla desde la A. Un 403 confirmaría que existe; 404 no distingue «no
    // existe» de «no es tuya», que es la misma regla que `findScoped`.
    const ajena = await Sesion.create({ usuario_id: datos.usuarioB.id, dispositivo: OTRO });

    const res = await request(app)
      .delete(`/api/empresas/sesiones/${ajena.id}`)
      .set('Authorization', TOKEN)
      .set('X-Sesion-Id', ESTE);

    expect(res.status).toBe(404);

    // Y lo que de verdad importa: la fila quedó como estaba. Una guardia
    // estática ve que se llamó al servicio; solo esto ve que no se cerró.
    await ajena.reload();
    expect(ajena.cerrada_en).toBeNull();
  });

  it('una sesión cerrada responde 401 en el request siguiente', async () => {
    await pedir(OTRO);

    const propia = await Sesion.findOne({ where: { dispositivo: OTRO } });

    const cierre = await request(app)
      .delete(`/api/empresas/sesiones/${propia.id}`)
      .set('Authorization', TOKEN)
      .set('X-Sesion-Id', ESTE);

    expect(cierre.status).toBe(200);

    // El request siguiente de ESE navegador. Es toda la funcionalidad: sin esto,
    // «cerrar» sería un cartel.
    const despues = await pedir(OTRO);

    expect(despues.status).toBe(401);
    expect(despues.body.error).toBe('SESION_CERRADA');

    // Y queda escrito quién la cerró: sin `cerrada_por`, «me cerraron la sesión»
    // no tiene respuesta.
    await propia.reload();
    expect(propia.cerrada_por).toBe(datos.usuarioA.id);
  });

  it('el otro navegador de la misma persona sigue entrando', async () => {
    // La mitad que impide que el caso de arriba pase con un middleware que
    // cortara a cualquiera: cerrar UN dispositivo no cierra la cuenta.
    await pedir(ESTE);
    await pedir(OTRO);

    const propia = await Sesion.findOne({ where: { dispositivo: OTRO } });

    await request(app)
      .delete(`/api/empresas/sesiones/${propia.id}`)
      .set('Authorization', TOKEN)
      .set('X-Sesion-Id', ESTE);

    expect((await pedir(ESTE)).status).toBe(200);
  });
});

describe('«cerrar todas menos ésta»', () => {
  it('cierra las otras dos y NO la del request', async () => {
    // Con dos dispositivos, «cerró las otras» y «cerró la primera que encontró»
    // dan el mismo resultado. Por eso son tres.
    await pedir(ESTE);
    await pedir(OTRO);
    await pedir(TERCERO);

    const res = await request(app)
      .delete('/api/empresas/sesiones')
      .set('Authorization', TOKEN)
      .set('X-Sesion-Id', ESTE);

    expect(res.status).toBe(200);
    expect(res.body.cerradas).toBe(2);

    // La del request tiene que seguir abierta: si la cerrara, la respuesta
    // llegaría a un navegador que en su próximo request recibe 401.
    const mia = await Sesion.findOne({ where: { dispositivo: ESTE } });
    expect(mia.cerrada_en).toBeNull();
    expect((await pedir(ESTE)).status).toBe(200);

    for (const dispositivo of [OTRO, TERCERO]) {
      const otra = await Sesion.findOne({ where: { dispositivo } });
      expect(otra.cerrada_en).not.toBeNull();
    }
  });

  it('NO toca las sesiones de otra persona, aunque sea de la misma empresa', async () => {
    // Es «las propias». Cerrar las de otro es el otro endpoint, y pide
    // `equipo.editar`.
    const deOtro = await Sesion.create({ usuario_id: datos.usuarioB.id, dispositivo: TERCERO });

    await pedir(ESTE);
    await pedir(OTRO);

    await request(app)
      .delete('/api/empresas/sesiones')
      .set('Authorization', TOKEN)
      .set('X-Sesion-Id', ESTE);

    await deOtro.reload();
    expect(deOtro.cerrada_en).toBeNull();
  });
});

// ════════════════════════════════════════════
//  D4 · el recorte de 64 caracteres, que era asimétrico
//
//  `registrarSesion` recorta a 64 antes de escribir; los dos endpoints que
//  preguntan «¿cuál de estas filas es la mía?» comparaban el valor crudo. Con un
//  identificador más largo que la columna, **ninguna** fila coincidía: el badge
//  «Este dispositivo» no aparecía en ninguna —o sea que quien miraba la lista no
//  tenía forma de saber cuál NO cerrar— y «cerrar todas menos ésta» cerraba
//  también la propia mientras la respuesta decía «Ésta sigue abierta».
//
//  Es de integración porque las dos mitades tienen que ejecutarse: el middleware
//  escribiendo la fila recortada y el endpoint comparando contra ella. Un doble
//  devuelve la fila que le pidan y las dos mitades serían la misma suposición.
// ════════════════════════════════════════════

describe('un identificador más largo que la columna sigue siendo «este dispositivo»', () => {
  it('la fila guardada es la recortada, y la lista la marca a ELLA y a una sola', async () => {
    await pedir(LARGUISIMO);
    await pedir(OTRO);

    // El ancla de la fixture: si esto fallara, el recorte no estaría pasando y
    // el resto del caso no probaría nada.
    const mia = await Sesion.findOne({ where: { dispositivo: RECORTADO } });
    expect(mia).not.toBeNull();
    expect(LARGUISIMO.length).toBeGreaterThan(64);

    const res = await pedir(LARGUISIMO, '/api/empresas/1/sesiones');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const marcadas = res.body.data.filter((s) => s.es_este_dispositivo);

    // Una, y la que corresponde. Antes eran CERO: el badge no aparecía en
    // ninguna fila y las dos se veían igual de cerrables.
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0].id).toBe(mia.id);
  });

  it('«cerrar todas menos ésta» NO cierra ésta, y el navegador sigue entrando', async () => {
    await pedir(LARGUISIMO);
    await pedir(OTRO);
    await pedir(TERCERO);

    const res = await request(app)
      .delete('/api/empresas/sesiones')
      .set('Authorization', TOKEN)
      .set('X-Sesion-Id', LARGUISIMO);

    expect(res.status).toBe(200);

    // Dos, no tres: la propia no entra en «las demás». Antes el `Op.ne` comparaba
    // contra el crudo, así que las tres filas eran «distintas de ésta».
    expect(res.body.cerradas).toBe(2);
    expect(res.body.message).toContain('Ésta sigue abierta');

    const mia = await Sesion.findOne({ where: { dispositivo: RECORTADO } });
    expect(mia.cerrada_en).toBeNull();

    // Y la mitad que se ve desde afuera: sin esto, una respuesta que dice «Ésta
    // sigue abierta» sobre una sesión cerrada pasaría igual. El navegador que
    // apretó el botón recibía 401 en su request siguiente, causado por su propio
    // pedido.
    expect((await pedir(LARGUISIMO)).status).toBe(200);

    for (const dispositivo of [OTRO, TERCERO]) {
      const otra = await Sesion.findOne({ where: { dispositivo } });
      expect(otra.cerrada_en).not.toBeNull();
    }
  });
});

// ════════════════════════════════════════════
//  T1398 · el último acceso en la lista del equipo
// ════════════════════════════════════════════

describe('la lista del equipo dice cuándo entró cada uno', () => {
  it('un miembro que nunca entró manda null, no una fecha vacía', async () => {
    // FR-122. Una cadena vacía o un `0` se dibujan como «Invalid Date» o como el
    // 1/1/1970, y las dos cosas se leen como un dato roto en vez de como «esta
    // persona todavía no entró».
    const res = await request(app).get('/api/empresas/1/usuarios');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].ultimo_acceso).toBeNull();
    expect(res.body.data[0].sesiones_abiertas).toBe(0);
  });

  it('quien entró trae su último acceso y cuántos dispositivos tiene abiertos', async () => {
    await pedir(ESTE);
    await pedir(OTRO);

    // Una cerrada: NO cuenta como abierta, pero su `vista_en` sigue contando
    // para el último acceso — cerrarle la sesión a alguien no puede borrar la
    // prueba de cuándo entró.
    await Sesion.create({
      usuario_id: datos.usuarioA.id,
      dispositivo: TERCERO,
      cerrada_en: new Date(),
    });

    const res = await request(app).get('/api/empresas/1/usuarios');
    const fila = res.body.data[0];

    expect(fila.ultimo_acceso).not.toBeNull();
    expect(Number.isNaN(new Date(fila.ultimo_acceso).getTime())).toBe(false);
    expect(fila.sesiones_abiertas).toBe(2);
  });

  it('veinte miembros no cuestan veinte consultas', async () => {
    // El N+1 se ve solo comparando dos tamaños: con un equipo de uno, una
    // consulta por miembro y una consulta agregada dan exactamente el mismo
    // número.
    const { consultas: conUno } = await capturarConsultas(sequelize, () =>
      request(app).get('/api/empresas/1/usuarios')
    );

    for (let i = 0; i < 19; i++) {
      const usuario = await Usuario.create({
        auth0_sub: `auth0|miembro-${i}`,
        email: `miembro${i}@panaderia.example`,
        nombre: `Miembro ${i}`,
      });

      await UsuarioEmpresa.create({
        usuario_id: usuario.id,
        empresa_id: datos.empresaA.id,
        role: 'vendedor',
        is_active: true,
      });

      // Con sesión, para que la consulta agregada tenga filas que agrupar: sin
      // ellas, un `MAX` por miembro adentro de un bucle podría no ejecutarse.
      await Sesion.create({ usuario_id: usuario.id, dispositivo: `dev-${i}` });
    }

    const { consultas: conVeinte, resultado } = await capturarConsultas(sequelize, () =>
      request(app).get('/api/empresas/1/usuarios')
    );

    expect(resultado.body.data).toHaveLength(20);
    expect(conVeinte.length).toBe(conUno.length);
  });
});
