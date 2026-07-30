# Guía de Configuración de Facturación Electrónica (ARCA/AFIP)

Esta guía explica los pasos necesarios para que un usuario final pueda configurar el sistema y empezar a emitir facturas legales en Argentina utilizando los Web Services de ARCA.

## 1. Requisitos Previos
*   CUIT del titular o empresa.
*   Clave Fiscal de AFIP (Nivel 3 o superior).
*   Haber dado de alta el servicio **"Administración de Certificados Digitales"** y **"Administrador de Relaciones de Clave Fiscal"** en el portal de AFIP.

## 2. Generación de Certificados
El sistema requiere dos archivos clave para comunicarse con AFIP: la **Clave Privada** (`.key`) y el **Certificado Digital** (`.crt`).

### Pasos:
1.  **Generar Pedido (CSR)**: Dentro de la sección de Ajustes de la aplicación, hacé clic en "Generar Pedido de Certificado". El sistema te entregará un archivo `.csr` y guardará la clave privada de forma segura.
2.  **Obtener Certificado en AFIP**:
    *   Ingresá a [afip.gob.ar](https://www.afip.gob.ar) con tu Clave Fiscal.
    *   Buscá el servicio **"Administración de Certificados Digitales"**.
    *   Agregá un nuevo alias (ej: "MiEmpresa") y subí el archivo `.csr` que generaste en el paso anterior.
    *   Descargá el archivo `.crt` resultante.

## 3. Delegación del Servicio (Web Service)
Para que el certificado sea válido para facturar, tenés que vincularlo al servicio de Facturación Electrónica:
1.  En el portal de AFIP, ingresá a **"Administrador de Relaciones de Clave Fiscal"**.
2.  Hacé clic en **"Nueva Relación"** -> **"Buscar"**.
3.  En el buscador escribí `Facturación Electrónica` y seleccioná el servicio correspondiente.
4.  En "Representante", seleccioná el **Alias** que creaste antes ("MiEmpresa").
5.  Confirmá la relación.

## 4. Punto de Venta
Debés tener un punto de venta específico para Web Services:
1.  Ingresá a **"Regisro Único Tributario"** o **"ABM Puntos de Venta"**.
2.  Agregá un nuevo punto de venta.
3.  Seleccioná el sistema **"Factura Electrónica - Web Services"**.
4.  Anotá el número (ej: 0005) para ingresarlo en la app.

## 5. Carga Final en la App
Una vez que tengas todo listo, volvé a la aplicación y completá los datos:
1.  Ingresá tu **CUIT** completo (sin guiones).
2.  Ingresá el **Punto de Venta** (ej: 5).
3.  Subí el archivo **Certificado (`.crt`)** que descargaste de AFIP.
4.  Seleccioná el ambiente (**Homologación** para pruebas o **Producción** para facturas reales).

---
> [!IMPORTANT]
> **Seguridad**: El sistema cifra tu clave privada. Nunca compartas tus archivos `.key` o `.crt` fuera de la aplicación.
