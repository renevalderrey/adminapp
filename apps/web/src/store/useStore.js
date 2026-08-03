import { create } from 'zustand';
import api, { getSucursalesDeStock } from '../services/api';
import { calcularPrecios } from '@/utils/precios';

const useStore = create((set, get) => ({
  products: [],
  brands: [],
  categories: [],
  /**
   * Las sucursales de la empresa, INCLUIDAS las inactivas.
   *
   * Definen cuantas columnas de stock tiene la tabla de Inventario. Van en el
   * store y no en la pantalla porque tambien las necesitan el selector de la
   * transferencia y el panel del producto: leerlas tres veces daria tres
   * respuestas que pueden diferir si alguien crea una sucursal en el medio.
   */
  sucursales: [],
  settings: {
    margin_efectivo: 50,
    recargo_tarjeta: 20,
    descuento_alianza: 10,
    fixed_expenses_total: 0,
    afip_cuit: '',
    afip_pv: '',
    afip_environment: 'homologation',
    tax_condition: 'Monotributo'
  },

  // Empresa / Multi-tenant
  usuario: null,
  empresaActiva: null,
  empresas: [],
  permisos: [],
  puntoDeVentaActivo: null,

  // Loading states
  loading: false,
  loadingUsuario: false,
  contextError: false,
  error: null,

  // Initialize data from API
  initialize: async () => {
    set({ loading: true });
    try {
      const [pd, br, st] = await Promise.all([
        api.get('/products?active=true'),
        api.get('/brands'),
        api.get('/settings')
      ]);

      set({
        products: pd.data.data || [],
        brands: br.data.data || [],
        settings: { ...get().settings, ...(st.data.data || {}) },
        loading: false
      });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  /**
   * Carga las sucursales de la empresa.
   *
   * Aparte de `initialize()` a proposito: no todas las pantallas del store las
   * necesitan, y un fallo acá —por ejemplo un usuario sin `stock.ver`— no tiene
   * por que dejar sin productos a la pantalla de ventas. Por eso no toca
   * `loading` ni `error` globales.
   */
  cargarSucursales: async () => {
    try {
      const res = await getSucursalesDeStock();
      set({ sucursales: res.data.data || [] });
    } catch (err) {
      console.warn('[store] Error cargando sucursales:', err.message);
    }
  },

  /**
   * Reemplaza UNA fila de `products`, sin tocar `loading`.
   *
   * Es lo que evita el `initialize()` de `Inventory.jsx:423` despues de cada
   * guardado: ese dispara tres requests, pone `loading: true` global —la tabla
   * entera parpadea— y devuelve la lista al estado inicial, con lo cual el
   * usuario pierde la pagina, la busqueda, el orden y el scroll en los que
   * estaba (FR-035).
   *
   * `initialize()` sigue siendo lo correcto cuando cambio medio catalogo: una
   * importacion o un masivo de precios.
   *
   * Si el producto no esta en la lista no se agrega: puede no cumplir el filtro
   * con el que se cargo (`?active=true`), y meterlo mostraria una fila que la
   * pantalla no habria traido.
   */
  actualizarProducto: (producto) => {
    if (!producto || producto.id === undefined || producto.id === null) return;

    set({
      products: get().products.map((p) => (p.id === producto.id ? { ...p, ...producto } : p)),
    });
  },

  /**
   * Saca una fila de `products`, sin tocar `loading`.
   *
   * Para el producto que se desactiva desde el panel: la lista se carga con
   * `?active=true`, asi que dejarlo mostraria una fila que ya no corresponde.
   */
  quitarProducto: (id) => {
    if (id === undefined || id === null) return;

    set({ products: get().products.filter((p) => p.id !== id) });
  },

  // Load empresa context after login
  loadEmpresaContext: async () => {
    const state = get();
    if (state.usuario) return;
    set({ loadingUsuario: true, contextError: false });
    try {
      const res = await api.get('/empresas/mi-contexto', { timeout: 20000 });
      if (res.data.ok) {
        const { usuario, empresaActiva, empresas, permisos } = res.data.data;
        set({
          usuario,
          empresaActiva,
          empresas,
          permisos: permisos || [],
          puntoDeVentaActivo: empresaActiva?.puntosDeVenta?.[0] || null,
          loadingUsuario: false,
        });
      } else {
        set({ loadingUsuario: false });
      }
    } catch (err) {
      if (get().usuario) return;
      console.warn('[store] Error loading empresa context:', err.message);
      set({ loadingUsuario: false, contextError: true });
    }
  },

  // Switch active empresa
  setEmpresaActiva: async (empresaId) => {
    try {
      const res = await api.put(`/empresas/cambiar-empresa/${empresaId}`);
      if (res.data.ok) {
        const empresa = res.data.data;
        set({
          empresaActiva: empresa,
          permisos: empresa.permisos || [],
          puntoDeVentaActivo: empresa?.puntosDeVenta?.[0] || null,
          // Las sucursales de la empresa anterior se limpian ANTES de pedir las
          // nuevas. Dejarlas puestas mientras llega la respuesta muestra las
          // columnas de otro cliente en la tabla de este, que es justo lo que
          // el aislamiento entre empresas viene a evitar — y del lado del
          // navegador nada lo impide.
          sucursales: [],
        });
        // Reinitialize data with new empresa context
        await get().initialize();
        await get().cargarSucursales();
      }
    } catch (err) {
      console.warn('[store] Error switching empresa:', err.message);
    }
  },

  // Set active punto de venta
  setPuntoDeVentaActivo: (pv) => {
    set({ puntoDeVentaActivo: pv });
  },

  // Helper: Price Calculation
  //
  // La formula vive en utils/precios.js para poder testearla. Ver ahi la
  // convencion de margen (recargo sobre costo) y los dos modos de recargo por
  // tarjeta. El recargo por defecto pasa a sumarse al precio del cliente:
  // antes se usaba cashPrice / (1 - r/100), que con un 20% configurado cobraba
  // un 25% de mas.
  calculatePrices: (product) => {
    const { settings } = get();
    return calcularPrecios(product, settings);
  },

  // Cart Management
  cart: [],
  addToCart: (product, method = 'ef') => {
    const { cart, calculatePrices } = get();
    const existing = cart.find(i => i.id === product.id);
    const { cashPrice, cardPrice, alliancePrice } = calculatePrices(product);

    const priceMap = { ef: cashPrice, tr: cashPrice, qr: cashPrice, td: cashPrice, tc3: cardPrice, al: alliancePrice };
    const price = priceMap[method] || cashPrice;

    if (existing) {
      set({
        cart: cart.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      });
    } else {
      set({
        cart: [...cart, {
          id: product.id,
          name: product.name,
          price,
          qty: 1,
          method,
          base_cash: cashPrice,
          base_card: cardPrice,
          base_alliance: alliancePrice
        }]
      });
    }
  },

  removeFromCart: (productId) => {
    set({ cart: get().cart.filter(i => i.id !== productId) });
  },

  updateCartQty: (productId, qty) => {
    if (qty <= 0) return get().removeFromCart(productId);
    set({
      cart: get().cart.map(i => i.id === productId ? { ...i, qty } : i)
    });
  },

  updateCartMethod: (productId, method) => {
    set({
      cart: get().cart.map(i => {
        if (i.id !== productId) return i;

        // Un precio puesto a mano sobrevive al cambio de medio de pago. Si no,
        // acordar $18.000 con el cliente y después tocar "Tarjeta" le devolvía
        // el precio de lista sin avisar.
        if (i.precio_manual) return { ...i, method };

        const priceMap = { ef: i.base_cash, tr: i.base_cash, qr: i.base_cash, td: i.base_cash, tc3: i.base_card, al: i.base_alliance };
        return { ...i, method, price: priceMap[method] || i.base_cash };
      })
    });
  },

  /**
   * Precio puesto a mano para una línea.
   *
   * Existe porque en el mostrador se negocia: se redondea para abajo, se hace
   * un precio de amigo, se cobra distinto un producto con el envase golpeado.
   * Sin esto había que cerrar la venta con el precio de lista y arreglarlo
   * después, o no registrarla.
   *
   * El total lo recalcula el servidor a partir de las líneas, así que un
   * precio manual entra por el mismo camino que cualquier otro.
   *
   * @param {number|string} precio Vacío o null vuelve al precio de lista.
   */
  updateCartPrice: (productId, precio) => {
    set({
      cart: get().cart.map(i => {
        if (i.id !== productId) return i;

        if (precio === '' || precio === null || precio === undefined) {
          const priceMap = { ef: i.base_cash, tr: i.base_cash, qr: i.base_cash, td: i.base_cash, tc3: i.base_card, al: i.base_alliance };
          return { ...i, price: priceMap[i.method] || i.base_cash, precio_manual: false };
        }

        const numero = Number(precio);
        if (!Number.isFinite(numero) || numero < 0) return i;

        return { ...i, price: Math.round(numero * 100) / 100, precio_manual: true };
      })
    });
  },

  clearCart: () => set({ cart: [] }),

  // Totals
  getCartTotal: () => get().cart.reduce((sum, item) => sum + (item.price * item.qty), 0),

}));

export default useStore;
