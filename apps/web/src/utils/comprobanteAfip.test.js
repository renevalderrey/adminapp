import { describe, it, expect } from 'vitest';
import {
  tipoDocumentoReceptor,
  numeroDocumentoReceptor,
  datosDelQr,
  urlDelQr,
  nombreComprobante,
  normalizarLinea,
} from './comprobanteAfip';

const BASE = {
  fecha: '2026-07-31',
  cuitEmisor: '20123456789',
  puntoDeVenta: 5,
  tipoComprobante: 6,
  numeroComprobante: 1234,
  importe: 15000,
  cae: '75012345678901',
};

describe('tipoDocumentoReceptor', () => {
  it('11 dígitos es CUIT (80)', () => {
    expect(tipoDocumentoReceptor('20123456789')).toBe(80);
    expect(tipoDocumentoReceptor('20-12345678-9')).toBe(80);
  });

  it('7 u 8 dígitos es DNI (96)', () => {
    expect(tipoDocumentoReceptor('12345678')).toBe(96);
    expect(tipoDocumentoReceptor('1234567')).toBe(96);
  });

  // Un CUIT mal tipeado no debe pasar como CUIT: ARCA rechaza el comprobante.
  it('un documento de largo raro cae en consumidor final (99)', () => {
    expect(tipoDocumentoReceptor('123456789')).toBe(99);
    expect(tipoDocumentoReceptor('2012345678')).toBe(99);
  });

  it('sin documento es consumidor final', () => {
    expect(tipoDocumentoReceptor('')).toBe(99);
    expect(tipoDocumentoReceptor(null)).toBe(99);
    expect(tipoDocumentoReceptor(undefined)).toBe(99);
  });
});

describe('numeroDocumentoReceptor', () => {
  it('devuelve el número sin separadores', () => {
    expect(numeroDocumentoReceptor('20-12345678-9')).toBe(20123456789);
  });

  it('consumidor final va con 0', () => {
    expect(numeroDocumentoReceptor('')).toBe(0);
    expect(numeroDocumentoReceptor('123456789')).toBe(0);
  });
});

describe('datosDelQr', () => {
  it('arma el objeto con las claves que exige la especificación', () => {
    const d = datosDelQr({ ...BASE, documentoReceptor: '20999888777' });

    expect(d).toEqual({
      ver: 1,
      fecha: '2026-07-31',
      cuit: 20123456789,
      ptoVta: 5,
      tipoCmp: 6,
      nroCmp: 1234,
      importe: 15000,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 20999888777,
      tipoCodAut: 'E',
      codAut: 75012345678901,
    });
  });

  it('los numéricos van como número, no como texto', () => {
    const d = datosDelQr(BASE);

    for (const campo of ['cuit', 'ptoVta', 'tipoCmp', 'nroCmp', 'importe', 'codAut']) {
      expect(typeof d[campo]).toBe('number');
    }
  });

  it('una venta a consumidor final va con tipo 99 y número 0', () => {
    const d = datosDelQr(BASE);

    expect(d.tipoDocRec).toBe(99);
    expect(d.nroDocRec).toBe(0);
  });
});

describe('urlDelQr', () => {
  it('devuelve la URL de ARCA con el payload en base64', () => {
    const url = urlDelQr(BASE);

    expect(url.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true);

    const b64 = url.split('?p=')[1];
    const decodificado = JSON.parse(atob(b64));

    expect(decodificado.cuit).toBe(20123456789);
    expect(decodificado.codAut).toBe(75012345678901);
    expect(decodificado.ver).toBe(1);
  });

  // Mejor no imprimir QR que imprimir uno que ARCA rechace al escanearlo.
  it.each([
    ['sin CAE', { cae: null }],
    ['sin CUIT del emisor', { cuitEmisor: '' }],
    ['sin fecha', { fecha: null }],
    ['sin número de comprobante', { numeroComprobante: null }],
  ])('devuelve null %s', (_nombre, override) => {
    expect(urlDelQr({ ...BASE, ...override })).toBeNull();
  });

  it('un importe de cero es válido: hay comprobantes en cero', () => {
    expect(urlDelQr({ ...BASE, importe: 0 })).not.toBeNull();
  });
});

describe('nombreComprobante', () => {
  it('nombra los tipos habituales', () => {
    expect(nombreComprobante(1)).toBe('FACTURA A');
    expect(nombreComprobante(6)).toBe('FACTURA B');
    expect(nombreComprobante(11)).toBe('FACTURA C');
  });

  // La versión anterior imprimía "FACTURA TIPO C" para todo lo que no fuera
  // 1 o 6, incluidas las notas de crédito.
  it('distingue las notas de crédito, que antes salían como factura', () => {
    expect(nombreComprobante(3)).toBe('NOTA DE CRÉDITO A');
    expect(nombreComprobante(8)).toBe('NOTA DE CRÉDITO B');
    expect(nombreComprobante(13)).toBe('NOTA DE CRÉDITO C');
  });

  it('un tipo desconocido no se hace pasar por factura C', () => {
    expect(nombreComprobante(99)).toBe('COMPROBANTE TIPO 99');
  });
});

describe('normalizarLinea', () => {
  it('lee el formato del carrito del POS', () => {
    expect(normalizarLinea({ name: 'Pan', qty: 3, price: 100 }))
      .toEqual({ nombre: 'Pan', cantidad: 3, precio: 100, subtotal: 300 });
  });

  // El caso roto: al reimprimir desde el listado de ventas, los items vienen
  // con quantity/unit_price y el comprobante salía con "undefined x" y "$NaN".
  it('lee el formato de una venta ya guardada', () => {
    expect(normalizarLinea({ product_name: 'Pan', quantity: 3, unit_price: 100 }))
      .toEqual({ nombre: 'Pan', cantidad: 3, precio: 100, subtotal: 300 });
  });

  it('un item incompleto no produce NaN', () => {
    const r = normalizarLinea({});

    expect(Number.isNaN(r.subtotal)).toBe(false);
    expect(r.subtotal).toBe(0);
    expect(r.nombre).toBe('Producto');
  });

  it('redondea el subtotal a centavos', () => {
    expect(normalizarLinea({ qty: 3, price: 0.335 }).subtotal).toBe(1.01);
  });
});
