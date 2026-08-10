const { Catalogo } = require('../models');
const { normalizarSlug } = require('./slugDeCatalogo');

// ════════════════════════════════════════════
//  De un slug a una empresa, sin sesión
//
//  Es la pieza que hace posible todo el camino público. Hasta el hito 10, el
//  `empresa_id` de cada request salía SIEMPRE de `req.usuario` —de la membresía
//  en `usuario_empresas`—, y `assertEmpresaId` tira 500 si no hay ninguna
//  resuelta. Acá del otro lado no hay usuario: hay alguien que escaneó un QR.
//
//  ── Por qué NO se reusa `loadEmpresaContext` ──
//
//  Sería lo cómodo: ya resuelve la empresa y ya la deja en `req`. Dos motivos
//  para no hacerlo, y los dos son de fondo.
//
//  **1 · Tiene la rama del superadmin.** `middleware/auth.js` deja que un
//  superadmin entre a cualquier empresa mandando la cabecera `X-Empresa-Id`,
//  sin membresía. Hoy esa rama no tendría cómo dispararse desde el camino
//  público —no hay usuario—, pero es una función de 250 líneas, y la próxima
//  persona que la toque no va a saber que además la usa un endpoint que
//  contesta sin autenticar. La distancia entre «hoy no se dispara» y «mañana
//  sí» es un `if` que alguien mueve.
//
//  **2 · Cuesta cuatro o cinco consultas por request.** Esto es una, de cuatro
//  columnas, sobre un índice único. El endpoint que la usa es el que abre cada
//  persona que escanea el QR.
//
//  ── Lo que esta función NO puede hacer ──
//
//  **No recibe `req`, así que no puede leer una cabecera aunque alguien
//  quiera.** Recibe un slug y devuelve cuatro números. Es una restricción del
//  tipo de la función, no una promesa del comentario.
// ════════════════════════════════════════════

/**
 * Las cuatro columnas, y ninguna más.
 *
 * Es la primera proyección explícita del camino público: lo que no esté acá no
 * puede salir de esta función por accidente, ni siquiera si mañana `catalogos`
 * gana una columna con el teléfono del dueño.
 */
const COLUMNAS = ['id', 'empresa_id', 'punto_de_venta_id', 'estado'];

/**
 * @param {string} slug Tal como vino de la URL. Se normaliza acá adentro.
 * @param {{ transaction?: object }} [opciones]
 * @returns {Promise<{ empresaId, catalogoId, puntoDeVentaId, estado } | null>}
 *   `null` si no existe. No tira: un slug inventado es el caso normal de una
 *   superficie pública, no un error del sistema.
 */
async function resolverCatalogoPorSlug(slug, opciones = {}) {
  const normalizado = normalizarSlug(slug || '');
  if (!normalizado) return null;

  // La MISMA normalización que usa el formulario del panel al guardar. Si acá
  // se buscara el slug crudo, `/c/Comprafit-Fitnet` daría 404 sobre un catálogo
  // que existe — y el que lo escribió así fue alguien copiando de un cartel.
  const fila = await Catalogo.findOne({
    attributes: COLUMNAS,
    where: { slug: normalizado },
    transaction: opciones.transaction,
  });

  if (!fila) return null;

  return {
    empresaId: fila.empresa_id,
    catalogoId: fila.id,
    puntoDeVentaId: fila.punto_de_venta_id,
    estado: fila.estado,
  };
}

module.exports = { resolverCatalogoPorSlug, COLUMNAS };
