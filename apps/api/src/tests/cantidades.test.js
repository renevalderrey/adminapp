// ════════════════════════════════════════════
//  utils/cantidades.js — la aritmética que no depende del tipo que devuelva
//  el driver
//
//  Todo este archivo prueba **un solo defecto**, con cinco caras: cuando las
//  columnas de cantidad pasen a `DECIMAL(14,4)`, `pg` las va a devolver como
//  texto —`"12.0000"`— y en JavaScript el operador decide qué pasa, no el
//  valor. La resta fuerza a número y anda; la suma concatena y no avisa.
//
//  ⚠ Los casos se escriben con **strings**, no con números, y eso es lo único
//  que hace que este archivo distinga algo: con las columnas todavía en
//  `INTEGER`, `pg` devuelve números y el defecto no existe todavía. Un test
//  escrito con `sumarCantidades(10.5, 0.25)` pasaría igual con la función rota
//  y con la función bien.
// ════════════════════════════════════════════

const {
  aCantidad,
  sumarCantidades,
  redondearCantidad,
  textoDeCantidad,
  motivoDeCantidadInvalida,
  DECIMALES_DE_UNA_LINEA_DE_VENTA,
} = require('../utils/cantidades');

describe('aCantidad', () => {
  it('NO deja pasar el texto del driver: "0.0000" es el número cero', () => {
    // `"0.0000"` es **truthy**, así que todo `|| 0` y todo `if (cantidad)`
    // sobre una cantidad leída de la base cambia de rama justo en el caso de
    // stock cero, que es el único en el que varios mensajes se leen.
    expect(aCantidad('0.0000')).toBe(0);
    expect(Boolean('0.0000')).toBe(true);
  });

  it('lee la escala completa que devuelve un DECIMAL(14,4)', () => {
    expect(aCantidad('12.0000')).toBe(12);
    expect(aCantidad('10.5000')).toBe(10.5);
    expect(aCantidad('9.6000')).toBe(9.6);
  });

  it('null, undefined, la cadena vacía y "tres" dan TODOS el mismo cero documentado', () => {
    // Es el motivo por el que la función existe: con un `Number(x) || 0`
    // suelto en cada sitio, cada sitio decide por su cuenta qué es un dato
    // ilegible y ninguno lo deja escrito.
    for (const ilegible of [null, undefined, '', '   ', 'tres', {}, [], NaN]) {
      expect(aCantidad(ilegible)).toBe(0);
    }
  });

  it('un número ya numérico pasa tal cual', () => {
    expect(aCantidad(3)).toBe(3);
    expect(aCantidad(0)).toBe(0);
    expect(aCantidad(-5)).toBe(-5);
  });
});

describe('sumarCantidades', () => {
  it('NO concatena cuando los dos operandos vienen del driver como texto', () => {
    // El caso que manda de toda la funcionalidad: stock en 10,5 y una línea de
    // 0,25. Con el `+` desnudo da la cadena "10.50000.2500", que además es un
    // número **mayor**: por eso la aserción es de igualdad exacta y nunca un
    // `toBeLessThan`.
    expect(sumarCantidades('10.5000', '0.2500')).toBe(10.75);
    expect(sumarCantidades('10.5000', '0.2500')).not.toBe('10.50000.2500');
  });

  it('el defecto que evita, escrito: "10.5000" + "0.2500" es una cadena', () => {
    // Sin este caso, alguien podría creer que el `+` estaba bien y que la
    // función es decoración.
    expect('10.5000' + '0.2500').toBe('10.50000.2500');

    // ⚠ Y con DOS puntos decimales adentro no es «un número mayor»: no es
    // ningún número. El plan de la 016 lo describe como un número mayor, y eso
    // solo vale cuando uno de los dos operandos es entero —«100.0000» + 3 da
    // 100.00003, que Postgres acepta sin chistar—. Con dos escalas de 4
    // decimales la escritura falla en la base, que es un modo de falla
    // distinto y **más visible**. Los dos son el mismo defecto y los dos se
    // corrigen igual, pero conviene no esperar el síntoma equivocado.
    expect(Number('10.5000' + '0.2500')).toBeNaN();
    expect(Number('100.0000' + 3)).toBeGreaterThan(100);
  });

  it('suma texto con número, que es la mezcla real de los cinco sitios', () => {
    // `stock.quantity` viene de la base y `linea.recibido_ahora` del cuerpo del
    // request: uno es texto y el otro no.
    expect(sumarCantidades('7.0000', 10)).toBe(17);
    expect(sumarCantidades('20.0000', 5)).toBe(25);
    expect(sumarCantidades('100.0000', 5)).toBe(105);
  });

  it('un operando ilegible NO propaga NaN a una columna de inventario', () => {
    expect(sumarCantidades('10.0000', null)).toBe(10);
    expect(sumarCantidades(undefined, '3.0000')).toBe(3);
  });
});

describe('redondearCantidad', () => {
  it('el redondeo es explícito y no un efecto del cast de Postgres', () => {
    // Una cantidad calculada en el navegador llega como 0.30000000000000004.
    // Que la acomode el motor al asignar es el mismo defecto que esta
    // funcionalidad vino a eliminar, en chiquito.
    expect(redondearCantidad(0.1 + 0.2)).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('corta en los 4 decimales que la columna puede guardar', () => {
    expect(redondearCantidad('0.00004')).toBe(0);
    expect(redondearCantidad(1.23456)).toBe(1.2346);
    expect(redondearCantidad('12.0000')).toBe(12);
  });
});

describe('textoDeCantidad', () => {
  it('NO escribe la escala cruda: "9.6000" se lee 9,6', () => {
    expect(textoDeCantidad('9.6000')).toBe('9,6');
    expect(textoDeCantidad('9.6000')).not.toBe('9.6000');
  });

  it('un entero se escribe sin decimales, venga como venga', () => {
    expect(textoDeCantidad('12.0000')).toBe('12');
    expect(textoDeCantidad(12)).toBe('12');
    expect(textoDeCantidad(12.0)).toBe('12');
  });

  it('el cero del driver se escribe 0, y es el único caso en que el mensaje se lee', () => {
    // `stock.js:142` dice «disponible: 0» justo cuando no hay stock. Con la
    // cadena "0.0000" —truthy— el `|| 0` de esa línea deja de caer al cero.
    expect(textoDeCantidad('0.0000')).toBe('0');
    expect(textoDeCantidad(0)).toBe('0');
    expect(textoDeCantidad(null)).toBe('0');
    expect(textoDeCantidad(undefined)).toBe('0');
  });

  it('NO agrupa los miles: «disponible 1.250» se lee de dos maneras', () => {
    // En una columna alineada el separador ayuda; adentro de una frase es la
    // ambigüedad que este repositorio ya pagó una vez.
    expect(textoDeCantidad(1250)).toBe('1250');
    expect(textoDeCantidad('1250.0000')).toBe('1250');
    expect(textoDeCantidad(1250)).not.toContain('.');
  });

  it('máximo 3 decimales y sin ceros de relleno', () => {
    expect(textoDeCantidad(0.25)).toBe('0,25');
    expect(textoDeCantidad(0.2505)).toBe('0,251');
    expect(textoDeCantidad('0.2500')).toBe('0,25');
  });

  it('un negativo chiquito no se dibuja «-0»', () => {
    expect(textoDeCantidad(-0.0001)).toBe('0');
  });
});

describe('motivoDeCantidadInvalida · la puerta de la 016, con 0 decimales', () => {
  const motivo = (v) => motivoDeCantidadInvalida(v, DECIMALES_DE_UNA_LINEA_DE_VENTA);

  it('la constante de la 016 vale 0: la puerta queda cerrada a toda fracción', () => {
    // La 017 la mueve a 3. Que el número esté acá y no adentro de la ruta es lo
    // que hace que ese cambio sea una línea y no una búsqueda.
    expect(DECIMALES_DE_UNA_LINEA_DE_VENTA).toBe(0);
  });

  it('0.4 se RECHAZA: hoy responde 200 y guarda una línea de venta en cero', () => {
    expect(motivo(0.4)).toBe('tiene que ser un número entero');
  });

  it('cero y negativa se siguen rechazando, como hoy', () => {
    expect(motivo(0)).toBe('tiene que ser mayor que cero');
    expect(motivo(-5)).toBe('tiene que ser mayor que cero');
  });

  it('«tres» se rechaza por no ser un número, y NO por ser menor que cero', () => {
    // `aCantidad('tres')` vale 0, así que una validación escrita sobre el valor
    // convertido contestaría «tiene que ser mayor que cero» ante una palabra y
    // mandaría a corregir lo que no está mal.
    expect(motivo('tres')).toBe('tiene que ser un número');
    expect(motivo(null)).toBe('tiene que ser un número');
    expect(motivo(undefined)).toBe('tiene que ser un número');
    expect(motivo('')).toBe('tiene que ser un número');
  });

  it('999999999999999 se rechaza con un mensaje legible y no con un 500 de Postgres', () => {
    // Por encima de DECIMAL(14,4) el motor responde «numeric field overflow»,
    // que es un 500 con nombres de columna adentro.
    expect(motivo(999999999999999)).toBe('es demasiado grande');
  });

  it('ningún motivo nombra la tabla, la columna ni la restricción (FR-021)', () => {
    const todos = [0.4, 0, -5, 'tres', 999999999999999].map(motivo).join(' ');

    for (const filtracion of ['sale_items', 'quantity', 'numeric', 'DECIMAL', 'constraint', 'column']) {
      expect(todos.toLowerCase()).not.toContain(filtracion.toLowerCase());
    }
  });

  it('una venta normal de 3 unidades se acepta', () => {
    // Sin este caso, una validación que rechaza siempre pasaría todos los de
    // arriba y dejaría el punto de venta sin poder cobrar.
    expect(motivo(3)).toBeNull();
    expect(motivo('3')).toBeNull();
    expect(motivo(1)).toBeNull();
  });
});

describe('motivoDeCantidadInvalida · la regla de la 017, con 3 decimales', () => {
  // Se ejercita acá aunque el endpoint todavía no la use: una decisión que se
  // tomó (PENDIENTE 1, opción A) y no quedó ejecutada en ningún lado se vuelve
  // a discutir.
  const motivo = (v) => motivoDeCantidadInvalida(v, 3);

  it('0.25 se ACEPTA: es un cuarto de kilo y la balanza informa gramos', () => {
    expect(motivo(0.25)).toBeNull();
    expect(motivo(0.001)).toBeNull();
  });

  it('0.00004 se RECHAZA: es el defecto de hoy corrido cuatro ceros', () => {
    // Migrar la columna no arregla la validación: la corre un escalón. Hoy 0.4
    // se guarda como 0; después, 0.00004 se guardaría como 0.0000.
    expect(motivo(0.00004)).toBe('admite como máximo 3 decimales');
  });

  it('un entero sigue valiendo con la puerta abierta', () => {
    expect(motivo(3)).toBeNull();
  });
});

describe('Los cuatro caminos por los que una cantidad de texto rompe', () => {
  it('Math.max(0, "100" + 5) NO es 105', () => {
    // H3, criterio de éxito 6. Es el peor de los cuatro sitios y el que parece
    // seguro: hay una función numérica alrededor de la suma, y la suma **ya
    // concatenó**. `Math.max` convierte después, no lanza nada, y devuelve un
    // número perfectamente creíble.
    expect(Math.max(0, '100' + 5)).toBe(1005);
    expect(Math.max(0, '100' + 5)).not.toBe(105);

    // Lo que la corrección escribe en su lugar.
    expect(Math.max(0, aCantidad('100') + 5)).toBe(105);
  });

  it('la RESTA anda y por eso no se toca: "100" - 0.25 es 99,75', () => {
    // `stock.js:145-146` y `sales.js:553-554` son restas y están bien. Se
    // afirma para que nadie las «arregle por consistencia» y escriba un test
    // que pasa con y sin el cambio.
    expect('100' - 0.25).toBe(99.75);
    expect(typeof ('100' - 0.25)).toBe('number');
  });

  it('"0.0000" es truthy: todo `|| 0` sobre una cantidad cambia de rama', () => {
    const desdeLaBase = '0.0000';

    expect(desdeLaBase || 0).toBe('0.0000');
    expect(textoDeCantidad(desdeLaBase)).toBe('0');
  });

  it('parseInt("0.4") es 0: truncar no avisa', () => {
    expect(parseInt('0.4', 10)).toBe(0);
    expect(aCantidad('0.4')).toBe(0.4);
  });
});
