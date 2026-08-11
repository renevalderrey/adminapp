import { useState } from 'react'
import { precioTexto } from '../formato.js'
import { totalesDelPedido } from '../totales.js'
import {
  PASOS,
  PUERTA_DE_DATOS_PERSONALES,
  faltaDelPaso,
  opcionesDeEntrega,
  opcionesDePago,
} from '../checkout.js'

// ════════════════════════════════════════════
//  El checkout de tres pasos (maqueta, `esCheckout`, `:257-389`)
//
//  Datos → Entrega → Pago. Tres pantallas y una barra de progreso, no un
//  formulario largo: en un teléfono, un formulario de doce campos se abandona en
//  el sexto.
//
//  Todo lo que decide —qué opciones hay, qué falta para avanzar, qué se manda—
//  vive en `src/checkout.js`. Acá está el dibujo.
//
//  ── Tres textos que NO son los de la maqueta, y por qué ──
//
//  **1 · El N° de socio.** La maqueta dice «Con eso aplicamos el precio de
//  socio» (`:295`). Es falso: el precio sale del catálogo, y el mismo catálogo
//  tiene el mismo precio con número de socio o sin él. Decirlo así convierte un
//  campo opcional en un peaje —el que no lo tiene cree que paga más— y además
//  promete algo que el sistema no hace. Dice, en su lugar: **«Nos ayuda a
//  identificarte cuando retirás el pedido.»**, que es para lo que sirve.
//
//  **2 · La transferencia.** La maqueta dice «El pedido queda reservado 24
//  horas» (`:375`). **Ningún pedido vence solo** (FR-168a): no hay tarea que los
//  expire, no hay stock reservado, y el pedido de hace tres días sigue igual de
//  vivo. Prometer un plazo que nadie cumple ni vigila deja al comprador creyendo
//  que perdió el lugar y al comercio con un pedido que él da por caído.
//
//  **3 · El DNI y la casilla de marketing no se dibujan.** Ver la puerta de
//  FR-147a en `src/checkout.js`.
// ════════════════════════════════════════════

const TITULOS = { datos: 'Tus datos', entrega: 'Cómo lo recibís', pago: 'Cómo pagás' }

const campoBase = {
  width: '100%',
  height: '44px',
  borderRadius: '10px',
  border: '1px solid var(--borde)',
  background: 'var(--papel)',
  color: 'var(--tinta)',
  font: 'inherit',
  fontSize: '15px',
  padding: '0 12px',
  // `minWidth: 0` es defensivo y **no** es lo que hoy evita el desborde: con
  // `width: 100%` el navegador ya acota el mínimo automático del `<input>` al
  // ancho de su celda, y sacarlo deja la prueba de 390px en verde —medido, no
  // supuesto—. Queda porque el día que un campo pierda el `width: 100%` —o entre
  // en un flex sin él— el ancho intrínseco del `<input>` sí empuja la pantalla.
  minWidth: 0,
  boxSizing: 'border-box',
}

function Campo({ etiqueta, nombre, valor, alEscribir, ayuda, tipo = 'text', modo }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label
        htmlFor={`campo-${nombre}`}
        style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: 'var(--tinta-media)', marginBottom: '5px' }}
      >
        {etiqueta}
      </label>
      <input
        id={`campo-${nombre}`}
        className="t-foco"
        data-campo={nombre}
        type={tipo}
        inputMode={modo}
        value={valor || ''}
        onChange={(e) => alEscribir(nombre, e.target.value)}
        style={campoBase}
      />
      {ayuda ? (
        <span data-ayuda={nombre} style={{ display: 'block', marginTop: '5px', fontSize: '11.5px', color: 'var(--tinta-suave)' }}>
          {ayuda}
        </span>
      ) : null}
    </div>
  )
}

function Opcion({ opcion, elegida, alElegir, grupo }) {
  const puesta = elegida === opcion.clave

  return (
    <button
      type="button"
      className="t-foco"
      data-opcion={opcion.clave}
      data-grupo={grupo}
      aria-pressed={puesta}
      onClick={() => alElegir(opcion.clave)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '11px',
        textAlign: 'left',
        padding: '13px 12px',
        borderRadius: '12px',
        border: `1px solid ${puesta ? 'var(--marca)' : 'var(--borde)'}`,
        background: 'var(--papel)',
        color: 'var(--tinta)',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '18px',
          height: '18px',
          flex: 'none',
          borderRadius: '50%',
          border: `${puesta ? '5px' : '1px'} solid ${puesta ? 'var(--marca)' : 'var(--borde)'}`,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '14px', fontWeight: 600 }}>{opcion.titulo}</span>
        {opcion.detalle ? (
          <span style={{ display: 'block', marginTop: '2px', fontSize: '11.5px', color: 'var(--tinta-suave)' }}>
            {opcion.detalle}
          </span>
        ) : null}
      </span>
      {opcion.costo ? (
        <span style={{ fontSize: '12.5px', fontWeight: 600, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
          {opcion.costo}
        </span>
      ) : null}
    </button>
  )
}

/** Los datos bancarios, con el botón de copiar de la maqueta. */
function Transferencia({ datos }) {
  const [copiado, setCopiado] = useState(null)

  const copiar = (clave, texto) => {
    // El portapapeles no existe sin HTTPS y puede estar bloqueado. Que no se
    // pueda copiar **no puede** romper el checkout: el número está a la vista y
    // se puede escribir a mano.
    try {
      navigator.clipboard.writeText(texto)
      setCopiado(clave)
    } catch {
      setCopiado(null)
    }
  }

  const renglon = (clave, etiqueta, valor) =>
    valor ? (
      <div key={clave} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--tinta-suave)' }}>{etiqueta}</p>
          <p data-banco={clave} style={{ margin: '2px 0 0', fontSize: '13.5px', fontWeight: 600, wordBreak: 'break-all' }}>
            {valor}
          </p>
        </div>
        <button
          type="button"
          className="t-foco"
          data-copiar={clave}
          onClick={() => copiar(clave, valor)}
          style={{
            flex: 'none',
            height: '32px',
            padding: '0 11px',
            borderRadius: '9px',
            border: '1px solid var(--borde)',
            background: 'var(--papel)',
            color: 'var(--tinta)',
            font: 'inherit',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {copiado === clave ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    ) : null

  return (
    <div
      data-transferencia
      style={{
        marginTop: '12px',
        padding: '13px',
        borderRadius: '12px',
        border: '1px solid var(--borde)',
        background: 'var(--marcador)',
        display: 'grid',
        gap: '11px',
      }}
    >
      {renglon('titular', 'Titular', datos.titular)}
      {renglon('cbu', 'CBU', datos.cbu)}
      {renglon('alias', 'Alias', datos.alias)}

      {/* ⚠ Sin plazo. Ver el encabezado, punto 2. */}
      <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.5, color: 'var(--tinta-media)' }}>
        Después de transferir, mandanos el comprobante por WhatsApp.
      </p>
    </div>
  )
}

/**
 * Lo que se dibuja cuando el catálogo no ofrece nada que se pueda elegir.
 *
 * ⚠ Una lista vacía **no es una pantalla**: el comprador ve un paso en blanco y
 * un botón que no hace nada, y lo lee como que la tienda está rota. Con esto lee
 * que el problema es del comercio, y tiene una salida —WhatsApp— en vez de
 * cerrar la pestaña.
 *
 * No debería pasar nunca: el servidor no deja publicar un catálogo así. Queda
 * para el que ya estaba publicado cuando le apagaron la transferencia.
 */
function SinOpciones({ que, whatsapp }) {
  return (
    <div
      data-sin-opciones={que}
      role="alert"
      style={{
        padding: '14px',
        borderRadius: '12px',
        border: '1px solid var(--aviso-borde)',
        background: 'var(--aviso-fondo)',
        display: 'grid',
        gap: '10px',
      }}
    >
      <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 600, color: 'var(--aviso)' }}>
        {que === 'entrega'
          ? 'Esta tienda no está recibiendo pedidos ahora mismo'
          : 'No hay forma de pagar esta entrega'}
      </p>
      <p style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.5, color: 'var(--tinta-media)' }}>
        {que === 'entrega'
          ? 'Le falta configurar cómo entrega y cómo cobra. Escribile y lo resuelven por ahí.'
          : 'Probá con otra forma de entrega, o escribiles y lo coordinan por ahí.'}
      </p>

      {whatsapp ? (
        <a
          className="t-foco"
          data-whatsapp-ayuda
          href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'grid',
            placeItems: 'center',
            height: '42px',
            borderRadius: '10px',
            background: 'var(--marca)',
            color: 'var(--marca-texto)',
            fontSize: '14px',
            fontWeight: 620,
            textDecoration: 'none',
          }}
        >
          Escribir por WhatsApp
        </a>
      ) : null}
    </div>
  )
}

/**
 * @param {object} props
 * @param {number} props.paso Índice dentro de `PASOS`.
 * @param {object} props.formulario
 * @param {Function} props.alEscribir `(campo, valor)`.
 * @param {Function} props.alAtras
 * @param {Function} props.alAvanzar
 * @param {boolean} [props.enviando]
 */
export default function Checkout({
  paso = 0,
  catalogo = {},
  lineas = [],
  formulario = {},
  alEscribir,
  alAtras,
  alAvanzar,
  enviando = false,
  aviso = null,
}) {
  const [tocado, setTocado] = useState(false)

  const actual = PASOS[paso] || PASOS[0]
  const entregas = opcionesDeEntrega(catalogo)
  const pagos = opcionesDePago(catalogo, formulario.entrega)
  const falta = faltaDelPaso(actual, formulario, catalogo)

  const totales = totalesDelPedido(lineas, catalogo.entrega, formulario.entrega)
  const ultimo = paso === PASOS.length - 1

  // Sin nada que elegir, el botón se apaga: dejarlo activo sobre una lista vacía
  // es un botón que rechaza sin decir por qué.
  const sinSalida = (actual === 'entrega' && entregas.length === 0)
    || (actual === 'pago' && pagos.length === 0)

  const intentar = () => {
    if (falta) {
      setTocado(true)
      return
    }
    setTocado(false)
    alAvanzar()
  }

  return (
    <main data-pantalla="checkout" data-paso={actual} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'var(--papel)',
          borderBottom: '1px solid var(--borde)',
        }}
      >
        <div style={{ height: '52px', display: 'flex', alignItems: 'center', gap: '10px', padding: '0 12px' }}>
          <button
            type="button"
            className="t-foco"
            data-volver
            aria-label="Volver"
            onClick={alAtras}
            style={{
              width: '34px',
              height: '34px',
              flex: 'none',
              borderRadius: '9px',
              border: '1px solid var(--borde)',
              background: 'var(--papel)',
              color: 'var(--tinta)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ width: '17px', height: '17px', display: 'block' }}
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span style={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: 640 }}>{TITULOS[actual]}</span>
          <span data-progreso style={{ fontSize: '11.5px', color: 'var(--tinta-suave)', flex: 'none' }}>
            Paso {paso + 1} de {PASOS.length}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '4px', padding: '0 12px 10px' }}>
          {PASOS.map((nombre, i) => (
            <span
              key={nombre}
              data-barra={nombre}
              data-hecho={i <= paso ? 'si' : 'no'}
              style={{ flex: 1, height: '3px', borderRadius: '2px', background: i <= paso ? 'var(--marca)' : 'var(--borde)' }}
            />
          ))}
        </div>
      </div>

      <div className="t-ancho" style={{ flex: 1, padding: '16px', display: 'grid', gap: '13px', alignContent: 'start' }}>
        {actual === 'datos' ? (
          <>
            <Campo etiqueta="Nombre y apellido" nombre="nombre" valor={formulario.nombre} alEscribir={alEscribir} />
            <Campo etiqueta="Teléfono" nombre="telefono" valor={formulario.telefono} alEscribir={alEscribir} tipo="tel" modo="tel" />
            <Campo etiqueta="Email (opcional)" nombre="email" valor={formulario.email} alEscribir={alEscribir} tipo="email" modo="email" />

            {catalogo.pide && catalogo.pide.nro_socio ? (
              <Campo
                etiqueta="N° de socio"
                nombre="nro_socio"
                valor={formulario.nro_socio}
                alEscribir={alEscribir}
                // ⚠ El texto de la decisión 3, no el de la maqueta.
                ayuda="Nos ayuda a identificarte cuando retirás el pedido."
              />
            ) : null}

            {/* La puerta de FR-147a: con `PUERTA_DE_DATOS_PERSONALES` en false
                esto no existe en el DOM. No es un campo deshabilitado. */}
            {PUERTA_DE_DATOS_PERSONALES ? (
              <>
                <Campo etiqueta="DNI" nombre="dni" valor={formulario.dni} alEscribir={alEscribir} modo="numeric" />
                <label style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', fontSize: '12.5px' }}>
                  <input
                    type="checkbox"
                    data-campo="acepta_comunicaciones"
                    // Arranca desmarcada, y no es condición para comprar (FR-145).
                    checked={formulario.acepta_comunicaciones === true}
                    onChange={(e) => alEscribir('acepta_comunicaciones', e.target.checked)}
                  />
                  <span>Quiero recibir novedades y ofertas por email o WhatsApp.</span>
                </label>
              </>
            ) : null}
          </>
        ) : null}

        {actual === 'entrega' ? (
          <>
            {entregas.length === 0 ? <SinOpciones que="entrega" whatsapp={catalogo.whatsapp} /> : null}

            {entregas.map((o) => (
              <Opcion
                key={o.clave}
                grupo="entrega"
                opcion={o}
                elegida={formulario.entrega}
                alElegir={(clave) => alEscribir('entrega', clave)}
              />
            ))}

            {formulario.entrega === 'envio' ? (
              <div data-domicilio style={{ display: 'grid', gap: '11px' }}>
                <Campo etiqueta="Dirección" nombre="envio_direccion" valor={formulario.envio_direccion} alEscribir={alEscribir} />
                {/* `minmax(0, …)` y no `1fr` a secas, por lo mismo que el
                    `minWidth: 0` de arriba: hoy no cambia nada —los campos
                    llevan `width: 100%`— y es la red para cuando alguno lo
                    pierda. Lo que la prueba de 390px sí atrapa es un ancho fijo
                    más grande que la pantalla, y eso se verificó al revés. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '9px' }}>
                  <Campo etiqueta="Localidad" nombre="envio_localidad" valor={formulario.envio_localidad} alEscribir={alEscribir} />
                  <Campo etiqueta="CP" nombre="envio_cp" valor={formulario.envio_cp} alEscribir={alEscribir} modo="numeric" />
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {actual === 'pago' ? (
          <>
            {pagos.length === 0 ? <SinOpciones que="pago" whatsapp={catalogo.whatsapp} /> : null}

            {pagos.map((o) => (
              <Opcion
                key={o.clave}
                grupo="pago"
                opcion={o}
                elegida={formulario.medio_pago}
                alElegir={(clave) => alEscribir('medio_pago', clave)}
              />
            ))}

            {formulario.medio_pago === 'transferencia' && catalogo.transferencia ? (
              <Transferencia datos={catalogo.transferencia} />
            ) : null}
          </>
        ) : null}

        {/* Lo que dijo el servidor al intentar mandar el pedido. Va arriba del
            botón, que es donde se está mirando cuando pasa. */}
        {aviso ? (
          <p data-aviso role="alert" style={{ margin: 0, fontSize: '12.5px', color: 'var(--alerta)' }}>
            {aviso}
          </p>
        ) : null}

        {tocado && falta ? (
          <p data-falta={falta.campo} role="alert" style={{ margin: 0, fontSize: '12.5px', color: 'var(--alerta)' }}>
            {falta.mensaje}
          </p>
        ) : null}
      </div>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--papel)',
          borderTop: '1px solid var(--borde)',
          padding: '13px 16px 18px',
        }}
      >
        <div className="t-ancho">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '11px' }}>
            <span style={{ fontSize: '13px', color: 'var(--tinta-media)' }}>
              {totales.envio > 0 ? `Con envío ${precioTexto(totales.envio)}` : 'Total'}
            </span>
            <span data-total style={{ fontSize: '19px', fontWeight: 660, fontVariantNumeric: 'tabular-nums' }}>
              {precioTexto(totales.total)}
            </span>
          </div>

          <button
            type="button"
            className="t-foco"
            data-avanzar
            disabled={enviando || sinSalida}
            onClick={intentar}
            style={{
              width: '100%',
              height: '50px',
              borderRadius: '12px',
              border: '1px solid transparent',
              background: enviando || sinSalida ? 'var(--marcador)' : 'var(--marca)',
              color: enviando || sinSalida ? 'var(--tinta-suave)' : 'var(--marca-texto)',
              font: 'inherit',
              fontSize: '15px',
              fontWeight: 640,
              cursor: enviando || sinSalida ? 'default' : 'pointer',
            }}
          >
            {enviando ? 'Enviando…' : ultimo ? 'Confirmar pedido' : 'Continuar'}
          </button>
        </div>
      </div>
    </main>
  )
}
