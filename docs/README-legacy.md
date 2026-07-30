# Sistema de Gestión Empresarial y Facturación

Este proyecto es una plataforma integral (SaaS) diseñada para la gestión comercial de empresas y emprendedores de múltiples rubros. El sistema centraliza la facturación electrónica, el control de stock multi-sucursal, la gestión de proveedores y el análisis de rentabilidad en una interfaz moderna y escalable.

---

## 🚀 Funcionalidades

### 1. Punto de Venta (POS)
- **Carrito de Compras**: Selección rápida de productos con múltiples listas de precios (Efectivo, Tarjeta, Alianzas).
- **Cálculo Automático**: Gestión de vueltos, recargos por tarjeta (configurable) y descuentos.
- **Registro de Ventas**: Persistencia inmediata con capacidad de imprimir comprobantes.

### 2. Gestión de Inventario
- **Control de Stock Multi-Sucursal**: Stock por sucursal (General, Ortiz de Ocampo, 25 de Mayo).
- **Administración de Precios**: Márgenes personalizados por producto y calculadora BEP.
- **Carga Masiva**: Excel, texto pegado, manual o extracción por IA desde PDF/imágenes.

### 3. Historial y Reportes
- **Historial Diario**: Registro detallado de todas las transacciones.
- **Resumen Financiero**: Ingresos segmentados por método de pago y sucursal.

### 4. Módulo de Proveedores
- **Comparador de Precios**: Comparación entre proveedores para optimizar compras.
- **Cuentas Corrientes**: Deudas, pagos, adelantos y saldos con cada proveedor.
- **Armado de Pedidos**: Pedidos optimizados por marca con exportación a WhatsApp.

### 5. Gastos Fijos y Calculadora BEP
- **GF1/GF2**: Gastos fijos separados por sucursal.
- **Punto de Equilibrio**: Cálculo automático del margen mínimo necesario.
- **Recomendaciones**: Sugerencias de precio (BEP Justo, Recomendado, Agresivo).

---

## 🏗️ Stack Tecnológico

| Componente | Tecnología |
| :--- | :--- |
| **Frontend** | React 19 + Vite |
| **Backend** | Node.js + Express |
| **Base de Datos** | PostgreSQL + Sequelize ORM |
| **Autenticación** | Auth0 (JWT) |
| **Estilos** | CSS Custom (Dark Theme) |

---

## 📁 Estructura del Proyecto

```
/sistema-de-facturacion
  ├── /backend                    # API REST — Node.js + Express
  │     ├── /src
  │     │    ├── /config          # Configuración PostgreSQL
  │     │    │    └── database.js
  │     │    ├── /middleware      # Auth0 JWT middleware
  │     │    │    └── auth.js
  │     │    ├── /models          # Modelos Sequelize
  │     │    │    ├── Brand.js        # Marcas
  │     │    │    ├── Product.js      # Productos (costo, márgenes)
  │     │    │    ├── Stock.js        # Stock multi-sucursal
  │     │    │    ├── Sale.js         # Ventas + items
  │     │    │    ├── Supplier.js     # Proveedores, pedidos, movimientos
  │     │    │    ├── FixedExpense.js # Gastos fijos GF1/GF2
  │     │    │    ├── Setting.js      # Configuraciones generales
  │     │    │    └── index.js        # Relaciones entre modelos
  │     │    ├── /routes          # Endpoints de la API
  │     │    │    ├── products.js     # CRUD + bulk import
  │     │    │    ├── sales.js        # Registro venta + historial
  │     │    │    ├── suppliers.js    # Proveedores + cuentas
  │     │    │    └── general.js      # Stock, marcas, gastos, settings
  │     │    ├── server.js        # Entry point del servidor
  │     │    └── migrate.js       # Script de migración PHP → PostgreSQL
  │     ├── .env                  # Variables de entorno
  │     ├── .env.example
  │     └── package.json
  │
  ├── /frontend                   # SPA — React + Vite
  │     ├── /src
  │     │    ├── /pages           # Vistas principales
  │     │    │    ├── Dashboard.jsx   # Calculadora / KPIs
  │     │    │    ├── Inventory.jsx   # Inventario
  │     │    │    ├── Billing.jsx     # Facturación (POS)
  │     │    │    ├── Orders.jsx      # Pedidos
  │     │    │    ├── Expenses.jsx    # Gastos fijos
  │     │    │    └── Login.jsx       # Autenticación Auth0
  │     │    ├── /services        # Capa de API
  │     │    │    └── api.js          # Axios + Auth0 interceptor
  │     │    ├── /components      # Componentes reutilizables
  │     │    ├── /hooks           # Custom hooks
  │     │    ├── /context         # React Context
  │     │    ├── App.jsx          # Layout + routing
  │     │    ├── main.jsx         # Entry point + Auth0Provider
  │     │    └── index.css        # Design system (dark theme)
  │     ├── .env
  │     └── package.json
  │
  ├── index (8).html              # ⚠️ Sistema original (legacy)
  ├── api.php                     # ⚠️ API original (legacy)
  └── README.md
```

---

## ⚡ Inicio Rápido

### Prerrequisitos
- **Node.js** 18+
- **PostgreSQL** 14+
- **Cuenta Auth0** (para autenticación)

### 1. Base de Datos

```bash
# Crear la base de datos en PostgreSQL
psql -U postgres -c "CREATE DATABASE comprafit;"
```

### 2. Backend

```bash
cd backend

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tu configuración de PostgreSQL y Auth0

# Instalar dependencias
npm install

# Iniciar en modo desarrollo (crea las tablas automáticamente)
npm run dev
```

### 3. Frontend

```bash
cd frontend

# Configurar variables de entorno
# Editar .env con tu AUTH0_DOMAIN y CLIENT_ID

# Instalar dependencias
npm install

# Iniciar en modo desarrollo
npm run dev
```

### 4. Migración de Datos (desde PHP/MySQL)

```bash
cd backend

# Configurar en .env:
# PHP_API_URL=https://tu-dominio.com/api.php
# PHP_API_TOKEN=Comprafit.App.2025

# Ejecutar migración
npm run migrate
```

El script de migración:
- Conecta a la API PHP actual
- Extrae **todos** los datos (productos, stock, ventas, gastos, proveedores)
- Los normaliza en tablas PostgreSQL relacionales
- Muestra un resumen con la cantidad de registros migrados

---

## 🔑 Configuración Auth0

1. Crear una **Single Page Application** en Auth0
2. Crear una **API** con audience `https://api.comprafit.com`
3. Configurar las **Allowed Callback URLs** con `http://localhost:5173`
4. Copiar `Domain` y `Client ID` a los archivos `.env`:

**Backend (.env):**
```
AUTH0_DOMAIN=tu-tenant.us.auth0.com
AUTH0_AUDIENCE=https://api.comprafit.com
```

**Frontend (.env):**
```
VITE_AUTH0_DOMAIN=tu-tenant.us.auth0.com
VITE_AUTH0_CLIENT_ID=tu_client_id
VITE_AUTH0_AUDIENCE=https://api.comprafit.com
```

> **Nota**: En modo desarrollo (`NODE_ENV=development`), si Auth0 no está configurado, la API se ejecuta sin autenticación para facilitar el desarrollo.

---

## 📊 Esquema de Base de Datos

```
brands ─────────── 1:N ── products
products ───────── 1:N ── stock (por sucursal)
products ───────── 1:N ── sale_items
sales ──────────── 1:N ── sale_items
suppliers ──────── 1:N ── supplier_orders
suppliers ──────── 1:N ── supplier_movements
suppliers ──────── 1:N ── supplier_documents
fixed_expenses ─── (gf1 / gf2)
settings ───────── (key-value para config general)
```

---

## 📡 API Endpoints

| Método | Ruta | Descripción |
|:---|:---|:---|
| `GET` | `/api/ping` | Health check (público) |
| `GET` | `/api/products` | Listar productos |
| `POST` | `/api/products` | Crear producto |
| `POST` | `/api/products/bulk` | Carga masiva |
| `GET` | `/api/sales?date=YYYY-MM-DD` | Ventas por fecha |
| `POST` | `/api/sales` | Registrar venta |
| `GET` | `/api/stock?location=ortiz` | Stock por sucursal |
| `GET` | `/api/brands` | Listar marcas |
| `GET` | `/api/expenses?group=gf1` | Gastos fijos |
| `GET` | `/api/suppliers` | Proveedores |
| `POST` | `/api/suppliers/:id/payments` | Registrar pago |
| `GET/PUT` | `/api/settings/:key` | Configuraciones |

---

Creado por **Antigravity**. 🚀
