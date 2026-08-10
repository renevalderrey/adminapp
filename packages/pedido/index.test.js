import { describe, it, expect } from 'vitest';
import { normalizarTelefono, textoDelPedido, enlaceDeWhatsapp } from './index.js';

// ════════════════════════════════════════════
//  El teléfono argentino · los casos que rompen el enlace
//
//  Estos casos existen porque un número mal normalizado **no falla**: WhatsApp
//  acepta el enlace y abre un chat con otra persona. El comercio no se entera de
//  que perdió el pedido, y el que lo recibe no sabe de qué le hablan.
// ════════════════════════════════════════════

describe('normalizarTelefono', () => {
  it('un celular con 0 y 15 pierde los dos y gana el 9', () => {
    // 0342 15 5123456 → 549 342 5123456. Es el formato en que la gente lo
    // escribe y el que WhatsApp necesita.
    expect(normalizarTelefono('0342 15 5123456')).toBe('5493425123456');
    expect(normalizarTelefono('(0342) 15-512-3456')).toBe('5493425123456');
  });

  it('el 15 sólo se saca si lo que queda son diez dígitos', () => {
    // El código de área tiene 2, 3 o 4 dígitos según la ciudad. Sacar el 15 sin
    // mirar el largo mutila números que no lo tenían.
    expect(normalizarTelefono('011 15 5123 4567')).toBe('5491151234567');
  });

  it('un número que ya viene internacional no se toca', () => {
    expect(normalizarTelefono('5493425123456')).toBe('5493425123456');
    expect(normalizarTelefono('+54 9 342 512-3456')).toBe('5493425123456');
    expect(normalizarTelefono('005493425123456')).toBe('5493425123456');
  });

  it('devuelve null en vez de inventar un número', () => {
    // Es mejor no ofrecer el botón que abrir un chat con alguien que no es el
    // comercio.
    expect(normalizarTelefono('')).toBeNull();
    expect(normalizarTelefono(null)).toBeNull();
    expect(normalizarTelefono('sin números')).toBeNull();
    expect(normalizarTelefono('1234')).toBeNull();
  });
});

// ════════════════════════════════════════════
//  El texto, que lo arma el SERVIDOR
// ════════════════════════════════════════════

const PEDIDO = {
  numero: 1042,
  total: '82668.00',
  envio_costo: '0.00',
  entrega: 'retiro_socio',
  medio_pago: 'efectivo',
  comprador_nombre: 'Martina Olivera',
  comprador_telefono: '5491154782210',
  comprador_nro_socio: 'F-4412',
};

const LINEAS = [
  { nombre: 'Whey Protein Isolate 1kg', cantidad: 1, subtotal: '38868.00' },
  { nombre: 'Creatina Monohidrato 300g', cantidad: 2, subtotal: '43800.00' },
];

const CATALOGO = { nombre_visible: 'Comprafit / Fitnet', whatsapp_destino: '1144029915' };

describe('textoDelPedido', () => {
  it('lleva el número, las líneas con su subtotal y el total', () => {
    const texto = textoDelPedido(PEDIDO, LINEAS, CATALOGO);

    expect(texto).toContain('#1042');
    expect(texto).toContain('1× Whey Protein Isolate 1kg');
    expect(texto).toContain('2× Creatina Monohidrato 300g');
    expect(texto).toContain('$82.668');
  });

  it('no muestra el envío cuando es cero', () => {
    // Un renglón «Envío: $0» le hace pensar al comercio que hay que despachar.
    expect(textoDelPedido(PEDIDO, LINEAS, CATALOGO)).not.toContain('Envío:');

    const conEnvio = { ...PEDIDO, entrega: 'envio', envio_costo: '2500.00', envio_direccion: 'Av. Rivadavia 4821' };
    const texto = textoDelPedido(conEnvio, LINEAS, CATALOGO);

    expect(texto).toContain('Envío: $2.500');
    expect(texto).toContain('Av. Rivadavia 4821');
  });

  it('nombra la entrega y el pago en castellano, no con el código del enum', () => {
    const texto = textoDelPedido(PEDIDO, LINEAS, CATALOGO);

    expect(texto).toContain('Retiro en el gimnasio');
    expect(texto).toContain('Efectivo al retirar');
    expect(texto).not.toContain('retiro_socio');
  });

  it('lleva al comprador y su número de socio', () => {
    const texto = textoDelPedido(PEDIDO, LINEAS, CATALOGO);

    expect(texto).toContain('Martina Olivera');
    expect(texto).toContain('F-4412');
  });
});

describe('enlaceDeWhatsapp', () => {
  it('arma el enlace con el destino normalizado', () => {
    const enlace = enlaceDeWhatsapp(PEDIDO, LINEAS, CATALOGO);

    expect(enlace.startsWith('https://wa.me/5491144029915?text=')).toBe(true);
    expect(decodeURIComponent(enlace)).toContain('#1042');
  });

  it('sin número de destino devuelve null, y NO un enlace sin destinatario', () => {
    // Que el WhatsApp no salga no puede afectar al pedido, que ya existe en la
    // base. La pantalla dibuja el botón sólo si hay enlace.
    expect(enlaceDeWhatsapp(PEDIDO, LINEAS, {})).toBeNull();
    expect(enlaceDeWhatsapp(PEDIDO, LINEAS, { whatsapp_destino: 'no es un número' })).toBeNull();
  });
});
