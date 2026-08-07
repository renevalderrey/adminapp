import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toast } from 'sonner'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Team from '@/pages/Team'
import PanelDeMiembro from '@/components/PanelDeMiembro'

// ════════════════════════════════════════════
//  ADMINAPP · /equipo, renderizado
//
//  Lo que se afirma acá es EL DIBUJO Y EL EFECTO. Las reglas —quién es el último
//  administrador activo, qué etiqueta lleva cada rol, cuándo una invitación pasó
//  a vencida— ya están en `utils/equipo.test.js`, que es cien veces más barato y
//  no se rompe cuando alguien mueve un `<div>`.
//
//  ── Los cuatro defectos que este archivo existe para que no vuelvan ──
//
//   1. **«Invitación enviada» siempre.** `Team.jsx:85` hacía
//      `toast.success('Invitación enviada')` sin mirar la respuesta. La API
//      manda `email_enviado` y un `message` que dice qué hacer desde hace meses,
//      y la pantalla los tiraba: quien invitaba veía «enviada» y el mail nunca
//      había salido. Es uno de los tres errores caros que abren
//      `CONVENCIONES.md`, y el único que estaba corregido de un solo lado — el
//      agujero se había MUDADO de `services/email.js` a esta pantalla.
//   2. **La columna Estado clavada en «Activo».** Se dibujaba un badge verde en
//      todas las filas sin leer `is_active`: alguien desactivado se veía igual
//      que alguien que entra todos los días.
//   3. **`gerente` no estaba en la tabla de roles.** Existía en el catálogo del
//      servidor desde siempre; la fila de un gerente mostraba el selector en
//      blanco y elegir cualquier opción lo degradaba sin poder volver.
//   4. **El selector de rol se dibujaba habilitado en TODAS las filas**,
//      incluida la propia y la del único administrador de la empresa, sin
//      `disabled`, sin explicación y sin ninguna regla del otro lado.
//
//  ── Cómo se monta ──
//
//  No se mockea `@/services/api` entero: el grafo de imports de esta pantalla
//  arrastra decenas de exportaciones nombradas y la lista se desactualiza sola.
//  Se espía la instancia de axios, que es lo que manda `CONVENCIONES.md`.
//
//  ⚠ Lo que este archivo NO puede afirmar: que la tabla scrollee dentro de su
//  tarjeta, que el panel mida 520px, ni que el email largo no se meta en la
//  columna del rol. jsdom devuelve CERO en `scrollWidth`, `clientWidth` y
//  `getBoundingClientRect`, así que un test que los mire pasa con y sin el
//  cambio. Eso va al navegador.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))

const EMPRESA = { id: 1, name: 'Comprafit' }

/** La sesión: `usuario_id` 10, que es el del ADMIN de abajo. */
const YO = { id: 10, nombre: 'Ana Gómez', email: 'ana@comprafit.com' }

/**
 * El equipo, con las cuatro filas que hacen falta para distinguir los defectos.
 *
 * ⚠ La fixture está armada para que cada caso pueda ponerse en rojo:
 *
 *  · `ADMIN` es **mi propia fila** Y el único admin activo: cae en las dos
 *    reglas a la vez, que es el caso que decide cuál de los dos motivos gana.
 *  · `ADMIN_DESACTIVADO` tiene `role: 'admin'` y `is_active: false`. Sin él, un
 *    chequeo por `role` a secas —que dejaría degradar al único admin que todavía
 *    entra— pasaría igual.
 *  · `GERENTE` existe porque `gerente` es justamente el rol que faltaba en la
 *    tabla de la pantalla: con un equipo de admin y vendedor, el defecto no se
 *    ve.
 */
const ADMIN = {
  id: 101,
  usuario_id: 10,
  role: 'admin',
  is_active: true,
  createdAt: '2025-11-02T12:00:00.000Z',
  usuario: { id: 10, nombre: 'Ana Gómez', email: 'ana@comprafit.com' },
}

const GERENTE = {
  id: 102,
  usuario_id: 20,
  role: 'gerente',
  is_active: true,
  createdAt: '2026-01-15T12:00:00.000Z',
  usuario: { id: 20, nombre: 'Marcos Ruiz', email: 'marcos@comprafit.com' },
}

const VENDEDOR_DESACTIVADO = {
  id: 103,
  usuario_id: 30,
  role: 'vendedor',
  is_active: false,
  createdAt: '2026-03-01T12:00:00.000Z',
  usuario: { id: 30, nombre: 'Lucía Paz', email: 'lucia@comprafit.com' },
}

const ADMIN_DESACTIVADO = {
  id: 104,
  usuario_id: 40,
  role: 'admin',
  is_active: false,
  createdAt: '2026-04-01T12:00:00.000Z',
  usuario: { id: 40, nombre: 'Diego Sosa', email: 'diego@comprafit.com' },
}

const EQUIPO = [ADMIN, GERENTE, VENDEDOR_DESACTIVADO, ADMIN_DESACTIVADO]

/** Una invitación que todavía sirve y otra cuyo enlace ya no. */
const PENDIENTE = {
  id: 5,
  email: 'nueva@comprafit.com',
  role: 'vendedor',
  token: 'tok-pendiente',
  status: 'pending',
  createdAt: '2026-08-01T12:00:00.000Z',
  expires_at: '2999-01-01T12:00:00.000Z',
}

const VENCIDA = {
  id: 6,
  email: 'vieja@comprafit.com',
  role: 'compras',
  token: 'tok-vencida',
  status: 'pending',
  createdAt: '2026-04-01T12:00:00.000Z',
  expires_at: '2026-04-08T12:00:00.000Z',
}

const TODOS = ['equipo.ver', 'equipo.invitar', 'equipo.editar', 'equipo.eliminar']

const ENLACE = 'https://app.adminapp.com/?invite=tok-nuevo'

/** Todo lo que salió por la red, en orden. */
let pedidos = []

/**
 * La instancia de `user-event` de la prueba en curso.
 *
 * Se arma con `setup()` y las interacciones NO van envueltas en `act`:
 * user-event ya envuelve cada una por su cuenta, y anidarlas imprime «The
 * current testing environment is not configured to support act(...)» en cada
 * clic. Es el patrón de `renderDePanelProducto.test.jsx`.
 */
let interaccion

const respuesta = (data) => Promise.resolve({ data })

/**
 * Monta `/equipo`.
 *
 * El render va envuelto en `act` porque la pantalla pide el equipo y las
 * invitaciones al montar: sin esperar esas dos resoluciones React llena la
 * salida de «An update … was not wrapped in act(...)», y una suite que imprime
 * ruido en verde es una que nadie lee cuando se pone en rojo.
 */
async function montar({
  equipo = EQUIPO,
  invitaciones = [PENDIENTE, VENCIDA],
  permisos = TODOS,
  usuario = YO,
  // Lo que devuelve `POST /empresas/1/invitar`. Es el corazón del archivo.
  invitacion = { ok: true, data: { id: 9 }, email_enviado: true, enlace: ENLACE },
  // Un objeto con `response` adentro se dobla como RECHAZO, que es la forma en
  // que axios entrega un 4xx.
  fallaLaCarga = null,
} = {}) {
  useStore.setState({ permisos, usuario, empresaActiva: EMPRESA })

  vi.spyOn(api, 'get').mockImplementation((url) => {
    pedidos.push({ metodo: 'get', url })

    if (fallaLaCarga) return Promise.reject(fallaLaCarga)

    if (url === `/empresas/${EMPRESA.id}/usuarios`) {
      return respuesta({ ok: true, data: equipo })
    }

    if (url === `/empresas/${EMPRESA.id}/invitaciones`) {
      return respuesta({ ok: true, data: invitaciones })
    }

    return respuesta({ ok: true, data: [] })
  })

  vi.spyOn(api, 'post').mockImplementation((url, cuerpo) => {
    pedidos.push({ metodo: 'post', url, cuerpo })

    if (url === `/empresas/${EMPRESA.id}/invitar`) {
      return invitacion instanceof Error || invitacion?.response
        ? Promise.reject(invitacion)
        : respuesta(invitacion)
    }

    return respuesta({ ok: true })
  })

  vi.spyOn(api, 'put').mockImplementation((url, cuerpo) => {
    pedidos.push({ metodo: 'put', url, cuerpo })
    return respuesta({ ok: true })
  })

  vi.spyOn(api, 'delete').mockImplementation((url) => {
    pedidos.push({ metodo: 'delete', url })
    return respuesta({ ok: true })
  })

  await act(async () => {
    render(<Team />)
  })
}

/** La fila de la tabla en grid que contiene ese texto. */
function filaDe(texto) {
  return screen.getByText(texto).closest('[style*="grid-template-columns"]')
}

// ⚠ El store se vacía en el `beforeEach` y NO en el `afterEach`, y no es
// indistinto: vitest corre los `afterEach` en orden inverso al de registro, así
// que el de este archivo correría ANTES del `cleanup()` de `preparacion.js` —
// o sea, con la pantalla todavía montada—. `useStore.setState` notifica a sus
// suscriptores, React actualiza `Team` y `Can` fuera de `act`, y cada prueba
// termina imprimiendo cuatro «An update … was not wrapped in act(...)». En el
// `beforeEach` no hay nada montado: `cleanup()` ya desmontó lo de la anterior.
beforeEach(() => {
  pedidos = []
  interaccion = userEvent.setup()
  useStore.setState({ permisos: [], usuario: null, empresaActiva: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════
//  El defecto 1: «Invitación enviada» sin que el mail haya salido
// ════════════════════════════════════════════

describe('invitar dice la verdad sobre el mail', () => {
  it('cuando el mail NO sale, muestra el enlace y dice que hay que pasarlo a mano', async () => {
    const exito = vi.spyOn(toast, 'success')
    const aviso = vi.spyOn(toast, 'warning')

    await montar({
      invitacion: {
        ok: true,
        data: { id: 9 },
        email_enviado: false,
        enlace: ENLACE,
        message:
          'La invitación se creó pero no se pudo enviar el email. Pasale el enlace de invitación a mano.',
      },
    })

    await interaccion.click(screen.getByRole('button', { name: /Invitar a alguien/ }))
    await interaccion.type(
      screen.getByLabelText('Email de la persona a invitar'),
      'nueva@comprafit.com'
    )

    await interaccion.click(screen.getByRole('button', { name: /Enviar invitación/ }))

    // Lo primero: NO se afirma que salió. Es la mutación que hay que poder ver
    // en rojo — `toast.success('Invitación enviada')` incondicional.
    expect(exito).not.toHaveBeenCalled()
    expect(aviso).toHaveBeenCalled()
    expect(screen.queryByText(/Invitación enviada/)).not.toBeInTheDocument()

    // Y lo segundo, que es lo que salva la invitación: el enlace, a la vista y
    // copiable. La invitación existe igual y el enlace sirve igual.
    const bloque = document.querySelector('[data-resultado-invitacion="sin_enviar"]')
    expect(bloque).not.toBeNull()
    expect(within(bloque).getByText(/el mail NO salió/)).toBeInTheDocument()
    expect(within(bloque).getByText(/Pasale el enlace de invitación a mano/)).toBeInTheDocument()
    expect(screen.getByLabelText('Enlace de invitación')).toHaveValue(ENLACE)
    expect(within(bloque).getByRole('button', { name: /Copiar/ })).toBeInTheDocument()
  })

  it('cuando SÍ sale, lo dice, y ese es el caso que impide que el anterior pase por vago', async () => {
    // Sin este caso, una pantalla que nunca dijera nada pasaría el de arriba.
    const exito = vi.spyOn(toast, 'success')

    await montar({
      invitacion: { ok: true, data: { id: 9 }, email_enviado: true, enlace: ENLACE },
    })

    await interaccion.click(screen.getByRole('button', { name: /Invitar a alguien/ }))
    await interaccion.type(
      screen.getByLabelText('Email de la persona a invitar'),
      'nueva@comprafit.com'
    )

    await interaccion.click(screen.getByRole('button', { name: /Enviar invitación/ }))

    expect(exito).toHaveBeenCalledWith('Invitación enviada a nueva@comprafit.com.')
    expect(document.querySelector('[data-resultado-invitacion="enviada"]')).not.toBeNull()
  })

  it('explica que la persona tiene que registrarse con ESE mismo email', async () => {
    // FR-125. AdminApp no crea nada en Auth0: si se registra con otra dirección,
    // el enlace no le sirve y hoy no hay un solo mensaje que lo diga.
    await montar()

    await interaccion.click(screen.getByRole('button', { name: /Invitar a alguien/ }))

    expect(screen.getByText(/con este mismo email/i)).toBeInTheDocument()
  })

  it('el error de la API se muestra con el mensaje del servidor, no con el de axios', async () => {
    const error = vi.spyOn(toast, 'error')

    await montar({
      invitacion: {
        response: { data: { error: 'Ya hay una invitación pendiente para ese email' } },
        message: 'Request failed with status code 400',
      },
    })

    await interaccion.click(screen.getByRole('button', { name: /Invitar a alguien/ }))
    await interaccion.type(
      screen.getByLabelText('Email de la persona a invitar'),
      'nueva@comprafit.com'
    )

    await interaccion.click(screen.getByRole('button', { name: /Enviar invitación/ }))

    expect(error).toHaveBeenCalledWith('Ya hay una invitación pendiente para ese email')
  })
})

// ════════════════════════════════════════════
//  El defecto 2: la columna Estado clavada en «Activo»
// ════════════════════════════════════════════

describe('la tabla de miembros dice el estado de cada uno', () => {
  it('la columna Estado dice «Desactivado» cuando is_active es false', async () => {
    await montar()

    expect(within(filaDe('Lucía Paz')).getByText('Desactivado')).toBeInTheDocument()
    expect(within(filaDe('Ana Gómez')).getByText('Activo')).toBeInTheDocument()
  })

  it('el badge del desactivado NO usa el tono del activo', async () => {
    // Dos etiquetas distintas con el mismo color se leen igual de lejos, que es
    // como la fila desactivada pasaba por activa.
    await montar()

    const desactivado = within(filaDe('Lucía Paz')).getByText('Desactivado')
    const activo = within(filaDe('Ana Gómez')).getByText('Activo')

    expect(desactivado.className).not.toBe(activo.className)
    expect(desactivado).toHaveAttribute('data-estado-del-miembro', 'desactivado')
    expect(activo).toHaveAttribute('data-estado-del-miembro', 'activo')
  })

  it('el encabezado y las filas comparten el MISMO grid-template-columns', async () => {
    // Cuando difieren, las etiquetas dejan de estar sobre sus datos y se lee un
    // rol bajo «Estado».
    await montar()

    const encabezado = screen.getByText('Nombre').closest('[style*="grid-template-columns"]')

    for (const nombre of ['Ana Gómez', 'Marcos Ruiz', 'Lucía Paz', 'Diego Sosa']) {
      expect(filaDe(nombre).style.gridTemplateColumns).toBe(
        encabezado.style.gridTemplateColumns
      )
    }
  })
})

// ════════════════════════════════════════════
//  El defecto 3: `gerente` no estaba en la tabla de roles
// ════════════════════════════════════════════

describe('el catálogo de roles de la pantalla', () => {
  it('incluye gerente, y su fila lo dice con la etiqueta y no con el código', async () => {
    await montar()

    expect(within(filaDe('Marcos Ruiz')).getByText('Gerente')).toBeInTheDocument()
    expect(within(filaDe('Marcos Ruiz')).queryByText('gerente')).not.toBeInTheDocument()
  })

  it('el selector del panel ofrece los CINCO roles, gerente incluido', async () => {
    await montar()

    await interaccion.click(within(filaDe('Marcos Ruiz')).getByTitle(/Ver y editar/))

    const opciones = within(screen.getByLabelText('Rol'))
      .getAllByRole('option')
      .map((o) => o.textContent)

    expect(opciones).toEqual(['Administrador', 'Gerente', 'Vendedor', 'Producción', 'Compras'])
  })

  it('los roles que se ofrecen AL INVITAR son exactamente los del ENUM de invitaciones', async () => {
    // ⚠ Esta guardia no es de dibujo: `invitaciones.role` es un
    // `ENUM('admin','vendedor','produccion','compras')` y NO acepta `gerente`.
    // Ofrecerlo en el formulario no daría un 400 sino un 500, porque la
    // validación revienta adentro de Sequelize. El día que la migración del enum
    // entre, este caso se pone en rojo pidiendo que se agregue la opción — que
    // es justamente el aviso que faltó cuando `gerente` se sumó del lado del
    // servidor y nadie tocó la pantalla.
    const modelo = fs.readFileSync(
      path.join(AQUI, '..', '..', '..', 'api', 'src', 'models', 'Invitacion.js'),
      'utf8'
    )

    const bloque = modelo.slice(modelo.indexOf('role:'))
    const declarados = [...bloque.slice(0, bloque.indexOf(')')).matchAll(/'([^']+)'/g)].map(
      (m) => m[1]
    )

    expect(declarados.length).toBeGreaterThan(0)

    await montar()
    await interaccion.click(screen.getByRole('button', { name: /Invitar a alguien/ }))

    const ofrecidos = within(screen.getByLabelText('Rol de la invitación'))
      .getAllByRole('option')
      .map((o) => o.value)

    expect(ofrecidos).toEqual(declarados)
  })
})

// ════════════════════════════════════════════
//  Las invitaciones: pendiente, vencida, reenviar
// ════════════════════════════════════════════

describe('las invitaciones que están dando vueltas', () => {
  it('una vencida se distingue de una pendiente', async () => {
    // Nada pasa `status` a `expired`: una invitación de hace tres meses figuraba
    // «Pendiente» y quien la miraba esperaba a alguien que ya no podía entrar.
    await montar()

    expect(within(filaDe('nueva@comprafit.com')).getByText('Pendiente')).toBeInTheDocument()
    expect(within(filaDe('vieja@comprafit.com')).getByText('Vencida')).toBeInTheDocument()
  })

  it('reenviar llama al endpoint con el TOKEN de esa invitación y no con el de otra', async () => {
    // El endpoint existía desde siempre y no lo llamaba nadie: quien no recibía
    // el mail no tenía forma de pedir otro salvo revocar e invitar de nuevo.
    await montar()

    await interaccion.click(
        within(filaDe('vieja@comprafit.com')).getByTitle('Volver a mandarle el mail')
      )

    expect(pedidos).toContainEqual({
      metodo: 'post',
      url: '/empresas/invitaciones/tok-vencida/re-enviar',
      cuerpo: undefined,
    })
  })

  it('sin `equipo.invitar` el botón de reenviar queda deshabilitado y dice qué falta', async () => {
    await montar({ permisos: ['equipo.ver'] })

    const boton = within(filaDe('nueva@comprafit.com')).getByTitle(
      'Necesitás el permiso «equipo.invitar»'
    )

    expect(boton).toBeDisabled()
  })
})

// ════════════════════════════════════════════
//  El fallo de carga: en la pantalla, no en la consola
// ════════════════════════════════════════════

describe('cuando el pedido falla, la pantalla no miente sobre la empresa', () => {
  it('un 403 muestra el mensaje del servidor y NO «Sin miembros aún»', async () => {
    // Era un `console.error` mudo: un 403 por falta de `equipo.ver` dibujaba un
    // equipo vacío, que es una afirmación falsa sobre la empresa.
    await montar({
      fallaLaCarga: {
        response: { data: { error: 'No tenés permiso para ver el equipo de esta empresa' } },
        message: 'Request failed with status code 403',
      },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No tenés permiso para ver el equipo de esta empresa'
    )
    expect(screen.queryByText(/Request failed with status code/)).not.toBeInTheDocument()

    // Y el estado vacío que se dibuja es el que dice que falló, no el que dice
    // que la empresa tiene una sola persona.
    expect(document.querySelector('[data-estado-vacio="no_se_pudo_leer"]')).not.toBeNull()
    expect(document.querySelector('[data-estado-vacio="equipo_de_una_persona"]')).toBeNull()
  })
})

// ════════════════════════════════════════════
//  El defecto 4: el selector de rol habilitado en todas las filas
//
//  El panel se monta directo —y no abriéndolo desde la pantalla— para los casos
//  que combinan permisos y fixtures: es el mismo componente, con los mismos
//  props que le pasa `Team.jsx`, y evita cuatro clics por caso.
// ════════════════════════════════════════════

async function montarPanel({
  miembro = GERENTE,
  miembros = EQUIPO,
  yo = { usuario_id: YO.id },
  puedeEditar = true,
  onCambio = vi.fn(),
} = {}) {
  vi.spyOn(api, 'put').mockImplementation((url, cuerpo) => {
    pedidos.push({ metodo: 'put', url, cuerpo })
    return respuesta({ ok: true })
  })

  await act(async () => {
    render(
      <PanelDeMiembro
        miembro={miembro}
        miembros={miembros}
        yo={yo}
        abierto
        onOpenChange={() => {}}
        puedeEditar={puedeEditar}
        onCambio={onCambio}
      />
    )
  })
}

describe('el panel del miembro deshabilita con su explicación', () => {
  it('la fila propia tiene el selector deshabilitado y dice por qué', async () => {
    // `ADMIN` es mi propia fila. El selector se dibujaba habilitado en TODAS las
    // filas, incluida ésta, sin `disabled` y sin confirmación.
    await montarPanel({ miembro: ADMIN })

    expect(screen.getByLabelText('Rol')).toBeDisabled()

    const motivo = document.querySelector('[data-motivo-bloqueo]')
    expect(motivo).not.toBeNull()
    expect(motivo).toHaveTextContent(/No podés cambiar tu propio rol/)
  })

  it('la de otra persona, con otro admin en la empresa, queda habilitada', async () => {
    // Sin este caso, un panel que deshabilitara siempre pasaría los otros tres.
    await montarPanel({
      miembro: GERENTE,
      miembros: [ADMIN, { ...GERENTE }, { id: 999, usuario_id: 99, role: 'admin', is_active: true }],
    })

    expect(screen.getByLabelText('Rol')).toBeEnabled()
    expect(document.querySelector('[data-motivo-bloqueo]')).toBeNull()
  })

  it('el último admin activo no se puede degradar, y el motivo nombra qué se pierde', async () => {
    // Mirado por OTRA persona, para que el motivo que gane sea el del último
    // admin y no el de «soy yo».
    await montarPanel({ miembro: ADMIN, yo: { usuario_id: GERENTE.usuario_id } })

    expect(screen.getByLabelText('Rol')).toBeDisabled()
    expect(document.querySelector('[data-motivo-bloqueo]')).toHaveTextContent(
      /único administrador activo/
    )
    expect(screen.getByRole('button', { name: /Sacar del equipo/ })).toBeDisabled()
  })

  it('un admin DESACTIVADO no cuenta como el segundo administrador', async () => {
    // La empresa tiene DOS filas con rol `admin` —`ADMIN` y `ADMIN_DESACTIVADO`—
    // así que un chequeo por `role` a secas dejaría degradar al único que
    // todavía puede entrar. Es el caso que la fixture existe para poder mostrar.
    await montarPanel({ miembro: ADMIN, yo: { usuario_id: GERENTE.usuario_id } })

    expect(screen.getByLabelText('Rol')).toBeDisabled()
  })

  it('sin `equipo.editar` está deshabilitado y el motivo nombra el permiso que falta', async () => {
    // Dos motivos distintos para lo mismo: no tener el permiso se arregla
    // pidiéndolo, y ser el último admin se arregla nombrando a otro. Un texto
    // genérico mandaría a la persona equivocada.
    await montarPanel({ miembro: GERENTE, puedeEditar: false })

    expect(screen.getByLabelText('Rol')).toBeDisabled()
    expect(document.querySelector('[data-motivo-bloqueo]')).toHaveTextContent(/equipo.editar/)
  })
})

describe('sacar a alguien del equipo, y devolverlo', () => {
  it('desactivar pide confirmación y manda is_active:false para ESA membresía', async () => {
    // FR-113 / E12: el endpoint existía y la pantalla no lo exponía. La única
    // forma de sacar a alguien era escribir en la base.
    const onCambio = vi.fn()

    await montarPanel({
      miembro: GERENTE,
      miembros: [ADMIN, GERENTE, { id: 999, usuario_id: 99, role: 'admin', is_active: true }],
      onCambio,
    })

    await interaccion.click(screen.getByRole('button', { name: /Sacar del equipo/ }))

    // La confirmación dice qué pasa con las invitaciones pendientes y que el
    // historial no se toca: sin eso, «sacar» se lee como «borrar».
    expect(screen.getByText(/invitaciones\s+pendientes quedan revocadas/)).toBeInTheDocument()

    await interaccion.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(pedidos).toContainEqual({
      metodo: 'put',
      url: `/empresas/usuarios/${GERENTE.id}`,
      cuerpo: { is_active: false },
    })
    expect(onCambio).toHaveBeenCalled()
  })

  it('cancelar la confirmación NO manda nada', async () => {
    await montarPanel({
      miembro: GERENTE,
      miembros: [ADMIN, GERENTE, { id: 999, usuario_id: 99, role: 'admin', is_active: true }],
    })

    await interaccion.click(screen.getByRole('button', { name: /Sacar del equipo/ }))

    await interaccion.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(pedidos.filter((p) => p.metodo === 'put')).toHaveLength(0)
  })

  it('a alguien desactivado se le ofrece devolverle el acceso, no sacarlo de nuevo', async () => {
    await montarPanel({
      miembro: VENDEDOR_DESACTIVADO,
      miembros: [ADMIN, VENDEDOR_DESACTIVADO, { id: 999, usuario_id: 99, role: 'admin', is_active: true }],
    })

    expect(screen.queryByRole('button', { name: /Sacar del equipo/ })).not.toBeInTheDocument()

    await interaccion.click(screen.getByRole('button', { name: /Devolverle el acceso/ }))

    expect(pedidos).toContainEqual({
      metodo: 'put',
      url: `/empresas/usuarios/${VENDEDOR_DESACTIVADO.id}`,
      cuerpo: { is_active: true },
    })
  })

  it('el rechazo del servidor se muestra con SU mensaje, no con el de axios', async () => {
    // El 400 del último admin trae «Es el único administrador activo…», que es
    // el texto que hay que mostrar. `err.message` diría «Request failed with
    // status code 400».
    await montarPanel({
      miembro: GERENTE,
      miembros: [ADMIN, GERENTE, { id: 999, usuario_id: 99, role: 'admin', is_active: true }],
    })

    api.put.mockImplementation(() =>
      Promise.reject({
        response: { data: { error: 'ULTIMO_ADMIN', message: 'Es el único administrador activo de la empresa.' } },
        message: 'Request failed with status code 400',
      })
    )

    await interaccion.selectOptions(screen.getByLabelText('Rol'), 'vendedor')

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Es el único administrador activo de la empresa.'
    )
    expect(screen.queryByText(/Request failed with status code/)).not.toBeInTheDocument()
    // Y no el código crudo: `mensajeDeError` filtra los códigos de máquina.
    expect(screen.getByRole('alert')).not.toHaveTextContent('ULTIMO_ADMIN')
  })
})
