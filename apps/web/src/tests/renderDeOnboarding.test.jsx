import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Onboarding from '@/pages/Onboarding'

// ════════════════════════════════════════════
//  FAVALIO · el onboarding, y la empresa que se creó cuatro veces
//
//  Lo que pasó en producción: el POST creó la empresa, `loadEmpresaContext()`
//  salió sin recargar nada —el usuario ya estaba cargado—, `App.jsx` siguió
//  rindiendo esta pantalla para toda ruta, el botón se volvió a habilitar, y
//  cada clic fue otra empresa con su punto de venta y su suscripción.
//
//  La garantía de que dos llamadas no son dos empresas está en la API y se
//  prueba allá (`onboardingIdempotente.integracion.test.js`). Acá se prueba la
//  otra mitad: que **no haya** una segunda llamada, y que quien mire la
//  pantalla entienda en qué estado quedó.
//
//  ── Qué NO se prueba acá ──
//
//  El dibujo: qué ícono lleva cada label, de qué color es el borde. Eso cambia
//  cuando alguien mueve un `<div>` y no dice nada sobre el bug.
// ════════════════════════════════════════════

const COMPLETO = {
  name: 'Panadería del Centro',
  cuit: '30-11111111-8',
  phone: '11 4567 8900',
  address: 'Av. Corrientes 1234',
  city: 'Buenos Aires',
  state: 'CABA',
}

/** Llena el formulario. Los labels son lo que ve la persona, así se buscan. */
function completar(valores = COMPLETO) {
  const porEtiqueta = {
    name: /nombre de la empresa/i,
    cuit: /cuit/i,
    phone: /teléfono/i,
    address: /dirección/i,
    city: /ciudad/i,
    state: /provincia/i,
  }

  for (const [campo, etiqueta] of Object.entries(porEtiqueta)) {
    if (valores[campo] === undefined) continue
    fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valores[campo] } })
  }
}

const boton = () => screen.getByRole('button', { name: /comenzar a usar favalio|creando empresa|entrando/i })

const montar = () => render(<MemoryRouter><Onboarding /></MemoryRouter>)

beforeEach(() => {
  useStore.setState({
    usuario: { id: 1, email: 'nuevo@favalio.com' },
    empresaActiva: null,
    // El `recargarContexto` de verdad pega a la API. Acá se lo reemplaza por
    // defecto —«respondió y no hay empresa»— y el test que necesita otra cosa
    // lo pisa. Sin esto, la función real corre fuera de `act()` y ensucia la
    // salida con un warning de React que no dice nada del onboarding.
    recargarContexto: vi.fn().mockResolvedValue(false),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════
//  El bug: una sola llamada, pase lo que pase
// ════════════════════════════════════════════

describe('el formulario no manda dos veces', () => {
  it('cuatro clics seguidos son UNA sola llamada', async () => {
    // El caso exacto de producción. La promesa no se resuelve mientras se
    // clickea: es lo que pasa con el cold start de la API.
    let resolver
    const enviar = vi.spyOn(api, 'post').mockReturnValue(
      new Promise((r) => { resolver = r })
    )

    montar()
    completar()

    await act(async () => { fireEvent.click(boton()) })
    fireEvent.click(boton())
    fireEvent.click(boton())
    fireEvent.click(boton())

    expect(enviar).toHaveBeenCalledTimes(1)

    // Se deja terminar el envío antes de salir del test: una promesa que se
    // resuelve después del desmontaje actualiza estado sobre un componente que
    // ya no está, y React lo avisa en el test siguiente.
    await act(async () => {
      resolver({ data: { ok: true, data: { empresa: { id: 9 } } } })
    })

    await waitFor(() => expect(boton()).toHaveTextContent(/entrando/i))
    expect(enviar).toHaveBeenCalledTimes(1)
  })

  it('después de crearla, el botón NO se vuelve a habilitar', async () => {
    // El `finally { setLoading(false) }` que había lo rehabilitaba también en
    // el camino feliz. Con el contexto sin empresa —que es justo lo que pasaba—
    // la pantalla se quedaba y el botón invitaba a crear otra.
    const enviar = vi.spyOn(api, 'post').mockResolvedValue({
      data: { ok: true, data: { empresa: { id: 9 } } },
    })
    useStore.setState({ recargarContexto: vi.fn().mockResolvedValue(false) })

    montar()
    completar()
    await act(async () => { fireEvent.click(boton()) })

    expect(enviar).toHaveBeenCalledTimes(1)
    expect(boton()).toBeDisabled()

    // Y aunque alguien lo fuerce, no sale una segunda llamada.
    fireEvent.click(boton())
    expect(enviar).toHaveBeenCalledTimes(1)
  })

  it('si la creación falla de verdad, el botón vuelve: es un reintento legítimo', async () => {
    const enviar = vi.spyOn(api, 'post').mockRejectedValue({
      response: { data: { error: 'Completá el teléfono de contacto' } },
    })

    montar()
    completar()
    await act(async () => { fireEvent.click(boton()) })

    expect(await screen.findByRole('alert')).toHaveTextContent(/completá el teléfono/i)
    expect(boton()).not.toBeDisabled()

    enviar.mockResolvedValue({ data: { ok: true, data: { empresa: { id: 9 } } } })

    await act(async () => { fireEvent.click(boton()) })
    expect(enviar).toHaveBeenCalledTimes(2)
  })
})

// ════════════════════════════════════════════
//  Que se entienda qué pasó
// ════════════════════════════════════════════

describe('el formulario dice qué pasó', () => {
  it('con campos vacíos no llama a la API y señala cada campo', async () => {
    const enviar = vi.spyOn(api, 'post')

    montar()
    await act(async () => { fireEvent.click(boton()) })

    expect(enviar).not.toHaveBeenCalled()
    expect(screen.getByText(/poné el nombre de tu empresa/i)).toBeInTheDocument()
    expect(screen.getByText(/poné un teléfono de contacto/i)).toBeInTheDocument()
  })

  it('el foco va al primer campo mal, que puede estar fuera de pantalla', async () => {
    montar()
    // Todo menos la ciudad: el primero que falla es ese, no el nombre.
    completar({ ...COMPLETO, city: '' })
    await act(async () => { fireEvent.click(boton()) })

    expect(document.activeElement).toBe(screen.getByLabelText(/ciudad/i))
  })

  it('el error del campo se borra al corregirlo, no al reenviar', async () => {
    montar()
    await act(async () => { fireEvent.click(boton()) })
    expect(screen.getByText(/poné el nombre de tu empresa/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/nombre de la empresa/i), {
      target: { value: 'Panadería' },
    })

    expect(screen.queryByText(/poné el nombre de tu empresa/i)).not.toBeInTheDocument()
  })

  it('un 200 con ok:false no se traga en silencio', async () => {
    // Se caía en un `if` sin `else`: la pantalla no avanzaba y no aparecía
    // ningún error. Silencio, que es la peor respuesta posible.
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { ok: false, error: 'El CUIT ya está registrado' },
    })

    montar()
    completar()
    await act(async () => { fireEvent.click(boton()) })

    expect(await screen.findByRole('alert')).toHaveTextContent(/cuit ya está registrado/i)
    expect(boton()).not.toBeDisabled()
  })

  it('si se corta la red avisa que la empresa pudo quedar creada', async () => {
    // Reintentar a ciegas es lo que multiplicó la empresa. El mensaje tiene que
    // mandar a recargar, no a volver a jugar.
    vi.spyOn(api, 'post').mockRejectedValue({ code: 'ERR_NETWORK' })

    montar()
    completar()
    await act(async () => { fireEvent.click(boton()) })

    expect(await screen.findByRole('alert')).toHaveTextContent(/pudo|puede que/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/recargá/i)
  })

  it('creada pero sin poder entrar, ofrece reintentar SOLO la lectura', async () => {
    const enviar = vi.spyOn(api, 'post').mockResolvedValue({
      data: { ok: true, data: { empresa: { id: 9 } } },
    })
    const recargar = useStore.getState().recargarContexto

    montar()
    completar()
    await act(async () => { fireEvent.click(boton()) })

    const reintentar = screen.getByRole('button', { name: /reintentar/i })
    await act(async () => { fireEvent.click(reintentar) })

    // Se pidió el contexto de nuevo y NO se volvió a crear nada.
    expect(recargar).toHaveBeenCalledTimes(2)
    expect(enviar).toHaveBeenCalledTimes(1)
  })
})

// ════════════════════════════════════════════
//  El logo
// ════════════════════════════════════════════

describe('el logo se valida antes de subirlo', () => {
  const archivo = (nombre, tipo, bytes) => {
    const f = new File(['x'], nombre, { type: tipo })
    Object.defineProperty(f, 'size', { value: bytes })
    return f
  }

  it('rechaza uno de más de 300 KB sin mandarlo', async () => {
    // Subir 3 MB desde un teléfono para que la API conteste «máximo 300KB» es
    // un minuto perdido y datos gastados, con el error llegando tarde.
    const { container } = montar()
    const input = container.querySelector('input[type="file"]')

    await act(async () => {
      fireEvent.change(input, { target: { files: [archivo('logo.png', 'image/png', 400 * 1024)] } })
    })

    expect(screen.getByText(/no puede pasar de 300 kb/i)).toBeInTheDocument()
  })

  it('rechaza un tipo que la API no acepta', async () => {
    const { container } = montar()
    const input = container.querySelector('input[type="file"]')

    await act(async () => {
      fireEvent.change(input, { target: { files: [archivo('logo.pdf', 'application/pdf', 1024)] } })
    })

    expect(screen.getByText(/png, jpg, gif, webp o svg/i)).toBeInTheDocument()
  })
})
