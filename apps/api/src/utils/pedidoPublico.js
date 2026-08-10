// ════════════════════════════════════════════
//  Lo que se acepta de un visitante sin sesión
//
//  Dos funciones puras. Las dos hacen lo mismo desde ángulos distintos: **tirar
//  lo que llegó del navegador y quedarse sólo con lo que el servidor necesita**.
//
//  ── `consolidarLineas` no valida el precio: lo hace inexistente ──
//
//  Devuelve `[{ product_id, cantidad }]` y **nada más**. Cualquier `precio`,
//  `precio_unitario`, `subtotal` o `total` que venga en el cuerpo se cae acá, y
//  el resto del handler no tiene desde dónde leerlo aunque quisiera.
//
//  Es distinto de validarlo. Una validación se puede olvidar en una rama nueva;
//  esto no, porque no hay dato que olvidar. El precio sale de `resolverPrecios`
//  contra la base o no sale.
// ════════════════════════════════════════════

const MAX_CANTIDAD = 999;
const MAX_LINEAS = 60;

/**
 * Las líneas del pedido, con el mismo producto repetido sumado.
 *
 * Sumar y no rechazar (FR-135): el carrito puede mandar el mismo `product_id`
 * dos veces por un reintento o por una pantalla que agregó de a uno, y eso no es
 * un error del comprador.
 *
 * @returns {{ok: true, lineas: Array<{product_id: number, cantidad: number}>} |
 *           {ok: false, error: string, mensaje: string}}
 */
function consolidarLineas(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'PEDIDO_VACIO', mensaje: 'El pedido no tiene productos.' };
  }

  if (items.length > MAX_LINEAS) {
    return {
      ok: false,
      error: 'DEMASIADAS_LINEAS',
      mensaje: `Un pedido no puede tener más de ${MAX_LINEAS} líneas.`,
    };
  }

  // Map y no objeto: las claves quedan numéricas y el orden es el de llegada, que
  // es el orden en que el comprador armó el carrito y el que va a leer el
  // comercio en el WhatsApp.
  const porProducto = new Map();

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'LINEA_INVALIDA', mensaje: 'Hay una línea que no es un producto.' };
    }

    // `Number.isInteger` sobre el valor crudo y no `parseInt`: `parseInt('7x')`
    // da 7 y `parseInt('1.9')` da 1, los dos en silencio.
    const productId = Number(item.product_id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return { ok: false, error: 'PRODUCTO_INVALIDO', mensaje: 'Hay una línea sin producto válido.' };
    }

    const cantidad = Number(item.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      return {
        ok: false,
        error: 'CANTIDAD_INVALIDA',
        mensaje: 'La cantidad tiene que ser un número entero mayor que cero.',
      };
    }

    const acumulada = (porProducto.get(productId) || 0) + cantidad;

    // El tope se mira **después** de sumar: mandar 500 y 500 del mismo producto
    // no puede esquivarlo.
    if (acumulada > MAX_CANTIDAD) {
      return {
        ok: false,
        error: 'CANTIDAD_INVALIDA',
        mensaje: `No se pueden pedir más de ${MAX_CANTIDAD} unidades de un producto.`,
      };
    }

    porProducto.set(productId, acumulada);
  }

  // El literal de dos claves. Acá muere todo lo demás que haya venido.
  const lineas = [...porProducto].map(([product_id, cantidad]) => ({ product_id, cantidad }));

  return { ok: true, lineas };
}

const texto = (v, max) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

const ENTREGAS = ['retiro_socio', 'retiro_local', 'envio', 'coordinar'];
const PAGOS = ['transferencia', 'efectivo'];

/**
 * Qué habilitó el catálogo para entregar.
 *
 * No alcanza con que el valor exista en el enum: el comprador no puede elegir
 * «envío a domicilio» en un catálogo que no hace envíos.
 */
const entregasDelCatalogo = (catalogo = {}) =>
  ENTREGAS.filter((e) => ({
    retiro_socio: catalogo.retiro_socio,
    retiro_local: catalogo.retiro_local,
    envio: catalogo.envio,
    coordinar: catalogo.coordinar_whatsapp,
  }[e] === true));

/**
 * Los datos del comprador, ya recortados a lo que se guarda.
 *
 * **Obligatorios: nombre y teléfono, y nada más** (FR-149). Email es opcional
 * —el aviso por mail es un extra, no un requisito—; el número de socio se pide
 * sólo si el catálogo lo pide, y aun así es declarativo.
 *
 * `dni` y `acepta_comunicaciones` **se descartan aunque vengan**: las columnas
 * existen, pero pedir un DNI sin Términos ni Política de Privacidad publicados
 * es juntar un dato personal sin base para tenerlo. La puerta se abre cuando
 * existan esos textos, no antes.
 *
 * @returns {{ok: true, comprador: object} | {ok: false, error: string, mensaje: string}}
 */
function validarComprador(comprador = {}, catalogo = {}) {
  const nombre = texto(comprador.nombre, 120);
  if (!nombre || nombre.length < 2) {
    return { ok: false, error: 'NOMBRE_REQUERIDO', mensaje: 'Falta tu nombre.' };
  }

  const telefono = texto(comprador.telefono, 30);
  // Seis dígitos es el piso de cualquier teléfono; la normalización a formato
  // internacional la hace `@favalio/pedido` después, contra el número ya
  // aceptado.
  if (!telefono || (telefono.match(/\d/g) || []).length < 6) {
    return { ok: false, error: 'TELEFONO_REQUERIDO', mensaje: 'Falta tu teléfono.' };
  }

  const entrega = texto(comprador.entrega, 20);
  const disponibles = entregasDelCatalogo(catalogo);

  if (!entrega || !disponibles.includes(entrega)) {
    return {
      ok: false,
      error: 'ENTREGA_INVALIDA',
      mensaje: 'Elegí una forma de entrega de las que ofrece el catálogo.',
    };
  }

  const medio_pago = texto(comprador.medio_pago, 20);
  if (!medio_pago || !PAGOS.includes(medio_pago)) {
    return { ok: false, error: 'PAGO_INVALIDO', mensaje: 'Elegí cómo vas a pagar.' };
  }

  const datos = {
    comprador_nombre: nombre,
    comprador_telefono: telefono,
    comprador_email: texto(comprador.email, 255),
    comprador_nro_socio: catalogo.pide_nro_socio ? texto(comprador.nro_socio, 40) : null,
    entrega,
    medio_pago,
    notas: texto(comprador.notas, 1000),
    envio_direccion: null,
    envio_localidad: null,
    envio_cp: null,
  };

  // Los tres campos del envío se exigen **sólo** con `entrega = 'envio'`. En un
  // retiro son ruido; peor, un formulario que los pide siempre hace que el que
  // retira invente una dirección para poder seguir.
  if (entrega === 'envio') {
    const direccion = texto(comprador.envio_direccion, 255);
    const localidad = texto(comprador.envio_localidad, 120);
    const cp = texto(comprador.envio_cp, 20);

    if (!direccion || !localidad || !cp) {
      return {
        ok: false,
        error: 'ENVIO_INCOMPLETO',
        mensaje: 'Para el envío hacen falta dirección, localidad y código postal.',
      };
    }

    datos.envio_direccion = direccion;
    datos.envio_localidad = localidad;
    datos.envio_cp = cp;
  }

  return { ok: true, comprador: datos };
}

module.exports = {
  consolidarLineas,
  validarComprador,
  entregasDelCatalogo,
  MAX_CANTIDAD,
  MAX_LINEAS,
};
