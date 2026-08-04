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

```jsx
<div className="flex flex-wrap items-end justify-between gap-6">
  <div>
    <h1>Comparador de proveedores</h1>
    <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">
      Pegá las listas de cada proveedor y mirá quién tiene cada producto más barato.
    </p>
  </div>
  <div className="flex gap-2">
    <button className="...">Exportar</button>
    <button className="...">Nueva comparación</button>
  </div>
</div>
```

La descripción no es relleno: es donde se dice qué hace la pantalla y qué se
espera del usuario. Máximo 60 caracteres de ancho (`max-w-[60ch]`).

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
piezas. Hay **dos** pantallas que lo aplican, y conviene mirar la que se parezca
a la que se está construyendo:

| Ejemplo | Cuándo mirarlo |
|---|---|
| `pages/InvoicesList.jsx` | Columnas **fijas**: se saben al escribir el archivo |
| `pages/Inventory.jsx` | Columnas que **dependen de los datos**: una por sucursal |

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

**4. `Tooltip` para lo que no entra en la celda.** En 92px entra una cantidad y
nada más. El mínimo y el valorizado van en el tooltip
(`components/ui/tooltip.jsx`, el proveedor ya está montado en `main.jsx`) y **no
apilados en la celda**: tres cifras por columna por fila vuelven la tabla
ilegible justo cuando hay tres columnas, que es cuando importa. Lo que no entra
en la celda y hace falta completo va al panel y al archivo exportado.

Sin esto escrito, la tercera pantalla resuelve el ancho variable a mano y queda
distinta — y **nada lo detectaría, porque no hay test visual**.

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

Nunca una tabla vacía a secas. Ícono apagado, una línea de qué pasa y otra de
qué hacer:

```jsx
<div className="py-12 text-center">
  <p className="font-semibold">No falta nada.</p>
  <p className="mt-1 text-sm text-fg-2">
    Ningún producto está por debajo de su mínimo.
  </p>
</div>
```

---

## Movimiento

Dos animaciones, y ninguna más:

- `anim-subida` — entrada de una vista (8px hacia arriba, 220ms).
- `anim-panel` — entrada de un panel lateral (28px desde la derecha, 220ms).

Las dos se desactivan con `prefers-reduced-motion`. No hay animaciones de
hover más allá del cambio de color: en una pantalla que se usa ocho horas por
día, el movimiento cansa.

---

## Modo oscuro

Los tokens ya lo resuelven. **Una pantalla nueva no debería necesitar ni una
regla `dark:`.** Si la necesita, es que usó un color fuera del sistema — eso es
lo que hay que corregir, no agregar la variante.

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
