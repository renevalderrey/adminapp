# Convenciones · Desarrollo dirigido por especificación

Lo que todo agente SDD tiene que saber antes de escribir una línea. Se lee una
vez por ciclo, no se copia en cada archivo.

---

## Por qué existe este método

No es ceremonia. Los errores más caros de este proyecto salieron de implementar
sin definir:

- La calculadora de punto de equilibrio confundía margen sobre venta con
  recargo sobre costo y **recomendaba precios que garantizan pérdida**,
  etiquetados como «precio de supervivencia». Nadie había escrito qué era un
  margen.
- `sendEmail` devolvía `ok: true` sin haber enviado nada. Las invitaciones se
  perdían en silencio y quien invitaba veía «enviada».
- El paywall era eludible: una empresa sin fila de suscripción tenía acceso
  ilimitado.

Los tres son el mismo error: **nadie escribió qué tenía que pasar**, así que no
había contra qué verificar.

---

## Dónde va cada cosa

```
docs/specs/NNN-nombre-corto/
  spec.md         qué problema resuelve y cómo se sabe que está resuelto
  plan.md         cómo se construye, y qué alternativas se descartaron
  data-model.md   tablas, columnas, relaciones (solo si toca la base)
  contracts/      contratos de API
  tasks.md        tareas ejecutables, cada una verificable
```

El número es correlativo. Mirar qué carpetas existen antes de elegirlo.

---

## El repositorio

Monorepo:

| Ruta | Qué es |
|---|---|
| `apps/api` | Node + Express + Sequelize + PostgreSQL |
| `apps/web` | React + Vite + Tailwind v4 + shadcn |
| `apps/landing` | Sitio público |
| `legacy/` | El sistema viejo de Comprafit. **Referencia, no se ejecuta** |

> Las specs 001 a 008 son anteriores al monorepo y referencian `backend/src/…`.
> La ruta correcta hoy es `apps/api/src/…`. No copiar esas rutas.

### Comandos

```
npm run test:api          # jest
npm run test:web          # vitest
npm run build             # web + landing
npm --prefix apps/api run db:migrate
```

---

## Reglas que no se negocian

### Aislamiento entre empresas

Toda consulta que reciba un identificador del cliente filtra por `empresa_id`.
**Nunca `Model.findByPk(req.params.id)`** — usar `findScoped` de
`utils/tenantScope.js`.

Hay guardias estáticas que fallan si el patrón reaparece
(`src/tests/aislamientoEmpresas.test.js`, `src/tests/observabilidad.test.js`).
Si una guardia falla, el problema es el código nuevo, no la guardia.

Esto no es teórico: la auditoría encontró veinte endpoints filtrando datos
entre clientes, y ocho más aparecieron un mes después.

### Errores

Ningún `catch` responde 500 con `err.message`. Usar `fallo(req, res, err,
'mensaje en castellano')` de `utils/errores.js`: loguea con contexto y no le
manda al cliente nombres de tabla ni de constraint.

Para errores que **sí** son para el usuario —«Stock insuficiente en Depósito
para Harina»— existe `ErrorDeNegocio`.

### Dinero

Todo cálculo con plata se testea con casos de borde: cantidad cero, precio
cero, descuento del 100 %, devolución parcial, producto sin costo.

El total de una venta lo calcula **el servidor** a partir de las líneas. Nunca
se guarda un total que mandó el cliente.

Los importes argentinos se escriben `1.234,50`. Leerlos al revés convierte
$1.234 en $1,234 y no falla nada.

### Diseño

Todo lo visual sale de los tokens de `apps/web/src/index.css`. **Cero hex en
los componentes.** Las reglas completas están en
[REGLAS-DISENO.md](../REGLAS-DISENO.md); la referencia viva es
`apps/web/src/pages/Comparador.jsx`.

### Módulos no liberados

Clientes, recetas, producción, caja, impuestos y reportes existen solo para
superadmin. El gate va en los tres lados: barra lateral, `RouteGuard` y **API**
(`requireSuperadmin`). Solo en el menú es cosmética.

---

## Cómo se escribe acá

**Los comentarios explican el porqué, no el qué.** El código ya dice qué hace.
Lo que se pierde con el tiempo es por qué se eligió así y qué pasaba antes:

```js
// Mal
// Recorre los productos y actualiza el costo
for (const p of productos) { … }

// Bien
// El costo se propaga a las recetas que usan este producto como insumo. Sin
// esto, un producto elaborado seguiría costeado con el precio viejo y el
// margen que muestra el POS sería mentira.
for (const p of productos) { … }
```

**En castellano**, como el resto del repositorio. Nombres de variables y
funciones nuevas también.

**Los tests documentan el bug que evitan.** Un test llamado `it('funciona')` no
dice nada; `it('NO lee 1.234 como 1,234')` explica qué se está protegiendo.

**Los mensajes de commit** cuentan qué problema real se resolvió, no qué
archivos se tocaron.

---

## Tests de render en la web

`apps/web` tiene entorno de render desde el proyecto 5d: jsdom,
`@testing-library/react` y `@testing-library/user-event`, todo en
`devDependencies`. El bloque `test` está en `apps/web/vite.config.js` y los
matchers y la limpieza entre pruebas, en `apps/web/src/tests/preparacion.js`.

Los ejemplos a copiar son `src/tests/renderDeInventario.test.jsx` y
`src/tests/renderDePanelProducto.test.jsx`.

### Los tres niveles: función pura, render, navegador

La pregunta es **qué se está afirmando**:

> ⚠ **Esta tabla es de `apps/web`.** En `apps/api` los tests van **siempre** en
> `src/tests/`, aunque prueben una función pura de `src/utils/`: el `testMatch`
> de `jest.config.js` solo levanta `src/tests/**` y `__tests__/**`, así que un
> `src/utils/algo.test.js` **jest no lo corre nunca** — no falla, no avisa,
> simplemente no existe para la suite, y alguien lee el nombre del archivo y da
> por cubierto lo que jamás se ejecutó. Lo protege
> `src/tests/todosLosTestsCorren.test.js`.

| Se afirma… | Dónde va |
|---|---|
| Una regla: de qué color va el badge, qué filas entran, cuánto suma un indicador | Función pura en `utils/`, test en `utils/*.test.js` |
| El dibujo: que el badge esté en la celda de la sucursal que corresponde, que el encabezado y las filas compartan columnas, que el aviso caiga bajo su renglón | Test de render en `src/tests/*.test.jsx` |
| Que apretar algo dispare lo que tiene que disparar —y **solo** eso— | Test de render |
| Que un campo quede deshabilitado sin el permiso, con su explicación | Test de render |
| **Geometría**: qué elemento scrollea, cuánto mide algo en píxeles, si un texto entra o se recorta, si el `<body>` desborda | **Prueba de navegador** en `apps/web/pruebas-de-navegador/*.navegador.js` |

**Primero se intenta la función pura.** Un test de render que verifica una
regla es diez veces más lento y se rompe cuando alguien mueve un `<div>`; la
regla no cambió y el test igual se puso en rojo. Sacar la regla del componente
a `utils/` —como hicieron `estadoVenta.js`, `exportarVentas.js` e
`inventario.js`— es lo primero, y el test de render cubre lo que queda.

**Y el navegador es el último recurso**, no el primero. Lo que va y lo que no va
en ese nivel está en «Pruebas de navegador», más abajo.

### Cómo se escribe uno acá

1. **El store se llena a mano** con `useStore.setState`, incluidas las
   acciones: `initialize` y `cargarSucursales` se reemplazan por `vi.fn()`
   porque las pantallas las llaman en un `useEffect` al montar.
2. **No se mockea `@/services/api` entero.** El grafo de imports de una
   pantalla arrastra decenas de exportaciones nombradas y la lista se
   desactualiza sola. Cuando hace falta interceptar, se espía la instancia de
   axios: `vi.spyOn(api, 'post').mockResolvedValue(...)`.
3. **Las filas se buscan por su `grid-template-columns`.** La tabla es un grid
   y no un `<table>`, así que no hay `role="row"`:
   `screen.getByText('Colágeno').closest('[style*="grid-template-columns"]')`.
   Desde ahí se mira con `within`.
4. **Los permisos se cargan como códigos** en `useStore.setState({ permisos })`:
   es de donde los lee `usePermission`.
5. **Si el componente pide algo al montar** —`HistorialDeCostos` pide el
   historial de costos— el render va envuelto en `await act(async () => …)`.
   Sin eso React llena la salida de «An update … was not wrapped in act(...)», y
   una suite que imprime ruido en verde es una que nadie lee cuando se pone en
   rojo.
6. **Un archivo que necesite el entorno `node`** —porque prueba justamente que
   no hay navegador— lo declara con un docblock `@vitest-environment node`. El
   único hoy es `utils/impresionInventario.test.js`.

### Lo que no se hace

- **No se afirma nada sobre posiciones ni tamaños.** jsdom no tiene motor de
  maquetado. Que un elemento esté «arriba» o «no se superponga» no se puede
  contestar acá; eso baja al tercer nivel, «Pruebas de navegador», más abajo.
- **No se mencionan clases de Tailwind al pasar.** El CSS de producción crece:
  Tailwind v4 escanea las fuentes solo y no distingue un test de un componente.
  `src/index.css` tiene cuatro `@source not` que sacan del escaneo a los tests y
  a las pruebas de navegador — los tres primeros se agregaron después de que la
  variable `container` de `@testing-library` metiera 272 bytes de `.container`
  en el bundle.
- **Un test de render que pasa con y sin el cambio no vale nada, igual que
  cualquier otro.** La forma de comprobarlo es la de siempre: revertir la
  corrección, correr el test, verificar que se pone en rojo, y restaurar.

---

## Pruebas de navegador

Playwright sobre Chromium, en `apps/web/pruebas-de-navegador/`, con
`npm --prefix apps/web run test:navegador`. Los archivos terminan en
`.navegador.js` —y no en `.test.js`— para que vitest y Playwright no se
levanten los archivos del otro.

### Cuándo, y el criterio para no escribir una

**Solo si la afirmación necesita un motor de maquetado.** jsdom no tiene uno:
`scrollWidth`, `clientWidth` y `getBoundingClientRect` devuelven **cero
siempre**, así que un test de render que los mire pasa con y sin el cambio. Eso
—y nada más que eso— es lo que baja al navegador:

- Qué elemento scrollea y cuál no.
- Cuánto mide algo de verdad: los 400px del ticket, los 24px del total.
- Si un texto entra en su celda o se recorta.
- Si el `<body>` desborda a lo ancho o a lo alto.
- Dónde queda una caja respecto de otra: si el nombre se mete en la columna de
  precio, si las columnas de dos filas arrancan en el mismo píxel.

**Lo que NO baja**, aunque se pueda escribir: cualquier cosa que ya cubra una
función pura o un test de render. Los atajos del punto de venta son
`utils/atajosDelPos.test.js`; los precios por medio de pago son
`utils/mediosDePago.test.js`; que el botón de imprimir desaparezca con la
primera línea del ticket siguiente es `tests/renderDelPuntoDeVenta.test.jsx`.
Repetirlo en un navegador cuesta cincuenta veces más por caso, y una suite lenta
es una suite que alguien termina salteando.

Una prueba de navegador es cara —arranca un servidor, una base, un Chromium— y
por eso el listón es alto: **si se puede afirmar sin navegador, no va acá.**

### Lo que se afirma es la geometría, no la clase

`class="w-[400px]"` es un string en un archivo y lo puede verificar una guardia
estática. Lo que solo el navegador contesta es que el elemento **mida** 400px
después de que el flex, el `shrink`, el `min-w` del padre y una regla de
`index.css` hayan opinado. Las dos cosas se verifican, en el nivel que
corresponde: la clase donde es barata, la medida donde es la única verdad.

### El estado sale del sistema, no de un doble

Un test de render llena el store a mano con `useStore.setState`. Acá no: la
API descartable se levanta de verdad y el catálogo se siembra por HTTP
(`pruebas-de-navegador/preparacion.js`). Si los datos vinieran de un doble, la
prueba diría que el diseño funciona con datos que el sistema no produce.

### Cómo se entra sin Auth0, y por qué eso no llega a producción

`App.jsx` corta en `!isAuthenticated`. Las pruebas reemplazan
`@/sesion/ProveedorDeSesion` por uno que devuelve una sesión falsa, mediante un
alias que `vite.config.js` declara **solo cuando `command === 'serve'`**.

⚠ **La diferencia con `BYPASS_AUTH` de la API es deliberada.** Allá el bypass
existe en el código de producción y `checkPermission.js:5` responde 500 si
alguien lo enciende con `NODE_ENV=production`: alcanza, porque ese código corre
en un servidor propio. Acá no alcanzaría: un bundle se le sirve a cualquiera que
pida la página, y un bypass compilado adentro es una puerta con el picaporte del
lado de afuera. Por eso lo que se garantiza no es que esté apagado sino que **no
esté**, y hay tres guardias que lo verifican
(`src/tests/guardiaDeSesionDePrueba.test.js` y `npm run verificar:bundle`).

### Las dos cosas que hay que acordarse

1. **`src/index.css` tiene un `@source not` para esta carpeta.** Las pruebas de
   medidas nombran utilidades arbitrarias —`min-w-[1080px]`, `w-[400px]`— y
   Tailwind v4 escanea las fuentes solo, sin distinguir una prueba de un
   componente. Sin esa línea, cada clase mencionada en una prueba entra al CSS
   que baja el navegador del cliente: medido, +130 bytes con una sola. Hay una
   guardia en `tests/guardiasDeDiseno.test.js` que la protege.
2. **La mutación vale igual que en el resto del repositorio, y muerde más.**
   Una prueba de geometría puede pasar por razones que no tienen nada que ver
   con lo que dice verificar. Tres de las primeras once no se pusieron en rojo
   con su mutación: una medía la barra lateral por un error de nombres, otra
   verificaba un `shrink-0` que `min-w-[1080px]` ya hacía redundante, y la
   tercera comparaba un contenedor que quedaba igual con y sin el defecto.

---

## Definición de terminado

Una tarea está terminada cuando:

1. El código hace lo que dice el criterio de aceptación de la spec.
2. Tiene tests, y esos tests **fallan** si se revierte el cambio.
3. `npm run test:api` y `npm run test:web` pasan.
4. `npm run build` pasa.
5. Nada nuevo aparece en las guardias estáticas.

Una funcionalidad está terminada cuando **`sdd-verify` no encontró forma de
romper ningún criterio de aceptación**.
