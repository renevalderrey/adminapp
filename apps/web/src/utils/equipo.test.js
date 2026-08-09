import { describe, it, expect } from 'vitest'
import {
  ETIQUETAS_DE_INVITACION,
  ETIQUETAS_DE_MIEMBRO,
  ETIQUETAS_DE_ROL,
  MOTIVOS,
  ROLES_VALIDOS,
  esAdminActivo,
  esRolValido,
  esUltimoAdmin,
  estadoDeInvitacion,
  estadoDeMiembro,
  puedeCambiarRol,
  tonoDeInvitacion,
  tonoDeMiembro,
} from './equipo'

// ════════════════════════════════════════════
//  FAVALIO · Las reglas del equipo, del lado del navegador
//
//  Este archivo es el ESPEJO de `apps/api/src/utils/equipo.js` y sus tests son
//  los mismos casos: la regla tiene que contestar igual de los dos lados o la
//  pantalla deshabilita un selector que el servidor deja pasar —o al revés,
//  ofrece una opción que siempre falla—.
//
//  ⚠ **La guardia que compara los dos archivos NO está acá**: vive en
//  `apps/api/src/tests/sesionesYEquipo.test.js`, que puede leer los dos con
//  `fs`. Está en un solo lado a propósito; dos guardias de espejo son dos cosas
//  que mantener para verificar una.
//
//  Lo que sí está acá es la mitad que la guardia no cubre: que la función de
//  ESTE lado se comporte, y no solo que su tabla de nombres coincida.
// ════════════════════════════════════════════

const ADMIN = { id: 1, usuario_id: 10, role: 'admin', is_active: true }
const OTRO_ADMIN = { id: 2, usuario_id: 20, role: 'admin', is_active: true }
const ADMIN_DESACTIVADO = { id: 3, usuario_id: 30, role: 'admin', is_active: false }
const VENDEDOR = { id: 4, usuario_id: 40, role: 'vendedor', is_active: true }

describe('esUltimoAdmin', () => {
  it('el único admin activo ES el último, y un admin desactivado no lo salva', () => {
    // Las dos mitades juntas: la empresa tiene dos filas con rol `admin`, así
    // que mirar solo `role` dejaría degradar al único que todavía puede entrar.
    expect(esUltimoAdmin(ADMIN, [ADMIN, VENDEDOR])).toBe(true)
    expect(esUltimoAdmin(ADMIN, [ADMIN, ADMIN_DESACTIVADO])).toBe(true)
  })

  it('con un segundo admin activo ya no lo es', () => {
    expect(esUltimoAdmin(ADMIN, [ADMIN, OTRO_ADMIN])).toBe(false)
  })

  it('una lista incompleta no convierte «es el último» en «hay otro»', () => {
    expect(esUltimoAdmin(ADMIN, [])).toBe(true)
    expect(esUltimoAdmin(ADMIN, undefined)).toBe(true)
  })

  it('esAdminActivo trata la fila sin is_active como activa', () => {
    // Es la dirección segura: contarla de menos haría creer que no queda ningún
    // admin y bloquearía un cambio legítimo.
    expect(esAdminActivo({ role: 'admin' })).toBe(true)
    expect(esAdminActivo({ role: 'admin', is_active: false })).toBe(false)
    expect(esAdminActivo(null)).toBe(false)
  })
})

describe('puedeCambiarRol', () => {
  it('el último admin activo no se puede degradar, y el motivo dice qué hacer antes', () => {
    const r = puedeCambiarRol({ miembro: ADMIN, yo: { usuario_id: 20 }, miembros: [ADMIN, VENDEDOR] })

    expect(r.puede).toBe(false)
    expect(r.codigo).toBe('ULTIMO_ADMIN')
    expect(r.motivo).toBe(MOTIVOS.ULTIMO_ADMIN)
  })

  it('uno no se puede cambiar el rol a sí mismo', () => {
    const r = puedeCambiarRol({
      miembro: OTRO_ADMIN,
      yo: { usuario_id: 20 },
      miembros: [ADMIN, OTRO_ADMIN],
    })

    expect(r.puede).toBe(false)
    expect(r.codigo).toBe('NO_TE_PODES_TOCAR')
    expect(r.motivo).toBe(MOTIVOS.NO_TE_PODES_TOCAR)
  })

  it('a otro miembro, con otro admin en la empresa, sí', () => {
    // Sin este caso la función podría devolver `false` siempre y los dos de
    // arriba pasarían igual.
    expect(puedeCambiarRol({ miembro: VENDEDOR, yo: { usuario_id: 10 }, miembros: [ADMIN, VENDEDOR] }))
      .toEqual({ puede: true, motivo: '', codigo: null })
  })

  it('nunca devuelve undefined', () => {
    const r = puedeCambiarRol()

    expect(r.puede).toBe(false)
    expect(typeof r.motivo).toBe('string')
    expect(r.motivo.length).toBeGreaterThan(20)
  })
})

describe('el catálogo de roles incluye gerente', () => {
  it('son los cinco del catálogo del servidor', () => {
    // `gerente` es el que faltaba en `Team.jsx:37-42`: la empresa que tenía uno
    // veía su fila con el selector en blanco, y elegir cualquier opción lo
    // degradaba sin poder volver.
    expect(ROLES_VALIDOS.slice().sort()).toEqual(
      ['admin', 'compras', 'gerente', 'produccion', 'vendedor']
    )
    expect(ETIQUETAS_DE_ROL.gerente).toBe('Gerente')
  })

  it('esRolValido rechaza lo que no está en el catálogo', () => {
    expect(esRolValido('compras')).toBe(true)
    expect(esRolValido('Gerente')).toBe(false)
    expect(esRolValido(null)).toBe(false)
  })
})

describe('estadoDeMiembro · la columna Estado LEE el dato', () => {
  it('lee is_active en vez de decir «Activo» siempre', () => {
    // Hasta la 014 la columna estaba clavada: se dibujaba el badge verde con un
    // tilde sin mirar la fila. Alguien desactivado —que la API rechaza en el
    // request siguiente— se veía igual que alguien que entra todos los días.
    expect(estadoDeMiembro({ is_active: true })).toBe('activo')
    expect(estadoDeMiembro({ is_active: false })).toBe('desactivado')
  })

  it('una fila sin la columna se muestra activa, no desactivada', () => {
    // La dirección segura: marcar «Desactivado» a alguien que sí entra manda a
    // reactivar a quien nunca se fue.
    expect(estadoDeMiembro({})).toBe('activo')
  })

  it('los dos estados tienen etiqueta y tono, y son distintos entre sí', () => {
    for (const estado of Object.keys(ETIQUETAS_DE_MIEMBRO)) {
      expect(tonoDeMiembro(estado)).toBeTruthy()
    }
    expect(tonoDeMiembro('activo')).not.toBe(tonoDeMiembro('desactivado'))

    // Un estado que la pantalla no conoce cae en el neutro y NO en `undefined`:
    // un badge sin clases es un badge invisible.
    expect(tonoDeMiembro('inventado')).toBe(tonoDeMiembro('desactivado'))
  })
})

describe('estadoDeInvitacion · pendiente y vencida no son lo mismo', () => {
  const AHORA = new Date('2026-08-06T12:00:00Z')

  it('una pendiente que ya venció se muestra VENCIDA, aunque status siga en pending', () => {
    // El punto del hallazgo E10: nada pasa `status` a `expired` —ni un cron ni
    // el endpoint, que simplemente no la devuelve— así que una invitación de
    // hace tres meses figuraba «Pendiente» y quien la miraba esperaba a alguien
    // que ya no podía entrar.
    const vieja = { status: 'pending', expires_at: '2026-08-01T00:00:00Z' }

    expect(estadoDeInvitacion(vieja, AHORA)).toBe('vencida')
  })

  it('una pendiente con fecha futura sigue pendiente', () => {
    const viva = { status: 'pending', expires_at: '2026-08-20T00:00:00Z' }

    expect(estadoDeInvitacion(viva, AHORA)).toBe('pendiente')
  })

  it('aceptada, revocada y expired se leen de status', () => {
    expect(estadoDeInvitacion({ status: 'accepted' }, AHORA)).toBe('aceptada')
    expect(estadoDeInvitacion({ status: 'revoked' }, AHORA)).toBe('revocada')
    expect(estadoDeInvitacion({ status: 'expired' }, AHORA)).toBe('vencida')
  })

  it('sin fecha utilizable NO se afirma que venció', () => {
    // Decirlo sin saberlo mandaría a reinvitar a alguien cuyo enlace sirve.
    expect(estadoDeInvitacion({ status: 'pending' }, AHORA)).toBe('pendiente')
    expect(estadoDeInvitacion({ status: 'pending', expires_at: 'ayer' }, AHORA)).toBe('pendiente')
  })

  it('pendiente y vencida NO comparten tono: es la diferencia que hay que ver', () => {
    expect(tonoDeInvitacion('pendiente')).not.toBe(tonoDeInvitacion('vencida'))

    for (const estado of Object.keys(ETIQUETAS_DE_INVITACION)) {
      expect(tonoDeInvitacion(estado)).toBeTruthy()
    }
    expect(tonoDeInvitacion('inventado')).toBe(tonoDeInvitacion('revocada'))
  })
})
