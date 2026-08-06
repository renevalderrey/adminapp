// ════════════════════════════════════════════
//  Los endpoints de TiendaNube, contra dobles
//
//  El defecto que abre este archivo es el IDOR de `createMapping`:
//
//      const { product_id, … } = req.body;
//      const mapping = await TiendanubeMapping.create({
//        empresa_id: req.empresaId,
//        product_id,                    // ← nadie verifico de quien es
//        …
//      });
//
//  La empresa B mandaba el `product_id` de la A y recibia **201**. La fila
//  quedaba con el `empresa_id` de B, asi que revisando la tabla no se ve nada
//  raro: es exactamente la forma del defecto 1 de la funcionalidad 012, que
//  dfd7009 cerro en `POST /api/suppliers/:id/payments`.
//
//  Y el choque de cualquiera de los dos indices unicos —«ese producto ya esta
//  mapeado», «esa variante ya esta mapeada»— respondia el mismo 500 generico,
//  con lo cual el usuario no sabia que corregir.
//
//  ── Lo que este nivel NO contesta ──
//
//  Que la fila de la empresa A **siga ahi** despues del intento, y que la
//  unicidad la sostenga de verdad la base y no una comprobacion del handler.
//  Los dobles de `helpers/modelosFalsos.js` no entienden indices unicos —lo
//  dice su propio encabezado— asi que aca la unicidad se simula: lo que se
//  verifica es que el handler **traduzca** el choque a un 409 que nombre contra
//  que choco. Lo otro es el cuarto nivel, en
//  `integracion/tiendanubeAislamiento.integracion.test.js`.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const { crearModelo } = require('./helpers/modelosFalsos');

const PROPIA = 7;
const AJENA = 9;

// El token de la fixture NO es hexadecimal, y eso es deliberado: la respuesta
// trae `etag`, que es hexadecimal, y con un token hexadecimal cualquier ventana
// de cuatro caracteres podria coincidir por azar. Un test que falla una vez cada
// cien es un test que alguien termina borrando.
const TOKEN = 'tn_zqxv_kwmrupt_ghslnb_jyzdcvwx_kqmrtp';
const USER_ID = 8899;

/** El largo a partir del cual un pedazo del token ya lo identifica. */
const LARGO_RECONOCIBLE = 4;

/**
 * Los pedazos del token que aparecen en un texto.
 *
 * ⚠ `expect(cuerpo).not.toContain(TOKEN)` **no alcanza**, y es exactamente la
 * fixture con la que este proyecto ya se equivoco: FR-075 dice «ni entero, ni
 * truncado, ni los ultimos cuatro», y una respuesta con `token.slice(-8)`
 * —medido— pasa ese `toContain` sin que nada avise. Lo que hay que preguntar es
 * si queda algun pedazo reconocible, no si quedo el token completo.
 */
function pedazosDelToken(texto) {
  const encontrados = [];

  for (let i = 0; i + LARGO_RECONOCIBLE <= TOKEN.length; i++) {
    const pedazo = TOKEN.slice(i, i + LARGO_RECONOCIBLE);
    if (texto.includes(pedazo)) encontrados.push(pedazo);
  }

  return encontrados;
}

const mockSetting = crearModelo([]);
const mockProduct = crearModelo([]);
const mockStock = crearModelo([]);
const mockStockMovement = crearModelo([]);
const mockTiendanubeMapping = crearModelo([]);

// findScoped normaliza el id contra la clave primaria del modelo. Sin esto, un
// `product_id` que llega como '501' en el cuerpo no coincidiria nunca con el
// 501 del array y **todo** daria 404 —incluido el caso legitimo—, que es como
// una prueba de aislamiento pasa por el motivo equivocado.
for (const doble of [mockProduct, mockTiendanubeMapping]) {
  doble.primaryKeyAttribute = 'id';
  doble.rawAttributes = { id: { type: { key: 'INTEGER' } } };
}

/**
 * Los dos indices unicos de `tiendanube_mappings`, simulados.
 *
 * `uq_tn_mapping_product` sobre (empresa_id, product_id) y
 * `uq_tn_mapping_variant` sobre (empresa_id, tiendanube_variant_id). El doble
 * no sabe nada de indices: sin esto, el segundo mapeo se crearia sin protestar
 * y la rama del 409 —que es lo que este archivo verifica— **no se ejecutaria
 * nunca**. El test pasaria sin haber mirado nada.
 *
 * Que la restriccion exista de verdad en la base es otra afirmacion y va al
 * cuarto nivel.
 */
const crearMapeo = mockTiendanubeMapping.create.bind(mockTiendanubeMapping);
mockTiendanubeMapping.create = async (datos, opciones = {}) => {
  const choca = mockTiendanubeMapping.filas.some((f) =>
    f.empresa_id === datos.empresa_id &&
    (f.product_id === datos.product_id ||
     f.tiendanube_variant_id === datos.tiendanube_variant_id));

  if (choca) {
    const err = new Error('duplicate key value violates unique constraint "uq_tn_mapping_product"');
    err.name = 'SequelizeUniqueConstraintError';
    throw err;
  }

  return crearMapeo(datos, opciones);
};

jest.mock('axios');

jest.mock('../models', () => ({
  Setting: mockSetting,
  Product: mockProduct,
  Stock: mockStock,
  StockMovement: mockStockMovement,
  TiendanubeMapping: mockTiendanubeMapping,
}));

const axios = require('axios');

function levantarApi(empresaId) {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = empresaId;
    req.userId = 'auth0|quien-mapea';
    req.id = 'req-de-prueba';
    siguiente();
  });

  const { publico, privado } = require('../routes/tiendanube');
  api.use('/api/tiendanube', publico);
  api.use('/api/tiendanube', privado);

  return api;
}

const CLIENT_ID_ANTERIOR = process.env.TIENDANUBE_CLIENT_ID;

beforeEach(() => {
  process.env.TIENDANUBE_CLIENT_ID = '4321';

  mockProduct.filas = [
    { id: 501, empresa_id: PROPIA, name: 'Colágeno 300g' },
    { id: 502, empresa_id: PROPIA, name: 'Creatina 300g' },
    { id: 900, empresa_id: AJENA, name: 'Insumo de otro cliente' },
  ];
  mockSetting.filas = [
    { key: 'tiendanube_access_token', value: TOKEN, empresa_id: PROPIA },
    { key: 'tiendanube_user_id', value: USER_ID, empresa_id: PROPIA },
  ];
  mockStock.filas = [];
  mockTiendanubeMapping.filas = [];

  for (const doble of [mockSetting, mockProduct, mockStock, mockTiendanubeMapping]) {
    doble.llamadas = [];
  }

  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: [] });
  axios.put.mockResolvedValue({ data: {} });
});

afterAll(() => {
  if (CLIENT_ID_ANTERIOR === undefined) delete process.env.TIENDANUBE_CLIENT_ID;
  else process.env.TIENDANUBE_CLIENT_ID = CLIENT_ID_ANTERIOR;
});

const mapear = (empresaId, cuerpo) =>
  request(levantarApi(empresaId)).post('/api/tiendanube/mapping').send(cuerpo);

describe('POST /api/tiendanube/mapping · el producto es de quien lo manda', () => {
  it('con un product_id de otra empresa responde 404 y NO crea ninguna fila', async () => {
    const res = await mapear(PROPIA, {
      product_id: 900,
      tiendanube_variant_id: 998877,
      tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(404);
    // La otra mitad, y es la que importa: hoy respondia 201 y dejaba la fila.
    expect(mockTiendanubeMapping.filas).toEqual([]);
  });

  it('responde 404 y no 403: un 403 confirmaria que ese producto existe', async () => {
    const ajeno = await mapear(PROPIA, {
      product_id: 900, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });
    const inexistente = await mapear(PROPIA, {
      product_id: 999999, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(ajeno.status).toBe(404);
    expect(ajeno.status).not.toBe(403);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error).toBe(ajeno.body.error);
  });

  it('sigue creando el mapeo cuando el producto SI es de la empresa', async () => {
    // Sin este caso la validacion podria estar rechazando siempre, que es tan
    // inutil como no validar nada: dejaria la pantalla de mapeo sin forma de
    // mapear nada.
    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(201);
    expect(mockTiendanubeMapping.filas).toHaveLength(1);
    expect(mockTiendanubeMapping.filas[0]).toMatchObject({
      empresa_id: PROPIA,
      product_id: 501,
      tiendanube_variant_id: 998877,
      tiendanube_product_id: 5544,
    });
  });
});

describe('POST /api/tiendanube/mapping · los tres ids son enteros', () => {
  it('un product_id que no es entero responde 400 y no 500', async () => {
    // Antes llegaba hasta Postgres —«invalid input syntax for type integer»— y
    // volvia como el mismo 500 generico que cualquier otra falla: el usuario no
    // tenia forma de saber que lo que estaba mal era el dato que mando.
    const res = await mapear(PROPIA, {
      product_id: 'abc', tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(400);
    expect(mockTiendanubeMapping.filas).toEqual([]);
  });

  it('una variante que no es entera tambien responde 400', async () => {
    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 'v-998877', tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(400);
    expect(mockTiendanubeMapping.filas).toEqual([]);
  });

  it('los tres ids son obligatorios: sin el producto de TiendaNube responde 400', async () => {
    // La columna es NOT NULL. Sin la validacion, el INSERT fallaba contra la
    // base y salia como 500.
    const res = await mapear(PROPIA, { product_id: 501, tiendanube_variant_id: 998877 });

    expect(res.status).toBe(400);
    expect(mockTiendanubeMapping.filas).toEqual([]);
  });

  it('un id que viaja como texto numerico se acepta', async () => {
    // Un formulario manda strings. Sin esto, la validacion rechazaria el caso
    // normal y la pantalla no podria mapear nada.
    const res = await mapear(PROPIA, {
      product_id: '501', tiendanube_variant_id: '998877', tiendanube_product_id: '5544',
    });

    expect(res.status).toBe(201);
    expect(mockTiendanubeMapping.filas[0].product_id).toBe(501);
  });
});

describe('POST /api/tiendanube/mapping · el choque dice contra que choca', () => {
  it('el segundo mapeo del mismo producto responde 409 nombrando la variante con la que choca', async () => {
    await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 111222, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Colágeno 300g');
    // Nombra la variante ocupada: un 409 que dice «ya existe» sin decir cual
    // obliga a buscarla a mano en la tabla.
    expect(res.body.error).toContain('998877');
    expect(mockTiendanubeMapping.filas).toHaveLength(1);
  });

  it('el segundo mapeo de la misma variante responde 409 nombrando el producto con el que choca', async () => {
    await mapear(PROPIA, {
      product_id: 502, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(409);
    // El producto que ya tiene esa variante es el 502, no el que se mando.
    expect(res.body.error).toContain('Creatina 300g');
    expect(res.body.error).not.toContain('Colágeno 300g');
    expect(mockTiendanubeMapping.filas).toHaveLength(1);
  });

  it('los dos choques se distinguen entre si, y ninguno es el 500 generico', async () => {
    // Es la diferencia que el usuario tiene que ver: «cambiá la variante» y
    // «ese producto ya está» se corrigen de maneras distintas. Los dos
    // respondian «Error al crear el mapeo de producto» con status 500.
    await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    const porProducto = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 111222, tiendanube_product_id: 5544,
    });
    const porVariante = await mapear(PROPIA, {
      product_id: 502, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(porProducto.body.error).not.toBe(porVariante.body.error);
    for (const res of [porProducto, porVariante]) {
      expect(res.status).not.toBe(500);
      expect(res.body.error).not.toBe('Error al crear el mapeo de producto');
    }
  });

  it('el mapeo de OTRA empresa sobre la misma variante no choca', async () => {
    // Los dos indices son (empresa_id, …). Si el handler tradujera cualquier
    // fallo a un 409, dos clientes con la misma variante en tiendas distintas
    // se bloquearian entre si.
    await mapear(AJENA, {
      product_id: 900, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(201);
  });
});

describe('El token de TiendaNube no sale en ninguna respuesta', () => {
  // FR-075. El token vive en `settings.tiendanube_access_token` **en texto
  // plano** —cifrarlo es el proyecto 6 y no entra aca— asi que lo unico que
  // esta funcionalidad puede garantizar es no empeorarlo: que no salga por la
  // API, ni entero, ni truncado, ni «los ultimos cuatro».
  //
  // El caso donde mas facil se escapa es el error: axios adjunta la respuesta
  // del tercero al error, y el canje del `code` devuelve el token adentro. Por
  // eso la fixture hace fallar la llamada CON el token adentro del error: sin
  // eso, la prueba pasaria por no haber tenido nunca el token cerca.
  const conElTokenAdentro = () => {
    const err = new Error('Request failed with status code 401');
    err.response = { status: 401, data: { access_token: TOKEN, code: 'invalid_grant' } };
    return err;
  };

  it('ninguna respuesta de ningun endpoint contiene la cadena del token', async () => {
    const api = levantarApi(PROPIA);

    const respuestas = [
      await request(api).get('/api/tiendanube/auth'),
      await request(api).get('/api/tiendanube/status'),
      await request(api).get('/api/tiendanube/products'),
      await request(api).post('/api/tiendanube/sync-stock').send({}),
      await mapear(PROPIA, {
        product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
      }),
    ];

    // El ancla: si todas fallaran con 404 —por un montaje mal armado— ninguna
    // podria contener el token y la prueba pasaria sin haber mirado nada.
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200, 200, 201]);

    for (const res of respuestas) {
      expect(pedazosDelToken(JSON.stringify(res.body))).toEqual([]);
      expect(pedazosDelToken(JSON.stringify(res.headers))).toEqual([]);
    }
  });

  it('tampoco cuando la llamada a TiendaNube falla con el token adentro del error', async () => {
    axios.get.mockRejectedValue(conElTokenAdentro());
    axios.put.mockRejectedValue(conElTokenAdentro());

    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544 },
    ];
    mockStock.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: 31, quantity: 12, available: 12 },
    ];

    const api = levantarApi(PROPIA);
    const productos = await request(api).get('/api/tiendanube/products');
    const sincronizar = await request(api).post('/api/tiendanube/sync-stock').send({});

    // El ancla: los dos tienen que haber fallado de verdad, si no la prueba no
    // ejercita el camino del error.
    expect(productos.status).toBe(502);
    expect(sincronizar.status).toBe(502);

    for (const res of [productos, sincronizar]) {
      expect(pedazosDelToken(JSON.stringify(res.body))).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain('invalid_grant');
    }
  });
});
