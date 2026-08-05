import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  getPurchaseOrders,
  getPurchaseOrder,
  cancelPurchaseOrder,
  getSuppliers,
} from '@/services/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid';
import Pagination from '@/components/Pagination';
import PanelOrdenDeCompra, {
  EtiquetaDeEstado,
  BARRA_POR_TONO,
  enviarOrdenPorWhatsapp,
} from '@/components/PanelOrdenDeCompra';
import {
  Truck,
  XCircle,
  Loader2,
  Search,
  MessageCircle,
  MoreHorizontal,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  FilterX,
} from 'lucide-react';
import {
  ESTADOS,
  SEGMENTOS,
  porcentajeRecibido,
  esRecibible,
  esAnulable,
  filtrarOrdenes,
  contadoresPorSegmento,
} from '@/utils/ordenDeCompra';
import { pesos, fechaCorta } from '@/utils/formato';
import { mensajeDeError } from '@/utils/erroresDeApi';
import PageHeader from '@/components/PageHeader'

// ════════════════════════════════════════════
//  ADMINAPP · Órdenes de compra
//
//  Las etiquetas de estado salen de `utils/ordenDeCompra.js` y no de una copia
//  local (FR-107): esta pantalla y `Orders.jsx` tenían la misma lista escrita
//  dos veces, con etiquetas que ya no coincidían entre sí. Es el defecto de los
//  medios de pago otra vez: dos copias empiezan iguales y terminan distintas, y
//  una etiqueta que falta no hace fallar nada — se dibuja el código crudo.
//
//  ── Qué se fue de acá, y por qué no vuelve ──
//
//   · `VARIANTE_POR_TONO`, el puente del `tono` del sistema al `variant` del
//     Badge de shadcn. Era transitorio hasta esta reescritura: el tono se dibuja
//     con los tokens directamente y el Badge no participa.
//   · Los DOS modales —detalle y recepción—. Los reemplaza
//     `components/PanelOrdenDeCompra.jsx`, que es UN solo componente para esta
//     pantalla y para `/proveedores` (FR-034). Dos implementaciones de la
//     recepción es exactamente lo que dejó a una de las dos rota: la de
//     `Orders.jsx` recibía contra la primera orden pendiente del proveedor y no
//     contra la que se había abierto.
//   · `receiveForm`, indexado por `item.product_id`. Con dos líneas del mismo
//     producto había UN solo campo y dos `key` de React repetidos, y el cuerpo
//     que salía —`{ product_id, quantity_received }`— no alcanzaba para decir a
//     qué línea iba la mercadería. Ahora la identidad es la POSICIÓN y el estado
//     vive adentro del panel.
//   · `EtiquetaDeEstado` y `BARRA_POR_TONO`, que se mudaron al panel y se
//     importan de ahí. La traducción de `tono` a tokens tiene que estar en un
//     solo lugar —es el defecto que cerró `VARIANTE_POR_TONO`— y con el panel
//     compartido por las dos pantallas, dejarla acá obligaba a la otra a
//     importar de una `page` o a escribir su copia.
//   · `formatCurrency`, que fijaba `minimumFractionDigits: 2` y NO el máximo.
//     El máximo por defecto es 3, así que `1234.567` salía «1.234,567»: en la
//     misma columna convivían dos decimales y tres según qué trajera el dato, y
//     alinear a la derecha dejaba de servir para compararlos. Lo reemplaza
//     `pesos` de `utils/formato.js`, que fija los dos extremos.
//   · Los `Table*` de shadcn. La tabla es un grid con las mismas
//     `grid-template-columns` en el encabezado y en las filas (FR-001, FR-002).
//   · Los dos `<SelectItem value=" ">` de «Todos» —proveedor y estado—. Ese
//     espacio viajaba como `?supplier_id=%20` a una columna INTEGER, Postgres
//     respondía `invalid input syntax`, el `catch` hacía `console.error` y la
//     lista quedaba con lo anterior SIN ningún aviso: volver a «Todos» después
//     de filtrar por un proveedor no volvía a «Todos». FR-020: «todos» es la
//     AUSENCIA del parámetro, no un valor centinela. El desplegable de estados
//     era además la TERCERA copia de la lista de estados, y ahora es el
//     segmentado, que sale de `SEGMENTOS`.
//
//  ── Qué filtra el servidor y qué filtra la pantalla ──
//
//  El servidor pagina y acota por fechas (`limit`, `offset`, `from`, `to`); el
//  segmento y la búsqueda filtran **la página cargada**, con `filtrarOrdenes`.
//  No es una omisión: el contador de cada segmento (FR-008) tiene que salir de
//  la misma función que arma la lista —un contador que dice 12 sobre una lista
//  de 3 hace concluir que la pantalla se come filas—, y eso solo se puede si
//  las dos cosas miran el mismo arreglo. La consecuencia, y queda escrita
//  porque la spec no la decidió: con más de una página, buscar «Norte»
//  encuentra las órdenes de Norte **de la página que se está mirando**. El día
//  que moleste, lo que corresponde es una búsqueda del lado del servidor
//  (`q` en `GET /suppliers/orders`), no contar de un lado y filtrar del otro.
//
//  Reglas: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * Las siete columnas, idénticas en el encabezado y en las filas (FR-002).
 *
 * Que sean el MISMO string y no dos copias no es cosmético: cuando difieren,
 * las etiquetas dejan de estar sobre sus datos y se lee un importe bajo
 * «Recepción». La separación de 16px la pone `TablaGrid` con su `gap-x-4`.
 */
const COLUMNAS = '96px minmax(0,1fr) 112px 96px 148px 132px 120px';

/**
 * Por debajo de esto la tabla scrollea DENTRO de su tarjeta.
 *
 * 704px de columnas fijas + 96px de separaciones + 40px de padding = 840, y el
 * resto es lo mínimo que se le deja al nombre del proveedor. El `min-width` de
 * la página no se toca: haría scrollear el `<body>` entero y el usuario
 * perdería de vista la barra lateral cada vez que mira la última columna.
 */
const ANCHO_MINIMO = 1060;

// El tope que acepta `GET /suppliers`. Esta pantalla los necesita completos
// para resolver el teléfono al que mandar la orden por WhatsApp, así que el
// límite tiene que ser explícito: el por defecto es 50.
const LIMITE_DE_PROVEEDORES = 200;

/**
 * Cuántas órdenes trae cada página (FR-022).
 *
 * Hasta acá se pedían 100 fijas y NUNCA un `offset`: la orden 101 no se podía
 * alcanzar de ninguna forma, y el contador de arriba decía «312» mientras la
 * lista mostraba 100. Cincuenta es el por defecto del servidor y entra en una
 * pantalla sin que el scroll se vuelva el filtro.
 */
const FILAS_POR_PAGINA = 50;

/**
 * Lo que dice el botón de fechas cuando está cerrado (FR-010).
 *
 * El período vigente va escrito ADENTRO del botón y no en un texto al lado: un
 * filtro puesto que no se ve es cómo alguien concluye que faltan órdenes. Sin
 * fechas dice «Todo el período», que es la única forma de que el botón afirme
 * algo cuando no filtra nada.
 */
function etiquetaDelPeriodo(desde, hasta) {
  if (desde && hasta) return `${fechaCorta(desde)} – ${fechaCorta(hasta)}`;
  if (desde) return `Desde ${fechaCorta(desde)}`;
  if (hasta) return `Hasta ${fechaCorta(hasta)}`;

  return 'Todo el período';
}

/** El campo de fecha del panel del período, con su etiqueta. */
function CampoDeFecha({ etiqueta, valor, onChange }) {
  return (
    <label className="block text-[12px] font-medium text-fg-2">
      {etiqueta}
      <input
        type="date"
        aria-label={etiqueta}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="num mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-[13px]
                   transition-colors focus-visible:border-brand focus-visible:outline-none"
      />
    </label>
  );
}

/**
 * Los DOS estados vacíos, que son cosas distintas (FR-011).
 *
 * «Todavía no hay órdenes de compra» y «ninguna orden coincide con el filtro»
 * se ven igual —una tabla sin filas— y significan lo contrario. Un solo texto
 * para los dos manda a cargar una orden que ya existe, o hace buscar un filtro
 * que no está puesto. Por eso el segundo además dice **qué sacar** y trae el
 * botón que lo saca: enumerar el problema sin la salida es la mitad del aviso.
 */
function EstadoVacio({ hayFiltro, onLimpiar }) {
  if (hayFiltro) {
    return (
      <div className="py-12 text-center">
        <FilterX className="mx-auto h-7 w-7 text-fg-3" />
        <p className="mt-3 font-semibold">Ninguna orden coincide con el filtro.</p>
        <p className="mt-1 text-sm text-fg-2">
          Probá con otro período, volvé al segmento «Todas» o borrá la búsqueda.
        </p>
        <button
          type="button"
          onClick={onLimpiar}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3
                     text-[13px] font-medium transition-colors hover:border-border-2 hover:bg-surface-3"
        >
          Limpiar filtros
        </button>
      </div>
    );
  }

  return (
    <div className="py-12 text-center">
      <ClipboardList className="mx-auto h-7 w-7 text-fg-3" />
      <p className="mt-3 font-semibold">Todavía no hay órdenes de compra.</p>
      <p className="mt-1 text-sm text-fg-2">
        Cuando le pidas mercadería a un proveedor, la orden aparece acá con lo que falta recibir.
      </p>
    </div>
  );
}

/**
 * El menú de «más acciones» de una fila ([PENDIENTE 8]).
 *
 * Están acá las que ya existían y no entran en la fila —WhatsApp con y sin
 * precios— más «Anular», para no obligar a abrir el panel por algo de un clic.
 * La columna de acciones mide 120px: cuatro botones de 29px no entran, y por eso
 * la maqueta dibuja un botón de tres puntos.
 *
 * ⚠ **El menú se dibuja en un portal a `document.body`, no adentro de la fila.**
 * `TablaGrid` es `overflow-x-auto`, y un contenedor con un eje recortado recorta
 * también el otro: un menú posicionado dentro de la fila queda cortado por
 * abajo, y en la última fila de la tabla no se ve ninguna opción. jsdom no puede
 * detectarlo —no tiene motor de maquetado, `getBoundingClientRect` devuelve
 * ceros—, así que la decisión queda escrita acá y se mira en el navegador.
 */
function MenuDeAcciones({ acciones }) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState({ top: 0, right: 0 });
  const boton = useRef(null);
  const menu = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;

    // El clic de AFUERA cierra. La comprobación es por contención y no un
    // `setAbierto(false)` a secas: sin ella, el `mousedown` sobre una opción
    // desmonta el menú antes de que llegue el `click` y la acción no se ejecuta
    // nunca.
    const cerrarSiEsAfuera = (evento) => {
      if (menu.current?.contains(evento.target)) return;
      if (boton.current?.contains(evento.target)) return;
      setAbierto(false);
    };

    const cerrarConEscape = (evento) => {
      if (evento.key === 'Escape') setAbierto(false);
    };

    // Scrollear mueve la fila y el menú se quedaría flotando sobre otra: como
    // está posicionado en coordenadas de ventana, lo honesto es cerrarlo.
    const cerrar = () => setAbierto(false);

    document.addEventListener('mousedown', cerrarSiEsAfuera);
    document.addEventListener('keydown', cerrarConEscape);
    window.addEventListener('scroll', cerrar, true);
    window.addEventListener('resize', cerrar);

    return () => {
      document.removeEventListener('mousedown', cerrarSiEsAfuera);
      document.removeEventListener('keydown', cerrarConEscape);
      window.removeEventListener('scroll', cerrar, true);
      window.removeEventListener('resize', cerrar);
    };
  }, [abierto]);

  const alternar = () => {
    const caja = boton.current?.getBoundingClientRect();

    setPosicion({
      top: (caja?.bottom ?? 0) + 6,
      right: Math.max(window.innerWidth - (caja?.right ?? 0), 8),
    });
    setAbierto((v) => !v);
  };

  return (
    <>
      {/* El `ref` va en el envoltorio y no en `BotonDeFila`: el marco de la
          tabla es una función sin `forwardRef`, y agregárselo por un solo uso
          sería tocar el componente que comparten seis pantallas. El `span` mide
          lo mismo que el botón, que es lo único que hace falta para anclar. */}
      <span ref={boton} className="inline-flex">
        <BotonDeFila title="Más acciones" aria-expanded={abierto} onClick={alternar}>
          <MoreHorizontal />
        </BotonDeFila>
      </span>

      {abierto &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: 'fixed', top: posicion.top, right: posicion.right }}
            className="z-50 w-[224px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-nivel-2"
          >
            {acciones.map((accion) => (
              <button
                key={accion.etiqueta}
                type="button"
                role="menuitem"
                onClick={(evento) => {
                  evento.stopPropagation();
                  setAbierto(false);
                  accion.hacer();
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors
                            hover:bg-surface-3 ${accion.destructiva ? 'text-danger hover:bg-danger-soft' : ''}`}
              >
                {accion.icono}
                {accion.etiqueta}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

const PurchaseOrders = () => {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  /**
   * La orden abierta en el panel, y en qué modo.
   *
   * ⚠ **Son UNA sola pieza de estado para los dos caminos** —el clic en la fila
   * y el botón «Recibir»— y ahí está la corrección de fondo del defecto 4: la
   * orden que se recibe es la que está acá, y no hay ninguna otra de donde
   * sacarla. `Orders.jsx` tenía dos caminos y el de recepción la resolvía con un
   * `find` por estado sobre las órdenes del proveedor.
   *
   * `ordenAbierta` guarda el detalle ENRIQUECIDO de `GET /suppliers/orders/:id`
   * —el que trae `linea`, `costo_actual` y `propone_costo` desde T1208— y no la
   * fila del listado: sin esos tres campos, la recepción no sabe a qué línea va
   * la mercadería ni qué costo proponer.
   */
  const [ordenAbierta, setOrdenAbierta] = useState(null);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [modoDelPanel, setModoDelPanel] = useState('detalle');
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [suppliers, setSuppliers] = useState([]);

  // Lo que filtra el SERVIDOR: el período. Los dos campos van juntos en un
  // objeto porque se mandan juntos y se limpian juntos.
  const [periodo, setPeriodo] = useState({ from: '', to: '' });
  const [periodoAbierto, setPeriodoAbierto] = useState(false);

  // Lo que filtra la PANTALLA sobre la página cargada (ver el encabezado).
  const [segmento, setSegmento] = useState('todas');
  const [busqueda, setBusqueda] = useState('');

  const [pagina, setPagina] = useState(1);

  /** El teléfono con el que se le manda la orden al proveedor por WhatsApp. */
  const telefonoDe = useCallback(
    (order) => suppliers.find((s) => s.id === order?.supplier_id)?.phone || null,
    [suppliers]
  );

  /**
   * Pide la página vigente del listado.
   *
   * Los parámetros se arman por PRESENCIA: lo que no está puesto no viaja. Es
   * FR-020 del lado del navegador, y es lo que cierra el defecto 5 del
   * relevamiento —un `supplier_id` con un espacio adentro rompía la consulta y
   * la pantalla no lo decía—. La validación del servidor (T1212) sigue
   * existiendo por lo mismo de siempre: el navegador no es una barrera.
   */
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        limit: FILAS_POR_PAGINA,
        offset: (pagina - 1) * FILAS_POR_PAGINA,
      };
      if (periodo.from) params.from = periodo.from;
      if (periodo.to) params.to = periodo.to;

      const res = await getPurchaseOrders(params);
      setOrders(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      // FR-095. Era un `console.error` mudo: la lista quedaba con lo anterior y
      // sin ningún aviso, así que volver a «Todos» después de filtrar por un
      // proveedor «no volvía a Todos» — parecía que la pantalla ignoraba el
      // filtro cuando lo que pasaba era que la consulta fallaba.
      toast.error(mensajeDeError(err, 'No se pudo cargar el listado de órdenes.'));
    } finally {
      setLoading(false);
    }
  }, [pagina, periodo.from, periodo.to]);

  // Cambiar de página o de período vuelve a pedir. El segmento y la búsqueda
  // NO: filtran lo que ya está cargado, así que escribir en el buscador no
  // dispara una consulta por tecla (US1 escenario 10, «sin recargar»).
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    // ⚠ El límite explícito no es de más. `GET /suppliers` pasó a paginar de a
    // 50 (T1215) y de acá sale el teléfono al que se le manda la orden por
    // WhatsApp: con 60 proveedores cargados, a los últimos 10 se les abría
    // WhatsApp **sin destinatario** y el aviso culpaba a un teléfono que sí
    // estaba cargado. El `.catch(() => {})` hacía que ni siquiera se notara.
    getSuppliers({ limit: LIMITE_DE_PROVEEDORES }).then(res => setSuppliers(res.data.data || [])).catch(() => {});
  }, []);

  // El segmento y la búsqueda, sobre la página cargada. Los contadores salen de
  // la MISMA función que arma la lista: si se contaran aparte, un contador que
  // dice 12 sobre una lista de 3 hace concluir que la pantalla se come filas.
  const visibles = useMemo(
    () => filtrarOrdenes(orders, { segmento, busqueda }),
    [orders, segmento, busqueda]
  );

  const contadores = useMemo(
    () => contadoresPorSegmento(orders, { busqueda }),
    [orders, busqueda]
  );

  const totalPaginas = Math.max(1, Math.ceil(total / FILAS_POR_PAGINA));

  // Con algo puesto, una lista vacía significa «el filtro no devolvió ninguna»
  // y no «todavía no hay órdenes» (FR-011). Son dos cosas distintas y el texto
  // que las confunde manda a cargar una orden que ya existe.
  const hayFiltro = busqueda.trim() !== '' || segmento !== 'todas' || !!periodo.from || !!periodo.to;

  /** Vuelve a la primera página: filtrar y quedarse en la 3 es una lista vacía. */
  const cambiarPeriodo = (cambio) => {
    setPeriodo((p) => ({ ...p, ...cambio }));
    setPagina(1);
  };

  const limpiarFiltros = () => {
    setBusqueda('');
    setSegmento('todas');
    setPeriodo({ from: '', to: '' });
    setPagina(1);
  };

  /**
   * Abre el panel con UNA orden, en el modo que se pida (T1238).
   *
   * ⚠ **Es el único camino de entrada al panel**, y por eso el clic en la fila y
   * el botón «Recibir» no pueden terminar en órdenes distintas. Antes eran dos:
   * el detalle pedía `GET /suppliers/orders/:id` y «Recibir» guardaba la fila
   * del listado. Esa fila NO trae `linea`, `costo_actual` ni `propone_costo`
   * —esos salen del detalle enriquecido de T1208—, así que la recepción se
   * cargaba a ciegas.
   *
   * El panel se abre ANTES de que llegue la respuesta, con su estado de carga:
   * abrirlo después deja un clic sin efecto visible y el usuario vuelve a
   * apretar.
   */
  const abrirOrden = async (id, modo = 'detalle') => {
    setOrdenAbierta(null);
    setModoDelPanel(modo);
    setPanelAbierto(true);
    setCargandoDetalle(true);

    try {
      const res = await getPurchaseOrder(id);
      setOrdenAbierta(res.data.data);
    } catch (err) {
      toast.error(mensajeDeError(err, `No se pudo abrir la orden #${id}.`));
      setPanelAbierto(false);
    } finally {
      setCargandoDetalle(false);
    }
  };

  const handleCancel = async (id) => {
    const ok = await confirm('¿Anular esta orden de compra?');
    if (!ok) return;

    try {
      await cancelPurchaseOrder(id);
      fetchOrders();
      setPanelAbierto(false);
    } catch (err) {
      // «La orden ya fue recibida completa» llega como 409 con su mensaje desde
      // T1205, y es el único que sabe de qué orden habla. Un `console.error`
      // dejaba al usuario apretando un botón que no hacía nada.
      toast.error(mensajeDeError(err, `No se pudo anular la orden #${id}.`));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Órdenes de compra"
        descripcion="Lo que le pediste a cada proveedor y en qué estado está. Al recibir una orden se actualiza el stock con lo que llegó de verdad, no con lo que se pidió."
      />

      {/* ── Los controles ── */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* El segmentado (FR-008). El patrón está COPIADO de
            `pages/Inventory.jsx:758-773` —`bg-surface-3 p-[3px]`, botones de
            28px— y no extraído a un componente: con dos usos, la interfaz del
            tercero es una adivinanza.

            Los cuatro salen de `SEGMENTOS` y no de cuatro botones escritos a
            mano, que es lo que hacía que la lista de estados estuviera escrita
            tres veces. «Todas» incluye las anuladas, que la tabla dibuja al
            55 %: esconderlas haría que anular una orden la hiciera desaparecer
            y el usuario no tendría cómo comprobar que la anuló. */}
        <div className="flex flex-wrap gap-[3px] rounded-lg bg-surface-3 p-[3px]">
          {SEGMENTOS.map(s => (
            <button
              key={s.clave}
              type="button"
              onClick={() => setSegmento(s.clave)}
              aria-pressed={segmento === s.clave}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-colors ${
                segmento === s.clave
                  ? 'bg-surface font-semibold text-foreground shadow-nivel-1'
                  : 'font-medium text-fg-2 hover:text-foreground'
              }`}
            >
              {s.etiqueta}
              <span className="num text-[11px] text-fg-3">{contadores[s.clave]}</span>
            </button>
          ))}
        </div>

        {/* La búsqueda entra por proveedor Y por número de orden (FR-009): el
            número es el dato que el proveedor menciona por teléfono, y sin él
            hay que recorrer la lista a ojo. */}
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-3" />
          <input
            aria-label="Buscar órdenes"
            placeholder="Buscar por proveedor o número de orden…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13.5px]
                       transition-colors focus-visible:border-brand focus-visible:outline-none"
          />
        </div>

        {/* El filtro de fechas: un botón de filtro de 36px con el período
            vigente adentro (FR-010). Los dos campos se despliegan en vez de
            ocupar lugar permanente: se tocan dos veces por día y el resto del
            tiempo lo único que hace falta saber es qué período se está
            mirando. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPeriodoAbierto(v => !v)}
            aria-expanded={periodoAbierto}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3
                       text-[13px] font-medium transition-colors hover:border-border-2 hover:bg-surface-3"
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-fg-3" />
            <span className={periodo.from || periodo.to ? 'num' : undefined}>
              {etiquetaDelPeriodo(periodo.from, periodo.to)}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-3" />
          </button>

          {periodoAbierto && (
            <div className="absolute right-0 z-20 mt-1.5 w-[248px] space-y-2.5 rounded-xl border border-border
                            bg-surface p-3 shadow-nivel-2">
              <CampoDeFecha etiqueta="Desde" valor={periodo.from} onChange={(v) => cambiarPeriodo({ from: v })} />
              <CampoDeFecha etiqueta="Hasta" valor={periodo.to} onChange={(v) => cambiarPeriodo({ to: v })} />

              <button
                type="button"
                onClick={() => { cambiarPeriodo({ from: '', to: '' }); setPeriodoAbierto(false); }}
                className="inline-flex h-8 w-full items-center justify-center rounded-lg border border-border
                           bg-surface text-[12.5px] font-medium transition-colors hover:bg-surface-3"
              >
                Todo el período
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── El listado ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
          <h2>Órdenes</h2>
          <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
            {total}
          </span>
          <div className="flex-1" />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
        </div>

        {loading && orders.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-fg-2">Cargando órdenes…</p>
          </div>
        ) : visibles.length === 0 ? (
          <EstadoVacio hayFiltro={hayFiltro} onLimpiar={limpiarFiltros} />
        ) : (
          <TablaGrid anchoMinimo={ANCHO_MINIMO}>
            <Encabezado columnas={COLUMNAS}>
              <span>Orden</span>
              <span>Proveedor</span>
              <span>Fecha</span>
              <span>Ítems</span>
              <span>Recepción</span>
              <span className="text-right">Total</span>
              <span className="text-right">Acciones</span>
            </Encabezado>

            {/* `visibles` y NO `orders`: la tabla tiene que dibujar exactamente
                lo que cuenta el segmento (FR-008, FR-009). Mapear `orders` acá
                dejaba el segmentado y la búsqueda dibujados y sin efecto —el
                contador bajaba a 1 y la lista seguía mostrando las cuatro—, que
                es peor que no tener filtro: el usuario concluye que el número
                miente. */}
            {visibles.map(o => {
              const recibido = porcentajeRecibido(o);
              // Una orden anulada sigue estando —anularla no la hace
              // desaparecer, o el usuario no tendría cómo comprobar que la
              // anuló— pero deja de competir por la atención (FR-006).
              const anulada = o.status === 'cancelled';

              return (
                <Fila
                  key={o.id}
                  columnas={COLUMNAS}
                  onClick={() => abrirOrden(o.id, 'detalle')}
                  className={anulada ? 'opacity-55' : undefined}
                >
                  <span className="num text-[13px] font-medium">#{o.id}</span>

                  <span className="truncate text-[13.5px] font-medium">
                    {o.supplier_name || 'Proveedor sin nombre'}
                  </span>

                  <span className="num text-[13px] text-fg-2">{fechaCorta(o.date)}</span>

                  <span className="num text-[13px] text-fg-2">{o.items?.length || 0}</span>

                  {/* Dos líneas: la etiqueta del estado y, debajo, cuánto de lo
                      pedido llegó (FR-005). El porcentaje es de UNIDADES y no de
                      importe —es lo único que el modelo guarda por línea—, y por
                      eso la etiqueta accesible lo dice. */}
                  <span className="flex flex-col gap-1.5">
                    <EtiquetaDeEstado status={o.status} />
                    <span
                      role="progressbar"
                      aria-valuenow={recibido}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Recibido: ${recibido}% de las unidades`}
                      className="block h-[4px] w-full overflow-hidden rounded-full bg-surface-3"
                    >
                      <span
                        className={`block h-full rounded-full ${BARRA_POR_TONO[ESTADOS[o.status]?.tono] || BARRA_POR_TONO.neutro}`}
                        style={{ width: `${recibido}%` }}
                      />
                    </span>
                  </span>

                  <span className="num text-right text-sm font-semibold">${pesos(o.total)}</span>

                  <span className="flex justify-end gap-0.5">
                    {/* `esRecibible` y `esAnulable` salen de la lista de estados
                        y no de un `status === 'pending' || status === 'partial'`
                        escrito acá: esa condición estaba en cinco lugares y cada
                        uno era una oportunidad de olvidarse de `partial`. Una
                        anulada no cumple ninguna de las dos, que es FR-006. */}
                    {/* ⚠ «Recibir» abre EL MISMO panel que la fila, en modo
                        recepción (T1238), y no un diálogo aparte. Es lo que hace
                        que la orden que se recibe sea, por construcción, la que
                        se abrió: los dos caminos pasan por `abrirOrden`. */}
                    {esRecibible(o) && (
                      <BotonDeFila
                        title="Recibir mercadería"
                        onClick={() => abrirOrden(o.id, 'recepcion')}
                      >
                        <Truck />
                      </BotonDeFila>
                    )}

                    {(esRecibible(o) || esAnulable(o)) && (
                      <MenuDeAcciones
                        acciones={[
                          {
                            etiqueta: 'Enviar por WhatsApp',
                            icono: <MessageCircle className="h-[15px] w-[15px] text-fg-3" />,
                            hacer: () => enviarOrdenPorWhatsapp(o, telefonoDe(o), false),
                          },
                          {
                            etiqueta: 'Enviar con precios',
                            icono: <MessageCircle className="h-[15px] w-[15px] text-fg-3" />,
                            hacer: () => enviarOrdenPorWhatsapp(o, telefonoDe(o), true),
                          },
                          ...(esAnulable(o)
                            ? [{
                              etiqueta: 'Anular orden',
                              icono: <XCircle className="h-[15px] w-[15px]" />,
                              destructiva: true,
                              hacer: () => handleCancel(o.id),
                            }]
                            : []),
                        ]}
                      />
                    )}
                  </span>
                </Fila>
              );
            })}
          </TablaGrid>
        )}

        {/* La paginación va DENTRO de la tarjeta y debajo de la tabla, y se
            dibuja aunque el filtro de la pantalla haya vaciado la lista: el
            componente se esconde solo cuando hay una página sola, y con dos o
            más la salida de una búsqueda sin resultados es cambiar de página.
            Es 1-indexado, igual que `pagina`. */}
        <Pagination page={pagina} totalPages={totalPaginas} onPageChange={setPagina} />
      </section>

      {/* ── El panel de la orden ──
          UN solo componente para el detalle y para la recepción, y el MISMO que
          usa `/proveedores` (FR-034). Reemplaza a los dos modales que había acá:
          el de detalle y el de recepción indexado por `product_id`.

          `ordenAbierta` es la única fuente de qué orden se está mirando, así que
          el `PUT` de la recepción no puede salir contra otra. */}
      <PanelOrdenDeCompra
        abierto={panelAbierto}
        onOpenChange={setPanelAbierto}
        orden={ordenAbierta}
        cargando={cargandoDetalle}
        modo={modoDelPanel}
        onCambiarModo={setModoDelPanel}
        telefonoDelProveedor={telefonoDe(ordenAbierta)}
        onAnular={(orden) => handleCancel(orden.id)}
        onRecibida={fetchOrders}
      />

      <ConfirmDialog />
    </div>
  );
};

export default PurchaseOrders;
