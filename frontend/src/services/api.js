// ════════════════════════════════════════════
//  COMPRAFIT · API Service
//  Centraliza todas las llamadas al backend
// ════════════════════════════════════════════

import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Instancia de Axios con configuración base
const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

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

// ── Response interceptor: captura 401 y redirige al login ──
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
    if (error.response?.status === 403) {
      const msg = error.response?.data?.message || 'No tienes permiso para realizar esta acción';
      console.warn('[api] 403 Forbidden:', msg);
    }
    return Promise.reject(error);
  }
);

// ── Request interceptor: inyecta el token de Auth0 en cada request ──
let authInterceptorId = null;

export function setAuthToken(getAccessTokenSilently) {
  if (authInterceptorId !== null) {
    api.interceptors.request.eject(authInterceptorId);
  }

  authInterceptorId = api.interceptors.request.use(async (config) => {
    try {
      const token = await getAccessTokenSilently();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    } catch (err) {
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

export const getSales = (date, location, page, limit) =>
  api.get('/sales', { params: { date, location, page, limit } });
export const getSalesSummary = (from, to) => api.get('/sales/summary', { params: { from, to } });
export const createSale = (data) => api.post('/sales', data);
export const deleteSale = (id) => api.delete(`/sales/${id}`);

// ═══════ STOCK ═══════

export const getStock = (location) => api.get('/stock', { params: { location } });
export const updateStock = (id, data) => api.put(`/stock/${id}`, data);
export const bulkStock = (items, location) => api.post('/stock/bulk', { items, location });

// ═══════ MARCAS ═══════

export const getBrands = () => api.get('/brands');
export const createBrand = (data) => api.post('/brands', data);

// ═══════ GASTOS FIJOS ═══════

export const getExpenses = (group) => api.get('/expenses', { params: { group } });
export const createExpense = (data) => api.post('/expenses', data);
export const updateExpense = (id, data) => api.put(`/expenses/${id}`, data);
export const deleteExpense = (id) => api.delete(`/expenses/${id}`);

// ═══════ PROVEEDORES ═══════

export const getSuppliers = () => api.get('/suppliers');
export const getSupplier = (id) => api.get(`/suppliers/${id}`);
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
export const receivePurchaseOrder = (id, items, location) => api.put(`/suppliers/orders/${id}/receive`, { items, location });
export const cancelPurchaseOrder = (id) => api.put(`/suppliers/orders/${id}/cancel`);

// ═══════ SETTINGS ═══════

export const getSettings = () => api.get('/settings');
export const getSetting = (key) => api.get(`/settings/${key}`);
export const setSetting = (key, value) => api.put(`/settings/${key}`, { value });

// ═══════ HEALTH ═══════

export const ping = () => api.get('/ping');
export const getAlerts = () => api.get('/alerts');

// ═══════ RECETAS E HISTORIAL DE COSTOS ═══════

export const getProductCostHistory = (productId) => api.get(`/products/${productId}/cost-history`);
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

export const transferStock = (data) => api.post('/stock/transfer', data);
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

// ═══════ SUSCRIPCIÓN ═══════

export const getSubscription = (empresaId) => api.get(`/empresas/${empresaId}/suscripcion`);

export default api;
