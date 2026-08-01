// ════════════════════════════════════════════
//  La condicion de IVA del receptor sale del cliente, no del comprobante
//
//  El bug que estos tests protegen: la condicion se derivaba del TIPO de
//  comprobante (1 para Factura A, 5 para el resto) y `Customer.tax_condition`
//  no se leia nunca. Una venta a un Responsable Inscripto se declaraba ante
//  ARCA como Consumidor Final, con el CUIT del RI adjunto.
//
//  No falla, no avisa y no se ve: el comprobante sale, ARCA lo autoriza y
//  queda mal declarado. Corregirlo despues exige una nota de credito, que el
//  sistema todavia no emite.
// ════════════════════════════════════════════

const { condicionIvaDeAfip, CODIGOS_DE_ARCA } = require('../utils/condicionIvaAfip');

describe('Cada condicion de la ficha se traduce a su codigo de ARCA', () => {
  // El formulario de Clientes guarda 'ri' (Customers.jsx:341). Este es EL caso
  // del hallazgo: antes devolvia 5 (consumidor final) para un RI.
  it('«ri» NO se declara como consumidor final: es 1, Responsable Inscripto', () => {
    expect(condicionIvaDeAfip('ri')).toBe(1);
    expect(condicionIvaDeAfip('ri')).not.toBe(5);
  });

  // La plantilla de importacion masiva documenta el nombre largo
  // (import.js:108). Los dos nombres son el mismo cliente: aceptar uno solo
  // deja mal declarados a los que entraron por la otra puerta.
  it('«responsable_inscripto» es el mismo caso que «ri»', () => {
    expect(condicionIvaDeAfip('responsable_inscripto')).toBe(1);
  });

  it('«exento» es 4', () => {
    expect(condicionIvaDeAfip('exento')).toBe(4);
  });

  it('«consumidor_final» es 5', () => {
    expect(condicionIvaDeAfip('consumidor_final')).toBe(5);
  });

  it('«monotributo» es 6, no 5', () => {
    expect(condicionIvaDeAfip('monotributo')).toBe(6);
    expect(condicionIvaDeAfip('monotributo')).not.toBe(5);
  });

  it('los cuatro codigos son los de la tabla de ARCA', () => {
    expect(CODIGOS_DE_ARCA).toEqual({
      RESPONSABLE_INSCRIPTO: 1,
      EXENTO: 4,
      CONSUMIDOR_FINAL: 5,
      MONOTRIBUTO: 6,
    });
  });
});

describe('El mismo dato llego por tres puertas y se escribe distinto', () => {
  // Los settings de la empresa guardan 'RI' en mayusculas (afip.js:27) y los
  // datos migrados del sistema viejo traen lo que el usuario tipeo.
  it.each([
    ['RI', 1],
    [' ri ', 1],
    ['Responsable Inscripto', 1],
    ['responsable-inscripto', 1],
    ['Consumidor Final', 5],
    ['MONOTRIBUTO', 6],
    ['Exento', 4],
  ])('«%s» → %i', (escrito, esperado) => {
    expect(condicionIvaDeAfip(escrito)).toBe(esperado);
  });
});

describe('Lo desconocido devuelve null, y null NO es 5', () => {
  // Es la decision central de esta funcion. Devolver 5 (consumidor final) ante
  // un valor que no se reconoce repite en silencio el mismo error fiscal que
  // esto vino a cerrar, y ademas lo hace indistinguible de un consumidor final
  // de verdad. `null` significa «no se», y quien llama aplica su respaldo.
  it.each([
    'sujeto_no_categorizado',
    'iva_no_alcanzado',
    'cliente_del_exterior',
    'RESPONSABLE INSCRIPTO EN EL EXTERIOR',
    '',
    '   ',
    'null',
    '5',
  ])('«%s» no se reconoce y devuelve null', (desconocido) => {
    expect(condicionIvaDeAfip(desconocido)).toBeNull();
  });

  it.each([[null], [undefined], [0], [false], [{}], [[]]])(
    'un valor no textual (%p) devuelve null y no rompe',
    (valor) => {
      expect(condicionIvaDeAfip(valor)).toBeNull();
    }
  );

  // Un cliente sin ficha —venta a consumidor final sin cliente asociado— llega
  // como null. Si devolviera un codigo, la venta se declararia con la
  // condicion de un comprador que no existe.
  it('una venta sin ficha de cliente no aporta condicion', () => {
    expect(condicionIvaDeAfip(null)).toBeNull();
    expect(condicionIvaDeAfip(undefined)).toBeNull();
  });
});
