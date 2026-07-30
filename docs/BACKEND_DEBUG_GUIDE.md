# Guía de Debugging y Análisis del Backend (Comprafit)

Esta guía está diseñada para que un desarrollador junior pueda entender rápidamente la estructura del backend, cómo probar cada ruta y cómo investigar errores usando herramientas como Postman o Insomnia.

---

## 1. Conceptos Base

*   **URL Base:** `http://localhost:5000/api`
*   **Formato de Datos:** Siempre usamos `JSON`. Asegúrate de configurar el header `Content-Type: application/json` en tus herramientas de prueba.
*   **Base de Datos:** Usamos PostgreSQL con Sequelize. El esquema se sincroniza automáticamente en desarrollo.
*   **Autenticación:** En desarrollo, el middleware de Auth0 está configurado para permitir el paso libre (`next()`), por lo que no necesitas tokens de portador (Bearer) para probar las rutas localmente.

---

## 2. Herramientas Recomendadas

### Postman / Insomnia
1.  Crea una nueva **Colección** llamada "Comprafit".
2.  Configura una variable de entorno `baseUrl` con el valor `http://localhost:5000/api`.
3.  En la pestaña **Headers**, agrega siempre `Content-Type: application/json`.

---

## 3. Catálogo de Endpoints

### 📦 Productos (`/api/products`)
Gestiona el catálogo de suplementos y productos.

| Método | Ruta | Descripción | Body (JSON) |
| :--- | :--- | :--- | :--- |
| **GET** | `/` | Lista todos los productos. | - |
| **GET** | `/:id` | Detalle de un producto específico. | - |
| **POST** | `/` | Crea un producto nuevo. | `{"name": "Proteína", "cost": 100, ...}` |
| **PUT** | `/:id` | Actualiza un producto. | `{"cost": 110}` |
| **DELETE**| `/:id` | Desactiva un producto (borrado lógico). | - |
| **POST** | `/bulk` | Carga masiva (importar Excel). | `{"products": [...]}` |

> **Tip de Debug:** Si un producto no aparece en el frontend, verifica que `is_active` sea `true` en la base de datos.

---

### 💰 Ventas (`/api/sales`)
Registra las transacciones realizadas en el POS.

| Método | Ruta | Descripción | Parámetros / Body |
| :--- | :--- | :--- | :--- |
| **GET** | `/` | Ventas del día (o fecha `?date=YYYY-MM-DD`). | `?date=2024-04-28` |
| **GET** | `/summary` | Resumen para reportes/gráficos. | `?from=...&to=...` |
| **POST** | `/` | **Registrar Venta**. Crea Sale y SaleItems. | `{"total": 500, "items": [...]}` |
| **DELETE**| `/:id` | Anular/Eliminar una venta. | - |

---

### 🏛️ AFIP / ARCA (`/api/afip`)
Integración con el Web Service de Facturación Electrónica.

| Método | Ruta | Descripción | Importante |
| :--- | :--- | :--- | :--- |
| **GET** | `/status` | Verifica si hay conexión con los servidores de AFIP. | No requiere auth ticket. |
| **GET** | `/cert-info`| Muestra info del certificado cargado (Emisor, Vencimiento). | Útil para saber si es Homo o Prod. |
| **POST** | `/setup` | Guarda el CUIT, certificado y entorno en la DB. | Envía el `.crt` y `.key` como texto. |
| **POST** | `/invoice`| **Genera Factura Electrónica**. Devuelve CAE y Vto. | El corazón del sistema fiscal. |
| **POST** | `/generate-csr`| Genera una nueva Clave Privada y Pedido (CSR) local. | Descarga archivos `.key` y `.csr`. |

---

### ⚙️ General (`/api`)
Rutas misceláneas controladas en `general.js`.

*   **Marcas:** `GET /brands`, `POST /brands`
*   **Stock:** `GET /stock`, `PUT /stock/:id`
*   **Gastos:** `GET /expenses`, `POST /expenses`, `DELETE /expenses/:id`
*   **Configuración:** `GET /settings` (Devuelve el objeto con márgenes de ganancia, CUIT, etc).

---

## 4. Cómo Investigar un Error (Workflow de Debug)

Cuando una ruta falla (ej. Error 500):

1.  **Mira la Consola del Servidor:**
    *   El backend tiene logs que imprimen el error exacto de Sequelize o de AFIP.
    *   Busca mensajes como `[ERROR]` o `Executing (default): ...`.
2.  **Usa Postman para aislar el problema:**
    *   Copia el JSON que está enviando el frontend.
    *   Pégalo en Postman y envíalo. Si en Postman funciona pero en el frontend no, el problema es el `api.js` o el estado de React.
3.  **Inspecciona la Respuesta de Red (Chrome DevTools):**
    *   Pestaña **Network** -> Busca la llamada en rojo.
    *   Pestaña **Response**: Ahí suele venir el mensaje de error enviado por el `catch` del backend.
4.  **Verifica la Base de Datos:**
    *   Si un `POST` falla, puede ser por una restricción de `UNIQUE` (ej. un SKU repetido) o una clave foránea inexistente.

---

## 5. Ejemplo de Prueba en Postman: Crear Producto

1.  **Method:** `POST`
2.  **URL:** `{{baseUrl}}/products`
3.  **Body (raw JSON):**
    ```json
    {
      "name": "Creatina Test",
      "cost": 5000.50,
      "brand_id": 1,
      "category": "suplementos",
      "sku": "CRT-001"
    }
    ```
4.  **Resultado Esperado:** Status `201 Created` y un objeto con el `id` asignado.

---

## 6. Diccionario de Errores Comunes en AFIP

*   **ns1:cms.cert.untrusted:** El certificado es de Producción pero estás en Homologación (o viceversa).
*   **Token/Sign vencido:** El sistema debería renovarlo solo, pero si falla, limpia la cache de la base de datos.
*   **Punto de Venta inexistente:** El número de PV que pusiste en Settings no está dado de alta en el portal de AFIP.
