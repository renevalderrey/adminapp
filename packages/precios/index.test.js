import { describe, it, expect } from 'vitest';
import {
  MODO_RECARGO,
  precioConRecargo,
  precioConDescuento,
  calcularPrecios,
} from './index.js';

const SETTINGS = {
  margin_efectivo: 50,
  recargo_tarjeta: 20,
  descuento_alianza: 10,
};

describe('convención de margen', () => {
  // "Margen 50%" es recargo sobre el costo, no margen sobre la venta.
  it('un margen del 50% sobre un costo de $100 da $150', () => {
    const r = calcularPrecios({ cost: 100 }, SETTINGS);

    expect(r.cashPrice).toBe(150);
  });

  it('el margen del producto pisa el de la empresa', () => {
    const r = calcularPrecios({ cost: 100, margin_override: 80 }, SETTINGS);

    expect(r.cashPrice).toBe(180);
  });

  it('margen 0 vende al costo', () => {
    const r = calcularPrecios({ cost: 100, margin_override: 0 }, SETTINGS);

    expect(r.cashPrice).toBe(100);
  });
});

describe('precioConRecargo', () => {
  // El modo por defecto: el recargo se le suma al cliente.
  it('SOBRE_PRECIO suma el porcentaje al precio', () => {
    expect(precioConRecargo(100, 20, MODO_RECARGO.SOBRE_PRECIO)).toBe(120);
  });

  // El otro modo: el porcentaje es lo que retiene la tarjeta, y hay que cobrar
  // de más para terminar recibiendo el precio de lista.
  it('COMPENSA_COMISION cobra lo necesario para recibir el precio de lista', () => {
    expect(precioConRecargo(100, 20, MODO_RECARGO.COMPENSA_COMISION)).toBe(125);
  });

  // La confusión entre ambos era el bug: con 20% configurado, el sistema
  // cobraba 25% de más.
  it('los dos modos dan resultados distintos con el mismo porcentaje', () => {
    const sobrePrecio = precioConRecargo(100, 20, MODO_RECARGO.SOBRE_PRECIO);
    const compensa = precioConRecargo(100, 20, MODO_RECARGO.COMPENSA_COMISION);

    expect(sobrePrecio).toBe(120);
    expect(compensa).toBe(125);
  });

  it('verificación de ida y vuelta del modo compensación', () => {
    // Si cobro 125 y me retienen el 20%, me quedan 100.
    const cobrado = precioConRecargo(100, 20, MODO_RECARGO.COMPENSA_COMISION);
    const neto = cobrado * (1 - 0.2);

    expect(neto).toBeCloseTo(100, 6);
  });

  it('sin recargo devuelve el precio base', () => {
    expect(precioConRecargo(100, 0)).toBe(100);
    expect(precioConRecargo(100, undefined)).toBe(100);
  });

  // Antes esto daba Infinity y se propagaba al carrito y a la venta.
  it('una comisión del 100% no tiene solución, devuelve null', () => {
    expect(precioConRecargo(100, 100, MODO_RECARGO.COMPENSA_COMISION)).toBeNull();
    expect(precioConRecargo(100, 150, MODO_RECARGO.COMPENSA_COMISION)).toBeNull();
  });

  it('un recargo del 100% al cliente sí es válido: duplica el precio', () => {
    expect(precioConRecargo(100, 100, MODO_RECARGO.SOBRE_PRECIO)).toBe(200);
  });
});

describe('precioConDescuento', () => {
  it('aplica el descuento sobre el precio de lista', () => {
    expect(precioConDescuento(100, 10)).toBe(90);
  });

  it('sin descuento devuelve el precio base', () => {
    expect(precioConDescuento(100, 0)).toBe(100);
  });

  it('un descuento del 100% deja el precio en cero, no en negativo', () => {
    expect(precioConDescuento(100, 100)).toBe(0);
    expect(precioConDescuento(100, 150)).toBe(0);
  });
});

describe('calcularPrecios', () => {
  it('devuelve los tres precios con el modo por defecto', () => {
    const r = calcularPrecios({ cost: 100 }, SETTINGS);

    expect(r.cashPrice).toBe(150);
    expect(r.cardPrice).toBe(180);      // 150 + 20%
    expect(r.alliancePrice).toBe(135);  // 150 - 10%
  });

  it('respeta el modo de compensación de comisión si está configurado', () => {
    const r = calcularPrecios({ cost: 100 }, {
      ...SETTINGS,
      recargo_modo: MODO_RECARGO.COMPENSA_COMISION,
    });

    expect(r.cardPrice).toBe(188); // round(150 / 0.8) = 187.5 -> 188
  });

  // price_override se guardaba, se importaba y se editaba, pero el POS lo
  // ignoraba y siempre recalculaba desde el costo.
  it('usa el precio manual cuando está cargado, en vez de recalcular', () => {
    const r = calcularPrecios({ cost: 100, price_override: 500 }, SETTINGS);

    expect(r.cashPrice).toBe(500);
    expect(r.usaPrecioManual).toBe(true);
    expect(r.cardPrice).toBe(600);
  });

  it('un price_override en cero no cuenta como precio manual', () => {
    const r = calcularPrecios({ cost: 100, price_override: 0 }, SETTINGS);

    expect(r.cashPrice).toBe(150);
    expect(r.usaPrecioManual).toBe(false);
  });

  // Un producto sin costo salía a $0 en el POS y se podía facturar gratis sin
  // que nada avisara.
  it('marca los productos sin costo ni precio manual', () => {
    const r = calcularPrecios({ cost: 0 }, SETTINGS);

    expect(r.sinCosto).toBe(true);
    expect(r.cashPrice).toBe(0);
  });

  it('un producto con precio manual no se marca como sin costo', () => {
    const r = calcularPrecios({ cost: 0, price_override: 300 }, SETTINGS);

    expect(r.sinCosto).toBe(false);
    expect(r.cashPrice).toBe(300);
  });

  it('un costo como string, que es como llega del backend, se interpreta bien', () => {
    const r = calcularPrecios({ cost: '100.00' }, SETTINGS);

    expect(r.cashPrice).toBe(150);
  });

  it('settings vacíos no producen NaN', () => {
    const r = calcularPrecios({ cost: 100 }, {});

    expect(Number.isNaN(r.cashPrice)).toBe(false);
    expect(r.cashPrice).toBe(100);
  });
});
