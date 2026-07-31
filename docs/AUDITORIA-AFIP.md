# Auditoría de la integración AFIP (Frente 3)

**Fecha:** 31 de julio de 2026
**Método:** 11 agentes sobre 5 áreas (WSAA, certificados, manejo de errores,
armado del comprobante, numeración e impresión), cada hallazgo sometido a un
verificador cuya instrucción era refutarlo. Más verificación manual.
**Resultado:** 67 hallazgos confirmados (10 críticos, 24 altos), 4 refutados.

---

## Respuesta corta

**Antes de esta auditoría, la facturación electrónica no podía funcionar.** No
por un detalle: por dos defectos independientes, cada uno suficiente por sí
solo para impedir emitir un comprobante.

Y el problema no era la parte difícil. La firma PKCS#7, el protocolo WSAA, el
armado del SOAP — todo eso está bien resuelto. Lo que fallaba era el camino
entre la pantalla de configuración y el servicio: la plomería.

---

## Lo que impedía facturar

### 1. Guardar Ajustes destruía el certificado

`Settings.jsx` arrancaba con `cert: ''` y `key: ''` y nunca cargaba lo ya
guardado. `handleSave` posteaba el objeto entero.

Del lado del servidor, la guarda que protegía los setups parciales era
`if (valores[clave] === undefined) continue`. **La cadena vacía no es
`undefined`**: se ejecutaba `Setting.upsert({ value: '' })` sobre `afip_cert` y
`afip_key`.

Escenario: el comercio ya probó en homologación y quiere pasar a producción.
Cambia el desplegable de ambiente, guarda. Se borran el certificado, la clave,
el CUIT y el punto de venta.

**Es irreversible.** La clave privada se genera al crear el CSR, se devuelve
una vez al navegador y nunca se guarda en el servidor. Sin copia, hay que
rehacer el trámite completo en ARCA.

### 2. La configuración nunca llegaba al POS

`GET /api/settings` armaba la respuesta con las filas de la tabla `settings` y
después hacía `Object.assign(obj, empresa.settings)` — o sea que el JSON de la
empresa **ganaba**.

Ese JSON lo crea el onboarding con `afip_cuit: ''` y `afip_pv: ''`, y nada lo
vuelve a escribir nunca. Por más que el usuario cargara todo bien, `/settings`
devolvía vacío, `isAfipConfigured` daba falso y la facturación no se habilitaba.

### 3. El CSR era rechazado por ARCA

ARCA exige el CUIT en el subject, con el formato exacto
`serialNumber=CUIT 20123456789`. El código armaba solo `commonName` (el alias) y
`organizationName` fijo en la cadena `"Empresa"`.

El primer paso de la guía —el botón "Generar Pedido de Certificado"— producía
un archivo inservible, y el usuario se enteraba en la ventanilla de AFIP.

### 4. `tax_condition` se descartaba en silencio

`CLAVES_AFIP` no la incluía. El formulario la mandaba, el backend respondía
*"Configuración guardada correctamente"* y la tiraba.

`createVoucher` leía esa clave de una fila que nadie escribía nunca y caía
siempre al default `'Monotributo'`. La condición `taxCondition === 'RI'` nunca
era verdadera: **la rama que discrimina IVA era código muerto**.

Efecto: todo Responsable Inscripto emitía Factura A sin discriminar IVA. AFIP
rechaza eso; y si lo autorizara, el comprador se queda sin crédito fiscal.

---

## Riesgo fiscal para el comerciante

Lo que sigue no es riesgo técnico. Es lo que le pasa al negocio.

### El CAE huérfano

El POS pedía el CAE a AFIP y **después** guardaba la venta. Si el guardado
fallaba —stock insuficiente, red, validación— quedaba un comprobante fiscal
emitido, con número correlativo consumido, sin ningún registro en el sistema.

El cajero veía un toast rojo genérico. No había forma de enterarse, ni de
detectarlo después: el código tiene `FECompConsultar` y `FECompUltimoAutorizado`
pero no los usa para reconciliar.

**Corregido dando vuelta el orden.** Ahora: guardar → pedir CAE. Si falla AFIP,
la venta quedó registrada y se puede reintentar. Nuevo endpoint
`POST /api/sales/:id/facturar`, idempotente, que declara el total persistido.

### Facturar contra homologación sin saberlo

`isProduction()` devolvía `false` ante cualquier valor ausente o inesperado. Un
comercio con la configuración incompleta podía estar emitiendo contra el
servidor de pruebas de AFIP creyendo que facturaba de verdad.

Los comprobantes de homologación **no tienen validez fiscal**. Se descubre
cuando llega una inspección, o cuando un cliente reclama su factura.

Ahora se sigue asumiendo homologación —es lo seguro— pero queda registrado.

### El botón "Factura de prueba (1 ARS)"

Estaba en la pantalla de ventas, sin confirmación y sin mirar el entorno. En
producción no es una prueba: emite una factura fiscal real de $1, con número
correlativo consumido, que después hay que dar de baja con una nota de crédito.

Ahora pide confirmación explicando exactamente eso.

### Rechazos intermitentes por redondeo

`getCartTotal` suma flotantes sin redondear: 3 unidades a $1.333,33 dan
`3999.9899999999998`. Ese valor iba como `ImpTotal`, mientras `ImpNeto` e
`ImpIVA` sí se redondeaban. AFIP valida que `ImpTotal` sea exactamente la suma
de los componentes y no admite más de 2 decimales.

El comprobante se rechazaba **solo con ciertos precios**: un fallo intermitente
imposible de diagnosticar desde el mostrador.

> Una verificación anterior de este mismo redondeo dio negativa, porque se probó
> con montos ya redondeados. El problema estaba en el camino de entrada, no en
> la fórmula. Queda anotado como recordatorio de que un test puede confirmar la
> hipótesis equivocada.

### Fechas corridas un día

Tanto la fecha del comprobante como la de la venta se calculaban con
`toISOString()`, que devuelve UTC. Argentina es UTC-3: **a partir de las 21:00
las ventas se asentaban al día siguiente**.

Corre el cierre de caja, el listado del día, los reportes y la fecha declarada.
`Empresa.timezone` ya existía sin usarse; ahora se respeta.

### Numeración duplicada

La numeración es correlativa por punto de venta y se obtenía con un
read-then-write. Dos cajas simultáneas leían el mismo "último autorizado" y
pedían el mismo número: AFIP autoriza uno y rechaza el otro.

Corregido serializando las emisiones por `(empresa, punto de venta, tipo)`.

> **Limitación:** el serializador vive en memoria del proceso. Con una sola
> instancia —la configuración actual en Render— cubre el caso por completo. Al
> escalar a varias instancias hace falta un lock en base o un servicio de
> numeración centralizado.

### El comprobante impreso no cumplía la resolución

Desde abril de 2021 (RG 4892/2020) todo comprobante electrónico debe llevar un
código **QR**. No lo tenía. Tampoco CUIT, domicilio ni condición frente al IVA
del emisor, que exige la RG 1415.

Además:
- El tipo salía de `type === 1 ? 'A' : type === 6 ? 'B' : 'C'`: cualquier otro
  tipo se imprimía como "FACTURA TIPO C", **incluidas las notas de crédito**.
- Al reimprimir desde el historial, las líneas salían `undefined x Producto` y
  `$NaN`: el código leía `item.qty`, pero una venta guardada trae
  `quantity`/`unit_price`.
- El punto de venta estaba fijo en 1.
- El nombre del comercio se leía de `empresaActiva?.nombre`, pero la API
  devuelve `name`: **nunca se llegó a imprimir**.

---

## Lo que está bien

Conviene decirlo, porque el volumen de hallazgos puede dar una impresión
equivocada.

**La parte difícil está resuelta y bien resuelta.** La firma PKCS#7 del TRA con
node-forge, el manejo del ticket WSAA con su cache y expiración, la
construcción del SOAP, el parseo de la respuesta. Eso es lo que hace que una
integración con AFIP sea trabajosa, y está hecho.

También hay una guía de setup escrita para el usuario final
(`docs/GUIA_AFIP.md`) que cubre el trámite completo en ARCA.

Lo que fallaba era la plomería alrededor: los datos que no se guardaban, la
precedencia invertida, el orden de las operaciones. Más barato de arreglar que
lo otro.

---

## Lo que queda pendiente

### Requiere decisión de producto

**Notas de crédito.** No existen. `afipService` ya soporta los tipos 3 y 8, pero
no hay UI ni endpoint. Anular una venta con CAE deja el comprobante vigente ante
ARCA. `taxService` ya expone `anuladas_con_cae_sin_nc` para marcarlas.

**Alícuotas distintas del 21%.** La alícuota está fija. Si el catálogo tiene
alimentos (10,5%) o productos exentos, hace falta el campo en `Product` y
facturación con múltiples `AlicIva`.

**Tipos de comprobante.** Hoy la UI ofrece A, B y C. Faltan notas de débito,
comprobantes M y FCE MiPyME.

**Concepto.** Siempre 1 (productos). Para servicios AFIP exige además
`FchServDesde` y `FchServHasta`.

### Requiere trabajo técnico

**Reconciliación de CAE.** Con el orden invertido el riesgo bajó mucho, pero un
timeout justo después de que AFIP autorizó todavía pierde el CAE. La solución
es un job que compare, por punto de venta, el último número autorizado en AFIP
contra el último guardado, y complete lo que falte con `FECompConsultar`.

**Vencimiento del certificado.** Duran 2 años y no hay ningún aviso. El día que
vence, el comercio deja de poder facturar sin entender por qué.

**Validar que el certificado y la clave sean pareja**, y que el CUIT del
certificado coincida con el configurado. Hoy se aceptan por separado y el error
aparece recién al firmar, como *"Error al firmar el ticket de acceso"*.

**La clave privada sigue en texto plano** en la base (pendiente del Frente 1).

---

## ¿Se probó alguna vez contra homologación?

No hay evidencia. No hay tests de integración, ni scripts de prueba, ni CUITs
de homologación en el código o en los comentarios. El default es
`'homologation'`, lo cual sugiere la intención, pero nada indica que el
circuito completo se haya recorrido.

**Es lo primero que hay que hacer antes de que un comercio emita en
producción.** Varios de los hallazgos de esta auditoría —el CSR sin CUIT, la
Factura A sin discriminar IVA, el rechazo por redondeo— habrían aparecido en la
primera prueba contra homologación.

---

## Nota sobre el método

De los 67 hallazgos, se corrigieron los 10 críticos y los altos con impacto
fiscal directo. **Cada uno se verificó a mano antes de tocar código**: se leyó
el archivo en la línea citada, se comprobó el mecanismo y, donde se podía, se
reprodujo.

Cuatro fueron refutados por el verificador. Uno de los confirmados contradecía
una verificación previa mía, y tenía razón: yo había probado la hipótesis con
datos que no reproducían el caso.

Los de severidad media y baja no se verificaron uno por uno. El informe crudo
está en `auditoria-frente3-hallazgos.json`.
