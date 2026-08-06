// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, sequelize, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const axios = require('axios');
const { Op } = require('sequelize');
const { sembrarDosEmpresas } = require('./fixtures');
const tiendanubeService = require('../../services/tiendanubeService');
const tiendanubeSincronizacion = require('../../services/tiendanubeSincronizacion');

// ════════════════════════════════════════════
//  TiendaNube · el `state` de un solo uso y la tienda de una sola empresa
//
//  Las dos garantías de este corte son **restricciones de la base**, y ninguna
//  de las dos se puede escribir con los dobles de `helpers/modelosFalsos.js`:
//  no entienden transacciones ni índices únicos, así que no hay dos requests
//  que puedan chocar. Un test escrito sobre ellos probaría el doble.
//
//  ── Por qué hay DOS casos para el mismo `state` ──
//
//  El primero —dos vueltas seguidas— lo pasa cualquier implementación, incluida
//  un `findOne` seguido de un `update`: cuando el segundo callback arranca, el
//  primero ya escribió `consumido_en` y el `findOne` lo ve. El segundo —dos
//  vueltas **en paralelo**— es el que separa las dos formas: los dos pasan por
//  el `findOne` antes de que ninguno escriba, y los dos canjean el `code`.
//
//  Es la misma lección del CAE y la de `POST /api/sales`, y la comprobación es
//  la de siempre: reemplazar el `UPDATE … RETURNING` por un `findOne` + `update`
//  pone el segundo en rojo **mientras el primero sigue en verde**.
//
//  ── Qué NO contesta este archivo ──
//
//  Que el contrato real de TiendaNube funcione. `axios.post` está espiado: lo
//  que se verifica es el circuito de AdminApp —el canje se dispara una vez, el
//  token queda bajo la empresa correcta—, no que TiendaNube conteste eso. Ese es
//  el paso manual P1 y no lo verifica ningún test.
// ════════════════════════════════════════════

const {
  Setting,
  Product,
  Sale,
  Stock,
  TiendanubeTienda,
  TiendanubeEstadoOauth,
  TiendanubeMapping,
  TiendanubeVariante,
  TiendanubeCorrida,
  TiendanubePedido,
} = modelos;

/** El `user_id` que devuelve el canje. Uno solo: es lo que hace chocar el UNIQUE. */
const USER_ID_DE_LA_TIENDA = 7777777;

/** Cuántos callbacks idénticos se disparan a la vez. */
//
// Con dos, la carrera se gana o se pierde según cómo el planificador reparta dos
// promesas y la rama que importa puede no correr nunca. Con seis, los seis leen
// el `state` sin consumir antes de que ninguno haya escrito.
const EN_PARALELO = 6;

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

// ⚠ Las dos variables van acá y no en el entorno de quien corre los tests.
// `GET /status` responde `sin_configurar` sin `TIENDANUBE_CLIENT_ID` —lo cual es
// correcto— y `firmaValida` devuelve false sin el secreto: en una máquina de
// desarrollo con el `.env` cargado estos casos pasan, y en el job de integración
// de CI —que no tiene `.env`— se ponen en rojo por el entorno y no por el código.
// Un test que depende de una variable que nadie declaró es un test que falla en
// el peor momento y por el motivo que menos se sospecha.
const CLIENT_ID_ANTERIOR = process.env.TIENDANUBE_CLIENT_ID;
const CLIENT_SECRET_ANTERIOR = process.env.TIENDANUBE_CLIENT_SECRET;

beforeEach(async () => {
  process.env.TIENDANUBE_CLIENT_ID = '4321';
  process.env.TIENDANUBE_CLIENT_SECRET = 'secreto-de-prueba-de-tiendanube';

  await limpiarLaBase();
  datos = await sembrarDosEmpresas();

  jest.spyOn(axios, 'post').mockResolvedValue({
    data: {
      access_token: 'tn_token_de_prueba_zqxvkwmrupt',
      token_type: 'bearer',
      scope: 'write_products',
      user_id: USER_ID_DE_LA_TIENDA,
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (CLIENT_ID_ANTERIOR === undefined) delete process.env.TIENDANUBE_CLIENT_ID;
  else process.env.TIENDANUBE_CLIENT_ID = CLIENT_ID_ANTERIOR;

  if (CLIENT_SECRET_ANTERIOR === undefined) delete process.env.TIENDANUBE_CLIENT_SECRET;
  else process.env.TIENDANUBE_CLIENT_SECRET = CLIENT_SECRET_ANTERIOR;

  await cerrar();
});

/** Un `state` vivo de la empresa que se pida. */
async function estadoDeOauth(empresaId, token) {
  return TiendanubeEstadoOauth.create({
    token,
    empresa_id: empresaId,
    usuario_id: 'auth0|quien-vincula',
    expira_en: new Date(Date.now() + 10 * 60 * 1000),
  });
}

const callback = (state) =>
  request(app).get('/api/tiendanube/callback').query({ code: 'code-de-tiendanube', state });

/** El `motivo=` de la redirección, o null si volvió por el camino feliz. */
const motivoDe = (res) => new URL(res.headers.location).searchParams.get('motivo');

describe('El `state` del OAuth se consume UNA sola vez', () => {
  beforeEach(async () => {
    // La empresa A ya tiene tienda en la fixture: se desvincula a mano para que
    // el flujo pueda correr de punta a punta sobre ella. Sin esto, `/auth`
    // respondería 409 y el callback chocaría contra la PK.
    await TiendanubeTienda.destroy({ where: { empresa_id: datos.empresaA.id } });
  });

  it('un state consumido dos veces resuelve UNA sola vez', async () => {
    const state = await estadoDeOauth(datos.empresaA.id, 'a'.repeat(64));

    const primero = await callback(state.token);
    const segundo = await callback(state.token);

    expect(motivoDe(primero)).toBeNull();
    expect(motivoDe(segundo)).toBe('state_invalido');

    // El usuario recarga la pestaña de vuelta: sin «de un solo uso», el `code`
    // se canjea de nuevo contra TiendaNube.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(await TiendanubeTienda.count()).toBe(2);

    const fila = await TiendanubeEstadoOauth.findOne({ where: { token: state.token } });
    expect(fila.consumido_en).not.toBeNull();
  });

  it('dos entregas del mismo state EN PARALELO canjean una sola vez', async () => {
    // **Ésta es la mitad que un test secuencial no toca.** Un `findOne` seguido
    // de un `update` deja pasar a los seis: cuando cada uno lee, ninguno escribió
    // todavía. Lo único que decide es la base.
    const state = await estadoDeOauth(datos.empresaA.id, 'b'.repeat(64));

    const respuestas = await Promise.all(
      Array.from({ length: EN_PARALELO }, () => callback(state.token))
    );

    const vincularon = respuestas.filter((r) => motivoDe(r) === null);
    const rechazados = respuestas.filter((r) => motivoDe(r) === 'state_invalido');

    expect(vincularon).toHaveLength(1);
    expect(rechazados).toHaveLength(EN_PARALELO - 1);

    // Y lo que de verdad importa: el `code` se canjeó una sola vez. Seis canjes
    // del mismo `code` son seis intentos de vinculación contra TiendaNube.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(await TiendanubeTienda.count({ where: { empresa_id: datos.empresaA.id } })).toBe(1);
  });

  it('el token queda bajo la empresa del state, y la sucursal designada sale de sucursalPorDefecto', async () => {
    const state = await estadoDeOauth(datos.empresaA.id, 'c'.repeat(64));

    await callback(state.token);

    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: datos.empresaA.id } });

    expect(tienda).not.toBeNull();
    expect(String(tienda.tiendanube_user_id)).toBe(String(USER_ID_DE_LA_TIENDA));
    // `centro` es la que elige `sucursalPorDefecto` (la activa de menor id, sin
    // ninguna con code 'principal'). La fixture designa `norte` a propósito, así
    // que este número dice de dónde salió: al vincular sale del por defecto, y
    // cambiarlo después es `PUT /sucursal`.
    expect(tienda.punto_de_venta_id).toBe(datos.centroA.id);

    const token = await Setting.findOne({
      where: { key: 'tiendanube_access_token', empresa_id: datos.empresaA.id },
    });
    expect(token).not.toBeNull();
  });
});

describe('Dos empresas no pueden vincular la misma tienda', () => {
  it('la segunda choca contra el índice único de tiendanube_user_id', async () => {
    // La empresa B ya tiene su tienda con OTRO `user_id`: se le cambia al mismo
    // que devuelve el canje para que el choque sea el que se quiere probar.
    await TiendanubeTienda.destroy({ where: { empresa_id: datos.empresaA.id } });
    await TiendanubeTienda.update(
      { tiendanube_user_id: USER_ID_DE_LA_TIENDA },
      { where: { empresa_id: datos.empresaB.id } }
    );

    const state = await estadoDeOauth(datos.empresaA.id, 'd'.repeat(64));

    const res = await callback(state.token);

    expect(motivoDe(res)).toBe('tienda_ocupada');

    // La garantía es de la base y no del handler: `settings` no puede sostenerla
    // —su PK es (key, empresa_id)— y sin este UNIQUE el pedido de una tienda le
    // descuenta stock a la empresa que Postgres devuelva primero.
    expect(await TiendanubeTienda.count()).toBe(1);
    expect(await TiendanubeTienda.count({ where: { empresa_id: datos.empresaA.id } })).toBe(0);

    // Y no queda el token colgado de una vinculación que no existe.
    expect(await Setting.count({
      where: { key: 'tiendanube_access_token', empresa_id: datos.empresaA.id },
    })).toBe(0);
  });

  it('el índice único está en la BASE: un insert directo también choca', async () => {
    // Sin este caso, el anterior seguiría en verde con la restricción borrada y
    // una comprobación escrita a mano en el handler — que es exactamente lo que
    // FR-036 dice que no alcanza.
    await expect(TiendanubeTienda.create({
      empresa_id: datos.empresaA.id,
      tiendanube_user_id: datos.tiendaB.tiendanube_user_id,
      punto_de_venta_id: datos.centroA.id,
    })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
  });
});

describe('La empresa B no ve el estado de la tienda de la A', () => {
  it('GET /status devuelve la tienda de la sesión y no la de la otra empresa', async () => {
    const res = await request(app).get('/api/tiendanube/status');

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('vinculada');
    // La sesión de estos tests es siempre la empresa A (el bypass de server.js
    // clava req.empresaId = 1). Las dos tiendas están sembradas con nombre y
    // user_id distintos justamente para que un `where` sin `empresa_id` devuelva
    // la equivocada en vez de devolver nada.
    expect(res.body.tienda.nombre).toBe('Panadería del Centro Online');
    expect(res.body.tienda.nombre).not.toBe(datos.tiendaB.nombre);
    expect(String(res.body.tienda.tiendanube_user_id)).toBe(String(datos.tiendaA.tiendanube_user_id));
  });

  it('la sucursal designada que informa es la de la tienda, no la por defecto', async () => {
    const res = await request(app).get('/api/tiendanube/status');

    // La fixture designa `norte` y `sucursalPorDefecto` elegiría `centro`: si el
    // endpoint resolviera la sucursal por su cuenta en vez de leerla de la fila,
    // este número sería el otro.
    expect(res.body.tienda.punto_de_venta).toMatchObject({ id: datos.norteA.id, code: 'norte' });
    expect(res.body.tienda.punto_de_venta.id).not.toBe(datos.centroA.id);
  });

  it('los conteos son los de A: tres mapeos y cuatro variantes, no los cinco de las dos', async () => {
    const res = await request(app).get('/api/tiendanube/status');

    expect(res.body.variantes.total).toBe(4);
    expect(res.body.variantes.mapeadas).toBe(3);
    // B tiene un mapeo más y ninguna variante: sin el `empresa_id`, `mapeadas`
    // daría 4.
    expect(await TiendanubeMapping.count()).toBe(4);
  });
});

describe('DELETE /vinculacion contra la base real', () => {
  it('borra la tienda y el token de A, y no toca nada de B', async () => {
    await Setting.create({
      key: 'tiendanube_access_token', value: 'token-de-A', empresa_id: datos.empresaA.id,
    });
    await Setting.create({
      key: 'tiendanube_access_token', value: 'token-de-B', empresa_id: datos.empresaB.id,
    });

    const res = await request(app).delete('/api/tiendanube/vinculacion');

    expect(res.status).toBe(200);
    expect(res.body.mapeos_conservados).toBe(3);

    expect(await TiendanubeTienda.count({ where: { empresa_id: datos.empresaA.id } })).toBe(0);
    expect(await TiendanubeTienda.count({ where: { empresa_id: datos.empresaB.id } })).toBe(1);

    expect(await Setting.count({
      where: { key: 'tiendanube_access_token', empresa_id: datos.empresaA.id },
    })).toBe(0);
    expect(await Setting.count({
      where: { key: 'tiendanube_access_token', empresa_id: datos.empresaB.id },
    })).toBe(1);

    // Los mapeos NO se borran: volver a vincular la misma tienda los encuentra
    // intactos. Es la decisión, y la respuesta la repite para que la pantalla la
    // pueda decir antes de que alguien confirme.
    expect(await TiendanubeMapping.count({ where: { empresa_id: datos.empresaA.id } })).toBe(3);
  });
});

// ════════════════════════════════════════════
//  El mapeo, EJECUTADO contra Postgres
//
//  Una guardia estática ve que se llamó a `findScoped`; que la fila de la otra
//  empresa **haya quedado como estaba** después del intento no lo puede contestar
//  ni una guardia ni un doble. Y los dos índices únicos de `tiendanube_mappings`
//  son restricciones de la base: contra `helpers/modelosFalsos.js` el choque se
//  simula, así que un test escrito ahí prueba la simulación.
// ════════════════════════════════════════════

/** El cuerpo de `POST /mapeos`, con los tres ids. */
const crearMapeo = (cuerpo) =>
  request(app).post('/api/tiendanube/mapeos').send(cuerpo);

describe('Los mapeos son de una empresa y de una sola', () => {
  it('la sesión de A no puede crear un mapeo sobre un producto de B: 404 y ninguna fila', async () => {
    // Es el criterio 6 y **es verificable contra hoy, donde responde 201**: el
    // `create` colgaba de un `product_id` que nadie validaba y la fila quedaba
    // con el `empresa_id` de quien la mandó, así que revisando la tabla no se ve
    // nada raro.
    const antes = await TiendanubeMapping.count();

    const res = await crearMapeo({
      product_id: datos.golosinaB.id,
      tiendanube_variant_id: 5000004,
      tiendanube_product_id: 700003,
    });

    expect(res.status).toBe(404);
    expect(await TiendanubeMapping.count()).toBe(antes);
  });

  it('la sesión de A no borra el mapeo de B, y la fila de B SIGUE AHÍ después del intento', async () => {
    const res = await request(app).delete(`/api/tiendanube/mapeos/${datos.mapeoB.id}`);

    // 404 y no 403: un 403 confirmaría que ese mapeo existe en otra empresa.
    expect(res.status).toBe(404);

    // **La mitad que ningún otro nivel contesta.** Un `findByPk` seguido de un
    // `destroy` responde 404 en algunos caminos y borra en otros; lo único que
    // dice cuál pasó es releer la fila.
    const deB = await TiendanubeMapping.findByPk(datos.mapeoB.id);
    expect(deB).not.toBeNull();
    expect(deB.empresa_id).toBe(datos.empresaB.id);
  });

  it('el listado de A no trae ninguno de B', async () => {
    const res = await request(app).get('/api/tiendanube/mapeos');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    // El ancla: hay cuatro en la tabla, y el cuarto es de B.
    expect(await TiendanubeMapping.count()).toBe(4);
    expect(res.body.data.map((m) => m.id)).not.toContain(datos.mapeoB.id);
  });

  it('borrar un producto borra su mapeo por ON DELETE CASCADE y la variante vuelve a «sin mapear»', async () => {
    // US3 escenario 11. La pantalla **no puede mostrar una fila rota**, y la
    // razón es la FK, no una limpieza escrita en el código: si alguien cambiara
    // la restricción a `SET NULL`, el mapeo quedaría con `product_id` nulo y el
    // listado dibujaría una fila que no apunta a nada.
    // ⚠ **La restricción se lee de la base, no se supone.** Ningún código borra
    // mapeos cuando se borra un producto —verificado con `grep`—, así que lo
    // único que puede hacer desaparecer la fila es la FK. Y si alguien cambiara
    // la migración a `SET NULL`, `Product.destroy` fallaría —`product_id` es NOT
    // NULL— y este caso se pondría en rojo por un motivo que no dice cuál fue.
    // Esta consulta lo nombra.
    const [[restriccion]] = await sequelize.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'tiendanube_mappings'::regclass
          AND contype = 'f'
          AND conname LIKE '%product_id%'`
    );

    expect(restriccion.confdeltype).toBe('c');

    await Product.destroy({ where: { id: datos.harina.id } });

    expect(await TiendanubeMapping.findByPk(datos.mapeoHarina.id)).toBeNull();
    expect(await TiendanubeMapping.count({ where: { empresa_id: datos.empresaA.id } })).toBe(2);

    // Y la variante sigue en la instantánea, sin mapeo: **eso no es un error**.
    const res = await request(app).get('/api/tiendanube/variantes');
    const variante = res.body.data.find((v) => Number(v.tiendanube_variant_id) === 5000001);

    expect(variante).toBeDefined();
    expect(variante.mapeo).toBeNull();
    expect(variante.motivo_no_publicado).toBe('sin_mapeo');
  });

  it('el segundo mapeo del mismo producto choca contra uq_tn_mapping_product y llega como 409, no como 500', async () => {
    // `harina` ya está mapeada a la variante 5000001. La 5000004 está en la
    // instantánea y sin mapear, así que lo único que puede chocar es el producto.
    const res = await crearMapeo({
      product_id: datos.harina.id,
      tiendanube_variant_id: 5000004,
      tiendanube_product_id: 700003,
    });

    expect(res.status).toBe(409);
    expect(res.status).not.toBe(500);
    // Un 409 que dice «ya existe» sin decir cuál obliga a buscarlo a mano en la
    // tabla: el mensaje nombra el producto y la variante con la que choca.
    expect(res.body.error).toContain('Harina 000');
    expect(res.body.error).toContain('5000001');

    expect(await TiendanubeMapping.count({ where: { empresa_id: datos.empresaA.id } })).toBe(3);
  });

  it('el segundo mapeo de la misma variante choca contra uq_tn_mapping_variant', async () => {
    // El otro índice. `levadura` está mapeada a la 5000002; se intenta mapear la
    // MISMA variante contra un producto que todavía no tiene mapeo.
    const otro = await Product.create({
      empresa_id: datos.empresaA.id, name: 'Harina integral', sku: 'HAR-INT', unit_type: 'kg',
    });

    const res = await crearMapeo({
      product_id: otro.id,
      tiendanube_variant_id: 5000002,
      tiendanube_product_id: 700001,
    });

    expect(res.status).toBe(409);
    // Nombra el producto que YA tiene esa variante, que es el otro, no el que se
    // mandó: los dos choques se corrigen distinto.
    expect(res.body.error).toContain('Levadura fresca');
    expect(res.body.error).not.toContain('Harina integral');
  });

  it('los dos índices son de la BASE: un insert directo también choca', async () => {
    // Sin este caso, los dos de arriba seguirían en verde con las restricciones
    // borradas y una comprobación escrita a mano en el handler — que es
    // exactamente lo que FR-035 dice que no alcanza.
    await expect(TiendanubeMapping.create({
      empresa_id: datos.empresaA.id,
      product_id: datos.harina.id,
      tiendanube_variant_id: 5000009,
      tiendanube_product_id: 700009,
    })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });

    await expect(TiendanubeMapping.create({
      empresa_id: datos.empresaA.id,
      product_id: datos.sal.id === undefined ? null : datos.golosinaB.id,
      tiendanube_variant_id: 5000001,
      tiendanube_product_id: 700001,
    })).rejects.toBeDefined();
  });
});

// ════════════════════════════════════════════
//  Lo que solo Postgres contesta del listado de variantes
//
//  `CONVENCIONES.md` nombra `translate()` entre lo que va a este nivel, y con
//  motivo: la condición de búsqueda es una clave `Symbol` en el `where`, y
//  `helpers/modelosFalsos.js` recorre el objeto con `Object.entries`, que **no
//  devuelve símbolos**. O sea que un caso de `?q=` escrito contra un doble
//  devolvería TODO y pasaría por no haber filtrado — el peor de los verdes.
//
//  Lo mismo con el `ON CONFLICT (empresa_id, tiendanube_variant_id)` del
//  refresco: contra un doble se simula.
// ════════════════════════════════════════════

const listarVariantes = (query = '') =>
  request(app).get(`/api/tiendanube/variantes${query}`);

describe('GET /variantes contra Postgres: la búsqueda y el aislamiento', () => {
  it('q busca por nombre de producto y por SKU, sin distinguir acentos ni mayúsculas', async () => {
    // La fixture tiene «Harina» (dos variantes), «Sal fina» y «Producto que se
    // borro de la tienda». Se agrega una con acento para que la normalización
    // tenga algo que normalizar: sin ella, `translate()` y no hacer nada dan el
    // mismo resultado.
    await TiendanubeVariante.create({
      empresa_id: datos.empresaA.id,
      tiendanube_variant_id: 5000010,
      tiendanube_product_id: 700010,
      nombre_producto: 'Azúcar impalpable',
      nombre_variante: 'Ñandú 1 kg',
      sku: 'AZU-001',
      vista_en: new Date('2026-08-05T09:00:00.000Z'),
    });

    const conAcento = await listarVariantes('?q=azucar');
    const enMayuscula = await listarVariantes('?q=AZUCAR');
    const porSku = await listarVariantes('?q=sal-0');
    const porVariante = await listarVariantes('?q=nandu');
    const sinNada = await listarVariantes('?q=zzzz');

    expect(conAcento.body.total).toBe(1);
    expect(Number(conAcento.body.data[0].tiendanube_variant_id)).toBe(5000010);
    expect(enMayuscula.body.total).toBe(1);

    // Por SKU: es la mitad de FR-059 y la que más fácil se olvida, porque el
    // nombre alcanza para que la búsqueda «parezca» andar.
    expect(porSku.body.total).toBe(1);
    expect(porSku.body.data[0].sku).toBe('SAL-001');

    // Y por nombre de variante, que es una tercera columna.
    expect(porVariante.body.total).toBe(1);

    // El ancla: sin este caso, una condición que no filtrara nada dejaría los
    // cuatro de arriba en verde.
    expect(sinNada.body.total).toBe(0);
  });

  it('la búsqueda NO se lleva puestas las variantes de la otra empresa', async () => {
    await TiendanubeVariante.create({
      empresa_id: datos.empresaB.id,
      tiendanube_variant_id: 6000001,
      tiendanube_product_id: 800001,
      nombre_producto: 'Harina del kiosco',
      sku: 'HAR-000',
      vista_en: new Date('2026-08-05T09:00:00.000Z'),
    });

    const res = await listarVariantes('?q=harina');

    // Las dos de A —«Harina 1 kg» y «Harina 5 kg»— y ninguna de B, aunque el
    // nombre y el SKU coincidan.
    expect(res.body.total).toBe(2);
    expect(res.body.data.every((v) => Number(v.tiendanube_variant_id) < 6000000)).toBe(true);
  });

  it('la variante con vista_en anterior al refresco sale con en_la_tienda false', async () => {
    // La fixture tiene la 5000004 con `vista_en` anterior al
    // `catalogo_refrescado_en` de la tienda: es «esta variante ya no está en tu
    // tienda», y la comparación la hace Postgres con dos TIMESTAMPTZ.
    const res = await listarVariantes();

    const vieja = res.body.data.find((v) => Number(v.tiendanube_variant_id) === 5000004);
    const actual = res.body.data.find((v) => Number(v.tiendanube_variant_id) === 5000001);

    expect(vieja.en_la_tienda).toBe(false);
    expect(actual.en_la_tienda).toBe(true);
  });

  it('el disponible sale de la sucursal DESIGNADA, y es available y no quantity', async () => {
    // `harina@norte` tiene quantity 7 y available 5, y `norte` es la designada
    // mientras `sucursalPorDefecto` elegiría `centro` (quantity 20). Con los tres
    // números iguales este caso pasaría con y sin las dos decisiones.
    const res = await listarVariantes();

    const harina = res.body.data.find((v) => Number(v.tiendanube_variant_id) === 5000001);

    expect(harina.disponible).toBe(5);
    expect(typeof harina.disponible).toBe('number');
    expect(harina.motivo_no_publicado).toBeNull();
  });

  it('la mapeada sin fila de stock en la designada no publica cero: se anota', async () => {
    // `sal` está mapeada y no tiene NINGUNA fila de stock; `levadura` tiene
    // stock solo en `centro`, que no es la designada. Los dos casos terminan
    // igual y por motivos distintos, y los dos son FR-046.
    const res = await listarVariantes();

    const sal = res.body.data.find((v) => Number(v.tiendanube_variant_id) === 5000003);
    const levadura = res.body.data.find((v) => Number(v.tiendanube_variant_id) === 5000002);

    for (const fila of [sal, levadura]) {
      expect(fila.disponible).toBeNull();
      expect(fila.motivo_no_publicado).toBe('sin_stock_en_sucursal');
    }
  });
});

describe('El refresco del catálogo contra Postgres', () => {
  beforeEach(async () => {
    // La fixture siembra la tienda pero **no** el token: es el estado de una
    // vinculación a medias, y sin esta fila el refresco contesta «la tienda no
    // tiene un token válido» antes de llamar a nadie. El token vive en
    // `settings` a propósito (FR-077).
    await Setting.create({
      key: 'tiendanube_access_token', value: 'tn_token_de_A', empresa_id: datos.empresaA.id,
    });
  });

  /** Un producto de TiendaNube con una variante, como lo devuelve la API. */
  const productoDeLaTienda = (id, variante, sku) => ({
    id,
    name: { es: `Producto ${id}` },
    variants: [{ id: variante, sku, stock: 4, values: [{ es: 'único' }] }],
  });

  it('refrescar dos veces no duplica: el ON CONFLICT es el índice único de verdad', async () => {
    // ⚠ **Esto es lo que un doble no puede contestar.** El conflicto va contra
    // `uq_tn_variante`, que NO es la clave primaria: si `conflictAttributes` no
    // llegara a la sentencia, Postgres apuntaría al `id` y el segundo refresco
    // fallaría con una violación de restricción única —o insertaría el catálogo
    // entero de nuevo—.
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: [
        productoDeLaTienda(700001, 5000001, 'HAR-000'),
        productoDeLaTienda(700020, 5000020, 'NUEVA-1'),
      ],
    });

    const primero = await request(app).post('/api/tiendanube/variantes/refrescar');
    const segundo = await request(app).post('/api/tiendanube/variantes/refrescar');

    expect(primero.status).toBe(200);
    expect(primero.body.nuevas).toBe(1);
    expect(segundo.status).toBe(200);
    expect(segundo.body.nuevas).toBe(0);

    expect(await TiendanubeVariante.count({
      where: { empresa_id: datos.empresaA.id, tiendanube_variant_id: 5000001 },
    })).toBe(1);
    // Las cuatro de la fixture más la nueva: las que no vinieron NO se borran.
    expect(await TiendanubeVariante.count({ where: { empresa_id: datos.empresaA.id } })).toBe(5);
    expect(segundo.body.desaparecidas).toBe(3);
  });

  it('el refresco NO le toca la instantánea a la otra empresa', async () => {
    await TiendanubeVariante.create({
      empresa_id: datos.empresaB.id,
      tiendanube_variant_id: 6000001,
      tiendanube_product_id: 800001,
      nombre_producto: 'Chocolate',
      vista_en: new Date('2026-08-05T09:00:00.000Z'),
    });

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: [productoDeLaTienda(700001, 5000001, 'HAR-000')],
    });

    await request(app).post('/api/tiendanube/variantes/refrescar');

    const deB = await TiendanubeVariante.findOne({
      where: { empresa_id: datos.empresaB.id, tiendanube_variant_id: 6000001 },
    });

    expect(deB).not.toBeNull();
    expect(deB.nombre_producto).toBe('Chocolate');
  });

  it('el refresco deja la fecha, y es la misma que el vista_en de lo que trajo', async () => {
    // Si el refresco de la tienda fuera posterior al `vista_en` de las filas
    // —por ejemplo, dos `NOW()` distintos— **todo el catálogo recién traído
    // saldría marcado como «ya no está en tu tienda»**.
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: [productoDeLaTienda(700001, 5000001, 'HAR-000')],
    });

    await request(app).post('/api/tiendanube/variantes/refrescar');

    const res = await listarVariantes();
    const traida = res.body.data.find((v) => Number(v.tiendanube_variant_id) === 5000001);

    expect(traida.en_la_tienda).toBe(true);
    expect(res.body.refrescado_en).not.toBeNull();
  });
});

// ════════════════════════════════════════════
//  El arriendo de la sincronización, EJECUTADO
//
//  ⚠ **Es el único nivel que puede contestarlo.** Dos `POST /sincronizar` a la
//  vez no se pueden simular con los dobles de `helpers/modelosFalsos.js`: no hay
//  dos transacciones que puedan chocar contra un array, así que el arriendo se
//  interpreta a mano y lo que se prueba es la interpretación.
//
//  Lo que decide acá es Postgres: el segundo `UPDATE` **espera** a que el primero
//  commitee, vuelve a evaluar el `WHERE` contra la fila nueva y no encuentra
//  nada. Un `findOne` seguido de un `update` deja pasar a los dos —cuando cada
//  uno lee, ninguno escribió todavía— y las dos corridas mandan PUT a las mismas
//  variantes, con dos números que se pisan.
//
//  La otra mitad es la ventana de diez minutos: sin ella, **una corrida que se
//  cortó por la mitad deja la sincronización bloqueada para siempre** y solo la
//  destraba alguien entrando a la base a borrar una fecha a mano.
// ════════════════════════════════════════════

describe('POST /sincronizar contra Postgres: el arriendo lo decide la base', () => {
  beforeEach(async () => {
    // El token vive en `settings` (FR-077) y la fixture no lo siembra: sin esta
    // fila, `updateVariantStock` corta antes de llamar a nadie y la corrida
    // fallaría por el motivo equivocado.
    await Setting.create({
      key: 'tiendanube_access_token', value: 'tn_token_de_A', empresa_id: datos.empresaA.id,
    });

    jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });
  });

  const sincronizar = () => request(app).post('/api/tiendanube/sincronizar');

  /** Pone el arriendo en el pasado **con el reloj de Postgres**. */
  async function arriendoDeHace(minutos) {
    await sequelize.query(
      `UPDATE tiendanube_tiendas
          SET sincronizando_desde = NOW() - INTERVAL '${minutos} minutes'
        WHERE empresa_id = $1`,
      { bind: [datos.empresaA.id] }
    );
  }

  it('dos POST /sincronizar EN PARALELO: uno arranca y el otro recibe «hay una corriendo»', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: EN_PARALELO }, () => sincronizar())
    );

    const arrancaron = respuestas.filter((r) => r.status === 200);
    const rechazadas = respuestas.filter((r) => r.status === 409);

    expect(arrancaron).toHaveLength(1);
    expect(rechazadas).toHaveLength(EN_PARALELO - 1);
    expect(rechazadas[0].body.error).toContain('en curso');

    // Y quedó **una** fila de corrida: sin el arriendo habría una por request, y
    // cada una habría mandado su propio PUT con el mismo número.
    expect(await TiendanubeCorrida.count({ where: { empresa_id: datos.empresaA.id } })).toBe(1);
  });

  it('un arriendo de hace once minutos se puede volver a tomar', async () => {
    // La corrida que se cortó por la mitad —US5 escenario 6— no puede bloquear la
    // sincronización hasta que alguien entre a la base. El reloj es el de
    // Postgres: los timers de jest no lo mueven, así que la fecha se escribe con
    // `NOW() - INTERVAL`.
    await arriendoDeHace(11);

    const res = await sincronizar();

    expect(res.status).toBe(200);
  });

  it('un arriendo de hace un minuto sigue bloqueando: la ventana es de diez', async () => {
    // El otro lado, y es el que impide que «se puede volver a tomar» pase por
    // haber borrado la condición entera.
    await arriendoDeHace(1);

    const res = await sincronizar();

    expect(res.status).toBe(409);
    expect(axios.put).not.toHaveBeenCalled();
  });

  it('el arriendo queda suelto al terminar, y la fila de la corrida no', async () => {
    await sincronizar();

    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: datos.empresaA.id } });

    // ⚠ Soltarlo con `tienda.update({ sincronizando_desde: null })` sobre la
    // instancia cargada ANTES del UPDATE que lo tomó no emite ninguna sentencia
    // —para Sequelize el valor no cambió— y la fila queda arrendada diez minutos
    // con la corrida ya terminada.
    expect(tienda.sincronizando_desde).toBeNull();

    const corrida = await TiendanubeCorrida.findOne({ where: { empresa_id: datos.empresaA.id } });
    expect(corrida.terminada_en).not.toBeNull();
  });

  it('publica el available de la sucursal DESIGNADA, y llega como número', async () => {
    // `harina@norte` tiene quantity 7 y available 5, y `norte` es la designada
    // mientras `sucursalPorDefecto` elegiría `centro` (20). Los tres números son
    // distintos a propósito: con los tres iguales, este caso pasaría con y sin
    // las dos decisiones.
    const res = await sincronizar();

    expect(res.status).toBe(200);
    expect(axios.put).toHaveBeenCalledTimes(1);

    const [url, cuerpo] = axios.put.mock.calls[0];

    expect(String(url)).toContain('/variants/5000001');
    expect(cuerpo.stock).toBe(5);
    // `stock.available` es INTEGER y el driver lo devuelve como número, pero un
    // DECIMAL vuelve como string y `toBe(5)` sobre `'5'` fallaría sin decir por
    // qué: la afirmación sobre el tipo es la que lo nombra.
    expect(typeof cuerpo.stock).toBe('number');

    expect(res.body.mandadas).toBe(1);
    expect(res.body.fallidas).toBe(0);
  });

  it('las dos mapeadas sin fila de stock en la designada quedan anotadas, no en cero', async () => {
    // `sal` no tiene ninguna fila de stock; `levadura` tiene solo en `centro`,
    // que NO es la designada. Los dos terminan igual y por motivos distintos.
    await sincronizar();

    const enviados = axios.put.mock.calls.map(([url]) => String(url).split('/').pop());
    expect(enviados).not.toContain('5000002');
    expect(enviados).not.toContain('5000003');

    for (const varianteId of [5000002, 5000003]) {
      const fila = await TiendanubeVariante.findOne({
        where: { empresa_id: datos.empresaA.id, tiendanube_variant_id: varianteId },
      });

      expect(fila.motivo_no_publicado).toBe('sin_stock_en_sucursal');
      expect(fila.stock_publicado).toBeNull();
    }
  });

  it('la corrida de A no toca la tienda ni las variantes de B', async () => {
    await sincronizar();

    const tiendaB = await TiendanubeTienda.findOne({ where: { empresa_id: datos.empresaB.id } });

    expect(tiendaB.sincronizando_desde).toBeNull();
    expect(await TiendanubeCorrida.count({ where: { empresa_id: datos.empresaB.id } })).toBe(0);
    // El mapeo de B apunta a la variante 6000001 y su producto tiene stock: si la
    // consulta de mapeos no filtrara por empresa, ese número saldría hacia la
    // tienda de A.
    expect(await TiendanubeMapping.count({ where: { empresa_id: datos.empresaB.id } })).toBe(1);
    expect(axios.put).toHaveBeenCalledTimes(1);
  });

  it('la última corrida se relee de la base: sobrevive un reinicio del servidor', async () => {
    const antes = await request(app).get('/api/tiendanube/corridas/ultima');

    // `null` y no `{}`: la pantalla tiene que poder decir «nunca se sincronizó»
    // en vez de «se sincronizó y no mandó nada», que quiere decir otra cosa.
    expect(antes.body.corrida).toBeNull();

    await sincronizar();

    const despues = await request(app).get('/api/tiendanube/corridas/ultima');

    // FR-043: es una fila. Lo único que hace falta para que el resultado
    // sobreviva un reinicio es que no viva en una variable del proceso.
    expect(despues.body.corrida.mandadas).toBe(1);
    expect(despues.body.corrida.disparador).toBe('manual');
    expect(despues.body.corrida.terminada_en).not.toBeNull();

    // Las dos que no se publicaron **no** están en `fallas`: no fallaron, no se
    // mandaron. Confundirlas dejaría una corrida «con tres errores» que en
    // realidad no tuvo ninguno.
    expect(despues.body.corrida.fallas).toEqual([]);
    expect(despues.body.corrida.fallidas).toBe(0);
  });
});

// ════════════════════════════════════════════
//  La red de la sincronización: encolado, agrupado, drenaje y reconciliación
//
//  ⚠ **Ninguna de las cuatro cosas se puede escribir con los dobles.** El
//  encolado corre dentro de la transacción del que escribió stock —y
//  `helpers/modelosFalsos.js` no entiende transacciones, así que «se fue con el
//  rollback» no tiene forma de ocurrir—; el agrupado ES el índice único
//  `uq_tn_variante`, que contra un doble se simula; el drenaje toma el arriendo
//  con un `UPDATE` condicional; y la reconciliación compara tres números que
//  salen de tres tablas.
//
//  ── Por qué esto existe, dicho una vez ──
//
//  Empujar el stock en cada movimiento **y nada más** deja una variante
//  desfasada en silencio y para siempre el día que un empujón falle: el
//  disparador ya ocurrió y no hay nada que lo reintente. La cola le da un
//  segundo intento, el agrupado hace que cien movimientos no sean cien llamadas
//  a una API con cuota, y la reconciliación diaria atrapa lo que ni siquiera
//  llegó a encolarse — que es lo único que hace aceptable que el encolado sea
//  best-effort y no pueda tumbar una venta.
// ════════════════════════════════════════════

/** El mismo ticket de siempre: tres kilos de harina, que es la mapeada. */
function ticket(id = 'VENTA-QUE-ENCOLA-0001') {
  return {
    id,
    total: 3703.68,
    items: [
      {
        product_id: datos.harina.id,
        product_name: 'Harina 000',
        quantity: 3,
        unit_price: 1234.56,
      },
    ],
  };
}

/** La fila de la instantánea de A, por su id de variante. */
const filaDeVariante = (varianteId) => TiendanubeVariante.findOne({
  where: { empresa_id: datos.empresaA.id, tiendanube_variant_id: varianteId },
});

/** Cuántas variantes de A están esperando en la cola. */
const enLaCola = () => TiendanubeVariante.count({
  where: { empresa_id: datos.empresaA.id, pendiente_desde: { [Op.not]: null } },
});

/**
 * Deja correr los `setImmediate` que el hook programó.
 *
 * ⚠ No es cosmético: el hook dispara un drenaje de fondo después de cada
 * escritura de stock, y un drenaje que arranque **después** de que el test
 * adelantó `proximo_intento_en` publicaría la fila por su cuenta y dejaría al
 * caso midiendo otra cosa. Se los deja terminar antes de tocar el reloj de la
 * cola.
 */
async function dejarPasarLosDrenajesDeFondo() {
  // Los ticks son para que el `setImmediate` que dispara el drenaje llegue a
  // ejecutarse. Alcanzan para ARRANCARLO, no para que TERMINE.
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Y esto espera a que terminen los que arrancaron.
  //
  // ⚠ Sin esta línea el archivo pasaba acá y fallaba en CI, con 0 llamadas donde
  // se esperaba 1: el drenaje de fondo seguía en vuelo, y el `drenarCola`
  // explícito del test se salteaba porque `dispararDrenaje` devuelve la promesa
  // en curso en vez de empezar otra. Un drenaje hace varias consultas a
  // Postgres, que tardan mucho más que cinco ticks — así que cuántos ticks
  // «alcanzan» depende de la máquina, que es justo lo que un test no puede
  // depender.
  await tiendanubeSincronizacion.esperarDrenajesEnCurso();
}

/** Pone una variante en la cola y ya vencida, sin esperar los cinco segundos. */
async function encolarYaVencida(varianteId) {
  await TiendanubeVariante.update(
    { pendiente_desde: new Date(), proximo_intento_en: new Date(Date.now() - 60000) },
    { where: { empresa_id: datos.empresaA.id, tiendanube_variant_id: varianteId } }
  );
}

describe('El hook de Stock encola la variante mapeada de ese producto', () => {
  it('una venta deja la variante mapeada pendiente, y el handler NO espera el empujón', async () => {
    const res = await request(app).post('/api/sales').send(ticket());

    expect(res.status).toBe(201);

    const harina = await filaDeVariante(5000001);

    // La venta ya respondió y la fila **sigue pendiente**: el empujón no va
    // adentro de la transacción del cobro. Atarlo ahí significaría que un 429 de
    // TiendaNube hace fallar una venta.
    expect(harina.pendiente_desde).not.toBeNull();

    // Y le toca dentro de la ventana de agrupado, no ya: es lo que hace que una
    // importación de lista no salga variante por variante.
    expect(new Date(harina.proximo_intento_en).getTime()).toBeGreaterThan(Date.now());
  });

  it('el UPDATE del encolado toca UNA fila y no barre la tabla', async () => {
    // La otra empresa también tiene su variante mapeada: sin ella, «no barre la
    // tabla» no distinguiría barrer la empresa de barrer todo.
    await TiendanubeVariante.create({
      empresa_id: datos.empresaB.id,
      tiendanube_variant_id: 6000001,
      tiendanube_product_id: 800001,
      nombre_producto: 'Chocolate',
      vista_en: new Date('2026-08-05T09:00:00.000Z'),
    });

    await request(app).post('/api/sales').send(ticket());

    const pendientes = await TiendanubeVariante.findAll({
      where: { pendiente_desde: { [Op.not]: null } },
    });

    // Una. `levadura` y `sal` también están mapeadas y no se movieron; la de B
    // tampoco. Sin el `WHERE`, un movimiento de un producto encolaría el
    // catálogo entero y la corrida siguiente gastaría la cuota de la tienda para
    // dejar todo igual.
    expect(pendientes).toHaveLength(1);
    expect(Number(pendientes[0].tiendanube_variant_id)).toBe(5000001);
  });

  it('si la venta se cae, el encolado se cae con ella: va en la MISMA transacción', async () => {
    await expect(sequelize.transaction(async (t) => {
      const fila = await Stock.findOne({
        where: {
          empresa_id: datos.empresaA.id,
          product_id: datos.harina.id,
          punto_de_venta_id: datos.norteA.id,
        },
      });

      await fila.update({ quantity: 6, available: 4 }, { transaction: t });

      throw new Error('la venta se cayó a mitad de camino');
    })).rejects.toThrow('se cayó');

    // Sin `options.transaction`, el encolado se iría por su propia conexión y
    // quedaría una variante pendiente de publicar un movimiento que nunca
    // ocurrió: la tienda recibiría un número que el sistema no tiene.
    expect(await enLaCola()).toBe(0);
  });

  it('un fallo del encolado NO revierte la venta: la cola no puede impedir cobrar', async () => {
    const consultaReal = sequelize.query.bind(sequelize);

    jest.spyOn(sequelize, 'query').mockImplementation((sql, opciones) => {
      if (typeof sql === 'string' && sql.includes('tiendanube_variantes')) {
        return Promise.reject(new Error('la tabla de la cola no está disponible'));
      }

      return consultaReal(sql, opciones);
    });

    const res = await request(app).post('/api/sales').send(ticket('VENTA-CON-COLA-ROTA'));

    // **El daño concreto que el `try/catch` evita.** Sin él, el error del hook
    // sube por `afterUpdate`, revierte la transacción de la venta y el comercio
    // no puede cobrar por un problema de una tabla de cola.
    expect(res.status).toBe(201);
    expect(await Sale.count({ where: { id: 'VENTA-CON-COLA-ROTA' } })).toBe(1);

    const stock = await Stock.findOne({
      where: {
        empresa_id: datos.empresaA.id,
        product_id: datos.harina.id,
        punto_de_venta_id: datos.centroA.id,
      },
    });

    // 20 − 3: el stock se descontó igual.
    expect(stock.available).toBe(17);
  });

  it('un error SQL del encolado tampoco envenena la transacción de la venta', async () => {
    // ⚠ **Es el caso realista, y el `try/catch` solo no lo cubre.** En Postgres
    // una sentencia que falla **aborta la transacción entera**: todo lo que venga
    // después responde «current transaction is aborted» y el `COMMIT` se vuelve
    // `ROLLBACK`. Atrapar el error en JS no desharía eso.
    //
    // Se esconde la tabla en vez de doblar `sequelize.query`: así el error lo
    // produce Postgres de verdad, que es lo único que reproduce la transacción
    // abortada. Y es exactamente lo que pasa en un despliegue donde la migración
    // `20260811` todavía no corrió — o sea, entre el deploy del código y el de la
    // migración, **ninguna venta se registraría**.
    await sequelize.query('ALTER TABLE tiendanube_variantes RENAME TO tiendanube_variantes_escondida');

    let res;

    try {
      res = await request(app).post('/api/sales').send(ticket('VENTA-SIN-LA-TABLA'));
    } finally {
      await sequelize.query('ALTER TABLE tiendanube_variantes_escondida RENAME TO tiendanube_variantes');
    }

    expect(res.status).toBe(201);
    expect(await Sale.count({ where: { id: 'VENTA-SIN-LA-TABLA' } })).toBe(1);

    const stock = await Stock.findOne({
      where: {
        empresa_id: datos.empresaA.id,
        product_id: datos.harina.id,
        punto_de_venta_id: datos.centroA.id,
      },
    });

    expect(stock.available).toBe(17);
  });
});

describe('El agrupado sale del índice único, no de un temporizador', () => {
  /** Cien movimientos del mismo producto, como una importación de lista. */
  async function cienMovimientos() {
    const fila = await Stock.findOne({
      where: {
        empresa_id: datos.empresaA.id,
        product_id: datos.harina.id,
        punto_de_venta_id: datos.norteA.id,
      },
    });

    for (let i = 0; i < 100; i++) {
      // eslint-disable-next-line no-await-in-loop
      await fila.update({ available: 100 - i, quantity: 100 - i });
    }

    await dejarPasarLosDrenajesDeFondo();
  }

  it('cien movimientos del mismo producto dejan UNA fila pendiente', async () => {
    await cienMovimientos();

    // ⚠ Es `uq_tn_variante` haciendo el agrupado, no un `setTimeout` de debounce:
    // un temporizador en memoria muere con el proceso, y en el free tier el
    // servicio se reinicia y se duerme — lo que estaba esperando no lo reintenta
    // nadie. La unicidad de la fila es durable y sale gratis.
    expect(await enLaCola()).toBe(1);

    const harina = await filaDeVariante(5000001);
    expect(harina.pendiente_desde).not.toBeNull();
  });

  it('drenar después de cien movimientos manda UN solo PUT, con el último número', async () => {
    await Setting.create({
      key: 'tiendanube_access_token', value: 'tn_token_de_A', empresa_id: datos.empresaA.id,
    });
    jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });

    await cienMovimientos();
    await encolarYaVencida(5000001);

    const resumen = await tiendanubeSincronizacion.drenarCola(datos.empresaA.id);

    // Cien llamadas es el número que la API del tercero rechaza, y la cuota es
    // **por tienda**: se la comería a todas las demás variantes.
    expect(axios.put).toHaveBeenCalledTimes(1);
    expect(resumen.mandadas).toBe(1);

    // Y el que se manda es el último, no el primero: la fila guarda el estado,
    // no la historia.
    const [url, cuerpo] = axios.put.mock.calls[0];
    expect(String(url)).toContain('/variants/5000001');
    expect(cuerpo.stock).toBe(1);
    expect(typeof cuerpo.stock).toBe('number');
  });
});

describe('El drenaje de la cola, con su reintento', () => {
  beforeEach(async () => {
    await Setting.create({
      key: 'tiendanube_access_token', value: 'tn_token_de_A', empresa_id: datos.empresaA.id,
    });

    // Sin esto, el reintento del 429 espera de verdad y cada caso tarda los
    // segundos que dice esperar.
    jest.spyOn(tiendanubeService, 'dormir').mockResolvedValue(undefined);
  });

  /** Un 429 de TiendaNube: no es un error, es «más despacio». */
  const limiteAlcanzado = () => {
    const err = new Error('Request failed with status code 429');
    err.response = { status: 429, headers: {} };
    return err;
  };

  it('un empujón que falla con 429 deja la fila con proximo_intento_en en el futuro y NO la pierde', async () => {
    jest.spyOn(axios, 'put').mockRejectedValue(limiteAlcanzado());

    await encolarYaVencida(5000001);

    const resumen = await tiendanubeSincronizacion.drenarCola(datos.empresaA.id);

    expect(resumen.fallidas).toBe(1);
    expect(resumen.mandadas).toBe(0);

    const fila = await filaDeVariante(5000001);

    // **El modo de falla que la red existe para cerrar.** Si acá la fila saliera
    // de la cola, esa variante quedaría desfasada en silencio y para siempre:
    // el movimiento de stock que la encoló ya pasó y no vuelve.
    expect(fila.pendiente_desde).not.toBeNull();
    expect(fila.intentos).toBe(1);
    expect(new Date(fila.proximo_intento_en).getTime()).toBeGreaterThan(Date.now());
    expect(fila.ultimo_error).toContain('limitando');
    expect(fila.stock_publicado).toBeNull();
  });

  it('el siguiente drenaje la reintenta y la fila sale de la cola', async () => {
    jest.spyOn(axios, 'put')
      .mockRejectedValueOnce(limiteAlcanzado())
      .mockRejectedValueOnce(limiteAlcanzado())
      .mockResolvedValue({ data: {} });

    await encolarYaVencida(5000001);
    await tiendanubeSincronizacion.drenarCola(datos.empresaA.id);

    // El backoff puso el próximo intento a minutos: el reintento de verdad llega
    // cuando le toca, y acá se adelanta el reloj de la fila para no esperarlo.
    await encolarYaVencida(5000001);

    const resumen = await tiendanubeSincronizacion.drenarCola(datos.empresaA.id);

    expect(resumen.mandadas).toBe(1);

    const fila = await filaDeVariante(5000001);

    expect(fila.pendiente_desde).toBeNull();
    expect(fila.proximo_intento_en).toBeNull();
    expect(fila.intentos).toBe(0);
    expect(fila.ultimo_error).toBeNull();
    // `available` de la sucursal designada —5—, no `quantity`, que es 7.
    expect(fila.stock_publicado).toBe(5);
  });

  it('a los 8 intentos deja de reintentar sola y queda con ultimo_error', async () => {
    jest.spyOn(axios, 'put').mockRejectedValue(limiteAlcanzado());

    await encolarYaVencida(5000001);
    await TiendanubeVariante.update(
      { intentos: 7 },
      { where: { empresa_id: datos.empresaA.id, tiendanube_variant_id: 5000001 } }
    );

    await tiendanubeSincronizacion.drenarCola(datos.empresaA.id);

    const fila = await filaDeVariante(5000001);

    expect(fila.intentos).toBe(8);
    // `null` = no se reintenta sola. Una fila que reintenta para siempre contra
    // un token revocado es un ataque a la cuota de la tienda, que es por tienda:
    // se la come a todas las demás variantes.
    expect(fila.proximo_intento_en).toBeNull();
    expect(fila.ultimo_error).not.toBeNull();
    // Sigue marcada como pendiente para que la pantalla la muestre en rojo: lo
    // que cambió es que ya no se mueve sola.
    expect(fila.pendiente_desde).not.toBeNull();

    axios.put.mockClear();
    await tiendanubeSincronizacion.drenarCola(datos.empresaA.id);
    expect(axios.put).not.toHaveBeenCalled();
  });

  it('dos drenajes de la misma empresa a la vez: solo uno corre', async () => {
    jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });

    await encolarYaVencida(5000001);

    const primero = tiendanubeSincronizacion.dispararDrenaje(datos.empresaA.id);
    const segundo = tiendanubeSincronizacion.dispararDrenaje(datos.empresaA.id);

    // El `Map` devuelve **la misma promesa**: el segundo pedido no arranca un
    // drenaje nuevo que después chocaría contra el arriendo y volvería con las
    // manos vacías.
    expect(segundo).toBe(primero);

    const [a, b] = await Promise.all([primero, segundo]);

    expect(a.mandadas).toBe(1);
    // Sin el `Map`, éste sería `{ ocupada: true, mandadas: 0 }`: dos drenajes
    // disparados por dos líneas de la misma venta.
    expect(b.mandadas).toBe(1);
    expect(axios.put).toHaveBeenCalledTimes(1);
  });

  it('el drenaje NO escribe ninguna fila de corrida', async () => {
    jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });

    await encolarYaVencida(5000001);
    await tiendanubeSincronizacion.drenarCola(datos.empresaA.id);

    // El empujón por movimiento puede pasar cientos de veces por día: una fila
    // por vez serían cientos diarias que nadie lee y que crecen sin tope. Su
    // estado vive en la fila de la variante, que además dice qué está desfasado
    // **ahora** en vez de qué pasó en un lote.
    expect(await TiendanubeCorrida.count()).toBe(0);
  });
});

describe('La reconciliación diaria y los dos barridos', () => {
  const SECRETO_ANTERIOR = process.env.CRON_SECRET;

  beforeEach(async () => {
    process.env.CRON_SECRET = 'secreto-del-cron-de-prueba';

    await Setting.create({
      key: 'tiendanube_access_token', value: 'tn_token_de_A', empresa_id: datos.empresaA.id,
    });

    jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    if (SECRETO_ANTERIOR === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = SECRETO_ANTERIOR;
  });

  const ejecutarTareas = () => request(app)
    .post('/api/tareas/ejecutar')
    .set('x-cron-secret', 'secreto-del-cron-de-prueba');

  /**
   * Las tres mapeadas de A con stock en la sucursal designada, y el catálogo que
   * la tienda va a devolver.
   *
   * Los tres números están elegidos para que cada variante ejerza **una** de las
   * tres situaciones y ninguna se confunda con otra:
   *
   *  - `harina` (5000001): tenemos 5, mandamos 5, la tienda dice 5 → **al día**.
   *  - `levadura` (5000002): tenemos 12, mandamos 2 → **el empujón se perdió**.
   *  - `sal` (5000003): tenemos 3, mandamos 3, la tienda dice 99 → **alguien lo
   *    cambió a mano en el panel de TiendaNube**.
   *
   * Con las tres al día, «encola solo lo que difiere» y «encola todo» darían el
   * mismo número.
   */
  async function tresVariantesConTresSituaciones() {
    await Stock.create({
      empresa_id: datos.empresaA.id,
      product_id: datos.levadura.id,
      punto_de_venta_id: datos.norteA.id,
      location: 'norte',
      quantity: 12,
      available: 12,
    });
    await Stock.create({
      empresa_id: datos.empresaA.id,
      product_id: datos.sal.id,
      punto_de_venta_id: datos.norteA.id,
      location: 'norte',
      quantity: 3,
      available: 3,
    });

    // Las dos altas de stock encolaron por el hook: se limpia para que lo que
    // quede encolado después sea obra de la reconciliación y de nadie más.
    await dejarPasarLosDrenajesDeFondo();
    await TiendanubeVariante.update(
      { pendiente_desde: null, proximo_intento_en: null },
      { where: { empresa_id: datos.empresaA.id } }
    );

    const publicado = { 5000001: 5, 5000002: 2, 5000003: 3 };

    for (const [varianteId, numero] of Object.entries(publicado)) {
      // eslint-disable-next-line no-await-in-loop
      await TiendanubeVariante.update(
        { stock_publicado: numero, publicado_en: new Date('2026-08-05T09:00:00.000Z') },
        { where: { empresa_id: datos.empresaA.id, tiendanube_variant_id: varianteId } }
      );
    }

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: [
        {
          id: 700001,
          name: { es: 'Harina' },
          variants: [
            { id: 5000001, sku: 'HAR-000', stock: 5, values: [{ es: '1 kg' }] },
            { id: 5000002, sku: '', stock: 12, values: [{ es: '5 kg' }] },
          ],
        },
        {
          id: 700002,
          name: { es: 'Sal fina' },
          // El número que alguien tocó del otro lado. Comparar contra esto no
          // cuesta ninguna llamada extra: el refresco hay que hacerlo igual.
          variants: [{ id: 5000003, sku: 'SAL-001', stock: 99, values: [{ es: 'único' }] }],
        },
      ],
    });
  }

  it('encola SOLO lo que difiere: el empujón perdido y el número cambiado a mano', async () => {
    await tresVariantesConTresSituaciones();

    const resultado = await tiendanubeSincronizacion.reconciliar(datos.empresaA.id);

    // Dos de tres. Encolar las tres sería republicar el catálogo entero una vez
    // por día contra una API con cuota, que es lo que la cola vino a evitar.
    expect(resultado.encoladas).toBe(2);
    expect(resultado.mandadas).toBe(2);

    const mandadas = axios.put.mock.calls.map(([url, cuerpo]) => [
      String(url).split('/').pop(),
      cuerpo.stock,
    ]);

    expect(mandadas).toHaveLength(2);
    expect(mandadas).toContainEqual(['5000002', 12]);
    expect(mandadas).toContainEqual(['5000003', 3]);
    // La que estaba al día no se toca: es la que dice que la comparación filtró.
    expect(mandadas.map(([id]) => id)).not.toContain('5000001');
  });

  it('deja su fila de corrida con disparador reconciliacion y actualiza reconciliada_en', async () => {
    await tresVariantesConTresSituaciones();

    const antes = await TiendanubeTienda.findOne({ where: { empresa_id: datos.empresaA.id } });
    // La fixture la deja sin reconciliar nunca: es lo que la pantalla muestra
    // para que la ausencia de la red se vea en vez de suponerse.
    expect(antes.reconciliada_en).toBeNull();

    await tiendanubeSincronizacion.reconciliar(datos.empresaA.id);

    const corrida = await TiendanubeCorrida.findOne({ where: { empresa_id: datos.empresaA.id } });

    expect(corrida.disparador).toBe('reconciliacion');
    expect(corrida.usuario_id).toBeNull();
    // `terminada_en` en null es «se cortó por la mitad», y la pantalla lo dibuja
    // distinto de «terminó sin fallas».
    expect(corrida.terminada_en).not.toBeNull();
    expect(corrida.mandadas).toBe(2);
    expect(corrida.fallidas).toBe(0);

    const tienda = await TiendanubeTienda.findOne({ where: { empresa_id: datos.empresaA.id } });
    expect(tienda.reconciliada_en).not.toBeNull();

    // Y la fecha del refresco quedó adelante de la que traía la fixture: escribir
    // `reconciliada_en` sobre la instancia que se cargó al principio devolvería la
    // fila a lo que decía hace veinte llamadas, y la pantalla mostraría una
    // instantánea de la semana pasada como si fuera de recién.
    expect(new Date(tienda.catalogo_refrescado_en).getTime())
      .toBeGreaterThan(new Date('2026-08-05T09:00:00.000Z').getTime());
  });

  it('el barrido borra los estados vencidos hace más de un día y NO los vivos ni los de ayer', async () => {
    const HORA = 60 * 60 * 1000;
    const hace = (ms) => new Date(Date.now() - ms);

    await TiendanubeEstadoOauth.create({
      token: 'v'.repeat(64), empresa_id: datos.empresaA.id, expira_en: hace(72 * HORA),
    });
    // Vencido hace doce horas: **no se borra**. El día de gracia es lo que
    // permite que el log siga distinguiendo «venció» de «no existe» mientras
    // alguien mira por qué no puede vincular.
    await TiendanubeEstadoOauth.create({
      token: 'w'.repeat(64), empresa_id: datos.empresaA.id, expira_en: hace(12 * HORA),
    });
    await TiendanubeEstadoOauth.create({
      token: 'x'.repeat(64), empresa_id: datos.empresaA.id, expira_en: new Date(Date.now() + HORA),
    });

    const res = await ejecutarTareas();

    expect(res.status).toBe(200);
    expect(res.body.tiendanube.estados_barridos).toBe(1);
    expect(await TiendanubeEstadoOauth.count()).toBe(2);
  });

  it('el barrido de corridas NO toca tiendanube_pedidos', async () => {
    const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    await TiendanubeCorrida.create({
      empresa_id: datos.empresaA.id,
      empezada_en: hace(200),
      terminada_en: hace(200),
      disparador: 'manual',
      mandadas: 3,
      fallidas: 0,
    });
    await TiendanubeCorrida.create({
      empresa_id: datos.empresaA.id,
      empezada_en: hace(10),
      terminada_en: hace(10),
      disparador: 'manual',
      mandadas: 1,
      fallidas: 0,
    });

    await TiendanubePedido.create({
      empresa_id: datos.empresaA.id,
      tiendanube_order_id: 9001,
      numero: '1001',
      recibido_en: hace(200),
      punto_de_venta_id: datos.norteA.id,
      items: [],
      items_descontados: 0,
      items_sin_descontar: 0,
    });

    const res = await ejecutarTareas();

    expect(res.body.tiendanube.corridas_barridas).toBe(1);
    expect(await TiendanubeCorrida.count({ where: { empezada_en: { [Op.lt]: hace(90) } } })).toBe(0);

    // ⚠ **La mitad que importa.** Un pedido borrado es un pedido que se puede
    // volver a descontar si TiendaNube reintenta un webhook viejo: la fila **es**
    // la idempotencia. Si alguien copia la consulta del barrido de corridas y le
    // cambia el nombre de la tabla, esto se pone en rojo.
    expect(await TiendanubePedido.count()).toBe(1);
  });

  it('una tienda que falla no se lleva puestas ni a las demás ni a los barridos', async () => {
    // B está vinculada y **no tiene token**: su refresco falla. Sin el `try` por
    // tienda, la excepción se llevaría los dos barridos y la reconciliación de
    // todas las que vinieran después.
    await tresVariantesConTresSituaciones();

    await TiendanubeEstadoOauth.create({
      token: 'y'.repeat(64),
      empresa_id: datos.empresaA.id,
      expira_en: new Date(Date.now() - 72 * 60 * 60 * 1000),
    });

    const res = await ejecutarTareas();

    expect(res.status).toBe(200);
    expect(res.body.tiendanube.tiendas).toBe(2);
    expect(res.body.tiendanube.encoladas).toBe(2);
    expect(res.body.tiendanube.estados_barridos).toBe(1);

    // Y las suscripciones siguieron corriendo: el cron hacía eso antes de que
    // TiendaNube existiera y no puede dejar de hacerlo por un tercero caído.
    expect(res.body.ok).toBe(true);

    const deA = await TiendanubeTienda.findOne({ where: { empresa_id: datos.empresaA.id } });
    const deB = await TiendanubeTienda.findOne({ where: { empresa_id: datos.empresaB.id } });

    expect(deA.reconciliada_en).not.toBeNull();
    // La que falló **no** dice que se reconcilió: sería una fecha que miente.
    expect(deB.reconciliada_en).toBeNull();
  });
});
