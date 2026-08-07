# Guía de Configuración de Facturación Electrónica (ARCA/AFIP)

Esta guía explica los pasos necesarios para que un usuario final pueda configurar el sistema y empezar a emitir facturas legales en Argentina utilizando los Web Services de ARCA.

> **El orden importa.** Primero se prueba en **homologación** —que necesita su
> propio certificado, sacado por otro trámite— y recién después se pasa a
> producción. AdminApp **no deja pasar a producción sin haber verificado el
> circuito**: el primer comprobante fiscal real no puede ser también la primera
> prueba de que todo funciona.

## 1. Requisitos Previos
*   CUIT del titular o empresa.
*   Clave Fiscal de AFIP (Nivel 3 o superior).
*   Haber dado de alta el servicio **"Administración de Certificados Digitales"** y **"Administrador de Relaciones de Clave Fiscal"** en el portal de AFIP.

## 2. Generación de Certificados
El sistema requiere dos archivos clave para comunicarse con AFIP: la **Clave Privada** (`.key`) y el **Certificado Digital** (`.crt`).

### Pasos:
1.  **Generar Pedido (CSR)**: Dentro de la sección de Ajustes de la aplicación, hacé clic en "Generar Pedido de Certificado". El sistema te entrega dos archivos: el pedido (`.csr`) y la **clave privada** (`.key`).

    > ⚠ **La clave privada NO se guarda en el servidor: se descarga y la tenés
    > que conservar vos.** El sistema la genera, te la entrega una sola vez y no
    > queda ninguna copia del lado de AdminApp. Si la perdés, el certificado que
    > ARCA te emita no va a servir para nada y hay que rehacer el trámite entero.
    > Guardala donde guardes lo importante, no en la carpeta de Descargas.

2.  **Obtener Certificado en AFIP**:
    *   Ingresá a [afip.gob.ar](https://www.afip.gob.ar) con tu Clave Fiscal.
    *   Buscá el servicio **"Administración de Certificados Digitales"**.
    *   Agregá un nuevo alias (ej: "MiEmpresa") y subí el archivo `.csr` que generaste en el paso anterior.
    *   Descargá el archivo `.crt` resultante.

> El certificado y la clave se cargan **juntos** en AdminApp, y tienen que ser
> **pareja**: el `.crt` que ARCA emitió a partir de ese `.csr`, con el `.key` de
> ese mismo pedido. Si no lo son, el guardado los rechaza — antes esto se
> descubría al momento de facturar, con un cliente esperando su comprobante.

## 3. Delegación del Servicio (Web Service)
Para que el certificado sea válido para facturar, tenés que vincularlo al servicio de Facturación Electrónica:
1.  En el portal de AFIP, ingresá a **"Administrador de Relaciones de Clave Fiscal"**.
2.  Hacé clic en **"Nueva Relación"** -> **"Buscar"**.
3.  En el buscador escribí `Facturación Electrónica` y seleccioná el servicio correspondiente.
4.  En "Representante", seleccioná el **Alias** que creaste antes ("MiEmpresa").
5.  Confirmá la relación.

## 4. Punto de Venta
Debés tener un punto de venta específico para Web Services:
1.  Ingresá a **"Registro Único Tributario"** o **"ABM Puntos de Venta"**.
2.  Agregá un nuevo punto de venta.
3.  Seleccioná el sistema **"Factura Electrónica - Web Services"**.
4.  Anotá el número (ej: 0005) para ingresarlo en la app.

> El punto de venta de la facturación electrónica **no es el número de tu
> sucursal**: es el que ARCA te dio de alta para Web Services. Un punto de venta
> que ARCA no tiene declarado no falla al guardarlo — falla al emitir.

## 5. El certificado de **homologación**, que es otro trámite

Esta es la parte que más confunde, y hay que decirla de frente: **el certificado
de homologación y el de producción son dos certificados distintos**, emitidos por
dos servicios distintos de ARCA. El ambiente **no es un interruptor sobre el mismo
material**: cambiarlo sin cambiar el certificado no prueba nada y no funciona.

- **Homologación** es el ambiente de pruebas de ARCA. Los comprobantes que se
  emiten ahí **no tienen validez fiscal**, no le sirven a ningún cliente y no
  consumen tu numeración real. Es donde se prueba que todo esté bien conectado.
- **Producción** es el ambiente real. Cada comprobante que se emite ahí es un
  hecho fiscal: consume numeración correlativa y darlo de baja exige una nota de
  crédito.

### Cómo se saca el de homologación

1.  Ingresá a [afip.gob.ar](https://www.afip.gob.ar) con tu Clave Fiscal.
2.  Buscá el servicio de **certificados para el ambiente de homologación**
    —en el sitio de ARCA figura como el WSASS / "Autogestión Certificados
    Homologación"—. **No es** "Administración de Certificados Digitales", que es
    el de producción (paso 2 de esta guía).
3.  Subí un `.csr` —podés generar uno nuevo desde AdminApp— y descargá el `.crt`
    de homologación.
4.  Dentro de ese mismo servicio, **autorizá el web service `wsfe`** para ese
    certificado. Es el equivalente al paso 3 de esta guía, pero del lado de
    homologación.

### La secuencia completa, en orden

1.  Sacar el certificado **de homologación** y cargarlo en AdminApp con el
    ambiente en **Homologación**.
2.  Tocar **«Verificar circuito»** en Ajustes → Facturación. Eso pide el ticket
    de acceso y consulta el último comprobante autorizado de tu punto de venta:
    **no emite ningún comprobante y no consume numeración**. Si algo está mal, el
    mensaje dice cuál de los dos pasos falló.
3.  Recién cuando eso da bien, sacar el certificado **de producción** (paso 2),
    cargarlo y cambiar el ambiente a **Producción**.

> Si tu empresa **ya emitió alguna factura con CAE**, el paso de verificación ya
> está cumplido: un comprobante autorizado es la prueba más fuerte de que el
> circuito funciona. Nadie que ya esté facturando se queda sin poder facturar por
> este requisito.

## 6. Carga Final en la App
Una vez que tengas todo listo, volvé a la aplicación y completá los datos:
1.  Ingresá tu **CUIT** completo (sin guiones). Tiene que ser el mismo que figura
    en el certificado: si no coinciden, el guardado te dice cuál es cuál.
2.  Ingresá el **Punto de Venta** (ej: 5).
3.  Subí el **Certificado (`.crt`)** y la **Clave Privada (`.key`)** — los dos juntos.
4.  Seleccioná el ambiente. Para el primer setup: **Homologación**.
5.  Tocá **«Verificar circuito»** y esperá el resultado.

---

## Seguridad: qué se guarda y dónde

Esta sección dice lo mismo que la pantalla de Ajustes → Facturación, y dice lo
que **es**, no lo que sería deseable:

- **El certificado y la clave privada se guardan en la base de datos de AdminApp,
  en texto plano.** Cifrarlos en reposo es un proyecto abierto y todavía no está
  hecho. Se dice acá para que puedas decidir con el dato a la vista.
- **La clave privada no sale nunca de la API**: `GET /api/settings` la excluye, la
  pantalla no la muestra ni enmascarada, no entra en los respaldos y queda tapada
  en los registros del servidor.
- **La clave privada del pedido (CSR) no se guarda**: se genera, se descarga una
  vez y hay que conservarla.
- Nunca compartas tus archivos `.key` ni `.crt` fuera de la aplicación. Quien
  tenga la clave privada puede emitir comprobantes fiscales en tu nombre.
