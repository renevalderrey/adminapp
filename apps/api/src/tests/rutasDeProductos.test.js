// ════════════════════════════════════════════
//  El campo que se podía completar y no hacía nada
//
//  `products.tiendanube_variant_id` existe desde la migración `20260603`, está
//  en el modelo (`Product.js:86`) y estaba en `CAMPOS_EDITABLES`
//  (`routes/products.js:44`): cualquiera con `products.editar` lo escribía
//  desde el panel de producto. **No lo lee nadie** — el único mapeo que usan el
//  webhook y la sincronización de TiendaNube es la tabla
//  `tiendanube_mappings`—, así que quien lo completaba esperando que el stock
//  se sincronizara esperaba para siempre, y el sistema le decía que había
//  guardado bien. Es la misma familia de error que `sendEmail` devolviendo
//  `ok: true` sin enviar nada: no falla, miente.
//
//  Las dos mitades de la corrección, y las dos están acá:
//
//   1. **Ya no se escribe.** El campo sale de la lista blanca.
//   2. **Lo que ya estaba cargado se sigue leyendo.** No se borra la columna ni
//      se limpian los valores: un dato que desaparece sin que nadie diga que
//      desapareció es el peor de los dos casos.
//
//  Los dobles de `helpers/modelosFalsos` alcanzan de sobra: lo que se afirma es
//  qué columnas toca un `update`, y eso no depende del motor.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { crearModelo } = require('./helpers/modelosFalsos');

const mockProduct = crearModelo([]);
const mockBrand = crearModelo([]);
const mockStock = crearModelo([]);
const mockRecipe = crearModelo([]);
const mockRecipeItem = crearModelo([]);
const mockProductCostHistory = crearModelo([]);
const mockSupplier = crearModelo([]);
const mockUsuario = crearModelo([]);

// `findScoped` normaliza el id contra la clave primaria del modelo. Sin esto,
// el `501` que llega como texto en la URL no coincidiría nunca con el 501 del
// array y **todo daría 404** — incluido el camino legítimo, que es como una
// prueba de este tipo pasa por el motivo equivocado.
mockProduct.primaryKeyAttribute = 'id';
mockProduct.rawAttributes = { id: { type: { key: 'INTEGER' } } };

// `PUT /:id` abre una transacción antes de buscar el producto. El doble no
// tiene que hacer nada con ella: solo existir, para que el handler pueda
// confirmarla o revertirla.
const mockSequelize = {
  transaction: async () => ({
    async commit() {},
    async rollback() {},
  }),
};

jest.mock('../models', () => ({
  Product: mockProduct,
  Brand: mockBrand,
  Stock: mockStock,
  Recipe: mockRecipe,
  RecipeItem: mockRecipeItem,
  ProductCostHistory: mockProductCostHistory,
  Supplier: mockSupplier,
  Usuario: mockUsuario,
  sequelize: mockSequelize,
}));

const EMPRESA = 7;

function levantarApi() {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = EMPRESA;
    req.id = 'req-de-prueba';
    siguiente();
  });
  api.use('/api/products', require('../routes/products'));
  return api;
}

// El valor que ya estaba cargado y el que se intenta escribir son **distintos**
// y ninguno es cero ni null: con los dos iguales, «se ignoró» y «se escribió»
// dejan la fila igual y el test pasa con y sin la corrección.
const VARIANTE_YA_CARGADA = 88123;
const VARIANTE_QUE_SE_INTENTA = 99999;

beforeEach(() => {
  mockProduct.filas = [
    {
      id: 501,
      empresa_id: EMPRESA,
      name: 'Colágeno hidrolizado',
      sku: 'COL-300',
      cost: 1234.56,
      is_active: true,
      tiendanube_variant_id: VARIANTE_YA_CARGADA,
    },
  ];

  for (const doble of [mockProduct, mockBrand, mockStock, mockRecipeItem]) {
    doble.llamadas = [];
  }
});

describe('PUT /api/products/:id ignora tiendanube_variant_id', () => {
  it('manda el campo junto con uno editable: cambia el editable y la variante NO', async () => {
    const res = await request(levantarApi())
      .put('/api/products/501')
      .send({
        name: 'Colágeno hidrolizado x 300 g',
        tiendanube_variant_id: VARIANTE_QUE_SE_INTENTA,
      });

    expect(res.status).toBe(200);

    const fila = mockProduct.filas[0];

    // La mitad que prueba que el request llegó de verdad al `update`. Sin
    // ella, un 404, un rollback o una ruta mal montada dejarían la variante
    // intacta por accidente y el test pasaría sin haber ejercitado nada.
    expect(fila.name).toBe('Colágeno hidrolizado x 300 g');

    expect(fila.tiendanube_variant_id).toBe(VARIANTE_YA_CARGADA);
    expect(fila.tiendanube_variant_id).not.toBe(VARIANTE_QUE_SE_INTENTA);
  });

  it('manda SOLO el campo muerto: responde 200 y no cambia nada', async () => {
    // Es lo que manda el panel de producto cuando alguien toca ese campo y
    // nada más. Que responda 200 y no 400 es deliberado: la lista blanca
    // ignora lo que no está, no lo rechaza, y romper ese contrato haría fallar
    // guardados que hoy funcionan.
    const antes = { ...mockProduct.filas[0] };

    const res = await request(levantarApi())
      .put('/api/products/501')
      .send({ tiendanube_variant_id: VARIANTE_QUE_SE_INTENTA });

    expect(res.status).toBe(200);
    expect(mockProduct.filas[0]).toEqual(antes);
  });

  it('la respuesta devuelve el valor viejo, no el que se mandó', async () => {
    // Si la respuesta trajera el valor nuevo, la pantalla lo mostraría como
    // guardado hasta el próximo refresco: la misma mentira, con un rodeo.
    const res = await request(levantarApi())
      .put('/api/products/501')
      .send({ tiendanube_variant_id: VARIANTE_QUE_SE_INTENTA });

    expect(res.body.data.tiendanube_variant_id).toBe(VARIANTE_YA_CARGADA);
  });
});

describe('el valor que ya estaba cargado sigue estando', () => {
  it('GET /api/products/:id lo devuelve: la columna no se borró ni se limpió', async () => {
    const res = await request(levantarApi()).get('/api/products/501');

    expect(res.status).toBe(200);
    expect(res.body.data.tiendanube_variant_id).toBe(VARIANTE_YA_CARGADA);
  });

  it('sigue en la fila después de editar el producto por otro motivo', async () => {
    // La otra forma de perderlo sin decirlo: una «limpieza» que ponga la
    // columna en null al guardar. Este caso se pone en rojo si aparece.
    await request(levantarApi())
      .put('/api/products/501')
      .send({ sku: 'COL-300-B' });

    expect(mockProduct.filas[0].sku).toBe('COL-300-B');
    expect(mockProduct.filas[0].tiendanube_variant_id).toBe(VARIANTE_YA_CARGADA);
  });
});

// ── Guardias estáticas: la columna no se borra ──
//
// Los dos casos de arriba corren sobre dobles en memoria, y un doble no sabe
// nada de lo que hizo una migración: si alguien agregara un `DROP COLUMN`,
// seguirían los dos en verde. Lo que de verdad sostiene «la columna se queda»
// es esto, y por eso está escrito acá y no dado por hecho.

const MODELO_PRODUCT = fs.readFileSync(path.join(__dirname, '..', 'models', 'Product.js'), 'utf8');
const DIR_MIGRACIONES = path.join(__dirname, '..', 'migrations');

/** El `up` de una migración: todo lo que está antes de su `down`. */
function soloElUp(fuente) {
  const marca = fuente.search(/async\s+down\s*\(|down\s*:\s*async/);
  return marca === -1 ? fuente : fuente.slice(0, marca);
}

describe('la columna dejó de ser escribible, no de existir', () => {
  it('sigue declarada en models/Product.js', () => {
    expect(MODELO_PRODUCT).toMatch(/tiendanube_variant_id\s*:\s*\{/);
  });

  // La muestra que dice que el recorte separa de verdad las dos mitades. Si
  // `soloElUp` devolviera el archivo entero, el caso de abajo nombraría a
  // `20260603` —que borra la columna en su `down`, como corresponde— y alguien
  // lo cerraría con una excepción.
  it('el recorte distingue el up del down', () => {
    const fuente = fs.readFileSync(
      path.join(DIR_MIGRACIONES, '20260603-add-tiendanube-variant-id.js'),
      'utf8'
    );

    expect(soloElUp(fuente)).toContain("addColumn('products', 'tiendanube_variant_id'");
    expect(soloElUp(fuente)).not.toContain('removeColumn');
    expect(fuente).toContain("removeColumn('products', 'tiendanube_variant_id')");
  });

  it('ninguna migración la borra al aplicarse: sacarla de la lista blanca es reversible, un DROP COLUMN no', () => {
    const archivos = fs.readdirSync(DIR_MIGRACIONES).filter((n) => n.endsWith('.js'));

    // Ancla: sin esto, un cambio de carpeta dejaría la guardia recorriendo una
    // lista vacía y pasando por vacío.
    expect(archivos.length).toBeGreaterThan(10);

    const culpables = archivos.filter((nombre) => {
      const up = soloElUp(fs.readFileSync(path.join(DIR_MIGRACIONES, nombre), 'utf8'));

      return /removeColumn\(\s*['"]products['"]\s*,\s*['"]tiendanube_variant_id['"]/.test(up)
        || /DROP\s+COLUMN[^;]*tiendanube_variant_id/i.test(up);
    });

    expect(culpables).toEqual([]);
  });
});
