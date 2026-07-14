import { create } from 'zustand';
import api from '../services/api';

const useStore = create((set, get) => ({
  products: [],
  brands: [],
  categories: [],
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

  // Load empresa context after login
  loadEmpresaContext: async () => {
    set({ loadingUsuario: true, contextError: false });
    try {
      const res = await api.get('/empresas/mi-contexto');
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
        });
        // Reinitialize data with new empresa context
        await get().initialize();
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
  calculatePrices: (product) => {
    const { settings } = get();
    const cost = parseFloat(product.cost) || 0;

    const margin = product.margin_override ?? settings.margin_efectivo;

    const cashPrice = Math.round(cost * (1 + margin / 100));
    const cardPrice = Math.round(cashPrice / (1 - settings.recargo_tarjeta / 100));
    const alliancePrice = Math.round(cashPrice * (1 - settings.descuento_alianza / 100));

    return { cashPrice, cardPrice, alliancePrice };
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
        const priceMap = { ef: i.base_cash, tr: i.base_cash, qr: i.base_cash, td: i.base_cash, tc3: i.base_card, al: i.base_alliance };
        return { ...i, method, price: priceMap[method] || i.base_cash };
      })
    });
  },

  clearCart: () => set({ cart: [] }),

  // Totals
  getCartTotal: () => get().cart.reduce((sum, item) => sum + (item.price * item.qty), 0),

}));

export default useStore;
