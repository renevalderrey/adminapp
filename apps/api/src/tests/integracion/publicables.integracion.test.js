// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  `PATCH /api/products/publicables` · el caso que la suite rápida no puede ver
//
//  ── Por qué esto no puede vivir en `npm run test:api` ──
//
//  Con `BYPASS_AUTH=true`, `server.js` clava `req.empresaId = 1` y
//  `checkPermission` llama a `next()` sin mirar. O sea que la acción masiva pasa
//  en verde **con el `empresa_id` en el `where` y sin él**: el único id de
//  empresa que existe en esa suite es el 1, así que no hay ninguna fila ajena
//  que marcar.
//
//  Acá hay dos empresas de verdad, y la pregunta se puede hacer ejecutándola:
//  con la sesión de A, ¿se puede marcar como publicable un producto de B?
//
//  ── Qué se cuenta, y por qué se cuenta y no se lee la respuesta ──
//
//  La respuesta del endpoint puede decir cualquier cosa. Lo que decide si hubo
//  fuga es **la fila de Postgres**, así que cada caso cuenta
//  `Product.count({ where: { empresa_id: B, publicable: true } })` antes y
//  después. Un endpoint que contestara `{ actualizados: 0 }` y hubiera escrito
//  igual pasaría el primer chequeo y no este.
//
//  ── Qué se revierte para verlo en rojo ──
//
//  Sacar `empresa_id` del `where` del `Product.update` de
//  `routes/products.js`. El segundo caso entra: `golosinaB` queda marcada.
// ════════════════════════════════════════════

beforeAll(async () => {
  await conectarOFallar();
});

afterAll(async () => {
  await cerrar();
});

describe('marcar productos como publicables', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarDosEmpresas();
  });

  it('la migración dejó a todos apagados: es el punto de partida', async () => {
    const { Product } = modelos;

    expect(await Product.count({ where: { publicable: true } })).toBe(0);
  });

  it('marca los productos propios y devuelve cuántos', async () => {
    const { Product } = modelos;
    const ids = [datos.harina.id, datos.levadura.id];

    const res = await request(app)
      .patch('/api/products/publicables')
      .send({ ids, publicable: true });

    expect(res.status).toBe(200);
    expect(res.body.data.actualizados).toBe(2);

    // Contra la base, no contra la respuesta.
    expect(await Product.count({
      where: { empresa_id: datos.empresaA.id, publicable: true },
    })).toBe(2);

    // Y `sal`, que no estaba en la lista, sigue apagada: la acción masiva marca
    // lo que se le pidió y no «todo lo de la empresa».
    await datos.sal.reload();
    expect(datos.sal.publicable).toBe(false);
  });

  it('con un id de otra empresa en la lista, la fila ajena no se toca', async () => {
    const { Product } = modelos;

    const antes = await Product.count({
      where: { empresa_id: datos.empresaB.id, publicable: true },
    });
    expect(antes).toBe(0);

    // La lista mezcla dos productos de A con el de B. Es exactamente lo que
    // manda un cliente que adivina ids: son enteros correlativos.
    const res = await request(app)
      .patch('/api/products/publicables')
      .send({
        ids: [datos.harina.id, datos.golosinaB.id, datos.levadura.id],
        publicable: true,
      });

    expect(res.status).toBe(200);

    // Se pidieron tres y se marcaron dos: el número que devuelve es el que pasó
    // de verdad, no el que se pidió.
    expect(res.body.data.pedidos).toBe(3);
    expect(res.body.data.actualizados).toBe(2);

    // Lo que decide: ninguna fila de B quedó marcada.
    expect(await Product.count({
      where: { empresa_id: datos.empresaB.id, publicable: true },
    })).toBe(0);

    await datos.golosinaB.reload();
    expect(datos.golosinaB.publicable).toBe(false);
  });

  it('desmarcar tampoco cruza empresas', async () => {
    const { Product } = modelos;

    // Se parte de las dos empresas con un producto marcado cada una, escrito
    // directo contra la base para no depender del endpoint que se está
    // probando.
    await Product.update({ publicable: true }, { where: { id: datos.harina.id } });
    await Product.update({ publicable: true }, { where: { id: datos.golosinaB.id } });

    const res = await request(app)
      .patch('/api/products/publicables')
      .send({ ids: [datos.harina.id, datos.golosinaB.id], publicable: false });

    expect(res.status).toBe(200);
    expect(res.body.data.actualizados).toBe(1);

    await datos.harina.reload();
    await datos.golosinaB.reload();

    expect(datos.harina.publicable).toBe(false);
    // La de B sigue como estaba: ni se marcó ni se desmarcó desde afuera.
    expect(datos.golosinaB.publicable).toBe(true);
  });

  it('una lista vacía o sin booleano no escribe nada', async () => {
    const { Product } = modelos;

    const sinIds = await request(app)
      .patch('/api/products/publicables')
      .send({ ids: [], publicable: true });
    expect(sinIds.status).toBe(400);

    const sinBooleano = await request(app)
      .patch('/api/products/publicables')
      .send({ ids: [datos.harina.id] });
    expect(sinBooleano.status).toBe(400);

    // «Falló» tiene que significar «no escribió»: un 400 que igual hubiera
    // marcado la fila sería peor que un 500.
    expect(await Product.count({ where: { publicable: true } })).toBe(0);
  });
});
