#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  Informe: qué le va a hacer a los datos la migración de sucursales
 *
 *  `stock.punto_de_venta_id` pasa a ser la identidad de la sucursal y a ser
 *  obligatorio. Para llegar ahí hay que mandar a alguna sucursal las filas que
 *  hoy no tienen ninguna, y **fusionar las que queden repetidas** para el mismo
 *  producto y la misma sucursal.
 *
 *  Fusionar es sumar, y sumar puede estar mal. Dos filas del mismo producto en
 *  la misma sucursal pueden ser dos pilas de mercadería —40 en el depósito y
 *  12 en el mostrador— o **una sola pila anotada dos veces**: el operador cargó
 *  100 por la pantalla y después importó la lista del proveedor con las mismas
 *  100. En el primer caso la suma es correcta; en el segundo infla el
 *  inventario al doble. En la fila de stock no queda registrado quién la
 *  escribió, así que no hay forma de distinguirlas con certeza.
 *
 *  Por eso existe este informe: **se mira antes de migrar**. Corre exactamente
 *  la misma función que va a correr la migración (`utils/consolidacionDeStock`),
 *  así que es una vista previa de verdad y no una segunda opinión.
 *
 *  ── Lo único que hay que saber para correrlo ──
 *
 *    npm --prefix apps/api run informe:stock
 *
 *  **No escribe nada.** Ni una fila, ni una tabla, ni un índice. Se puede
 *  correr las veces que haga falta, y correrlo por error contra producción no
 *  cambia un solo dato. Es la vista previa, no un ensayo.
 *
 *  Cómo se lee y qué hacer con lo que dice: `docs/OPERACION.md`, sección
 *  «Identidad de sucursal en stock».
 * ════════════════════════════════════════════
 */

require('dotenv').config();

const sequelize = require('../src/config/database');
const { planificar } = require('../src/utils/consolidacionDeStock');

const ANCHO = 78;
const REGLA = '═'.repeat(ANCHO);
const SUBREGLA = '─'.repeat(ANCHO);

/** Una línea de resumen con los puntitos, para que los números queden en columna. */
function renglon(texto, valor, sangria = 2) {
  const izquierda = ' '.repeat(sangria) + texto + ' ';
  const derecha = String(valor);
  const puntos = Math.max(1, ANCHO - izquierda.length - derecha.length - 1);

  return izquierda + '.'.repeat(puntos) + ' ' + derecha;
}

/** Una fecha legible por una persona, en hora local. */
function fecha(valor) {
  if (!valor) return '—';

  const d = valor instanceof Date ? valor : new Date(valor);
  if (!Number.isFinite(d.getTime())) return String(valor);

  const p = (n) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Una fecha sin hora (las columnas DATEONLY llegan como 'AAAA-MM-DD'). */
function soloFecha(valor) {
  if (!valor) return '—';
  return String(valor).slice(0, 10);
}

/** El nombre de la sucursal como lo va a leer una persona. */
function nombreDeSucursal(pv) {
  if (!pv) return '(sin sucursal)';
  if (pv.a_crear) return `«${pv.name}» (${pv.code}) — todavía no existe, la crea la migración`;

  return pv.code ? `«${pv.name}» (${pv.code})` : `«${pv.name}» (sin código)`;
}

/**
 * Lee todo lo que el plan necesita. Solo lecturas.
 */
async function leer() {
  const [filas] = await sequelize.query(`
    SELECT id, empresa_id, product_id, punto_de_venta_id, location,
           quantity, available, min_stock, current_batch,
           expiration_date, purchase_date, updated_at
      FROM stock
     ORDER BY empresa_id, product_id, id
  `);

  const [puntosDeVenta] = await sequelize.query(`
    SELECT id, empresa_id, name, code, is_active
      FROM puntos_de_venta
     ORDER BY empresa_id, id
  `);

  const [empresas] = await sequelize.query(`
    SELECT id, name FROM empresas ORDER BY id
  `);

  const [productos] = await sequelize.query(`
    SELECT id, name, sku FROM products
  `);

  return { filas, puntosDeVenta, empresas, productos };
}

/** Cuenta las asignaciones de una empresa por cómo se resolvió la sucursal. */
function contarMotivos(asignaciones) {
  const conteo = { ya_tenia: 0, code: 0, por_defecto: 0, pv_a_crear: 0, sin_destino: 0 };

  for (const a of asignaciones) {
    if (conteo[a.motivo] === undefined) conteo[a.motivo] = 0;
    conteo[a.motivo]++;
    if (a.punto_de_venta_id_nuevo === null && !a.destino_a_crear) conteo.sin_destino++;
  }

  return conteo;
}

/** El bloque de una fusión: las filas que se juntan y qué queda. */
function imprimirFusion(fusion, nombreProducto) {
  const producto = nombreProducto(fusion.product_id);

  console.log('');
  console.log(`  ▸ Producto ${fusion.product_id} ${producto}`);
  console.log(`    Sucursal destino: ${nombreDeSucursal(fusion.destino)}`);
  console.log('');
  console.log('      fila    location        cant.   disp.   lote            última escritura');

  for (const f of fusion.filas) {
    const marca = f.sobrevive ? ' ← sobrevive' : '';

    console.log(
      '      '
      + String(f.id).padEnd(8)
      + String(f.location === null ? '—' : f.location).padEnd(16)
      + String(f.quantity).padStart(5) + '   '
      + String(f.available).padStart(5) + '   '
      + String(f.current_batch || '—').padEnd(16)
      + fecha(f.updated_at)
      + marca
    );
  }

  const r = fusion.resultado;

  console.log('');
  console.log(
    `      Queda una sola fila: cantidad ${r.quantity} · disponible ${r.available} · `
    + `mínimo ${r.min_stock}`
  );
  console.log(
    `      vence ${soloFecha(r.expiration_date)} · comprado ${soloFecha(r.purchase_date)} · `
    + `lote ${r.current_batch || '—'}`
  );

  if (fusion.lotes_descartados.length) {
    console.log(`      Lotes que se descartan: ${fusion.lotes_descartados.join(', ')}`);
  }

  if (fusion.revisar) {
    console.log('');
    console.log('      ⚠  REVISAR. Las señales, una por una:');

    // Una por línea y no todas juntas: la lista se lee de un vistazo y se
    // puede tachar de a una mientras se cuenta la mercadería.
    for (const senal of fusion.senales) console.log(`         · ${senal}`);

    console.log('         Puede ser una sola pila anotada dos veces. Se resuelve');
    console.log('         contando la mercadería, no leyendo más el informe.');
  }
}

async function main() {
  if (process.argv.includes('--ayuda') || process.argv.includes('-h')) {
    console.log(AYUDA);
    return;
  }

  const { filas, puntosDeVenta, empresas, productos } = await leer();

  const nombreDeEmpresa = (id) => {
    const e = empresas.find((x) => x.id === id);
    return e ? `«${e.name}»` : '(empresa sin nombre)';
  };

  const nombreProducto = (id) => {
    const p = productos.find((x) => x.id === id);
    if (!p) return '(el producto ya no existe)';

    return p.sku ? `«${p.name}» (SKU ${p.sku})` : `«${p.name}»`;
  };

  const plan = planificar({ filas, puntosDeVenta });

  const sinSucursal = filas.filter((f) => f.punto_de_venta_id === null).length;
  const motivos = contarMotivos(plan.asignaciones);
  const aCrear = plan.avisos.filter((a) => a.tipo === 'pv_a_crear');
  const otrosAvisos = plan.avisos.filter((a) => a.tipo !== 'pv_a_crear');
  const marcadas = plan.fusiones.filter((f) => f.revisar);
  const filasQueDesaparecen = plan.fusiones.reduce((acc, f) => acc + f.filas.length - 1, 0);

  const empresasConStock = [...new Set(filas.map((f) => f.empresa_id))].sort((a, b) => a - b);

  // ── Encabezado ──
  console.log('');
  console.log(REGLA);
  console.log(' INFORME · Identidad de sucursal en stock');
  console.log(` Base: ${sequelize.config.host || '(local)'}/${sequelize.getDatabaseName()}`
    + `  ·  entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(` Fecha: ${fecha(new Date())}`);
  console.log('');
  console.log(' Este informe NO modifica ningún dato. Es la vista previa de la');
  console.log(' migración, y corre exactamente la misma función que ella.');
  console.log(REGLA);

  // ── Resumen ──
  console.log('');
  console.log('RESUMEN');
  console.log('');
  console.log(renglon('Filas de stock leídas', filas.length));
  console.log(renglon('Empresas con stock', empresasConStock.length));
  console.log(renglon('Sucursales existentes', puntosDeVenta.length));
  console.log('');
  console.log(renglon('Filas que HOY no tienen sucursal', sinSucursal));
  console.log(renglon('· que mapean por coincidencia de código', motivos.code, 4));
  console.log(renglon('· que caen al punto de venta por defecto', motivos.por_defecto, 4));
  console.log(renglon('· que van a una sucursal todavía por crear', motivos.pv_a_crear, 4));
  console.log(renglon('Filas que ya tienen sucursal y no se mueven', motivos.ya_tenia));
  console.log('');
  console.log(renglon('Sucursales que hay que crear antes de migrar', aCrear.length));
  console.log(renglon('Fusiones de filas duplicadas', plan.fusiones.length));
  console.log(renglon('· marcadas «revisar»', marcadas.length, 4));
  console.log(renglon('Filas que desaparecen al fusionar (quedan archivadas)', filasQueDesaparecen));

  console.log('');

  if (filas.length === 0) {
    console.log('  No hay ninguna fila de stock en esta base: no hay nada que migrar.');
  } else if (plan.fusiones.length === 0) {
    console.log(`  El informe leyó las ${filas.length} filas de stock y NO encontró duplicados:`);
    console.log('  no hay nada que fusionar. La migración solo asigna sucursales.');
  } else if (marcadas.length === 0) {
    console.log(`  Hay ${plan.fusiones.length} fusión(es) y ninguna quedó marcada «revisar»:`);
    console.log('  en todas hay lotes distintos que separan las filas, así que sumar es');
    console.log('  casi seguro correcto. Aun así, cada fila que desaparece queda archivada.');
  } else {
    console.log(`  ⚠  Marcadas «revisar»: ${marcadas.length} de ${plan.fusiones.length}.`);
    console.log('  La marca NO es un error: es la única señal que hay para distinguir');
    console.log('  «dos pilas» de «una pila anotada dos veces». Ver el detalle abajo y');
    console.log('  docs/OPERACION.md antes de autorizar la migración.');
  }

  // ── Detalle por empresa ──
  if (filas.length > 0) {
    console.log('');
    console.log(REGLA);
    console.log(' DETALLE, POR EMPRESA');
    console.log(REGLA);
  }

  for (const empresaId of empresasConStock) {
    const deLaEmpresa = plan.asignaciones.filter((a) => a.empresa_id === empresaId);
    const suyas = contarMotivos(deLaEmpresa);
    const fusiones = plan.fusiones.filter((f) => f.empresa_id === empresaId);
    const sucursales = puntosDeVenta.filter((pv) => pv.empresa_id === empresaId);
    const crearAca = aCrear.filter((a) => a.empresa_id === empresaId);

    console.log('');
    console.log(`EMPRESA ${empresaId} ${nombreDeEmpresa(empresaId)}`);
    console.log(SUBREGLA);

    if (sucursales.length === 0) {
      console.log('  Sucursales: NINGUNA.');
    } else {
      console.log('  Sucursales:');
      for (const pv of sucursales) {
        const estado = pv.is_active ? '' : '  (inactiva)';
        console.log(`    ${String(pv.id).padStart(5)}  ${nombreDeSucursal(pv)}${estado}`);
      }
    }

    for (const aviso of crearAca) {
      console.log('');
      console.log(`  ⚠  ${aviso.mensaje}`);
    }

    console.log('');
    console.log(renglon('Filas de stock', deLaEmpresa.length));
    console.log(renglon('· ya tienen sucursal', suyas.ya_tenia, 4));
    console.log(renglon('· mapean por código', suyas.code, 4));
    console.log(renglon('· caen al por defecto', suyas.por_defecto, 4));
    console.log(renglon('· van a la sucursal que se va a crear', suyas.pv_a_crear, 4));

    const deOtraEmpresa = otrosAvisos.filter((a) => a.empresa_id === empresaId);

    for (const aviso of deOtraEmpresa) {
      console.log('');
      console.log(`  ⚠  ${aviso.mensaje}`);
    }

    console.log('');

    if (fusiones.length === 0) {
      console.log('  Fusiones: ninguna. En esta empresa no hay dos filas del mismo');
      console.log('  producto que caigan en la misma sucursal.');
    } else {
      const marcadasAca = fusiones.filter((f) => f.revisar).length;

      console.log(`  Fusiones: ${fusiones.length}, de las cuales ${marcadasAca} marcada(s) «revisar».`);

      for (const fusion of fusiones) imprimirFusion(fusion, nombreProducto);
    }
  }

  // ── Totales al pie ──
  console.log('');
  console.log(REGLA);
  console.log(' TOTALES');
  console.log(REGLA);
  console.log('');
  console.log(renglon('Filas de stock', filas.length));
  console.log(renglon('Suma de cantidades (tiene que ser la misma después)',
    filas.reduce((acc, f) => acc + Number(f.quantity || 0), 0)));
  console.log(renglon('Suma de disponibles',
    filas.reduce((acc, f) => acc + Number(f.available || 0), 0)));
  console.log(renglon('Sucursales a crear', aCrear.length));
  console.log(renglon('Fusiones', plan.fusiones.length));
  console.log(renglon('Fusiones marcadas «revisar»', marcadas.length));
  console.log(renglon('Filas de stock al terminar', filas.length - filasQueDesaparecen));
  console.log('');

  if (marcadas.length > 0) {
    console.log(` ⚠  Hay ${marcadas.length} fusión(es) para revisar ANTES de migrar.`);
    console.log('    Se resuelven contando la mercadería. Si el recuento dice que la');
    console.log('    suma infló el inventario, la fila original queda archivada en');
    console.log('    stock_migracion_sucursal y se corrige con un ajuste de stock.');
    console.log('');
  }

  console.log(' Este informe no modificó ningún dato. Correrlo de nuevo da lo mismo.');
  console.log(REGLA);
  console.log('');
}

const AYUDA = `
Informe de la migración de identidad de sucursal en stock.

  npm --prefix apps/api run informe:stock

Dice, por empresa: cuántas filas de stock no tienen sucursal, a cuál va cada
una, qué sucursales hay que crear y qué filas se fusionarían con cuáles y con
qué valores. Las fusiones sospechosas de ser "una sola pila anotada dos veces"
quedan marcadas «revisar».

NO modifica ningún dato. Es la vista previa de la migración y corre la misma
función que ella. Se puede correr las veces que haga falta.

Cómo se lee y qué hacer con lo que dice: docs/OPERACION.md.
`;

main()
  .catch((err) => {
    console.error('');
    console.error('El informe no pudo leer la base:', err.message);
    console.error('No se modificó ningún dato.');
    console.error('');
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
