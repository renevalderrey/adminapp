// ════════════════════════════════════════════
//  El teléfono argentino y el enlace de WhatsApp de un pedido
//
//  ── Por qué un segundo paquete ──
//
//  Esto vivía en `apps/web/src/utils/pedidoWhatsapp.js` y lo necesitan **tres**
//  lugares que no se pueden importar entre sí:
//
//   · el servidor, para normalizar el teléfono del comprador al guardar el
//     pedido —si se guardara como venga, el aviso no llega—;
//   · el servidor otra vez, para armar el enlace de WhatsApp con los nombres y
//     los precios **congelados** del pedido, que son los que el comercio tiene
//     que leer;
//   · `apps/tienda`, que es otra app y no puede importar de `apps/web`.
//
//  Es la misma decisión que `packages/precios`, con el mismo motivo: dos copias
//  de una regla son dos reglas, y la que se desincroniza no avisa.
//
//  CommonJS y sin paso de build, igual que el otro: `apps/api` lo hace `require`
//  sin transpilación, y las apps de Vite lo declaran en `optimizeDeps.include`.
// ════════════════════════════════════════════

/**
 * El teléfono en formato internacional, sin signos.
 *
 * wa.me lo exige así: `5493425123456`. Los teléfonos se cargan como venga —con
 * 0, con 15, con guiones, con paréntesis— así que hay que normalizar o el
 * enlace no abre el chat.
 *
 * @returns {string|null} `null` si no queda un número usable. Es mejor abrir
 *   WhatsApp sin destinatario que abrir un chat con alguien que no es el
 *   comercio.
 */
function normalizarTelefono(telefono, codigoPais = '54') {
  if (!telefono) return null;

  let digitos = String(telefono).replace(/\D/g, '');
  if (!digitos) return null;

  // 00 delante es el prefijo internacional escrito a la vieja usanza.
  if (digitos.startsWith('00')) digitos = digitos.slice(2);

  // Ya viene con código de país.
  if (digitos.startsWith(codigoPais) && digitos.length >= 12) return digitos;

  // El 0 de larga distancia no va en el formato internacional.
  if (digitos.startsWith('0')) digitos = digitos.slice(1);

  // El 15 tampoco.
  //
  // En Argentina un celular se escribe 0342 15 5123456, y en formato
  // internacional es 549 342 5123456: se caen el 0 y el 15, y aparece un 9.
  // Dejar el 15 puesto genera un número de trece dígitos que WhatsApp acepta
  // como enlace pero abre un chat con alguien que no es el comercio.
  //
  // El código de área tiene 2, 3 o 4 dígitos según la ciudad, así que se prueban
  // las tres posiciones y sólo se saca el 15 si lo que queda son los 10 dígitos
  // que tiene un número nacional.
  if (digitos.length > 10) {
    for (const largoArea of [2, 3, 4]) {
      const esQuince = digitos.slice(largoArea, largoArea + 2) === '15';

      if (esQuince && digitos.length - 2 === 10) {
        digitos = digitos.slice(0, largoArea) + digitos.slice(largoArea + 2);
        break;
      }
    }
  }

  // Un número argentino sin el 9 no recibe mensajes de WhatsApp.
  if (codigoPais === '54' && !digitos.startsWith('9')) digitos = `9${digitos}`;

  const completo = `${codigoPais}${digitos}`;

  // Menos de 12 con el código de país no es un teléfono.
  return completo.length >= 12 ? completo : null;
}

/**
 * El número como se lee: `#1042`.
 *
 * El numeral es **de presentación y no se guarda**, y el formato tiene que ser
 * el mismo en las seis superficies —confirmación, bandeja, panel lateral, los dos
 * emails y el WhatsApp— o el comprador que dice «mi pedido A-1042» y el vendedor
 * que busca «1042» están hablando de lo mismo sin saberlo.
 *
 * La letra de la maqueta (`#A-1042`) se descartó: los ocho ejemplos compartían la
 * `A` siendo de dos catálogos distintos, así que no significaba nada.
 */
const numeroDePedido = (numero) => `#${numero}`;

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

const ENTREGAS = {
  retiro_socio: 'Retiro en el gimnasio',
  retiro_local: 'Retiro en el local',
  envio: 'Envío a domicilio',
  coordinar: 'A coordinar por WhatsApp',
};

const PAGOS = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo al retirar',
};

/**
 * El texto del pedido, tal como lo va a leer el comercio.
 *
 * Lo arma **el servidor**, con los nombres y los precios congelados en las
 * líneas del pedido. Si lo armara el navegador con lo que tiene en memoria, el
 * mensaje podría decir un precio y la base otro — y el que discute con el
 * cliente es el mensaje.
 */
function textoDelPedido(pedido, lineas = [], catalogo = {}) {
  const partes = [];

  partes.push(`*Pedido ${numeroDePedido(pedido.numero)}*`);
  if (catalogo.nombre_visible) partes.push(catalogo.nombre_visible);
  partes.push('');

  for (const l of lineas) {
    partes.push(`• ${l.cantidad}× ${l.nombre} — ${pesos(l.subtotal)}`);
  }

  partes.push('');
  if (Number(pedido.envio_costo) > 0) {
    partes.push(`Envío: ${pesos(pedido.envio_costo)}`);
  }
  partes.push(`*Total: ${pesos(pedido.total)}*`);
  partes.push('');

  partes.push(`Entrega: ${ENTREGAS[pedido.entrega] || pedido.entrega}`);
  if (pedido.entrega === 'envio' && pedido.envio_direccion) {
    const donde = [pedido.envio_direccion, pedido.envio_localidad, pedido.envio_cp]
      .filter(Boolean)
      .join(', ');
    partes.push(donde);
  }

  partes.push(`Pago: ${PAGOS[pedido.medio_pago] || pedido.medio_pago}`);
  partes.push('');

  partes.push(`${pedido.comprador_nombre} — ${pedido.comprador_telefono}`);
  if (pedido.comprador_nro_socio) partes.push(`Socio ${pedido.comprador_nro_socio}`);
  if (pedido.notas) partes.push(`Nota: ${pedido.notas}`);

  return partes.join('\n');
}

/**
 * El enlace de wa.me, o `null` si no hay a quién mandarlo.
 *
 * `null` y no un enlace sin destinatario: que el WhatsApp no salga **no puede**
 * afectar al pedido, que ya existe en la base. La pantalla dibuja el botón sólo
 * si hay enlace.
 */
function enlaceDeWhatsapp(pedido, lineas, catalogo = {}) {
  const destino = normalizarTelefono(catalogo.whatsapp_destino);
  if (!destino) return null;

  const texto = textoDelPedido(pedido, lineas, catalogo);
  return `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`;
}

module.exports = {
  normalizarTelefono,
  numeroDePedido,
  textoDelPedido,
  enlaceDeWhatsapp,
  ENTREGAS,
  PAGOS,
};
