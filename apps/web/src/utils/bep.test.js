// ════════════════════════════════════════════
//  Punto de equilibrio
//
//  De acá salen las sugerencias de precio del panel. Si el número es bajo, el
//  comerciante fija precios por debajo del costo de operación y pierde plata
//  creyendo que está en equilibrio.
// ════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  margenSobreVenta,
  recargoSobreCosto,
  calcularBep,
  estrategiasDePrecio,
} from './bep';

describe('margenSobreVenta', () => {
  it('es la fracción de la facturación que se lleva el gasto fijo', () => {
    // Gastos 2.400.000 sobre una facturación de 7.000.000.
    expect(margenSobreVenta(2400000, 7000000)).toBeCloseTo(34.2857, 3);
  });

  it('con gastos iguales a la facturación, el margen requerido es 100%', () => {
    expect(margenSobreVenta(5000, 5000)).toBe(100);
  });

  it('sin datos devuelve 0, no NaN ni Infinity', () => {
    expect(margenSobreVenta(0, 7000000)).toBe(0);
    expect(margenSobreVenta(2400000, 0)).toBe(0);
    expect(margenSobreVenta(null, undefined)).toBe(0);
    expect(margenSobreVenta('abc', 'def')).toBe(0);
  });

  it('no devuelve Infinity si la facturación objetivo es cero', () => {
    expect(Number.isFinite(margenSobreVenta(100, 0))).toBe(true);
  });
});

describe('recargoSobreCosto', () => {
  // El caso que motiva todo. Un margen del 34,29% sobre la venta NO se
  // consigue aplicando 34,29% de recargo sobre el costo.
  it('convierte margen sobre venta en recargo sobre costo', () => {
    expect(recargoSobreCosto(34.2857)).toBeCloseTo(52.174, 2);
  });

  it('un margen del 50% sobre la venta exige duplicar el costo', () => {
    expect(recargoSobreCosto(50)).toBe(100);
  });

  it('un margen del 20% sobre la venta exige 25% de recargo', () => {
    expect(recargoSobreCosto(20)).toBe(25);
  });

  // Si los gastos fijos igualan o superan la facturación objetivo, ningún
  // precio finito alcanza. Devolver un número acá sería mentir.
  it('devuelve null cuando el margen requerido es 100% o más', () => {
    expect(recargoSobreCosto(100)).toBeNull();
    expect(recargoSobreCosto(120)).toBeNull();
  });

  it('sin margen requerido, el recargo es cero', () => {
    expect(recargoSobreCosto(0)).toBe(0);
    expect(recargoSobreCosto(undefined)).toBe(0);
  });

  // Verificación de ida y vuelta: aplicar el recargo al costo tiene que dar
  // exactamente el margen sobre la venta que se pedía.
  it.each([10, 25, 33.33, 40, 60, 75])(
    'aplicar el recargo calculado reproduce un margen del %s%%',
    (margenPedido) => {
      const recargo = recargoSobreCosto(margenPedido);
      const costo = 100;
      const precio = costo * (1 + recargo / 100);
      const margenObtenido = ((precio - costo) / precio) * 100;

      expect(margenObtenido).toBeCloseTo(margenPedido, 6);
    }
  );
});

describe('calcularBep', () => {
  it('devuelve los dos números, cada uno con su nombre', () => {
    const r = calcularBep(2400000, 7000000);

    expect(r.margenSobreVenta).toBe(34.3);
    expect(r.recargoSobreCosto).toBe(52.2);
    expect(r.viable).toBe(true);
  });

  // La versión anterior mostraba 34% y lo describía como "recargo sobre el
  // costo". Aplicar 34% sobre costo da un margen del 25,4% sobre la venta:
  // sobre 7.000.000 son 1.777.000 de margen bruto contra 2.400.000 de gastos
  // fijos. El negocio pierde 623.000 creyendo que está en equilibrio.
  it('el recargo es sensiblemente mayor que el margen, no igual', () => {
    const r = calcularBep(2400000, 7000000);

    expect(r.recargoSobreCosto).toBeGreaterThan(r.margenSobreVenta);
  });

  it('marca como no viable si los gastos fijos superan la facturación objetivo', () => {
    const r = calcularBep(8000000, 7000000);

    expect(r.viable).toBe(false);
    expect(r.recargoSobreCosto).toBeNull();
  });

  it('sin datos cargados no es viable y no devuelve NaN', () => {
    const r = calcularBep(0, 0);

    expect(r.viable).toBe(false);
    expect(Number.isNaN(r.margenSobreVenta)).toBe(false);
  });
});

describe('estrategiasDePrecio', () => {
  it('devuelve tres estrategias, de menor a mayor recargo', () => {
    const [equilibrio, recomendado, agresivo] = estrategiasDePrecio(2400000, 7000000);

    expect(equilibrio.recargoSobreCosto).toBeLessThan(recomendado.recargoSobreCosto);
    expect(recomendado.recargoSobreCosto).toBeLessThan(agresivo.recargoSobreCosto);
  });

  // La versión anterior hacía bepMargin + 10 y lo describía como "10% de
  // utilidad neta". Sumar 10 puntos a un recargo sobre costo no da 10% de
  // utilidad sobre la facturación.
  it('la utilidad se suma al margen sobre la venta, no al recargo', () => {
    const [equilibrio, recomendado] = estrategiasDePrecio(2400000, 7000000);

    expect(recomendado.margenSobreVenta - equilibrio.margenSobreVenta).toBeCloseTo(10, 1);
  });

  it('si una estrategia exige 100% o más de margen, su recargo es null', () => {
    // Equilibrio en 80%; sumarle 25 puntos pasa de 100.
    const estrategias = estrategiasDePrecio(8000, 10000);
    const agresivo = estrategias.find((e) => e.clave === 'agresivo');

    expect(agresivo.recargoSobreCosto).toBeNull();
  });
});
