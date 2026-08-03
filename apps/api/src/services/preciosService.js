const { Op } = require('sequelize');

const {
  sequelize, Product, ActualizacionPrecio, RecipeItem, Recipe,
} = require('../models');

const costService = require('./costService');
const { ErrorDeNegocio } = require('../utils/errores');
const {
  registrarCambioDeCosto,
  motivoActualizacionMasiva,
  motivoDeshacerMasiva,
} = require('../utils/historialDeCostos');

// ════════════════════════════════════════════
//  Actualizacion de precios en masa, con deshacer
//
//  Cuando un proveedor manda una lista nueva hay que tocar decenas o cientos
//  de productos de una sola vez. Hacerlo de a uno no es viable, y hacerlo en
//  masa sin red de seguridad es peor: un porcentaje mal tipeado deja el
//  catalogo entero mal y no hay forma de reconstruir los precios anteriores.
//
//  Por eso cada operacion guarda una foto de como estaba cada producto antes.
//  Deshacer es escribir esa foto de vuelta.
// ════════════════════════════════════════════

/** Tope de productos por operacion. */
const MAXIMO_PRODUCTOS = 2000;

const MODOS = {
  /** margin_override = valor (porcentaje de margen). */
  MARGEN: 'margen',
  /** price_override = valor (precio fijo en pesos). */
  PRECIO: 'precio',
  /** cost = cost * (1 + valor/100). Para listas nuevas de proveedor. */
  COSTO: 'costo',
};

function aCentavos(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Los tres campos que definen el precio de un producto. */
function fotoDe(producto) {
  return {
    cost: producto.cost === null ? null : Number(producto.cost),
    margin_override: producto.margin_override === null ? null : Number(producto.margin_override),
    price_override: producto.price_override === null ? null : Number(producto.price_override),
  };
}

/**
 * Calcula el estado nuevo de un producto.
 *
 * @returns {object|null} Los campos a escribir, o null si no cambia nada.
 */
function calcularCambio(producto, modo, valor) {
  if (modo === MODOS.MARGEN) {
    const nuevo = aCentavos(valor);
    if (Number(producto.margin_override) === nuevo) return null;

    // Un margen manual y un precio fijo se contradicen: el precio fijo gana
    // siempre, asi que dejarlo puesto haria que la actualizacion no tenga
    // ningun efecto visible. Se limpia.
    return { margin_override: nuevo, price_override: null };
  }

  if (modo === MODOS.PRECIO) {
    const nuevo = aCentavos(valor);
    if (Number(producto.price_override) === nuevo) return null;

    return { price_override: nuevo };
  }

  if (modo === MODOS.COSTO) {
    const costoActual = Number(producto.cost) || 0;
    const nuevo = aCentavos(costoActual * (1 + Number(valor) / 100));

    if (nuevo === costoActual) return null;
    if (nuevo < 0) {
      throw new ErrorDeNegocio(
        `El ajuste deja el costo de "${producto.name}" en negativo. Revisá el porcentaje.`
      );
    }

    return { cost: nuevo };
  }

  throw new ErrorDeNegocio(`Modo de actualizacion desconocido: ${modo}`);
}

/**
 * Aplica un cambio de precios a un conjunto de productos.
 *
 * Todo ocurre en una transaccion: o se actualizan todos y queda la foto, o no
 * se actualiza ninguno. Una actualizacion a medias es justamente lo que el
 * "deshacer" no podria reparar.
 */
async function aplicarMasivo({ empresaId, productIds, modo, valor, descripcion, usuario, usuarioId }) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new ErrorDeNegocio('Seleccioná al menos un producto.');
  }

  if (productIds.length > MAXIMO_PRODUCTOS) {
    throw new ErrorDeNegocio(
      `Son ${productIds.length} productos y el maximo por operacion es ${MAXIMO_PRODUCTOS}.`
    );
  }

  if (!Object.values(MODOS).includes(modo)) {
    throw new ErrorDeNegocio('Elegí que actualizar: margen, precio o costo.');
  }

  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    throw new ErrorDeNegocio('El valor tiene que ser un numero.');
  }

  if (modo !== MODOS.COSTO && numero < 0) {
    throw new ErrorDeNegocio('El valor no puede ser negativo.');
  }

  const ids = [...new Set(productIds.map((id) => parseInt(id, 10)).filter(Number.isInteger))];

  return sequelize.transaction(async (t) => {
    // El filtro por empresa_id va en la consulta, no despues: si viniera el id
    // de un producto de otra empresa cliente, aca directamente no aparece.
    const productos = await Product.findAll({
      where: { id: { [Op.in]: ids }, empresa_id: empresaId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (productos.length === 0) {
      throw new ErrorDeNegocio('Ninguno de los productos seleccionados existe en esta empresa.');
    }

    const cambios = [];
    const productosConCostoNuevo = [];

    for (const producto of productos) {
      const antes = fotoDe(producto);
      const nuevos = calcularCambio(producto, modo, numero);

      if (!nuevos) continue;

      await producto.update(nuevos, { transaction: t });

      cambios.push({
        product_id: producto.id,
        nombre: producto.name,
        antes,
        despues: fotoDe(producto),
      });

      if (modo === MODOS.COSTO) {
        productosConCostoNuevo.push({ producto, antes });
      }
    }

    if (cambios.length === 0) {
      throw new ErrorDeNegocio('Los productos seleccionados ya tenian ese valor: no hubo cambios.');
    }

    // Un cambio de costo tiene dos consecuencias que un cambio de margen no
    // tiene: queda registrado en el historial del producto, y se propaga a las
    // recetas que lo usan como insumo. Si no se propagara, un producto
    // elaborado seguiria costeado con el precio viejo de su insumo.
    for (const { producto, antes } of productosConCostoNuevo) {
      // El motivo se arma con el prefijo tipado de `utils/historialDeCostos` y
      // el texto que sale de ahi es **exactamente** el que esta guardado en la
      // base, faltas de acento incluidas: reescribirlo haria que dos filas del
      // mismo origen se lean distinto segun cuando se grabaron.
      await registrarCambioDeCosto({
        producto,
        costoAnterior: antes.cost || 0,
        costoNuevo: producto.cost,
        motivo: motivoActualizacionMasiva({ descripcion, porcentaje: numero }),
        usuarioId: usuarioId ?? null,
        transaction: t,
      });

      const dependientes = await RecipeItem.findAll({
        where: { ingredient_product_id: producto.id },
        include: [{ model: Recipe, as: 'recipe', attributes: ['product_id'] }],
        transaction: t,
      });

      for (const item of dependientes) {
        if (item.recipe && item.recipe.product_id) {
          await costService.recalculateCascadingCosts(item.recipe.product_id, new Set([producto.id]), t);
        }
      }
    }

    const actualizacion = await ActualizacionPrecio.create({
      empresa_id: empresaId,
      modo,
      valor: numero,
      descripcion: descripcion || null,
      usuario: usuario || null,
      cantidad_productos: cambios.length,
      cambios,
    }, { transaction: t });

    return {
      id: actualizacion.id,
      modo,
      valor: numero,
      cantidad_productos: cambios.length,
      omitidos: productos.length - cambios.length,
      no_encontrados: ids.length - productos.length,
    };
  });
}

/** Historial, de la mas reciente a la mas vieja. */
async function listarHistorial(empresaId, limite = 20) {
  const filas = await ActualizacionPrecio.findAll({
    where: { empresa_id: empresaId },
    order: [['created_at', 'DESC']],
    limit: Math.min(Number(limite) || 20, 100),
  });

  // `cambios` puede tener cientos de productos: en el listado va solo el
  // conteo. El detalle se pide por id cuando alguien lo quiere ver.
  return filas.map((f) => ({
    id: f.id,
    modo: f.modo,
    valor: Number(f.valor),
    descripcion: f.descripcion,
    usuario: f.usuario,
    cantidad_productos: f.cantidad_productos,
    revertida: f.revertida,
    revertida_at: f.revertida_at,
    fecha: f.created_at,
  }));
}

async function verDetalle(empresaId, id) {
  const actualizacion = await ActualizacionPrecio.findOne({
    where: { id, empresa_id: empresaId },
  });

  if (!actualizacion) throw new ErrorDeNegocio('No se encontro esa actualizacion.', 404);

  return actualizacion;
}

/**
 * Deshace una actualizacion: reescribe la foto anterior.
 *
 * Solo se puede deshacer la ULTIMA sin revertir. Deshacer una del medio
 * dejaria un estado que no existio nunca: si despues de la actualizacion A
 * hubo una B sobre los mismos productos, revertir A pisaria lo que hizo B con
 * valores anteriores a las dos. El sistema anterior no tenia esta restriccion
 * y por eso su historial podia dejar precios imposibles de explicar.
 */
async function deshacer({ empresaId, id, usuarioId }) {
  return sequelize.transaction(async (t) => {
    const actualizacion = await ActualizacionPrecio.findOne({
      where: { id, empresa_id: empresaId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!actualizacion) throw new ErrorDeNegocio('No se encontro esa actualizacion.', 404);
    if (actualizacion.revertida) throw new ErrorDeNegocio('Esa actualizacion ya se deshizo.');

    const ultima = await ActualizacionPrecio.findOne({
      where: { empresa_id: empresaId, revertida: false },
      order: [['created_at', 'DESC']],
      transaction: t,
    });

    if (ultima && ultima.id !== actualizacion.id) {
      throw new ErrorDeNegocio(
        'Solo se puede deshacer la ultima actualizacion. Deshacé primero las posteriores.'
      );
    }

    let restaurados = 0;
    let faltantes = 0;

    for (const cambio of actualizacion.cambios || []) {
      const producto = await Product.findOne({
        where: { id: cambio.product_id, empresa_id: empresaId },
        transaction: t,
      });

      // Un producto borrado despues de la actualizacion no se recrea: se
      // informa cuantos quedaron afuera.
      if (!producto) { faltantes++; continue; }

      const costoAntes = Number(producto.cost) || 0;
      await producto.update(cambio.antes, { transaction: t });
      const costoDespues = Number(producto.cost) || 0;

      const registrada = await registrarCambioDeCosto({
        producto,
        costoAnterior: costoAntes,
        costoNuevo: costoDespues,
        motivo: motivoDeshacerMasiva(actualizacion.id),
        usuarioId: usuarioId ?? null,
        transaction: t,
      });

      if (registrada) {
        const dependientes = await RecipeItem.findAll({
          where: { ingredient_product_id: producto.id },
          include: [{ model: Recipe, as: 'recipe', attributes: ['product_id'] }],
          transaction: t,
        });

        for (const item of dependientes) {
          if (item.recipe && item.recipe.product_id) {
            await costService.recalculateCascadingCosts(item.recipe.product_id, new Set([producto.id]), t);
          }
        }
      }

      restaurados++;
    }

    await actualizacion.update(
      { revertida: true, revertida_at: new Date() },
      { transaction: t }
    );

    return { id: actualizacion.id, restaurados, faltantes };
  });
}

module.exports = {
  MODOS,
  MAXIMO_PRODUCTOS,
  aplicarMasivo,
  listarHistorial,
  verDetalle,
  deshacer,
  calcularCambio,
  fotoDe,
};
