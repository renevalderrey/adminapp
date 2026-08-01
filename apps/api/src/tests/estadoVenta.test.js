// ════════════════════════════════════════════
//  Los cinco estados de una venta
//
//  Lo que se protege acá no son las cinco combinaciones —esas son obvias— sino
//  el ORDEN en que se comparan los tres campos. Invertirlo no rompe ningún
//  test evidente y produce dos mentiras fiscales: una venta anulada con CAE
//  mostrada como si estuviera vigente y en orden, y una venta que se facturó
//  bien mostrada como rechazada para siempre.
// ════════════════════════════════════════════

const { estadoVenta, CODIGOS } = require('../utils/estadoVenta');

describe('Las cinco combinaciones', () => {
  it('activa con CAE es Autorizada', () => {
    expect(estadoVenta({ status: 'active', afip_cae: '75412339018264' }))
      .toEqual({ codigo: 'autorizada', etiqueta: 'Autorizada' });
  });

  it('activa sin CAE y sin intento fallido es Registrada', () => {
    expect(estadoVenta({ status: 'active', afip_cae: null, afip_ultimo_error: null }))
      .toEqual({ codigo: 'registrada', etiqueta: 'Registrada' });
  });

  it('activa sin CAE y con intento fallido es Rechazada', () => {
    expect(estadoVenta({
      status: 'active',
      afip_cae: null,
      afip_ultimo_error: 'Error de AFIP: [{"Code":10015}]',
    })).toEqual({ codigo: 'rechazada', etiqueta: 'Rechazada' });
  });

  it('anulada sin CAE es Anulada', () => {
    expect(estadoVenta({ status: 'voided', afip_cae: null }))
      .toEqual({ codigo: 'anulada', etiqueta: 'Anulada' });
  });

  it('anulada CON CAE es «Anulada · vigente ante ARCA», no una anulada común', () => {
    expect(estadoVenta({ status: 'voided', afip_cae: '75412339018264' }))
      .toEqual({ codigo: 'anulada_con_cae', etiqueta: 'Anulada · vigente ante ARCA' });
  });
});

describe('La precedencia, que es lo que se rompe si alguien reordena las comparaciones', () => {
  // Si `afip_cae` se mirara antes que `status`, esta venta diría «Autorizada»:
  // el comprobante se leería como vigente y en orden cuando en realidad la
  // operación se anuló y el comprobante SIGUE declarado ante ARCA. Es el
  // desvío que taxService ya cuenta como anuladas_con_cae_sin_nc.
  it('anulada + CAE da anulada_con_cae y NO autorizada', () => {
    const r = estadoVenta({ status: 'voided', afip_cae: '75412339018264' });

    expect(r.codigo).toBe(CODIGOS.ANULADA_CON_CAE);
    expect(r.codigo).not.toBe(CODIGOS.AUTORIZADA);
  });

  // El caso que motiva el orden: la venta falló, quedó el error guardado, y al
  // reintentar salió bien. Si el error se mirara antes que el CAE, esa venta
  // se mostraría Rechazada para siempre —con CAE y todo— y el usuario
  // reintentaría una venta ya facturada.
  it('activa + CAE + error viejo guardado da autorizada y NO rechazada', () => {
    const r = estadoVenta({
      status: 'active',
      afip_cae: '75412339018264',
      afip_ultimo_error: 'Error de AFIP del intento anterior',
    });

    expect(r.codigo).toBe(CODIGOS.AUTORIZADA);
    expect(r.codigo).not.toBe(CODIGOS.RECHAZADA);
  });

  // Una venta anulada que antes había sido rechazada por AFIP es Anulada, a
  // secas. El error guardado no la vuelve «Rechazada».
  it('anulada + error guardado da anulada y NO rechazada', () => {
    const r = estadoVenta({
      status: 'voided',
      afip_cae: null,
      afip_ultimo_error: 'Error de AFIP: [{"Code":10015}]',
    });

    expect(r.codigo).toBe(CODIGOS.ANULADA);
  });
});

describe('Datos incompletos', () => {
  // Las ventas anteriores a la migración tienen las dos columnas en null: se
  // muestran como Registradas, nunca como Rechazadas. No hay forma de saber
  // cuáles fallaron y adivinar sobre una obligación fiscal es peor que no
  // saber.
  it('una venta anterior a la migración, sin las columnas nuevas, es Registrada', () => {
    expect(estadoVenta({ status: 'active', afip_cae: null }).codigo)
      .toBe(CODIGOS.REGISTRADA);
  });

  // El default de la columna es 'active'. Una venta sin status no puede caer
  // en la rama de anuladas.
  it('sin status se trata como activa', () => {
    expect(estadoVenta({ afip_cae: null }).codigo).toBe(CODIGOS.REGISTRADA);
    expect(estadoVenta({ afip_cae: 'X' }).codigo).toBe(CODIGOS.AUTORIZADA);
  });

  it('sin argumentos no rompe', () => {
    expect(estadoVenta().codigo).toBe(CODIGOS.REGISTRADA);
    expect(estadoVenta(null).codigo).toBe(CODIGOS.REGISTRADA);
  });

  // Un CAE en cadena vacía no es un CAE. Si contara como presente, una venta
  // sin facturar aparecería como Autorizada y nadie la reintentaría.
  it('un CAE vacío o en blanco NO cuenta como facturada', () => {
    expect(estadoVenta({ status: 'active', afip_cae: '' }).codigo).toBe(CODIGOS.REGISTRADA);
    expect(estadoVenta({ status: 'active', afip_cae: '   ' }).codigo).toBe(CODIGOS.REGISTRADA);
  });

  it('un error vacío NO marca la venta como rechazada', () => {
    expect(estadoVenta({ status: 'active', afip_cae: null, afip_ultimo_error: '' }).codigo)
      .toBe(CODIGOS.REGISTRADA);
  });
});

describe('La etiqueta', () => {
  // Es el texto del badge y también la celda «Estado» del archivo exportado:
  // tienen que salir del mismo lugar o el archivo dice una cosa y la pantalla
  // otra.
  it('las cinco son distintas entre sí', () => {
    const etiquetas = [
      estadoVenta({ status: 'active', afip_cae: 'X' }).etiqueta,
      estadoVenta({ status: 'active' }).etiqueta,
      estadoVenta({ status: 'active', afip_ultimo_error: 'x' }).etiqueta,
      estadoVenta({ status: 'voided' }).etiqueta,
      estadoVenta({ status: 'voided', afip_cae: 'X' }).etiqueta,
    ];

    expect(new Set(etiquetas).size).toBe(5);
  });

  it('«Anulada» y «Anulada · vigente ante ARCA» no se confunden', () => {
    const anulada = estadoVenta({ status: 'voided' }).etiqueta;
    const conCae = estadoVenta({ status: 'voided', afip_cae: 'X' }).etiqueta;

    expect(anulada).toBe('Anulada');
    expect(conCae).toContain('ARCA');
    expect(conCae).not.toBe(anulada);
  });
});
