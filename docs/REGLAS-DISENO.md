# Sistema de diseño · AdminApp

**Origen:** maqueta «AdminApp Rediseño» (Claude Design, proyecto
`da78da8f-639e-4489-8c2f-4f0bf0bb2f58`).
**Implementación:** `apps/web/src/index.css`.
**Vigencia:** desde el 1 de agosto de 2026, para todo lo que se construya de acá
en adelante.

Este documento reemplaza a la versión anterior, que tenía cuatro colores y
ninguna regla de uso.

---

## Cómo usarlo

**Todo sale de los tokens de `index.css`.** No se escriben hex en los
componentes. Si una pantalla necesita un color que no está, la pregunta correcta
es si falta un token —y entonces se agrega acá y se discute—, no si conviene un
valor suelto en ese archivo.

Los tokens están expuestos como utilidades de Tailwind: `bg-surface`,
`text-fg-2`, `border-border-2`, `bg-ok-soft`, etc.

```jsx
// Mal: un gris elegido a ojo, que no existe en modo oscuro.
<div className="bg-[#f5f5f5] text-[#666]">

// Bien.
<div className="bg-surface-3 text-fg-2">
```

---

## Filosofía

La maqueta persigue una idea: **un ERP que no parezca un ERP**. En concreto,
tres decisiones que conviene entender antes de copiar estilos.

**Densidad alta, ruido bajo.** Se muestran muchos datos por pantalla, pero el
contraste está reservado para los que importan. Un listado de ventas tiene siete
columnas y solo dos llaman la atención: el total y el estado. El resto está en
`fg-2` o `fg-3`.

**El color significa algo.** Turquesa es *acción*. Verde, amarillo y rojo son
*estado*. Nada se pinta para decorar. Un botón secundario es blanco con borde,
no turquesa claro.

**El número manda.** Todo dato comparable entre filas va en monoespaciada con
`tabular-nums`. Es la diferencia entre una tabla que se escanea de un vistazo y
una en la que hay que leer cada fila.

---

## Color

### Superficies

| Token | Claro | Oscuro | Cuándo |
|---|---|---|---|
| `background` | `#F6F7F8` | `#0A0C0D` | Fondo de la aplicación |
| `surface` | `#FFFFFF` | `#131719` | Tarjetas, barra lateral, encabezado |
| `surface-2` | `#FAFBFB` | `#171B1E` | Encabezado de tabla, campo en reposo, hover de fila |
| `surface-3` | `#F1F3F4` | `#1E2326` | Hover de botón fantasma, `kbd`, chips |

Tres niveles y no dos: sin el tercero, cada hover termina siendo un gris
inventado en el momento.

### Texto

| Token | Claro | Oscuro | Cuándo |
|---|---|---|---|
| `foreground` | `#101418` | `#EDF0F2` | Contenido, títulos, valores |
| `fg-2` | `#5A646E` | `#98A3AC` | Descripciones, datos secundarios, metadatos |
| `fg-3` | `#8B959E` | `#6C777F` | Etiquetas de columna, íconos en reposo, placeholders |

### Bordes

| Token | Claro | Oscuro | Cuándo |
|---|---|---|---|
| `border` | `#E5E8EA` | `#262C30` | Separadores y contornos en reposo |
| `border-2` | `#D5DADE` | `#333A3F` | Hover de un control que se puede tocar |

Que el borde se oscurezca al pasar el mouse es la señal de «esto responde». Un
control que no cambia nada al hover se lee como decoración.

### Marca

| Token | Claro | Oscuro |
|---|---|---|
| `brand` | `#00B4B6` | `#00C2C4` |
| `brand-dark` | `#008B8E` | `#00B4B6` |
| `brand-soft` | `#E4F6F6` | `#0E2C2D` |
| `brand-line` | `#9FE0E0` | `#1C4E4F` |
| `brand-deep` | `#0B3055` | — |

`brand` es la acción principal y el ítem activo. `brand-soft` + `brand-line` es
el fondo de un avatar o de un ítem seleccionado. **`brand` nunca se usa como
fondo de una zona grande**: es un acento.

### Estados

Cada estado tiene tres tonos, y se usan juntos:

| Estado | Texto | Fondo | Línea | Significa |
|---|---|---|---|---|
| `ok` | `#0F7B45` | `ok-soft` | `ok-line` | Confirmado, aprobado, al día |
| `warn` | `#9A5B08` | `warn-soft` | `warn-line` | Requiere atención, vence pronto |
| `danger` | `#C42B2B` | `danger-soft` | `danger-line` | Falla, vencido, anulado |
| `info` | `#1F5FA8` | `info-soft` | `info-line` | Informativo, en proceso |

```jsx
<span className="inline-flex items-center gap-1.5 rounded-md border
                 border-ok-line bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
  Aprobada
</span>
```

**Nunca un color de estado suelto.** Texto de color sobre el fondo de la tarjeta,
sin fondo suave ni línea, se lee como un error de estilo.

---

## Tipografía

**Inter** para todo. **JetBrains Mono** para números y códigos.

| Rol | Tamaño | Peso | Tracking |
|---|---|---|---|
| Título de pantalla (`h1`) | 24px | 660 | −0.022em |
| Título de sección (`h2`) | 14px | 640 | −0.01em |
| Descripción bajo el título | 13.5px | 400 | — |
| Cuerpo / celda | 13.5px | 400 | — |
| Etiqueta de columna (`.eyebrow`) | 10.5px | 600 | +0.07em, mayúsculas |
| Valor destacado (KPI) | 26px | 600 mono | −0.03em |

Los pesos intermedios (640, 660) no son un capricho: un `h1` en 700 con tracking
normal se lee como titular de marketing. La maqueta busca que se lea como una
herramienta.

### Cuándo monoespaciada

Todo lo que el usuario vaya a **comparar entre filas** o **dictar por teléfono**:
importes, cantidades, stock, CUIT, CAE, número de comprobante, hora, código de
error. Usar la clase `.num`, que además fija `tabular-nums`.

```jsx
<span className="num text-sm font-semibold">$1.234.567,89</span>
```

Los nombres, descripciones y etiquetas **no** van en mono.

---

## Medidas

| Cosa | Valor |
|---|---|
| Alto del encabezado | 60px |
| Ancho de la barra lateral | 240px abierta · 60px contraída |
| Radio de tarjeta | 12px (`rounded-xl`) |
| Radio de control | 8-9px (`rounded-lg`) |
| Radio de badge | 6px (`rounded-md`) |
| Alto de botón | 34px (acción de pantalla) · 36px (filtro) · 29px (ícono en tabla) |
| Alto de campo | 36px |
| Padding de tarjeta | 16-20px |
| Padding de fila de tabla | 15px vertical, 20px horizontal |
| Ancho máximo de contenido | 1320px, centrado |
| Separación entre bloques | 24px · 28px en el panel |

Las páginas centran el contenido a 1320px. Sin tope, una tabla en un monitor
ancho deja el ojo viajando de un borde al otro.

---

## Sombras

Tres, por rol:

| Clase | Cuándo |
|---|---|
| `shadow-nivel-1` | Tarjetas, botón principal |
| `shadow-nivel-2` | Menús, popovers, tooltips |
| `shadow-nivel-3` | Paneles laterales y modales |

Ya vienen resueltas para modo oscuro. No usar `shadow-md` de Tailwind: su escala
es otra y se nota al lado de un componente del sistema.

---

## El shell

`App.jsx` arma tres piezas y ninguna pantalla las toca:

| Pieza | Archivo | Qué hace |
|---|---|---|
| Barra lateral | `components/app-sidebar.jsx` | 240px / 60px contraída. Grupos con etiqueta en mayúsculas, ítems de 34px, usuario abajo |
| Encabezado | `components/app-topbar.jsx` | 60px. Miga de pan, selector de empresa y sucursal, tema |
| Navegación | `components/navegacion.js` | La definición de grupos e ítems, **una sola** para la barra y la miga de pan |

Dos decisiones que conviene no revertir sin pensarlo:

- **El selector de empresa y sucursal está en el encabezado, no en la barra.**
  Es contexto de trabajo —«sobre qué datos estoy operando»— y hay que verlo en
  todas las pantallas. Adentro de la barra empujaba la navegación hacia abajo y
  ocupaba lugar permanente para algo que se cambia dos veces por día.
- **La navegación se define una sola vez.** Tener la barra y la miga de pan con
  listas separadas garantizaba que tarde o temprano una pantalla se llamara de
  dos formas distintas.

**Una pantalla nueva no dibuja su propio marco.** Devuelve su contenido y la
ruta lo envuelve en `components/MarcoDePantalla.jsx`, que es el que centra a
1320px, aplica el padding y **tiene el scroll adentro**. El `<main>` del shell
es `overflow-hidden`.

#### La única salvedad: `/pos`

**El punto de venta es la única ruta que no usa `MarcoDePantalla`.** Recibe
`h-full` a secas y administra sus **dos zonas de scroll** propias: el catálogo
por un lado y la lista del ticket por el otro, con la barra de búsqueda y el pie
de cobro siempre a la vista.

No es una preferencia estética. Un ticket que scrollea con la página deja de
estar visible justo cuando tiene ocho ítems, que es cuando hace falta mirarlo; y
un pie de cobro que hay que ir a buscar con la rueda del mouse anula lo que los
atajos de teclado vienen a resolver. Además el POS declara su propio
`min-width` de 1080px, y el desbordamiento horizontal queda **adentro** de la
pantalla, nunca en el `<body>`.

`apps/web/src/tests/marcoDePantalla.test.js` verifica las dos mitades: que
ninguna de las otras rutas se haya quedado sin el marco, y que la lista de
excepciones tenga **exactamente un** elemento. Si mañana otra pantalla necesita
salirse, hay que venir acá y escribirlo — una regla que dice «todas las
pantallas» y tiene una excepción no escrita deja de ser una regla, y la
siguiente se resuelve a mano y distinta **sin que nada lo detecte, porque no hay
test visual**.

## Patrones

### Encabezado de pantalla

Todas las pantallas arrancan igual: título, una línea que explica para qué sirve,
y las acciones a la derecha.

**Salvo el punto de venta**, que es la única sin `h1` y sin descripción. La
barra de búsqueda ocupa ese lugar (`AdminApp-Rediseno.dc.html:339-358`) y la
miga de pan del `AppTopbar` ya dice «Punto de venta», así que el título no
informaría nada nuevo. Sesenta píxeles de alto en la pantalla que se usa ocho
horas por día valen más que eso. Es una excepción **de esa pantalla y de ninguna
otra**: si la próxima quiere ahorrarse el encabezado, la discusión es acá.

**Se usa `components/PageHeader.jsx`.** No se escribe a mano:

```jsx
<PageHeader
  titulo="Comparador de proveedores"
  descripcion="Pegá las listas de cada proveedor y mirá quién tiene cada producto más barato."
>
  <button className="...">Exportar</button>
  <button className="...">Nueva comparación</button>
</PageHeader>
```

Las acciones van como `children` y el componente les pone el contenedor.

> **Esto estaba mal escrito hasta el hito 9, y tuvo consecuencias.** El ejemplo
> de acá era el bloque a mano —un `<div>` pelado con `flex gap-2`— y **no
> nombraba `PageHeader` en ninguna parte**. Cuatro pantallas lo copiaron tal
> cual, o sea que **estaban siguiendo el documento**: el desvío no lo introdujo
> quien las escribió, lo introdujo esta página.
>
> Se conserva la nota porque explica por qué esas cuatro no son un descuido y
> por qué migrarlas es una tarea del hito 9 y no un reproche.

La descripción no es relleno: es donde se dice qué hace la pantalla y qué se
espera del usuario. Máximo 60 caracteres de ancho (`max-w-[60ch]`).

**El ícono al lado del `h1`**: va. Un ícono de 18px en `text-fg-3`, el mismo que
la pantalla tiene en la barra lateral, para que el usuario reconozca dónde está
sin leer. Estuvo en siete de doce pantallas hasta el hito 9 porque el documento
no lo decía — mitad y mitad no es deriva, son dos escuelas, y la decisión es
**que lleve ícono**.

### Tarjeta

```jsx
<section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
  <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
    <h2>Título</h2>
    <span className="num rounded-full bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">4</span>
    <div className="flex-1" />
    <button className="text-[12.5px] font-medium text-fg-2 hover:text-brand">Ver todo</button>
  </div>
  <div>…</div>
</section>
```

El contador al lado del título va en mono y con el color del estado que
represente. `overflow-hidden` es lo que hace que las filas no se salgan del radio.

### Tabla

La maqueta **no usa `<table>`**: usa grid, con las mismas
`grid-template-columns` en el encabezado y en las filas. Permite alinear las
columnas y que cada fila sea clickeable entera.

**El marco lo pone `apps/web/src/components/TablaGrid.jsx`**, con cuatro
piezas. Lo aplican **diez** archivos —siete pantallas y tres componentes—, así
que a esta altura es *la* forma de hacer una tabla y no una de dos. Conviene
mirar el que se parezca a lo que se está construyendo:

| Ejemplo | Cuándo mirarlo |
|---|---|
| `pages/InvoicesList.jsx` | Columnas **fijas**: se saben al escribir el archivo |
| `pages/Inventory.jsx` | Columnas que **dependen de los datos**: una por sucursal |
| `pages/Expenses.jsx` | Varias tablas en una pantalla, agrupadas por sucursal |
| `components/SesionesDelEquipo.jsx` | Una tabla chica adentro de otra pantalla |

Los otros seis son `pages/Orders.jsx`, `pages/PurchaseOrders.jsx`,
`pages/Team.jsx`, `pages/Tiendanube.jsx`, `components/BloqueDeDocumentos.jsx` y
`components/GastosVariables.jsx`.

> Hasta el hito 9 esta sección decía «hay **dos** pantallas que lo aplican».
> Eran diez. Un documento que subestima cuánto se usa un patrón invita a no
> usarlo: quien lee «dos» razonablemente concluye que todavía es un experimento.

**El pie de la tabla.** Cuando la tabla pagina, abajo va una franja con cuántas
filas se están viendo de cuántas, y el paginador a la derecha:

**No se escribe a mano**: sale de `components/PieDeTabla.jsx`, que trae la
franja y la paginación juntas.

```jsx
<PieDeTabla
  mostrados={filas.length}
  total={total}
  sustantivo="órdenes"
  pagina={pagina}
  totalPaginas={paginas}
  alCambiarPagina={setPagina}
/>
```

Van juntas porque **son la misma pregunta**. Los botones «1 · 2 · 3» dicen que
hay más páginas; el «de 312» dice cuánto más. Separados, cinco pantallas
terminaron con los botones y solo dos con la franja: quien estaba en la última
página no tenía forma de saber si había llegado al final o si la lista se había
cortado.

El número de la derecha es **el total del servidor**, no la cantidad de filas
cargadas: si son distintos y solo se muestra el segundo, el contador miente hacia
abajo y nada avisa. `Pagination` ya se esconde solo cuando hay una sola página.

> Existía en dos de las cinco pantallas que paginan hasta el hito 9. Las otras
> tres la saltearon porque acá no estaba escrita, aunque la maqueta la dibuja dos
> veces. Ahora que es un componente, saltearla exige escribir más código, no
> menos.

```jsx
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'

// Las columnas las escribe cada pantalla, y son el MISMO string en el
// encabezado y en las filas: si difieren, las etiquetas dejan de estar sobre
// sus datos y se lee un importe bajo «Estado».
const COLUMNAS = '80px 116px minmax(0,1fr) 128px'

<TablaGrid anchoMinimo={1020}>
  <Encabezado columnas={COLUMNAS}>
    <span>Hora</span><span>Tipo</span><span>Cliente</span>
    <span className="text-right">Total</span>
  </Encabezado>

  {filas.map(f => (
    <Fila key={f.id} columnas={COLUMNAS} onClick={() => abrir(f)}>
      <span className="num text-[13px] text-fg-2">{f.hora}</span>
      …
      <span className="flex justify-end gap-0.5">
        <BotonDeFila title="Imprimir" onClick={() => imprimir(f)}>
          <Printer />
        </BotonDeFila>
      </span>
    </Fila>
  ))}
</TablaGrid>
```

| Lo pone el componente | Lo escribe cada pantalla |
|---|---|
| Encabezado en `surface-2` con `.eyebrow` y padding `11px 20px` | Cuáles son las columnas y qué dice cada celda |
| Filas con padding `15px 20px`, `border-b border-border`, hover a `surface-2` y `cursor-pointer` | El `grid-template-columns` y el ancho mínimo |
| 16px de separación entre columnas, idéntica arriba y abajo | La opacidad de una fila apagada, los badges, los `.num` |
| Botones de ícono de 29px, `rounded-lg`, `fg-3` → `surface-3`/`foreground`, ícono de 15px | Qué acciones hay y qué hace cada una |
| Que un botón de fila **frene la propagación** del clic | — |
| El scroll horizontal dentro de la tarjeta | — |

**El componente no recibe una definición de columnas.** No hay `columnas={[…]}`
con renderers: con una sola pantalla construida no hay evidencia de qué
necesitan las otras cinco, y esta ya pide fila clickeable, opacidad al 55 %,
una celda de dos líneas, otra alineada a la derecha y botones que frenan el
clic. Cada una de esas se vuelve un prop, y para la sexta pantalla el
componente tiene dieciocho props y nadie se anima a tocarlo.

Lo demás sigue igual: importes alineados a la derecha y en mono; acciones al
final; **cero hex y cero `dark:`**, que verifica
`apps/web/src/tests/guardiasDeDiseno.test.js` — cuando una pantalla nueva
aplique el patrón, se agrega a la lista de esa guardia. Se agrega **antes** de
reescribirla, no después: así cada hex y cada `dark:` falla en el momento en que
se escribe, y no treinta juntos al final, cuando ya nadie sabe cuál vino de
dónde y la salida barata es comentar la guardia.

#### Lo que agregó Inventario, y que las otras cuatro van a necesitar

**1. La columna de selección va al principio del string.** Cuando la pantalla
tiene una acción masiva —«Actualizar precios» en Inventario—, la casilla es una
columna más y mide `32px`:

```js
const COLUMNAS = (n) =>
  `32px minmax(0,1.6fr) 116px 116px 104px 104px ${'92px '.repeat(n)}56px`
```

La casilla frena la propagación del clic (`onClick={(e) => e.stopPropagation()}`
en su celda): seleccionar y abrir el panel son dos gestos distintos sobre la
misma fila.

**2. Las columnas variables se resuelven con una función, no con dos strings.**
`COLUMNAS(n)` y `ANCHO_MINIMO(n)` reciben cuántas columnas variables hay. El
ancho mínimo crece con ellas —`848 + 108 * n`, que son los 92px de la columna más
los 16 de separación—, porque si no la tabla se comprime en vez de scrollear.

**Hay un tope de tres columnas variables a la vez**, y con más, un selector de
cuáles comparar. No es cosmético: con cinco columnas la tabla scrollea horizontal
y comparar dos números que ya no se ven juntos es exactamente el problema que la
comparación viene a resolver.

**3. El badge de nivel.** Una cantidad que además dice si está bien, tres tonos
juntos y nunca un color de estado suelto:

```jsx
const tonoDeStock = (cantidad, minimo) => {
  if (cantidad <= 0) return 'border-danger-line bg-danger-soft text-danger'
  if (minimo > 0 && cantidad <= minimo) return 'border-warn-line bg-warn-soft text-warn'
  return 'border-border bg-surface-3 text-fg-2'
}
```

Es un caso de **«Badge de estado»**, que tiene sección propia más abajo: la forma
—función pura, tres clases juntas, nada de `variant`— es la misma para el stock,
para el saldo de un proveedor y para el que venga.

**4. `Tooltip` para lo que no entra en la celda.** En 92px entra una cantidad y
nada más. El mínimo y el valorizado van en el tooltip
(`components/ui/tooltip.jsx`, el proveedor ya está montado en `main.jsx`) y **no
apilados en la celda**: tres cifras por columna por fila vuelven la tabla
ilegible justo cuando hay tres columnas, que es cuando importa. Lo que no entra
en la celda y hace falta completo va al panel y al archivo exportado.

Sin esto escrito, la tercera pantalla resuelve el ancho variable a mano y queda
distinta — y **nada lo detectaría, porque no hay test visual**.

### Badge de estado

Un dato que además dice **cómo está**: el stock contra su mínimo, el saldo de un
proveedor, el estado de una orden de compra. Aparece en dos pantallas, así que la
forma se escribe acá una vez.

**La forma son cuatro reglas:**

**1. Una función pura devuelve las TRES clases juntas**, en un solo string:
`border-…-line`, `bg-…-soft` y `text-…`. Nunca una sola. Un color de estado
suelto sobre el fondo de la tarjeta se lee como un error de estilo, no como un
estado — es la regla de «Estados», más arriba, aplicada a un componente.

```js
// apps/web/src/utils/cuentaDeProveedor.js
const TONOS = {
  sin_movimientos: 'border-border bg-surface-3 text-fg-2',
  saldado:         'border-ok-line bg-ok-soft text-ok',
  pago_parcial:    'border-warn-line bg-warn-soft text-warn',
  con_deuda:       'border-danger-line bg-danger-soft text-danger',
}

export function tonoDeProveedor(estado) {
  // Un estado desconocido cae en el tono neutro y NO devuelve undefined: una
  // fila con el badge sin pintar es un bug visible; un `className` con
  // `undefined` adentro es una pantalla rota.
  return TONOS[estado] || TONOS.sin_movimientos
}
```

**2. El estado se calcula aparte del color**, y también puro:

```js
export function estadoDeProveedor({ deuda, pagado, saldo } = {}) { … }

// En la pantalla, siempre así: el tono recibe el CÓDIGO, no el objeto.
<span className={`… ${tonoDeProveedor(estadoDeProveedor(cuenta))}`}>
```

Son dos funciones y no una porque el estado se usa además para la etiqueta, para
ordenar y para los tests; el color es solo una de sus consecuencias.

**3. Y por eso NO es una variante de `Badge`.** Un `<Badge variant="danger">`
obliga a que alguien elija la variante en el JSX, y el tono acá **depende de un
cálculo** —el signo del saldo, el umbral del stock, el estado de la orden—, no de
una decisión de quien escribe la fila. Con `variant`, la regla termina escrita en
la pantalla; con dos pantallas, escrita dos veces; y el día que el umbral cambie,
cambia en una sola. Ya pasó: `VARIANTE_POR_TONO` fue el puente entre el `tono` del
sistema y el `variant` de shadcn, y existió justamente porque la traducción estaba
en dos lugares.

**4. Las etiquetas van al lado de los tonos**, en el mismo archivo y con las
mismas claves:

```js
export const ETIQUETAS = {
  sin_movimientos: 'Sin movimientos',
  saldado: 'Saldado',
  pago_parcial: 'Pago parcial',
  con_deuda: 'Con deuda',
}
```

Así, agregar un quinto estado sin su etiqueta es imposible: el badge dibujaría el
código crudo, que es lo que ya pasó con `tc3` en los comprobantes.

**Dónde mirarlo funcionando**: `utils/cuentaDeProveedor.js` (el saldo),
`utils/inventario.js` → `tonoDeStock` (el stock) y `utils/ordenDeCompra.js` →
`ESTADOS` (los cuatro estados de una orden, cada uno con su `tono`, que
`components/PanelOrdenDeCompra.jsx` traduce a clases con `CLASES_POR_TONO` en **un
solo lugar** y las dos pantallas importan de ahí en vez de escribir su copia).

**Por qué esto está escrito y no solo hecho**: un patrón que se repite en dos
pantallas y no está documentado es un patrón que la tercera resuelve distinto, y
**nada lo detectaría** — la guardia de `guardiasDeDiseno.test.js` prohíbe colores
fuera del sistema, no formas distintas de usarlos.

### Botones

| Tipo | Estilo |
|---|---|
| Principal | `bg-brand text-white hover:bg-brand-dark shadow-nivel-1`, 34px |
| Secundario | `border border-border bg-surface hover:bg-surface-3`, 34px |
| Filtro | Igual que el secundario, 36px, con ícono a la izquierda y chevron a la derecha |
| Fantasma | Sin borde, `hover:bg-surface-3` |
| Ícono en tabla | 29px, `rounded-lg`, `text-fg-3 hover:bg-surface-3 hover:text-foreground` |
| Destructivo | `text-danger hover:bg-danger-soft` |

**Un botón principal por pantalla.** Si hay dos, uno de los dos no lo es.

### Panel lateral (sheet)

Para el detalle de un registro: 520px, `max-w-[92vw]`, `shadow-nivel-3`, entra
con `anim-panel`. Se prefiere al modal cuando el usuario tiene que ver el
detalle **sin perder la lista** —que es casi siempre en un listado.

### Estado vacío

Nunca una tabla vacía a secas, y **nunca escrito a mano**: sale de
`components/EstadoVacio.jsx`.

```jsx
<EstadoVacio
  icono={PackageCheck}
  codigo="sin_faltantes"
  titulo="No falta nada."
  detalle="Ningún producto está por debajo de su mínimo."
/>
```

> **Hasta el hito 9 había SEIS formas de dibujar esto**: tres funciones llamadas
> `EstadoVacio` —dos idénticas salvo el ícono— y tres pantallas que lo hacían a
> mano, **las tres sin ícono**. Y el snippet de acá arriba tampoco lo tenía,
> aunque su propio párrafo lo pedía: lo que se copia es el snippet, no la prosa.
>
> El ícono **no es decoración**: sin él, un bloque con dos renglones de texto
> gris se lee como un error y no como «esto está vacío». Por eso el componente
> tiene un valor por omisión y no un `icono &&` — con el opcional, la mitad de
> las pantallas se lo iba a olvidar, que es exactamente lo que pasó.
>
> ⚠ **El día 1 las doce pantallas están vacías.** Los estados vacíos no son un
> caso de borde: son la primera pasada completa que ve el dueño del comercio
> cuando abre el sistema por primera vez.

**Y son dos estados distintos, no uno.** «Todavía no hay nada cargado» y «el
filtro no devolvió nada» se ven parecido y significan cosas opuestas: el primero
invita a cargar el primero, el segundo a sacar el filtro. Dibujarlos igual deja
al usuario buscando datos que sí existen.

```jsx
{hayFiltro ? (
  <EstadoVacio
    icono={FilterX}
    codigo="filtro_sin_resultados"
    titulo="Ninguna orden coincide con el filtro."
    detalle="Probá con otro período o sacá la búsqueda."
  >
    <button onClick={limpiar}>Limpiar filtros</button>
  </EstadoVacio>
) : (
  <EstadoVacio
    icono={ClipboardList}
    codigo="sin_ordenes"
    titulo="Todavía no hay órdenes de compra."
    detalle="Creá la primera con «Nueva orden»."
  />
)}
```

`codigo` sale como `data-estado-vacio` para que un test pueda distinguir los dos
sin depender del texto.

⚠ **Y ninguno de los dos se dibuja mientras los datos viajan.** Un vacío que
aparece durante la carga afirma algo que la pantalla todavía no sabe — y lo
afirma justo cuando el usuario está formando su primera impresión. Ver
«Carga», más abajo.

---

## Movimiento

Dos animaciones, y ninguna más:

- `anim-subida` — entrada de una vista (8px hacia arriba, 220ms).
- `anim-panel` — entrada de un panel lateral (28px desde la derecha, 220ms).

Las dos se desactivan con `prefers-reduced-motion`. No hay animaciones de
hover más allá del cambio de color: en una pantalla que se usa ocho horas por
día, el movimiento cansa.

**`anim-subida` va en el elemento raíz de toda pantalla.** No es decoración: es
lo que hace que cambiar de sección se sienta como un cambio y no como un salto.
Faltaba en cuatro de las doce hasta el hito 9.

---

## Carga

**La pantalla se dibuja siempre; lo que falta es el cuerpo.** El encabezado, los
filtros y el marco de la tarjeta se pintan de entrada, y adentro va el indicador.
Reemplazar la pantalla entera por un spinner hace que el usuario vea desaparecer
lo que acababa de mirar.

```jsx
<PageHeader titulo="Órdenes de compra" descripcion="…" />

<section className="…">
  {cargando ? (
    <div className="grid place-items-center py-16">
      <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
    </div>
  ) : filas.length === 0 ? (
    <Vacio … />
  ) : (
    <TablaGrid>…</TablaGrid>
  )}
</section>
```

⚠ **El orden de esas tres ramas no es negociable, y es el defecto más caro que
encontró el hito 9.** Con el vacío antes que la carga —o sin guardia de carga—,
la pantalla afirma «Todavía no hay proveedores. Cargá el primero» **mientras los
cuarenta viajan por la red**. El usuario lee que su sistema está vacío en el
momento exacto en que se está formando la primera impresión.

Pasaba en dos pantallas, y `pages/Expenses.jsx` ya lo había resuelto con siete
líneas de comentario explicando el caso: **la corrección existía y no se llevó a
las otras.** Por eso está escrita acá y no solo allá.

**Los permisos también tardan.** `usePermission` devuelve `false` para todo hasta
que llega el contexto, así que un control que se esconde sin permiso **aparece
tarde** y uno que se deshabilita **afirma que no tenés permiso antes de saberlo**.
Mientras el contexto no llegó, la pantalla está cargando: vale la misma regla.

---

## Foco

Toda cosa que se pueda apretar tiene que verse cuando llega el teclado.

```
focus-visible:border-brand focus-visible:outline-none
```

Es el vocabulario del sistema: **se reemplaza el anillo por 1px de borde de
marca**, que no mueve el layout ni desborda de una celda de tabla. Los anillos
(`focus-visible:ring-*`) son de shadcn y quedan solo dentro de
`components/ui/`.

**Los botones escritos a mano lo declaran igual.** Las constantes
`BOTON_PRINCIPAL` / `BOTON_SECUNDARIO` de cada pantalla llevan foco: sin eso
quedan con el contorno del navegador teñido por el `outline-ring/50` global, que
sobre `bg-brand` es turquesa sobre turquesa.

**Y una fila clickeable tiene que ser alcanzable.** Una fila que abre un panel es
un control, no un renglón: lleva `role="button"`, `tabIndex={0}` y responde a
`Enter` y `Espacio`. Hasta el hito 9 eran `<div>` con `onClick`, así que **seis
pantallas solo se podían usar con mouse** — y el propio código lo mencionaba como
ventaja de una excepción («encima le da teclado gratis, que las filas de grid no
tienen») sin verlo como defecto del patrón.

---

## Controles apagados

**Se deshabilitan con el motivo, no se esconden.** Una acción que desaparece deja
al usuario sin saber por qué en unas filas está y en otras no; una apagada con su
explicación le dice qué le falta y qué pedir.

```jsx
<BotonDeFila
  disabled={!puedeAnular}
  title="No se puede anular: el comprobante tiene CAE y sigue vigente ante ARCA"
>
```

⚠ **Nunca `disabled:pointer-events-none`.** Saca al elemento del hit-testing y
con eso el navegador **nunca muestra el `title`** — o sea que apaga justamente la
explicación que la regla de arriba pide. Va `disabled:cursor-not-allowed`, y el
atributo `disabled` ya bloquea el clic por su cuenta.

Estuvo en veinte lugares hasta el hito 9, y el peor era `TablaGrid.jsx`, que lo
multiplicaba por seis pantallas. Lo cuida una guardia en `guardiasDeDiseno.test.js`.

**Y el mensaje nombra el permiso**, no lo parafrasea: «Necesitás el permiso
`proveedores.editar`». Quien lee «no tenés permiso para esto» no puede pedir nada
concreto.

---

## Modo oscuro

Los tokens ya lo resuelven. **Una pantalla nueva no debería necesitar ni una
regla `dark:`.** Si la necesita, es que usó un color fuera del sistema — eso es
lo que hay que corregir, no agregar la variante.

---

## Teclado

**Todo lo que se puede apretar se puede apretar sin mouse.** Un `<div>` con
`onClick` no alcanza: no entra en el recorrido del tabulador, no se anuncia como
botón y no responde a Enter ni a Espacio.

La regla operativa es corta: **si es apretable, es un `<button>`**. Cuando no
puede serlo —una fila de tabla es un grid y meterla en un `<button>` rompe las
columnas— lleva las cuatro cosas:

```jsx
<div
  role="button"
  tabIndex={0}
  onClick={abrir}
  onKeyDown={(evento) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return
    // Solo si el foco está acá: el `keydown` de un botón de adentro burbujea.
    if (evento.target !== evento.currentTarget) return

    evento.preventDefault()   // el Espacio hace scroll de la página
    abrir(evento)
  }}
  className="… focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
>
```

Las cuatro, y no tres: sin `tabIndex` nunca recibe el foco, sin `role` se anuncia
como un `<div>`, sin `onKeyDown` no hace nada, y **sin marca de foco visible no
se sabe dónde se está parado** — que es lo que convierte «se puede tabular» en
«se puede usar».

⚠ Y **solo si es apretable**. Una fila de datos con `role="button"` y `tabIndex`
son veinticinco paradas por página prometiendo una acción que no existe.

> Hasta el hito 9, `TablaGrid.Fila` era un `<div>` con `onClick` y nada más:
> abrir el detalle de una venta, un producto, un gasto, una orden, un miembro o
> una variante de TiendaNube era **exclusivamente con mouse, en seis
> pantallas**. En `pages/` y `components/` enteros no había un solo `tabIndex`.
>
> Y el repositorio lo sabía: `pages/Orders.jsx` justificaba que su lista de
> proveedores fueran `<button>` reales diciendo textual «encima le da teclado
> gratis, **que las filas de grid no tienen**». Estaba escrito como ventaja de
> una excepción, nunca como defecto del patrón.
>
> **Cinco lentes de coherencia no lo vieron**, y el motivo vale más que el
> defecto: las cinco comparan pantalla contra pantalla. Encontraron `role="alert"`
> y `disabled:pointer-events-none` —que también son accesibilidad— pero llegaron
> por «esta pantalla difiere de aquélla», no por «esto no se puede usar sin
> mouse». **Una lente de coherencia es ciega a lo que está mal en las doce por
> igual.**

---

## Buscador

Un campo de búsqueda lleva **lupa a la izquierda** y un `placeholder` que dice
el verbo:

```jsx
<div className="relative">
  <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-3" />
  <input
    aria-label="Buscar variantes"
    placeholder="Buscar por nombre o SKU…"
    className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13.5px]
               transition-colors focus-visible:border-brand focus-visible:outline-none"
  />
</div>
```

**Sin lupa, un campo no se lee como buscador**: se lee como un campo más que hay
que completar. Y el `placeholder` nombra la ACCIÓN, no el dato: «Nombre o SKU»
dice qué se escribe pero no dice que sirva para buscar.

`pointer-events-none` en la lupa: sin eso, hacer clic sobre el ícono no enfoca el
campo, que es donde la mayoría hace clic.

**El rebote sale de `utils/busqueda.js`.** Había cuatro números distintos —250,
250, 300 y 350— en cuatro pantallas. La diferencia no se nota mirando una: se
nota al pasar de una a otra, y un buscador que responde a distinta velocidad
según la pantalla se lee como que unas están más pesadas que otras.

> Hasta el hito 9, el buscador de TiendaNube era el único sin lupa y su
> `placeholder` decía «Nombre o SKU»; el de fichas de cliente del punto de venta
> tampoco tenía ícono.

---

## Avisos que hay que anunciar

Todo bloque que dice que **algo falló** lleva `role="alert"`:

```jsx
{error && (
  <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3">
    <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" />
    <p className="text-[13px] text-danger">{error}</p>
  </div>
)}
```

Sin el `role`, con un lector de pantalla **nadie se entera de que la carga
falló**: la persona sigue esperando datos que no van a llegar, y el único
indicio es visual. Es peor que ver el error — un error visible se lee y se
reintenta; uno que no se anuncia deja a alguien esperando indefinidamente algo
que ya falló.

> Faltaba en cinco lugares hasta el hito 9. Dos de ellos —el panel de recepción
> de una orden y el historial de costos— avisan que **una operación que escribe
> datos** no se completó.

---

## Íconos

`lucide-react`, trazo 1.7-1.8, tamaño 14-17px según el contexto (14px en
botones de filtro, 16.5px en la barra lateral, 17px en el encabezado). Los
íconos decorativos van en `fg-3`; los que forman parte de un estado toman el
color de ese estado.

---

## Referencia viva

`apps/web/src/pages/Comparador.jsx` está construida con estas reglas de punta a
punta: encabezado de pantalla, tarjetas, tabla en grid, badges de estado,
estados vacíos y panel de detalle. Cuando algo de este documento no se entienda,
mirar ahí.

## Logotipo

- `logo.png` — solo el ícono (favicon, login, navegador)
- `logo_sin_fondo.png` — ícono sin fondo, para la barra lateral (28px, radio 7px)
- `Logo_nombre_frase.png` — logotipo completo con nombre y bajada
