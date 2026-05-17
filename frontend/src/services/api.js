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

// ── Interceptor: inyecta el token de Auth0 en cada request ──
export function setAuthToken(getAccessTokenSilently) {
  api.interceptors.request.use(async (config) => {
    try {
      const token = await getAccessTokenSilently();
      config.headers.Authorization = `Bearer ${token}`;
    } catch (err) {
      console.warn('[api] No se pudo obtener token:', err.message);
    }
    return config;
  });
}

// ═══════ PRODUCTOS ═══════

export const getProducts = (params) => api.get('/products', { params });
export const getProduct = (id) => api.get(`/products/${id}`);
export const createProduct = (data) => api.post('/products', data);
export const updateProduct = (id, data) => api.put(`/products/${id}`, data);
export const deleteProduct = (id) => api.delete(`/products/${id}`);
export const bulkProducts = (products) => api.post('/products/bulk', { products });

// ═══════ VENTAS ═══════

export const getSales = (date, location) => api.get('/sales', { params: { date, location } });
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

// ═══════ SETTINGS ═══════

export const getSettings = () => api.get('/settings');
export const getSetting = (key) => api.get(`/settings/${key}`);
export const setSetting = (key, value) => api.put(`/settings/${key}`, { value });

// ═══════ HEALTH ═══════

export const ping = () => api.get('/ping');

export default api;
