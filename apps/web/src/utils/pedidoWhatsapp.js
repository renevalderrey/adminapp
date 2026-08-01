// ════════════════════════════════════════════
//  Exportar un pedido por WhatsApp
//
//  Es como Comprafit le pide a los proveedores, y era la función que más se
//  usaba del sistema anterior. Sin esto hay que copiar la lista a mano al
//  celular, que es donde se cuelan los errores: un producto que se saltea, una
//  cantidad mal tipeada.
//
//  El texto se arma agrupado por marca porque así lo lee el proveedor, que
//  suele representar a varias.
// ════════════════════════════════════════════

/** Formatea un importe en pesos, sin decimales cuando son cero. */
function pesos(n) {
  const numero = Number(n) || 0;

  return numero.toLocaleString('es-AR', {
    minimumFractionDigits: numero % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Deja solo los dígitos de un teléfono y le agrega el código de país.
 *
 * wa.me exige el número en formato internacional sin signos: "5493425123456".
 * Los teléfonos se cargan como venga —con 0, con 15, con guiones, con
 * paréntesis— así que hay que normalizar o el enlace no abre el chat.
 *
 * @returns {string|null} null si no queda un número usable.
 */
export function normalizarTelefono(telefono, codigoPais = '54') {
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
  // como enlace pero abre un chat con alguien que no es el proveedor.
  //
  // El código de área tiene 2, 3 o 4 dígitos según la ciudad, así que se
  // prueban las tres posiciones y solo se saca el 15 si lo que queda son los
  // 10 dígitos que tiene un número nacional.
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

  // Menos de 10 dígitos no es un teléfono: mejor abrir WhatsApp sin
  // destinatario que abrir un chat con un número inventado.
  return completo.length >= 12 ? completo : null;
}

/**
 * Arma el texto del pedido.
 *
 * @param {object} opciones
 * @param {Array}  opciones.items      [{ nombre, cantidad, marca, costo }]
 * @param {string} [opciones.proveedor]
 * @param {boolean}[opciones.conPrecios] Si incluye costos y total estimado.
 * @param {string} [opciones.nota]
 * @param {string} [opciones.titulo]
 */
export function armarTextoPedido({
  items = [],
  proveedor = '',
  conPrecios = false,
  nota = '',
  titulo = 'PEDIDO',
} = {}) {
  const fecha = new Date().toLocaleDateString('es-AR');

  let texto = `*${titulo} · ${fecha}*\n`;
  if (proveedor) texto += `Proveedor: ${proveedor}\n`;
  texto += '\n';

  const porMarca = new Map();

  for (const item of items) {
    const marca = item.marca || 'Sin marca';
    if (!porMarca.has(marca)) porMarca.set(marca, []);
    porMarca.get(marca).push(item);
  }

  for (const [marca, deLaMarca] of porMarca) {
    texto += `*${marca}*\n`;

    for (const item of deLaMarca) {
      const cantidad = Number(item.cantidad) || 0;
      texto += `• ${item.nombre} — ${cantidad} u.`;

      if (conPrecios && Number(item.costo) > 0) {
        texto += ` ($${pesos(Number(item.costo) * cantidad)})`;
      }

      texto += '\n';
    }

    texto += '\n';
  }

  if (conPrecios) {
    const total = items.reduce(
      (suma, i) => suma + (Number(i.costo) || 0) * (Number(i.cantidad) || 0),
      0
    );

    if (total > 0) texto += `Total estimado: $${pesos(total)}\n`;
  }

  if (nota) texto += `\n${nota}\n`;

  return texto;
}

/**
 * Abre WhatsApp con el pedido escrito.
 *
 * Se abre en una pestaña nueva y no se envía nada solo: el usuario revisa el
 * texto y aprieta enviar. Mandar un pedido a un proveedor sin que nadie lo
 * mire es exactamente el tipo de automatismo que después hay que salir a
 * corregir por teléfono.
 */
export function enviarPedidoPorWhatsapp({ telefono, ...opciones }) {
  const texto = armarTextoPedido(opciones);
  const numero = normalizarTelefono(telefono);

  const url = numero
    ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/?text=${encodeURIComponent(texto)}`;

  window.open(url, '_blank', 'noopener,noreferrer');

  return { url, texto, conDestinatario: Boolean(numero) };
}
