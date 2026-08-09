// ════════════════════════════════════════════
//  El slug de un catálogo público
//
//  El defecto que estos casos evitan tiene una sola forma: **el panel muestra
//  una dirección y el servidor guarda otra**. El formulario propone
//  `comprafit-fitnet` mientras el comercio escribe el nombre, el comercio
//  aprieta «Publicar» sobre eso, el servidor normaliza de nuevo y guarda
//  `comprafit--fitnet`. Nadie ve un error: el catálogo existe, la pantalla lo
//  lista, y el QR impreso en la recepción del gimnasio no abre nada.
//
//  Por eso `apps/web` duplica esta función y una guardia de texto la ata a este
//  archivo (T1453). Estos casos son la mitad de acá.
// ════════════════════════════════════════════

const {
  normalizarSlug,
  validarSlug,
  slugDeLaRuta,
  RESERVADOS,
  FORMATO,
} = require('../utils/slugDeCatalogo');

describe('normalizarSlug', () => {
  it('«Comprafit / Fitnet» con acentos y mayúsculas da comprafit-fitnet y NO comprafit--fitnet', () => {
    // El separador de la maqueta es « / »: tres caracteres que no son letra ni
    // número, uno detrás del otro. Sin el colapso de guiones repetidos salen
    // tres guiones, y esa es la dirección que se imprimiría en la pared.
    expect(normalizarSlug('Comprafít / Fitnet')).toBe('comprafit-fitnet');
    expect(normalizarSlug('COMPRAFIT / FITNET')).toBe('comprafit-fitnet');
    expect(normalizarSlug('Comprafit  Fitnet')).toBe('comprafit-fitnet');

    expect(normalizarSlug('Comprafít / Fitnet')).not.toMatch(/--/);
  });

  it('NO deja guiones en los bordes', () => {
    // «¡Comprafit!» empieza y termina en un carácter que se convierte en guión.
    // Un slug con guión al principio es una dirección que se ve rota y que el
    // propio FORMATO rechaza después.
    expect(normalizarSlug('¡Comprafit!')).toBe('comprafit');
    expect(normalizarSlug('  gimnasio central  ')).toBe('gimnasio-central');
    expect(normalizarSlug('---gimnasio---')).toBe('gimnasio');
  });

  it('saca los acentos y la tilde de la ñ, porque el slug se dicta por teléfono', () => {
    // Una URL con «ñ» o con «í» viaja percent-encodeada y se copia distinto
    // según de dónde se copie. Y este string alguien lo lee en voz alta.
    expect(normalizarSlug('Nutrición')).toBe('nutricion');
    expect(normalizarSlug('El Niño Gym')).toBe('el-nino-gym');
    expect(normalizarSlug('Almacén Ávila')).toBe('almacen-avila');
  });

  it('deja sólo [a-z0-9-]: nada de puntos, barras, «&» ni acentos', () => {
    expect(normalizarSlug('Suplementos & Más S.A.')).toBe('suplementos-mas-s-a');
    expect(normalizarSlug('gym_2024')).toBe('gym-2024');

    for (const entrada of ['Comprafít / Fitnet', '¡Hola, Mundo!', 'a/b\\c']) {
      expect(normalizarSlug(entrada)).toMatch(/^[a-z0-9-]*$/);
    }
  });

  it('normalizar dos veces da lo mismo que normalizar una', () => {
    // No es un detalle teórico: el formulario normaliza mientras el usuario
    // escribe y el servidor vuelve a normalizar lo que recibe. Si la segunda
    // pasada moviera algo, la dirección publicada no sería la que se aprobó.
    for (const entrada of ['Comprafít / Fitnet', '---gimnasio---', 'El Niño Gym']) {
      const unaVez = normalizarSlug(entrada);
      expect(normalizarSlug(unaVez)).toBe(unaVez);
    }
  });

  it('null, undefined y un texto sin letras ni números dan cadena vacía y no revientan', () => {
    // Normalizar no es validar: el vacío es una respuesta legítima acá y lo
    // rechaza validarSlug. Lo que no puede pasar es que tire.
    expect(normalizarSlug(null)).toBe('');
    expect(normalizarSlug(undefined)).toBe('');
    expect(normalizarSlug('')).toBe('');
    expect(normalizarSlug('   ')).toBe('');
    expect(normalizarSlug('!!!')).toBe('');
  });
});

describe('validarSlug', () => {
  it('«c» está reservado: es el prefijo de la propia URL pública', () => {
    // La URL pública es tienda.favalio.com/c/<slug>. Un catálogo llamado `c`
    // produce /c/c/... y vuelve ambigua la ruta que slugDeLaRuta tiene que leer.
    const resultado = validarSlug('c');

    expect(resultado.ok).toBe(false);
    expect(resultado.motivo).toMatch(/reservad/i);

    // Y el motivo es «reservado», NO «muy corto». `c` mide un carácter: si el
    // largo se mirara primero, el comercio probaría con `cc` sin enterarse
    // nunca de que el nombre está tomado por el sistema.
    expect(resultado.motivo).not.toMatch(/caracteres/i);
  });

  it('rechaza los nueve reservados de FR-052', () => {
    // La lista completa, no una muestra: es la que la guardia de texto de
    // apps/web compara contra la suya (T1453).
    expect(RESERVADOS).toEqual([
      'c',
      'api',
      'assets',
      'admin',
      'robots.txt',
      'favicon.ico',
      'img',
      'static',
      'public',
    ]);

    for (const reservado of RESERVADOS) {
      const resultado = validarSlug(reservado);
      expect(resultado.ok).toBe(false);
      expect(resultado.motivo).toMatch(/reservad/i);
    }

    // Y no de más: `assets-comprafit` no es `assets`.
    expect(validarSlug('assets-comprafit').ok).toBe(true);

    // `API` en mayúsculas no se cuela por el costado: validarSlug no arregla la
    // entrada —eso es trabajo de normalizarSlug, que corre antes— así que lo
    // rechaza por formato, y la cadena completa lo rechaza por reservado.
    expect(validarSlug('API').ok).toBe(false);
    expect(validarSlug(normalizarSlug('API')).motivo).toMatch(/reservad/i);
  });

  it('el largo va de 3 a 60 inclusive', () => {
    expect(validarSlug('ab').ok).toBe(false);
    expect(validarSlug('abc').ok).toBe(true);
    expect(validarSlug('a'.repeat(60)).ok).toBe(true);
    expect(validarSlug('a'.repeat(61)).ok).toBe(false);
    expect(validarSlug('a'.repeat(61)).motivo).toMatch(/entre 3 y 60/);

    // El vacío entra por el mismo lado: normalizar «!!!» da '' y eso no puede
    // llegar a la base como la dirección de nadie.
    expect(validarSlug('').ok).toBe(false);
    expect(validarSlug(null).ok).toBe(false);
    expect(validarSlug(undefined).ok).toBe(false);
  });

  it('rechaza lo que normalizarSlug nunca habría producido', () => {
    // Es la red del caso «alguien escribe el slug directo en el cuerpo del
    // request en vez de pasar por el formulario».
    for (const invalido of [
      'Comprafit',          // mayúsculas
      'comprafít',          // acento
      'comprafit fitnet',   // espacio
      'comprafit--fitnet',  // guiones repetidos: el defecto que da nombre a esto
      '-comprafit',         // guión al principio
      'comprafit-',         // guión al final
      'comprafit.fitnet',   // punto
      'comprafit/fitnet',   // barra
    ]) {
      expect(validarSlug(invalido).ok).toBe(false);
    }
  });

  it('un slug bueno pasa, y el motivo es null', () => {
    expect(validarSlug('comprafit-fitnet')).toEqual({ ok: true, motivo: null });
    expect(validarSlug('gimnasio2024')).toEqual({ ok: true, motivo: null });
  });

  it('todo lo que sale de normalizarSlug y es aceptado tiene la forma de FORMATO', () => {
    // La atadura entre las dos funciones: normalizar y validar tienen que estar
    // de acuerdo sobre qué es un slug. Si se separan, el formulario propondría
    // direcciones que el servidor rechaza y el comercio no sabría qué corregir.
    for (const entrada of [
      'Comprafít / Fitnet',
      'Suplementos & Más S.A.',
      'El Niño Gym',
      '---gimnasio---',
    ]) {
      const slug = normalizarSlug(entrada);
      expect(validarSlug(slug).ok).toBe(true);
      expect(FORMATO.test(slug)).toBe(true);
    }
  });
});

describe('slugDeLaRuta', () => {
  it('saca el slug de /c/comprafit-fitnet/productos y devuelve null en /salud', () => {
    // Existe porque en el punto de montaje de un router los req.params todavía
    // no existen: el keyGenerator del limitador público corre antes de que
    // Express haya emparejado ninguna ruta.
    expect(slugDeLaRuta('/c/comprafit-fitnet/productos')).toBe('comprafit-fitnet');
    expect(slugDeLaRuta('/c/comprafit-fitnet')).toBe('comprafit-fitnet');

    expect(slugDeLaRuta('/salud')).toBeNull();
    expect(slugDeLaRuta('/')).toBeNull();
    expect(slugDeLaRuta('')).toBeNull();
    expect(slugDeLaRuta(null)).toBeNull();
  });

  it('encuentra el slug con el prefijo del montaje delante', () => {
    // Según dónde se cuelgue el limitador, el camino llega con /api/publico o
    // sin él. Las dos formas tienen que dar la misma clave.
    expect(slugDeLaRuta('/api/publico/c/comprafit-fitnet/productos')).toBe(
      'comprafit-fitnet'
    );
    expect(slugDeLaRuta('/api/publico/salud')).toBeNull();
  });

  it('/c/Comprafit y /c/comprafit son la MISMA clave del limitador', () => {
    // Si no fueran la misma, cada variante de mayúsculas tendría su propio cupo
    // de 120 por minuto sobre el mismo catálogo —el resolvedor busca el slug
    // normalizado—, y el límite por catálogo se esquiva escribiendo distinto.
    expect(slugDeLaRuta('/c/Comprafit')).toBe(slugDeLaRuta('/c/comprafit'));
    expect(slugDeLaRuta('/c/COMPRAFIT/productos')).toBe('comprafit');
    expect(slugDeLaRuta('/c/comprafi%CC%81t')).toBe('comprafit');
  });

  it('devuelve null y NO tira con un camino raro', () => {
    // Esto corre adentro del keyGenerator: una excepción acá devolvería 500 en
    // todas las peticiones públicas, no sólo en la del que mandó la URL rota.
    expect(slugDeLaRuta('/c/')).toBeNull();
    expect(slugDeLaRuta('/c')).toBeNull();
    expect(slugDeLaRuta('/c/!!!')).toBeNull();
    expect(() => slugDeLaRuta('/c/100%')).not.toThrow();
    expect(slugDeLaRuta('/c/100%')).toBe('100');
  });

  it('ignora la query, por si le pasan originalUrl en vez de path', () => {
    expect(slugDeLaRuta('/c/comprafit-fitnet?pagina=2')).toBe('comprafit-fitnet');
    expect(slugDeLaRuta('/c/comprafit-fitnet#seccion')).toBe('comprafit-fitnet');
  });
});
