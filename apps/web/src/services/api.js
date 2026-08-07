// ════════════════════════════════════════════
//  ADMINAPP · API Service
//  Centraliza todas las llamadas al backend
// ════════════════════════════════════════════

import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// El free tier de Render duerme el servicio a los 15 min de inactividad, y el
// primer request despues de eso tarda ~50s en levantarlo (cold start). Con un
// timeout de 15s el usuario veia un error donde en realidad solo habia que
// esperar. 60s cubre el cold start; se puede bajar cuando haya plan pago.
const API_TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT) || 60000;

// Instancia de Axios con configuración base
const api = axios.create({
  baseURL: API_BASE,
  timeout: API_TIMEOUT,
});

// ════════════════════════════════════════════
//  El identificador de ESTE navegador (`X-Sesion-Id`)
//
//  ── Qué es, y por qué no es el token ──
//
//  Un UUID v4 que se genera una vez y vive en `localStorage`. Identifica al
//  **dispositivo**, no a la sesión de Auth0: el access token se rota cada pocas
//  horas, así que usar su hash abriría una fila nueva por rotación, la pantalla
//  de Equipo mostraría siete filas del mismo navegador y cerrar una no serviría
//  —la rotación siguiente vuelve a entrar—.
//
//  ── ⚠ Por qué vive ACÁ y no en `sesion/ProveedorDeSesion.jsx` ──
//
//  El plan lo ubicaba allá. No puede ir allá: `vite.config.js` **reemplaza ese
//  archivo entero** por `pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx`
//  cuando `command === 'serve'`, y esa sesión falsa sí manda `Authorization`. O
//  sea que las pruebas de navegador quedarían mandando token **sin**
//  `X-Sesion-Id`, que es exactamente el caso que la API responde con 401
//  `SESION_REQUERIDA`.
//
//  Acá, en cambio, pasa por el mismo lugar por el que pasan **todos** los
//  requests de la aplicación, en cualquier entorno, y no hay ninguna
//  configuración que lo saque del grafo.
//
//  ── El techo, escrito ──
//
//  Esto no autentica nada: quien tenga el token puede mandar un UUID inventado y
//  entrar igual. Cierra al navegador que **coopera**, que es el caso real —la
//  notebook que quedó abierta en el local—. El corte de verdad es desactivar al
//  miembro, que la API aplica en el request siguiente.
// ════════════════════════════════════════════

const CLAVE_DE_DISPOSITIVO = 'adminapp.dispositivo';

/** Un UUID v4. `crypto.randomUUID` no existe fuera de contextos seguros. */
function nuevoIdentificador() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * En memoria además de en `localStorage`.
 *
 * ⚠ No es una optimización: en modo incógnito —o con las cookies de terceros
 * bloqueadas— `localStorage` **tira** al leer y al escribir. Sin esta variable,
 * cada request generaría un UUID nuevo, y la pantalla de Equipo mostraría una
 * fila por request en vez de una por navegador.
 */
let dispositivoEnMemoria = null;

/** El identificador de este navegador, generándolo la primera vez. */
export function identificadorDeDispositivo() {
  if (dispositivoEnMemoria) return dispositivoEnMemoria;

  try {
    dispositivoEnMemoria = localStorage.getItem(CLAVE_DE_DISPOSITIVO) || null;
  } catch {
    // Sin `localStorage` la sesión dura lo que dure la pestaña, y eso es
    // preferible a no mandar la cabecera: mandarla es lo que hace que la sesión
    // aparezca en la lista y se pueda cerrar.
    dispositivoEnMemoria = null;
  }

  if (!dispositivoEnMemoria) {
    dispositivoEnMemoria = nuevoIdentificador();

    try {
      localStorage.setItem(CLAVE_DE_DISPOSITIVO, dispositivoEnMemoria);
    } catch {
      // Ídem.
    }
  }

  return dispositivoEnMemoria;
}

/**
 * Olvida el identificador para que el próximo ingreso sea una sesión nueva.
 *
 * Se llama **solo** con `SESION_CERRADA`. Con cualquier otro 401 —un token
 * vencido, que pasa cada vez que alguien deja una pestaña abierta— borrarlo
 * abriría una sesión nueva por cada expiración y la lista mostraría siete filas
 * del mismo navegador, que es justamente el defecto que este diseño evita.
 */
export function olvidarDispositivo() {
  dispositivoEnMemoria = null;

  try {
    localStorage.removeItem(CLAVE_DE_DISPOSITIVO);
  } catch {
    // Si no se puede escribir tampoco se pudo haber guardado.
  }
}

let currentEmpresaId = null;
let currentPuntoDeVentaId = null;

export function setEmpresaContext(empresaId, puntoDeVentaId) {
  currentEmpresaId = empresaId;
  currentPuntoDeVentaId = puntoDeVentaId;
}

let onUnauthorizedCallback = null;

export function setOnUnauthorized(callback) {
  onUnauthorizedCallback = callback;
}

let onSubscriptionExpiredCallback = null;

/** Se dispara cuando la API responde 402: la suscripcion vencio. */
export function setOnSubscriptionExpired(callback) {
  onSubscriptionExpiredCallback = callback;
}

// ── Response interceptor: captura 401 y redirige al login ──
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.config?.skipUnauthorized) {
      return Promise.reject(error);
    }
    if (error.response?.status === 401) {
      // ⚠ Solo con SESION_CERRADA se olvida el identificador, y la distinción es
      // la mitad del diseño: un 401 cualquiera —un token vencido, que pasa cada
      // vez que alguien deja una pestaña abierta— borraría el UUID y abriría una
      // sesión nueva en cada expiración. La pantalla de Equipo mostraría siete
      // filas del mismo navegador y cerrar una no serviría de nada.
      //
      // Con SESION_CERRADA sí hay que olvidarlo: si volviera con el mismo, el
      // próximo ingreso chocaría contra la fila cerrada y nadie podría volver a
      // entrar desde esta computadora nunca más.
      if (error.response?.data?.error === 'SESION_CERRADA') {
        olvidarDispositivo();
      }

      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
    }
    // 402 = suscripcion vencida. Sin este manejo, cada pantalla mostraba su
    // propio error generico y el usuario veia la aplicacion rota en vez de un
    // aviso de que tiene que renovar.
    if (error.response?.status === 402) {
      const data = error.response.data || {};
      if (onSubscriptionExpiredCallback) {
        onSubscriptionExpiredCallback(data.message || 'Tu suscripción venció.');
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 403) {
      const msg = error.response?.data?.message || 'No tienes permiso para realizar esta acción';
      console.warn('[api] 403 Forbidden:', msg);
    }

    // ── Codigo de error visible ──
    //
    // La API ahora devuelve un requestId en cada 500 y lo repite en cada linea
    // de log de ese request. Sirve para algo solo si el usuario lo ve: sin el,
    // un reporte es "me dio error a las tres" y hay que buscar a ciegas.
    //
    // Se agrega aca, en el interceptor, y no pantalla por pantalla: todas
    // muestran `err.response.data.error`, asi que alcanza con completar ese
    // texto en un solo lugar. Se usan los primeros 8 caracteres porque es lo
    // que alguien puede dictar por telefono sin equivocarse, y siguen siendo
    // suficientes para encontrar la linea.
    const requestId = error.response?.data?.requestId || error.response?.headers?.['x-request-id'];

    if (requestId) {
      error.requestId = requestId;

      if (error.response?.status >= 500 && error.response.data?.error) {
        const codigo = String(requestId).slice(0, 8);
        error.response.data.error = `${error.response.data.error} (código: ${codigo})`;
        console.error('[api] error del servidor. requestId:', requestId);
      }
    }

    return Promise.reject(error);
  }
);

// ── Request interceptor: inyecta el token de Auth0 en cada request ──
let authInterceptorId = null;

export function setAuthToken(getAccessTokenSilently, getAccessTokenWithPopup) {
  if (authInterceptorId !== null) {
    api.interceptors.request.eject(authInterceptorId);
  }

  authInterceptorId = api.interceptors.request.use(async (config) => {
    try {
      const token = await Promise.race([
        getAccessTokenSilently(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Token timeout')), 10000)),
      ]);
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    } catch (err) {
      if (getAccessTokenWithPopup) {
        try {
          const token = await getAccessTokenWithPopup();
          config.headers.Authorization = `Bearer ${token}`;
          return config;
        } catch (popupErr) {
          return Promise.reject(popupErr);
        }
      }
      return Promise.reject(err);
    }
  });
}

api.interceptors.request.use((config) => {
  if (currentEmpresaId) {
    config.headers['X-Empresa-Id'] = currentEmpresaId;
  }
  if (currentPuntoDeVentaId) {
    config.headers['X-Punto-De-Venta-Id'] = currentPuntoDeVentaId;
  }
  // Sin `if`: las otras dos son opcionales —hay pantallas que se dibujan antes
  // de que haya empresa elegida— y ésta no. La API responde 401
  // `SESION_REQUERIDA` a un request con token y sin esta cabecera, así que
  // mandarla «cuando ya se conoce» dejaría afuera justo a los primeros requests
  // del arranque, que son los que traen el contexto.
  config.headers['X-Sesion-Id'] = identificadorDeDispositivo();

  return config;
});

// ═══════ PRODUCTOS ═══════

export const getProducts = (params) => api.get('/products', { params });
export const getProduct = (id) => api.get(`/products/${id}`);
export const createProduct = (data) => api.post('/products', data);
export const updateProduct = (id, data) => api.put(`/products/${id}`, data);
export const deleteProduct = (id) => api.delete(`/products/${id}`);
export const bulkProducts = (products) => api.post('/products/bulk', { products });

// ═══════ VENTAS ═══════

/**
 * Historial de ventas: rango, sucursal, tipo, busqueda y paginado.
 *
 * ⚠ EL LISTADO YA NO TRAE `items`. Ninguna de las siete columnas los muestra,
 * y ese include obligaba a Sequelize a armar una subconsulta por pagina para
 * no mostrar nada. Los items salen de `getSale(id)`, que es el detalle del
 * panel lateral. Un `sale.items.map()` sobre esta respuesta no falla en el
 * build: tira recien en runtime, con la pantalla abierta.
 *
 * Los parametros van como objeto y no posicionales: son siete
 * (`desde`, `hasta`, `punto_de_venta_id`, `tipo`, `q`, `page`, `limit`) y con
 * posicionales habria que pasar `undefined` en el medio para llegar al ultimo.
 */
export const getSales = (params) => api.get('/sales', { params });
export const getSale = (id) => api.get(`/sales/${id}`);
/** Todo el resultado del filtro, sin paginar, con las diez columnas del
 *  archivo ya armadas. El `.xlsx` lo construye el navegador. */
export const exportSales = (params) => api.get('/sales/export', { params });
export const getSalesSummary = (from, to) => api.get('/sales/summary', { params: { from, to } });
export const createSale = (data) => api.post('/sales', data);
export const voidSale = (id) => api.put(`/sales/${id}/void`);

/**
 * El identificador de una venta, que lo genera el navegador.
 *
 * `Sale.id` es la clave primaria y es `STRING(40)`: lo arma el cliente y la base
 * lo hace unico. De ahi salen las dos reglas de este formato.
 *
 * **La marca de tiempo va adelante** porque los ids se ordenan como texto: con
 * ella primero, un `SELECT * FROM sales ORDER BY id` crudo sale en orden
 * cronologico y se puede leer. Con el azar adelante, ese mismo listado queda
 * desordenado, y en un incidente eso es lo unico que hay a mano.
 *
 * **Los 8 hexadecimales del final son la parte que faltaba.** Con
 * `sale_${Date.now()}` a secas, dos cajas que cobran en el mismo milisegundo
 * generan EL MISMO id. Hoy eso choca contra la clave primaria y produce un error
 * visible; con `POST /api/sales` idempotente pasaria a ser una venta que
 * desaparece en silencio —la segunda caja recibiria los datos de la venta de la
 * primera, imprimiria un comprobante ajeno y no registraria nada—. Por eso la
 * entropia va en el mismo cambio que la idempotencia y nunca despues.
 *
 * **No es `crypto.randomUUID()` a secas** porque son 36 caracteres y con el
 * prefijo `sale_` no entra en los 40 de la columna. `slice(0, 8)` toma el primer
 * bloque del UUID y deja el id en 27 caracteres.
 */
export const nuevoIdDeVenta = () => `sale_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

// ═══════ STOCK ═══════

export const getStock = (location) => api.get('/stock', { params: { location } });
export const updateStock = (id, data) => api.put(`/stock/${id}`, data);
export const bulkStock = (items, location) => api.post('/stock/bulk', { items, location });

/**
 * Las sucursales de la empresa, INCLUIDAS las inactivas.
 *
 * Es lo que define cuantas columnas de stock tiene la tabla y que ofrecen los
 * selectores de la transferencia. Los otros dos endpoints que listan puntos de
 * venta —`/empresas/mi-contexto` y `/empresas/:id/puntos-de-venta`— filtran por
 * `is_active`, y el segundo ademas pide el permiso `sucursales.ver`. Cerrar un
 * local no evapora su mercaderia: ese stock es justamente el que hay que poder
 * transferir a otro lado.
 */
export const getSucursalesDeStock = () => api.get('/stock/sucursales');

// ═══════ MARCAS ═══════

export const getBrands = () => api.get('/brands');
export const createBrand = (data) => api.post('/brands', data);

// ═══════ GASTOS FIJOS ═══════

/**
 * Los gastos fijos de la empresa, con sus totales ya sumados por el servidor.
 *
 * Devuelve `{ data, totales: { general, sin_sucursal, por_sucursal }, alcance }`.
 * La pantalla NO suma nada: `amount` es un DECIMAL que vuelve como string y
 * acumular `parseFloat` deja residuo en el número del que cuelga el punto de
 * equilibrio (FR-026, FR-027).
 *
 * ⚠ **Ya no recibe `group`.** Aceptaba `?group=gf1` y el servidor dejó de
 * aceptarlo: la columna es el resto de la migración del legacy —«gf1» es
 * «Ortiz de Ocampo» en Comprafit y nada en cualquier otra empresa— y el
 * agrupado sale de `punto_de_venta_id`.
 */
export const getExpenses = () => api.get('/expenses');
export const createExpense = (data) => api.post('/expenses', data);
export const updateExpense = (id, data) => api.put(`/expenses/${id}`, data);
export const deleteExpense = (id) => api.delete(`/expenses/${id}`);

// ═══════ GASTOS VARIABLES ═══════

export const getGastosVariables = (mes) => api.get('/gastos-variables', { params: { mes } });
export const createGastoVariable = (data) => api.post('/gastos-variables', data);
export const deleteGastoVariable = (id) => api.delete(`/gastos-variables/${id}`);

// ═══════ PROVEEDORES ═══════

// ⚠ `GET /suppliers` pasó a paginar de a 50 (hito 012, T1215) y a devolver el
// saldo ya calculado en vez del arreglo de movimientos. Los dos llamadores que
// la usan para llenar una lista completa —`Orders.jsx` y el desplegable de
// proveedores del filtro de `PurchaseOrders.jsx`— tienen que pedir un límite
// explícito: sin él, una empresa con 60 proveedores perdía 10 opciones del
// filtro **sin que nada avisara**.
export const getSuppliers = (params) => api.get('/suppliers', { params });
export const getSupplier = (id) => api.get(`/suppliers/${id}`);
// El historial de cuenta, paginado y con el saldo acumulado ya calculado. Antes
// venía adentro de `GET /suppliers/:id` sin paginar.
export const getSupplierMovements = (id, params) => api.get(`/suppliers/${id}/movimientos`, { params });

// Las filas del archivo del contador (T1247, US8). **El servidor arma las filas
// y el navegador arma la hoja** (FR-097): esto devuelve JSON, no un archivo, y
// el `.xlsx` lo escribe `utils/exportarProveedores.js` desde la pantalla.
//
// ⚠ Los dos extremos del rango viajan por PRESENCIA y no como cadena vacía. Es
// la misma regla que cerró el `?supplier_id=%20` del listado de órdenes: el
// endpoint valida la forma `AAAA-MM-DD` de lo que le llegue, así que un
// `desde=` vacío sería un filtro que hay que descartar del otro lado en vez de
// no mandarlo. Y con `params: { desde: '', hasta: '' }` axios los serializa
// igual: la ausencia se construye acá.
export const exportarCuenta = (id, { desde, hasta } = {}) => api.get(
  `/suppliers/${id}/movimientos/export`,
  { params: { ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) } }
);
export const createSupplier = (data) => api.post('/suppliers', data);
export const deleteSupplier = (id) => api.delete(`/suppliers/${id}`);
export const createSupplierOrder = (id, data) => api.post(`/suppliers/${id}/orders`, data);
export const createSupplierPayment = (id, data) => api.post(`/suppliers/${id}/payments`, data);
export const updateMovement = (id, data) => api.put(`/suppliers/movements/${id}`, data);
export const deleteMovement = (id) => api.delete(`/suppliers/movements/${id}`);
export const createSupplierDocument = (id, data) => api.post(`/suppliers/${id}/documents`, data);
export const deleteDocument = (id) => api.delete(`/suppliers/documents/${id}`);
export const updateSupplier = (id, data) => api.put(`/suppliers/${id}`, data);
export const getPurchaseOrders = (params) => api.get('/suppliers/orders', { params });
export const getPurchaseOrder = (id) => api.get(`/suppliers/orders/${id}`);
// `location` se fue del cuerpo (FR-104). Su único valor era el literal
// 'general', que en una empresa cuyos códigos de sucursal son otros no coincide
// con ninguna: desde que existe `resolverSucursal`, mandarlo no ubicaba nada y
// solo hacía creer que la pantalla elegía el depósito. Los `items` van por
// LÍNEA —`{ linea, cantidad, actualizar_costo }`— y no por producto: dos líneas
// del mismo producto son dos líneas (FR-031).
//
// `punto_de_venta_id` es OPCIONAL y solo lo manda la pantalla cuando la empresa
// tiene más de una sucursal (FR-103). Ausente, el servidor cae a la cabecera
// `X-Punto-De-Venta-Id` y después a la sucursal por defecto, que es el camino de
// siempre: con una sola sucursal no hay nada que elegir y mandar el id «por las
// dudas» solo agrega una forma más de equivocarse.
//
// ⚠ El id se manda solo si es un NÚMERO positivo, y ese filtro no es adorno: el
// tercer argumento de esta función fue durante meses el `location` viejo, un
// literal `'general'`. Sin el filtro, ese texto viajaría como
// `punto_de_venta_id` y `resolverSucursal` respondería «Punto de venta
// inválido» sin escribir nada — un 400 que no tiene nada que ver con la causa y
// que manda a revisar las sucursales de la empresa, que están bien. El `value`
// de un `<option>` también es un string, así que la conversión es la misma para
// los dos casos.
export const receivePurchaseOrder = (id, items, puntoDeVentaId = null) => {
  const sucursal = Number(puntoDeVentaId);
  const cuerpo = Number.isFinite(sucursal) && sucursal > 0
    ? { items, punto_de_venta_id: sucursal }
    : { items };

  return api.put(`/suppliers/orders/${id}/receive`, cuerpo);
};
export const cancelPurchaseOrder = (id) => api.put(`/suppliers/orders/${id}/cancel`);

// ═══════ SETTINGS ═══════

export const getSettings = () => api.get('/settings');
export const getSetting = (key) => api.get(`/settings/${key}`);
export const setSetting = (key, value) => api.put(`/settings/${key}`, { value });

// ═══════ AFIP ═══════

export const getAfipStatus = () => api.get('/afip/status');
export const getAfipCertInfo = () => api.get('/afip/cert-info');
export const guardarConfiguracionAfip = (config) => api.post('/afip/setup', config);
export const generarCsrAfip = (alias) => api.post('/afip/generate-csr', { alias });

/**
 * Ejercita el circuito de facturación **sin emitir nada**.
 *
 * Pide el ticket de acceso (WSAA) y consulta el último comprobante autorizado
 * del punto de venta configurado. No consume numeración y no genera ningún CAE:
 * es lo que reemplaza al botón «Emitir Factura de Prueba» y al `POST
 * /afip/invoice` que este hito borró.
 *
 * La evidencia la escribe el servidor —`PUT /api/settings/afip_verificacion` la
 * rechaza— y es la que habilita el pase a producción.
 */
export const verificarCircuitoAfip = () => api.post('/afip/verificar');

/**
 * Borra el certificado, la clave, el punto de venta, el ambiente y la evidencia.
 *
 * ⚠ **No borra el CUIT ni ninguna venta ya facturada.** Y la clave privada no se
 * puede recuperar de acá: no sale por la API y la del CSR nunca se guardó del
 * lado del servidor.
 */
export const desvincularAfip = () => api.delete('/afip/vinculacion');

// ═══════ HEALTH ═══════

export const ping = () => api.get('/ping');
// `getAlerts` se borró con `GET /api/alerts` (T1382). Tenía UN solo consumidor
// —el Panel—, pedía `stock.ver` mientras `/kpis` pide `dashboard.ver`, y un rol
// con uno y sin el otro rechazaba el `Promise.all` de la pantalla y la dejaba
// entera en `-` y `0` sin un cartel. Los avisos salen de `kpis` (FR-058).

// ═══════ RECETAS E HISTORIAL DE COSTOS ═══════

/**
 * El historial de costos de un producto, paginado.
 *
 * `params` acepta `limit` (por defecto 10 en el servidor, tope 100) y `offset`.
 * El historial de un producto con dos anios de listas de proveedor son cientos
 * de filas: traerlas todas para mostrar diez es lo que hace que el panel tarde
 * en abrir justamente en los productos que mas se tocaron.
 *
 * La respuesta trae `total` ademas de `data`, y cada fila puede tener `usuario`
 * en `null`: las anteriores a esta funcionalidad no tienen autor y eso es dato
 * viejo, no un error.
 */
export const getProductCostHistory = (productId, params) =>
  api.get(`/products/${productId}/cost-history`, { params });
export const getProductRecipe = (productId) => api.get(`/products/${productId}/recipe`);
export const createOrUpdateRecipe = (productId, data) => api.post(`/products/${productId}/recipe`, data);
export const deleteRecipe = (productId) => api.delete(`/products/${productId}/recipe`);

// ═══════ PRODUCCIÓN ═══════

export const getProductionOrders = (params) => api.get('/production', { params });
export const getProductionOrder = (id) => api.get(`/production/${id}`);
export const createProductionOrder = (data) => api.post('/production', data);
export const voidProductionOrder = (id) => api.post(`/production/${id}/void`);

// ═══════ CLIENTES ═══════

export const getCustomers = (params) => api.get('/customers', { params });
export const getCustomer = (id) => api.get(`/customers/${id}`);
export const createCustomer = (data) => api.post('/customers', data);
export const updateCustomer = (id, data) => api.put(`/customers/${id}`, data);
export const deleteCustomer = (id) => api.delete(`/customers/${id}`);
export const getCustomerDebt = (id) => api.get(`/customers/${id}/debt`);
export const getCustomerPayments = (id) => api.get(`/customers/${id}/payments`);
export const createCustomerPayment = (id, data) => api.post(`/customers/${id}/payments`, data);
export const getCustomerSales = (id) => api.get(`/customers/${id}/sales`);
export const getCustomerRanking = (limit) => api.get('/customers/ranking', { params: { limit } });
export const getCustomerSummary = () => api.get('/customers/summary');

// ═══════ FLUJO DE CAJA ═══════

export const getCashflowBalance = () => api.get('/cashflow/balance');
export const getCashflowMovements = (params) => api.get('/cashflow/movements', { params });
export const getCashflowEntries = (params) => api.get('/cashflow/entries', { params });
export const createCashflowEntry = (data) => api.post('/cashflow/entries', data);
export const deleteCashflowEntry = (id) => api.delete(`/cashflow/entries/${id}`);

// ═══════ IMPUESTOS ═══════

export const getTaxConfig = (taxType) => api.get(`/taxes/config/${taxType}`);
export const updateTaxConfig = (taxType, config) => api.put(`/taxes/config/${taxType}`, { config });
export const getTaxCalculation = (year) => api.get('/taxes/calculation', { params: { year } });
export const getTaxPayments = (params) => api.get('/taxes/payments', { params });
export const createTaxPayment = (data) => api.post('/taxes/payments', data);

// ═══════ DASHBOARD KPIs ═══════

export const getDashboardKpis = () => api.get('/dashboard/kpis');

// ═══════ REPORTES ═══════

export const getSalesReport = (from, to) => api.get('/reports/sales', { params: { from, to } });
export const getInventoryReport = () => api.get('/reports/inventory');
export const getProfitReport = (from, to) => api.get('/reports/profit', { params: { from, to } });

// ═══════ TRANSFERENCIAS DE STOCK ═══════

/**
 * Mueve mercaderia entre sucursales.
 *
 * `data` manda **`from_punto_de_venta_id` / `to_punto_de_venta_id`**, que es lo
 * que decide de que fila de stock sale y a cual entra. Los `from_location` /
 * `to_location` se siguen aceptando por compatibilidad, pero son codigos: un
 * codigo que no existe es un 400 con los codigos validos, no una caida a buscar
 * por el texto `location`. Esa caida es la que movia mercaderia entre filas que
 * la pantalla no muestra.
 *
 * Sacar de una sucursal inactiva se permite; mandar a una inactiva, no.
 */
export const transferStock = (data) => api.post('/stock/transfer', data);

/**
 * El historial de transferencias.
 *
 * Cada fila trae `fromPuntoDeVenta` y `toPuntoDeVenta` con `{ id, name }`. Las
 * transferencias **anteriores** a esta funcionalidad los traen en `null` —no se
 * migran—: ahi el nombre sale de `from_location` / `to_location`.
 */
export const getStockTransfers = (params) => api.get('/stock/transfers', { params });

// ═══════ ONBOARDING ═══════

export const completeOnboarding = (data) => api.post('/empresas/onboarding', data);

// ═══════ EQUIPO / INVITACIONES ═══════

export const getTeamMembers = (empresaId) => api.get(`/empresas/${empresaId}/usuarios`);
export const getInvitations = (empresaId) => api.get(`/empresas/${empresaId}/invitaciones`);
export const inviteMember = (empresaId, data) => api.post(`/empresas/${empresaId}/invitar`, data);
export const revokeInvitation = (id) => api.delete(`/empresas/invitaciones/${id}`);
export const updateMemberRole = (id, role) => api.put(`/empresas/usuarios/${id}`, { role });
export const acceptInvite = (token) => api.post(`/auth/accept-invite/${token}`);
export const getInviteInfo = (token) => api.get(`/auth/invite/${token}`);

/**
 * Vuelve a mandar el mail de una invitación pendiente.
 *
 * La ruta cuelga del **token** y no del id: es como está escrita del otro lado
 * (`routes/empresas.js`), y el token es lo que identifica la invitación en el
 * enlace. Existía desde siempre y **no la llamaba nadie**, así que quien no
 * recibía el mail no tenía forma de pedir otro salvo revocar e invitar de nuevo.
 */
export const reenviarInvitacion = (token) =>
  api.post(`/empresas/invitaciones/${token}/re-enviar`);

/**
 * Saca a alguien del equipo, o lo devuelve.
 *
 * Son dos helpers y no uno con un booleano porque son dos acciones distintas en
 * la pantalla, y el nombre de la que se llama tiene que leerse en el `onClick`.
 *
 * ⚠ Desactivar **ya es instantáneo**: `loadEmpresaContext` relee la membresía en
 * cada request, así que la persona recibe 403 en el siguiente. Lo que faltaba no
 * era el efecto sino el botón.
 */
export const desactivarMiembro = (id) =>
  api.put(`/empresas/usuarios/${id}`, { is_active: false });

export const reactivarMiembro = (id) =>
  api.put(`/empresas/usuarios/${id}`, { is_active: true });

// ═══════ SESIONES ═══════
//
// ⚠ Las tres piden permisos distintos y la asimetría es la decisión: ver la
// lista y cerrar **las propias** son `equipo.ver`; cerrar la de **otro** es
// `equipo.editar`, porque le corta el acceso en todas las empresas a las que esa
// persona tenga acceso.
//
// Y ninguna revoca nada: cierran al navegador que coopera —recibe 401, borra su
// identificador y sale—. El corte de verdad es `desactivarMiembro`.

export const getSesionesDelEquipo = (empresaId) =>
  api.get(`/empresas/${empresaId}/sesiones`);

/**
 * Cierra la sesión de un dispositivo.
 *
 * No lleva `empresaId` en la URL: la sesión no es de una empresa. El servidor
 * resuelve si es tuya de mirar la membresía, y responde 404 si no lo es.
 */
export const cerrarSesion = (id) => api.delete(`/empresas/sesiones/${id}`);

/** «Cerrar todas menos ésta», de las propias. Nunca cierra la de este navegador. */
export const cerrarMisOtrasSesiones = () => api.delete('/empresas/sesiones');

// ═══════ SUSCRIPCIÓN ═══════

export const getSubscription = (empresaId) => api.get(`/empresas/${empresaId}/suscripcion`);

// ═══════ TIENDANUBE ═══════
//
// Los DOCE endpoints privados de `routes/tiendanube.js`. El contrato tiene
// catorce y los otros dos —`GET /callback` y `POST /webhook`— **no pueden tener
// helper**: viven en el router `publico`, que `server.js` monta sin sesión y
// arriba del `express.json()` global, y quien los llama es TiendaNube. Al
// callback lo trae el navegador de vuelta del OAuth, con la redirección que
// arma el servidor; un helper que lo llamara desde acá no completaria ningun
// flujo, mandaria un `code` sin `state` valido y consumiria el unico uso que ese
// `state` tiene.
//
// ⚠ `GET /tiendanube/auth` **escribe**: crea la fila de `tiendanube_estados_oauth`
// que el callback consume. Por eso exige `config.editar` y no `config.ver`, y por
// eso la pantalla no lo llama al montar sino cuando alguien aprieta «Conectar».

/** El estado de la conexion, los contadores y las fechas. Nunca trae el token. */
export const getTiendanubeStatus = () => api.get('/tiendanube/status');

/** La URL de autorizacion, con su `state` de un solo uso ya creado. */
export const getTiendanubeAuthUrl = () => api.get('/tiendanube/auth');

/**
 * La sucursal designada: de ahi sale lo que se publica y ahi se descuenta el pedido.
 *
 * Devuelve `encoladas`, que **es parte del contrato y no un dato informativo**:
 * cambiar la sucursal mueve todos los numeros publicados, y la pantalla lo dice
 * en la confirmacion ANTES de que alguien acepte.
 */
export const setTiendanubeSucursal = (puntoDeVentaId) =>
  api.put('/tiendanube/sucursal', { punto_de_venta_id: puntoDeVentaId });

/** Borra el token y la instantanea. Los mapeos NO se borran, y lo dice en `mapeos_conservados`. */
export const desvincularTiendanube = () => api.delete('/tiendanube/vinculacion');

/**
 * La instantanea local del catalogo, paginada y filtrada POR EL SERVIDOR.
 *
 * ⚠ `q` y `sin_mapear` van como parametros y no se resuelven en el navegador:
 * la lista esta paginada de a cincuenta, asi que filtrar la pagina cargada
 * responderia «no hay resultados» sobre una variante que existe en la pagina 3.
 * Es el mismo defecto que la 012 encontro en el buscador de ordenes.
 */
export const getTiendanubeVariantes = (params) => api.get('/tiendanube/variantes', { params });

/** Trae TODAS las paginas de TiendaNube y reescribe la instantanea. */
export const refrescarTiendanubeCatalogo = () => api.post('/tiendanube/variantes/refrescar');

export const getTiendanubeMapeos = (params) => api.get('/tiendanube/mapeos', { params });
export const crearTiendanubeMapeo = (data) => api.post('/tiendanube/mapeos', data);
export const borrarTiendanubeMapeo = (id) => api.delete(`/tiendanube/mapeos/${id}`);

/** Un PUT por variante mapeada. Responde 200 **incluso con fallas**: el resumen dice cuantas. */
export const sincronizarTiendanube = () => api.post('/tiendanube/sincronizar');

/** El resultado de la ultima corrida y la cola. `corrida: null` = nunca corrio ninguna. */
export const getTiendanubeUltimaCorrida = () => api.get('/tiendanube/corridas/ultima');

/** Los pedidos que entraron por el webhook, y que items NO descontaron. */
export const getTiendanubePedidos = (params) => api.get('/tiendanube/pedidos', { params });

// ═══════ IMPORTACIÓN ═══════

export const downloadTemplate = (type = 'products') =>
  api.get(`/import/template/${type}`, { responseType: 'blob' });

/**
 * Importa productos desde un CSV o Excel.
 *
 * `defaultLocation` es el **`code` de una sucursal** de la empresa, y es la que
 * se usa para las filas del archivo que no traen columna Sucursal. Un valor que
 * no resuelve **rechaza la importacion entera con 400 antes de escribir nada**:
 * aplica a todas las filas, y descubrirlo en la fila 300 seria tarde.
 *
 * **No tiene valor por defecto a proposito.** Antes era el string `'principal'`,
 * y en una empresa sembrada por `seedPuntosDeVenta` —cuyos codigos son
 * general/ortiz/mayo— ese texto no coincide con **nada**: la importacion
 * escribia filas en una sucursal inexistente que la pantalla no muestra. Es
 * literalmente el caso con el que el plan explica como nace "una pila anotada
 * dos veces".
 *
 * Mandarlo vacio es valido y significa "usa el punto de venta por defecto de la
 * empresa", que lo resuelve el servidor.
 *
 * @param {File} file
 * @param {object} [mapping] Correspondencia columna -> campo.
 * @param {string} [defaultLocation] `code` de sucursal. Vacio = el por defecto.
 */
export const importProducts = (file, mapping = {}, defaultLocation = '') => {
  const formData = new FormData();
  formData.append('file', file);
  if (Object.keys(mapping).length > 0) {
    formData.append('mapping', JSON.stringify(mapping));
  }
  formData.append('defaultLocation', defaultLocation || '');
  return api.post('/import/products', formData, { timeout: 120000 });
};

export default api;
