# Tasks: Catálogo de ventas online — etapas 0, 1 y 2

**Input**: documentos de diseño en `docs/specs/015-catalogo-de-ventas-online/`
(`spec.md`, `plan.md`, `data-model.md`, `contracts/api-endpoints.md`).

**Sesenta y cinco tareas en diecisiete fases.** Una fase = un corte del plan =
uno o varios commits que se despliegan y se revierten juntos. El orden es el de
«Orden de fases» del plan, **sin permutas**.

`[P]` marca las que se pueden hacer en paralelo porque tocan archivos distintos.

---

## Antes de empezar: ocho cosas que no son tareas

### 1. La numeración sigue de la 014

La última tarea del repositorio es **T1409**. Acá se arranca en **T1410**. Los
números no se reciclan: `guardiasDeDiseno.test.js` y `marcoDePantalla.test.js`
nombran tareas por su número adentro de sus encabezados, y dos T1410 distintas
hacen que esa referencia deje de servir.

### 2. ⚠ `npm run test:api -- <patrón>` NO filtra: **esconde**

Esto se descubrió corriendo T1411 y estaba mal en las **treinta** verificaciones
que este archivo traía escritas.

El script es `jest --forceExit --detectOpenHandles --testPathIgnorePatterns
"/node_modules/" ".integracion.test.js$"`. Un argumento de más **se suma a
ese arreglo**: lo que nombrás no se filtra, se **ignora**. Medido:

| Comando | Suites que corren |
|---|---|
| `npm run test:api` | 71 |
| `npm run test:api -- aislamiento` | **69** — se saltea las dos que querías mirar |
| `npm run test:api -- --testPathPatterns X` | tampoco filtra |
| `npm exec -w apps/api -- jest X` | **1** |

Es el modo de falla que este repositorio ya tiene nombrado: **la guardia pasa
por vacío**. Una guardia nueva verificada con el comando viejo reporta verde
sin haberse ejecutado nunca.

**En este archivo todas las verificaciones usan `npm exec -w apps/api -- jest`.**
La suite entera sigue siendo `npm run test:api`, sin argumentos.

---

### 3. ⚠ La suite rápida NO puede ver ninguno de los defectos que importan acá

Es el riesgo 11 del plan y hay que leerlo antes de escribir la primera línea.
Con `BYPASS_AUTH=true`, `server.js` clava `req.empresaId = 1`,
`checkSubscription` **no corre** y `checkPermission` llama a `next()` sin mirar.
Un endpoint público que filtre los datos de otra empresa **pasa en verde** en
`npm run test:api`.

Todo lo que sostiene esta funcionalidad vive en **`src/tests/integracion/`** y en
las **guardias estáticas**, y las dos cosas hay que **pedirlas**: `npm run
test:api` no levanta la suite de integración. Cada tarea que lo necesite dice
con qué comando se verifica, y esa línea no es decorativa.

| Nivel | Qué cubre acá | Dónde |
|---|---|---|
| Función pura | Los 21 casos de precios · qué regla gana y cuáles quedan pisadas · la cobertura «gana en N de M» · el porcentaje del 100 % que da cero · la normalización del slug · `slugDeLaRuta` · los cinco estados de la suscripción más el desconocido · el total del pedido con el umbral **en el borde** · las transiciones del estado · `esImagenPropia` · `textoSobre` · `consolidarLineas` con el mismo producto dos veces | `apps/api/src/tests/*.test.js` (**nunca** `src/utils/*.test.js`) · `packages/*/index.test.js` · `apps/web/src/utils/*.test.js` · `apps/tienda/src/tests/` |
| Guardia estática | La copia única de la fórmula · la proyección pública (forma, no nombres) · **la posición del montaje y la atadura entre el `skip` y el limitador propio** · el respaldo del volumen · que `apps/tienda` no tenga `Authorization`, `X-Sesion-Id` ni hexadecimales · las once anclas del punto 4 | `paqueteDePrecios.test.js` · `proyeccionPublica.test.js` · `observabilidad.test.js` · `respaldoDeImagenes.test.js` · `guardiaDeLaTienda.test.js` · `aislamientoEmpresas.test.js` · `permisosDeRutas.test.js` · `montajeDeRouters.test.js` · `guardiasDeDiseno.test.js` · `guardiasDeSrc.test.js` |
| **Integración contra Postgres** | Que el catálogo de B dé 404 desde el enlace de A · que el JSON **entero** no tenga ninguna de las diez claves · que borrador y slug inexistente den **el mismo cuerpo** · que la suscripción vencida apague el catálogo —**el único lugar donde se puede probar**— · que el error de base dé 503 en el público mientras la cadena privada sigue dejando pasar · que dos reglas del mismo ámbito choquen contra el **índice** · que el mismo pedido **en paralelo** cree uno solo · que dos pedidos simultáneos no compartan número · que un `product_id` ajeno **no deje ninguna fila** · que «Marcar cobrado» dejara las cinco tablas **como estaban** | `apps/api/src/tests/integracion/*.integracion.test.js` |
| Render (jsdom) | Qué dibuja cada estado · que la casilla arranque desmarcada y con la puerta cerrada **no se dibuje** · que el botón «Sin stock» no dispare nada · que el aviso de la bandeja **no tenga botón de cerrar** · que el renglón de la marca no diga `undefined` · que el tachado no salga cuando el final es mayor o igual · que sin `catalogo.editar` los campos estén **deshabilitados con su explicación** | `apps/web/src/tests/renderDe*.test.jsx` · `apps/tienda/src/tests/*.test.jsx` |
| Navegador | **Dos cosas y nada más**: que las veinte rutas del panel entren en el marco, y que el `<body>` de la tienda **no desborde a lo ancho** a 390px en catálogo, ficha, carrito y los tres pasos del checkout | `apps/web/pruebas-de-navegador/` · `apps/tienda/pruebas-de-navegador/` |

Comandos (después de F0.1 el prefijo cambia de `--prefix` a `-w`):

```
npm run test:api                              # NO levanta los de integración
npm --prefix apps/api run test:db:levantar    # una vez: contenedor + migraciones
npm --prefix apps/api run test:integracion
npm run test:web
npm test -w packages/precios
npm test -w apps/tienda
npm run build
node apps/api/scripts/verificar-reversibilidad.js --desde 20260814
npm --prefix apps/web run test:navegador
npm --prefix apps/tienda run test:navegador
```

### 4. Los seis números de hoy, verificados abriendo el archivo

No son del plan: se contaron ahora, y son contra los que se mide cada ancla.

| Qué | Hoy | Dónde |
|---|---|---|
| Entradas de `ROUTERS_SIN_SESION` | **2** | `permisosDeRutas.test.js:73-87` |
| Archivos en `apps/api/src/routes/` | **19** | `permisosDeRutas.test.js:553-564`, `toEqual` exacto |
| `expect(ARCHIVOS).toHaveLength(...)` | **32** | `guardiasDeDiseno.test.js:473` |
| `PANTALLA_DE_LA_RUTA` / `PANTALLAS` | **13** / **11** | `guardiasDeSrc.test.js:598`, `:702` |
| Rutas de `CON_MARCO` | **18** | `marcoDeLasPantallas.navegador.js:56-61` |
| Jobs del CI | **5** (`api`, `web`, `navegador`, `landing`, `contenedor`) | `.github/workflows/ci.yml` |

Y tres hechos más del árbol de hoy: **no existe `packages/`**, hay **tres**
`.dockerignore` (`apps/api`, `apps/web`, `apps/landing`) y **ninguno en la
raíz**, y la última migración es `20260813-gastos-fijos-a-su-sucursal.js`.

### 5. Las once anclas, y en qué tarea se mueve cada una

Ninguna se rodea. **El número se mueve con el motivo escrito al lado**, en la
tarea que lo provoca, nunca en una tarea «arreglar los tests» al final. Un ancla
movida sin motivo es una guardia que dejó de significar algo, y no se nota hasta
que hace falta (riesgo 12 del plan).

| # | Guardia | Hoy → | Tarea | El motivo que se escribe |
|---|---|---|---|---|
| 1 | `permisosDeRutas.test.js:73-87` — `ROUTERS_SIN_SESION`, igualdad exacta | 2 → 3 → **4** | **T1439** y **T1448** | T1439: `'routes/catalogoPublico.js publico'` — es la tienda; no hay sesión de la cual salga un permiso, y lo que corta es el estado del catálogo y la suscripción, verificados dentro del handler. T1448: `'routes/catalogoPublico.js paginas'` — sirve el HTML de `/c/:slug`; lo lee el previsualizador de WhatsApp, que no tiene cuenta |
| 2 | `permisosDeRutas.test.js:549-565` — lista literal de `routes/`, `toEqual` | 19 → 20 → 21 → **22** | **T1432**, **T1439**, **T1468** | Un archivo de `routes/` que nadie monta es código muerto — o peor, un router que alguien cree publicado. Los tres entran con su montaje en `server.js` en el mismo commit |
| 3 | `permisosDeRutas.test.js:674-693` — todo `checkPermission` existe en `seedPermissions.js`, ancla `> 40` | 50 → **54** | **T1421** | Los cuatro permisos entran **antes** que los endpoints que los nombran, o la guardia se pone en rojo entre dos cortes. El `> 40` es un **piso** y no se toca |
| 4 | `permisosDeRutas.test.js:578-586` — `> 120` rutas y `> 115` autenticadas | crecen solas | **ninguna** | Son pisos, no igualdades: **no hay nada que actualizar**, y se dice acá para que nadie lo «arregle» |
| 5 | `montajeDeRouters.test.js:331-338` — nada débil debajo del genérico | `[]` → **`[]`** | verificada en **T1439** | El montaje público va **arriba** de `app.use('/api', ...authEmpresa, general)`. Si esta guardia se pone en rojo, el montaje quedó en el lugar equivocado (decisión 2 del plan) |
| 6 | `observabilidad.test.js` — **guardia nueva**, molde `:394-536` | — → 5 aserciones | **T1440** | Cuatro posiciones y **la atadura** entre el `skip` y `limitadorPublico`. Devuelve `null` —o sea falla— si no encuentra alguna de las líneas que dice mirar |
| 7 | `aislamientoEmpresas.test.js:1136` — `expect(deHijos.length).toBe(3)` | 3 → **3** | verificada en **T1457** | **No se mueve, y no por casualidad**: `pedido_items` no lleva `empresa_id` —igual que `sale_items`— y no se declara ninguna asociación desde `Catalogo` (decisión 12). El día que alguien declare una, sube a 4 **con el motivo al lado** |
| 8 | `aislamientoEmpresas.test.js:993` — `sinValidar` | `[]` → **`[]`** | verificada en **T1463** | El `Pedido.create` **se queda en `routes/catalogoPublico.js`** con el `findScoped(Product, …)` delante, en el mismo handler. Es una restricción de arquitectura, igual que el `SupplierMovement.create` de `suppliers.js:1015-1039` |
| 9 | `guardiasDeDiseno.test.js:171-215` `NOMBRES` y `:473` `toHaveLength(32)` | 32 → **38** | **T1423** | Los seis archivos entran **antes de escribirse**. Ver el punto 5 |
| 10 | `guardiasDeSrc.test.js:598-612` y `:702-714` | 13/11 → 14/12 → **15/13** | **T1452** y **T1469** | El `label` del menú y el `titulo` del `PageHeader` tienen que ser **el mismo string**: «Catálogos» y «Pedidos». Y las dos pantallas llevan `anim-subida` |
| 11 | `marcoDeLasPantallas.navegador.js:56-61` — `CON_MARCO` | 18 → 19 → **20** | **T1452** y **T1469** | Las rutas nuevas se agregan **al final**, no en el medio: `abrir()` corta el bucle con una excepción y lo que va antes se mide igual |

Y tres que no se mueven pero hay que mirar en cada corte que toque la base o una
pantalla:

- **`reversibilidadDeMigraciones.test.js`**: las **cinco** migraciones nuevas
  necesitan su `down`, y su ancla (`ARCHIVOS.length >= 20`) sube sola.
- **`marcoDePantalla.test.js`**: toda ruta cuyo ítem del menú declara `modulo`
  lleva `RouteGuard` con **ese mismo** módulo. ⚠ De ahí sale una regla de orden
  que no está en el plan: **el ítem del menú y la `<Route>` van en el mismo
  commit**. Por eso «Pedidos» **no** entra al menú en T1452 junto con
  «Catálogos», sino en T1469 con su pantalla.
- **`todosLosTestsCorren.test.js`**: los tests de la API van en `src/tests/`,
  nunca en `src/utils/*.test.js` — ahí jest no los levanta y nadie se entera.

### 6. ⚠ `guardiasDeDiseno` queda en rojo a propósito desde T1423 hasta T1470

Es lo que pide el plan (F1.1, «en rojo a propósito») y el protocolo está escrito
en el encabezado de la propia guardia: un archivo de `NOMBRES` que **todavía no
existe** produce el hallazgo «el archivo NO existe: la guardia no miró nada», que
se lee distinto de «L353: `border-green-500/30`». Es lo que demuestra que la ruta
está bien escrita y que la guardia está mirando ese archivo desde el primer
commit; una guardia agregada después se escribe para el código que ya está, y
entonces no es una guardia sino una descripción.

**Lo que eso obliga**, y no es negociable: durante diez cortes `npm run test:web`
está en rojo, así que **hay que saber cuántos hallazgos son los esperados y de
qué tipo**. La cuenta va escrita adentro de `guardiasDeDiseno.test.js`, al lado
de `NOMBRES`, y baja así:

| Después de | Archivo que deja de faltar | Hallazgos «NO existe» |
|---|---|---|
| T1423 | — | **6** |
| T1452 | `pages/Catalogos.jsx` | 5 |
| T1454 | `components/ReglasDePrecio.jsx` | 4 |
| T1455 | `components/ProductosDelCatalogo.jsx` | 3 |
| T1456 | `components/QrDelCatalogo.jsx` | 2 |
| T1469 | `pages/Pedidos.jsx` | 1 |
| T1470 | `components/PanelDePedido.jsx` | **0** |

**Cualquier hallazgo que no sea exactamente «el archivo NO existe» es una
infracción real y no se tapa con esta cuenta.** Y **no vale**: sacar un nombre de
`NOMBRES`, bajar el `toHaveLength`, ni meter clases adentro de un comentario para
que `lineasQueMatchean` las saltee.

### 7. Lo que siempre se olvida, y acá es mucho

Cada ítem tiene su tarea. La lista está para que nadie descubra en producción que
falta uno.

| Qué | Tarea |
|---|---|
| Las **cinco migraciones**, cada una con su `down` | T1413, T1424, T1425, T1426, T1457 |
| Los **seis modelos registrados en `models/index.js`** —o `verificar-esquema.js` no los mira— | T1424, T1425, T1426, T1457 |
| La semilla de `verificar-reversibilidad.js` | T1427 y T1457 |
| Los **cuatro montajes en `server.js`** (`/api/publico`, `/c`, `/api/catalogos`, `/api/pedidos`) | T1439, T1448, T1432, T1468 |
| El **ítem del menú** en `components/navegacion.js` | T1452 (Catálogos) y T1469 (Pedidos) |
| Los **cuatro permisos** en `seedPermissions.js` y el reparto por rol | T1421 |
| Los **tres gates del módulo** (barra lateral, `RouteGuard`, API) | T1422 (API), T1452 y T1469 (los dos del navegador) |
| El **servicio nuevo en `docker-compose.produccion.yml`** | T1449 |
| El **bloque de `deploy/Caddyfile`** | T1417 (el `handle_path /img/*`) y T1449 (los tres `handle` que faltan) |
| El **registro `A` del DNS** de `tienda.favalio.com` | **M2** (paso manual) |
| **`ALLOWED_ORIGINS`** con `https://tienda.${DOMINIO}` | T1449 |
| La **ampliación de `deploy/respaldo.sh`**, en el mismo commit que crea el volumen | T1417 |
| **`docs/OPERACION.md`** para quien opera esto cuando se rompa | T1412, T1420, T1450 |

### 8. Cómo se lee una tarea

Cada una trae, además de qué hacer:

- **Verificación**: el comando exacto. Si dice `test:integracion`, `npm run
  test:api` **no alcanza**.
- **El test que evita el defecto**: el nombre del caso, escrito como lo que
  protege y no como «funciona».
- **Qué se revierte para verlo en rojo**: la mutación concreta. Un test que pasa
  con y sin el cambio no vale nada, y la única forma de saberlo es revertir,
  correr, y restaurar.

---

## Phase 1: Workspaces y `packages/precios` (corte F0.1) — **va sola y primera**

**Purpose**: el monorepo pasa a workspaces de npm y la fórmula de precio de venta
queda en **un solo lugar del repositorio**, consumible por el navegador y por el
servidor sin adaptadores. **Nada de catálogo.**

⚠ **Esta fase no lleva una sola línea de las otras dieciséis encima**, y no es
prolijidad: es el commit que puede romper las cuatro apps a la vez —tres
`package-lock.json` se borran y nace uno, los tres Dockerfiles cambian de
contexto, los cinco jobs del CI cambian de raíz de instalación—, y la única
forma de que sea revertible es que no arrastre nada más (riesgo 1 del plan). Si
algo sale mal acá, no tiene que haber nada más en el mismo corte.

- [x] **T1410** La conversión a workspaces, sin `packages/` todavía. **(a)**
      `package.json` de la raíz: `"workspaces": ["apps/*", "packages/*"]`, los
      scripts pasan a `-w` (`dev:api`, `build`, `test`, `lint`, `migrate`) e
      **`install:all` desaparece** —lo reemplaza `npm ci` a secas—. **(b)** Los
      tres `package.json` de `apps/*` entran al workspace. **`apps/landing` entra
      aunque no consuma nada, y es deliberado**: dos árboles de instalación
      conviviendo —uno con workspaces y otro con `npm --prefix`— es el estado en
      el que un `npm ci` de la raíz borra el `node_modules` de landing y nadie
      entiende por qué el build dejó de andar. Todo o nada; el `eslint ^10` de
      landing contra el `^9` de web no es problema, npm anida el conflicto.
      **(c)** Los **tres `package-lock.json` de `apps/*` se borran** y nace **uno
      en la raíz**. **(d)** Los tres Dockerfiles pasan a contexto de raíz, con el
      molde del plan (decisión 1b): `COPY package.json package-lock.json ./`,
      `COPY apps/X/package.json ./apps/X/`, `RUN npm ci --omit=dev --workspace
      apps/X --include-workspace-root`, y el `WORKDIR` final adentro de la app.
      ⚠ **`--workspace` no se da por hecho**: si la versión de npm de la imagen
      da problemas, el respaldo es `npm ci --omit=dev` a secas, que es
      **correcto** y solo más gordo —y eso se ve en el tamaño de la imagen, no en
      un error raro—. **(e)** **Nace `.dockerignore` en la raíz** y **se borran
      los tres de `apps/*`**: excluye `**/node_modules`, `**/dist`, `.git`,
      `**/.env*`, `legacy/`, `docs/`, `.claude/`. **Esto no es un detalle**: los
      tres `.dockerignore` de `apps/*` dejan de aplicar en el momento exacto en
      que el contexto cambia, **sin ningún aviso**, y sin el de la raíz cada
      `docker build` sube el repositorio entero al demonio — en un VPS de 4 GB
      eso es la diferencia entre segundos y quedarse sin memoria (riesgo 2).
      **(f)** `docker-compose.produccion.yml`: los builds pasan de
      `context: ./apps/X` a `context: .` + `dockerfile: apps/X/Dockerfile`.
      **(g)** `.github/workflows/ci.yml`: los cinco jobs cambian
      `cache-dependency-path` al `package-lock.json` de la raíz y su `npm ci`
      pasa a correr en la raíz, dejando los pasos de test con su
      `working-directory` como está; el job `contenedor` pasa de
      `docker build -t favalio-api:ci .` con `working-directory: apps/api` a
      `docker build -f apps/api/Dockerfile -t favalio-api:ci .` en la raíz.
      **Verificación**: los **cinco** jobs del CI en verde contra el árbol nuevo
      —es lo único que prueba que la resolución de la raíz no eligió otra versión
      de una dependencia transitiva—, `npm ci` desde cero en un clon limpio,
      `npm run dev` levantando las tres apps, y `docker compose -f
      docker-compose.produccion.yml build` reconstruyendo las tres imágenes.
      **El test que evita el defecto**: no hay uno propio; **el CI es el test**, y
      por eso este corte no se cierra sin los cinco jobs verdes. Lo que sí se
      mide es el job `contenedor`: **su tiempo no puede subir**, y si sube es el
      `.dockerignore` de la raíz que quedó mal escrito.
      **Qué se revierte para verlo en rojo**: borrar el `.dockerignore` de la
      raíz y mirar cuánto tarda el `docker build` en enviar el contexto.

- [x] **T1411** `packages/precios`, la copia única de la fórmula. **(a)** Crear
      `packages/precios/` con `package.json`
      (`{ "name": "@favalio/precios", "private": true, "version": "0.0.0",
      "main": "index.js", "scripts": { "test": "vitest run" } }`), `index.js`,
      `index.test.js` y `vitest.config.js` con `environment: 'node'`. **Sin
      `"type": "module"`, o sea CommonJS**, y el motivo va escrito arriba del
      `package.json`: `apps/api` hace `require('@favalio/precios')` sin
      transpilación, sin `--experimental-vm-modules` y sin `exports`
      condicionales. **(b)** `apps/web/src/utils/precios.js` se **muda entero** a
      `index.js` y `precios.test.js` a `index.test.js`, con **los 21 casos y sin
      tocar ninguna aserción** (FR-003) — **son 21, no doce**: el borrador de la
      spec decía doce y el plan los contó. Los dos archivos de `apps/web` **se
      borran**. **(c)** Los cinco consumidores cambian una línea cada uno:
      `pages/Inventory.jsx:5`, `components/PanelProducto.jsx:4`,
      `utils/exportarInventario.js:2`, `utils/impresionInventario.js:1`,
      `store/useStore.js:3`. **(d)** `apps/web/vite.config.js` gana
      `optimizeDeps: { include: ['@favalio/precios'] }` **con su motivo escrito
      al lado**: Vite pre-empaqueta las dependencias de `node_modules` para
      convertir CommonJS a ESM pero **excluye las enlazadas por workspace**
      —supone que son fuente ESM—, así que sin esta línea el `import` con nombres
      falla en el servidor de desarrollo y **anda en el build**, que es la peor
      combinación posible. **(e)** `apps/api/package.json` y
      `apps/web/package.json` declaran `"@favalio/precios": "*"`. **(f)** El
      Dockerfile de la API gana `COPY packages/precios/package.json
      ./packages/precios/` **antes** del `npm ci` y `COPY packages/precios/
      ./packages/precios/` después — el orden importa: npm crea el enlace del
      workspace durante la instalación, y si el directorio no existe todavía el
      enlace queda colgado y el `require` falla **al arrancar en producción**, no
      en el build. **(g)** El **sexto job** de CI, `Paquetes — tests`, con
      `npm test -w packages/precios`. Colgado del job `web`, una regresión de la
      fórmula que rompe el catálogo público se reportaría como «Web — tests», y
      el nombre del job es la mitad del valor de un CI. **(h)** La guardia
      `apps/api/src/tests/paqueteDePrecios.test.js` —va ahí porque es donde ya
      viven las guardias que leen archivos de todo el repositorio— con sus cinco
      reglas: el `workspaces` de la raíz; el `@favalio/precios` en las dos
      `dependencies`; que **no exista** `apps/web/src/utils/precios.js`; que
      ningún archivo de `apps/api/src` ni de `apps/web/src` contenga los tres
      marcadores literales `1 + aNumero(margen)`, `MODO_RECARGO = {` y
      `function calcularPrecios` —**cadenas literales, no expresiones regulares
      laxas**: una guardia que se pone en rojo por una variable que se llama
      parecido es una que alguien afloja—; y **el ancla**: que los tres
      marcadores estén **dentro de `packages/precios/index.js`**, o un renombre
      del paquete la dejaría revisando archivos que no existen y pasando en
      verde.
      **Verificación**, en este orden y no en otro: escribí primero la guardia
      del punto (h), corré `npm exec -w apps/api -- jest paqueteDePrecios` **antes** de
      mudar nada y **anotá cuántos hallazgos dio** — tiene que ser > 0, porque
      hoy la copia está en `apps/web`. Si da cero, la guardia no está mirando lo
      que dice mirar y la mudanza no va a demostrar nada. Recién ahí mudá, y
      después: `npm test -w packages/precios` con **21 casos**, `npm run
      test:web`, `npm exec -w apps/api -- jest paqueteDePrecios`, `npm run build` y los
      **seis** jobs del CI.
      **Los tests que evitan el defecto**: los 21 casos de `index.test.js`
      —incluidos el recargo del 100 % que devolvía `Infinity`, el descuento del
      100 % que devolvía negativo y el `cost` que vuelve como string— y
      *«la fórmula no está escrita dos veces en el repositorio»*.
      **Qué se revierte para verlo en rojo**: pegar de vuelta
      `apps/web/src/utils/precios.js`; la regla 3 y la 4 de la guardia lo nombran.
      ⚠ **Si el total de casos baja de 21, la mudanza perdió casos y nada más lo
      va a avisar** (FR-003, criterio 2).

- [x] **T1412** [P] `docs/OPERACION.md` gana la sección **«El monorepo es
      workspaces»**, en «Deploy»: que la instalación es `npm ci` en la raíz y
      **`install:all` ya no existe**; que los `docker build` se corren desde la
      raíz con `-f apps/X/Dockerfile`; que un `MODULE_NOT_FOUND` de
      `@favalio/precios` al arrancar el contenedor significa que el enlace del
      workspace quedó colgado —el `package.json` del paquete no se copió antes
      del `npm ci`— y no que falte una dependencia; y que si un `npm ci` de la
      raíz deja `apps/landing` sin `node_modules`, es que quedó un árbol viejo y
      hay que borrar los tres `node_modules` de `apps/*` a mano una vez.
      **Verificación**: la sección existe y nombra `npm ci`, `install:all` y
      `MODULE_NOT_FOUND`. No hay test: es documentación, y su verificación es
      que exista **antes** de que el corte se despliegue.

**Checkpoint**: `npm ci` en un clon limpio deja las tres apps andando, `npm test
-w packages/precios` corre los 21 casos, el punto de venta calcula el mismo
precio que antes, y los seis jobs del CI están en verde. **No hay ni una línea
de catálogo en el repositorio.**

---

## Phase 2: `products.publicable` (corte F0.2)

**Purpose**: el comercio puede decir qué productos **podrían** salir a una página
pública, y **los 431 que ya existen quedan todos en `false`**. Crear un catálogo
no publica nada que nadie eligió. Se despliega solo y se revierte solo: todavía
no hay ningún catálogo que lo lea.

- [x] **T1413** Crear `apps/api/src/migrations/20260814-productos-publicables.js`:
      `products.publicable` BOOLEAN NOT NULL DEFAULT `false` (FR-040) e
      `idx_customer_empresa` sobre `customers (empresa_id)` (FR-151, H11) — el
      índice que `models/Customer.js:51-52` nunca tuvo, y que **entra en la etapa
      0 aunque el pedido sea de la etapa 2**: es una línea, no cambia ningún
      comportamiento, y llegar tarde significa correrlo sobre una tabla que ya
      creció con un `Customer` por comprador. Todo dentro de una transacción. La
      migración **verifica** con un `COUNT(*) WHERE publicable = true` que dé
      **cero** y falla si no. El `down` hace `removeColumn` + `removeIndex` y su
      encabezado dice, textual, que **pierde el dato de qué productos eran
      publicables**: revertirla después de que alguien marcó sesenta productos
      significa volver a marcarlos. No hay tabla de archivo porque el dato es un
      booleano reconstruible a mano en cinco minutos, a diferencia de los gastos
      que `20260813` sí archiva. `models/Product.js` gana la columna y
      `models/Customer.js` el índice **con el mismo `name`** que la migración
      (FR-211), o `verificar-esquema.js` lo reporta como faltante.
      **Verificación**: `npm --prefix apps/api run db:migrate` y
      `npm --prefix apps/api run verificar:esquema`;
      `node apps/api/scripts/verificar-reversibilidad.js --desde 20260814`;
      `npm exec -w apps/api -- jest reversibilidadDeMigraciones`. El job «API — la imagen
      arranca y migra» en verde (FR-214).
      **El test que evita el defecto**: *«después de migrar, ningún producto
      quedó en `publicable = true`»* — es el criterio 5, y es lo que separa
      «agregué una columna» de «no publiqué nada de nadie».
      **Qué se revierte para verlo en rojo**: poner `defaultValue: true` en el
      `addColumn`; la verificación de la propia migración corta.

- [x] **T1414** En `apps/api/src/routes/products.js`: **(a)**
      `PATCH /api/products/publicables` (`products.editar`), acción masiva
      `{ ids: [...], publicable: boolean }` (FR-043) — **con `ids` scopeados por
      `empresa_id` en el `where`, nunca un `Model.update` por `id` pelado**;
      **(b)** `POST /api/products` y `PUT /api/products/:id` aceptan
      `publicable` como **campo explícito**, nunca por spread del cuerpo.
      **(c)** Una guardia estática en `apps/api/src/tests/permisosDeRutas.test.js`
      o en `observabilidad.test.js`: **ningún router declarado en
      `ROUTERS_SIN_SESION` puede escribir `publicable`** (FR-042), con su muestra
      sintética mala y su muestra buena. Hoy la lista tiene dos entradas y
      ninguna lo escribe; la guardia existe para el día que tenga cuatro. Las
      filas nuevas van en `permisosDeRutas.test.js`.
      **Verificación**: `npm exec -w apps/api -- jest permisosDeRutas products` y
      `npm --prefix apps/api run test:integracion -- publicables`.
      **Los tests que evitan el defecto**: *«la acción masiva con un id de otra
      empresa no marca ninguna fila ajena»* —contando `Product.count({ where: {
      empresa_id: otraEmpresa, publicable: true } })` antes y después— y
      *«ningún endpoint sin sesión escribe `publicable`»*.
      **Qué se revierte para verlo en rojo**: sacar el `empresa_id` del `where`
      del `update` masivo.
      ⚠ Con `BYPASS_AUTH` la sesión es la empresa 1 **siempre**: el caso del id
      ajeno **solo** se puede afirmar en la suite de integración, con las dos
      empresas sembradas. En `npm run test:api` pasa en verde con y sin el
      `empresa_id`.

- [x] **T1415** La interfaz de `publicable`: el interruptor en
      `apps/web/src/components/PanelProducto.jsx` y la **acción masiva** sobre la
      selección de `apps/web/src/pages/Inventory.jsx`, con el helper en
      `services/api.js`. Los dos archivos ya están en `NOMBRES` de
      `guardiasDeDiseno.test.js`, así que **no se toca ninguna ancla**. Sin
      `products.editar` el interruptor está **deshabilitado con su explicación**,
      no ausente. Sus casos van en
      `apps/web/src/tests/renderDePanelProducto.test.jsx` y
      `renderDeInventario.test.jsx`.
      **Verificación**: `npm run test:web -- renderDePanelProducto
      renderDeInventario guardiasDeDiseno`.
      **Los tests que evitan el defecto**: *«marcar publicable no publica nada:
      el producto sigue sin aparecer en ningún catálogo»* —afirmado sobre la
      llamada, que es un `PATCH` a productos y no a catálogos— y *«sin
      `products.editar` el interruptor está deshabilitado y dice por qué»*.
      **Qué se revierte para verlo en rojo**: sacar el `Can` del interruptor.

**Checkpoint**: en Inventario se pueden marcar diez productos como publicables de
una, y `SELECT count(*) FROM products WHERE publicable` da exactamente esos diez.
**Ninguna página pública existe todavía.**

---

## Phase 3: Imágenes (corte F0.3)

**Purpose**: se sube la foto de un producto, se guarda redimensionada en un
volumen persistente, la sirve **Caddy** y **está adentro del respaldo**. Hoy
`deploy/respaldo.sh:42` solo vuelca Postgres, así que sin esta fase la primera
foto que se suba es la primera foto que se puede perder.

- [x] **T1416** [P] Crear `apps/api/src/utils/imagenes.js`, funciones puras salvo
      la que escribe: `nombreAleatorio()` con
      `crypto.randomBytes(16).toString('hex')` —el molde de
      `models/Invitacion.js:24-29`—, `rutaDeImagen(nombre)` →
      `<aa>/<bb>/<nombre>.<ext>` con los cuatro primeros caracteres del nombre,
      `esImagenPropia(url)` → `url.startsWith('/img/')`, y
      `redimensionarYGuardar(buffer, uso)` con `sharp`. `sharp` entra en
      `dependencies` de `apps/api`.
      **Tres cosas que no son estilo y van con su comentario**: el `empresa_id`
      **no va en la ruta** —incluirlo permitiría enumerar qué empresas existen
      probando directorios, que es media vuelta al problema que FR-026 viene a
      cerrar—; el abanico de dos niveles existe para que ningún directorio junte
      cien mil entradas; y **la escritura es atómica** —se escribe en un temporal
      del mismo volumen y se `rename`—, que es lo que impide que una imagen
      cortada a la mitad deje un archivo incompleto que Caddy después sirve roto.
      Las tres medidas por uso, tal cual la decisión 9: producto 800×800
      `fit: 'inside'` `withoutEnlargement` JPEG q82, portada 1200×480 JPEG q82,
      logo 400×400 **PNG** —para conservar el fondo transparente que la pantalla
      pide—.
      📌 **Dónde vive `esImagenPropia`**: el plan la lista en
      `utils/pedidoPublico.js`, que es un archivo de la **etapa 2** y todavía no
      existe, y la pide funcionando **en este corte**. Va acá, en `imagenes.js`,
      que es donde vive todo lo de imágenes; `pedidoPublico.js` la importa cuando
      nazca. Anotado para que `sdd-verify` no lo lea como un desvío.
      Su test en `apps/api/src/tests/imagenes.test.js` (**nunca**
      `utils/imagenes.test.js`: jest no lo levanta).
      **Verificación**: `npm exec -w apps/api -- jest imagenes`.
      **Los tests que evitan el defecto**: *«el nombre del archivo no se puede
      derivar del id del producto ni del de la empresa»* —dos llamadas con los
      mismos argumentos dan nombres distintos—, *«la ruta no contiene el
      `empresa_id`»* y *«una `image_url` del importador de CSV no es imagen
      propia»* con una URL de un hosting de terceros.
      **Qué se revierte para verlo en rojo**: hacer que `rutaDeImagen` use el
      `empresa_id` como primer nivel.

- [x] **T1417** El volumen **y su respaldo, en el mismo commit** (FR-027).
      **(a)** `docker-compose.produccion.yml`: volumen `imagenes_favalio`,
      montado en `api` en `/var/favalio/imagenes` (lectura y escritura) y en
      `caddy` en `/var/favalio/imagenes:ro`, con la variable `RUTA_DE_IMAGENES`
      —la ruta es **absoluta y sale de la variable**, no del `WORKDIR` del
      contenedor, que cambió con los workspaces—. **(b)** `deploy/Caddyfile`: el
      bloque de sitio `tienda.{$DOMINIO}` **nace acá con un solo `handle`**, el
      de las imágenes, más `encode gzip`, el `Strict-Transport-Security` y el
      `header X-Robots-Tag "noindex, nofollow"` de sitio; los otros tres `handle`
      entran en T1449 con el servicio. Las fotos **no las sirve la API**
      (FR-023): un proceso de Node sirviendo archivos estáticos compite con las
      cajas del comercio por el mismo *event loop*. **(c)** `deploy/respaldo.sh`
      gana el volumen, con la misma rotación (`DIAS_A_CONSERVAR`) que la base y
      **una verificación distinta y con motivo**: un `tar.gz` de un volumen
      **vacío** pesa ~45 bytes, así que `-s` no distingue «vacío» de «cortado»
      —y un volumen vacío es legítimo, el primer día no hay fotos—; lo que sí lo
      distingue es que el archivo se pueda **leer entero**, o sea
      `tar -tzf … > /dev/null`, y eso es lo que se verifica. **(d)** La guardia
      `apps/api/src/tests/respaldoDeImagenes.test.js` lee `deploy/respaldo.sh`
      como texto —molde: las guardias que leen `ci.yml`— y exige que nombre el
      volumen, que verifique el resultado y que rote con el mismo
      `DIAS_A_CONSERVAR`. Con su ancla: encontró las N líneas que dice mirar.
      **Verificación**: `npm exec -w apps/api -- jest respaldoDeImagenes`; y a mano,
      `bash deploy/respaldo.sh` produce un `favalio-imagenes-*.tar.gz` que
      `tar -tzf` lista sin error, **con el volumen vacío y con una foto adentro**.
      **El test que evita el defecto**: *«el respaldo del volumen se verifica
      leyéndolo entero y no por tamaño: un tar cortado no pasa»*.
      **Qué se revierte para verlo en rojo**: cambiar el `tar -tzf` por
      `[ -s "$ARCHIVO_IMG" ]`; la guardia lo nombra.

- [x] **T1418** Los dos endpoints de la foto de producto, en
      `apps/api/src/routes/products.js`: `POST /api/products/:id/imagen`
      (`products.editar`, `multipart`, campo `imagen`) y
      `DELETE /api/products/:id/imagen`, que borra **del volumen y de la
      columna** (FR-029). `multer` con `memoryStorage` y
      `limits: { fileSize: 5 * 1024 * 1024 }`, más el manejador de errores del
      molde de `routes/empresas.js:178-180` para que `LIMIT_FILE_SIZE` salga como
      `ErrorDeNegocio` **diciendo cuál es el límite** (FR-025) y no como el 500
      de multer que nombra el campo del formulario. **`sharp` es lo que valida**
      (FR-024): si `sharp(buffer).metadata()` tira, no es una imagen, y **no
      importa la extensión ni el `Content-Type` que declaró el cliente**. El
      volumen lleno responde **507 `SIN_ESPACIO`** con mensaje legible y
      `logger.error`. `DELETE /api/products/:id` pasa a borrar también el archivo
      —un `unlink` que falla se **registra y no aborta el borrado**: un archivo
      huérfano es un problema de disco, y un producto que no se puede borrar es
      un problema del usuario—. `products.image_url` guarda la **ruta relativa**
      `/img/aa/bb/xxx.jpg` y nunca la URL absoluta: mudarse de dominio no exige
      migrar datos, y es lo que hace verificable FR-030 con una función pura. Las
      filas nuevas en `permisosDeRutas.test.js`.
      **Verificación**: `npm exec -w apps/api -- jest permisosDeRutas products` y
      `npm --prefix apps/api run test:integracion -- imagenesDeProducto`.
      **Los tests que evitan el defecto**: *«un `.exe` renombrado a `.jpg` se
      rechaza: lo que se mira es el contenido»*, *«el archivo de 8 MB devuelve un
      mensaje que dice cuál es el límite, no un 500»*, *«borrar la foto la borra
      del disco y de la columna»* y *«la foto de un producto de otra empresa
      responde 404 y no toca ningún archivo»*.
      **Qué se revierte para verlo en rojo**: validar por `file.mimetype` en vez
      de por `sharp`; el primer test entra con el `.exe`.

- [x] **T1419** La interfaz de la foto: subir, previsualizar y borrar desde
      `apps/web/src/components/PanelProducto.jsx`, con el `accept` declarado en
      el input, los object URL liberados, y el aviso **«foto externa, no se
      publica»** cuando `esImagenPropia` da `false` (FR-030, H6). El archivo ya
      está en `NOMBRES`: **ninguna ancla se mueve**. Sus casos en
      `renderDePanelProducto.test.jsx`.
      **Verificación**: `npm run test:web -- renderDePanelProducto`.
      **El test que evita el defecto**: *«un producto con `image_url` del
      importador de CSV se dibuja con el aviso de foto externa y no como si
      tuviera foto»*.
      **Qué se revierte para verlo en rojo**: dibujar la miniatura para cualquier
      `image_url` no vacía.

- [x] **T1420** [P] `docs/OPERACION.md` gana dos cosas: **(a)** el procedimiento
      de **restauración de las imágenes** (FR-028) —descomprimir el `.tar.gz`
      dentro del volumen `favalio_imagenes_favalio` con el mismo `docker run
      --rm -v … alpine` que lo creó—, en la sección «Probar una restauración»,
      porque **un respaldo que nadie restauró no es un respaldo**; **(b)** qué
      hacer cuando el volumen se llena: el 507 `SIN_ESPACIO`, que **no hay cuota
      por empresa** en esta etapa, y cómo medir cuánto ocupa. Riesgo 10 del plan.
      **Verificación**: la sección existe y nombra `favalio_imagenes_favalio` y
      `SIN_ESPACIO`. Su verificación de verdad es el paso manual **M1**, que es
      restaurar de una.

**Checkpoint**: se sube un JPEG de 4000×3000 a un producto, se sirve en 800×800
por `/img/aa/bb/…`, un `.exe` renombrado a `.jpg` se rechaza con un mensaje en
castellano, y `deploy/respaldo.sh` deja un `.tar.gz` que se puede listar entero.

---

## Phase 4: Permisos, módulo y las guardias en rojo a propósito (corte F1.1)

**Purpose**: los cuatro permisos existen **antes** que los endpoints que los
nombran, el gate de módulo empieza a significar algo en la API —hoy
`enabled_modules` tiene **cero apariciones en `apps/api/src`**, verificado— y las
seis pantallas nuevas entran a la guardia de diseño **antes de escribirse**.

- [x] **T1421** En `apps/api/src/seedPermissions.js`, los cuatro permisos nuevos
      con el formato de los 50 que ya están: `catalogo.ver` («Ver catálogos»,
      módulo `catalogo`), `catalogo.editar`, `pedidos.ver` («Ver pedidos
      online», módulo `pedidos`) y `pedidos.gestionar`. En `ROLE_PERMISOS`
      (decisión 8 de la spec, FR-191): `admin` los recibe solos por
      `PERMISOS.map(…)` (`:83`) y **no hay que tocar nada**; `gerente` suma los
      cuatro explícitos; `vendedor`, **solo** `pedidos.ver` y
      `pedidos.gestionar`; `produccion` y `compras`, ninguno. **No se reusan
      `config.ver` / `config.editar`** (FR-190), y el motivo va escrito:
      TiendaNube arrastra el pendiente 12b justamente por eso, y `config.editar`
      es lo que abre el certificado de AFIP — el que prepara pedidos no tiene por
      qué verlo. El catálogo de `permisosDeRutas.test.js:674-693` pasa de 50 a
      54; **el ancla `> 40` es un piso y no se toca** (ancla 3).
      **Verificación**: `npm exec -w apps/api -- jest permisosDeRutas seedPermissions`.
      **Los tests que evitan el defecto**: *«un rol `vendedor` puede ver y
      gestionar pedidos y NO puede editar catálogos»* y *«ningún permiso nuevo
      hereda de `config.*`»*.
      **Qué se revierte para verlo en rojo**: darle `catalogo.editar` a
      `vendedor`; el primer test lo nombra.
      ⚠ **Va antes que cualquier endpoint que los nombre**, o la guardia de
      `checkPermission` se pone en rojo entre dos cortes.

- [x] **T1422** Crear `apps/api/src/middleware/requireModulo.js`, **que hoy no
      existe**, y su test `apps/api/src/tests/requireModulo.test.js`. Tres
      detalles, cada uno con su motivo escrito en el archivo: **(a) sin lista
      declarada, pasa** —`enabled_modules` ausente o no-arreglo significa «esta
      empresa tiene todo», que es el estado de **todas** las empresas de hoy;
      cerrar por ausencia apagaría el sistema entero en el primer deploy—;
      **(b) responde 404 y no 403**, por el mismo motivo escrito en
      `server.js:472-476` para `requireSuperadmin`: un 403 confirma que el módulo
      está ahí y solo oculto; **(c) replica la excepción del dueño** de
      `App.jsx:59` (`owner_auth0_sub`) — sin ella `RouteGuard` deja entrar al
      dueño de una empresa sin el módulo y la API le contesta 404 a todo, o sea
      **una pantalla rota llena de errores**, que es exactamente el modo de falla
      que el comentario de `RouteGuard` describe al revés. Los dos lados dicen lo
      mismo o el gate miente en uno de los dos.
      📌 **Se aplica solo a `/api/catalogos` y `/api/pedidos`, y no
      retroactivamente** a TiendaNube ni a ningún otro módulo (decisión 11): hoy
      `enabled_modules` no tiene **ninguna** semántica probada del lado del
      servidor, y encenderlo para once endpoints de una integración en
      producción, dentro de una funcionalidad que no es de ella, es cambiar el
      comportamiento de un cliente por un efecto colateral. Queda anotado como
      deuda, con el mismo tratamiento que H12.
      **Verificación**: `npm exec -w apps/api -- jest requireModulo`.
      **Los tests que evitan el defecto**: *«una empresa sin `enabled_modules`
      entra: cerrar por ausencia apagaría el sistema entero»*, *«sin el módulo
      responde 404 y no 403, que confirmaría que existe»* y —el que ata las dos
      ramas— *«el dueño de la empresa entra aunque el módulo no esté, igual que
      en `RouteGuard`»*.
      **Qué se revierte para verlo en rojo**: sacar la rama del dueño; el tercer
      test falla y la pantalla quedaría accesible en el navegador y muerta en la
      API.

- [x] **T1423** En `apps/web/src/tests/guardiasDeDiseno.test.js`, `NOMBRES`
      (`:171-215`) gana los **seis** archivos que todavía no existen
      —`pages/Catalogos.jsx`, `pages/Pedidos.jsx`,
      `components/ReglasDePrecio.jsx`, `components/ProductosDelCatalogo.jsx`,
      `components/QrDelCatalogo.jsx`, `components/PanelDePedido.jsx`— y el ancla
      `:473` pasa de **32 a 38** (ancla 9), con el motivo al lado y **la tabla de
      cuántos hallazgos son los esperados en cada corte** (punto 5 de «Antes de
      empezar») escrita en el mismo comentario.
      **Verificación**: `npm run test:web -- guardiasDeDiseno` da **exactamente
      seis** hallazgos, y los seis dicen **«el archivo NO existe: la guardia no
      miró nada»**. Si alguno dice otra cosa, la ruta está mal escrita. Si da
      cero, la guardia no está mirando nada y las seis pantallas se van a
      escribir sin red.
      **El test que evita el defecto**: el propio protocolo de
      `guardiasDeDiseno.test.js:217-238` — *«un archivo de `NOMBRES` que no
      existe es un hallazgo, no un silencio»*.
      **Qué se revierte para verlo en rojo**: escribir mal la ruta de uno de los
      seis; el hallazgo sigue siendo «no existe» y **por eso no alcanza con
      leerlo**: hay que contar que sean seis y que los nombres sean los que van a
      existir.
      ⚠ A partir de acá `npm run test:web` **está en rojo hasta T1470**, a
      propósito. Antes de cerrar cualquier tarea de este hito hay que mirar que
      los hallazgos sean **los de la tabla y nada más**.

**Checkpoint**: `npm --prefix apps/api run superadmin -- …` sobre una empresa
muestra los cuatro permisos nuevos en el rol `gerente`, `requireModulo('x')`
sobre una empresa sin `enabled_modules` deja pasar, y `guardiasDeDiseno` dice
seis veces «el archivo NO existe».

---

## Phase 5: Los datos de la etapa 1 (corte F1.2)

**Purpose**: las cuatro tablas de la etapa 1 existen, están registradas en
`models/index.js` —o `verificar-esquema.js` no las mira— y las tres migraciones
se pueden revertir **sobre datos sembrados**, que es el único lugar donde una
reversión demuestra algo.

⚠ **Los ocho ENUM se declaran `DataTypes.ENUM(...)` en el modelo y
`Sequelize.ENUM(...)` en la migración, con los mismos valores en el mismo
orden.** El job `navegador` corre las migraciones **y después** el arranque en
desarrollo con `sequelize.sync({ alter: true })`: si una columna es ENUM en el
modelo y VARCHAR en la migración, el sync intenta convertirla, Postgres no
castea el default de texto a enum y **el job se cae**. Es el defecto que dejó
ocho columnas divergentes hasta el proyecto 0, y está escrito en `ci.yml:210-222`.

- [x] **T1424** Crear `apps/api/src/migrations/20260815-catalogos.js` y
      `apps/api/src/models/Catalogo.js`, con las columnas de `data-model.md` y
      los tres índices: `uq_catalogo_slug` (`slug` UNIQUE **global**, que es
      **la** garantía de FR-050 y no un `findOne` previo —dos empresas pidiendo
      el mismo slug al mismo tiempo pasan las dos por el `findOne`—),
      `idx_catalogo_empresa` e `idx_catalogo_punto_de_venta`, este último porque
      lo consulta la validación de FR-059 en **cada** intento de desactivar una
      sucursal. Dos decisiones que van con su comentario:
      `punto_de_venta_id` con **`ON DELETE RESTRICT` y no `SET NULL`** —un
      catálogo publicado sin punto de venta no sabe de dónde leer stock, y `NULL`
      obligaría a un ternario en cada consulta de disponibilidad, que es
      justamente lo que `utils/sucursalDeStock.js` existe para evitar—; y `slug`
      **STRING(60) y no TEXT**, porque un slug de doscientos caracteres no se
      copia a mano de un cartel. El modelo se **exporta desde `models/index.js`**
      (FR-212) **sin ninguna asociación declarada**, con el comentario del molde
      de `models/index.js:39-48`: `analizarIncludes` clasifica cualquier
      `include` de una tabla asociada con `empresa_id` como «hijo con
      `empresa_id`», y el ancla de `aislamientoEmpresas.test.js:1136` existe para
      **no** moverse.
      **Verificación**: `npm --prefix apps/api run db:migrate` y
      `verificar:esquema`; `npm exec -w apps/api -- jest reversibilidadDeMigraciones`.
      **El test que evita el defecto**: en `catalogos.integracion.test.js`
      (T1432), *«dos empresas no pueden tener el mismo slug»*, afirmado contra el
      `SequelizeUniqueConstraintError` y no contra un `findOne`.
      **Qué se revierte para verlo en rojo**: sacarle el `unique: true` al índice
      del slug.

- [x] **T1425** Crear `apps/api/src/migrations/20260816-catalogo-productos-y-reglas.js`
      con las **dos** tablas juntas —van juntas porque las dos tienen FK a
      `catalogos`, ninguna sirve sin la otra y las dos se borran juntas si la
      fase se revierte— y los modelos `CatalogoProducto.js` y
      `CatalogoReglaPrecio.js`, exportados sin asociaciones. Lo que no se puede
      escribir de otra manera:
      **(a)** `catalogo_productos` **sin `empresa_id`** —la tabla se opera
      siempre como «las filas del catálogo X», y X ya pasó por `findScoped`;
      agregar la columna daría una segunda fuente de verdad sobre a quién
      pertenece una fila, y dos fuentes es una que puede estar mal— con
      `uq_catalogo_producto (catalogo_id, product_id)` UNIQUE, para que agregar
      dos veces el mismo producto sea un no-op y no una fila duplicada.
      **(b)** `catalogo_reglas_precio` con **tres columnas anulables**
      (`categoria`, `brand_id`, `product_id`) y **no** un `ambito_valor`
      polimórfico: una columna que guarda «texto de categoría o `brand_id` o
      `product_id`» **no puede tener clave foránea**, y sin FK el
      `ON DELETE CASCADE` de FR-083 **no se puede escribir** y borrar una marca
      deja una regla apuntando a un número que ya no existe.
      **(c)** El **CHECK `ck_regla_ambito`** que exige exactamente la columna del
      ámbito. Sin él, una regla de ámbito `marca` con `product_id` cargado es una
      fila que el motor no sabe interpretar y que ningún test va a producir.
      **(d)** Los **cuatro índices únicos parciales**, uno por ámbito. ⚠ Un
      índice único ordinario sobre las cinco columnas **no serviría**: en
      Postgres `NULL` no es igual a `NULL`, así que dos reglas de ámbito
      `catalogo` —las dos con las tres columnas en `NULL`— **no chocarían
      nunca**. Y son los que hacen que un producto tenga **como mucho cuatro
      candidatas**, que es lo que vuelve trivial «gana la más específica».
      **Verificación**: `npm --prefix apps/api run db:migrate`,
      `verificar:esquema`, y
      `node apps/api/scripts/verificar-reversibilidad.js --desde 20260814`.
      **Los tests que evitan el defecto** (en `catalogos.integracion.test.js`,
      T1434): *«dos reglas del mismo ámbito y objetivo chocan contra el índice de
      la base»* y *«una regla de ámbito marca con `product_id` cargado la rechaza
      el CHECK»*.
      **Qué se revierte para verlo en rojo**: reemplazar los cuatro índices
      parciales por uno ordinario sobre las cinco columnas; el primer test pasa
      igual para `producto` y **falla para `catalogo`**, que es el caso que el
      `NULL != NULL` deja escapar.

- [x] **T1426** [P] Crear `apps/api/src/migrations/20260817-catalogo-visitas.js` y
      `apps/api/src/models/CatalogoVisita.js`, exportado sin asociaciones. La
      clave única es de **cuatro** columnas —`uq_visita (catalogo_id, fecha,
      origen, estado_catalogo)`— y ese es el hallazgo 3 del plan: con la clave de
      tres que traía Key Entities, **US20 escenario 7 no se puede cumplir**,
      porque la fila no guarda el estado del catálogo en el momento de la visita
      y cuando alguien mire la pestaña el catálogo ya va a estar en otro estado.
      `fecha` es `DATEONLY` y sale de `fechaDelNegocio(zona)` de `utils/fechas.js`
      —**no** de `toISOString()`, que en Argentina manda una visita de las 21:30
      al día siguiente—. **No guarda IP, ni cookie, ni identificador de
      dispositivo** (FR-201): la tabla no tiene dónde ponerlo aunque alguien
      quisiera.
      **Verificación**: `verificar:esquema` y `reversibilidadDeMigraciones`.
      **El test que evita el defecto**: en T1439, *«dos visitas del mismo día y
      el mismo origen con el catálogo en estados distintos son dos filas»* — es
      lo único que distingue la clave de cuatro columnas de la de tres.
      **Qué se revierte para verlo en rojo**: sacar `estado_catalogo` de la clave
      única; el test cuenta una fila donde tienen que ser dos.

- [x] **T1427** [P] En `apps/api/scripts/verificar-reversibilidad.js`, la función
      `sembrar()` gana lo de la etapa 1: **un catálogo publicado con su punto de
      venta** —para que el `ON DELETE RESTRICT` de `catalogos.punto_de_venta_id`
      tenga algo que restringir—, **una regla de cada ámbito** —para que el CHECK
      y los cuatro índices parciales se ejerciten— y **dos filas de
      `catalogo_visitas` del mismo día y el mismo origen con estados distintos**.
      **Sin esto las tres migraciones revierten bien sobre tablas vacías y las
      dos fotos dan iguales por la razón equivocada**, que es el error que el
      encabezado del propio script ya advierte.
      **Verificación**:
      `node apps/api/scripts/verificar-reversibilidad.js --desde 20260814`, y que
      el informe **nombre filas**, no cero.
      **El test que evita el defecto**: el propio script —*«la reversión se probó
      con datos, no sobre tablas vacías»*.
      **Qué se revierte para verlo en rojo**: sacar la siembra; el informe pasa
      igual y ahí se ve que no probaba nada.

**Checkpoint**: `verificar-esquema.js` mira las cuatro tablas nuevas y no reporta
ninguna divergencia, y las tres migraciones van y vuelven sobre una base sembrada
sin dejar diferencias de esquema.

---

## Phase 6: Las funciones puras del catálogo (corte F1.3)

**Purpose**: todo lo que se puede afirmar **sin base y sin servidor** queda
escrito y probado antes de que exista un endpoint que lo use. Las cuatro tareas
van en paralelo: tocan archivos distintos y ninguna depende de otra.

⚠ Los cuatro tests van en **`apps/api/src/tests/`** y nunca en
`src/utils/*.test.js`: el `testMatch` de `jest.config.js` solo levanta
`src/tests/**`, así que un `src/utils/algo.test.js` **jest no lo corre nunca** —
no falla, no avisa, y alguien lee el nombre del archivo y da por cubierto lo que
jamás se ejecutó.

- [x] **T1428** [P] Crear `apps/api/src/utils/slugDeCatalogo.js` con
      `normalizarSlug(texto)` —minúsculas, sin acentos, `[a-z0-9-]`, sin guiones
      repetidos ni en los bordes—, `validarSlug(slug)` → `{ ok, motivo }` con
      largo 3..60 y la lista de reservados, `RESERVADOS = ['c', 'api', 'assets',
      'admin', 'robots.txt', 'favicon.ico', 'img', 'static', 'public']`, y
      `slugDeLaRuta(path)`, que es la que va a usar el `keyGenerator` del
      limitador: **en el punto de montaje los `req.params` todavía no existen**,
      así que el slug se saca del camino. Su test en
      `apps/api/src/tests/slugDeCatalogo.test.js`.
      📌 **La misma función la usa el formulario del panel** (FR-051), y no por
      prolijidad: si el formulario propone `comprafit-fitnet` y el servidor
      guarda otra cosa, el usuario apretó «Publicar» sobre una dirección y quedó
      publicada otra — **y esa dirección se imprime en una pared**. `apps/web` la
      **duplica** (son ocho líneas sin dependencias) y una **guardia de texto**
      del molde de `apps/web/src/tests/mediosDePago.test.js:46` lee el archivo de
      `apps/api` y compara la lista de reservados y el regex. Es un caso donde la
      copia se acepta **y hay que decir por qué**: crear un tercer paquete
      compartido para ocho líneas engordaría el corte de workspaces sin resolver
      nada que la guardia no resuelva. Esa guardia se escribe en **T1453**, con
      el formulario.
      **Verificación**: `npm exec -w apps/api -- jest slugDeCatalogo`.
      **Los tests que evitan el defecto**: *«“Comprafit / Fitnet” con acentos y
      mayúsculas da `comprafit-fitnet` y no `comprafit--fitnet`»*, *«`c` está
      reservado: es el prefijo de la propia URL pública»* y *«`slugDeLaRuta`
      saca el slug de `/c/comprafit-fitnet/productos` y devuelve `null` en
      `/salud`»*.
      **Qué se revierte para verlo en rojo**: sacar el colapso de guiones
      repetidos.

- [x] **T1429** [P] Crear `apps/api/src/utils/textoDeBusqueda.js` con
      `normalizarTexto(s)` —minúsculas, sin acentos, sin espacios de los bordes—
      y su test. Es **la única** comparación de categoría y de búsqueda del
      sistema (FR-079), y la usan **tres** consumidores: el índice de reglas de
      categoría, las píldoras de categoría de la tienda y el buscador. Con dos
      funciones, `Nutremax` y `NUTREMAX` salen filtrados de una y no de la otra,
      y **el mismo producto aparece en el catálogo con un precio y en la
      previsualización con otro**.
      **Verificación**: `npm exec -w apps/api -- jest textoDeBusqueda`.
      **El test que evita el defecto**: *«“Proteínas” y “proteinas” son la misma
      categoría»*.
      **Qué se revierte para verlo en rojo**: sacar el borrado de acentos.

- [x] **T1430** [P] Crear `apps/api/src/utils/reglasDePrecio.js`, **función pura
      y sin base**, con `reglaQueGana`, `aplicarRegla`, `validarRegla` y
      `resolverPrecios(productos, reglas)` → `{ porProducto, cobertura }`. Cómo,
      y por qué así (decisión 6):
      **(a)** El índice único de la base garantiza **una sola regla por
      (catálogo, ámbito, objetivo)**, así que un producto tiene **como mucho
      cuatro** candidatas y «la más específica» es un máximo sobre cuatro
      elementos con una escala fija —producto 4 > marca 3 > categoría 2 >
      catálogo 1—: **no hay empate posible que haya que desempatar inventando una
      regla**. Las otras tres son las «pisadas».
      **(b)** La cobertura sale de **la misma pasada**: una pasada sobre las
      reglas arma el índice (`O(R)`), una pasada sobre los productos hace cuatro
      búsquedas en `Map` por producto e incrementa **dos contadores por regla**,
      `alcanza` en cada candidata y `gana` en la ganadora (`O(P)`). Total
      **`O(R + P)`**, y la cobertura es **gratis**. Lo ingenuo —recorrer los
      productos por cada regla— es `O(R × P)` y obliga a repetir el recorrido en
      cada pedido de pantalla.
      **(c)** El **universo de la cobertura son los productos del catálogo**, o
      sea las filas de `catalogo_productos`, no el inventario entero: si
      `alcanza` contara productos que la previsualización no muestra, las dos
      pantallas dirían cosas distintas sobre lo mismo (criterio 12).
      **(d)** `validarRegla` rechaza **al guardar** el porcentaje fuera de
      `(0, 100]` y el precio fijo de $0 (FR-075). Al **aplicar**, la única guarda
      que queda es `Math.max(0, …)`, con la misma forma que
      `precioConDescuento` de `packages/precios`.
      Su test en `apps/api/src/tests/reglasDePrecio.test.js`, con **los seis
      precios de `PREVIEW`** (maqueta `:1543-1550`) y **las cuatro coberturas de
      `REGLAS`** (`:1524-1541`) como casos, más las cuatro combinaciones de
      ámbito y las tres de tipo.
      **Verificación**: `npm exec -w apps/api -- jest reglasDePrecio`.
      **Los tests que evitan el defecto**: *«un producto alcanzado por cuatro
      reglas termina con una sola, y las otras tres quedan pisadas»*, *«“gana en
      2 de 4” sale del mismo recorrido que los precios y los dos números
      cierran»*, *«un descuento del 100 % da cero y no un negativo»* y *«una
      regla desactivada se comporta como si no existiera»*.
      **Qué se revierte para verlo en rojo**: invertir la escala de
      especificidad; el primer test nombra la regla de catálogo ganando sobre la
      de producto.

- [x] **T1431** [P] Extraer el `switch` de los cinco estados de
      `apps/api/src/middleware/checkSubscription.js:85-115` a
      `apps/api/src/utils/estadoDeSuscripcion.js`,
      `evaluarSuscripcion(sub, ahora)` → `{ bloqueado, motivo }`.
      `checkSubscription.js` **queda igual por fuera** —mismos 402, mismos
      mensajes, **mismo `catch` que deja pasar**— y por dentro delega. Eso es lo
      que hace verificable FR-110: no hay una segunda lista de estados, hay
      **una**. Y **la asimetría queda escrita en los dos archivos, cada uno
      nombrando al otro**: la cadena privada ante un error de base **deja pasar**
      (`:127-130`) y el camino público **cierra con 503** (FR-112a); un
      comentario suelto en uno solo es el que alguien «unifica» seis meses
      después. Su test en `apps/api/src/tests/estadoDeSuscripcion.test.js`, con
      los cinco valores del enum **más el desconocido**.
      **Verificación**: `npm exec -w apps/api -- jest estadoDeSuscripcion
      checkSubscription`. Los tests que ya existen de `checkSubscription` pasan
      **sin haberlos tocado** — es lo único que demuestra que la extracción no
      cambió el comportamiento de la cadena privada.
      **Los tests que evitan el defecto**: *«un estado que no está en el enum
      bloquea, no deja pasar»* y *«período de gracia sigue funcionando»*.
      **Qué se revierte para verlo en rojo**: cambiar el caso por defecto del
      `switch` a `bloqueado: false`.

**Checkpoint**: los cuatro tests corren **sin base y sin servidor**, y la
previsualización de la maqueta —los seis precios y las cuatro coberturas— sale de
una función que todavía nadie llama.

---

## Phase 7: La API privada de catálogos (corte F1.4)

**Purpose**: un catálogo se crea, se le cargan productos y reglas, y la
previsualización devuelve los precios — **todo por HTTP y sin que exista ninguna
pantalla**. Es lo que permite que la pantalla de F1.8 se dibuje contra un
contrato real y no imaginado.

- [x] **T1432** Crear `apps/api/src/routes/catalogos.js` con el ABM:
      `GET /`, `POST /` (crea en **`borrador`** y normaliza el slug con
      `normalizarSlug` **antes** de guardar), `GET /:id`, `PUT /:id` con **campos
      explícitos y nunca `...req.body`**, `DELETE /:id` (en cascada sobre
      `catalogo_productos`, `catalogo_reglas_precio` y `catalogo_visitas`) y
      `GET /slug-disponible?slug=`. Todo con `findScoped(Catalogo, id,
      req.empresaId)`. El choque de slug llega como `ErrorDeNegocio` legible que
      **no dice de quién es** el slug tomado (FR-053), y **lo garantiza el
      índice, no un `findOne` previo**: dos empresas pidiendo el mismo slug al
      mismo tiempo pasan las dos por el `findOne`, así que el `catch` del
      `SequelizeUniqueConstraintError` es el camino real y no el excepcional.
      `GET /slug-disponible` es **para el formulario y no sustituye al índice**:
      entre la consulta y el guardado pasa tiempo. Montaje en
      `apps/api/src/server.js`:
      `app.use('/api/catalogos', ...authEmpresa, requireModulo('catalogo'),
      require('./routes/catalogos'))`. Ancla 2: la lista literal de `routes/` de
      `permisosDeRutas.test.js:549-565` pasa de **19 a 20**, con su fila de
      permisos por ruta. Crear
      `apps/api/src/tests/integracion/catalogos.integracion.test.js`.
      **La fixture tiene que poder distinguir el defecto**: **un catálogo en cada
      empresa** —si no, «el de B da 404 desde A» no se distingue de «no hay
      nada»— y **dos catálogos en la empresa A**, para que más adelante «el
      pedido cayó en el catálogo equivocado» sea detectable.
      **Verificación**: `npm exec -w apps/api -- jest permisosDeRutas montajeDeRouters` y
      `npm --prefix apps/api run test:integracion -- catalogos`.
      **Los tests que evitan el defecto**: *«`GET /api/catalogos/:id` con el id
      de un catálogo de otra empresa responde 404 y no filtra el nombre»*, *«dos
      empresas no pueden tener el mismo slug, y el mensaje no dice de quién
      es»* y *«un `empresa_id` en el cuerpo no cambia de dueño el catálogo»*.
      **Qué se revierte para verlo en rojo**: cambiar `findScoped` por
      `Catalogo.findByPk`; el primero devuelve 200 con datos ajenos.
      📌 **Queda anotado y se cierra en T1461**: el `DELETE` todavía **no**
      responde 409 `TIENE_PEDIDOS` (FR-069) porque la tabla `pedidos` no existe
      hasta F2.1. Acá borra en cascada, y está bien: no hay pedido que perder.

- [x] **T1433** En el mismo archivo, `POST /:id/publicar`, `POST /:id/pausar` y
      `POST /:id/despublicar`. **Publicar no es cambiar una columna**: es una
      verificación de **cuatro condiciones** —nombre visible, slug, punto de
      venta **activo** y al menos un producto que salga—, y si falta algo la
      respuesta es una **lista** y no un mensaje (FR-057):
      `409 { error: 'FALTAN_REQUISITOS', faltan: [{ que, detalle }] }`. Un solo
      mensaje concatenado obliga al comercio a arreglar una cosa, reintentar,
      descubrir la siguiente y repetir; con la lista ve las cuatro de una.
      `despublicar` **es otra cosa que pausar** y va escrito: borrador da 404,
      pausado da la pantalla de pausa. Y en `apps/api/src/routes/general.js`,
      `PUT /puntos-de-venta/:id`: **desactivar una sucursal usada por un catálogo
      publicado se rechaza nombrando el catálogo** (H13, FR-059) — la base no lo
      puede impedir porque desactivar no es borrar, así que vive en el handler.
      **Verificación**: `npm --prefix apps/api run test:integracion -- catalogos`.
      **Los tests que evitan el defecto**: *«publicar sin productos que salgan
      devuelve la lista de lo que falta, no un mensaje suelto»*, *«publicar con
      la sucursal desactivada nombra la sucursal»* y *«desactivar la sucursal de
      un catálogo publicado se rechaza nombrando el catálogo, y la sucursal
      queda activa»* —afirmando el estado de la fila después del 409—.
      **Qué se revierte para verlo en rojo**: devolver un string concatenado en
      vez de `faltan: []`; el primer test cuenta los elementos.

- [x] **T1434** En el mismo archivo, las reglas: `GET /:id/reglas` **con su
      cobertura** —`{ alcanza, gana }` por regla, sacada de `resolverPrecios`—,
      `POST /:id/reglas`, `PUT /:id/reglas/:reglaId`, `DELETE /:id/reglas/:reglaId`
      y `GET /:id/categorias`, que devuelve **las categorías que existen hoy** en
      los productos publicables del catálogo (FR-078): `products.category` es
      texto libre (`Product.js:60`) y **no hay tabla de categorías**, así que se
      agrupan con `normalizarTexto`. El handler hace **`findScoped` del objetivo
      antes de crear** —la marca o el producto— en el mismo ámbito, y una regla
      sobre algo de otra empresa responde **404 sin dejar ninguna fila** (FR-081);
      el `findScoped` va **delante y en el mismo handler** para que el detector
      de «padre ajeno» de `aislamientoEmpresas.test.js:867-1044` lo vea. La
      regla huérfana —`brand_id` en `NULL` por el `ON DELETE SET NULL`— devuelve
      cobertura `0 de 0` y **no se borra sola**.
      **La fixture tiene que poder distinguir el defecto**: **una regla de cada
      ámbito sobre el mismo producto**. Sin eso no se puede ver cuál gana, y el
      test pasa con cualquier escala de especificidad.
      **Verificación**: `npm exec -w apps/api -- jest aislamientoEmpresas` y
      `npm --prefix apps/api run test:integracion -- catalogos`.
      **Los tests que evitan el defecto**: *«una regla sobre un producto de otra
      empresa responde 404 y `CatalogoReglaPrecio.count()` no se movió»*, *«dos
      reglas del mismo ámbito y objetivo chocan contra el índice y el mensaje
      nombra la que ya estaba»* y *«borrar la marca deja la regla con cobertura 0
      de 0 y no la borra»*.
      **Qué se revierte para verlo en rojo**: sacar el `findScoped` del objetivo;
      el primero crea una fila que apunta a la marca de otra empresa.

- [x] **T1435** En el mismo archivo, los productos del catálogo y la
      previsualización: `GET /:id/productos` —los del catálogo **y** los
      publicables que no están, con `en_el_catalogo`, `publicable`, `is_active` y
      los avisos `SIN_PRECIO` y `FOTO_EXTERNA` (que sale de `esImagenPropia`)—,
      `POST /:id/productos` y `DELETE /:id/productos`, los dos **en lote**
      (FR-066): sin acciones masivas, armar el catálogo el primer día son 62
      clics, y por eso no son un adorno de la maqueta sino parte de lo que hace
      usable la selección explícita. Quitar un producto **borra su fila**
      (FR-065). Y `GET /:id/previsualizacion` con las cinco columnas de la
      maqueta (`:959-973`), más dos cosas que no son adorno:
      **`avisos: ["QUEDA_EN_CERO"]`** cuando una regla deja el precio en $0
      (FR-077) —en el punto de venta eso lo mira una persona; en una página
      pública **un producto a $0 es una oferta**, y alguien la va a tomar— y
      **`sin_precio`**, la lista de los que no van a salir aunque estén marcados
      publicables (FR-076, H5): hoy serían **376 de 431**, y el panel dice
      cuántos son **y cuáles**.
      **Verificación**: `npm --prefix apps/api run test:integracion -- catalogos`.
      **Los tests que evitan el defecto**: *«un producto con costo $0 aparece en
      `sin_precio` y NO en la lista de los que salen»*, *«agregar dos veces el
      mismo producto no crea dos filas»* y *«un `product_id` de otra empresa en
      el lote no agrega nada»*.
      **Qué se revierte para verlo en rojo**: dejar salir los `sinCosto`; el
      primer test los encuentra en la grilla.

- [x] **T1436** [P] En el mismo archivo, `POST /:id/imagen` (campo `tipo` =
      `logo` | `portada`) y `DELETE /:id/imagen?tipo=`, reusando **tal cual**
      `utils/imagenes.js` de T1416 con las dos medidas propias: portada 1200×480
      JPEG y logo 400×400 **PNG**. Las columnas guardan la **ruta relativa**.
      Filas nuevas en `permisosDeRutas.test.js`.
      **Verificación**: `npm exec -w apps/api -- jest permisosDeRutas` y
      `npm --prefix apps/api run test:integracion -- catalogos`.
      **El test que evita el defecto**: *«el logo se guarda en PNG y conserva la
      transparencia»* — es lo que la pantalla pide (`:804`) y lo que un JPEG
      pierde en silencio.
      **Qué se revierte para verlo en rojo**: convertir el logo a JPEG; el test
      lee el formato con `sharp().metadata()`.

**Checkpoint**: por `curl` se crea «Comprafit / Fitnet», se le agregan ocho
productos, se le cargan las cuatro reglas de la maqueta y
`GET /api/catalogos/:id/previsualizacion` devuelve los seis precios con su regla
ganadora y sus pisadas. **La pantalla todavía no existe.**

---

## Phase 8: El router público de lectura (corte F1.5)

**Purpose**: el primer pedazo de Favalio que le contesta a alguien que no inició
sesión. Al terminar, el enlace de un catálogo devuelve JSON con la marca, las
categorías y la primera página de productos; el de otra empresa da 404; y el
tráfico del catálogo **no le come el cupo al punto de venta del comercio**.

⚠ **Esta fase es la que la suite rápida no puede ver.** Con `BYPASS_AUTH` un
router público que filtre datos de otra empresa pasa en verde. Lo que la sostiene
son los tests de `src/tests/integracion/` y las dos guardias estáticas nuevas, y
las dos cosas hay que **pedirlas**.

- [x] **T1437** Crear `apps/api/src/tests/proyeccionPublica.test.js` **antes de
      que existan los archivos que mira** (FR-097), con `routes/catalogoPublico.js`
      y `utils/vistaPublica.js` en su lista. Tres reglas y un ancla (decisión 5):
      **Regla A**, sobre `vistaPublica.js`: no menciona ninguno de los **diez**
      nombres prohibidos —`cost`, `margin_override`, `wholesale_margin`,
      `wholesale_price`, `supplier_id`, `barcode`, `is_active`, `publicable`,
      `empresa_id`, `punto_de_venta_id`— y **no contiene** `...`,
      `Object.assign`, `toJSON`, `Object.keys` ni `for (const k in`. Todo lo que
      devuelve es un literal.
      **Regla B**, sobre `catalogoPublico.js`: todo `res.json(` recibe un objeto
      literal cuyas hojas son llamadas a `vistaPublica.*`, o una llamada directa;
      y todo `attributes:` es un **arreglo literal** — `{ exclude:` es un
      hallazgo. La lista negra es lo que se descarta y el motivo va escrito: el
      campo que `Product` gane el mes que viene **entra solo** a toda respuesta
      pública y nadie se entera.
      **Regla C**, las muestras sintéticas: cuatro que la guardia **tiene** que
      marcar (`res.json(producto)`, `{ ...p.toJSON() }`,
      `attributes: { exclude: ['cost'] }`, un `vistaPublica` que nombra `cost`) y
      **dos que tiene que dejar pasar**. Son lo que sostiene la guardia el día
      que el repositorio ya no tenga el defecto.
      **El ancla**: encontró al menos N `res.json(` y M `attributes:` en el
      router. Si el número se desploma, el detector dejó de entender la forma y
      las tres reglas estarían pasando sin mirar nada.
      **Verificación**: `npm exec -w apps/api -- jest proyeccionPublica` da **exactamente
      dos** hallazgos, los dos «el archivo NO existe: la guardia no miró nada» —
      el protocolo de `guardiasDeDiseno.test.js:217-238`. **Una guardia que nace
      en verde es una guardia que no se sabe si mira** (criterio 7).
      **El test que evita el defecto**: las seis muestras sintéticas de la regla
      C, que son las que siguen valiendo cuando el router esté bien escrito.
      **Qué se revierte para verlo en rojo**: quitar una muestra mala de la lista
      y comprobar que el `it` correspondiente falla.

- [x] **T1438** Crear las dos funciones puras del camino público, con sus tests:
      **(a)** `apps/api/src/utils/tenantDeSlug.js` con
      `resolverCatalogoPorSlug(slug, { transaction })` → `{ empresaId,
      catalogoId, puntoDeVentaId, estado } | null`. **Cuatro columnas en
      `attributes` y ninguna más**: es la primera proyección explícita del camino
      público y la que garantiza que nada de la fila del catálogo salga de acá
      por accidente. **No mira `req`, no recibe `req`, y no puede leer una
      cabecera aunque alguien quiera** (FR-102). Adentro usa `normalizarSlug`, la
      **misma** función que el formulario.
      📌 **Por qué no se reusa `loadEmpresaContext`** (FR-093), con los dos
      motivos escritos en el archivo: tiene la **rama del superadmin** por
      `X-Empresa-Id` (`auth.js:172-200`) que entra a cualquier empresa **sin
      membresía** —hoy no tendría cómo dispararse, pero la función es de 250
      líneas y la siguiente persona que la toque no va a saber que además la usa
      un endpoint público—, y cuesta cuatro o cinco consultas por request contra
      **una** de cuatro columnas.
      **(b)** `apps/api/src/utils/vistaPublica.js` con `catalogoPublico`,
      `productoPublico` y `pedidoPublico`, **objetos literales campo por campo**.
      `marca` e `imagen` van **ausentes y no en `null`** cuando no hay —el 96 %
      de los productos migrables no tiene marca, y **una clave presente con
      `null` es cómo se dibuja «undefined» en una tarjeta**—; `precio_lista` y
      `ahorro_pct` **solo cuando los dos se cumplen**, interruptor encendido **y**
      precio final **menor** que el de lista (FR-062).
      **Verificación**: `npm exec -w apps/api -- jest tenantDeSlug vistaPublica
      proyeccionPublica` — la guardia de T1437 baja de dos hallazgos a **uno**.
      **Los tests que evitan el defecto**: *«la proyección de un producto no
      lleva `cost` ni `publicable`, aunque la fila los traiga»*, *«un producto sin
      marca no lleva la clave `marca`, no la lleva en `null`»* y *«el resolvedor
      devuelve `null` para un slug inexistente y no tira»*.
      **Qué se revierte para verlo en rojo**: cambiar `productoPublico` por un
      spread de la fila; la regla A de la guardia lo nombra y el test de la clave
      `cost` también.

- [x] **T1439** Crear `apps/api/src/routes/catalogoPublico.js` exportando
      `{ publico }` —`paginas` llega en T1448— y montarlo. Es la tarea más
      delicada del corte y tiene cuatro partes:
      **(a) El middleware `contextoPublico`** del propio router:
      `req.publico = { slug, empresaId, catalogoId, puntoDeVentaId, catalogo }`, y
      **`req.empresaId` se deja sin definir, y eso es la decisión** (decisión 3).
      Cada consulta escribe `req.publico.empresaId` explícitamente. **Por qué no
      se setea `req.empresaId`**, que haría que `scoped` y `findScoped`
      funcionaran igual que en cualquier ruta privada: porque entonces **una
      copia de un handler privado compila y anda**, y la diferencia entre «la
      empresa la resolvió el slug» y «la empresa la resolvió el JWT» deja de
      verse en el código. Con `req.publico`, una consulta copiada de otro lado
      **tira 500 en el primer request** por `assertEmpresaId`
      (`tenantScope.js:110-118`), que es exactamente el comportamiento que se
      quiere: fallar fuerte y temprano.
      **(b) Los tres endpoints**: `GET /c/:slug` —que trae marca, entrega, pagos,
      categorías **y la primera página de productos embebida**, porque es lo que
      mantiene una visita en dos llamadas—, `GET /c/:slug/productos` (`?q=` de
      máximo 80 caracteres y **parametrizado**, `?categoria=`, `?pagina=` acotado,
      y una página vacía es **200 con lista vacía**, no un error) y
      `GET /c/:slug/productos/:id`. Un `:id` de otra empresa, inexistente,
      negativo, enorme o no numérico: **404, mismo cuerpo** — es el caso que un
      `findByPk` haría pasar. `agotado` sale de **`available`** y **solo del punto
      de venta del catálogo**; sin fila de stock → agotado y no es un error;
      `available` negativo → agotado **y queda registrado**, porque es un dato
      inconsistente del inventario.
      **(c) El conteo de visitas**, una vez por apertura y no por endpoint:
      `INSERT … ON CONFLICT (catalogo_id, fecha, origen, estado_catalogo) DO
      UPDATE SET cantidad = catalogo_visitas.cantidad + 1`. **Una fila por día**,
      no una por visita: sin eso el endpoint más leído del sistema sería el que
      más escribe (H7). `?f=` se acota a un conjunto conocido y cualquier otra
      cosa cae en `otro`; **el catálogo se ve igual con el parámetro y sin él**.
      **(d) El montaje y los dos limitadores**, en `apps/api/src/server.js`,
      **inmediatamente después de `app.use('/api/empresas', …)` (`:458`) y antes
      de `/api/products` (`:460`)**, con el comentario que dice **por qué ahí**:
      arriba del `app.use('/api', ...authEmpresa, general)` de `:464` porque los
      middlewares de ese montaje corren para **todo** lo que empiece con `/api`
      —un visitante sin token recibiría el 401 de `checkJwt` antes de llegar a
      ningún handler, que es el defecto que dejó `POST /api/auth/accept-invite`
      respondiendo 403 durante meses—; y **debajo del `express.json` de `:184`**,
      que es lo contrario del público de TiendaNube, porque acá no hay firma HMAC
      que verificar contra el cuerpo crudo y el `POST /pedidos` necesita el
      cuerpo parseado. Se declara `limitadorPublico` al lado del global —60
      segundos, 120 en producción, `keyGenerator` por **IP y slug** con
      `ipKeyGenerator` de `express-rate-limit` v8 (sin él el conteo por IPv6
      agrupa redes enteras) y `slugDeLaRuta(req.path)`— y **al limitador global
      de `:312-319` se le agrega el `skip`** con su motivo escrito al lado
      (hallazgo 1 del plan, FR-113):
      ```js
      // ⚠ El prefijo público del catálogo NO consume este cupo, y sacar esta
      // línea devuelve el problema sin que nada falle: el catálogo seguiría
      // andando y las cajas del comercio empezarían a recibir 429 los sábados
      // a la tarde.
      skip: (req) => req.path.startsWith('/publico/'),
      ```
      ⚠ `req.path` dentro de un `app.use('/api/', …)` **viene relativo al punto
      de montaje**, así que la comparación es `'/publico/'` y **no**
      `'/api/publico/'`. Es justo la clase de detalle que se escribe mal una vez.
      Ancla 1: `ROUTERS_SIN_SESION` pasa de **2 a 3** con el motivo escrito.
      Ancla 2: la lista de `routes/` pasa de **20 a 21**. Ancla 5:
      `montajeDeRouters.test.js:331-338` **sigue en `[]`** y hay que verificarlo.
      Crear `apps/api/src/tests/integracion/catalogoPublico.integracion.test.js`.
      **Verificación**: `npm exec -w apps/api -- jest permisosDeRutas montajeDeRouters
      proyeccionPublica` —la guardia de T1437 baja a **cero** hallazgos— y
      `npm --prefix apps/api run test:integracion -- catalogoPublico`.
      **Los tests que evitan el defecto**: *«el catálogo de B da 404 desde el
      enlace de A»*, *«borrador y slug inexistente devuelven el MISMO cuerpo»*
      —comparando los dos cuerpos entre sí, no cada uno contra una constante—,
      *«el JSON entero, recorrido con objetos anidados y arreglos, no tiene
      ninguna de las diez claves»*, *«pausado devuelve 200 sin productos ni
      precios: las claves no están vacías, NO ESTÁN»*, *«un `product_id` de otra
      empresa da 404 sin decir si existía»* y *«dos visitas del mismo día con el
      catálogo en estados distintos son dos filas»*.
      **Qué se revierte para verlo en rojo**: setear `req.empresaId` en
      `contextoPublico` y usar `scoped(where, req.empresaId)` en un handler —el
      test del 404 de B sigue pasando, y **ése es el punto**: lo que se rompe es
      la propiedad de que una copia de un handler privado falle fuerte, y por eso
      además hay guardia—. Y la mutación que sí se ve: quitarle el `where` de
      empresa a la consulta de productos.

- [x] **T1440** **La guardia que ata el `skip` al limitador propio.** Es una
      tarea con nombre propio porque protege una línea que, borrada, **no rompe
      nada visible**: el catálogo sigue andando y las cajas del comercio empiezan
      a recibir 429 los sábados a la tarde, que es un síntoma que nadie relaciona
      con una línea de `server.js` (riesgo 3, FR-113b). En
      `apps/api/src/tests/observabilidad.test.js`, con el molde de `:394-536`
      (`montajePublicoAntesDelJson`, sus muestras sintéticas y **el `null` cuando
      no encuentra qué mirar**), **cinco aserciones**:
      1. el montaje de `/api/publico` está **después** de `app.use(express.json(`;
      2. está **después** de `app.use('/api/', limiter)`;
      3. está **antes** de `app.use('/api', ...authEmpresa`;
      4. la declaración de `limiter` contiene un `skip` que nombra `'/publico/'`;
      5. **la atadura**: si existe el `skip`, existe `limitadorPublico` **y está
         aplicado en la línea del montaje**.
      Y la guardia **devuelve `null` —o sea falla— si no encuentra alguna de las
      líneas** que dice mirar, en vez de pasar por no haber encontrado nada
      (FR-100; es la lección de `observabilidad.test.js:505-509`). Con su caso
      sintético para el `'/publico/'` relativo, que fija el detalle del punto de
      montaje.
      📌 **Por qué no se resuelve montando el router arriba del limitador**, que
      sería lo obvio, y va escrito: porque entonces la exención **deja de estar
      escrita en ningún lado**. Un router que quedó sin límite «por el orden» es
      un router que nadie sabe que está sin límite, y el día que alguien le saque
      el suyo la superficie pública queda desnuda sin que se mueva una línea del
      archivo del limitador. Con el `skip`, la exención vive **al lado del
      limitador que exime**.
      **Verificación**: `npm exec -w apps/api -- jest observabilidad`.
      **Los tests que evitan el defecto**: *«el prefijo público está eximido del
      limitador global»*, *«un prefijo eximido sin limitador propio es una
      superficie abierta»* y *«la guardia falla cuando no encuentra el montaje,
      en vez de pasar por vacío»*.
      **Qué se revierte para verlo en rojo**: **las dos mutaciones, de verdad y
      una por vez**. (1) Borrar el `skip` del limitador global: la aserción 4 lo
      nombra. (2) Dejar el `skip` y sacar `limitadorPublico` de la línea del
      montaje: la aserción 5 lo nombra. Correlas antes de cerrar la tarea; una
      guardia de posición que no se probó en los dos sentidos es una descripción.
      ⚠ **Ningún test de integración puede distinguir esto**: los límites no se
      ejercitan en la suite, y con `BYPASS_AUTH` el catálogo anda igual. La
      guardia estática es la única red.

- [x] **T1441** La suscripción en el camino público, dentro del handler y con
      `evaluarSuscripcion` de T1431 (FR-110): vigente o en gracia → normal;
      **vencida y gracia agotada, o sin fila de suscripción → 200 con
      `estado: 'no_disponible'` y sin productos ni precios**; **error de base →
      503 `NO_DISPONIBLE_POR_UN_MOMENTO`**, con `logger.error` que lleva **el
      slug y la empresa** (FR-112a). Los dos matices van escritos en el archivo:
      **vencida devuelve 200 y no 402** porque el 402 es un contrato entre la API
      y `apps/web`, que lo intercepta y muestra el aviso de renovación
      (`services/api.js:171-177`) — **acá el que lee no es el moroso**: es un
      socio del gimnasio, y el mensaje del 402 le contaría a un desconocido que
      el comercio está en mora; y **el error de base devuelve 503 y no 402**
      porque 402 afirmaría que la suscripción venció, y lo que pasó es que **no
      se pudo saber**, así que se cierra en vez de abrir, **al revés que la
      cadena privada**, que no cambia.
      **Verificación**: `npm --prefix apps/api run test:integracion --
      catalogoPublico`.
      **Los tests que evitan el defecto**: *«la suscripción vencida apaga el
      catálogo»* —**el único lugar donde se puede probar**, porque `BYPASS_AUTH`
      saltea `checkSubscription` en la cadena privada (`server.js:407`)—, *«el
      error al consultar la suscripción responde 503 en el público»* y —la otra
      mitad, que se olvida— *«el mismo error deja pasar en la cadena privada: la
      asimetría es deliberada»*.
      **Qué se revierte para verlo en rojo**: copiar el `catch` de
      `checkSubscription.js:127-130` —el que deja pasar— al camino público; el
      segundo test recibe 200 con productos.

**Checkpoint**: `curl https://…/api/publico/c/comprafit-fitnet` devuelve el
catálogo con sus productos y precios; el slug de la empresa B da el mismo 404 que
un slug inventado; y el `skip` del limitador está puesto, atado y probado en los
dos sentidos.

---

## Phase 9: `apps/tienda` (corte F1.6)

**Purpose**: la cuarta app del monorepo existe, se dibuja a **390px** sin
desbordar, consume el router público de F1.5 y **no tiene sesión que falsear**.

⚠ **Va después de F1.5 aunque el esqueleto se pueda escribir antes**: la tienda
consume lo que el router público devuelve, y si se dibuja primero se dibuja
contra un contrato imaginado. `apps/tienda` **no puede tener reglas propias**
(H2): no calcula precios, no formatea importes por su cuenta, los recibe
formateados por el servidor.

- [x] **T1442** Crear el esqueleto de `apps/tienda`: `package.json`
      (`favalio-tienda`, `type: module`, `dependencies` **solo** `react` y
      `react-dom`), `vite.config.js` (`server.port 5175 strictPort`, bloque
      `test` con jsdom), `index.html` **con el marcador `<!--FAVALIO_META-->` en
      el `<head>`**, `public/robots.txt` con `Disallow: /c/`, `nginx.conf` (copia
      del de `apps/web`), `Dockerfile` con contexto en la raíz y el molde de
      `apps/landing`, y `src/main.jsx` + `src/App.jsx` con las cinco rutas
      (`/c/:slug`, `/p/:id`, `/carrito`, `/checkout`, `/confirmado/:numero`). El
      workspace la toma sola: **no hay que tocar el `workspaces` de la raíz**,
      que ya dice `apps/*`. Y la guardia
      `apps/tienda/src/tests/guardiaDeLaTienda.test.js`, que recorre
      `apps/tienda/src` y falla si aparece `Authorization`, `X-Sesion-Id`,
      `auth0`, `@/services/api`, `localStorage.getItem('token')` o un
      **hexadecimal de color**, con su ancla: encontró los N archivos que dice
      revisar.
      📌 **`apps/tienda` no comparte nada con `apps/web`** y eso es su propiedad
      definitoria, no una omisión: ni el sistema de diseño —`apps/web` declara
      mínimo 1280px—, ni Auth0, ni el cliente HTTP.
      **Verificación**: `npm run build -w apps/tienda` y
      `npm test -w apps/tienda -- guardiaDeLaTienda`.
      **El test que evita el defecto**: *«no hay ninguna cabecera de sesión en
      `apps/tienda/src`»*, con su muestra sintética.
      **Qué se revierte para verlo en rojo**: agregar un
      `headers: { Authorization: … }` en cualquier archivo de `src/`.

- [x] **T1443** [P] Las tres piezas de base, cada una con su test de función
      pura: **(a)** `src/api.js`, cliente HTTP con **`fetch` nativo, no axios**
      (FR-120) — treinta líneas, sin interceptores, sin `Authorization`, sin
      `X-Sesion-Id` y sin el manejo de 401 que dispara el logout
      (`apps/web/src/services/api.js:150-167`). **Alternativa descartada y por
      qué**: copiar `services/api.js` y sacarle lo que sobra, porque **lo que
      sobra es exactamente lo que no se puede tener**, y un archivo que arranca
      teniendo las tres cosas y se las quita es un archivo al que alguien se las
      devuelve copiando de la app privada. Un `fetch` de treinta líneas **no
      puede heredar una cabecera de sesión por accidente**. Habla contra
      **su propio origen** (`/api/publico/...`, relativo): sin CORS de por medio
      no hay preflight que fallar en silencio. **(b)** `src/tema.js` con
      `textoSobre()` —portada tal cual de la maqueta (`:1211-1218`), con su test
      sobre **los cuatro colores de prueba** de `:55-58`— que al montar escribe
      **dos** variables en `document.documentElement`: `--marca` y
      `--marca-texto`. Los componentes usan `var(--marca)` y **nunca** un hex,
      que es lo que hace verificable «el color solo en lo que se toca»: el hex
      está prohibido por la guardia y `--marca` se define en un solo archivo.
      **(c)** `src/carrito.js`, el carrito en `localStorage`: **función pura más
      hook**, para que las reglas —sumar el mismo producto, acotar la cantidad—
      se prueben sin render.
      **Verificación**: `npm test -w apps/tienda`.
      **Los tests que evitan el defecto**: *«sobre turquesa el texto sale oscuro
      y sobre negro sale claro, calculado y no elegido»* (FR-060) y *«agregar dos
      veces el mismo producto suma cantidad, no agrega una línea»*.
      **Qué se revierte para verlo en rojo**: fijar `--marca-texto` en blanco; el
      primer test falla con el color claro.

- [x] **T1444** La pantalla **Catálogo**: portada, logo, buscador y píldoras de
      categoría (`esCatalogo`, `:89-158`), la grilla y el «ver más». **El
      filtrado y el cambio de categoría se hacen en el navegador** sobre la
      primera página, que ya vino embebida: **cero llamadas por tecla** (FR-114,
      US8 escenario 2), y solo se pide otra página cuando el visitante aprieta
      «ver más». La comparación de categoría usa la misma normalización que el
      servidor. En escritorio **no se abre a una grilla ancha**: sube a tres
      columnas dentro de los mismos 720px (`:449-464`). El pie **«powered by
      favalio»** en todas las pantallas (FR-122). Su test de render en
      `apps/tienda/src/tests/`.
      **Verificación**: `npm test -w apps/tienda -- renderDelCatalogo`.
      **Los tests que evitan el defecto**: *«escribir en el buscador NO dispara
      ninguna llamada al servidor»* —espiando `fetch`— y *«un producto sin marca
      no dibuja el renglón de la marca, y no dibuja `undefined`»*.
      **Qué se revierte para verlo en rojo**: hacer que el buscador pida al
      servidor por tecla; el primer test cuenta las llamadas.

- [x] **T1445** La **ficha de producto** (`esProducto`, `:160-197`): descripción
      —**ausente cuando está vacía**, para que la ficha no quede con un hueco—,
      control de cantidad **acotado a `stock_disponible`**, y el botón «Sin
      stock» **inerte**. Su test de render.
      **Verificación**: `npm test -w apps/tienda -- renderDeLaFicha`.
      **Los tests que evitan el defecto**: *«el botón “Sin stock” no dispara
      nada»* y *«el control no deja pedir más de lo que hay»*.
      **Qué se revierte para verlo en rojo**: sacarle el `disabled` al botón; el
      primero registra la llamada al carrito.

- [x] **T1446** Los **seis estados** de este corte, en `src/estados/`, cada uno
      con su salida propia y distinguible (criterio 18): `Cargando`, `Pausada`
      —que dibuja marca, nombre, descripción y WhatsApp y **nada más**, con el
      **mismo camino** que `no_disponible`, que es un estado neutro sin
      WhatsApp—, `SinResultados`, `CarritoVacio`, `NoDisponible` y
      `DemasiadasPeticiones`, que **invita a reintentar y no es una pantalla en
      blanco** (US10 escenario 10). Los dos que faltan —`PagoRechazado` y
      `SeAgoto`— llegan en T1467, con el pedido. Sus tests de render.
      **Verificación**: `npm test -w apps/tienda -- estados`.
      **Los tests que evitan el defecto**: *«los seis estados dicen cosas
      distintas: ninguno cae en la pantalla genérica»* y *«`no_disponible` no
      dice que el comercio está en mora»* —afirmado sobre el texto, buscando
      «suscripción», «venci» y «pago»—.
      **Qué se revierte para verlo en rojo**: hacer que `no_disponible` reuse el
      texto del 402 de `apps/web`.

- [ ] **T1447** El **séptimo job de CI** y la prueba de 390px. **(a)**
      `apps/tienda/playwright.config.js` **propio**, con
      `viewport: { width: 390, height: 844 }`, su `webServer`
      (`vite --port 5175 --strictPort`) y su `globalSetup`. **Alternativa
      descartada y por qué**: un segundo `project` en el config de `apps/web`,
      porque ese arnés existe **alrededor del bypass de sesión** —el alias de
      `vite.config.js`, `ProveedorDeSesionDePrueba.jsx` y las tres guardias que
      verifican que eso **no exista** en un bundle— y **la tienda no tiene sesión
      que falsear**; meterla en el arnés que la falsea es arrastrarle una pieza
      que su propia guardia tiene que prohibir. Además `workers: 1` y
      `fullyParallel: false` son de aquel config por un motivo suyo. **(b)** El
      `globalSetup` siembra contra la API descartable con `BYPASS_AUTH` un
      catálogo publicado con slug conocido y **tres productos elegidos para poder
      distinguir defectos**: uno **sin marca**, uno **sin foto** y uno con
      `available = 0` y `quantity > 0`. **(c)**
      `apps/tienda/pruebas-de-navegador/anchoDeLaTienda.navegador.js`: que el
      `<body>` **no desborde a lo ancho** en catálogo y ficha —los cuatro casos
      que faltan llegan en T1467—. **Y nada más que eso**: qué dice cada estado,
      que la casilla arranque desmarcada o que el botón «Sin stock» sea inerte
      es **test de render**, porque no necesita motor de maquetado y en el
      navegador cuesta cincuenta veces más. La regla de `CONVENCIONES.md` **no se
      relaja por ser una app nueva**. **(d)** El job `Tienda — tests y build` en
      `.github/workflows/ci.yml`, gemelo de `navegador`: Postgres, migraciones,
      API con bypass, `npm run build -w apps/tienda`, `npm test -w apps/tienda` y
      `npx playwright test`. **Aparte y no dentro de `navegador`**, porque ése ya
      es el más lento del CI y agregarle un segundo servidor y un segundo
      recorrido lo pone en el camino crítico de cada push; como job propio corre
      en paralelo y el CI sigue tardando lo que tarda el más lento.
      **Verificación**: `npm --prefix apps/tienda run test:navegador` y los
      **siete** jobs del CI en verde.
      **El test que evita el defecto**: *«el `<body>` del catálogo no desborda a
      lo ancho a 390px»*.
      **Qué se revierte para verlo en rojo**: ponerle un `min-w-[420px]` a la
      grilla. ⚠ **Verificá que se ponga en rojo de verdad**: tres de las once
      primeras pruebas de geometría del repositorio **no** se pusieron en rojo
      con su mutación.

**Checkpoint**: `tienda.favalio.com`… todavía no, pero `npm run dev -w
apps/tienda` a 390px muestra el catálogo de Comprafit con sus productos, precios
y categorías, el séptimo job está en verde y el `<body>` no desborda.

---

## Phase 10: `/c/:slug`, el Caddyfile y el servicio del compose (corte F1.7)

**Purpose**: el enlace pegado en un mensajero muestra el nombre, la descripción y
la portada **del catálogo**, y el catálogo no se indexa. Es el corte que vuelve
utilizable el QR.

- [x] **T1448** En `apps/api/src/routes/catalogoPublico.js`, el **tercer router
      exportado**, `paginas`, montado en `/c` con `limitadorPublico`:
      `app.use('/c', limitadorPublico, require('./routes/catalogoPublico').paginas)`,
      con el comentario que dice **por qué no cuelga de `/api`**: es una página,
      no una API, y por eso ni el limitador global ni `checkSubscription` la ven.
      El handler, en seis pasos (decisión 8):
      1. Resuelve el slug con **el mismo** resolvedor y **las mismas** reglas de
         visibilidad que el resto del router público (FR-117b).
      2. Pide `GET http://tienda/index.html` **por la red interna del compose**,
         **con `timeout`** —lo exige la guardia de llamadas salientes de
         `observabilidad.test.js`— y lo guarda **en memoria con TTL de 60
         segundos**: una visita normal cuesta cero peticiones extra y un deploy
         de la tienda tarda a lo sumo un minuto en verse.
      3. Reemplaza el marcador **`<!--FAVALIO_META-->`** por las cinco etiquetas:
         `og:title`, `og:description`, `og:image`, `og:url` y
         `<meta name="robots" content="noindex, nofollow">`. **Un marcador y no
         una expresión regular sobre `<head>`**, y si el marcador **no está**,
         sirve el HTML **sin** metadatos y lo **registra**, en vez de romper.
      4. Agrega la cabecera `X-Robots-Tag: noindex, nofollow` (FR-116), que cubre
         lo que no es HTML.
      5. Visibilidad: `publicado` → metadatos del catálogo; `borrador` o slug
         inexistente → **404 con el mismo documento y metadatos genéricos,
         indistinguibles entre sí** (FR-055); `pausado` o empresa vencida → 200
         con genéricos —el socio tiene que reconocer que llegó al lugar correcto,
         pero el enlace compartido **no muestra la portada de una tienda que no
         vende**—.
      6. Si el servicio `tienda` **no responde**: **503 con una página propia de
         una línea** y `logger.error`. **No se inventa un HTML sin el `<script>`
         del bundle**: eso sería una página en blanco sin explicación.
      📌 **Por qué la API le pide el HTML al servicio y no lo lee del disco**
      (FR-117c), escrito arriba del handler: `apps/api` y `apps/tienda` son **dos
      imágenes de Docker distintas**, y el `index.html` con su
      `<script src="/assets/index-<hash>.js">` vive dentro de la imagen de la
      tienda, con un hash que **cambia en cada build**. Las tres alternativas
      descartadas: una copia del `index.html` en la API —dos archivos que hay que
      mantener sincronizados, y el que se desincroniza apunta a un bundle que ya
      no existe: **página en blanco, sin error**—; un volumen compartido —acopla
      el ciclo de vida de las dos imágenes y durante la ventana del deploy la API
      lee el build anterior—; y que Caddy inyecte las etiquetas, que FR-117a
      prohíbe.
      Ancla 1: `ROUTERS_SIN_SESION` pasa de **3 a 4** con
      `'routes/catalogoPublico.js paginas'` y su motivo.
      **Verificación**: `npm exec -w apps/api -- jest permisosDeRutas observabilidad` y
      `npm --prefix apps/api run test:integracion -- catalogoPublico`.
      **Los tests que evitan el defecto**: *«un catálogo en borrador devuelve 404
      con los mismos metadatos genéricos que un slug inexistente»*, *«sin el
      marcador, la página sale igual y queda registrado»* y *«con el servicio de
      la tienda caído responde 503 y no un HTML sin bundle»* —con el `fetch`
      espiado—.
      **Qué se revierte para verlo en rojo**: reemplazar el marcador por un
      `replace(/<head>/, …)`; el segundo test deja de ver el registro y la página
      sale con metadatos duplicados.

- [x] **T1449** La infraestructura del sexto servicio. **(a)**
      `docker-compose.produccion.yml`: el servicio **`tienda`** (hoy hay cinco:
      `caddy`, `postgres`, `api`, `web`, `landing`), con `context: .` +
      `dockerfile: apps/tienda/Dockerfile`, alcanzable por la red interna como
      `tienda` —**de eso depende `/c/:slug`**— y **`ALLOWED_ORIGINS` con
      `https://tienda.${DOMINIO}` por interpolación en el compose** y no en un
      `.env` suelto (FR-118). ⚠ La tienda habla contra su **propio origen**, así
      que hoy no hay CORS de por medio; el origen se agrega igual porque es de un
      renglón y **cubre el día que alguien mueva el `handle` o apunte la tienda
      al dominio de la API** — y sin eso el fallo es **silencioso, del lado del
      navegador**. **(b)** `deploy/Caddyfile`: al bloque `tienda.{$DOMINIO}` que
      nació en T1417 se le agregan los **tres `handle` que faltan**:
      `handle /api/publico/* { reverse_proxy api:5000 }` —en el **mismo origen**
      que la tienda—, `handle /c/* { reverse_proxy api:5000 }` —**todo** `/c/*`,
      porque cada URL de la tienda lleva el slug adentro y cada una recibe los
      metadatos de **su** catálogo— y `handle { reverse_proxy tienda:80 }`.
      **Alternativa descartada**: que `/c/:slug` viva bajo
      `/api/publico/pagina/:slug` y Caddy lo reescriba, porque pone la forma de
      la URL pública en **dos archivos** y FR-117a pide que el Caddyfile no haga
      nada más que enrutar. **(c)** El registro `A` de `tienda.favalio.com` a la
      misma IP: es el **paso manual M2**, y sin él nada de esto es alcanzable.
      **Verificación**: `docker compose -f docker-compose.produccion.yml config`
      valida; `docker compose up -d --build tienda` y, desde el contenedor de la
      API, `curl http://tienda/index.html` devuelve el HTML con el marcador. Y
      una guardia barata: `npm exec -w apps/api -- jest observabilidad` con una regla que
      lea `docker-compose.produccion.yml` y exija que `ALLOWED_ORIGINS` nombre
      `tienda.${DOMINIO}` — es una línea que se olvida y **falla en silencio**.
      **El test que evita el defecto**: *«`ALLOWED_ORIGINS` incluye el origen de
      la tienda»*.
      **Qué se revierte para verlo en rojo**: sacar el origen del compose.

- [x] **T1450** [P] `docs/OPERACION.md` gana **«La tienda online del catálogo»**,
      con tres cosas: **(a)** el **número de llamadas por visita, medido** y no
      supuesto (FR-114) —1 al HTML, 1 al catálogo, 0 al buscar o cambiar de
      categoría, 1 por ficha, 1 al mandar el pedido; mirar y no comprar son
      **2**, mirar tres fichas y comprar son **6**—, de dónde sale el tope de
      **120 por minuto por (IP, slug)** y que **hay que recontarlo** si la tienda
      empieza a pedir más; **(b)** qué hacer cuando `/c/:slug` devuelve **503**:
      es el servicio `tienda` caído, el caché de 60 segundos lo tapa
      parcialmente, y se ve en el `logger.error` del handler (riesgo 6); **(c)**
      que `trust proxy` está en `1` (`server.js:49`) y **de eso depende que el
      limitador por IP signifique algo detrás de Caddy** — si alguien mete un
      segundo proxy, todas las peticiones públicas pasan a parecer de la misma IP
      y el limitador por IP+slug **degenera en uno global por slug**: un solo
      visitante podría apagarle el catálogo a todos (riesgo 4).
      **Verificación**: la sección existe y nombra las cuatro llamadas, el 120 y
      el 503. Su verificación real es el paso manual **M3**.

**Checkpoint**: el enlace `https://tienda.favalio.com/c/comprafit-fitnet` pegado
en WhatsApp muestra el nombre, la descripción y la portada del catálogo;
`/robots.txt` existe con `Disallow: /c/`; y un slug en borrador se ve
exactamente igual que uno inventado.

---

## Phase 11: La pantalla Catálogos en el panel (corte F1.8)

**Purpose**: el comercio arma y publica su catálogo **sin `curl`**. Cierra la
etapa 1.

⚠ **El ítem del menú y la `<Route>` van en el mismo commit** (T1452), y
**«Pedidos» no entra acá**: `marcoDePantalla.test.js` exige que toda ruta cuyo
ítem declara `modulo` lleve `RouteGuard` con ese mismo módulo, así que un ítem de
menú sin pantalla pone la guardia en rojo por un motivo que no es el de este
hito. El grupo «Venta online» nace con un solo ítem y gana el segundo en T1469.

- [ ] **T1451** [P] Crear `apps/web/src/utils/catalogos.js` con el **tono del
      badge de estado** —los tres estados y nada más (FR-054)— y lo que la
      pantalla necesite decidir sin dibujar. **Función pura primero**: un test de
      render que verifica una regla es diez veces más lento y se rompe cuando
      alguien mueve un `<div>`. Su test en `apps/web/src/utils/catalogos.test.js`.
      **Verificación**: `npm run test:web -- catalogos`.
      **El test que evita el defecto**: *«un catálogo pausado no se dibuja con el
      mismo tono que uno publicado»*.
      **Qué se revierte para verlo en rojo**: devolver el mismo tono para los
      tres estados.

- [ ] **T1452** Crear `apps/web/src/pages/Catalogos.jsx` con la lista
      (`esCatalogos`, `:720-757`) y el armazón de las cinco pestañas, y
      **cablearla**: **(a)** el ítem en `apps/web/src/components/navegacion.js`,
      grupo nuevo **«Venta online»**:
      `{ to: '/catalogos', label: 'Catálogos', permission: 'catalogo.ver',
      modulo: 'catalogo', alcance: 'empresa' }`. **`alcance: 'empresa'` y no
      sucursal**: un catálogo declara **su** punto de venta adentro, así que
      cambiar la sucursal de arriba no cambiaría nada, y un control que se dibuja
      y no hace nada es lo que el hito 9 corrigió en ocho pantallas. **(b)** La
      `<Route>` en `apps/web/src/App.jsx` con `RouteGuard requiredModule="catalogo"`
      y `MarcoDePantalla`. **(c)** `PageHeader` con el título **exactamente
      «Catálogos»** —`guardiasDeSrc.test.js:677-679` compara el `label` del menú
      contra el `titulo` **por igualdad**— y `anim-subida`. **(d)** Las tres
      listas: `PANTALLA_DE_LA_RUTA` **13 → 14**, `PANTALLAS` **11 → 12** (ancla
      10) y `CON_MARCO` **18 → 19**, agregado **al final** y no en el medio
      (ancla 11): `abrir()` corta el bucle con una excepción y lo que va antes se
      mide igual. `Can` en todas las acciones. Su test en
      `apps/web/src/tests/renderDeCatalogos.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno guardiasDeSrc
      marcoDePantalla renderDeCatalogos` —`guardiasDeDiseno` baja de **seis
      hallazgos a cinco**— y `npm --prefix apps/web run test:navegador --
      marcoDeLasPantallas`.
      **Los tests que evitan el defecto**: *«sin `catalogo.ver` la ruta no se
      dibuja ni el ítem aparece»* y *«el título de la pantalla es el mismo string
      que el label del menú»*.
      **Qué se revierte para verlo en rojo**: poner «Mis catálogos» en el
      `PageHeader`; `guardiasDeSrc` lo nombra.

- [ ] **T1453** Las dos pestañas de formulario dentro de `pages/Catalogos.jsx`:
      **Identidad** (`tabIdentidad`, `:779-840`) con la **previsualización en
      vivo del color** —usando la misma `textoSobre` que la tienda, no un color
      elegido a mano (FR-060)—, `mostrar_precio_lista` **que arranca apagado**
      (FR-061: el default seguro es no publicar el margen), `email_avisos` **con
      el aviso de que, mientras esté vacío, nadie se va a enterar por correo**
      (FR-183a), y el **aviso antes de guardar el cambio de slug** con
      confirmación explícita (FR-068) — el QR está pegado en una pared, el slug
      viejo **muere sin dejar rastro** y el enlace anterior devuelve el mismo 404
      que uno inexistente. Y **Entrega y pago** (`tabEntrega`, `:842-910`), con
      `envio_gratis_desde` **vacío o cero significando «no hay envío gratis»** y
      no «todo gratis», y los datos de transferencia. Además, la **guardia de
      texto** que ata el slug del formulario al del servidor (FR-051), del molde
      de `apps/web/src/tests/mediosDePago.test.js:46`: lee
      `apps/api/src/utils/slugDeCatalogo.js` y compara **la lista de reservados y
      el regex**. Sin `catalogo.editar`, los campos están **deshabilitados con su
      explicación**, no ausentes.
      **Verificación**: `npm run test:web -- renderDeCatalogos slugDeCatalogo`.
      **Los tests que evitan el defecto**: *«cambiar el slug pide confirmación y
      dice que los QR impresos dejan de funcionar»*, *«el formulario normaliza el
      slug igual que el servidor»* —la guardia de texto— y *«sin
      `catalogo.editar` los campos están deshabilitados y dicen por qué»*.
      **Qué se revierte para verlo en rojo**: sacarle un reservado a la lista de
      `apps/web`; la guardia de texto lo nombra.

- [ ] **T1454** Crear `apps/web/src/components/ReglasDePrecio.jsx`
      (`tabReglas`, `:912-976`): la tabla **con sangría por ámbito**, «Gana en N
      de M» por regla, la columna de **pisadas** y la previsualización sobre
      productos reales —los precios y las coberturas salen del servidor, **la
      pantalla no calcula ninguno** (H2)—, con la fila **atenuada y «0 de 0»** de
      la regla cuya marca alguien borró. Encabezado y filas con **el mismo string
      de `grid-template-columns`**, sin `Table*`, sin hex y sin `dark:`. Sus
      casos en `renderDeCatalogos.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno renderDeCatalogos`
      — `guardiasDeDiseno` baja a **cuatro** hallazgos.
      **Los tests que evitan el defecto**: *«encabezado y filas comparten el
      mismo `grid-template-columns`»* y *«una regla huérfana se dibuja atenuada y
      con 0 de 0, y no desaparece»*.
      **Qué se revierte para verlo en rojo**: cambiarle una columna al encabezado
      y no a las filas.

- [ ] **T1455** Crear `apps/web/src/components/ProductosDelCatalogo.jsx`
      (`tabProductos`, `:978-1013`): **selección múltiple con «Publicar» y
      «Quitar»** (FR-066), el contador **«N publicados de M del inventario»**
      (`:985`) que sale de los dos campos de la respuesta, y los avisos
      `SIN_PRECIO` y **«foto externa, no se publica»** (FR-030, H6). **Quitar
      borra la fila** y la pantalla lo dice; no hay una tercera bandera que
      apagar. Sus casos en `renderDeCatalogos.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno renderDeCatalogos`
      — baja a **tres** hallazgos.
      **Los tests que evitan el defecto**: *«seleccionar diez y apretar
      “Publicar” hace UNA llamada en lote y no diez»* y *«un producto con foto
      externa lo dice, y no se dibuja como publicable sin más»*.
      **Qué se revierte para verlo en rojo**: mandar una llamada por producto; el
      primer test cuenta las llamadas.

- [ ] **T1456** Crear `apps/web/src/components/QrDelCatalogo.jsx` (`tabQr`,
      `:1015-1070`): la dirección completa, el botón de copiar, la vista previa
      del QR y **tres descargas: PNG, SVG y cartel A4**. El QR se genera **en el
      navegador** con `qrcode`, que **ya está instalado** (`package.json:31`,
      molde en `printInvoice.js:1,48-75`): cero dependencias nuevas y cero
      endpoint. El **cartel A4** se arma como una hoja maquetada en HTML con
      `window.print()` —componer un PDF en el servidor es un proyecto propio— y
      lleva el nombre del comercio y la leyenda «escaneá con la cámara»
      (`:1042`): **imprimir el QR solo, sin decir de qué es, es un cartel que
      nadie escanea**. Y con el catálogo **en borrador**, el QR está y **dice que
      todavía no lleva a ningún lado** — un QR impreso de un catálogo sin
      publicar es un cartel que manda a un 404. La URL lleva el parámetro de
      origen `?f=qr`. Sus casos en `renderDeCatalogos.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno renderDeCatalogos`
      — baja a **dos** hallazgos, que son las dos pantallas de la etapa 2.
      **Los tests que evitan el defecto**: *«con el catálogo en borrador el QR
      avisa que no lleva a ningún lado»* y *«la URL del QR lleva el parámetro de
      origen»*.
      **Qué se revierte para verlo en rojo**: sacar el aviso del borrador.
      📌 **La pestaña de métricas del QR —visitas, pedidos y conversión— no entra
      acá**: necesita **pedidos** para calcular la conversión y llega en T1474.
      Sin partirlo, la etapa 1 terminaría con una pestaña que muestra tres ceros
      inventados.

**Checkpoint**: desde `/catalogos` se crea, se le carga la identidad, las reglas
y los productos, se publica, y el QR descargado abre el catálogo real en un
teléfono. `guardiasDeSrc` en verde, el marco mide `/catalogos`, y
`guardiasDeDiseno` queda con dos hallazgos «no existe», que son los de la etapa 2.

---

## Phase 12: `pedidos`, `pedido_items` y `packages/pedido` (corte F2.1)

**Purpose**: la base y las funciones puras del pedido, **sin un solo endpoint que
escriba**. Es lo que permite que T1463 sea una tarea sobre la transacción y no
sobre cinco cosas a la vez.

- [ ] **T1457** Crear `apps/api/src/migrations/20260818-pedidos.js` con
      `pedidos` y `pedido_items`, y los modelos `Pedido.js` y `PedidoItem.js`
      exportados desde `models/index.js` (FR-212). Lo que no se puede escribir de
      otra manera:
      **(a)** `pedidos.id` es **UUID** y **no viaja en ninguna respuesta
      pública** (FR-152). `empresa_id` sale **del resolvedor de slug, nunca del
      cuerpo** (FR-150). `catalogo_id` con **`ON DELETE RESTRICT`**, que es lo
      que hace que borrar un catálogo con pedidos se rechace (FR-069).
      **(b)** `medio_pago` ENUM **sin `mp`**: la pasarela es etapa 3, y **un
      valor que nadie puede producir es un valor que nadie probó**.
      **(c)** `origen` ENUM con **un solo valor**, `catalogo`, más el índice
      `idx_pedido_origen (empresa_id, origen, created_at DESC)`. Parece
      decoración y no lo es: agregarla después significa una **migración con
      backfill sobre pedidos reales** y una columna que la bandeja no sabía
      dibujar; y el índice se crea **ahora**, con la tabla vacía, porque
      `CREATE INDEX` sobre una tabla con pedidos bloquea escrituras y
      `CONCURRENTLY` no corre dentro de la transacción de una migración de
      sequelize-cli.
      **(d)** `comprador_dni`, `acepta_comunicaciones`, `consentimiento_en` y
      `consentimiento_texto` **se crean y quedan sin escribirse** hasta que se
      abra la puerta de FR-147a. `sale_id` se crea **siempre `NULL`**, y es la
      excepción con motivo: la etapa 3 la va a llenar sobre pedidos **que ya
      existen**, y crearla ahora evita una migración con backfill sobre datos
      reales. `mp_preference_id`, `mp_payment_id` y `mp_estado` **no se crean**.
      **(e)** `pedido_items` **sin `empresa_id`** —la tabla solo se alcanza a
      través de su padre, que sí está scopeado— y con `product_id` en **`SET
      NULL` y no `CASCADE`**: borrar un producto **no puede** borrar la línea de
      un pedido histórico, que sigue existiendo con su nombre y su precio
      congelados, que es exactamente para lo que están congelados.
      **(f)** Los índices: `uq_pedido_numero (empresa_id, numero)` UNIQUE —**la
      red** de FR-137a, no el mecanismo—, `uq_pedido_idempotencia` global
      —molde `uq_tn_pedido`—, `idx_pedido_bandeja`, `idx_pedido_catalogo` e
      `idx_pedido_customer`.
      **(g)** **Una sola asociación**: `Pedido.hasMany(PedidoItem, { as: 'items',
      onDelete: 'CASCADE' })` y su `belongsTo`. Las otras cuatro tablas del hito
      van **sin asociaciones**, con el comentario del molde de
      `models/index.js:39-48` — sin ese comentario, la próxima persona declara
      `Catalogo.hasMany(CatalogoReglaPrecio)` «para poder usar `include`», el
      ancla se pone en rojo y el arreglo barato es cambiar el 3 por un 4 sin
      entender qué se estaba protegiendo.
      **(h)** El `down` **borra pedidos reales**. Se escribe igual —una migración
      sin `down` falla el día del rollback con un error que no la nombra
      (`reversibilidadDeMigraciones.test.js:83-89`)— pero **con la advertencia en
      el encabezado y en el mensaje**: es el único `down` de este hito que
      destruye datos de un cliente.
      **(i)** La semilla de `verificar-reversibilidad.js` gana **un pedido con
      dos líneas, una apuntando a un producto que después se borra**, para que el
      `SET NULL` se vea.
      Ancla 7: `aislamientoEmpresas.test.js:1136` **sigue en `toBe(3)`** y hay
      que **verificarlo sin tocar el número** — `pedido_items` no lleva
      `empresa_id`, igual que `sale_items`, así que la bandeja puede traer el
      detalle con `include` sin mover el ancla.
      **Verificación**: `verificar:esquema`,
      `node apps/api/scripts/verificar-reversibilidad.js --desde 20260814`, y
      `npm exec -w apps/api -- jest aislamientoEmpresas reversibilidadDeMigraciones` con
      el `toBe(3)` **intacto**.
      **El test que evita el defecto**: *«borrar un producto no borra la línea
      del pedido: el nombre y el precio congelados siguen ahí»* (US16 escenario
      11).
      **Qué se revierte para verlo en rojo**: poner `CASCADE` en
      `pedido_items.product_id`.

- [ ] **T1458** [P] Crear **`packages/pedido`** —el segundo paquete compartido—
      con `normalizarTelefono` y `armarTextoPedido`, **las dos puras**, mudadas
      de `apps/web/src/utils/pedidoWhatsapp.js:32-76` y `:88-138`, con sus tests.
      `apps/api` y `apps/tienda` lo declaran en `dependencies`; `apps/web` cambia
      el import.
      📌 **Por qué existe** (hallazgo 4 del plan, FR-006c): FR-144 y FR-184
      pedían reusar un archivo de `apps/web/src`, y **ninguna de las dos apps que
      lo necesitan puede importar de ahí** —son paquetes de npm distintos,
      ninguno declara al otro, y la única vía sería un `../../web/src/utils/…`
      que además rompe la imagen de Docker de la API—. Las tres salidas
      descartadas: **copiarla** (es el defecto de `mediosDePago.js` que la
      decisión 1 vino a cerrar), **que el enlace lo arme la tienda** (obligaría a
      mandarle el detalle otra vez y a formatear importes **por tercera vez**) y
      no reusar nada.
      📌 **Por qué acá y no en F0.1** (FR-006d): el corte de workspaces toca las
      cuatro apps a la vez y es el más peligroso del hito; sumarle un segundo
      paquete que la etapa 0 **no usa** lo engorda sin ganar nada.
      **`enviarPedidoPorWhatsapp` (`:148-159`) NO se muda**: toca `window`, así
      que no es pura y no puede correr en el servidor. Se queda en `apps/web`, y
      `apps/tienda` escribe la suya de tres líneas en T1472. La guardia de
      `paqueteDePrecios.test.js` gana su bloque gemelo: **no existe copia** de
      `normalizarTelefono` ni de `armarTextoPedido` en `apps/api/src`,
      `apps/web/src` ni `apps/tienda/src`, con su ancla dentro de
      `packages/pedido/index.js`.
      **Verificación**: `npm test -w packages/pedido`, `npm run test:web` y
      `npm exec -w apps/api -- jest paqueteDePrecios`. Los tests de teléfono que ya
      existían pasan **sin tocar ninguna aserción**.
      **Los tests que evitan el defecto**: los casos del formato argentino que ya
      estaban, y *«la normalización del teléfono no está escrita dos veces»*.
      **Qué se revierte para verlo en rojo**: pegar una copia de
      `normalizarTelefono` en `apps/api/src/utils/`.

- [ ] **T1459** [P] Crear `apps/api/src/utils/totalDePedido.js`: subtotal de las
      líneas, envío según la configuración del catálogo, y **gratis con
      `subtotal >= umbral`** (FR-143). Su test en
      `apps/api/src/tests/totalDePedido.test.js`, y **el borde se prueba en el
      borde**: un subtotal **exactamente igual** al umbral. Umbral vacío o cero
      significa **«no hay envío gratis»**, no «todo gratis».
      **Verificación**: `npm exec -w apps/api -- jest totalDePedido`.
      **Los tests que evitan el defecto**: *«con el subtotal exactamente igual al
      umbral el envío es gratis»* y *«umbral en cero no regala el envío»*.
      **Qué se revierte para verlo en rojo**: cambiar el `>=` por `>`; el primero
      falla y es el único caso que lo distingue.

- [ ] **T1460** [P] Crear `apps/api/src/utils/estadoDePedido.js` con las
      transiciones permitidas entre los **seis** estados (FR-161) y `cancelado`
      **terminal** (FR-163), función pura (FR-162). Su test en
      `apps/api/src/tests/estadoDePedido.test.js`.
      **Verificación**: `npm exec -w apps/api -- jest estadoDePedido`.
      **Los tests que evitan el defecto**: *«de `cancelado` no se sale a ningún
      lado»* y *«`pagado → pagado` no está permitida»* — es lo que hace que
      marcar cobrado dos veces sea **idempotente por construcción**, sin una
      clave de idempotencia (FR-169).
      **Qué se revierte para verlo en rojo**: permitir `pagado → pagado`; el
      segundo test y, más tarde, el de concurrencia de T1468.

- [ ] **T1461** Cerrar lo que T1432 dejó anotado: `DELETE /api/catalogos/:id`
      responde **409 `TIENE_PEDIDOS`** cuando los tiene, **ofreciendo pausarlo**
      (FR-069). La garantía la da el motor —`pedidos.catalogo_id` es `ON DELETE
      RESTRICT`— y **el mensaje legible lo da el handler**: el error de Sequelize
      nombraría la restricción. Un catálogo **sin** pedidos sí se borra, en
      cascada sobre `catalogo_productos`, `catalogo_reglas_precio` y
      `catalogo_visitas`.
      **Verificación**: `npm --prefix apps/api run test:integracion -- catalogos`.
      **El test que evita el defecto**: *«borrar un catálogo con un pedido
      responde 409, ofrece pausar, y el catálogo y el pedido siguen ahí»*
      —afirmando las dos filas después del 409—.
      **Qué se revierte para verlo en rojo**: sacar el `count` previo; el
      handler devuelve el 500 de la restricción con su nombre adentro.

**Checkpoint**: la migración corre y vuelve sobre una base con un pedido de dos
líneas, `npm test -w packages/pedido` normaliza un teléfono argentino, y el total
con el umbral **justo en el borde** da envío gratis. **Todavía no hay forma de
crear un pedido.**

---

## Phase 13: `POST /api/publico/c/:slug/pedidos` (corte F2.2)

**Purpose**: el único endpoint público que escribe. Al terminar, un visitante sin
sesión crea un pedido con **el precio que pone el servidor**, dos requests en
paralelo crean **uno solo**, y un `product_id` de otra empresa **no deja ninguna
fila**.

- [ ] **T1462** [P] Crear `apps/api/src/utils/pedidoPublico.js` con
      `consolidarLineas(items)` y `validarComprador(comprador, catalogo)`, las
      dos puras, e importando `esImagenPropia` de `utils/imagenes.js`.
      `consolidarLineas` **suma el mismo `product_id` repetido** (FR-135),
      rechaza cantidad `≤ 0`, no entera o mayor que 999, y —esto es lo que
      importa— **devuelve `[{ product_id, cantidad }]` y nada más**: cualquier
      `precio`, `precio_unitario`, `subtotal` o `total` que venga en el cuerpo
      **se descarta acá**, así que el resto del handler **no tiene desde dónde
      leerlos** (FR-130). **No es una validación que se pueda olvidar: no hay
      dato que olvidar.** `validarComprador` exige **nombre y teléfono** y nada
      más de los datos del comprador (FR-149), pide dirección, localidad y CP
      **solo con `entrega = 'envio'`**, y **descarta `dni` y
      `acepta_comunicaciones` aunque vengan** mientras la puerta de FR-147a esté
      cerrada. Su test en `apps/api/src/tests/pedidoPublico.test.js`.
      **Verificación**: `npm exec -w apps/api -- jest pedidoPublico`.
      **Los tests que evitan el defecto**: *«el mismo producto dos veces es una
      línea con la suma»*, *«un `precio` en el cuerpo no sobrevive a
      `consolidarLineas`»* —afirmado sobre las claves del objeto devuelto— y
      *«el DNI se descarta aunque venga, y el pedido sigue siendo válido»*.
      **Qué se revierte para verlo en rojo**: devolver el item entero en vez del
      literal de dos claves; el segundo test encuentra la clave `precio`.

- [ ] **T1463** El handler `POST /api/publico/c/:slug/pedidos` en
      `routes/catalogoPublico.js`, con el molde de `routes/sales.js:311-630` y
      **los doce pasos en el orden que no es negociable** (decisión 7):
      1. `contextoPublico` ya resolvió `{empresaId, catalogoId, puntoDeVentaId}`,
         la suscripción y el estado. **Borrador → 404; pausado o empresa vencida
         → 409 `CATALOGO_NO_DISPONIBLE`.**
      2. Normalizar con `consolidarLineas` y `validarComprador`.
      3. `t = await sequelize.transaction()`.
      4. Idempotencia, **camino rápido**: `Pedido.findOne({ where:
         scoped({ idempotency_key }, empresaId), transaction: t })`.
      5. **Validar TODOS los productos antes de crear nada**, en un bucle
         explícito **dentro del handler**: `findScoped(Product, linea.product_id,
         req.publico.empresaId, { transaction: t })` + la fila de
         `catalogo_productos` + `is_active` + `publicable` + precio resoluble.
         Cualquiera que falle **rechaza el pedido entero** y no deja ninguna fila
         (FR-132); uno de otra empresa **no resuelve** y da 404 sin decir si
         existía.
      6. Resolver el precio con `calcularPrecios` de `@favalio/precios` —los
         ajustes de la empresa leídos **una vez**, con la mezcla de
         `empresa.settings` y la tabla `settings` que ya hace
         `routes/general.js:527-546`— y después `resolverPrecios` con las reglas
         activas, leídas **una vez**. Se congelan `precio_unitario`,
         `precio_lista`, `regla_id` y `nombre` (FR-131).
      7. **Revalidar stock** leyendo `available` del punto de venta **del
         catálogo**, **sin `lock`**: `available <= 0` → se quita;
         `available < cantidad` → **se recorta a lo que hay**; sin fila → agotado
         y no es un error; negativo → cero **y se registra**.
      8. Si quedaron **cero** líneas: `rollback`, **ningún pedido** (FR-139), y
         409 `SIN_LINEAS_DISPONIBLES`.
      9. Total con `totalDePedido`.
      10. `Customer` buscado por teléfono normalizado (`packages/pedido`),
          **`scoped` a la empresa del resolvedor y nunca a una del cuerpo**
          (FR-150).
      11. **Número y `Pedido.create`, en esta transacción**:
          `SELECT pg_advisory_xact_lock(947214, :empresaId)` y
          `SELECT COALESCE(MAX(numero), 0) + 1 …`. Se eligió el **advisory lock
          de transacción** porque se libera solo al commit o al rollback —no hay
          forma de olvidarse de soltarlo— y **no toca ninguna fila de negocio**;
          la técnica ya está en `apps/api/scripts/migrar.js:41` con
          `LOCK_ID = 947213`, y acá es el **947214**, el siguiente, para que los
          dos números se busquen juntos el día que alguien se pregunte de dónde
          salieron. Descartadas: `FOR UPDATE` sobre `empresas` —ata la numeración
          a una fila que no tiene nada que ver—, una secuencia por empresa
          —exige DDL en tiempo de ejecución y deja huecos— y `MAX + 1` sin
          candado, que es lo que uno escribe primero y hace que el segundo
          comprador vea un error **después** de apretar «Confirmar».
      12. `commit`, y **después** los avisos (T1471), fuera de la transacción.
      **Los dos apartamientos del molde de `sales.js`, escritos en el archivo**:
      **sin `lock`** en la lectura de stock —`sales.js:518-526` lo toma porque va
      a descontar; acá **no se descuenta nada** (FR-140), así que el lock solo
      haría esperar a dos compradores por una fila que ninguno va a modificar, y
      **la consecuencia se dice en voz alta**: dos personas piden la última
      unidad al mismo tiempo y **los dos pedidos se crean** (US14 escenario 8), y
      el comercio lo resuelve por WhatsApp—; y **el total no se compara contra un
      declarado**, porque el cliente **no manda ninguno** —el paso 2 lo tira— y
      una comparación con un campo opcional sería una puerta para fijar el precio
      desde afuera.
      **La idempotencia se sostiene en el `UNIQUE`, no en el `findOne` del paso
      4**: en el `catch`, un `SequelizeUniqueConstraintError` se relee con un
      `findOne` scopeado —el que ganó ya commiteó, porque Postgres hizo esperar
      al perdedor en el índice— y se devuelve **el mismo cuerpo**. Molde:
      `sales.js:599-624`. El `UNIQUE (empresa_id, numero)` es **la red**: ante
      colisión se reintenta **una vez** y, si vuelve a chocar, sale por `fallo()`.
      La respuesta 201 se arma con `vistaPublica.pedidoPublico` y **no lleva
      ningún id** (FR-152). El 409 `STOCK_INSUFICIENTE` lleva `lineas` con
      `accion: 'recortada' | 'quitada'` y **`reintentar_con`**, que es el cuerpo
      exacto que la tienda vuelve a mandar: sin él, la tienda tendría que
      reconstruirlo restando por su cuenta —el cliente recalculando— y se
      equivocaría justo en el caso que importa.
      Ancla 8: `aislamientoEmpresas.test.js:993` **sigue en `[]`**, y por eso **el
      `Pedido.create` se queda en `routes/catalogoPublico.js` y no se muda a un
      servicio**: el detector de «padre ajeno» da por validado el `create` cuando
      encuentra un `findScoped` **antes, en el mismo handler**, y mover el create
      parte el ámbito y lo deja sin validar a los ojos de la guardia. Es una
      **restricción de arquitectura**, no de estilo, igual que el
      `SupplierMovement.create` de `suppliers.js:1015-1039`.
      Crear `apps/api/src/tests/integracion/pedidoPublico.integracion.test.js`.
      **La fixture tiene que poder distinguir el defecto**: importes que dejan
      **centavos**, un producto con `available = 0` y `quantity > 0`, un subtotal
      **exactamente igual** al umbral de envío gratis, y **dos catálogos en la
      empresa A**, para que «el pedido cayó en el catálogo equivocado» sea
      detectable.
      **Verificación**: `npm exec -w apps/api -- jest aislamientoEmpresas
      proyeccionPublica` y `npm --prefix apps/api run test:integracion --
      pedidoPublico`.
      **Los tests que evitan el defecto**: *«el mismo pedido mandado dos veces EN
      PARALELO crea uno solo»* —con dos promesas, que es la mitad que un test
      secuencial no toca nunca—, *«dos pedidos simultáneos de la misma empresa no
      comparten número»*, *«un `product_id` de otra empresa no deja ninguna
      fila»* —contando `Pedido.count()` y `PedidoItem.count()` antes y después—,
      *«un precio en el cuerpo se descarta y el pedido queda con el del
      servidor»*, *«si todas las líneas se agotaron no se crea ningún pedido»* y
      *«el pedido no tocó `stock` ni `stock_movements`»*.
      **Qué se revierte para verlo en rojo**: sacar el `pg_advisory_xact_lock`;
      el test de los dos pedidos simultáneos los deja con el mismo número o con
      un choque contra el `UNIQUE`. Y por separado: sacar el `catch` del
      `SequelizeUniqueConstraintError`, que deja el test en paralelo con dos
      pedidos.

**Checkpoint**: por `curl`, dos `POST` idénticos con la misma `idempotency_key`
devuelven el mismo número y hay **un** pedido en la base; uno con un
`product_id` de la empresa B devuelve 404 y la tabla quedó como estaba.

---

## Phase 14: Carrito, checkout y confirmación en la tienda (corte F2.3)

**Purpose**: el socio arma el pedido y lo manda desde el teléfono. Cierra el
recorrido completo de la tienda.

- [ ] **T1464** La pantalla **Carrito** (`esCarrito`, `:199-255`): líneas con
      cantidad editable, subtotal, el envío según lo que devolvió el catálogo y
      el total. **La tienda no calcula precios** (H2): los formatea. El estado
      `CarritoVacio` ya existe de T1446. Su test de render.
      **Verificación**: `npm test -w apps/tienda -- renderDelCarrito`.
      **El test que evita el defecto**: *«el total del carrito es el que devuelve
      el servidor, no una suma del navegador»* — afirmado sobre un caso donde la
      suma ingenua daría otro número (una regla de precio fijo).
      **Qué se revierte para verlo en rojo**: sumar las líneas en el navegador.

- [ ] **T1465** El **checkout de tres pasos** con su barra de progreso
      (`esCheckout`/`esDatos`/`esEntrega`/`esPago`, `:257-389`). Lo que no es
      dibujo:
      **(a)** Las opciones de entrega y de pago son **solo las que el catálogo
      tiene encendidas** (FR-141), y **«efectivo al retirar» no se ofrece con
      envío a domicilio** (FR-142, `:904`).
      **(b)** **La puerta de FR-147a**: mientras los Términos y la Política de
      Privacidad de Favalio no existan, el checkout **no pide el DNI ni ofrece la
      casilla de marketing**. No se dibujan — no es que estén deshabilitados. Y
      cuando la puerta se abra, la casilla arranca **desmarcada** y **no es
      condición para comprar** (FR-145).
      **(c)** Debajo del N° de socio, el texto **exacto** de la decisión 3: **«Nos
      ayuda a identificarte cuando retirás el pedido.»** El de la maqueta
      (`:295`) **no se copia**: el precio es del catálogo y el número no cambia
      un peso.
      **(d)** El checkout de transferencia **no dice que el pedido queda
      reservado 24 horas** (`:375`, `:1325`) y dice en su lugar: **«Después de
      transferir, mandanos el comprobante por WhatsApp.»** (FR-168). **Ninguna
      pantalla nombra un plazo**: ningún pedido vence solo (FR-168a).
      Los obligatorios son **nombre y teléfono**, más entrega y medio de pago,
      que son los pasos 2 y 3 y **no se pueden saltear** (FR-149b). Sus tests de
      render.
      **Verificación**: `npm test -w apps/tienda -- renderDelCheckout`.
      **Los tests que evitan el defecto**: *«con la puerta cerrada NO se dibujan
      el DNI ni la casilla de marketing»*, *«“efectivo al retirar” no aparece con
      envío a domicilio»*, *«ninguna pantalla dice que el pedido queda
      reservado»* —buscando «reserv» y «24 h» en el texto renderizado— y *«el
      renglón del N° de socio dice el texto de la decisión 3 y no el de la
      maqueta»*.
      **Qué se revierte para verlo en rojo**: dibujar el campo de DNI cuando
      `formulario.pide_dni` viene en `true`; el primer test lo encuentra —y **el
      servidor lo ignora igual**, que es la otra mitad de la puerta—.

- [ ] **T1466** La **confirmación** (`esConfirmado`, `:391-429`) y los **dos
      estados que faltan**. La confirmación muestra `#1042` —el numeral es de
      presentación y **no se guarda**, y el formato es **el mismo en las seis
      superficies** (FR-137b)—, el resumen con los precios congelados, el enlace
      de WhatsApp que **ya vino armado del servidor**, y **no promete ningún
      email** cuando `email_enviado` es `false` o cuando el comprador no dejó
      email (FR-149a, FR-182, H8). Los dos estados: **`PagoRechazado`** y
      **`SeAgoto`** (`:586-624`), este último con las líneas **tachadas** —no
      desaparecidas— arriba del total nuevo, y el botón «Seguir con el resto» que
      **manda `reintentar_con` tal cual vino**, sin reconstruirlo. Sus tests de
      render.
      **Verificación**: `npm test -w apps/tienda -- renderDeLaConfirmacion
      estados`.
      **Los tests que evitan el defecto**: *«sin email del comprador la pantalla
      NO dice que mandamos el detalle por email»*, *«la línea recortada se dibuja
      tachada con la cantidad pedida al lado de la nueva»* y *«“Seguir con el
      resto” manda exactamente `reintentar_con`»*.
      **Qué se revierte para verlo en rojo**: dibujar la frase del email siempre;
      el primer test la encuentra.

- [ ] **T1467** [P] `apps/tienda/pruebas-de-navegador/anchoDeLaTienda.navegador.js`
      gana los **cuatro casos que faltan**: que el `<body>` **no desborde a lo
      ancho** a 390px en **carrito** y en **los tres pasos del checkout**
      (FR-121, criterio 17). **Y nada más**: es lo único que necesita motor de
      maquetado —jsdom devuelve **cero** en `scrollWidth`, `clientWidth` y
      `getBoundingClientRect`, así que un test de render que los mire pasa con y
      sin el cambio—.
      **Verificación**: `npm --prefix apps/tienda run test:navegador`.
      **El test que evita el defecto**: *«el `<body>` del paso de entrega no
      desborda a lo ancho a 390px»* — es el paso con los campos de dirección, que
      es donde una etiqueta larga rompe primero.
      **Qué se revierte para verlo en rojo**: sacarle el `min-w-0` al campo de
      dirección. ⚠ Comprobá que se ponga en rojo **de verdad**: una prueba de
      geometría puede pasar por razones que no tienen nada que ver con lo que
      dice verificar.

**Checkpoint**: desde un teléfono a 390px se arma un carrito, se completa el
checkout de tres pasos, entra el pedido, y la pantalla de confirmación muestra
`#1` con el enlace de WhatsApp — y **no promete ningún email** si no se dejó uno.

---

## Phase 15: La bandeja de pedidos en el panel (corte F2.4)

**Purpose**: el pedido cae en una bandeja y se opera desde ahí — **y la pantalla
dice exactamente lo que hace, que en esta etapa es menos** de lo que la maqueta
promete.

- [ ] **T1468** Crear `apps/api/src/routes/pedidos.js` con los tres endpoints:
      `GET /` (la bandeja, `?estado=`, `?catalogo_id=`, `?origen=`, `?pagina=`),
      `GET /:id` (el detalle con sus líneas y **los precios congelados**, no los
      actuales del catálogo, FR-171) y `PATCH /:id/estado`, **el único que
      escribe**. Montaje en `server.js` con `...authEmpresa,
      requireModulo('catalogo')`. Cuatro cosas que no son obvias:
      **(a)** `por_estado` **viene siempre**, con o sin filtro, y se calcula con
      **un `GROUP BY` en la misma consulta**, no con siete `COUNT`.
      **(b)** El estado vacío **distingue dos casos** (FR-172): `total: 0` **sin**
      filtros es «todavía no entró ninguno»; `total: 0` **con** filtros es «el
      filtro no devolvió nada». Son dos textos distintos y la respuesta trae con
      qué elegirlos.
      **(c)** Las transiciones se validan **contra el estado real de la base**,
      no contra el que tenía cargado la pantalla: dos pestañas cambiando el mismo
      pedido no lo dejan en un estado imposible. `cancelado` es terminal y un
      intento devuelve **409 `TRANSICION_NO_PERMITIDA` nombrando el estado
      actual**.
      **(d)** **`POST /api/pedidos/:id/cobrado` NO existe.** No hay un endpoint
      aparte para «cobrar» porque cobrar, en estas etapas, **es cambiar un
      estado**; crear un endpoint con ese nombre sería prometer en la API lo
      mismo que la maqueta promete en la pantalla, y es falso.
      Un pedido de otra empresa: **404 en los dos, y nada cambia** (FR-170), con
      `findScoped(Pedido, id, req.empresaId)`. Ancla 2: la lista de `routes/`
      pasa de **21 a 22**, con sus filas en `permisosDeRutas.test.js`
      (`pedidos.ver` en los dos primeros, `pedidos.gestionar` en el `PATCH`).
      Crear `apps/api/src/tests/integracion/bandejaDePedidos.integracion.test.js`.
      **Verificación**: `npm exec -w apps/api -- jest permisosDeRutas montajeDeRouters` y
      `npm --prefix apps/api run test:integracion -- bandejaDePedidos`.
      **Los tests que evitan el defecto**: —el que sostiene el corte—
      ***«“Marcar cobrado” dejó `stock`, `stock_movements`, `sales`, `sale_items`
      y la caja COMO ESTABAN»*** (FR-164, FR-165), afirmando **lo que no pasó**,
      que es la mitad que se olvida, mirando las **cinco** tablas antes y
      después; *«marcar cobrado dos veces en paralelo da el mismo resultado que
      una»* (FR-169); *«un pedido de otra empresa responde 404 y su estado no
      cambió»*; y *«`por_estado` sale de una sola consulta»*, con
      `capturarConsultas`.
      **Qué se revierte para verlo en rojo**: hacer que el `PATCH` a `pagado`
      descuente stock —una línea—; el primer test lo ve en `stock_movements`.

- [ ] **T1469** Crear `apps/web/src/pages/Pedidos.jsx` y cablearla: el segundo
      ítem del grupo «Venta online» en `navegacion.js`
      (`{ to: '/pedidos', label: 'Pedidos', permission: 'pedidos.ver', modulo:
      'catalogo', alcance: 'empresa' }` — **`modulo: 'catalogo'`**, que es el que
      libera la funcionalidad entera), la `<Route>` con `RouteGuard
      requiredModule="catalogo"`, y el `PageHeader` con el título **exactamente
      «Pedidos»**. La tabla (`esPedidos`, `:1073-1110`) con `TablaGrid` y **el
      mismo string de `grid-template-columns`** en encabezado y filas, los
      filtros por estado con su número, el filtro «Catálogo: todos» (`:1085`) y
      **la columna «Canal»** (FR-160a) — que hoy dice siempre `catalogo` y **no
      es decoración**: es lo que hace que el día que entre un segundo canal no
      haya que migrar datos ni enseñarle una columna nueva a una pantalla que ya
      está en producción. Y **el aviso permanente** con el texto exacto de la
      decisión 4: **«Marcar un pedido como cobrado cambia su estado. Por ahora no
      descuenta stock ni registra la venta: eso se hace a mano desde el punto de
      venta.»** — **sin botón de cerrar, sin preferencia de ocultamiento, y se
      muestra en cada visita** (FR-167a): un aviso que se cierra es un aviso que
      se cierra el primer día. La descripción de la maqueta (`:1080`) **no se
      copia**. Anclas 10 y 11: `PANTALLA_DE_LA_RUTA` **14 → 15**, `PANTALLAS`
      **12 → 13**, `CON_MARCO` **19 → 20**, al final de la lista. Su test en
      `apps/web/src/tests/renderDePedidos.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno guardiasDeSrc
      marcoDePantalla renderDePedidos` —`guardiasDeDiseno` baja a **un**
      hallazgo— y `npm --prefix apps/web run test:navegador -- marcoDeLasPantallas`
      con las **veinte** rutas.
      **Los tests que evitan el defecto**: ***«el aviso de la bandeja NO tiene
      botón de cerrar»***, *«la bandeja sin pedidos dice algo distinto que la
      bandeja filtrada sin resultados»* y *«la columna Canal se dibuja aunque
      todos los pedidos digan lo mismo»*.
      **Qué se revierte para verlo en rojo**: agregarle una `×` al aviso; el
      primer test la encuentra por rol.
      📌 **Los pedidos de TiendaNube no entran acá**, y el motivo va escrito en
      el archivo: `tiendanube_pedidos` **no es una bandeja**, es el **libro de
      idempotencia del webhook de stock** —filas inmutables, que no se borran
      nunca, sin comprador, total, estado, entrega ni medio de pago—. Unificar
      exige primero el pendiente 12c de `PROXIMOS-PROYECTOS.md`. **Dos pantallas
      honestas antes que una que promete una bandeja y entrega una lista.**

- [ ] **T1470** Crear `apps/web/src/components/PanelDePedido.jsx`: el panel
      lateral de **520px con `max-w-[92vw]`** sobre `ui/sheet` (`hayPedido`,
      `:1117-1172`), con el detalle, los precios **congelados**, los datos del
      comprador y las acciones de estado. Sin `pedidos.gestionar`, los botones
      están **deshabilitados con su explicación, no ausentes** (US16 escenario
      9). La confirmación de «Marcar cobrado» (`hayConfirmacion`, `:1174-1185`)
      lleva el texto **exacto** de la decisión 4: **«Marcar cobrado el pedido
      #1042 solo cambia su estado. El stock no baja y no se registra ninguna
      venta: si ya lo entregaste, cargalo en el punto de venta.»** — el de la
      maqueta (`:1178`) **afirma lo contrario y no se copia**. Sus casos en
      `renderDePedidos.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno renderDePedidos` —
      `guardiasDeDiseno` llega a **cero** hallazgos y `npm run test:web` **vuelve
      a verde por primera vez desde T1423**.
      **Los tests que evitan el defecto**: *«la confirmación dice que el stock no
      baja»* —buscando la frase, no un `confirm()` genérico—, *«sin
      `pedidos.gestionar` los botones están deshabilitados y dicen por qué»* y
      *«el detalle muestra el precio congelado del pedido y no el actual del
      catálogo»*.
      **Qué se revierte para verlo en rojo**: usar el texto de la maqueta en la
      confirmación; el primer test busca «no baja» y lo encuentra al revés.

**Checkpoint**: entra un pedido desde la tienda, aparece en `/pedidos` con su
canal y su estado, se abre el panel lateral, se marca cobrado, y un test de
integración afirma que **las cinco tablas quedaron como estaban**.
`npm run test:web` está en verde.

---

## Phase 16: Los avisos (corte F2.5)

**Purpose**: el comercio se entera del pedido sin estar mirando la pantalla, y el
comprador recibe su detalle — **y cuando el correo no sale, nadie promete que
salió**.

- [ ] **T1471** Las **dos plantillas de Resend** y el envío, con
      `services/email.js` y `plantillaBase` (`:160`, FR-180): **(a)** el aviso de
      pedido nuevo **al comercio**, a la casilla **`email_avisos` del catálogo** y
      a ninguna otra (FR-183) — **no** a todos los usuarios con `pedidos.ver`, y
      **no** al email de la empresa; un catálogo **sin** casilla cargada **no
      impide que entre el pedido** (FR-183a). **(b)** El **email de confirmación
      al comprador** cuando dejó email (FR-183b), con número, detalle línea por
      línea con los **precios congelados**, total, entrega y pago. Los dos se
      mandan **después del commit**, **`await`eados dentro de su propio `try`**:
      el pedido ya existe y un fallo del correo no lo toca (FR-181), pero **la
      respuesta lleva `email_enviado: boolean`** porque es lo que le permite a la
      pantalla **no** prometer un email que no salió (FR-182, H8). **Un `fire and
      forget` haría imposible ese requisito**: la respuesta saldría antes de
      saber. `email_enviado` es `false` cuando `sendEmail` devolvió `ok: false`
      **y** cuando el comprador no dejó email.
      **Verificación**: `npm --prefix apps/api run test:integracion --
      pedidoPublico`.
      **Los tests que evitan el defecto**: *«sin `RESEND_API_KEY` el pedido se
      crea igual y `email_enviado` viene en `false`»*, *«con la casilla del
      catálogo vacía el pedido entra y nadie recibe nada»* y *«el aviso va a
      `email_avisos` del catálogo y no al email de la empresa»* —espiando
      `sendEmail` y mirando el destinatario—.
      **Qué se revierte para verlo en rojo**: devolver `email_enviado: true`
      fijo; el primer test lo ve sin la clave de Resend. ⚠ `sendEmail` **ya
      devuelve `ok: false` cuando no salió** y tiene su test
      (`observabilidad.test.js:125-144`): esa propiedad es la que hace verificable
      todo esto, y no se toca.

- [ ] **T1472** El **enlace de WhatsApp**, armado **por el servidor** (FR-184):
      `armarTextoPedido` de `packages/pedido` con los nombres y los precios
      **congelados** —que el servidor tiene y la tienda no— y el número de
      destino que sale de **`whatsapp_destino` del catálogo**, no de uno global.
      El `whatsapp_url` viaja en la respuesta del pedido (FR-152). En
      `apps/tienda`, `enviarPedidoPorWhatsapp` propia **de tres líneas** —abrir
      `wa.me` con el `whatsapp_url` que ya vino armado—, que **no duplica ninguna
      regla** (FR-184a). Que el WhatsApp no se mande **no afecta al pedido**, que
      ya existe en la base (FR-185).
      **Verificación**: `npm --prefix apps/api run test:integracion --
      pedidoPublico` y `npm test -w apps/tienda`.
      **Los tests que evitan el defecto**: *«el texto del WhatsApp lleva los
      precios congelados del pedido y no los actuales del catálogo»* —cambiando
      una regla entre el pedido y la lectura— y *«el número de destino sale del
      catálogo»*, con dos catálogos de la misma empresa con números distintos.
      **Qué se revierte para verlo en rojo**: armar el texto en la tienda a
      partir del carrito; el primer test lo ve cuando la regla cambió.

**Checkpoint**: entra un pedido con email y sin email; en el primer caso llegan
los dos correos y la confirmación lo dice, en el segundo **no llega ninguno al
comprador y la pantalla no promete nada**. Con `RESEND_API_KEY` sin cargar, el
pedido entra igual.

---

## Phase 17: Visitas y la pestaña QR (corte F2.6)

**Purpose**: saber si el QR sirve. Es la **lectura** de lo que se viene
escribiendo desde F1.5, y va acá porque **la conversión necesita pedidos**.

📌 **Por qué el conteo se partió en dos cortes** (dependencia 1 del plan): la
tabla y la escritura son de **F1.2/F1.5** —el que cuenta es el resolvedor, en
cada apertura— y la lectura es de acá. Sin partirlo, o la etapa 1 termina con una
pestaña que muestra tres ceros inventados, o la etapa 2 arranca sin ningún dato
histórico y **el primer número real llega un mes tarde**.

- [ ] **T1473** `GET /api/catalogos/:id/metricas?dias=30` (`catalogo.ver`) en
      `routes/catalogos.js`: **visitas, pedidos y conversión** del mismo período,
      con el desglose por origen y **por `estado_catalogo`**. La conversión es
      pedidos sobre visitas, y **con cero visitas devuelve un guion y no `NaN`
      ni `0 %`** (FR-203) — o mejor: devuelve el dato crudo y **la pantalla
      decide**, que es lo que evita un `0/0` formateado en el servidor. Su fila
      en `permisosDeRutas.test.js`, y sus casos en
      `bandejaDePedidos.integracion.test.js` o en uno propio.
      **La fixture tiene que poder distinguir el defecto**: **diez aperturas y un
      pedido** —que dan 10, 1 y 10 %—, más **un período con el catálogo
      pausado**, que es el que hace falta para US20 escenario 7.
      **Verificación**: `npm --prefix apps/api run test:integracion -- metricas`.
      **Los tests que evitan el defecto**: *«diez aperturas y un pedido dan 10, 1
      y 10 %»*, *«con cero visitas la conversión no es `NaN` ni `0 %`»* y *«las
      visitas con el catálogo pausado se pueden distinguir de las publicadas»* —
      es lo único que justifica la cuarta columna de la clave única.
      **Qué se revierte para verlo en rojo**: agrupar sin `estado_catalogo`; el
      tercer test deja de poder separar los dos períodos.

- [ ] **T1474** La **pestaña QR muestra los números** en
      `components/QrDelCatalogo.jsx` (`:1044-1048`): **«Visitas» y no
      «Escaneos»** (FR-202) —el servidor **no puede distinguir** un escaneo de un
      enlace compartido por WhatsApp, y decirle «escaneos» a eso es mentir con
      una métrica—, pedidos, conversión con **guion cuando no hay visitas**, y el
      desglose por origen **presentado como aproximación y no como dato duro**. Y
      el período con el catálogo **pausado se distingue**, «para que la
      conversión en cero no se lea como un problema de la tienda» (US20 escenario
      7). Sus casos en `renderDeCatalogos.test.jsx`.
      **Verificación**: `npm run test:web -- renderDeCatalogos guardiasDeDiseno`.
      **Los tests que evitan el defecto**: *«la pestaña dice “Visitas” y en
      ninguna parte dice “Escaneos”»* —afirmado sobre el texto renderizado— y
      *«con cero visitas se dibuja un guion, no “0 %”»*.
      **Qué se revierte para verlo en rojo**: volver a poner «Escaneos» en el
      rótulo.

**Checkpoint**: diez aperturas del catálogo y un pedido dejan la pestaña QR
diciendo 10 visitas, 1 pedido y 10 % de conversión; con el catálogo pausado una
semana, esa semana se distingue y la conversión en cero **no se lee como un
problema de la tienda**.

---

## Los cuatro pasos manuales

**Son cuatro, y las cuatro veces se preguntó si de verdad no bajan a ninguno de
los cinco niveles.** Los que sí bajaban están abajo, para que nadie los vuelva a
proponer como manuales.

- [ ] **M1** **Restaurar el respaldo del volumen de imágenes en una máquina
      limpia.** No baja a ningún nivel: lo que se prueba es que el procedimiento
      escrito en `OPERACION.md` funcione **en manos de una persona**, con un
      volumen que no existe todavía. Lo que **sí** está automatizado es todo lo
      demás: que el `.tar.gz` se cree, que se verifique leyéndolo entero, que
      rote con el mismo criterio que la base, y que la guardia falle si alguien
      le saca la verificación.
      **Bloquea**: el criterio 4 y **que entre un pedido con plata real**. No
      bloquea ningún commit.

- [ ] **M2** **Crear el registro `A` de `tienda.favalio.com` apuntando a la
      misma IP.** Es un trámite en el panel de DNS del proveedor; ningún test lo
      puede hacer.
      **Bloquea**: el despliegue de **F1.7** y todo lo que venga después en
      producción. **No bloquea el desarrollo**: la tienda se levanta en local con
      `npm run dev -w apps/tienda` y el `handle` de Caddy se prueba con una
      entrada en `hosts`.

- [ ] **M3** **Pegar el enlace del catálogo en WhatsApp y mirar la
      previsualización.** Es el riesgo 9 del plan y es la clase de cosa que se
      descubre **pegando el enlace y no antes**: `X-Robots-Tag` a nivel de sitio
      se lo lleva todo —incluidas las imágenes, que es lo que se quiere— **pero
      los previsualizadores de enlaces no son buscadores** y no lo respetan, así
      que el `og:image` sigue funcionando. Lo automatizado es todo lo demás: que
      las cinco etiquetas se pongan, que el borrador dé 404 con las genéricas y
      que sin marcador la página salga igual.
      **Bloquea**: el cierre del corte **F1.7**.

- [ ] **M4** **Medir el consumo de RAM del sexto contenedor en el VPS.** El plan
      de 4 GB con swap «ya está justito» (riesgo 10). `nginx:alpine` con un
      bundle chico es despreciable, pero se mide al agregarlo — y el volumen de
      imágenes crece con el uso, **sin cuota por empresa** en esta etapa.
      **Bloquea**: nada. Es una medición que hay que hacer y anotar.

### Los ocho que NO son pasos manuales, y adónde bajaron

| Lo que parecía manual | Adónde bajó |
|---|---|
| «Verificar que el montaje del router público quedó bien» | Guardia de posición — T1440 |
| «Acordarse de que el `skip` no se borre» | La **atadura** de la misma guardia — T1440 |
| «Probar que el catálogo de B no se ve desde A» | Integración con dos empresas — T1439 |
| «Revisar que ninguna respuesta pública lleve el costo» | Guardia de forma **+** integración sobre el JSON entero — T1437 y T1439 |
| «Contar las llamadas que hace una visita» | El test de render que espía `fetch` — T1444, y el número escrito en `OPERACION.md` — T1450 |
| «Probar dos compradores al mismo tiempo» | Dos promesas en un test de integración — T1463 |
| «Confirmar que marcar cobrado no descuenta stock» | Integración mirando **las cinco tablas** — T1468 |
| «Mirar que la tienda entre en un teléfono» | Prueba de navegador a 390px — T1447 y T1467 |

---

## Resumen

| Fase | Corte | Qué queda funcionando | Tareas | Rango | Depende de |
|---|---|---|---|---|---|
| 1 | **F0.1** Workspaces y `packages/precios` | El monorepo instala de una y la fórmula vive en un solo lugar | 3 | T1410–T1412 | — |
| 2 | **F0.2** `products.publicable` | Se puede decir qué productos podrían salir | 3 | T1413–T1415 | 1 |
| 3 | **F0.3** Imágenes | Se sube una foto, la sirve Caddy y está en el respaldo | 5 | T1416–T1420 | 1 |
| 4 | **F1.1** Permisos, módulo y guardias | Los permisos existen antes que los endpoints | 3 | T1421–T1423 | — |
| 5 | **F1.2** Los datos de la etapa 1 | Las cuatro tablas y sus modelos | 4 | T1424–T1427 | 1 |
| 6 | **F1.3** Funciones puras | Slug, reglas, categoría y suscripción, sin base | 4 | T1428–T1431 | 1 |
| 7 | **F1.4** API privada de catálogos | Se arma y publica un catálogo por HTTP | 5 | T1432–T1436 | 3, 4, 5, 6 |
| 8 | **F1.5** Router público de lectura | El enlace contesta, y el de B da 404 desde A | 5 | T1437–T1441 | 7 |
| 9 | **F1.6** `apps/tienda` | La tienda se dibuja a 390px contra el contrato real | 6 | T1442–T1447 | 8 |
| 10 | **F1.7** `/c/:slug`, Caddy y compose | El enlace pegado en un mensajero muestra el catálogo | 3 | T1448–T1450 | 9 |
| 11 | **F1.8** Pantalla Catálogos | El comercio arma y publica sin `curl` | 6 | T1451–T1456 | 7 |
| 12 | **F2.1** `pedidos` y `packages/pedido` | La base y las puras del pedido | 5 | T1457–T1461 | 7 |
| 13 | **F2.2** `POST …/pedidos` | Entra un pedido con el precio del servidor | 2 | T1462–T1463 | 8, 12 |
| 14 | **F2.3** Carrito y checkout | El socio compra desde el teléfono | 4 | T1464–T1467 | 9, 13 |
| 15 | **F2.4** Bandeja | El pedido se opera, y la pantalla dice lo que hace | 3 | T1468–T1470 | 12, 13 |
| 16 | **F2.5** Avisos | Los dos correos y el WhatsApp, sin prometer de más | 2 | T1471–T1472 | 13, 15 |
| 17 | **F2.6** Visitas y pestaña QR | Se sabe si el QR sirve | 2 | T1473–T1474 | 11, 15 |
| | **Total** | | **65** | T1410–T1474 | |

### La primera que hay que hacer

**T1410**, y no es discutible: hasta que el monorepo sea workspaces **no existe
un lugar donde poner `packages/precios`**, y sin `packages/precios` el servidor
no sabe calcular ningún precio — que es lo que FR-076 necesita desde la
previsualización de F1.4, o sea desde el cuarto corte. Por eso es el corte cero y
no un refactor «que se hace cuando haya tiempo».

Y por eso **va sola**: es el único commit del hito que toca las cuatro apps a la
vez, borra tres lockfiles, mueve el contexto de build de cuatro Dockerfiles y
lleva el CI de cinco jobs a siete. Si algo sale mal ahí, la respuesta a «¿qué le
pasó al sistema?» tiene que ser «esto y nada más», y revertirlo tiene que ser un
`git revert`.

⚠ Y adentro de T1410, **el `.dockerignore` de la raíz no es un detalle**: los
tres de `apps/*` dejan de aplicar en el mismo momento en que el contexto cambia,
**sin ningún aviso**, y sin el de la raíz cada `docker build` sube el repositorio
entero al demonio. El VPS es de 4 GB.

### Las dependencias entre fases, y las dos que cruzan las etapas de la spec

Las tres etapas de la spec se respetan **salvo en dos lugares**, y los dos están
en el plan:

1. **El conteo de visitas es de la etapa 1 por escritura y de la etapa 2 por
   lectura.** `catalogo_visitas` y el `INSERT … ON CONFLICT` se necesitan desde
   **F1.5** —el que cuenta es el resolvedor, en cada apertura— pero la pestaña
   que muestra los números necesita **pedidos** para la conversión. Se parte: la
   tabla en F1.2, la escritura en F1.5, **la lectura en F2.6**.
2. **`packages/precios` no se puede diferir a la etapa 1.** FR-076 —un producto
   sin precio resoluble no sale al catálogo— necesita `sinCosto` **del lado del
   servidor** desde F1.4. Por eso está en el corte cero.

**No hay ninguna dependencia que obligue a reordenar las fases**, y las dos que
cruzan ya están resueltas por el corte, no por una permuta. Lo que sí conviene
saber:

- **F1.5 antes que F1.6**, aunque la app se pueda esqueletar antes: la tienda
  consume lo que el router público devuelve, y si se dibuja primero se dibuja
  contra un contrato imaginado.
- **F1.1 antes que las pantallas**, por el protocolo de las guardias: los seis
  archivos entran a `NOMBRES` **antes** de escribirse. Una guardia agregada
  después se escribe para el código que ya está, y entonces no es una guardia
  sino una descripción.
- **F1.8 (la pantalla) no bloquea la etapa 2.** Depende de F1.4, no de F1.5 ni
  de F1.6, así que puede ir en paralelo con F1.5–F1.7 si hay dos personas.
- **Las fases 2, 3 y 4 no dependen entre sí** y salen las tres de la 1.

### Las que pueden ir en paralelo

Dentro de cada fase: **T1412** · **T1416** · **T1420** · **T1426 y T1427** ·
**T1428, T1429, T1430 y T1431** (las cuatro) · **T1436** · **T1443** ·
**T1450** · **T1451** · **T1458, T1459 y T1460** · **T1462** · **T1467**.

Entre fases, con dos personas: **F1.8 en paralelo con F1.5–F1.7** (las dos salen
de F1.4), y **F0.2 y F0.3 en paralelo entre sí**.
