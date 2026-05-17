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
  
  // Loading states
  loading: false,
  error: null,

  // Initialize data from API
  initialize: async () => {
    set({ loading: true });
    try {
      const [pd, br, st] = await Promise.all([
        api.get('/products'),
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

  // Helper: Price Calculation
  calculatePrices: (product) => {
    const { settings } = get();
    const cost = parseFloat(product.cost) || 0;
    
    // Check for product-specific margin override
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
