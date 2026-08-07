const fs = require('fs');
const path = require('path');

const {
  SE_NIEGAN,
  DESDE_POR_DEFECTO,
  migracionesDelRango,
  diferencias,
} = require('../../scripts/verificar-reversibilidad');

// ════════════════════════════════════════════
//  Que el `down` de cada migración siga existiendo y siga diciendo lo que dice
//
//  ── Qué es esto y qué NO es ──
//
//  El paso manual P5 se cerró con `scripts/verificar-reversibilidad.js`, que
//  levanta un Postgres descartable, aplica cada migración, la revierte y COMPARA
//  el esquema. Eso es lo que contesta «¿revierte bien?», y no puede vivir en la
//  suite rápida: tarda minutos y necesita Docker.
//
//  Esta guardia es la mitad que sí corre siempre, y contesta tres preguntas más
//  chicas que no necesitan base:
//
//   1. **Que haya un `down`.** Una migración sin `down` no falla al aplicarse:
//      falla el día del rollback, con `sequelize-cli` diciendo algo que no nombra
//      la migración. La que la agregó ya no está mirando.
//   2. **Que las que se niegan sigan negándose, y con un mensaje que sirva.** El
//      mensaje es la mitad del comportamiento: alguien que corre un `undo`
//      reflejo después de un deploy raro tiene que leer por qué no se puede y qué
//      hacer si igual hace falta. Un `throw new Error('no')` cumpliría el
//      «falla» y no serviría de nada.
//   3. **Que el procedimiento cubra algo.** Un script que verifica cero
//      migraciones sale en verde, y ése es el modo de falla que este repositorio
//      viene juntando: una guardia recorriendo un árbol vacío.
//
//  ── Por qué acá hay dobles y en integración no ──
//
//  Los dos casos con doble —`20260804` y `20260809-unico` sin su tabla de
//  archivo— no prueban SQL: prueban una rama de control de flujo que se toma
//  antes de tocar la base. `tests/helpers/modelosFalsos.js` avisa que un doble no
//  entiende de `group`, `lock` ni tipos, y tiene razón; acá no hay nada de eso
//  que entender. Lo que sí depende del motor —que el esquema quede igual— está en
//  el script y no acá.
// ════════════════════════════════════════════

const CARPETA = path.join(__dirname, '..', 'migrations');

const ARCHIVOS = fs.readdirSync(CARPETA).filter((n) => n.endsWith('.js')).sort();

const cargar = (archivo) => require(path.join(CARPETA, archivo));

/**
 * Un `queryInterface` de mentira que contesta «la tabla de archivo NO está».
 *
 * Es lo único que hace falta para llegar a la rama del rechazo: las dos
 * migraciones que archivan filas preguntan por su tabla con `to_regclass` antes
 * de tocar nada.
 */
function sinTablaDeArchivo() {
  const sentencias = [];

  const sequelize = {
    transaction: (fn) => fn('transaccion-falsa'),
    query: async (sql) => {
      sentencias.push(sql);

      if (sql.includes('to_regclass')) return [[{ hay: false }]];

      return [[]];
    },
  };

  return { queryInterface: { sequelize }, sentencias };
}

describe('Toda migración se puede intentar revertir', () => {
  it('encuentra las migraciones que dice revisar', () => {
    // Ancla. Sin esto, un `readdir` sobre una carpeta que se movió dejaría a
    // esta guardia pasando por vacío.
    expect(ARCHIVOS.length).toBeGreaterThanOrEqual(20);
  });

  it('NINGUNA migración se quedó sin `down`', () => {
    // Sin `down`, `db:migrate:undo` falla con un error que no nombra la
    // migración, el día del rollback y no el día que se escribió.
    const sinDown = ARCHIVOS.filter((archivo) => typeof cargar(archivo).down !== 'function');

    expect(sinDown).toEqual([]);
  });

  it('todas exportan además su `up`', () => {
    const sinUp = ARCHIVOS.filter((archivo) => typeof cargar(archivo).up !== 'function');

    expect(sinUp).toEqual([]);
  });
});

describe('Las que se niegan a revertirse lo dicen, y dicen qué hacer', () => {
  it('el esquema de permisos se NIEGA, y no borra las tablas de nadie', async () => {
    // Es la decisión del proyecto 0: en producción esas cuatro tablas existen
    // desde antes de la migración, con los roles y los permisos de todo el mundo
    // adentro. Un `down` que las borre deja a la empresa sin poder hacer nada.
    const { down } = cargar('20260806-esquema-de-permisos.js');

    await expect(down()).rejects.toThrow(/no es reversible/i);
  });

  it('ese mensaje nombra lo que se perdería y cómo revertir a mano', async () => {
    // La mitad que un `expect(...).rejects.toThrow()` a secas no cubre: sin
    // esto, cambiar el texto por «no se puede» dejaría el caso en verde y a la
    // próxima persona sin saber qué hacer.
    const { down } = cargar('20260806-esquema-de-permisos.js');

    const error = await down().catch((e) => e);

    for (const palabra of ['roles', 'usuario_permisos', 'rol_id', 'a mano']) {
      expect(error.message).toContain(palabra);
    }
  });

  it('la identidad de sucursal se niega si le borraron el archivo, en vez de revertir a medias', async () => {
    // Su `down` reconstruye las filas de `stock` desde `stock_migracion_sucursal`.
    // Sin esa tabla no hay con qué, y seguir adelante dejaría el stock partido:
    // mejor cortar antes de tocar nada.
    const { queryInterface } = sinTablaDeArchivo();
    const { down } = cargar('20260804-identidad-de-sucursal-en-stock.js');

    await expect(down(queryInterface)).rejects.toThrow(/stock_migracion_sucursal/);
  });

  it('el único de insumo por receta NO se niega sin archivo: saca el índice y avisa', async () => {
    // La diferencia con la de arriba es deliberada y conviene que quede fijada:
    // acá la parte irreversible es solo la de los datos. El índice único sí se
    // puede sacar sin el archivo, y sacarlo es lo que devuelve la base a un
    // estado usable. Lo que no se hace es callarse.
    const { queryInterface, sentencias } = sinTablaDeArchivo();
    const { down, ARCHIVO, INDICE } = cargar('20260809-unico-de-insumo-por-receta.js');

    const dicho = [];
    const original = console.log;
    console.log = (linea) => dicho.push(String(linea));

    try {
      await expect(down(queryInterface)).resolves.toBeUndefined();
    } finally {
      console.log = original;
    }

    expect(sentencias.some((sql) => sql.includes(`DROP INDEX IF EXISTS ${INDICE}`))).toBe(true);
    expect(dicho.join('\n')).toContain(ARCHIVO);
  });
});

describe('El archivo de la fusión guarda la fecha ENTERA', () => {
  // Lo encontró el paso P5: el `down` reinsertaba las filas absorbidas con
  // `created_at` truncado al milisegundo, así que la fila volvía pero no era la
  // misma fila. El motivo está abajo, ejecutado y no contado.
  const fuente = fs.readFileSync(path.join(CARPETA, '20260809-unico-de-insumo-por-receta.js'), 'utf8');

  it('un `Date` de JavaScript NO puede transportar los microsegundos de Postgres', () => {
    // Ésta es la causa, y está acá para que el `::text` de la migración no se
    // lea como una manía de estilo: el driver entrega un `Date`, `JSON.stringify`
    // lo escribe en ISO con milésimas, y los microsegundos ya no están.
    const deLaBase = '2026-08-05 23:59:58.621389+00';

    expect(JSON.parse(JSON.stringify(new Date(deLaBase)))).toBe('2026-08-05T23:59:58.621Z');
  });

  it('la consulta que arma el archivo saca las dos fechas como texto', () => {
    // Guardia estática porque el defecto vive en el SQL, no en una función que
    // se pueda llamar: `planificarFusiones` nunca mira estas dos columnas.
    expect(fuente).toContain('ri.created_at::text AS created_at');
    expect(fuente).toContain('ri.updated_at::text AS updated_at');
  });
});

describe('El procedimiento del paso P5 sigue cubriendo algo', () => {
  it('el script verifica al menos una migración', () => {
    // Un `--desde` que apunte a la última migración deja el script verificando
    // cero migraciones y saliendo en verde.
    expect(migracionesDelRango(DESDE_POR_DEFECTO).length).toBeGreaterThanOrEqual(1);
  });

  it('las que el script espera que se nieguen existen y se niegan de verdad', async () => {
    const nombres = Object.keys(SE_NIEGAN);

    expect(nombres.length).toBeGreaterThanOrEqual(1);

    for (const archivo of nombres) {
      expect(ARCHIVOS).toContain(archivo);

      // Si alguien hiciera reversible una de estas, el script la seguiría
      // esperando en rojo y nadie sabría por qué: acá se ve al toque.
      const error = await cargar(archivo).down().catch((e) => e);

      expect(error).toBeInstanceOf(Error);

      for (const palabra of SE_NIEGAN[archivo]) {
        expect(error.message.toLowerCase()).toContain(palabra.toLowerCase());
      }
    }
  });

  it('las que se niegan están DENTRO del rango que el script recorre', () => {
    // Una migración irreversible anterior al `--desde` nunca se verificaría, y
    // la entrada en `SE_NIEGAN` sería una promesa que no se cumple.
    const rango = migracionesDelRango(DESDE_POR_DEFECTO);

    for (const archivo of Object.keys(SE_NIEGAN)) {
      expect(rango).toContain(archivo);
    }
  });
});

describe('La semilla toca las tablas que la migración de datos de TiendaNube necesita', () => {
  // ⚠ Esta guardia es grosera a propósito, y el motivo importa: **el defecto que
  // evita no lo ve ningún test de comportamiento, porque el script sale en verde
  // igual**.
  //
  // `20260810-tiendanube-vinculacion-y-estado` muda `settings.tiendanube_user_id`
  // a una tabla nueva y su `down` la tiene que devolver. Hasta la funcionalidad
  // 013, `sembrar()` insertaba en once tablas y en ninguna de éstas cuatro: sobre
  // esa semilla el `down` no restauraba ninguna fila, el script comparaba dos
  // esquemas idénticos y salía con código 0 **sin haber ejecutado la rama de
  // datos**. Medido: con la semilla vieja, un `down` al que se le saca el
  // `INSERT INTO settings` pasa como BIEN; con la nueva, lo reporta como
  // «FALTA datos/settings: tiendanube_user_id empresa=1 = 1234567890».
  const FUENTE = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'verificar-reversibilidad.js'),
    'utf8'
  );

  /**
   * El archivo sin comentarios de JS **ni de SQL**.
   *
   * La semilla es un template literal con comentarios `--` adentro que explican
   * por qué cada fila es como es, y varios nombran las mismas tablas. Sin sacar
   * esos comentarios, la guardia contestaría sobre la explicación de la semilla
   * en vez de sobre la semilla, que es exactamente la clase de verde vacío que
   * este archivo existe para no producir.
   */
  const sinComentarios = (texto) => texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')
    .replace(/(^|\n)\s*--[^\n]*/g, '$1');

  const CODIGO = sinComentarios(FUENTE);

  it('siembra las cuatro tablas sin las cuales el `down` no restaura nada', () => {
    const faltantes = ['settings', 'puntos_de_venta', 'stock', 'tiendanube_mappings']
      .filter((tabla) => !CODIGO.includes(`INSERT INTO ${tabla} `));

    expect(faltantes).toEqual([]);
  });

  it('siembra DOS sucursales, y la `principal` no es la de menor id', () => {
    // Con una sola sucursal, los tres escalones del COALESCE de la migración
    // devuelven la misma fila y el orden no se prueba. La `principal` va con el
    // id 2 justamente para que el primer escalón devuelva algo distinto de los
    // otros dos.
    const bloque = CODIGO.slice(CODIGO.indexOf('INSERT INTO puntos_de_venta '));

    expect(bloque).toMatch(/\(1, 1, [^)]*'deposito'/);
    expect(bloque).toMatch(/\(2, 1, [^)]*'principal'/);
  });

  it('siembra una empresa SIN sucursales con su fila de settings', () => {
    // Es la rama de la migración que deja la fila sin mudar y lo dice por
    // `console.log` en vez de fallar. Sin esta empresa, esa rama no se ejecuta
    // nunca.
    expect(CODIGO).toMatch(/\(2, 'Empresa sin sucursales'/);
    expect(CODIGO).toMatch(/'tiendanube_user_id',\s+2,/);
  });

  it('siembra el token, que es la fila que la migración NO tiene que tocar', () => {
    // El token se queda en `settings` a propósito (FR-077). Un `DELETE FROM
    // settings WHERE key LIKE 'tiendanube%'` mal escrito se lo llevaría puesto y
    // sin esta fila nadie se enteraría.
    expect(CODIGO).toContain("'tiendanube_access_token'");
  });

  it('la foto de datos MIRA settings: sin eso, la semilla no alcanza', () => {
    // Las dos mitades hacen falta y por separado no sirven de nada. La tabla
    // `settings` no cambia de forma con esta migración, así que el esquema queda
    // idéntico con un `down` correcto y con uno que no restaura nada: lo único
    // que los distingue es la fila, y la fila solo se compara si está en la foto.
    expect(CODIGO).toMatch(/settings:\s*await lineas/);
    expect(CODIGO).toMatch(/tiendanube_mappings:\s*await lineasSiExiste/);
  });

  it('la guardia mira el SQL y no los comentarios que lo explican', () => {
    // Sin el filtro de comentarios `--`, cualquiera de los casos de arriba
    // pasaría con la semilla vacía y una explicación puesta al lado.
    expect(sinComentarios('    -- INSERT INTO settings (key)\n    SELECT 1;'))
      .not.toContain('INSERT INTO settings');
    expect(sinComentarios('    INSERT INTO settings (key) VALUES (1);'))
      .toContain('INSERT INTO settings');
  });
});

describe('`sesiones` nace con el UNIQUE que arbitra la carrera del alta', () => {
  // ⚠ Este índice **no es una optimización**, y por eso tiene guardia propia.
  //
  // `registrarSesion` corre en todos los requests y el Panel dispara varios al
  // montar: los primeros dos del mismo navegador entran los dos por «esta sesión
  // no existe» y los dos insertan. Lo único que hace que quede UNA fila es el
  // único de la base — el `catch` del `SequelizeUniqueConstraintError` de
  // `sesionesService.registrar` no tiene sentido sin él.
  //
  // Sin el `UNIQUE`, un `CREATE INDEX` a secas deja la migración aplicándose sin
  // error, la carrera pasa a producir dos filas por navegador, la lista muestra
  // el mismo dispositivo dos veces y **cerrar una deja la otra abierta**. Nada
  // de eso falla: simplemente no funciona.
  //
  // El caso de integración que lo ejercita —dos requests en paralelo, una sola
  // fila— vive en `integracion/sesiones.integracion.test.js`. Éste es la mitad
  // que corre siempre y no necesita Postgres.
  const MIGRACION = '20260812-sesiones-de-usuario.js';

  const Sesion = require('../models/Sesion');

  it('la migración existe y declara sus índices', () => {
    // Ancla: sin esto, renombrar el archivo dejaría las dos pruebas de abajo
    // reventando con un ENOENT que no nombra el problema.
    expect(ARCHIVOS).toContain(MIGRACION);
    expect(Array.isArray(cargar(MIGRACION).INDICES)).toBe(true);
  });

  it('el índice de (usuario_id, dispositivo) es UNIQUE', () => {
    const { INDICES } = cargar(MIGRACION);
    const indice = INDICES.find((i) => i.columnas === 'usuario_id, dispositivo');

    expect(indice).toBeDefined();
    expect(indice.unico).toBe(true);
  });

  it('el SQL que la migración ejecuta dice UNIQUE, y no solo la lista', () => {
    // La otra mitad, y muerde al revés: la lista puede decir `unico: true` y el
    // bucle que la recorre ignorarlo. Lo que llega a la base es el string.
    const fuente = fs.readFileSync(path.join(CARPETA, MIGRACION), 'utf8');

    expect(fuente).toContain("CREATE ${unico ? 'UNIQUE ' : ''}INDEX");
  });

  it('el modelo declara el MISMO índice, con el mismo nombre', () => {
    // Sin el `name` explícito, Sequelize lo llamaría
    // `sesiones_usuario_id_dispositivo` y un `sync({ alter: true })` en
    // desarrollo crearía un SEGUNDO índice sobre las mismas columnas.
    const { INDICES } = cargar(MIGRACION);

    // Sequelize normaliza la lista al definir el modelo y le agrega `parser` y
    // `type`: se comparan las tres claves que importan y no el objeto entero,
    // que traería basura del framework a la aserción.
    const delModelo = (Sesion.options.indexes || [])
      .map(({ unique, name, fields }) => ({ unique, name, fields }));

    expect(delModelo).toEqual([
      { unique: true, name: INDICES[0].nombre, fields: ['usuario_id', 'dispositivo'] },
    ]);
  });

  it('`sesiones` NO tiene empresa_id, y eso es la decisión y no un olvido', () => {
    // Ponerlo obligaría a elegir cuál —¿la de cuando entró?— y la columna
    // quedaría mintiendo apenas la persona use el selector de empresa. El
    // aislamiento sale de `usuario_empresas`, en `sesionesDeLaEmpresa`.
    expect(Object.keys(Sesion.rawAttributes)).not.toContain('empresa_id');
  });
});

describe('El comparador de fotos, del que depende todo el resultado', () => {
  // ⚠ Un comparador que devolviera siempre `[]` dejaría el script en verde para
  // siempre, y la salida se vería idéntica a la de una base que revierte
  // perfecto. Es el punto ciego del procedimiento entero.
  const foto = (extra = {}) => ({
    tablas: ['products', 'recipes'],
    tiposEnum: ['enum_products_unit_type = 1:unidad'],
    datos: { recipe_items: ['1 receta=1 insumo=2 cantidad=0.2000'] },
    ...extra,
  });

  it('dos fotos iguales no dan ninguna diferencia', () => {
    expect(diferencias(foto(), foto())).toEqual([]);
  });

  it('lo que se perdió sale como FALTA', () => {
    const sinRecipes = foto({ tablas: ['products'] });

    expect(diferencias(foto(), sinRecipes)).toEqual(['  FALTA  tablas: recipes']);
  });

  it('el tipo huérfano que quedó sale como SOBRA', () => {
    // Es el caso que nombra el `down` de los ENUM: convertir las columnas y
    // olvidarse de borrar el tipo deja la base parecida pero no igual.
    const conHuerfano = foto({
      tiposEnum: ['enum_products_unit_type = 1:unidad', 'enum_suscripciones_status = 1:trialing'],
    });

    expect(diferencias(foto(), conHuerfano))
      .toEqual(['  SOBRA  tiposEnum: enum_suscripciones_status = 1:trialing']);
  });

  it('mira ADENTRO de los datos y no solo del esquema', () => {
    // `datos` es una sección anidada: sin la recursión, una fila que el `down`
    // no repuso pasaría desapercibida y el script diría que todo está bien.
    const sinLaFila = foto({ datos: { recipe_items: [] } });

    expect(diferencias(foto(), sinLaFila))
      .toEqual(['  FALTA  datos/recipe_items: 1 receta=1 insumo=2 cantidad=0.2000']);
  });

  it('una fila repetida cuenta dos veces, no una', () => {
    // Se comparan multiconjuntos y no conjuntos: «el `down` reinsertó la fila
    // dos veces» es un resultado posible, y con `Set` se vería igual que
    // reinsertarla una sola.
    const duplicada = foto({ tablas: ['products', 'products', 'recipes'] });

    expect(diferencias(foto(), duplicada)).toEqual(['  SOBRA  tablas: products']);
  });
});
