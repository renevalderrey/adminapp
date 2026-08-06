// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  El material fiscal no sale por el cable, y no entra por la puerta de atrás
//
//  ── Por qué esto NO lo puede contestar `settingsSecretos.test.js` ──
//
//  Ese archivo levanta el router con los dobles de `helpers/modelosFalsos.js` y
//  un `req.empresa` armado a mano. Alcanza para afirmar que el handler filtra,
//  pero deja tres cosas afuera, y las tres son las que fallaron alguna vez:
//
//  1. **La mezcla con `empresa.settings`.** El handler arranca de un objeto que
//     sale del JSONB de la empresa y le encima las filas. Ese JSONB lo escribe
//     el onboarding y **la empresa real lo tiene cargado**; el doble le pasa
//     `{}`. Si un `afip_key` viviera ahí —o si alguien lo copiara ahí— el filtro
//     por nombre de fila no lo vería y el test con dobles seguiría en verde.
//  2. **El cuerpo serializado de verdad**, con la respuesta que sale por el
//     socket. `-----BEGIN` es una cadena: la única forma honesta de afirmar que
//     no viaja es leer el cuerpo entero que se envió (FR-074).
//  3. **Que el `PUT` rechazado no escriba.** Con un doble, «no escribió» es «no
//     se llamó al doble». Acá se relee la fila de Postgres, que es lo que
//     quedaría escrito de verdad.
//
//  ── La fixture está armada para poder distinguir el defecto ──
//
//  · `afip_environment` se siembra **con valor** (`homologation`). Sin esa fila,
//    un `PUT` que fallara al crear pero funcionara al actualizar pasaría el
//    caso: «no hay fila» se ve igual que «no se escribió». Con la fila cargada,
//    lo que se afirma es que **el valor no cambió**.
//  · El PEM sembrado es un bloque `-----BEGIN PRIVATE KEY-----` real en su
//    forma, con saltos de línea. Un valor corto como `'secreto'` no ejercita la
//    afirmación que importa, que es sobre esa cadena exacta.
//  · La empresa B tiene **su propio** material fiscal cargado. Si el filtro se
//    escribiera como «sacá las filas de esta empresa» y el `where` se rompiera,
//    el PEM de B aparecería en la respuesta de A y el caso lo ve.
//  · Hay un `afip_cuit` cargado: sin una clave no secreta, un handler que
//    devolviera un objeto vacío pasaría todos los casos de fuga.
// ════════════════════════════════════════════

const { Setting } = modelos;

/** Un PEM con la forma real: lo que se afirma es que esta cadena no viaja. */
const CLAVE_PRIVADA_A = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDeLaDeLaDeLaDe',
  'LaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDeLaDe',
  '-----END PRIVATE KEY-----',
].join('\n');

const CLAVE_PRIVADA_B = CLAVE_PRIVADA_A.replace('DeLaDe', 'DelKiosco');

const CERTIFICADO_A = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDdzCCAl+gAwIBAgIEbdelaPanaderiaDelCentroQueFirmaSusComprobantes',
  '-----END CERTIFICATE-----',
].join('\n');

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();

  await Setting.bulkCreate([
    { key: 'afip_key', empresa_id: datos.empresaA.id, value: CLAVE_PRIVADA_A },
    { key: 'afip_cert', empresa_id: datos.empresaA.id, value: CERTIFICADO_A },
    { key: 'afip_cuit', empresa_id: datos.empresaA.id, value: '30111111118' },
    { key: 'afip_environment', empresa_id: datos.empresaA.id, value: 'homologation' },
    { key: 'afip_pv', empresa_id: datos.empresaA.id, value: '3' },
    { key: 'tiendanube_access_token', empresa_id: datos.empresaA.id, value: 'tn_token_de_la_panaderia' },
    // El material fiscal de la OTRA empresa, cargado de verdad.
    { key: 'afip_key', empresa_id: datos.empresaB.id, value: CLAVE_PRIVADA_B },
  ]);
});

afterAll(async () => {
  await cerrar();
});

/** El valor que hay hoy en la base para una clave de la empresa A. */
async function valorGuardado(key) {
  const fila = await Setting.findOne({ where: { key, empresa_id: datos.empresaA.id } });
  return fila ? fila.value : null;
}

describe('GET /api/settings · la clave privada no viaja por el cable', () => {
  it('la cadena -----BEGIN no aparece en NINGUNA parte del cuerpo (FR-074)', async () => {
    // No es un `not.toHaveProperty` con otro nombre: lo que se lee es el cuerpo
    // entero tal como salió, así que también cubre el valor anidado, renombrado
    // o metido adentro de otro campo. Es la afirmación que la pantalla necesita
    // que sea cierta antes de volver a llamar a este endpoint al montar.
    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('-----BEGIN');
    expect(JSON.stringify(res.body)).not.toContain('tn_token_de_la_panaderia');
  });

  it('tampoco viaja la clave de la OTRA empresa', async () => {
    // El filtro es por nombre de clave, no por empresa, así que este caso no
    // puede fallar solo... salvo que alguien lo reescriba como una lista de
    // filas propias. Ahí el PEM de B entraría por el `where` roto y nadie lo
    // vería: el de A ya no está para delatarlo.
    const res = await request(app).get('/api/settings');

    expect(JSON.stringify(res.body)).not.toContain('DelKiosco');
  });

  it('sigue trayendo lo que no es secreto, y las banderas de lo que sí', async () => {
    // Sin esto, un handler que devolviera `{}` pasaría los dos casos de arriba y
    // dejaría la pantalla de Ajustes sin un solo dato.
    const res = await request(app).get('/api/settings');

    expect(res.body.data.afip_cuit).toBe('30111111118');
    expect(res.body.data.afip_key_cargado).toBe(true);
    expect(res.body.data.afip_cert_cargado).toBe(true);
    expect(res.body.data.tiendanube_access_token_cargado).toBe(true);
  });

  it('el ambiente y el punto de venta SÍ salen: la pantalla los necesita', async () => {
    // Es la diferencia entre las dos listas. Si `afip_environment` cayera en
    // `SETTINGS_SECRETOS` —que es la simplificación tentadora— la pantalla
    // recibiría `afip_environment_cargado: true` y no tendría cómo decir si la
    // empresa está facturando contra homologación, que es justo el aviso que
    // evita emitir comprobantes sin validez fiscal creyendo que son reales.
    const res = await request(app).get('/api/settings');

    expect(res.body.data.afip_environment).toBe('homologation');
    expect(res.body.data.afip_pv).toBe('3');
  });
});

describe('GET /api/settings/:key · pedirla por su nombre tampoco la trae', () => {
  it('la clave privada vuelve nula, y el PEM no está en el cuerpo (FR-071)', async () => {
    const res = await request(app).get('/api/settings/afip_key');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('-----BEGIN');
  });

  it('pero dice que está cargada: que exista no es el secreto', async () => {
    const res = await request(app).get('/api/settings/afip_key');

    expect(res.body.cargado).toBe(true);
  });
});

describe('PUT /api/settings/:key · el ambiente no se cambia por la puerta de atrás', () => {
  it('pasar a producción responde 400 y la fila sigue en homologación (FR-072)', async () => {
    // Es el caso completo, y lo que lo hace distinguible es que la fila EXISTE
    // antes: si el `PUT` se colara, el valor guardado quedaría en 'production' y
    // la empresa pasaría a emitir comprobantes fiscales reales —numeración
    // correlativa consumida, sin nota de crédito para deshacerlo— sin haber
    // pasado por ninguna validación.
    const res = await request(app)
      .put('/api/settings/afip_environment')
      .send({ value: 'production' });

    expect(res.status).toBe(400);
    expect(await valorGuardado('afip_environment')).toBe('homologation');
  });

  it('el punto de venta tampoco se puede cambiar por acá', async () => {
    const res = await request(app)
      .put('/api/settings/afip_pv')
      .send({ value: '9' });

    expect(res.status).toBe(400);
    expect(await valorGuardado('afip_pv')).toBe('3');
  });

  it('la clave privada tampoco se escribe por acá, y no pisa la que hay', async () => {
    // La mitad que `01fc77d` ya cerró, ejecutada contra Postgres: lo que
    // importa no es solo el 400 sino que la clave buena siga siendo la buena. Un
    // `PUT` que escribiera basura encima dejaría a la empresa sin poder firmar y
    // sin copia, porque la clave del CSR no se guarda del lado del servidor.
    const res = await request(app)
      .put('/api/settings/afip_key')
      .send({ value: 'no-es-una-clave' });

    expect(res.status).toBe(400);
    expect(await valorGuardado('afip_key')).toBe(CLAVE_PRIVADA_A);
  });

  it('la evidencia de la verificación no se puede escribir a mano', async () => {
    // `afip_verificacion` es lo que va a cumplir el paso 4 del checklist de
    // puesta en marcha. Si el cliente la pudiera escribir, el checklist diría
    // «circuito verificado» sin que AFIP haya contestado nunca.
    const res = await request(app)
      .put('/api/settings/afip_verificacion')
      .send({ value: { resultado: 'ok' } });

    expect(res.status).toBe(400);
    expect(await valorGuardado('afip_verificacion')).toBeNull();
  });

  it('una clave de configuración normal se sigue escribiendo', async () => {
    // El contrapeso. Sin este caso, un `if` que rechazara todo dejaría la
    // pantalla de Ajustes sin poder guardar nada y los cinco casos de arriba
    // seguirían en verde.
    const res = await request(app)
      .put('/api/settings/margin_efectivo')
      .send({ value: '45' });

    expect(res.status).toBe(200);
    expect(await valorGuardado('margin_efectivo')).toBe('45');
  });
});
