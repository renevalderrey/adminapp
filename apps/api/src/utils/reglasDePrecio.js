const { normalizarTexto } = require('./textoDeBusqueda');

// ════════════════════════════════════════════
//  El motor de reglas de precio de un catálogo
//
//  Función pura: no toca la base, no toca el reloj, no toca la red. Recibe los
//  productos del catálogo y sus reglas, y devuelve los precios y la cobertura.
//
//  ── Por qué «gana la más específica» no tiene empates ──
//
//  La base tiene **cuatro índices únicos parciales**, uno por ámbito
//  (`uq_regla_catalogo`, `uq_regla_categoria`, `uq_regla_marca`,
//  `uq_regla_producto`). O sea que para un catálogo dado no puede haber dos
//  reglas del mismo ámbito con el mismo objetivo.
//
//  Consecuencia: **un producto tiene como mucho cuatro candidatas, una por
//  ámbito**. «La más específica» es un máximo sobre cuatro elementos con una
//  escala fija, y no hay ningún empate que haya que desempatar inventando una
//  regla de desempate que después nadie sepa explicar.
//
//  Las otras tres son las «pisadas», y se devuelven: la pantalla las muestra
//  tachadas debajo de la que ganó, que es lo que hace entendible el sistema.
//
//  ── Por qué la cobertura sale de la misma pasada ──
//
//  La pantalla muestra «gana en 2 de 4» por regla. Lo ingenuo es, por cada
//  regla, recorrer los productos: eso es O(R × P) y hay que repetirlo en cada
//  pedido de pantalla.
//
//  Acá son dos pasadas: una sobre las reglas arma el índice —O(R)—, y una sobre
//  los productos hace cuatro búsquedas en `Map` e incrementa dos contadores por
//  regla: `alcanza` en cada candidata y `gana` sólo en la ganadora —O(P)—.
//  Total **O(R + P)**, y la cobertura sale **gratis**.
//
//  ── El universo de la cobertura son los productos DEL CATÁLOGO ──
//
//  No el inventario entero. Si `alcanza` contara productos que la
//  previsualización no muestra, las dos pantallas dirían números distintos
//  sobre lo mismo y ninguna de las dos estaría equivocada, que es peor.
// ════════════════════════════════════════════

/**
 * La escala de especificidad. Más alto gana.
 *
 * Está acá arriba y con nombre porque invertirla es el error silencioso de este
 * módulo: los precios seguirían saliendo, sólo que mal, y la pantalla mostraría
 * un descuento general pisando un precio negociado.
 */
const ESPECIFICIDAD = {
  producto: 4,
  marca: 3,
  categoria: 2,
  catalogo: 1,
};

const AMBITOS = Object.keys(ESPECIFICIDAD);
const TIPOS = ['porcentaje_descuento', 'monto_descuento', 'precio_fijo'];

/**
 * La clave con la que una regla entra al índice de su ámbito.
 *
 * Devuelve `null` cuando el objetivo falta, y ese caso importa: `String(undefined)`
 * da `'undefined'`, que es una cadena perfectamente válida como clave de un
 * `Map`. Una regla de marca sin `brand_id` se habría indexado bajo
 * `'undefined'`, no habría alcanzado a nadie —ningún producto genera esa
 * clave— y `validarRegla` la habría dado por buena. La fila existiría, no
 * haría nada, y nadie sabría por qué.
 */
function claveDeRegla(regla) {
  const texto = (v) => (v === null || v === undefined || v === '' ? null : String(v));

  switch (regla.ambito) {
    case 'producto': return texto(regla.product_id);
    case 'marca': return texto(regla.brand_id);
    case 'categoria': {
      const normalizada = normalizarTexto(regla.categoria);
      return normalizada === '' ? null : normalizada;
    }
    case 'catalogo': return '*';
    default: return null;
  }
}

/** La clave con la que un producto busca en el índice de un ámbito. */
function claveDelProducto(producto, ambito) {
  switch (ambito) {
    case 'producto': return String(producto.id);
    case 'marca': return producto.brand_id == null ? null : String(producto.brand_id);
    case 'categoria': return normalizarTexto(producto.category);
    case 'catalogo': return '*';
    default: return null;
  }
}

/**
 * ¿Esta regla se puede guardar?
 *
 * Lo que se valida acá es **al guardar**, no al aplicar. Es la diferencia entre
 * rechazar una regla imposible en el formulario —donde alguien puede
 * corregirla— y descubrirla el día que un producto sale a la calle a $0.
 *
 * @returns {{ ok: boolean, motivo?: string }}
 */
function validarRegla(regla = {}) {
  if (!AMBITOS.includes(regla.ambito)) {
    return { ok: false, motivo: 'El ámbito de la regla no es uno de los cuatro que existen.' };
  }

  if (!TIPOS.includes(regla.tipo)) {
    return { ok: false, motivo: 'El tipo de la regla no es uno de los tres que existen.' };
  }

  // La columna del ámbito, y ninguna otra. Es lo mismo que exige el CHECK
  // `ck_regla_ambito` de la base; acá se contesta con un mensaje que se puede
  // mostrar en vez de con un error de Postgres.
  if (claveDeRegla(regla) === null) {
    return { ok: false, motivo: 'Falta indicar a qué se aplica la regla.' };
  }

  const valor = Number(regla.valor);
  if (!Number.isFinite(valor)) {
    return { ok: false, motivo: 'El valor de la regla tiene que ser un número.' };
  }

  if (regla.tipo === 'porcentaje_descuento') {
    // Abierto en 0 y cerrado en 100: un descuento del 0 % es una regla que no
    // hace nada —y que igual pisa a las menos específicas, que es peor que no
    // tenerla—, y más de 100 % no significa nada.
    if (valor <= 0 || valor > 100) {
      return { ok: false, motivo: 'El porcentaje de descuento tiene que estar entre 1 y 100.' };
    }
  }

  if (regla.tipo === 'monto_descuento' && valor <= 0) {
    return { ok: false, motivo: 'El monto de descuento tiene que ser mayor que cero.' };
  }

  if (regla.tipo === 'precio_fijo' && valor <= 0) {
    // Un precio fijo de $0 publica un producto gratis en una página sin login.
    return { ok: false, motivo: 'El precio fijo tiene que ser mayor que cero.' };
  }

  return { ok: true };
}

/**
 * El precio que deja una regla sobre un precio de lista.
 *
 * La única guarda que queda al aplicar es `Math.max(0, …)`, con la misma forma
 * que `precioConDescuento` de `packages/precios`: lo demás ya lo rechazó
 * `validarRegla` al guardar. Un precio negativo es peor que uno en cero — el
 * carrito lo sumaría restando.
 */
function aplicarRegla(precioLista, regla) {
  const base = Number(precioLista) || 0;
  const valor = Number(regla?.valor) || 0;

  switch (regla?.tipo) {
    case 'porcentaje_descuento':
      return Math.max(0, Math.round(base * (1 - valor / 100)));
    case 'monto_descuento':
      return Math.max(0, Math.round(base - valor));
    case 'precio_fijo':
      return Math.max(0, Math.round(valor));
    default:
      return Math.round(base);
  }
}

/**
 * De todas las candidatas de un producto, la que manda.
 *
 * @param {object[]} candidatas Como mucho cuatro, una por ámbito.
 * @returns {{ gana: object|null, pisadas: object[] }}
 */
function reglaQueGana(candidatas = []) {
  const vivas = candidatas.filter(Boolean);
  if (vivas.length === 0) return { gana: null, pisadas: [] };

  let gana = vivas[0];
  for (const regla of vivas) {
    if (ESPECIFICIDAD[regla.ambito] > ESPECIFICIDAD[gana.ambito]) gana = regla;
  }

  return { gana, pisadas: vivas.filter((r) => r !== gana) };
}

/**
 * Los precios de todos los productos del catálogo, y la cobertura de cada regla.
 *
 * @param {Array<{id, brand_id, category, precioLista}>} productos Los del catálogo.
 * @param {Array<object>} reglas Las del catálogo. Las inactivas se ignoran.
 * @returns {{
 *   porProducto: Map<number, { precio, precioLista, gana, pisadas }>,
 *   cobertura: Map<number, { alcanza, gana }>,
 * }}
 */
function resolverPrecios(productos = [], reglas = []) {
  // ── Pasada 1: el índice, O(R) ──
  //
  // Un Map por ámbito. La base garantiza que no hay dos reglas con la misma
  // clave en el mismo ámbito, así que no se pierde ninguna al indexar.
  const indice = { producto: new Map(), marca: new Map(), categoria: new Map(), catalogo: new Map() };
  const cobertura = new Map();

  for (const regla of reglas) {
    // Una regla desactivada se comporta como si no existiera: ni aplica, ni
    // pisa, ni cuenta. Es distinto de borrarla —se puede volver a encender sin
    // recordar qué decía— y por eso no se filtra antes de llegar acá.
    if (regla.activo === false) continue;

    const clave = claveDeRegla(regla);
    // Una regla de marca cuya marca se borró queda con `brand_id` en NULL: no
    // alcanza a nadie, se dibuja «0 de 0» y no se borra sola.
    if (clave === null) {
      cobertura.set(regla.id, { alcanza: 0, gana: 0 });
      continue;
    }

    indice[regla.ambito].set(clave, regla);
    cobertura.set(regla.id, { alcanza: 0, gana: 0 });
  }

  // ── Pasada 2: los productos, O(P) ──
  const porProducto = new Map();

  for (const producto of productos) {
    const candidatas = [];

    for (const ambito of AMBITOS) {
      const clave = claveDelProducto(producto, ambito);
      if (clave === null) continue;

      const regla = indice[ambito].get(clave);
      if (regla) candidatas.push(regla);
    }

    const { gana, pisadas } = reglaQueGana(candidatas);

    // `alcanza` en cada candidata, `gana` sólo en la ganadora. Los dos números
    // salen de este mismo recorrido, así que no pueden contradecirse.
    for (const regla of candidatas) cobertura.get(regla.id).alcanza += 1;
    if (gana) cobertura.get(gana.id).gana += 1;

    const precioLista = Number(producto.precioLista) || 0;

    porProducto.set(producto.id, {
      precioLista,
      precio: gana ? aplicarRegla(precioLista, gana) : Math.round(precioLista),
      gana: gana || null,
      pisadas,
    });
  }

  return { porProducto, cobertura };
}

module.exports = {
  ESPECIFICIDAD,
  AMBITOS,
  TIPOS,
  validarRegla,
  aplicarRegla,
  reglaQueGana,
  resolverPrecios,
};
