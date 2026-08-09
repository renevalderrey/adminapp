// ════════════════════════════════════════════
//  El backoff, la clasificación del error y qué variante se empuja
//
//  Los tres defectos que abre este archivo:
//
//  1. **No había ningún reintento.** Un empujón que fallaba dejaba esa variante
//     desfasada en silencio y para siempre: el disparador ya había ocurrido y no
//     había nada que lo volviera a intentar.
//  2. **Un fallo de TiendaNube y un fallo de Favalio se veían iguales**: «No se
//     pudo sincronizar el stock con TiendaNube» para los cuatro casos, que se
//     arreglan de cuatro maneras distintas.
//  3. **Un producto mapeado sin fila de stock en la sucursal designada**
//     publicaba lo que hubiera —o nada, o cero según el camino—. Publicar cero
//     agota en la tienda una variante que sí tiene mercadería.
//
//  ⚠ Va en `src/tests/` y no en `src/utils/`: jest solo levanta `src/tests/**` y
//  `__tests__/**`. Lo protege `todosLosTestsCorren.test.js`.
// ════════════════════════════════════════════

const {
  proximoIntento,
  clasificarError,
  hayQueEmpujar,
  stockAPublicar,
  CLASES,
  MAX_INTENTOS,
} = require('../utils/tiendanubeCola');

/** Un reloj fijo, para poder afirmar el instante exacto y no un rango. */
const AHORA = new Date('2026-08-12T09:00:00.000Z');

/** Cuántos minutos hay entre `AHORA` y la fecha que devolvió el backoff. */
const minutosDeEspera = (fecha) => (fecha.getTime() - AHORA.getTime()) / 60000;

/** Un error de axios con respuesta, como el que llega de una llamada rechazada. */
function conRespuesta(status, headers = {}) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, headers, data: { code: status } };
  return err;
}

/** Un error de red: **no tiene `response`**, y ése es el punto. */
function deRed(code) {
  const err = new Error('socket hang up');
  err.code = code;
  return err;
}

describe('proximoIntento · la espera crece, tiene tope, y se agota', () => {
  it('el backoff del intento 0, del 3 y del 8', () => {
    // 2^0 = 1 minuto: el primer fallo se reintenta enseguida, porque lo más
    // probable es que haya sido un pico.
    expect(minutosDeEspera(proximoIntento(0, null, AHORA))).toBe(1);
    expect(minutosDeEspera(proximoIntento(3, null, AHORA))).toBe(8);
    // Y el octavo ya no vuelve: la fila queda con su error a la vista.
    expect(proximoIntento(MAX_INTENTOS, null, AHORA)).toBeNull();
  });

  it('la espera se estaciona en una hora y no sigue duplicándose', () => {
    // 2^6 = 64 y 2^7 = 128. Sin el tope, el intento 11 caería en dos días y la
    // fila quedaría parada hasta pasado mañana sin que nada lo diga.
    expect(minutosDeEspera(proximoIntento(5, null, AHORA))).toBe(32);
    expect(minutosDeEspera(proximoIntento(6, null, AHORA))).toBe(60);
    expect(minutosDeEspera(proximoIntento(7, null, AHORA))).toBe(60);
  });

  it('a los 8 intentos deja de reintentar sola, incluso con Retry-After', () => {
    // Ocho fallos seguidos contra la misma variante no son un pico de tráfico:
    // es un token revocado o una variante que ya no existe, y ninguna de las dos
    // se arregla esperando más. La mueve una corrida manual o la reconciliación.
    expect(proximoIntento(8, '30', AHORA)).toBeNull();
    expect(proximoIntento(20, null, AHORA)).toBeNull();
    // Y el séptimo SÍ vuelve: si no, el corte estaría un intento antes y este
    // caso pasaría por el motivo equivocado.
    expect(proximoIntento(7, null, AHORA)).not.toBeNull();
  });

  it('respeta Retry-After en segundos', () => {
    // Un 429 no es un error: es «más despacio», y el número lo pone el que sabe.
    // Sin esto, el backoff calculado —un minuto en el primer intento— vuelve a
    // pegarle a una tienda que pidió noventa segundos.
    expect(minutosDeEspera(proximoIntento(0, '90', AHORA))).toBe(1.5);
    expect(minutosDeEspera(proximoIntento(0, 45, AHORA))).toBe(0.75);
  });

  it('respeta Retry-After como fecha HTTP', () => {
    // La otra forma del estándar. Sin parsearla, `/^\d+$/` no matchea y la
    // cabecera se ignoraría en silencio.
    const dentroDeDosMinutos = new Date(AHORA.getTime() + 2 * 60000).toUTCString();

    expect(minutosDeEspera(proximoIntento(0, dentroDeDosMinutos, AHORA))).toBe(2);
  });

  it('una fecha ya pasada significa «podés ahora», y no una espera negativa', () => {
    const haceUnaHora = new Date(AHORA.getTime() - 3600000).toUTCString();

    expect(minutosDeEspera(proximoIntento(2, haceUnaHora, AHORA))).toBe(0);
  });

  it('un Retry-After absurdo se recorta al mismo tope de una hora', () => {
    // Un día de espera deja la variante desfasada hasta mañana. El tope es lo
    // que hace que la peor espera posible sea una hora, con o sin cabecera.
    expect(minutosDeEspera(proximoIntento(0, String(24 * 3600), AHORA))).toBe(60);
  });

  it('sin cabecera —o con una que no se entiende— cae al backoff calculado', () => {
    for (const cabecera of [null, undefined, '', 'ya mismo']) {
      expect(minutosDeEspera(proximoIntento(2, cabecera, AHORA))).toBe(4);
    }
  });
});

describe('clasificarError · los seis casos, y el que más se olvida', () => {
  it('clasifica ECONNABORTED, 401, 429, 500, 400 y un error sin response', () => {
    expect(clasificarError(deRed('ECONNABORTED')).clase).toBe(CLASES.TIMEOUT);
    expect(clasificarError(conRespuesta(401)).clase).toBe(CLASES.TOKEN_INVALIDO);
    expect(clasificarError(conRespuesta(429)).clase).toBe(CLASES.LIMITE);
    expect(clasificarError(conRespuesta(500)).clase).toBe(CLASES.CAIDA_DE_TIENDANUBE);
    expect(clasificarError(conRespuesta(400)).clase).toBe(CLASES.PETICION_RECHAZADA);
    // ⚠ El que más se olvida: un error de red **no tiene `response`**, así que
    // `err.response.status` tira un TypeError adentro del catch que existía para
    // manejarlo. El fallo original desaparece y sale «Cannot read properties of
    // undefined», que no dice nada de lo que pasó.
    expect(() => clasificarError(new Error('vaya a saber'))).not.toThrow();
    expect(clasificarError(new Error('vaya a saber')).clase).toBe(CLASES.DESCONOCIDO);
    expect(() => clasificarError(undefined)).not.toThrow();
  });

  it('los cuatro mensajes que ve el usuario son DISTINTOS entre sí', () => {
    // Es el defecto: los cuatro decían «No se pudo sincronizar el stock con
    // TiendaNube». Esperar, volver a vincular, avisarle a TiendaNube y abrir un
    // ticket acá son cuatro reacciones distintas.
    const mensajes = [
      clasificarError(deRed('ECONNABORTED')).mensaje,
      clasificarError(conRespuesta(401)).mensaje,
      clasificarError(conRespuesta(429)).mensaje,
      clasificarError(conRespuesta(503)).mensaje,
    ];

    expect(new Set(mensajes).size).toBe(4);
    expect(mensajes.every((m) => typeof m === 'string' && m.length > 10)).toBe(true);
  });

  it('un fallo de Favalio NO trae mensaje: le toca el genérico con su requestId', () => {
    // Un 4xx que no es 401 ni 429 es una petición que armamos mal. Decirle
    // «TiendaNube tuvo un problema» a alguien cuyo problema es nuestro lo manda
    // a revisar el lado equivocado durante una tarde.
    expect(clasificarError(conRespuesta(404)).mensaje).toBeNull();
    expect(clasificarError(new Error('boom')).mensaje).toBeNull();
  });

  it('solo el 401 pide volver a vincular, y el 429 y el 5xx son reintentables', () => {
    expect(clasificarError(conRespuesta(401)).hayQueVolverAVincular).toBe(true);
    expect(clasificarError(conRespuesta(401)).reintentable).toBe(false);

    expect(clasificarError(conRespuesta(429)).reintentable).toBe(true);
    expect(clasificarError(conRespuesta(502)).reintentable).toBe(true);
    expect(clasificarError(deRed('ETIMEDOUT')).reintentable).toBe(true);

    // Un 400 no se reintenta: reintentar una petición mal armada la vuelve a
    // armar mal, y consume cuota de la tienda.
    expect(clasificarError(conRespuesta(400)).reintentable).toBe(false);
  });

  it('rescata el Retry-After venga como venga la cabecera', () => {
    // Node baja los nombres de cabecera, pero un doble puede no hacerlo, y
    // leerla con la clave exacta la perdería en silencio: el 429 caería al
    // backoff calculado en vez de al tiempo que pidió la tienda.
    expect(clasificarError(conRespuesta(429, { 'retry-after': '30' })).retryAfter).toBe('30');
    expect(clasificarError(conRespuesta(429, { 'Retry-After': '30' })).retryAfter).toBe('30');
    expect(clasificarError(conRespuesta(429)).retryAfter).toBeNull();
  });
});

describe('hayQueEmpujar · sin fila de stock NO se publica cero', () => {
  it('es false cuando NO hay fila de stock: no se publica cero por omisión', () => {
    // FR-046 y US5 escenario 7. **Publicar cero agota en la tienda una variante
    // que sí tiene mercadería**: el producto deja de venderse y nadie entiende
    // por qué. Lo que corresponde es no mandar nada y anotar el motivo.
    expect(hayQueEmpujar({ stock_publicado: 7 }, null)).toBe(false);
    expect(hayQueEmpujar({ stock_publicado: null }, null)).toBe(false);
    expect(hayQueEmpujar({ stock_publicado: null }, undefined)).toBe(false);
  });

  it('es false cuando el disponible es igual al publicado', () => {
    // Es lo que hace barata la reconciliación diaria: compara todo el catálogo y
    // solo manda lo que difiere. Sin esto, una reconciliación de 2.000 variantes
    // son 2.000 llamadas a una API con cuota, todos los días, para no cambiar
    // nada.
    expect(hayQueEmpujar({ stock_publicado: 7 }, 7)).toBe(false);
  });

  it('es true cuando difiere, y también cuando nunca se publicó nada', () => {
    // El ancla: si devolviera false siempre, los dos casos de arriba seguirían
    // en verde y la tienda no se actualizaría nunca.
    expect(hayQueEmpujar({ stock_publicado: 7 }, 5)).toBe(true);
    // Nunca publicada: hay que mandarla aunque el número dé cero.
    expect(hayQueEmpujar({ stock_publicado: null }, 0)).toBe(true);
    expect(hayQueEmpujar({}, 12)).toBe(true);
  });

  it('un disponible negativo se compara COMO SE PUBLICA, que es cero', () => {
    // TiendaNube no acepta negativos, así que -3 y 0 mandan lo mismo. Con
    // `stock_publicado = 0` repetir el PUT gasta una llamada de la cuota para
    // dejar la tienda igual; sin publicar nunca, hay que mandar el cero.
    expect(stockAPublicar(-3)).toBe(0);
    expect(hayQueEmpujar({ stock_publicado: 0 }, -3)).toBe(false);
    expect(hayQueEmpujar({ stock_publicado: null }, -3)).toBe(true);
  });

  it('un disponible que no es número no dispara un PUT con NaN', () => {
    // `stock.available` es INTEGER, pero la reconciliación compara contra lo que
    // devuelve TiendaNube y ahí puede venir cualquier cosa. Un `{ stock: NaN }`
    // en el cuerpo del PUT es un 400 del tercero que nadie sabe leer.
    expect(hayQueEmpujar({ stock_publicado: 1 }, 'ocho')).toBe(false);
  });
});
