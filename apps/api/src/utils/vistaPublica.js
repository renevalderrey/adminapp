// ════════════════════════════════════════════
//  Lo que sale por una respuesta pública, campo por campo
//
//  ── La regla, y por qué es ésta y no una lista negra ──
//
//  Todo lo que devuelve este archivo es un **objeto literal escrito a mano**.
//  Nada de copiar la fila y sacarle cosas.
//
//  El motivo no es el defecto de hoy: es el de dentro de dos meses. La columna
//  que la tabla gane el mes que viene entra sola a toda respuesta pública si
//  alguna se arma copiando, y nadie se entera hasta que alguien la lee desde
//  afuera. Una lista negra envejece; una lista blanca obliga a decidir cada vez.
//
//  Lo sostiene `tests/proyeccionPublica.test.js`, que se pone en rojo si acá
//  aparece un spread, un Object.assign, un toJSON, o el nombre de cualquiera de
//  los diez campos internos.
//
//  ── Las dos decisiones de forma ──
//
//  **1 · Lo que no hay se OMITE, no viaja como null.** Una clave presente con
//  valor nulo es exactamente cómo se dibuja «undefined» en una tarjeta: el
//  componente pregunta `producto.marca &&` y recibe null, que es falso, pero
//  cualquier `Object.entries` o cualquier render de lista lo pinta igual. El 96 %
//  de los productos migrables no tiene marca, así que este caso no es raro: es
//  el normal.
//
//  **2 · El precio tachado sale sólo si de verdad hay algo tachado.** Dos
//  condiciones juntas: el interruptor del catálogo encendido **y** el precio
//  final menor que el de lista. Mostrar «antes $1.000, ahora $1.000» no es un
//  detalle estético — es una promesa de descuento que no existe, en una página
//  que ve cualquiera.
// ════════════════════════════════════════════

/** El catálogo, tal como lo ve quien escanea el QR. */
function catalogoPublico(c) {
  const salida = {
    nombre: c.nombre_visible,
    color: c.color_marca,
    entrega: {
      retiro_socio: c.retiro_socio === true,
      retiro_socio_direccion: c.retiro_socio_direccion || null,
      retiro_local: c.retiro_local === true,
      envio: c.envio === true,
      envio_costo: Number(c.envio_costo) || 0,
      envio_gratis_desde: c.envio_gratis_desde === null || c.envio_gratis_desde === undefined
        ? null
        : Number(c.envio_gratis_desde),
      coordinar_whatsapp: c.coordinar_whatsapp === true,
    },
    pagos: {
      // Siempre en false en esta etapa: la pasarela llega después. Se declara
      // igual para que la tienda ya sepa leer la forma y no haya que tocarla.
      mercadopago: c.mp_habilitado === true,
      transferencia: Boolean(c.datos_transferencia && c.datos_transferencia.cbu),
      efectivo: true,
    },
    pide: {
      nro_socio: c.pide_nro_socio === true,
    },
  };

  // Omitidos, no nulos. Ver el encabezado.
  if (c.descripcion) salida.descripcion = c.descripcion;
  if (c.logo_url) salida.logo = c.logo_url;
  if (c.portada_url) salida.portada = c.portada_url;
  if (c.whatsapp_destino) salida.whatsapp = c.whatsapp_destino;

  // Los datos bancarios sólo si están completos: media transferencia es peor
  // que ninguna, porque el comprador la intenta igual.
  const banco = c.datos_transferencia || {};
  if (banco.cbu || banco.alias) {
    salida.transferencia = {
      titular: banco.titular || null,
      cbu: banco.cbu || null,
      alias: banco.alias || null,
      banco: banco.banco || null,
    };
  }

  return salida;
}

/**
 * Un producto de la grilla o de la ficha.
 *
 * @param {object} p La fila del producto, con lo que haya.
 * @param {object} extra `{ precio, precioLista, mostrarLista, agotado, marca }`,
 *   que salen del motor de precios y del stock, no de la fila.
 */
function productoPublico(p, extra = {}) {
  const precio = Number(extra.precio) || 0;
  const lista = Number(extra.precioLista) || 0;

  const salida = {
    id: p.id,
    nombre: p.name,
    precio,
    agotado: extra.agotado === true,
  };

  if (p.description) salida.descripcion = p.description;
  // Sin marca no va la clave. No va en null: así se dibuja «undefined» abajo del
  // nombre en la tarjeta.
  if (extra.marca) salida.marca = extra.marca;
  if (p.image_url) salida.imagen = p.image_url;
  if (p.category) salida.categoria = p.category;
  if (p.unit_type) salida.unidad = p.unit_type;

  // Las dos condiciones juntas, no una.
  if (extra.mostrarLista === true && lista > precio) {
    salida.precio_lista = lista;
    salida.ahorro_pct = Math.round((1 - precio / lista) * 100);
  }

  return salida;
}

/**
 * Lo que se le contesta a quien acaba de mandar un pedido.
 *
 * ⚠ El identificador interno del pedido **no viaja**. Lo que el comprador tiene
 * para referirse a su pedido es el número legible, y es lo único que necesita:
 * un identificador opaco en una respuesta pública es una superficie para
 * adivinar.
 */
function pedidoPublico(pedido, lineas = [], extra = {}) {
  const salida = {
    numero: pedido.numero,
    estado: pedido.estado,
    total: Number(pedido.total) || 0,
    envio_costo: Number(pedido.envio_costo) || 0,
    entrega: pedido.entrega,
    medio_pago: pedido.medio_pago,
    lineas: lineas.map((l) => ({
      nombre: l.nombre,
      cantidad: l.cantidad,
      precio_unitario: Number(l.precio_unitario) || 0,
      subtotal: Number(l.subtotal) || 0,
    })),
  };

  // Los tres que dependen de lo que pasó **después** del commit, y por eso
  // llegan como `extra` y no salen de la fila.
  //
  // `email_enviado` es lo que le permite a la pantalla **no prometer** un correo
  // que no salió: es `false` cuando el envío falló y también cuando el comprador
  // no dejó email. Un `fire and forget` haría imposible este campo, porque la
  // respuesta saldría antes de saber.
  if (extra.email_enviado !== undefined) salida.email_enviado = extra.email_enviado === true;
  if (extra.email) salida.email = extra.email;

  // El enlace de WhatsApp lo arma **el servidor**, con los nombres y los precios
  // congelados. Ausente cuando el catálogo no tiene número de destino: un botón
  // que abre WhatsApp sin destinatario es peor que ninguno.
  if (extra.whatsapp_url) salida.whatsapp = extra.whatsapp_url;

  return salida;
}

module.exports = { catalogoPublico, productoPublico, pedidoPublico };
