import { describe, it, expect, afterEach, vi } from 'vitest'
import Checkout from '../pantallas/Checkout.jsx'
import {
  PUERTA_DE_DATOS_PERSONALES,
  cuerpoDelPedido,
  faltaDelPaso,
  opcionesDeEntrega,
  opcionesDePago,
} from '../checkout.js'
import { desmontarTodo, dibujar, escribir, tocar } from './ayudaDeRender.jsx'

// ════════════════════════════════════════════
//  T1465 · El checkout de tres pasos
// ════════════════════════════════════════════

const CATALOGO = {
  nombre: 'Comprafit / Fitnet',
  entrega: {
    retiro_socio: true,
    retiro_socio_direccion: 'Fitnet · Av. Pellegrini 1420',
    retiro_local: true,
    envio: true,
    envio_costo: 2500,
    envio_gratis_desde: 50000,
    coordinar_whatsapp: false,
  },
  pagos: { mercadopago: false, transferencia: true, efectivo: true },
  pide: { nro_socio: true },
  transferencia: { titular: 'Comprafit S.R.L.', cbu: '0720123488000012345678', alias: 'COMPRAFIT.SUPLE' },
}

const LINEAS = [{ product_id: 1, nombre: 'Whey', precio: 38868, cantidad: 1 }]

afterEach(() => desmontarTodo())

const montar = (props = {}) =>
  dibujar(
    <Checkout
      paso={0}
      catalogo={CATALOGO}
      lineas={LINEAS}
      formulario={{}}
      alEscribir={() => {}}
      alAtras={() => {}}
      alAvanzar={() => {}}
      {...props}
    />
  )

describe('checkout · la puerta de FR-147a', () => {
  it('con la puerta cerrada NO se dibujan el DNI ni la casilla de marketing', () => {
    // No deshabilitados: **ausentes**. Pedir un documento o un consentimiento de
    // comunicaciones sin Términos ni Política de Privacidad publicados es juntar
    // un dato personal sin base para tenerlo — y el servidor lo descarta igual,
    // que es la otra mitad de la puerta.
    expect(PUERTA_DE_DATOS_PERSONALES).toBe(false)

    const p = montar()

    expect(p.ver('[data-campo="dni"]')).toBeNull()
    expect(p.ver('[data-campo="acepta_comunicaciones"]')).toBeNull()
    expect(p.texto()).not.toContain('DNI')
    expect(p.texto().toLowerCase()).not.toContain('novedades')
  })
})

describe('checkout · paso 1, los datos', () => {
  it('pide nombre y teléfono, y el email va marcado como opcional', () => {
    const p = montar()

    expect(p.ver('[data-campo="nombre"]')).not.toBeNull()
    expect(p.ver('[data-campo="telefono"]')).not.toBeNull()
    expect(p.texto()).toContain('Email (opcional)')
  })

  it('el renglón del N° de socio dice el texto de la decisión 3 y no el de la maqueta', () => {
    // La maqueta prometía «Con eso aplicamos el precio de socio». El precio sale
    // del catálogo y no cambia un peso con el número puesto: decirlo así
    // convierte un campo opcional en un peaje.
    const p = montar()

    expect(p.ver('[data-ayuda="nro_socio"]').textContent)
      .toBe('Nos ayuda a identificarte cuando retirás el pedido.')
    expect(p.texto()).not.toContain('precio de socio')
  })

  it('el N° de socio no se dibuja si el catálogo no lo pide', () => {
    const p = montar({ catalogo: { ...CATALOGO, pide: { nro_socio: false } } })

    expect(p.ver('[data-campo="nro_socio"]')).toBeNull()
  })

  it('no avanza sin nombre, y lo dice', () => {
    const alAvanzar = vi.fn()
    const p = montar({ alAvanzar })

    tocar(p.ver('[data-avanzar]'))

    expect(alAvanzar).not.toHaveBeenCalled()
    expect(p.ver('[data-falta="nombre"]')).not.toBeNull()
  })

  it('con nombre y teléfono avanza', () => {
    const alAvanzar = vi.fn()
    const p = montar({ alAvanzar, formulario: { nombre: 'Martina', telefono: '3425123456' } })

    tocar(p.ver('[data-avanzar]'))
    expect(alAvanzar).toHaveBeenCalled()
  })

  it('escribir en un campo avisa con el nombre y el valor', () => {
    const alEscribir = vi.fn()
    const p = montar({ alEscribir })

    escribir(p.ver('[data-campo="nombre"]'), 'Martina Olivera')
    expect(alEscribir).toHaveBeenCalledWith('nombre', 'Martina Olivera')
  })
})

describe('checkout · paso 2, la entrega', () => {
  const paso2 = (props = {}) => montar({ paso: 1, formulario: { nombre: 'M', telefono: '3425123456' }, ...props })

  it('sólo se ofrecen las opciones que el catálogo tiene encendidas', () => {
    const p = paso2()

    expect(p.ver('[data-opcion="retiro_socio"]')).not.toBeNull()
    expect(p.ver('[data-opcion="envio"]')).not.toBeNull()
    // `coordinar_whatsapp` está apagado: ofrecerlo termina en un pedido que el
    // comercio no puede cumplir, y el que da la cara es el gimnasio.
    expect(p.ver('[data-opcion="coordinar"]')).toBeNull()
  })

  it('los campos de domicilio aparecen sólo con envío elegido', () => {
    expect(paso2().ver('[data-domicilio]')).toBeNull()

    const conEnvio = paso2({ formulario: { nombre: 'M', telefono: '3425123456', entrega: 'envio' } })
    expect(conEnvio.ver('[data-campo="envio_direccion"]')).not.toBeNull()
    expect(conEnvio.ver('[data-campo="envio_cp"]')).not.toBeNull()
  })

  it('no se puede saltear: sin entrega elegida no avanza', () => {
    const alAvanzar = vi.fn()
    const p = paso2({ alAvanzar })

    tocar(p.ver('[data-avanzar]'))

    expect(alAvanzar).not.toHaveBeenCalled()
    expect(p.ver('[data-falta="entrega"]')).not.toBeNull()
  })

  it('con envío elegido y sin dirección tampoco avanza', () => {
    const alAvanzar = vi.fn()
    const p = paso2({ alAvanzar, formulario: { nombre: 'M', telefono: '3425123456', entrega: 'envio' } })

    tocar(p.ver('[data-avanzar]'))

    expect(alAvanzar).not.toHaveBeenCalled()
    expect(p.ver('[data-falta="envio_direccion"]')).not.toBeNull()
  })
})

describe('checkout · paso 3, el pago', () => {
  const base = { nombre: 'M', telefono: '3425123456', entrega: 'retiro_local' }
  const paso3 = (props = {}) => montar({ paso: 2, formulario: base, ...props })

  it('«efectivo al retirar» no aparece con envío a domicilio', () => {
    // Quien elige las dos cosas está pidiendo que le lleven el pedido a la casa
    // y pagarlo al retirarlo en un local al que no va a ir. El malentendido
    // aparece en la puerta.
    expect(paso3().ver('[data-opcion="efectivo"]')).not.toBeNull()

    const conEnvio = paso3({
      formulario: { ...base, entrega: 'envio', envio_direccion: 'x', envio_localidad: 'y', envio_cp: '1424' },
    })

    expect(conEnvio.ver('[data-opcion="efectivo"]')).toBeNull()
    expect(conEnvio.ver('[data-opcion="transferencia"]')).not.toBeNull()
  })

  it('ninguna pantalla dice que el pedido queda reservado', () => {
    // **Ningún pedido vence solo** (FR-168a): no hay tarea que los expire y no
    // hay stock reservado. Prometer un plazo que nadie vigila deja al comprador
    // creyendo que perdió el lugar.
    const p = paso3({ formulario: { ...base, medio_pago: 'transferencia' } })
    const texto = p.texto().toLowerCase()

    expect(texto).not.toContain('reserv')
    expect(texto).not.toContain('24 h')
    expect(texto).not.toContain('24 horas')
    expect(p.texto()).toContain('Después de transferir, mandanos el comprobante por WhatsApp.')
  })

  it('los datos bancarios salen sólo con transferencia elegida', () => {
    expect(paso3().ver('[data-transferencia]')).toBeNull()

    const p = paso3({ formulario: { ...base, medio_pago: 'transferencia' } })

    expect(p.ver('[data-banco="cbu"]').textContent).toBe('0720123488000012345678')
    expect(p.ver('[data-banco="alias"]').textContent).toBe('COMPRAFIT.SUPLE')
  })

  it('el último paso dice «Confirmar pedido» y muestra el total con envío', () => {
    const p = paso3({
      formulario: { ...base, entrega: 'envio', envio_direccion: 'x', envio_localidad: 'y', envio_cp: '1424', medio_pago: 'transferencia' },
    })

    expect(p.ver('[data-avanzar]').textContent).toBe('Confirmar pedido')
    // 38.868 + 2.500 de envío.
    expect(p.ver('[data-total]').textContent).toBe('$41.368')
  })

  it('mientras se envía, el botón no se puede volver a tocar', () => {
    const p = paso3({ formulario: { ...base, medio_pago: 'efectivo' }, enviando: true })

    expect(p.ver('[data-avanzar]').disabled).toBe(true)
  })
})

describe('checkout · las reglas puras', () => {
  it('las opciones salen del catálogo, no de una lista fija', () => {
    expect(opcionesDeEntrega(CATALOGO).map((o) => o.clave)).toEqual(['retiro_socio', 'retiro_local', 'envio'])
    expect(opcionesDeEntrega({})).toEqual([])
    expect(opcionesDePago(CATALOGO, 'envio').map((o) => o.clave)).toEqual(['transferencia'])
    expect(opcionesDePago(CATALOGO, 'retiro_local').map((o) => o.clave)).toEqual(['transferencia', 'efectivo'])
  })

  it('una entrega que el catálogo no ofrece no pasa la validación', () => {
    // Aunque el valor exista en el enum del servidor.
    const sinEnvio = { ...CATALOGO, entrega: { ...CATALOGO.entrega, envio: false } }

    expect(faltaDelPaso('entrega', { entrega: 'envio' }, sinEnvio)).toMatchObject({ campo: 'entrega' })
  })

  it('el cuerpo del pedido lleva product_id y cantidad, y ningún precio', () => {
    const cuerpo = cuerpoDelPedido(
      { nombre: 'Martina', telefono: '3425123456', entrega: 'retiro_local', medio_pago: 'efectivo' },
      [{ product_id: 1, cantidad: 2, precio: 38868, nombre: 'Whey' }],
      'clave-1'
    )

    expect(cuerpo.items).toEqual([{ product_id: 1, cantidad: 2 }])
    expect(JSON.stringify(cuerpo)).not.toContain('38868')
    // Y del comprador no viaja lo que la puerta tapa.
    expect(cuerpo.comprador.dni).toBeUndefined()
    expect(cuerpo.comprador.acepta_comunicaciones).toBeUndefined()
  })

  it('los campos de envío viajan sólo cuando hay envío', () => {
    const base = { nombre: 'M', telefono: '3425123456', medio_pago: 'efectivo', envio_direccion: 'Av. Rivadavia 4821' }

    expect(cuerpoDelPedido({ ...base, entrega: 'retiro_local' }, [], 'k').comprador.envio_direccion).toBeUndefined()
    expect(cuerpoDelPedido({ ...base, entrega: 'envio' }, [], 'k').comprador.envio_direccion).toBe('Av. Rivadavia 4821')
  })
})
