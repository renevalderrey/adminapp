# Hito 9 · El recorrido de coherencia

**Fecha del recorrido:** 7 de agosto de 2026.
**Estado:** recorrido hecho y filtrado. **Tandas 1 a 4 cerradas**, más el bloque
del teclado de la sección 4. Los dos pendientes de la sección 4 —el selector
de sucursal (bloque D) y el ancho mínimo (bloque C)— **también quedaron
cerrados**.

> ## Lo que quedó hecho, y lo que enseñó
>
> Los cuarenta y nueve hallazgos se corrigieron con test y mutación cada uno. Lo
> que importa para el próximo recorrido no es la lista: es **el patrón de lo que
> apareció al corregir**, porque en todos los casos era más grande que el
> hallazgo.
>
> | Se buscaba | Apareció |
> |---|---|
> | El doble pago | `useConfirmDialog` perdía el `resolve` anterior: el handler quedaba colgado **para siempre**, con sus cerrojos tomados |
> | Los días del certificado en dos pantallas | **Los dos** estaban mal, cada uno a su manera |
> | El ícono del estado vacío en tres | **Seis** formas de dibujarlo, y el snippet del documento tampoco lo tenía |
> | `role="alert"` en tres | Faltaba en **cinco**; los dos nuevos avisan que una escritura falló |
> | La lupa de TiendaNube | Un segundo buscador sin ella, **en el pie del cobro** |
> | El contador de órdenes | El doble de prueba devolvía `total = data.length`: **no podía ver el defecto** |
> | La frase del permiso | Escrita a mano en dieciocho lugares, y **ya divergida** |
> | Medir el ancho mínimo | Un **500 en el log de la API**: un GET que rompe la primera vez que dos pedidos llegan juntos — y buscando su molde apareció el mismo defecto en el primer ingreso de un usuario nuevo |
>
> **Cuatro cosas para la próxima vez:**
>
> 1. **Una lente de coherencia es ciega a lo que está mal en las doce por
>    igual.** El teclado —seis pantallas operables solo con mouse— no lo
>    encontró ninguna de las cinco, y estaba escrito en el código como ventaja
>    de una excepción.
> 2. **Un hallazgo falso cuesta más que ninguno**: enseña a no leerlos. Tres
>    guardias de este hito dieron falsos y hubo que rehacerlas mirando la salida
>    en vez de confiar en el regex.
> 3. **La mutación es lo único que dice si un test vale.** Uno del cerrojo de
>    pagos pasaba con y sin el cerrojo, y el motivo era otro defecto que lo
>    tapaba.
> 4. **Un defecto encontrado vale menos que su molde.** El 500 de
>    `taxService.getConfig` era un `findOne` + `create` donde va `findOrCreate`.
>    Buscar esa forma en todo el servidor devolvió cuatro lugares: dos falsos
>    positivos —anotados con su motivo— y uno más que era real, en
>    `middleware/auth.js`. Ése es **el primer ingreso de alguien nuevo**: dos de
>    los pedidos que el navegador manda juntos alcanzan para que la aplicación
>    no abra, en el único momento que no se puede reintentar sin que la persona
>    piense que el sistema no anda.

Las doce pantallas se rediseñaron en **cuatro hitos distintos**, con semanas de
diferencia. Este documento es el resultado de recorrerlas juntas buscando **lo
que quedó distinto sin que nadie lo decidiera**.

> **Por qué existe este archivo.** El recorrido se hizo con cinco agentes en
> paralelo y quedó en el transcript de un workflow, que es local y no está en
> git. Un transcript no es documentación: si la sesión se cierra o alguien clona
> el repositorio en otra máquina, el trabajo se perdió y hay que rehacerlo. Esto
> es lo que sobrevive.

---

## 1 · El veredicto

**No son cuatro productos que comparten barra lateral. Son dos: nueve pantallas
que hablan el mismo idioma con acento, y tres que no.**

La evidencia a favor de «un solo producto» es la lista misma. De más de sesenta
diferencias examinadas, **catorce se descartaron por no ser defectos** y unas
**treinta ya estaban justificadas por escrito** antes de que nadie las mirara.
Un sistema que puede explicar la mayoría de sus propias divergencias es un
sistema con un solo dueño. Y de las 49 que quedaron, más de la mitad son de una
línea: cuando el desacuerdo más caro que encontrás en doce pantallas es una
animación de entrada, el esqueleto está sano.

Las tres que no:

| Pantalla | Qué le pasa |
|---|---|
| **Faltantes** | Es de otro sistema. **No entró a ningún hito**: no es una pantalla que se desalineó, es una que nunca se alineó. Diez de los 49 hallazgos sobre el 2,5 % del código, y **ninguna red debajo** |
| **Comparador** | Es la referencia que no sigue su propia referencia. Dibuja su marco cuando el documento dice que no se dibuja, escribe su tabla a mano, imprime un ISO crudo, afirma un vacío que no sabe — y **está fuera de la guardia de diseño**. Importa porque `REGLAS-DISENO.md` y `CONVENCIONES.md` **mandan copiar de ahí**: cada desvío suyo es un desvío con interés compuesto |
| **Panel** | Se separó por arriba. **Es la única que reemplaza la pantalla entera al cargar**, entra sin animación, tiene su propia idea de cómo se llaman las otras pantallas, y su propia cuenta de los días del certificado |

---

## 2 · Lo más importante: el producto de este hito es el documento

> Las cuatro escuelas no salieron de que a alguien se le escapara algo. Salieron
> de que **en cuatro momentos distintos alguien buscó la regla, no la encontró
> escrita, y decidió razonablemente**.

**`REGLAS-DISENO.md` se contradice a sí mismo en cuatro lugares verificados:**

1. El snippet de «Estado vacío» **no tiene el ícono** que la prosa de arriba
   pide. De ahí salieron las tres pantallas sin ícono.
2. El snippet del encabezado es el bloque escrito a mano y **no menciona
   `PageHeader`**. De ahí salieron las cuatro pantallas que lo arman a mano —
   que, por lo tanto, **están siguiendo el documento**.
3. La sección «Tabla» dice que **dos** pantallas usan `TablaGrid`. Son **diez**.
4. El ancla de la guardia dice «veintinueve» sobre un `expect` de **30**.

Eso no es un documento vivo: **es el acta del hito 4.**

**Y falta escribir cinco cosas que ningún hito encontró porque no estaban:**

- **La franja del pie de tabla** («Mostrando N de M»). Existe en dos de las cinco
  que paginan y la maqueta la dibuja dos veces. Tres pantallas la saltearon
  porque el documento no la nombra.
- **El ícono del `h1`**: está en **siete de doce**. Mitad y mitad no es deriva,
  son dos escuelas. Hay que decidir una.
- **La regla de esconder contra explicar** un control sin permiso. La convención
  es deshabilitar con el motivo, y no está escrita.
- **La sección de carga**, que no existe: hay **cuatro** formas de dibujar
  «todavía no llegó».
- **La sección de foco**, que tampoco existe: hay **cuatro** vocabularios de
  `focus-visible` y **nueve botones escritos a mano que no declaran foco en
  absoluto**.

**Si este hito corrige el código y no el documento, la pantalla trece va a
inventar la quinta forma — y esta vez con las guardias en verde, que es peor.**

---

## 3 · El reparto, por archivo

Cada bloque es una unidad de trabajo. **Dos bloques nunca tocan el mismo
archivo**, salvo donde se marca.

### Tanda 0 · Habilitadores — sin esto, tres correcciones no se ven

#### B · `components/TablaGrid.jsx:125` — una línea que multiplica por seis

**El defecto no es cosmético.** `disabled:pointer-events-none` **saca al elemento
del hit-testing**, así que el atributo `title` **nunca se muestra**. Y este
repositorio pone en el `title` **el motivo** por el que un control está apagado:

- «No se puede anular: el comprobante tiene CAE y sigue vigente ante ARCA»
- «Necesitás el permiso `proveedores.editar`»

Arriba de la línea que lo causa hay **un comentario de tres líneas** explicando
que la acción se deshabilita **con el motivo** y no se esconde, «porque si
desapareciera, el usuario no entendería por qué en unas filas está y en otras
no». La regla estaba escrita y el CSS la derrotaba en silencio.

`pointer-events-none` es además **redundante**: `disabled` ya bloquea el clic.

Afecta al menos a `InvoicesList.jsx:1191`, `BloqueDeDocumentos.jsx:301`,
`Team.jsx:605,617`, `Expenses.jsx:400,421`, `Tiendanube.jsx:865,873`,
`GastosVariables.jsx:337`, `PanelDeGasto.jsx:238`, `PanelProducto.jsx:812`,
`PanelOrdenDeCompra.jsx:640,663,707`.

**Va primero de todo**: los bloques D y F escriben motivos en `title=` que hoy no
se verían.

#### J · El documento y las guardias

`REGLAS-DISENO.md`, `guardiasDeDiseno.test.js`, `contratosDeApi.test.js`,
`marcoDePantalla.test.js`. Todo lo de la sección 2, más poner al día las cuentas
y **agregar `Comparador.jsx` y `Faltantes.jsx` a la guardia de diseño**, que hoy
están afuera.

Si agregarlos deja la guardia en rojo, **eso es correcto y esperado**: los
bloques que los reescriben tienen que dejarla en verde.

### Tanda 1 · El usuario queda parado, o el sistema escribe mal la plata

Por orden de lo que le cuesta a quien usa el sistema:

1. **El 403 habla en inglés y en código.** `checkPermission` responde `FORBIDDEN`
   y cinco pantallas lo muestran crudo. Un rol de compras arma el pedido entero y
   lee un código en inglés. **Es lo único de la lista que hace que el usuario no
   pueda seguir.** → bloque **C**
2. **Dos clics en «Registrar pago» escriben dos filas** en la cuenta corriente y
   el saldo baja el doble. Es plata. → bloque **D**
3. **La orden creada desde Faltantes queda asentada con el día equivocado** en la
   cuenta del proveedor, y Faltantes no dibuja la fecha: nadie lo ve. → **C**
4. **Comparador le dice al usuario «Pegá la lista de precios» y le esconde el
   único botón para hacerlo.** Es la llamada de soporte «a mí no me sale». → **F**
5. **El lápiz sin permiso**: completar el CUIT, apretar Guardar, comer un 403, y
   ver el tacho de al lado apagado *con su motivo*. La conclusión razonable es
   que el sistema falló. → **D**
6. **Buscar «Perez» no encuentra «Pérez»** y el usuario concluye que la venta no
   está. El motivo escrito de esa excepción ya no vale: `suppliers.js:250-253`
   resolvió lo mismo con `translate()`. → **C**
7. **El mismo botón rojo «Confirmar» para todo.** Pasar a producción fiscal y
   borrar un proveedor con su cuenta corriente usan el mismo diálogo que cinco
   acciones inocuas. El daño no es asustar al primero: **es que el segundo
   aprieta el botón que apretó cinco veces esa mañana para cosas que no borraban
   nada.** → **K**
8. **Dos fechas que mienten hacia el lado que duele**: los días del certificado de
   AFIP se cuentan distinto en el Panel y en Facturación —y de ahí cuelga la
   severidad del aviso—, y una invitación creada a las 22:00 muestra un
   vencimiento un día **posterior** al real, así que alguien la va a intentar
   usar muerta. → **C** y **K**
9. **El papel del ticket y la carga fiscal del mismo comprobante pueden decir días
   distintos.** → **K**
10. **Un contador que miente hacia abajo sin señal de truncado**, y una lista que
    contradice el número que el usuario está viendo en el campo. → **D**, **H**

### Tanda 2 · Friccionan, confunden, o mandan a un lugar que no existe

- **«Ajustes» no es ninguna pantalla**, y aparece en el pie de cobro con un
  cliente enfrente. Se llama «Facturación AFIP». → **K**
- **«Comprobantes» rotula una lista de ventas**, y adentro hay filas que dicen
  «Sin comprobante fiscal». → **G**
- **Las pantallas parafrasean el permiso en vez de nombrarlo**: el usuario no
  puede repetir el código que necesita, así que no lo puede pedir. → **E**, **I**
- **El Panel tiene su propia idea de cómo se llaman las otras pantallas**: alguien
  que lee «Ver comprobantes» y busca esa pantalla no la encuentra. → **I**
- Después de facturar se recarga la lista entera en vez de actualizar la fila
  (**G**); «orden» y «pedido» para la misma cosa (**D**); el rebote del buscador
  (**E**); el desplegable de Exportar (**H**); los rótulos de la barra lateral
  (**F**); las comillas rectas (**E**, **F**).

### Tanda 3 · Coherencia y prevención

- **`anim-subida` falta en cuatro de las doce** (`Orders`, `PurchaseOrders`,
  `Dashboard`, `Faltantes`). Es la corrección más barata y la que más se ve: se
  nota en cada cambio de pantalla.
- **La franja «Mostrando N de M»** falta en tres de las cinco que paginan. Es lo
  único de la lista que **agrega** información: los totales ya existen.
- **El ícono del estado vacío** falta en `Comparador`, `Dashboard` y `Faltantes`.
  Importa más de lo que parece: **el día 1 las doce pantallas están vacías**, así
  que los estados vacíos son la primera pasada completa que ve el dueño.
- **`role="alert"`** falta en `Dashboard.jsx:281`, `Inventory.jsx:645` y
  `EstadoDeTiendanube.jsx:473`: con un lector de pantalla nadie se entera de que
  la carga falló, y sigue esperando datos que no van a llegar.
- **El buscador de TiendaNube no tiene lupa** y es el único de la aplicación sin
  ella. Sin ícono, un campo no se lee como buscador — y su placeholder dice
  «Nombre o SKU», que ni siquiera dice «buscar».

### Tanda 4 · El bloque grande

#### A · `Faltantes.jsx` — 360 líneas, diez de los 49 hallazgos

El 20 % de la lista sobre el 2,5 % del código. **Es indivisible.**

**Orden obligado**: primero la guardia de diseño, después **el test de render que
hoy no existe**, y recién después la reescritura — estrictamente de presentación,
porque esta pantalla **crea órdenes de compra, manda WhatsApp y exporta**, y no
tiene una sola prueba.

---

## 4 · Lo que no miró ninguna de las cinco lentes

Las cinco fueron **dibujo, palabras, comportamiento, números y guardias**. Todas
comparan pantalla contra pantalla **en un instante estático**. Eso dejó afuera
cinco cosas, y son grandes.

### A · El eje del tiempo: los primeros 300 ms

**Comparador y Proveedores afirman un vacío que todavía no saben.**

- `Comparador.jsx:42` arranca `cargando` en `false` y `:173` dibuja
  `listas.length === 0` sin guardia: durante toda la request se lee **«Todavía no
  cargaste ninguna lista»** al lado del spinner.
- `Orders.jsx:318` arranca `cargandoLista` en `true` y `:979` dibuja
  `proveedores.length === 0` sin guardia: la primera impresión de Proveedores es
  **«Todavía no hay proveedores. Cargá el primero»** mientras los cuarenta viajan
  por la red. Igual en `:1177` y `:1281`.

**Y el repositorio ya razonó este defecto**: `Team.jsx:468` y `Expenses.jsx:356`
sí guardan, y Gastos tiene **siete líneas de comentario** explicando exactamente
este error. **Lo corrigió en una pantalla y no lo llevó a las otras. Es el hito 9
en estado puro, y ninguna lente lo trajo.**

Además hay **cuatro formas de dibujar «todavía no llegó»**: reemplazar la
pantalla entera (solo el Panel), spinner en el cuerpo de la tabla, nada, y el
vacío falso. `REGLAS-DISENO.md` no tiene sección de carga, y por eso ninguna
lente la pidió.

**Y los permisos parpadean**: `useStore.js:34` arranca `permisos: []`, así que
`usePermission` devuelve `false` para todo hasta que vuelve el contexto. No hay
tri-estado «todavía no sé».

### B · El teclado — lo más grande que quedó afuera

**`TablaGrid.jsx:86-100`: `Fila` es un `<div>` con `onClick`.** Sin `role`, sin
`tabIndex`, sin `onKeyDown`. En `pages/` y `components/` enteros hay **cero
`tabIndex`, cero `role="button"` y cero `role="row"`**.

**Abrir el detalle de una venta, un producto, un gasto, una orden, un miembro o
una variante de TiendaNube es exclusivamente con mouse, en seis pantallas.**

Y el repositorio lo sabe: `Orders.jsx:947-951` justifica que la lista de
proveedores sean `<button>` reales diciendo textual «encima le da teclado gratis,
**que las filas de grid no tienen**». Está escrito como ventaja de una excepción,
**nunca como defecto del patrón**.

> **Por qué las lentes no lo vieron**: encontraron `role="alert"` y
> `disabled:pointer-events-none`, que son accesibilidad — pero llegaron por «esta
> pantalla difiere de aquélla», no por «esto no se puede usar sin mouse». **Una
> lente de coherencia es ciega a lo que está mal en las doce por igual.**

### C · El ancho de la ventana

Prefijos responsive por pantalla: **InvoicesList 0, Inventory 0, Faltantes 0,
Team 0, Tiendanube 0, Billing 0**, PurchaseOrders 1, Expenses 1, Settings 1,
Comparador 4, Dashboard 7, Orders 10.

Las pruebas de navegador miden **1080 y 1920, y nada más**. `REGLAS-DISENO.md`
fija el máximo (1320px) y **nunca el mínimo**.

No es que haya que hacerlas responsive —es un ERP de escritorio y eso es
defendible—. Es que **el ancho mínimo soportado no está decidido ni medido**, y
la pregunta «¿anda en la notebook de 13″ del contador?» hoy no la contesta nadie.

> ### ✔ Contestada (hito 9)
>
> `marcoDeLasPantallas.navegador.js` ahora recorre las dieciocho pantallas a
> **1280 y a 1920**, y `REGLAS-DISENO.md` declara 1280 como mínimo soportado.
>
> | | |
> |---|---|
> | Pantallas que desbordan a 1280px | **ninguna** |
> | Encabezados que miden lo mismo a 1280 que a 1920 | **17 de 18** |
> | Encabezados que crecen | **1**: Inventario, +58px (80 → 138) |
>
> O sea que la respuesta es **sí**, y lo único que se pierde son 58px de alto
> útil en Inventario, cuya barra de filtros se apila en un renglón más.
>
> ⚠ Lo que había que medir **no era el desborde** —a 1080px ya estaba cubierto,
> y 1080 es más angosto que 1280— sino **el apilado**: todos los encabezados son
> `flex-wrap`, así que nada se rompe, se apila y empuja la tabla fuera de la
> primera pantalla. Nadie lo reporta como defecto porque no falla nada.
>
> ⚠⚠ **La primera versión de la medición medía otra cosa.** Decía que el
> encabezado de Inventario media 2152px, que es el alto de toda la lista de
> productos: el selector subía un `<div>` de más. Un número que sale de medir
> otra cosa se lee igual de bien que uno correcto, y ése es el problema.
>
> Y las instrucciones para correr estas pruebas **estaban incompletas**: sin
> `ALLOWED_ORIGINS=http://localhost:5199` el navegador bloquea el contexto por
> CORS, la aplicación se desloguea sola y las seis pruebas fallan con «no llegó a
> haber `<main>`» — un mensaje que manda a buscar el problema a la sesión falsa,
> que es donde no está. Costó cuatro intentos y quedó escrito.

### D · La costura shell ↔ pantalla: el selector de sucursal

Está dibujado en las doce y **significa una cosa distinta en cada una**. Lo leen
cuatro.

- Inventario e Historial comparten una regla escrita y bien ejecutada: la
  cabecera **siembra** el filtro hasta que el usuario lo toca. **Eso está bien.**
- **Faltantes no tiene esa regla**: es la única donde no se puede pedir «todas las
  sucursales».
- **Ocho lo ignoran.** Para Equipo y Facturación es correcto — pero nada en la
  pantalla lo dice y el control sigue arriba, activo. Solo Gastos declara su
  alcance por escrito.

Hay un control global cuyo efecto va de «vuelve a consultar» a «solo siembra un
filtro» a «no hace nada», **sin ninguna señal**.

### E · Un defecto del método: los hallazgos se puntuaron de a uno

El día 1, con la base vacía, **Comparador acumula tres hallazgos de tres lentes
distintas en los mismos 200 px**: afirma un vacío que no sabe, le esconde al
usuario el único botón que su propio texto le pide apretar, y ese vacío es uno de
los tres sin ícono.

Cada uno se filtró por separado y ninguno quedó en la Tanda 1. **Juntos son la
primera pantalla que ve un cliente nuevo.** El filtro no tiene forma de ver eso
porque puntuó hallazgos, no momentos.

### F · Y lo obvio

**De las doce, las dos únicas sin test de render son la que hay que reescribir
entera y la que el documento manda copiar.** No existen
`renderDeComparador.test.jsx` ni `renderDeFaltantes.test.jsx`.

---

## 5 · Lo que se descartó, y por qué — para no volver a proponerlo

**Catorce diferencias se examinaron y se decidió NO tocarlas.** Están acá para
que nadie las vuelva a levantar como hallazgo nuevo:

| Diferencia | Por qué no |
|---|---|
| Cuatro pantallas arman el encabezado a mano | **Están siguiendo el documento**: el snippet de REGLAS-DISENO *es* el bloque a mano y no menciona `PageHeader`. Lo que hay que corregir es el documento |
| Comparador dibuja su tabla a mano, 1px fuera del sistema | Nadie lo nota, es la única tabla **sin test de render**, y migrarla exige pisar el `cursor-pointer` de `Fila` porque sus filas no son clickeables. No se paga |
| El badge tiene tres alturas y tres cuerpos | 1px de padding y 1px de letra, en pantallas que nunca se ven juntas. Nueve call sites en siete archivos para que un badge de 20px mida 22. **Se cierra alineando el snippet del documento con la maqueta** |
| El segmentado se implementó tres veces | 1px de radio y 1px de padding: un segmento de cuatro solapas mide 8px distinto. Extraerlo toca tres pantallas con tests que los ejercitan, a días de producción |
| La tarjeta de indicador tiene dos etiquetas y tres tamaños | **El reporte se equivoca sobre cuál tiene razón.** No hay una forma copiada mal: hay una jerarquía. El KPI de 26px es el dato principal de un bloque; las tarjetas de 19-22px son resúmenes secundarios que van de a cuatro. Aplanarlas haría que los totales de Gastos compitan con el título |
| Los cuatro anchos de la segunda línea del estado vacío | Invisibles: la frase es distinta en cada pantalla |
| La geometría del aviso de error | 4px de padding. Lo que sí vale es el `role="alert"`, que es accesibilidad y no coherencia |

**Y unas treinta diferencias más ya estaban justificadas por escrito** antes del
recorrido: el punto de venta fuera del marco de 1320px, los cinco formatos de
importe, la clave omitida del Panel, el género de los estados de una orden, el
ticket a 400px. **Aplanarlas empeoraría el producto.**

---

## 6 · Decisiones tomadas

| Qué | Decisión | Quién |
|---|---|---|
| **El teclado** (sección 4·B) | **Se arregla.** Las filas pasan a ser operables con teclado y se escribe la sección de foco que falta. Es un bloque propio: no es coherencia, es una parte del producto que no existe | Usuario |
| **Faltantes** (bloque A) | **Se reescribe, con la guardia y el test de render ANTES.** Estrictamente de presentación: no se toca lo que crea órdenes ni lo que manda WhatsApp | Usuario |

---

## 7 · Estado

**El recorrido está hecho y filtrado. Las correcciones no se empezaron.**

El primer intento de ejecutarlas murió con los nueve agentes por el límite de
gasto mensual de la cuenta; el árbol quedó limpio y no se perdió trabajo.

**Por dónde se retoma**: Tanda 0 (bloques **B** y **J**), que son los
habilitadores — sin ellos, tres correcciones de la Tanda 1 escriben explicaciones
que nadie puede leer.
