const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const { GastoVariable, PuntoDeVenta } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const { hoyDelNegocio } = require('../utils/fechas');

// ════════════════════════════════════════════
//  Gastos variables
//
//  Gastos que cambian mes a mes y tienen un responsable: viaticos,
//  combustible, adelantos, compras sueltas. Distintos de los fijos, que son el
//  alquiler o el sueldo.
//
//  La separacion no es cosmetica: el punto de equilibrio se calcula con los
//  gastos FIJOS. Si los variables entraran en la misma tabla, cada mes que
//  alguien cargue un viatico le cambiaria el precio de venta recomendado a
//  todo el catalogo.
// ════════════════════════════════════════════

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * El mes que corresponde hoy en el negocio, si no piden otro.
 *
 * ⚠ **No es `new Date().toISOString().slice(0, 7)`**, que era lo que había.
 * `toISOString` da la fecha en UTC y Argentina es UTC−3: a partir de las 21:00
 * hora local, UTC ya está en el día siguiente. El último día del mes, entonces,
 * un gasto cargado a las 21:30 se archivaba en el mes SIGUIENTE —y el listado
 * abría en un mes vacío— todos los meses y solo a esa hora, que es cuando nadie
 * mira el campo. Sale de `hoyDelNegocio`, que respeta `Empresa.timezone`.
 *
 * @param {number} empresaId
 * @returns {Promise<string>} YYYY-MM en la zona horaria de la empresa.
 */
async function mesActual(empresaId) {
  return (await hoyDelNegocio(empresaId)).slice(0, 7);
}

/**
 * El `punto_de_venta_id` que mandó el cliente, validado contra su empresa.
 *
 * Antes llegaba como `punto_de_venta_id || null` directo al `create`: un id de
 * otra empresa cliente quedaba escrito, y la fila llevaba el `empresa_id`
 * correcto, así que ninguna guardia de aislamiento la veía. Es el «padre
 * ajeno», y esta forma —el `|| null`— es una de las dos que el detector de
 * `aislamientoEmpresas.test.js` no reconocía (FR-029, FR-033).
 *
 * El `null` es un caso legítimo: un gasto variable puede no ser de ninguna
 * sucursal.
 *
 * @returns {Promise<number|null>}
 * @throws {ErrorDeNegocio} Cuando la sucursal no es de la empresa.
 */
async function sucursalDelCuerpo(valor, empresaId) {
  if (valor === undefined || valor === null || valor === '') return null;

  const sucursal = await findScoped(PuntoDeVenta, valor, empresaId);
  if (!sucursal) throw new ErrorDeNegocio('Punto de venta no encontrado', 404);

  return sucursal.id;
}

function validarMes(mes) {
  if (!MES_VALIDO.test(mes)) {
    throw new ErrorDeNegocio('El mes tiene que tener el formato YYYY-MM (por ejemplo 2026-07).');
  }

  return mes;
}

// GET /api/gastos-variables?mes=YYYY-MM[&persona=]
router.get('/', checkPermission('gastos.ver'), async (req, res) => {
  try {
    const mes = validarMes(req.query.mes || await mesActual(req.empresaId));

    const where = { empresa_id: req.empresaId, mes };
    if (req.query.persona) where.persona = req.query.persona;

    const gastos = await GastoVariable.findAll({
      where,
      order: [['persona', 'ASC'], ['id', 'ASC']],
    });

    // Agrupado por persona: es como se carga y como se mira.
    const porPersona = new Map();
    let total = 0;

    for (const g of gastos) {
      const monto = Number(g.monto) || 0;
      total += monto;

      if (!porPersona.has(g.persona)) porPersona.set(g.persona, { persona: g.persona, total: 0, items: [] });

      const grupo = porPersona.get(g.persona);
      grupo.total += monto;
      grupo.items.push({
        id: g.id,
        nombre: g.nombre,
        monto,
        punto_de_venta_id: g.punto_de_venta_id,
      });
    }

    res.json({
      ok: true,
      data: {
        mes,
        total: Math.round(total * 100) / 100,
        personas: [...porPersona.values()],
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los gastos variables');
  }
});

// GET /api/gastos-variables/meses — Los meses que tienen algo cargado
router.get('/meses', checkPermission('gastos.ver'), async (req, res) => {
  try {
    const filas = await GastoVariable.findAll({
      where: { empresa_id: req.empresaId },
      attributes: ['mes'],
      group: ['mes'],
      order: [['mes', 'DESC']],
    });

    const meses = filas.map((f) => f.mes);

    // El mes actual siempre esta, aunque todavia no tenga nada: es donde se
    // va a cargar.
    const actual = await mesActual(req.empresaId);
    if (!meses.includes(actual)) meses.unshift(actual);

    res.json({ ok: true, data: meses });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los meses');
  }
});

// POST /api/gastos-variables
router.post('/', checkPermission('gastos.crear'), async (req, res) => {
  try {
    const { persona, mes, nombre, monto, punto_de_venta_id } = req.body;

    if (!persona || !String(persona).trim()) {
      throw new ErrorDeNegocio('Falta la persona.');
    }
    if (!nombre || !String(nombre).trim()) {
      throw new ErrorDeNegocio('Falta el concepto del gasto.');
    }

    const importe = Number(monto);
    if (!Number.isFinite(importe)) {
      throw new ErrorDeNegocio('El monto tiene que ser un numero.');
    }

    const sucursalId = await sucursalDelCuerpo(punto_de_venta_id, req.empresaId);

    const gasto = await GastoVariable.create({
      empresa_id: req.empresaId,
      persona: String(persona).trim(),
      mes: validarMes(mes || await mesActual(req.empresaId)),
      nombre: String(nombre).trim(),
      monto: importe,
      punto_de_venta_id: sucursalId,
    });

    res.status(201).json({ ok: true, data: gasto });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el gasto variable');
  }
});

// PUT /api/gastos-variables/:id
router.put('/:id', checkPermission('gastos.editar'), async (req, res) => {
  try {
    const gasto = await findScoped(GastoVariable, req.params.id, req.empresaId);
    if (!gasto) return res.status(404).json({ ok: false, error: 'Gasto no encontrado' });

    const cambios = {};

    if (req.body.persona !== undefined) cambios.persona = String(req.body.persona).trim();
    if (req.body.nombre !== undefined) cambios.nombre = String(req.body.nombre).trim();
    if (req.body.mes !== undefined) cambios.mes = validarMes(req.body.mes);
    if (req.body.punto_de_venta_id !== undefined) {
      cambios.punto_de_venta_id = await sucursalDelCuerpo(req.body.punto_de_venta_id, req.empresaId);
    }

    if (req.body.monto !== undefined) {
      const importe = Number(req.body.monto);
      if (!Number.isFinite(importe)) throw new ErrorDeNegocio('El monto tiene que ser un numero.');
      cambios.monto = importe;
    }

    // empresa_id nunca se toma del body: es lo que separa a una empresa
    // cliente de otra.
    await gasto.update(cambios);

    res.json({ ok: true, data: gasto });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar el gasto variable');
  }
});

// DELETE /api/gastos-variables/:id
router.delete('/:id', checkPermission('gastos.eliminar'), async (req, res) => {
  try {
    const borrados = await GastoVariable.destroy({
      where: { id: req.params.id, empresa_id: req.empresaId },
    });

    if (!borrados) return res.status(404).json({ ok: false, error: 'Gasto no encontrado' });

    res.json({ ok: true, message: 'Gasto eliminado' });
  } catch (err) {
    fallo(req, res, err, 'Error al eliminar el gasto variable');
  }
});

// GET /api/gastos-variables/resumen?desde=YYYY-MM&hasta=YYYY-MM
router.get('/resumen', checkPermission('gastos.ver'), async (req, res) => {
  try {
    const hasta = validarMes(req.query.hasta || await mesActual(req.empresaId));
    const desde = validarMes(req.query.desde || hasta);

    const gastos = await GastoVariable.findAll({
      where: {
        empresa_id: req.empresaId,
        mes: { [Op.between]: [desde, hasta] },
      },
    });

    const porMes = new Map();

    for (const g of gastos) {
      const monto = Number(g.monto) || 0;
      porMes.set(g.mes, (porMes.get(g.mes) || 0) + monto);
    }

    const meses = [...porMes.entries()]
      .map(([mes, total]) => ({ mes, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    res.json({
      ok: true,
      data: {
        desde,
        hasta,
        meses,
        total: Math.round(meses.reduce((s, m) => s + m.total, 0) * 100) / 100,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular el resumen de gastos variables');
  }
});

module.exports = router;
