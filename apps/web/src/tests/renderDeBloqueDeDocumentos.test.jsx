import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import useStore from '@/store/useStore'
import api from '@/services/api'
import BloqueDeDocumentos from '@/components/BloqueDeDocumentos'

// ════════════════════════════════════════════
//  ADMINAPP · El bloque de documentos del proveedor, renderizado
//
//  Lo que se afirma acá es el DIBUJO y lo que dispara cada botón. Las reglas
//  —qué enlace es aceptable y de qué nube es— ya están cubiertas por
//  `utils/documentosDeProveedor.test.js`, que es diez veces más rápido y no se
//  rompe cuando alguien mueve un `<div>`.
//
//  ── Por qué este archivo y no `renderDeProveedores.test.jsx` ──
//
//  El componente es de las DOS pantallas y se escribió antes de cablearlo en
//  ninguna (T1243). Un test suyo adentro del archivo de una pantalla obliga a
//  montar la pantalla entera para verificar un bloque que no depende de ella, y
//  el día que el bloque se use desde la otra nadie sabe dónde está su test.
//
//  ── Se espía la instancia de axios, no el módulo ──
//
//  `vi.mock('@/services/api')` obliga a declarar las más de cien exportaciones
//  nombradas del módulo y la lista se desactualiza sola. `vi.spyOn(api, 'post')`
//  intercepta el único método que importa —`createSupplierDocument` lo resuelve
//  en el momento de llamarlo— y deja el resto intacto.
//
//  ⚠ Copiar al portapapeles NO se afirma acá: `navigator.clipboard` no existe en
//  jsdom, y un test sobre un doble del portapapeles solo dice que se llamó al
//  doble. Va al paso manual P10.
// ════════════════════════════════════════════

const TODOS = ['proveedores.ver', 'proveedores.editar', 'proveedores.eliminar']

const FACTURA = {
  id: 11,
  name: 'Factura 0001-00043212',
  type: 'factura',
  url: 'https://drive.google.com/file/d/1a2b3c/view',
  date: '2026-08-01',
}

const REMITO = {
  id: 12,
  name: 'Remito 0001-00099',
  type: 'remito',
  url: 'https://www.dropbox.com/s/xyz/remito.pdf',
  date: '2026-07-30',
}

function montar({ documentos = [FACTURA, REMITO], permisos = TODOS, ...resto } = {}) {
  useStore.setState({ permisos })

  return render(
    <BloqueDeDocumentos proveedorId={7} documentos={documentos} onCambio={() => {}} {...resto} />
  )
}

/** Los campos del alta, por su placeholder: «Tipo» y «Fecha» también son
 *  etiquetas de columna de la tabla, así que buscarlos por texto encuentra dos. */
const campoNombre = () => screen.getByPlaceholderText('Factura 0001-00043212')
const campoEnlace = () => screen.getByPlaceholderText('https://drive.google.com/…')
const botonAgregar = () => screen.getByRole('button', { name: 'Agregar' })

/** Una fila de la tabla, por su `grid-template-columns`: la tabla es un grid y
 *  no un `<table>`, así que no hay `role="row"`. */
const filaDe = (texto) => screen.getByText(texto).closest('[style*="grid-template-columns"]')

beforeEach(() => {
  vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true, data: { id: 99 } } })
  vi.spyOn(api, 'delete').mockResolvedValue({ data: { ok: true } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════
//  FR-082 · El enlace se rechaza ANTES de la llamada
//
//  El servidor guarda cualquier texto en `url` —es un TEXT sin validación—, así
//  que pegar «Factura 0001-00043212.pdf» en el campo del enlace produce un
//  documento que no lleva a ninguna parte Y apaga el aviso de «sin factura» del
//  proveedor. Un aviso que se apaga sin que el respaldo exista es peor que no
//  tener el aviso.
// ════════════════════════════════════════════

/**
 * `userEvent` con el retardo apagado.
 *
 * Por defecto `setup()` espera entre tecla y tecla para parecerse a una persona
 * escribiendo. Estos casos tipean enlaces de sesenta caracteres, asi que ese
 * retardo era casi todo el tiempo del test: solo tardaba 1,98 s, y dentro de la
 * suite completa —bajo carga— se pasaba de los 5 s de vitest y se ponia en rojo.
 *
 * Un test que falla segun que mas se este corriendo es un test que alguien
 * termina marcando como inestable y borrando. Lo que estos casos afirman no
 * depende del ritmo del tecleo: es que un enlace sin http NO salga por la red.
 */
const tecleoInstantaneo = () => userEvent.setup({ delay: null })

describe('Un enlace que no es un enlace no llega al servidor', () => {
  it('un enlace sin http NO dispara ninguna llamada', async () => {
    const usuario = tecleoInstantaneo()
    montar({ documentos: [] })

    await usuario.type(campoNombre(), 'Factura de marzo')
    // El error real: pegar el NOMBRE del archivo en el campo del enlace.
    await usuario.type(campoEnlace(), 'Factura 0001-00043212.pdf')
    await usuario.click(botonAgregar())

    expect(api.post).not.toHaveBeenCalled()

    // El control, en la misma prueba: sin él, borrar el cuerpo entero de
    // `agregar` —o dejar el botón sin `onClick`— dejaría el `not.toHaveBeenCalled`
    // en verde, y el test estaría afirmando que un botón roto no llama a nadie.
    await usuario.clear(campoEnlace())
    await usuario.type(campoEnlace(), 'https://drive.google.com/file/d/9z/view')
    await usuario.click(botonAgregar())

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(api.post).toHaveBeenCalledWith(
      '/suppliers/7/documents',
      expect.objectContaining({ url: 'https://drive.google.com/file/d/9z/view' })
    )
  })

  it('un enlace con un espacio EN EL MEDIO tampoco: es un enlace que el chat cortó', async () => {
    const usuario = tecleoInstantaneo()
    montar({ documentos: [] })

    await usuario.type(campoNombre(), 'Factura de marzo')
    await usuario.type(campoEnlace(), 'https://drive.google.com/file/d/9z factura')
    await usuario.click(botonAgregar())

    expect(api.post).not.toHaveBeenCalled()
  })

  it('el enlace se guarda sin los espacios que arrastra pegar desde WhatsApp', async () => {
    const usuario = tecleoInstantaneo()
    montar({ documentos: [] })

    await usuario.type(campoNombre(), '  Factura de marzo  ')
    // `esEnlaceAceptable` tolera los espacios de los bordes A PROPÓSITO —pegar
    // desde un chat arrastra uno—, así que si el bloque mandara el texto crudo
    // el espacio pasaría la validación y quedaría guardado adentro del enlace.
    await usuario.type(campoEnlace(), '  https://drive.google.com/file/d/9z/view  ')
    await usuario.click(botonAgregar())

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))

    const [, cuerpo] = api.post.mock.calls[0]
    expect(cuerpo.url).toBe('https://drive.google.com/file/d/9z/view')
    expect(cuerpo.name).toBe('Factura de marzo')
  })
})

// ════════════════════════════════════════════
//  FR-084 · Los enlaces apuntan afuera y los escribió una persona
// ════════════════════════════════════════════

describe('Los documentos abren en una pestaña nueva sin quedar atados a esta', () => {
  it('los enlaces llevan rel="noopener noreferrer" y target="_blank"', () => {
    montar()

    const enlaces = screen.getAllByRole('link')
    expect(enlaces).toHaveLength(2)

    for (const enlace of enlaces) {
      // Sin `rel`, la página de destino recibe un `window.opener` con el que
      // puede redirigir ESTA pestaña a donde quiera. El enlace lo pegó un
      // usuario y apunta fuera del sistema.
      expect(enlace).toHaveAttribute('target', '_blank')
      expect(enlace).toHaveAttribute('rel', 'noopener noreferrer')
    }

    expect(filaDe('Factura 0001-00043212')).toBeTruthy()
    expect(within(filaDe('Factura 0001-00043212')).getByRole('link')).toHaveAttribute(
      'href',
      FACTURA.url
    )
  })

  it('la nube sale del enlace y cada fila muestra la suya', () => {
    montar()

    expect(within(filaDe('Factura 0001-00043212')).getByText('Google Drive')).toBeInTheDocument()
    expect(within(filaDe('Remito 0001-00099')).getByText('Dropbox')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  Un tipo que el modelo permite y la lista no conoce
//
//  `TIPOS` no exporta ninguna función de traducción, así que un
//  `TIPOS.find(...).etiqueta` directo tira sobre un tipo desconocido o nulo. La
//  columna es un STRING(30) sin validación en el servidor y admite `null`: los
//  dos casos son alcanzables sin que nadie haya hecho nada raro, y cualquiera de
//  los dos se lleva puesta la fila —y con ella el bloque entero—.
// ════════════════════════════════════════════

describe('Un tipo desconocido o nulo no rompe la fila', () => {
  const RAROS = [
    { id: 21, name: 'Contrato de exclusividad', type: 'contrato', url: 'https://box.com/c/1', date: '2026-06-02' },
    { id: 22, name: 'Papel sin tipo', type: null, url: 'https://1drv.ms/x/abc', date: '2026-05-10' },
  ]

  it('las dos filas se dibujan, y el tipo raro se muestra tal cual', () => {
    montar({ documentos: RAROS })

    // Tal cual y no traducido a «Otro»: si alguna vez se guarda un quinto tipo,
    // verlo es lo único que permite corregirlo.
    expect(within(filaDe('Contrato de exclusividad')).getByText('contrato')).toBeInTheDocument()

    const sinTipo = filaDe('Papel sin tipo')
    expect(within(sinTipo).getByText('—')).toBeInTheDocument()
    // El resto de la fila sigue dibujándose: lo que se está protegiendo es que
    // un `type` nulo no se lleve puesta la fila entera.
    expect(within(sinTipo).getByText('10/05/2026')).toBeInTheDocument()
  })

  it('un enlace de una nube que no está en la lista se etiqueta «Otro» y abre igual', () => {
    montar({ documentos: RAROS })

    const fila = filaDe('Contrato de exclusividad')

    expect(within(fila).getByText('Otro')).toBeInTheDocument()
    expect(within(fila).getByRole('link')).toHaveAttribute('href', 'https://box.com/c/1')
  })
})

// ════════════════════════════════════════════
//  US7 escenario 8 · El estado vacío
// ════════════════════════════════════════════

describe('Un proveedor sin documentos', () => {
  it('un proveedor sin documentos ve cómo cargar el primero', () => {
    montar({ documentos: [] })

    expect(screen.getByText('Este proveedor no tiene ningún documento.')).toBeInTheDocument()
    // La segunda línea es la que dice QUÉ hacer. Una tabla vacía a secas deja al
    // usuario buscando un botón de «Subir archivo» que no existe ni va a existir.
    expect(screen.getByText(/Pegá arriba el enlace de Drive/)).toBeInTheDocument()

    // Y el formulario está a la vista: el estado vacío no puede tapar la única
    // forma de salir de él.
    expect(campoEnlace()).toBeEnabled()
  })
})

// ════════════════════════════════════════════
//  FR-087 · Los permisos, deshabilitados CON su explicación
// ════════════════════════════════════════════

describe('Sin permiso el bloque se lee, no se edita', () => {
  it('sin proveedores.editar el bloque se lee y no se edita, con la explicación a la vista', () => {
    montar({ permisos: ['proveedores.ver', 'proveedores.eliminar'] })

    expect(campoNombre()).toBeDisabled()
    expect(campoEnlace()).toBeDisabled()

    const agregar = botonAgregar()
    expect(agregar).toBeDisabled()
    expect(agregar).toHaveAttribute('title', 'Necesitás el permiso «proveedores.editar»')

    // Deshabilitado con la explicación y no ausente: un formulario que
    // desaparece deja al usuario sin entender por qué no puede cargar la
    // factura.
    expect(
      screen.getByText(/Necesitás el permiso «proveedores.editar» para cargar documentos/)
    ).toBeInTheDocument()

    // Y lo que sí puede hacer sigue estando: abrir los documentos cargados.
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('sin proveedores.eliminar el botón de borrar está deshabilitado y dice por qué', () => {
    montar({ permisos: ['proveedores.ver', 'proveedores.editar'] })

    const borrar = within(filaDe('Factura 0001-00043212')).getByTitle(
      'Necesitás el permiso «proveedores.eliminar»'
    )

    expect(borrar).toBeDisabled()
    // Los dos permisos son distintos: bloquear el alta junto con el borrado es
    // como se pierde media pantalla por un permiso que no correspondía.
    expect(campoNombre()).toBeEnabled()
  })

  it('con los dos permisos no aparece ninguna explicación de más', () => {
    montar()

    expect(
      screen.queryByText(/Necesitás el permiso «proveedores.editar» para cargar documentos/)
    ).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  «Documento eliminado.» sin haber eliminado nada
//
//  Borrando la línea `await deleteDocument(documento.id)` del cuerpo de
//  `eliminar`, el `toast.success('Documento eliminado.')` sale igual y `onCambio`
//  vuelve a pedir la ficha: el usuario ve el aviso de que se borró y la fila
//  intacta al lado, y lo lee como que la pantalla va lenta. Vuelve mañana y el
//  documento sigue ahí. **Con esa línea borrada, este archivo y los demás que
//  tocan el bloque quedaban enteros en verde.**
//
//  Es textualmente el bug de `sendEmail` que CONVENCIONES.md pone como uno de los
//  tres motivos por los que existe este método: `ok: true` sin haber hecho nada,
//  y quien invitaba veía «enviada». Por eso lo que se afirma no es que el toast
//  aparezca, sino que **la llamada se haya hecho** y que el toast dependa de su
//  resultado —las dos mitades, porque son defectos distintos: no llamar, y
//  llamar sin mirar qué contestó—.
//
//  ⚠ Los clics del diálogo van por `fireEvent` dentro de `act` y no por
//  `user-event`. El diálogo de `@base-ui/react` es modal y apaga los
//  `pointer-events` del resto del documento, que es justo lo que `user-event`
//  comprueba antes de clickear. Es el mismo camino que usa
//  `renderDeProveedores.test.jsx` para sus cinco diálogos.
// ════════════════════════════════════════════

describe('El aviso de «eliminado» no sale si no se eliminó nada', () => {
  const botonDeBorrar = (nombre) =>
    within(filaDe(nombre)).getByTitle('Eliminar el documento')

  /** El «Confirmar» de `useConfirmDialog`, que se dibuja en un portal colgado del
   *  `<body>`: `screen` lo encuentra, el `container` del render no. */
  const confirmar = () => screen.getByRole('button', { name: 'Confirmar' })

  it('el aviso de «Documento eliminado» no sale si el DELETE no se llamó', async () => {
    const exito = vi.spyOn(toast, 'success').mockImplementation(() => {})
    const onCambio = vi.fn()

    montar({ onCambio })

    await act(async () => { fireEvent.click(botonDeBorrar('Remito 0001-00099')) })

    // Antes de confirmar no pasó nada: ni la llamada ni el aviso.
    expect(api.delete).not.toHaveBeenCalled()
    expect(exito).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(confirmar()) })

    // El id del REMITO —12— y no el de la factura: con el de la primera fila
    // fijo, la prueba pasaría igual si el bloque borrara siempre la de arriba.
    expect(api.delete).toHaveBeenCalledWith('/suppliers/documents/12')
    expect(api.delete).toHaveBeenCalledTimes(1)
    expect(exito).toHaveBeenCalledWith('Documento eliminado.')
    expect(onCambio).toHaveBeenCalled()
  })

  it('si el DELETE falla, NO dice que el documento se eliminó', async () => {
    // La otra mitad del mismo defecto: un aviso de éxito que no depende de lo
    // que contestó el servidor. Sin este caso, un `catch` vacío —o un `await`
    // sobre una promesa que nadie mira— pasaría la prueba de arriba entera.
    api.delete.mockRejectedValue({
      response: { status: 500, data: { error: 'Error al eliminar el documento del proveedor' } },
    })
    const exito = vi.spyOn(toast, 'success').mockImplementation(() => {})
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})
    const onCambio = vi.fn()

    montar({ onCambio })

    await act(async () => { fireEvent.click(botonDeBorrar('Factura 0001-00043212')) })
    await act(async () => { fireEvent.click(confirmar()) })

    expect(api.delete).toHaveBeenCalledWith('/suppliers/documents/11')
    expect(exito).not.toHaveBeenCalled()
    expect(aviso).toHaveBeenCalled()
    // Y la ficha no se vuelve a pedir: refrescar después de un error redibuja la
    // lista igual que estaba y deja al usuario sin saber qué pasó.
    expect(onCambio).not.toHaveBeenCalled()
  })

  it('cancelar la confirmación no llama a nadie ni avisa nada', async () => {
    // Lo que separa «pide confirmación» de «avisa y borra igual».
    const exito = vi.spyOn(toast, 'success').mockImplementation(() => {})

    montar()

    await act(async () => { fireEvent.click(botonDeBorrar('Remito 0001-00099')) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    })

    expect(api.delete).not.toHaveBeenCalled()
    expect(exito).not.toHaveBeenCalled()
  })
})
