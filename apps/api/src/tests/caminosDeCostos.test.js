// ════════════════════════════════════════════
//  Los cinco caminos que cambian un costo, todos registrados
//
//  Hay cinco lugares que escriben `products.cost`: la edición manual, la carga
//  masiva, la actualización masiva de precios (con su deshacer), la importación
//  de listas de proveedor y la recepción de órdenes de producción. Antes de esta
//  funcionalidad:
//
//   - **dos no registraban nada** —la importación y la carga masiva—, que son
//     justamente los que más costos mueven. La pantalla de historial existiría y
//     estaría vacía en el caso principal, que es la lista del proveedor. Eso es
//     peor que no tener la pantalla: una pantalla vacía se lee como «nunca
//     cambió nada», no como «esto no se registra»;
//   - los tres que sí registraban lo hacían sin `empresa_id` y sin autor;
//   - cada uno escribía su motivo como texto suelto, así que «cuántos costos
//     cambiaron por importación» no se podía contestar.
//
//  Estos tests miran el código fuente porque lo que protegen es estructural: que
//  ningún camino vuelva a escribir en `product_cost_history` por su cuenta.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

const leer = (...partes) => fs.readFileSync(path.join(SRC, ...partes), 'utf8');

const PRODUCTS = leer('routes', 'products.js');
const IMPORT = leer('routes', 'import.js');
const PRECIOS = leer('services', 'preciosService.js');
const PRODUCTION = leer('services', 'productionService.js');
const COST = leer('services', 'costService.js');
const RUTA_PRECIOS = leer('routes', 'precios.js');
const RUTA_PRODUCTION = leer('routes', 'production.js');

/**
 * El código sin sus comentarios.
 *
 * Las afirmaciones en negativo tienen que mirar el código y no la prosa que
 * explica por qué está así: si no, el comentario que documenta una decisión
 * hace fallar el test que la protege.
 */
function sinComentarios(fuente) {
  return fuente
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/** El texto entre dos marcas del archivo. */
function entre(fuente, inicio, fin) {
  const i = fuente.indexOf(inicio);
  const j = fuente.indexOf(fin, i);

  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThan(i);

  return fuente.slice(i, j);
}

const PUT_PRODUCTO = entre(PRODUCTS, "router.put('/:id'", "router.delete('/:id'");
const POST_BULK = entre(PRODUCTS, "router.post('/bulk'", "router.get('/:id/cost-history'");

describe('PUT /api/products/:id — la edición manual', () => {
  it('registra por utils/historialDeCostos y no con un create suelto', () => {
    expect(PUT_PRODUCTO).toMatch(/registrarCambioDeCosto\(/);
    expect(PUT_PRODUCTO).not.toMatch(/ProductCostHistory\.create/);
  });

  it('lleva el autor y el motivo tipado', () => {
    expect(PUT_PRODUCTO).toMatch(/motivo: MOTIVOS\.EDICION_MANUAL/);
    expect(PUT_PRODUCTO).toMatch(/usuarioId: autorDe\(req\)/);
  });

  it('el motivo NO es una cadena escrita a mano', () => {
    // Con textos libres alcanza con que alguien escriba «Edicion manual» sin
    // acento para que la mitad de las filas del mismo origen deje de contarse.
    expect(PUT_PRODUCTO).not.toMatch(/reason:\s*'/);
  });

  it('sigue adentro de la transacción del cambio de costo', () => {
    // Sin la transacción, la fila de historial sobrevive al rollback del cambio
    // que dice haber registrado: el panel mostraría un cambio que no ocurrió.
    expect(PUT_PRODUCTO).toMatch(/registrarCambioDeCosto\(\{[\s\S]*?transaction: t,/);
  });

  it('la propagación en cascada sigue colgando de que HAYA habido cambio', () => {
    // Recostear las recetas cuando el costo no se movió es trabajo inútil
    // dentro de la transacción del usuario, y además dejaría filas de recosteo
    // por un cambio que no existió.
    expect(PUT_PRODUCTO).toMatch(/if \(registrada\)/);
    expect(PUT_PRODUCTO).toMatch(/recalculateCascadingCosts/);
  });

  it('la lista blanca de campos editables sigue entera', () => {
    // Es lo que impide que un request armado a mano mande `empresa_id` y mueva
    // el producto a otra empresa cliente (commit 99f1982). Esta tarea no la
    // toca, y que siga acá es parte de que no la haya tocado.
    expect(PRODUCTS).toMatch(/const CAMPOS_EDITABLES = \[/);
    expect(PUT_PRODUCTO).toMatch(/product\.update\(camposEditables\(req\.body\)/);
  });
});

describe('POST /api/products/bulk — la carga masiva', () => {
  it('registra el historial, que antes no escribía NADA', () => {
    expect(POST_BULK).toMatch(/registrarCambioDeCosto\(/);
    expect(POST_BULK).toMatch(/motivo: MOTIVOS\.CARGA_MASIVA/);
    expect(POST_BULK).toMatch(/usuarioId: autorDe\(req\)/);
  });

  it('el costo anterior se lee ANTES del update', () => {
    // Después del update la instancia ya tiene el valor nuevo: `old_cost`
    // saldría igual a `new_cost` y la fila diría que no pasó nada.
    const lectura = POST_BULK.indexOf('const costoAnterior');
    const escritura = POST_BULK.indexOf('await product.update(');
    const registro = POST_BULK.indexOf('registrarCambioDeCosto');

    expect(lectura).toBeGreaterThanOrEqual(0);
    expect(escritura).toBeGreaterThan(lectura);
    expect(registro).toBeGreaterThan(escritura);
  });
});

describe('POST /api/import/products — la importación de listas', () => {
  it('registra el historial, que antes no escribía NADA', () => {
    // Es el camino que más costos mueve: una lista de 200 líneas dejaba cero
    // filas. Es el criterio de éxito 9 y el motivo por el que la pantalla de la
    // historia 6 quedaría inútil justo en el caso principal.
    expect(IMPORT).toMatch(/registrarCambioDeCosto\(/);
    expect(IMPORT).toMatch(/motivo: MOTIVOS\.IMPORTACION/);
    expect(IMPORT).toMatch(/usuarioId: req\.usuario \? req\.usuario\.id : null/);
  });

  it('el costo anterior se lee ANTES del update', () => {
    const lectura = IMPORT.indexOf('const costoAnterior');
    const escritura = IMPORT.indexOf('await product.update(productData)');
    const registro = IMPORT.indexOf('registrarCambioDeCosto({');

    expect(lectura).toBeGreaterThanOrEqual(0);
    expect(escritura).toBeGreaterThan(lectura);
    expect(registro).toBeGreaterThan(escritura);
  });

  it('los importes se leen con aNumero y NO con parseFloat', () => {
    // `parseFloat('1.234,50')` devuelve 1.234: mil veces menos, y no falla
    // nada. El producto queda cargado y el margen que muestra el POS es
    // mentira hasta que alguien lo compara contra la factura del proveedor.
    expect(IMPORT).toMatch(/const toNum = \(v\) => \{ const n = aNumero\(v\)/);
    expect(IMPORT).not.toMatch(/const n = parseFloat\(v\)/);
    expect(IMPORT).toMatch(/require\('\.\.\/utils\/importes'\)/);
  });

  it('el CSV se lee con raw: true, o aNumero no llega a ver el texto', () => {
    // Con `raw: false` el lector de xlsx adivina el tipo de cada celda **antes**
    // de que el handler la vea, y adivina mal justo con el formato argentino:
    // `"1.234,50"` le sale el número `1.2345`. Comprobado contra la API real —
    // el producto quedaba con costo 1,23— y es el motivo por el que cambiar
    // `parseFloat` por `aNumero` solo, sin esto, no arreglaba nada.
    const lectura = entre(IMPORT, "if (ext === '.csv')", 'sheet_to_json');

    expect(lectura).toMatch(/XLSX\.read\(content, \{ type: 'string', raw: true \}\)/);
  });

  it('el null de aNumero se traduce a undefined: una celda vacía NO pone el costo en cero', () => {
    // `aNumero` devuelve `null` para la celda vacía y el resto del handler
    // distingue «no vino» (`undefined`) de «vino un número». Dejando pasar el
    // `null`, `cost !== undefined` daría verdadera y el costo quedaría en NULL
    // — la misma pérdida que ponerlo en cero, que es lo que FR-099 corrigió.
    expect(IMPORT).toMatch(/return n === null \? undefined : n/);
    expect(IMPORT).toMatch(/if \(cost !== undefined\) productData\.cost = cost/);
  });
});

describe('GET /api/products/:id/cost-history — lo que la pantalla lee', () => {
  const HISTORIAL = entre(PRODUCTS, "router.get('/:id/cost-history'", "router.get('/:id/recipe'");

  it('sigue resolviendo el producto con findScoped antes de leer', () => {
    // El historial se filtraba SOLO por product_id: con el id de un producto de
    // otra empresa cliente se leía su evolución de costos completa.
    const scoping = HISTORIAL.indexOf('findScoped(Product');
    const lectura = HISTORIAL.indexOf('ProductCostHistory.findAndCountAll');

    expect(scoping).toBeGreaterThanOrEqual(0);
    expect(lectura).toBeGreaterThan(scoping);
  });

  it('el id de otra empresa da 404 y no 403', () => {
    // Un 403 confirma que el recurso existe en otra empresa y permite enumerar
    // ids ajenos.
    expect(HISTORIAL).toMatch(/res\.status\(404\)\.json\(\{ ok: false, error: 'Producto no encontrado' \}\)/);
    expect(HISTORIAL).not.toMatch(/status\(403\)/);
  });

  it('pagina con limit por defecto 10 y tope 100', () => {
    // Sin el tope, `?limit=999999` vuelve a traer el historial entero y la
    // paginación no protege de nada.
    expect(HISTORIAL).toMatch(/Math\.min\(limitPedido, 100\)/);
    expect(HISTORIAL).toMatch(/: 10;/);
    expect(HISTORIAL).toMatch(/offset,/);
  });

  it('devuelve el total, que es lo que la pantalla necesita para paginar', () => {
    expect(HISTORIAL).toMatch(/findAndCountAll/);
    expect(HISTORIAL).toMatch(/total: count/);
  });

  it('ordena por change_date DESC y por id DESC como SEGUNDO criterio', () => {
    // Dos cambios de la misma actualización masiva comparten `change_date` al
    // milisegundo. Sin un tercer criterio determinístico, la página 2 repite
    // una fila que ya salió en la 1 y se saltea otra que nunca aparece.
    expect(HISTORIAL).toMatch(/order: \[\['change_date', 'DESC'\], \['id', 'DESC'\]\]/);
  });

  it('incluye el usuario con required: false', () => {
    // Con `required: true` (INNER JOIN) **todo el historial anterior a esta
    // funcionalidad desaparecería**: esas filas tienen `usuario_id` en null.
    expect(HISTORIAL).toMatch(/as: 'usuario'/);
    expect(HISTORIAL).toMatch(/attributes: \['id', 'nombre', 'email'\]/);
    expect(HISTORIAL).toMatch(/required: false/);
    expect(sinComentarios(HISTORIAL)).not.toMatch(/required: true/);
  });
});

describe('preciosService — la actualización masiva y su deshacer', () => {
  it('los dos registros pasan por utils/historialDeCostos', () => {
    expect(PRECIOS).not.toMatch(/ProductCostHistory\.create/);
    expect(PRECIOS).toMatch(/motivo: motivoActualizacionMasiva\(/);
    expect(PRECIOS).toMatch(/motivo: motivoDeshacerMasiva\(actualizacion\.id\)/);
  });

  it('el texto sigue armándose con descripción o con el porcentaje', () => {
    // Es el mismo par de casos que ya estaba guardado: con descripción cargada
    // el motivo la lleva; sin ella, lleva el porcentaje aplicado.
    expect(PRECIOS).toMatch(/motivoActualizacionMasiva\(\{ descripcion, porcentaje: numero \}\)/);
  });

  it('lleva el id del usuario y no solo su nombre', () => {
    // El campo `usuario` de `ActualizacionPrecio` guarda el NOMBRE. Un nombre
    // no se puede juntar con `usuarios` y deja de identificar a nadie el día
    // que alguien se lo cambia.
    expect(PRECIOS).toMatch(/usuarioId: usuarioId \?\? null/);
    expect(RUTA_PRECIOS).toMatch(/usuarioId: req\.usuario\?\.id \?\? null/);
  });
});

describe('productionService — la recepción de una orden', () => {
  it('registra por utils/historialDeCostos con el motivo tipado', () => {
    expect(PRODUCTION).not.toMatch(/ProductCostHistory\.create/);
    expect(PRODUCTION).toMatch(/motivo: MOTIVOS\.ORDEN_DE_PRODUCCION/);
  });

  it('recibe el autor desde la ruta', () => {
    expect(PRODUCTION).toMatch(/createProductionOrder\(data, empresaId, puntoDeVentaId = null, usuarioId = null\)/);
    expect(RUTA_PRODUCTION).toMatch(/req\.usuario \? req\.usuario\.id : null/);
  });
});

describe('costService — el recosteo en cascada', () => {
  it('se distingue de una edición manual, que es lo que un hook no podría hacer', () => {
    // `recalculateCascadingCosts` actualiza costos dentro de la misma
    // transacción que abrió el usuario al tocar un insumo. Un `afterUpdate` los
    // registraría a todos como ediciones suyas.
    expect(COST).not.toMatch(/ProductCostHistory\.create/);
    expect(COST).toMatch(/MOTIVOS\.RECOSTEO_DE_RECETA/);
  });

  it('NO inventa un autor: el recosteo lo dispara el sistema', () => {
    // Firmarlo con el usuario que tocó el insumo diría que esa persona editó a
    // mano el costo de un producto que ni siquiera vio.
    const bloque = entre(COST, 'await registrarCambioDeCosto({', '});');

    expect(bloque).not.toMatch(/usuarioId/);
  });
});

describe('el umbral del centavo, en los cinco caminos', () => {
  it.each([
    ['services/costService.js', () => COST],
    ['services/productionService.js', () => PRODUCTION],
  ])('%s ya no compara con Math.abs(a - b) >= 0.01', (_, obtener) => {
    // Esa resta en punto flotante da 0.009999999999999787 para 1200 → 1200.01:
    // el cambio no se registraba. En estos dos archivos era peor todavía,
    // porque el `update` del costo colgaba de la MISMA condición y el producto
    // se quedaba con el costo viejo.
    expect(obtener()).not.toMatch(/Math\.abs\([^)]*\)\s*>=\s*0\.01/);
    expect(obtener()).toMatch(/esCambioSignificativo\(/);
  });
});

describe('nadie más escribe en product_cost_history', () => {
  // La regla que hace que el motivo tipado sirva: si un camino nuevo abre su
  // propio `create`, vuelve el texto libre y el conteo por origen deja de
  // cerrar sin que nada falle. Son los cinco caminos del checkpoint de la
  // fase 4.
  const ARCHIVOS = [
    ['routes/products.js', PRODUCTS],
    ['routes/import.js', IMPORT],
    ['services/preciosService.js', PRECIOS],
    ['services/productionService.js', PRODUCTION],
    ['services/costService.js', COST],
  ];

  it.each(ARCHIVOS)('%s no llama a ProductCostHistory.create', (_, contenido) => {
    expect(contenido).not.toMatch(/ProductCostHistory\.create/);
  });

  it('el único create vive en utils/historialDeCostos.js', () => {
    expect(leer('utils', 'historialDeCostos.js')).toMatch(/ProductCostHistory\.create\(/);
  });

  it('ningún camino escribe el motivo como cadena suelta', () => {
    // Si mañana alguien quiere contar «cuántos costos cambiaron por
    // importación», con textos libres no se puede: alcanza con una falta de
    // acento para que la mitad de las filas desaparezca del conteo.
    for (const [nombre, contenido] of ARCHIVOS) {
      expect([nombre, /reason:\s*['"`]/.test(contenido)]).toEqual([nombre, false]);
    }
  });
});
