import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  getPurchaseOrders,
  getPurchaseOrder,
  cancelPurchaseOrder,
  createSupplierOrder,
  getSuppliers,
  getProducts,
} from '@/services/api';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid';
import Pagination from '@/components/Pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Plus,
} from 'lucide-react';
import {
  ESTADOS,
  SEGMENTOS,
  porcentajeRecibido,
  esRecibible,
  esAnulable,
} from '@/utils/ordenDeCompra';
// `fechaDeHoy` estaba escrita al pie de este archivo con un comentario que
// decía que su lugar era acá y que mudarla quedaba anotado. Es esa mudanza.
import { pesos, fechaCorta, fechaDeHoy } from '@/utils/formato';
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
//  ── Qué filtra el servidor: todo ──
//
//  ⚠⚠ **El segmento lo filtra el SERVIDOR.** Hasta la verificación adversarial
//  del hito 6 no: se mandaban solo `limit`, `offset`, `from` y `to`, y el
//  segmento se aplicaba con `filtrarOrdenes` sobre las 50 filas cargadas. Con
//  120 órdenes y 50 por página, elegir «Recibidas» daba contador 0 y lista
//  vacía **mientras el encabezado decía «Órdenes 120»** y la paginación seguía
//  ofreciendo «1 · 2 · 3»: `total` y `totalPaginas` salen del servidor y el
//  servidor no sabía nada del segmento. Es la segunda mitad de FR-022 —«el
//  total mostrado tiene que ser coherente con lo que se puede alcanzar»— y el
//  contrato ya ofrecía `status` desde T1212; la pantalla había dejado de usarlo.
//
//  El contador de cada segmento (FR-008) sale AHORA del `total` de una consulta
//  por segmento y no de contar el arreglo cargado. El motivo es el mismo: un
//  contador que cuenta la página dice «Recibidas 3» cuando hay 40, y con el
//  segmento del lado del servidor diría directamente 0 para los tres segmentos
//  que no están elegidos. Son tres consultas más con `limit: 1` y se piden solo
//  cuando cambia el período o la búsqueda —o cuando algo pudo moverlas—.
//
//  ⚠⚠ **Y la búsqueda también viaja**, desde que `GET /suppliers/orders` acepta
//  `q` (FR-009). Antes no: el endpoint aceptaba `supplier_id`, `status`, `from`,
//  `to`, `limit` y `offset`, y la búsqueda se aplicaba con `filtrarOrdenes`
//  sobre las 50 filas cargadas. Con más de una página eso era un **falso
//  negativo**: buscar «77» —una orden que existe, en la página 2— respondía
//  «ninguna orden coincide con el filtro» y la red ni se tocaba. Un aviso que
//  afirma algo que no es cierto hace cerrar la búsqueda y dar la orden por
//  perdida, que es el peor final posible para un buscador.
//
//  El parche anterior fue **decirlo** —un tercer estado vacío, «ninguna de esta
//  página», y una línea en el encabezado con sobre cuántas se estaba buscando—.
//  Era honesto y no hacía falta más que eso mientras la API no aceptara `q`;
//  ahora la acepta, y ese andamio **se sacó**: el `total` del encabezado, las
//  páginas, los contadores y las filas salen todos de la misma consulta, así que
//  no hay nada que aclarar. Dejarlo puesto sería una pantalla disculpándose por
//  algo que ya no pasa, que es como se enseña a ignorar los avisos.
//
//  La comparación es **sin acentos**, la misma de `GET /suppliers` (FR-059):
//  buscar «Norte» y «norté» da lo mismo en las dos pantallas porque las dos
//  preguntan lo mismo, no porque dos implementaciones coincidan.
//
//  Escribir NO dispara una consulta por tecla: hay un rebote de
//  `ESPERA_DE_BUSQUEDA`, igual que en `pages/Orders.jsx`.
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
 * Cuánto se espera después de la última tecla antes de preguntarle al servidor.
 *
 * La búsqueda la resuelve `GET /suppliers/orders?q=` (FR-009), así que sin
 * rebote escribir «Distribuidora» son trece consultas, y la respuesta que llega
 * última no tiene por qué ser la de la última tecla. Es el mismo número que
 * `pages/Orders.jsx`, que resuelve su buscador contra el mismo tipo de endpoint.
 */
const ESPERA_DE_BUSQUEDA = 250;

/**
 * Lo que dice el botón de fechas cuando está cerrado (FR-010).
 *
 * El período vigente va escrito ADENTRO del botón y no en un texto al lado: un
 * filtro puesto que no se ve es cómo alguien concluye que faltan órdenes. Sin
 * fechas dice «Todo el período», que es la única forma de que el botón afirme
 * algo cuando no filtra nada.
 */
/**
 * El `status` que le corresponde a un segmento del lado del servidor.
 *
 * Sale de `SEGMENTOS` y no de un `switch` escrito acá: la lista de estados
 * llegó a estar escrita tres veces en esta pantalla y cada copia se separó de
 * las otras (FR-107).
 *
 * «Todas» devuelve `null`, y eso es FR-020: «todos» es la **ausencia** del
 * parámetro, nunca un valor centinela. El día que un segmento agrupe dos
 * estados esta función devuelve `null` en vez de mandar el primero —mostrar de
 * más es recuperable; mostrar de menos se lee como «faltan órdenes»—.
 */
function estadoDelSegmento(clave) {
  const estados = SEGMENTOS.find((s) => s.clave === clave)?.estados;

  return estados?.length === 1 ? estados[0] : null;
}

/** Una línea vacía del alta de una orden. */
function lineaVacia() {
  return { product_id: '', product_name: '', quantity: 1, unit_price: '' };
}

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
 *
 * ⚠ **Hubo un tercero y se fue con este corte**, y conviene que quede escrito
 * para que nadie lo reponga. Decía «Ninguna orden de esta página coincide» y
 * existía porque `GET /suppliers/orders` no aceptaba `q`: la búsqueda miraba las
 * 50 filas cargadas, así que «ninguna coincide» era mentira cuando la orden
 * estaba en otra página. Desde que `q` viaja (FR-009), la lista vacía significa
 * lo que dice —el servidor no encontró ninguna— y aclarar sobre cuántas se buscó
 * sería una pantalla disculpándose por algo que ya no pasa.
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

  // Los tres filtros, y **los tres los resuelve el servidor**: el período, el
  // segmento y la búsqueda. Los dos campos del período van juntos en un objeto
  // porque se mandan juntos y se limpian juntos.
  const [periodo, setPeriodo] = useState({ from: '', to: '' });
  const [periodoAbierto, setPeriodoAbierto] = useState(false);
  const [segmento, setSegmento] = useState('todas');

  /**
   * Lo que se está tipeando, y lo que ya se le preguntó al servidor.
   *
   * Son DOS estados y no uno porque la búsqueda viaja con rebote: `busqueda` es
   * el campo —se dibuja tecla a tecla— y `filtro` es lo que sale por la red. Con
   * uno solo, cada tecla es una consulta.
   */
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('');

  /**
   * Cuántas órdenes tiene cada segmento en el período, según el SERVIDOR.
   *
   * Vacío mientras no se pudieron traer, y el botón dibuja «—» en vez de un
   * cero: «Recibidas 0» sobre una empresa que tiene cuarenta suena a dato y es
   * peor que no decir nada. Es la misma regla que `queSeLleva()` en
   * `pages/Orders.jsx`.
   */
  const [contadores, setContadores] = useState({});

  const [pagina, setPagina] = useState(1);

  // ── El alta de una orden (decisión 5 de la spec) ──
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [formAlta, setFormAlta] = useState({ supplier_id: '', date: fechaDeHoy(), notes: '' });
  const [lineasDelAlta, setLineasDelAlta] = useState([lineaVacia()]);
  const [productos, setProductos] = useState([]);
  // El candado del envío es estado y no `ref` porque además deshabilita el
  // botón: acá el `submit` de un formulario no puede dispararse dos veces en el
  // mismo tick como sí pasaba con los dos clics de la recepción.
  const [creando, setCreando] = useState(false);

  /**
   * Cuál fue el último detalle que se pidió.
   *
   * ⚠ Sin esto, un `GET /suppliers/orders/:id` en vuelo se apoderaba del panel:
   * abrir la A, cerrarla y abrir la B dejaba la B dibujada hasta que llegaba la
   * respuesta de la A —tarde— y el panel se rehacía como A. El daño es doble:
   * se pierde lo tipeado, porque el `useEffect` de reseteo del panel borra las
   * cantidades en el mismo commit, y se queda mirando una orden que nadie pidió.
   *
   * Es un contador y no un `AbortController` porque lo que hay que descartar es
   * la RESPUESTA vieja, no ahorrar la consulta: `services/api.js` no expone el
   * `signal` y agregárselo es tocar el cliente que usan todas las pantallas.
   */
  const pedidoDeDetalle = useRef(0);

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

      // ⚠ El segmento viaja. Filtrarlo acá sobre las 50 filas cargadas dejaba
      // `total` y `totalPaginas` hablando de otra cosa: «Recibidas» daba lista
      // vacía con el encabezado en «Órdenes 120» y tres botones de página
      // ofrecidos (FR-022).
      const estado = estadoDelSegmento(segmento);
      if (estado) params.status = estado;

      // ⚠ Y la búsqueda también (FR-009). Filtrarla acá sobre las 50 filas
      // cargadas era un falso negativo: buscar «77» sobre una orden que existe
      // en la página 2 respondía «ninguna coincide» sin tocar la red. Por
      // PRESENCIA, como todo lo demás: sin texto no viaja el parámetro.
      if (filtro) params.q = filtro;

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
  }, [pagina, periodo.from, periodo.to, segmento, filtro]);

  /**
   * Los cuatro contadores del segmentado (FR-008), contados por el servidor.
   *
   * ⚠ **No se cuentan sobre la página cargada.** Antes sí, y decía «Recibidas 3»
   * cuando había 40: contaba las que entraban en las 50 filas de la página que
   * se estaba mirando. Y desde que el segmento viaja al servidor sería peor
   * todavía —la página trae un solo estado, así que los otros tres darían 0—.
   *
   * Son cuatro consultas de `limit: 1`, que es lo mínimo que hace falta para
   * leer el `total`: el endpoint no devuelve un conteo por estado. No dependen
   * de la página ni del segmento, así que salen solo cuando cambia el período o
   * la búsqueda —o cuando algo las pudo mover: recibir, anular o crear—.
   *
   * ⚠ **La búsqueda entra en los cuatro.** Es la misma exigencia de FR-022 que
   * obligó a mandar el segmento: con «Norte» escrito, un contador que dijera
   * «Pendientes 62» sobre una lista de tres se lee como que la pantalla se come
   * filas. Los cuatro números y el badge de arriba tienen que contestar la misma
   * pregunta.
   */
  const fetchContadores = useCallback(async () => {
    const delPeriodo = {
      ...(periodo.from ? { from: periodo.from } : {}),
      ...(periodo.to ? { to: periodo.to } : {}),
      ...(filtro ? { q: filtro } : {}),
    };

    try {
      const respuestas = await Promise.all(
        SEGMENTOS.map((s) => {
          const estado = estadoDelSegmento(s.clave);

          return getPurchaseOrders({ limit: 1, ...delPeriodo, ...(estado ? { status: estado } : {}) });
        })
      );

      setContadores(
        Object.fromEntries(SEGMENTOS.map((s, i) => [s.clave, respuestas[i].data.total || 0]))
      );
    } catch {
      // El aviso lo da `fetchOrders`, que salió con los mismos filtros y falla
      // por lo mismo: dos toasts por una sola caída de red enseñan a cerrarlos
      // sin leerlos. Acá lo único que corresponde es no dejar un número inventado.
      setContadores({});
    }
  }, [periodo.from, periodo.to, filtro]);

  /** Todo lo que hay que volver a pedir cuando una orden cambió de estado. */
  const recargar = useCallback(() => {
    fetchOrders();
    fetchContadores();
  }, [fetchOrders, fetchContadores]);

  /**
   * El rebote del buscador: lo tipeado se convierte en filtro cuando la persona
   * frena (US1 escenario 10, «sin recargar» por tecla).
   *
   * Vuelve a la página 1 en el mismo paso. Buscar desde la página 3 y quedarse
   * en la 3 pide un `offset` de 100 sobre una lista de dos y devuelve cero
   * filas: se lee como «esa orden no existe», que es el mismo falso negativo que
   * esta corrección vino a cerrar, por otro camino.
   */
  useEffect(() => {
    // ⚠ Si lo tipeado ya es lo que se le preguntó al servidor no hay rebote que
    // esperar, y esa salida NO es una optimización: sin ella el montaje deja un
    // temporizador armado que 250 ms después escribe `setPagina(1)`. Apretar «2»
    // en ese cuarto de segundo devolvía la lista sola a la página 1, y lo que se
    // ve es una paginación que se ignora a sí misma cada tanto.
    if (busqueda.trim() === filtro) return undefined;

    const reloj = setTimeout(() => {
      setFiltro(busqueda.trim());
      setPagina(1);
    }, ESPERA_DE_BUSQUEDA);

    return () => clearTimeout(reloj);
  }, [busqueda, filtro]);

  // Cambiar de página, de período, de segmento o de búsqueda vuelve a pedir: los
  // cuatro filtros los resuelve el servidor, así que la lista dibujada es
  // exactamente lo que él devolvió.
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => { fetchContadores(); }, [fetchContadores]);

  useEffect(() => {
    // ⚠ El límite explícito no es de más. `GET /suppliers` pasó a paginar de a
    // 50 (T1215) y de acá sale el teléfono al que se le manda la orden por
    // WhatsApp: con 60 proveedores cargados, a los últimos 10 se les abría
    // WhatsApp **sin destinatario** y el aviso culpaba a un teléfono que sí
    // estaba cargado.
    //
    // ⚠⚠ Y el `.catch(() => {})` que había acá es lo que hacía que el aviso
    // acusara al dato equivocado: con un 403, un 500 o la red caída la lista de
    // proveedores quedaba vacía **en silencio**, `telefonoDe` devolvía `null`
    // para todos, y lo único que el usuario leía era «el proveedor no tiene
    // teléfono cargado» sobre proveedores que sí lo tienen. Los interceptores de
    // `services/api.js` no compensan: los cuatro caminos terminan en un
    // `Promise.reject` sin toast.
    getSuppliers({ limit: LIMITE_DE_PROVEEDORES })
      .then((res) => setSuppliers(res.data.data || []))
      .catch((err) => {
        toast.error(mensajeDeError(
          err,
          'No se pudo cargar la lista de proveedores: los envíos por WhatsApp pueden salir sin destinatario.'
        ));
      });
  }, []);

  const totalPaginas = Math.max(1, Math.ceil(total / FILAS_POR_PAGINA));

  // Con algo puesto, una lista vacía significa «el filtro no devolvió ninguna»
  // y no «todavía no hay órdenes» (FR-011). Son dos cosas distintas y el texto
  // que las confunde manda a cargar una orden que ya existe.
  //
  // Mira `busqueda` y no `filtro`: mientras corre el rebote hay texto escrito en
  // el campo, y el estado vacío no puede decir «todavía no hay órdenes» sobre
  // una búsqueda que la persona está viendo tipeada.
  const hayFiltro = busqueda.trim() !== '' || segmento !== 'todas' || !!periodo.from || !!periodo.to;

  /** Vuelve a la primera página: filtrar y quedarse en la 3 es una lista vacía. */
  const cambiarPeriodo = (cambio) => {
    setPeriodo((p) => ({ ...p, ...cambio }));
    setPagina(1);
  };

  /**
   * Cambiar de segmento vuelve a la página 1.
   *
   * No es cosmético desde que el segmento viaja: estar en la página 3 de
   * «Todas» y pasar a «Parciales» pediría el `offset` 100 de una lista de 4 y
   * devolvería cero filas, que se lee como «no hay parciales».
   */
  const cambiarSegmento = (clave) => {
    setSegmento(clave);
    setPagina(1);
  };

  const limpiarFiltros = () => {
    setBusqueda('');
    // ⚠ El filtro se limpia **junto con el campo** y no esperando el rebote. Con
    // solo `setBusqueda('')`, el botón deja la lista filtrada un cuarto de
    // segundo más: se aprieta «Limpiar filtros», no pasa nada visible, y se
    // aprieta de nuevo. Y de paso ahorra la consulta intermedia con el filtro
    // viejo, que es una respuesta que nadie va a mirar.
    setFiltro('');
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
    // El número de ESTE pedido. Todo lo que llegue después de que el contador
    // haya avanzado es una respuesta de una orden que ya no está abierta.
    const miPedido = ++pedidoDeDetalle.current;

    setOrdenAbierta(null);
    setModoDelPanel(modo);
    setPanelAbierto(true);
    setCargandoDetalle(true);

    try {
      const res = await getPurchaseOrder(id);

      // ⚠ Sin esta comparación, abrir la A, cerrarla y abrir la B dejaba el
      // panel dibujando la B hasta que llegaba la A —tarde— y se rehacía como A,
      // con las cantidades tipeadas borradas por el reseteo del panel.
      if (pedidoDeDetalle.current !== miPedido) return;

      setOrdenAbierta(res.data.data);
    } catch (err) {
      // El error de una orden que ya no está abierta tampoco se muestra: el
      // usuario leería «No se pudo abrir la orden #601» mirando la #602.
      if (pedidoDeDetalle.current !== miPedido) return;

      toast.error(mensajeDeError(err, `No se pudo abrir la orden #${id}.`));
      setPanelAbierto(false);
    } finally {
      if (pedidoDeDetalle.current === miPedido) setCargandoDetalle(false);
    }
  };

  /**
   * Abrir y cerrar el panel.
   *
   * Cerrar INVALIDA el detalle en vuelo: si no, la respuesta de la orden que se
   * acaba de cerrar llega después y vuelve a llenar `ordenAbierta`, que es el
   * estado con el que se reabre el panel la próxima vez.
   */
  const cambiarPanel = (abierto) => {
    if (!abierto) pedidoDeDetalle.current += 1;
    setPanelAbierto(abierto);
  };

  const handleCancel = async (id) => {
    // ⚠ Dice el número y qué NO se deshace ([PENDIENTE 9]). «¿Anular esta orden
    // de compra?» no alcanza por dos motivos: se puede llegar acá desde el menú
    // de una fila cualquiera —así que «esta» no identifica nada— y anular una
    // orden a medias **deja viva la deuda de lo ya recibido**, porque la
    // mercadería llegó y se debe. Es la misma frase que `pages/Orders.jsx`, para
    // que las dos pantallas no expliquen lo mismo de dos maneras.
    const ok = await confirm(`¿Anular la orden #${id}? Lo que ya se recibió sigue debiéndose.`, {
      verbo: 'Anular orden',
    });
    if (!ok) return;

    try {
      await cancelPurchaseOrder(id);
      recargar();
      setPanelAbierto(false);
    } catch (err) {
      // «La orden ya fue recibida completa» llega como 409 con su mensaje desde
      // T1205, y es el único que sabe de qué orden habla. Un `console.error`
      // dejaba al usuario apretando un botón que no hacía nada.
      toast.error(mensajeDeError(err, `No se pudo anular la orden #${id}.`));
    }
  };

  /**
   * Crea una orden desde esta pantalla (decisión 5 de la spec, US1 escenario 1).
   *
   * ⚠ El botón «Nueva orden» que dibuja la maqueta (`:640`) **no existía**: la
   * spec lo resolvió a favor de la maqueta —«es la ubicación natural: crear una
   * orden de compra en la pantalla de órdenes de compra»— y se perdió entre la
   * spec y el plan, que no lo tiene en ninguna de las 54 tareas. Hasta acá,
   * `createSupplierOrder` se llamaba desde UN solo lugar de todo `apps/web`: el
   * modal de `/proveedores`. Quien entraba a `/ordenes-compra` a cargar un
   * pedido tenía que descubrir que se hacía en otra pantalla.
   *
   * El proveedor es obligatorio y sale del desplegable: la orden se crea contra
   * `POST /suppliers/:id/orders`, así que sin él no hay a dónde mandarla.
   */
  const crearOrden = async (e) => {
    e.preventDefault();
    if (creando) return;

    const proveedor = Number(formAlta.supplier_id);
    if (!Number.isInteger(proveedor) || proveedor <= 0) {
      toast.error('Elegí a qué proveedor le estás pidiendo la mercadería.');
      return;
    }

    // Una línea sin nombre o sin cantidad no es una línea: mandarla escribe un
    // `detail` con un ítem que después nadie puede recibir.
    const lineas = lineasDelAlta.filter((l) => l.product_name && parseFloat(l.quantity) > 0);
    if (lineas.length === 0) {
      toast.error('Agregá al menos un producto con cantidad.');
      return;
    }

    setCreando(true);

    try {
      await createSupplierOrder(proveedor, {
        date: formAlta.date,
        notes: formAlta.notes,
        items: lineas.map((l) => ({
          product_id: l.product_id ? parseInt(l.product_id, 10) : null,
          product_name: l.product_name,
          quantity: parseFloat(l.quantity),
          // El total lo calcula el servidor a partir de las líneas: acá no se
          // manda ningún total, igual que en una venta.
          unit_price: parseFloat(l.unit_price) || 0,
        })),
      });

      setAltaAbierta(false);
      setFormAlta({ supplier_id: '', date: fechaDeHoy(), notes: '' });
      setLineasDelAlta([lineaVacia()]);
      recargar();
      toast.success('Orden de compra registrada.');
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo registrar la orden de compra.'));
    } finally {
      setCreando(false);
    }
  };

  /** Abre el alta y, recién ahí, pide el catálogo que completa los nombres. */
  const abrirAlta = async () => {
    setAltaAbierta(true);

    try {
      const res = await getProducts({ limit: 500 });
      setProductos(res.data.data || []);
    } catch (err) {
      // El catálogo solo sugiere el nombre y el costo: sin él la orden se puede
      // escribir igual, así que esto avisa y no interrumpe.
      toast.error(mensajeDeError(err, 'No se pudo cargar el catálogo para sugerir productos.'));
    }
  };

  const cambiarLinea = (indice, campo, valor) => {
    setLineasDelAlta((previas) => {
      const copia = previas.map((l, i) => (i === indice ? { ...l, [campo]: valor } : l));

      if (campo === 'product_name') {
        // El costo cargado se propone como precio unitario: es el número que el
        // usuario ya tenía y el que más veces es el correcto.
        const producto = productos.find((p) => p.name === valor);
        if (producto) {
          copia[indice].product_id = producto.id;
          copia[indice].unit_price = producto.cost || '';
        }
      }

      return copia;
    });
  };

  const totalDelAlta = lineasDelAlta.reduce(
    (suma, l) => suma + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* ⚠ El botón principal va como `children`: `PageHeader` dibuja la zona de
          acciones **solo si los hay** (`PageHeader.jsx:27`), así que montarlo sin
          nada dejaba la pantalla sin su acción principal y sin ninguna señal de
          que faltara. La regla del sistema es un botón principal por pantalla y
          éste es el de ésta (decisión 5, maqueta `:640`). */}
      <PageHeader
        titulo="Órdenes de compra"
        descripcion="Lo que le pediste a cada proveedor y en qué estado está. Al recibir una orden se actualiza el stock con lo que llegó de verdad, no con lo que se pidió."
      >
        <button
          type="button"
          onClick={abrirAlta}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[13px]
                     font-semibold text-white shadow-nivel-1 transition-colors hover:bg-brand-dark"
        >
          <Plus className="h-4 w-4" />
          Nueva orden
        </button>
      </PageHeader>

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
              onClick={() => cambiarSegmento(s.clave)}
              aria-pressed={segmento === s.clave}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-colors ${
                segmento === s.clave
                  ? 'bg-surface font-semibold text-foreground shadow-nivel-1'
                  : 'font-medium text-fg-2 hover:text-foreground'
              }`}
            >
              {s.etiqueta}
              {/* «—» y no 0 mientras no se sepa: un cero inventado sobre una
                  empresa que tiene cuarenta recibidas suena a dato. */}
              <span className="num text-[11px] text-fg-3">{contadores[s.clave] ?? '—'}</span>
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
          {/* El `total` del servidor, que ahora es el del segmento **y el de la
              búsqueda**: es el mismo número del que sale `totalPaginas`, así que
              el badge y los botones de página no pueden contradecirse.

              ⚠ Acá había además una línea que decía «N coinciden con «77», sobre
              las 4 de esta página». Era el andamio del parche anterior —la
              búsqueda miraba la página cargada y había que aclarar sobre cuántas
              buscaba—. Con `q` del lado del servidor este número YA es cuántas
              coinciden, y repetirlo al lado sería decir dos veces lo mismo. */}
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
        ) : orders.length === 0 ? (
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

            {/* `orders` tal cual, sin volver a filtrar acá. El segmento, el
                período y la búsqueda ya los aplicó el servidor, y `total` cuenta
                exactamente estas filas (FR-008, FR-009, FR-022).

                ⚠ Volver a filtrar en el navegador —aunque sea «por las dudas»—
                haría que sacar `status` o `q` de la consulta no cambiara el
                dibujo, y el defecto podría volver sin que ningún test se pusiera
                en rojo. Es exactamente cómo llegó hasta acá. */}
            {orders.map(o => {
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

        {/* La paginación va DENTRO de la tarjeta y debajo de la tabla. Sus
            páginas salen de `totalPaginas`, y ese número sale del `total` de la
            MISMA consulta que trajo las filas: con la búsqueda y el segmento del
            lado del servidor, no puede volver a ofrecer una página 3 de una
            lista que ya no tiene tres. El componente se esconde solo cuando hay
            una página sola. Es 1-indexado, igual que `pagina`. */}
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
        onOpenChange={cambiarPanel}
        orden={ordenAbierta}
        cargando={cargandoDetalle}
        modo={modoDelPanel}
        onCambiarModo={setModoDelPanel}
        telefonoDelProveedor={telefonoDe(ordenAbierta)}
        onAnular={(orden) => handleCancel(orden.id)}
        onRecibida={recargar}
      />

      {/* ── Nueva orden de compra (decisión 5) ──
          El mismo formulario que `/proveedores` más el desplegable de proveedor,
          que allá no hace falta porque la pantalla ya tiene uno elegido. */}
      <Dialog open={altaAbierta} onOpenChange={setAltaAbierta}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Nueva orden de compra</DialogTitle></DialogHeader>
          <form onSubmit={crearOrden} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="alta-proveedor">Proveedor</Label>
                {/* Un `<select>` nativo, igual que el método de pago y el
                    selector de sucursal del panel: ya se opera con teclado y no
                    arrastra el desplegable de shadcn por una lista corta.

                    La opción vacía dice «Elegí un proveedor» y no está como
                    valor válido: es el placeholder, y el envío la rechaza. */}
                <select
                  id="alta-proveedor"
                  className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px]
                             transition-colors focus-visible:border-brand focus-visible:outline-none"
                  value={formAlta.supplier_id}
                  onChange={(e) => setFormAlta({ ...formAlta, supplier_id: e.target.value })}
                >
                  <option value="">Elegí un proveedor</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="alta-fecha">Fecha</Label>
                <Input
                  id="alta-fecha"
                  type="date"
                  className="num"
                  value={formAlta.date}
                  onChange={(e) => setFormAlta({ ...formAlta, date: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Productos</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLineasDelAlta((previas) => [...previas, lineaVacia()])}
                >
                  <Plus className="mr-1 h-3 w-3" /> Agregar
                </Button>
              </div>

              <div className="max-h-60 space-y-2 overflow-y-auto">
                {lineasDelAlta.map((linea, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder="Nombre del producto"
                        aria-label={`Producto de la línea ${i + 1}`}
                        value={linea.product_name}
                        onChange={(e) => cambiarLinea(i, 'product_name', e.target.value)}
                        list={`catalogo-de-orden-${i}`}
                      />
                      <datalist id={`catalogo-de-orden-${i}`}>
                        {productos.map((p) => (
                          <option key={p.id} value={p.name} />
                        ))}
                      </datalist>
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        className="num text-right"
                        placeholder="Cant."
                        aria-label={`Cantidad de la línea ${i + 1}`}
                        value={linea.quantity}
                        onChange={(e) => cambiarLinea(i, 'quantity', e.target.value)}
                      />
                    </div>
                    <div className="w-24">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="num text-right"
                        placeholder="P/U"
                        aria-label={`Precio unitario de la línea ${i + 1}`}
                        value={linea.unit_price}
                        onChange={(e) => cambiarLinea(i, 'unit_price', e.target.value)}
                      />
                    </div>
                    {lineasDelAlta.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-danger"
                        title={`Quitar la línea ${i + 1}`}
                        onClick={() => setLineasDelAlta((previas) => previas.filter((_, j) => j !== i))}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[13px] text-fg-2">
                {lineasDelAlta.filter((l) => l.product_name).length} productos
              </span>
              {/* El total es orientativo y lo dice el pie: el que queda guardado
                  lo calcula el servidor con las líneas, igual que en una venta. */}
              <span className="num text-[19px] font-semibold">Total ${pesos(totalDelAlta)}</span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="alta-notas">Notas</Label>
              <Input
                id="alta-notas"
                value={formAlta.notes}
                onChange={(e) => setFormAlta({ ...formAlta, notes: e.target.value })}
                placeholder="Ej: pedido mensual"
              />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setAltaAbierta(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" type="submit" disabled={creando}>
                {creando ? 'Registrando…' : 'Registrar orden'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  );
};

export default PurchaseOrders;
