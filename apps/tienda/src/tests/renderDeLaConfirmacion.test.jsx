import { describe, it, expect, afterEach, vi } from 'vitest'
import Confirmacion from '../pantallas/Confirmacion.jsx'
import SeAgoto from '../estados/SeAgoto.jsx'
import { desmontarTodo, dibujar, tocar } from './ayudaDeRender.jsx'

// ════════════════════════════════════════════
//  T1466 · La confirmación
// ════════════════════════════════════════════

const PEDIDO = {
  numero: 1042,
  estado: 'pendiente_pago',
  total: 41368,
  envio_costo: 2500,
  entrega: 'envio',
  medio_pago: 'transferencia',
  lineas: [
    { nombre: 'Whey Protein Isolate 1kg', cantidad: 1, precio_unitario: 38868, subtotal: 38868 },
  ],
}

const CATALOGO = { nombre: 'Comprafit / Fitnet' }

afterEach(() => desmontarTodo())

const montar = (pedido = PEDIDO) =>
  dibujar(<Confirmacion pedido={pedido} catalogo={CATALOGO} alVolver={() => {}} />)

describe('confirmación · lo que se lee', () => {
  it('el número con el mismo formato que las otras cinco superficies', () => {
    // `#1042`. El numeral es de presentación y no se guarda; la letra de la
    // maqueta (`#A-1042`) se descartó porque no significaba nada.
    const p = montar()

    expect(p.ver('[data-numero]').textContent).toBe('#1042')
    expect(p.texto()).not.toContain('#A-')
  })

  it('el resumen con los precios congelados y el total del servidor', () => {
    const p = montar()

    expect(p.texto()).toContain('Whey Protein Isolate 1kg')
    expect(p.ver('[data-total]').textContent).toBe('$41.368')
    expect(p.ver('[data-envio]').textContent).toContain('$2.500')
  })

  it('sin envío no se dibuja el renglón del envío', () => {
    // «Envío $0» le hace pensar al comprador que paga algo.
    const p = montar({ ...PEDIDO, envio_costo: 0, entrega: 'retiro_local' })

    expect(p.ver('[data-envio]')).toBeNull()
  })
})

describe('confirmación · lo que NO se promete', () => {
  it('sin email del comprador la pantalla NO dice que mandamos el detalle por email', () => {
    const p = montar()

    expect(p.ver('[data-email]')).toBeNull()
    expect(p.texto().toLowerCase()).not.toContain('por email')
  })

  it('con email pero sin envío confirmado tampoco lo promete', () => {
    // Las dos condiciones hacen falta. `sendEmail` devolviendo `ok: true` sin
    // haber enviado nada ya pasó en este repositorio: la pantalla prometía un
    // correo que no llegaba, y el que espera no vuelve a preguntar.
    const p = montar({ ...PEDIDO, email: 'martina@gmail.com', email_enviado: false })

    expect(p.ver('[data-email]')).toBeNull()
  })

  it('con las dos condiciones sí lo dice, y nombra la dirección', () => {
    const p = montar({ ...PEDIDO, email: 'martina@gmail.com', email_enviado: true })

    expect(p.ver('[data-email]').textContent).toContain('martina@gmail.com')
  })
})

describe('confirmación · el WhatsApp', () => {
  it('el enlace es el que armó el servidor, tal cual', () => {
    const enlace = 'https://wa.me/5493425123456?text=Pedido%20%231042'
    const p = montar({ ...PEDIDO, whatsapp: enlace })

    expect(p.ver('[data-whatsapp]').getAttribute('href')).toBe(enlace)
  })

  it('sin enlace, el botón no se dibuja', () => {
    // Un botón que abre WhatsApp sin destinatario es peor que ninguno: manda al
    // comprador a un chat con alguien que no es el comercio.
    expect(montar().ver('[data-whatsapp]')).toBeNull()
  })
})

// ════════════════════════════════════════════
//  T1466 · «Se agotó», el segundo estado del corte
// ════════════════════════════════════════════

describe('se agotó · la línea no desaparece', () => {
  const LINEAS = [
    { product_id: 9, nombre: 'Barra proteica chocolate 60g', marca: 'Gentech', precio: 3500, cantidad: 1, quitada: true },
    { product_id: 1, nombre: 'Whey Protein Isolate 1kg', marca: 'ENA', precio: 38868, cantidad: 1 },
  ]

  it('la línea recortada se dibuja tachada con el aviso al lado', () => {
    // Sacarla y volver a dibujar deja un pedido que vale menos y un comprador
    // que no sabe por qué. Un cambio de importe sin causa visible termina en una
    // llamada al comercio, y el comercio tampoco sabe qué pasó.
    const p = dibujar(<SeAgoto catalogo={CATALOGO} lineas={LINEAS} total={38868} alSeguir={() => {}} />)

    expect(p.texto()).toContain('Barra proteica chocolate 60g')
    expect(p.texto()).toContain('Whey Protein Isolate 1kg')
    expect(p.ver('[data-total]').textContent).toBe('$38.868')
  })

  it('«Seguir con el resto» avisa una sola vez', () => {
    const alSeguir = vi.fn()
    const p = dibujar(<SeAgoto catalogo={CATALOGO} lineas={LINEAS} total={38868} alSeguir={alSeguir} />)

    tocar(p.porTexto('Seguir con el resto'))
    expect(alSeguir).toHaveBeenCalledTimes(1)
  })
})
