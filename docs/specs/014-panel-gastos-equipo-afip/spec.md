# Feature Specification: Panel, Gastos, Equipo y Ajustes AFIP — las cuatro que quedan del recorrido del cliente

**Feature Branch**: `014-panel-gastos-equipo-afip`
**Created**: 6 de agosto de 2026
**Status**: Draft — hay puntos abiertos, ver «Lo que falta decidir»
**Input**:

> Hito 8 del plan (`docs/PLAN-COMPRAFIT.md`), que agrupa cuatro pantallas.
> Textual, las cuatro secciones:
>
> **4.7 · Gastos**
>
> **Diseño.** Tarjetas de total por sucursal arriba, tabla en grid abajo. Las dos
> solapas con el estilo de segmentos de la maqueta.
> **Función.** Completa (fijos y variables).
>
> **4.8 · Panel de control**
>
> **Diseño.** Cuatro tarjetas de indicador con el sparkline de barras de la
> maqueta, y las tres secciones: «Requiere tu atención», «Actividad reciente»,
> «Accesos rápidos».
> **Función.** El BEP ya está y corregido. Sumar «Requiere tu atención», que hoy
> no existe: faltantes, ventas sin CAE, vencimientos de stock.
>
> **4.9 · Facturación AFIP (Ajustes)**
>
> **Diseño.** La maqueta tiene esta pantalla resuelta con dos bloques: **«Puesta
> en marcha»** (checklist de lo que falta configurar) y **«Datos de
> facturación»**.
> **Función.** El checklist de puesta en marcha es nuevo y es lo que evita la
> llamada «no puedo facturar»: CUIT cargado, certificado subido y vigente, punto
> de venta declarado, prueba en homologación hecha.
>
> **4.11 · Equipo**
>
> **Diseño.** Tabla en grid.
> **Función.** **Sesiones activas** — el legacy las tenía y no están. Requiere
> decidir si se listan sesiones de Auth0 o se registra el último acceso por
> usuario, que es más simple y cubre el 90 % del caso.
>
> Y del cuadro de orden de ejecución (sección 6): «8 · Panel, Gastos, Equipo,
> Ajustes AFIP».

---

## Un aviso antes de empezar

El pedido describe cuatro pasadas de diseño con algo de deuda funcional. Dice
que Gastos tiene la **función completa**, que el BEP del Panel **ya está y
corregido**, y que a Equipo solo le faltan las sesiones activas.

**El relevamiento dice otra cosa en las cuatro.** Lo que sigue no es una lista de
mejoras: son cuatro cosas que hoy están rotas y que una pasada de diseño
encima dejaría igual de rotas, pero más prolijas.

1. **La clave privada de AFIP sale de la API en texto plano, y es esta pantalla
   la que la pide.** `GET /api/settings` (`routes/general.js:394-398`) copia
   **todas** las filas de `settings` a la respuesta, sin lista de exclusión, y
   ahí viven `afip_cert` y `afip_key` (`routes/afip.js:143-146`). `Settings.jsx:45`
   llama a ese endpoint al montar, y `store/useStore.js:47-58` lo vuelve a
   llamar en cada `initialize()`: **la clave privada RSA de facturación termina
   en el store global de la aplicación**, en el network tab del navegador y en
   cualquier proxy del camino. Alcanza `config.ver`, que tienen los roles
   `admin` y `gerente`. Que es un olvido y no una decisión lo prueba
   `scripts/backup.js:59`, que **sí** tiene la lista:
   `SETTINGS_EXCLUIDOS = ['afip_cert', 'afip_key', 'tiendanube_access_token']`.

2. **El flujo de invitación no funciona de punta a punta, y nadie se entera.**
   `server.js:422-423` monta el router de auth con `app.get`/`app.post` en vez de
   `app.use`. Un `Router` montado así no recibe el `req.url` recortado, así que
   `router.get('/invite/:token')` (`routes/auth.js:59`) se compara contra
   `/api/auth/invite/abc` y **no matchea nunca**. Comprobado empíricamente contra
   el express instalado (5.2.1): las dos rutas responden **404**. Encima el mail
   linkea a `${FRONTEND_URL}/accept-invite/${token}` (`services/email.js:90`),
   una ruta que **no existe en `App.jsx:275-304`**, y el `.catch` de la
   aceptación borra el token sin decir nada (`App.jsx:148-150`).

3. **`Team.jsx:85` dice «Invitación enviada» siempre.** La API ya está bien: el
   bug histórico de `sendEmail` está corregido —devuelve
   `{ok:false, enviado:false, error:'EMAIL_NO_CONFIGURADO'}` (`services/email.js:36-38`),
   con su comentario y su test (`tests/observabilidad.test.js:125-144`)— y
   `routes/empresas.js:687-694` propaga `email_enviado` y un mensaje que dice qué
   hacer. **La pantalla lo tira**: hace `toast.success('Invitación enviada')`
   incondicionalmente y no lee `res.data.email_enviado` ni `res.data.message`.
   El agujero no se cerró: se **mudó** de `services/email.js` a `pages/Team.jsx:85`.

4. **El Panel miente en cinco números distintos, y son los que el dueño usa para
   decidir.** «Por Pagar» nunca resta los pagos, así que solo crece
   (`dashboardService.js:207-224`). «Por Cobrar» y «clientes con deuda» cuentan
   como deuda las ventas de contado, porque les falta `is_credit`
   (`:143-149`, `:166-172`) — el filtro que `customerService.js:64-66` tiene, con
   el comentario que explica por qué. El aging no puede cerrar con el total que
   tiene 40 píxeles más arriba. Las ventas del día 1 se cuentan en el mes actual
   **y** en el anterior. Y las fechas son UTC mientras las ventas se guardan con
   la fecha del negocio.

5. **Un gasto fijo sin sucursal puede no dibujarse en ninguna parte, y sigue
   moviendo el punto de equilibrio.** `models/FixedExpense.js:33` tiene
   `defaultValue: 'gf1'`, el alta de la pantalla nunca manda `group`
   (`Expenses.jsx:46-50`) y el agrupador del navegador reparte por
   `'gf' + puntosDeVenta.indexOf(pv)` (`Expenses.jsx:76`). Con una sola sucursal,
   `'gf0'` no matchea nada y `'gf1'` queda excluido del bucket «General»
   (`:81`): **el gasto existe, lo suma `dashboardService.js:47` y
   `cashflowService.js:27`, y la pantalla de Gastos no lo muestra**.

Los cinco entran. Rediseñar cualquiera de estas cuatro pantallas sin tocar esto
es cambiar la tipografía de un número equivocado.

---

## Por qué van juntas, y por qué AFIP debería ir sola

**Van juntas porque son las que quedan del recorrido del cliente, no porque
compartan datos.** Es exactamente lo que dice el plan: el cuadro de la sección 6
las agrupa en un hito y el orden es «por uso real». No hay ningún modelo, ningún
servicio ni ningún componente que las cuatro compartan. Gastos y Panel se tocan
en un punto —el total de gastos fijos alimenta el BEP— y Equipo y Ajustes AFIP
no se tocan con nada.

Consecuencia práctica: **son cuatro trabajos, no uno**, y `sdd-tasks` los tiene
que poder cortar en cuatro fases revertibles por separado. Un commit que toque
las cuatro es un commit que no se puede revertir cuando una sola sale mal.

**Y AFIP debería ir sola.** Las otras tres son pasadas de diseño con deuda
funcional; ésta es otra cosa:

| | Las otras tres | Ajustes AFIP |
|---|---|---|
| Qué se arregla | Números mal calculados y pantallas viejas | **Una clave privada que sale por la API** y el gate de lo fiscal |
| Qué pasa si sale mal | Un número queda raro y se corrige | Se emite un comprobante fiscal real, o se filtra material fiscal |
| Cuándo tiene que estar | Con el rediseño | **La fuga, antes que el rediseño** |
| Contra qué se verifica | La maqueta y el legacy | Un circuito que **nunca se probó** (`PROXIMOS-PROYECTOS.md`, proyecto 2) |

Dos propuestas, en orden de preferencia:

1. **La fuga de `afip_key` sale de este hito y va primero, sola, hoy.** Es un
   `if` en `routes/general.js` más su test, no depende de ninguna decisión de
   diseño y no tiene por qué esperar a que se dibuje una pantalla. Mezclarla en
   un commit de rediseño es garantizar que no se pueda revertir el rediseño sin
   reabrir la fuga.
2. **El resto de 4.9 se corta como spec propia** (015), porque su parte más cara
   no es diseño: es decidir si la pantalla puede habilitar la emisión en
   producción cuando el circuito nunca se probó en homologación. Ver
   [PENDIENTE 2].

Si no se aceptan, este documento cubre las cuatro igual y la separación se
resuelve en `tasks.md`. Pero queda escrito acá para que la discusión sea ahora.

---

## Qué patrones ya están fijados, y cuáles aplican a cada pantalla

Las funcionalidades 009 a 013 dejaron el patrón escrito en componentes
compartidos. **Ninguna de estas cuatro pantallas inventa nada que ya exista.**
Decirlo explícitamente es parte del trabajo: sin esto, `sdd-verify` marca como
desvío cada cosa que se resolvió distinta a propósito.

| Patrón | Gastos | Panel | AFIP | Equipo | Dónde y por qué |
|---|---|---|---|---|---|
| `MarcoDePantalla` (dos capas: la de afuera scrollea a ancho completo, la de adentro centra a 1320px) | **Ya** | **Ya** | **Ya** | **Ya** | Las cuatro rutas ya están envueltas (`App.jsx:289`, `:290`, `:291`, `:296`) y las cuatro están en `CON_MARCO` de `pruebas-de-navegador/marcoDeLasPantallas.navegador.js:53-58`, que hoy tiene **dieciocho** rutas. **No se agrega ninguna ruta nueva**: es la diferencia con la funcionalidad 013 |
| `TablaGrid` / `Encabezado` / `Fila` / `BotonDeFila` | **Sí** | **No** | **No** | **Sí** | El plan pide «tabla en grid abajo» para Gastos (4.7) y «tabla en grid» para Equipo (4.11). El Panel son tarjetas y listas, no una tabla. Ajustes es un formulario. Las medidas literales —`11px 20px` en el encabezado, `15px 20px` en las filas, `gap-x` de 16px, botones de 29px (`TablaGrid.jsx:67`, `:90`, `:123`)— y **no** los `Table*` de shadcn, que es lo que las dos usan hoy (`Expenses.jsx:8`, `Team.jsx:9-16`) |
| La disciplina del `grid-template-columns` | **Sí** | — | — | **Sí** | El encabezado y las filas comparten el **mismo string**, escrito una vez. Es lo que evita leer un importe bajo la etiqueta «Estado» (`TablaGrid.jsx:58-61`) |
| Segmentos para las solapas | **Sí** | **No** | Ver ↓ | **No** | 4.7 pide «las dos solapas con el estilo de segmentos de la maqueta»: el contenedor `padding:3px;border-radius:9px;background:var(--surface-3)` con botones de 28px (`Favalio-Rediseno.dc.html:645-648`), que es el mismo que ya implementa `components/pos/SegmentoDePago.jsx`. Hoy Gastos usa un `border-b-2` a mano (`Expenses.jsx:104-118`). **Ajustes es otra cosa**: la maqueta le dibuja solapas de subrayado (`:693-697`, `box-shadow:inset 0 -2px 0 0 var(--brand)`), no segmentos — ver [PENDIENTE N14] |
| `ui/sheet.jsx` para el panel lateral | **Sí** | **No** | **No** | **Sí** | 520px con `max-w-[92vw]`, como `PanelProducto.jsx` y `PanelOrdenDeCompra.jsx`. Hoy las dos usan `Dialog` (`Expenses.jsx:181`, `Team.jsx:234`): se edita un gasto o un miembro **mirando la lista, no tapándola**. Es la misma decisión que tomó Inventario en el hito 4 |
| `utils/formato.js` — `pesos`, `fechaCorta`, `fechaDeHoy`, `pesosRedondos`, `pesosDeLista`, `importeAbreviado`, `importeOGuion` | **Sí** | **Sí** | **Sí** | **Sí** | **Ninguna pantalla puede declarar la suya**, y la guardia está en `utils/formato.test.js:362-414`. Las cuatro tienen deuda acá, y **tres de las cuatro por un camino que la guardia no ve**: formatean en línea con `toLocaleString()` sin declarar función. Ver hallazgo T3 |
| `utils/erroresDeApi.js` → `mensajeDeError` | **Sí** | **Sí** | **Sí** | **Sí** | **Ninguna de las cuatro lo usa hoy.** Siete lugares muestran `err.message`, que en axios es «Request failed with status code 500» (`Expenses.jsx:56`, `:68`; `Settings.jsx:103`, `:128`; `Team.jsx:87`, `:99`, `:109`), y tres se tragan el error entero con `console.error` (`Expenses.jsx:35`, `Dashboard.jsx:64`, `Team.jsx:65`) |
| Tokens de `index.css`, cero hex, cero `dark:`, cero clases de la paleta de Tailwind, cero `Table*` | **Sí** | **Sí** | **Sí** | **Sí** | Las cuatro **entran a la lista `NOMBRES` de `guardiasDeDiseno.test.js:171-191`** (hoy diecinueve archivos, ninguno de las cuatro) **antes** de escribirse. Es deliberado: un archivo de esa lista que todavía no existe da un hallazgo propio (`guardiasDeDiseno.test.js:193-215`), y así cada infracción falla cuando se escribe y no treinta juntas al final. El ancla `expect(ARCHIVOS).toHaveLength(19)` (`:366`) sube con ellas |
| Badge de estado con las **tres** clases juntas | **Sí** | **Sí** | **Sí** | **Sí** | `border-…-line`, `bg-…-soft` y `text-…` en un solo string, desde una función pura que nunca devuelve `undefined`, como `tonoDeProveedor` (`REGLAS-DISENO.md`, «Badge de estado»). Acá: el nivel de un gasto contra su sucursal, la severidad de un aviso del panel, el estado de cada paso del checklist de AFIP, el rol y el estado de un miembro |
| Estado vacío con ícono apagado y dos líneas | **Sí** | **Sí** | **Sí** | **Sí** | Y **cada uno dice algo distinto**: sin gastos cargados vs. sucursal sin gastos; nada que requiera atención vs. no se pudo calcular; AFIP sin configurar vs. configurado a medias; equipo de una sola persona vs. sin invitaciones pendientes |
| `PageHeader` (`h1` + descripción + acción principal) | **Sí** | **Sí** | **Sí** | **Sí** | Las cuatro arman el encabezado a mano hoy (`Expenses.jsx:86-102`, `Dashboard.jsx`, `Settings.jsx:134-139`, `Team.jsx:115-125`) |
| `Can.jsx` para gatear acciones | **Sí** | — | **Sí** | **Sí** | Hoy `Expenses.jsx` y `Team.jsx` dibujan botones que la API rechaza con 403 y ninguno usa `Can` (`GastosVariables.jsx:144` sí lo usa: la asimetría está adentro de la misma pantalla). La regla del repositorio es **deshabilitado con su explicación, no ausente** |
| `utils/` para las reglas, antes que un test de render | **Sí** | **Sí** | **Sí** | **Sí** | El agrupado de gastos por sucursal, la severidad y el orden de los avisos del panel, el estado de cada paso del checklist de AFIP y el estado de un miembro son **funciones puras**. Ver «Qué se verifica en qué nivel» |
| `utils/bep.js` | — | **Sí, y no se toca** | — | — | El BEP está corregido y testeado (`bep.js`, `bep.test.js`, 20 casos). Distingue margen sobre venta de recargo sobre costo, que es el error que «recomendaba precios que garantizan pérdida». **Lo que hay que arreglar no es la cuenta: son los dos números que entran** (hallazgo P7) |
| `utils/stockBajo.js` (`esStockBajo`, `limiteDeStockBajo`, `UMBRAL_POR_DEFECTO`) | — | **Sí, y hay que decidir** | — | — | Existe en los dos lados y su encabezado dice textualmente que `GET /api/alerts` y `dashboardService.js` **quedaron con la regla vieja a propósito** (riesgo 6 del plan). El rediseño hace visible esa divergencia. Ver hallazgo P10 |
| `utils/fechas.js` (`hoyDelNegocio`, `fechaDelNegocio`) | **Sí** | **Sí** | — | — | Existe, está testeado (`fechas.test.js:123-133`) y **el panel no lo llama una sola vez** (`dashboardService.js:17-22`). `GastosVariables.jsx:26` tiene el mismo defecto del lado del navegador |
| `utils/centavos.js` | — | **Sí** | — | — | `dashboardService.js:224-237` acumula en punto flotante y `:149` compara dos `SUM` de DECIMAL con `>`. Es lo que `cuentaDeProveedor.js:22-27` prohíbe por FR-050 |
| `findScoped` / `scoped` / `assertEmpresaId` de `utils/tenantScope.js` | **Sí, y es un hallazgo** | Ya | Ya | **Sí, y es un hallazgo** | Ver hallazgos G4 y E6 |
| `fallo(req, res, err, 'mensaje en castellano')` y `ErrorDeNegocio` | **Sí** | **Sí** | **Sí** | **Sí** | Está bien puesto en casi todos los handlers; lo que falta es del lado del navegador |
| El cuarto nivel: tests de integración contra Postgres | **Sí** | **Sí, y es imprescindible** | **Sí** | **Sí, y es imprescindible** | Los `SUM` con `GROUP BY`, los DECIMAL que vuelven como string, el aislamiento **ejecutado** y el montaje real de una ruta no los puede contestar un doble. Hoy **ninguna de las cuatro tiene un solo test de integración**, y el 404 del hallazgo E1 pasó desapercibido justamente por eso |
| Los tres gates del plan (`soloSuperadmin` / `modulo` / `permission`) | **Sí** | **Sí** | **Sí** | **Sí** | Ver hallazgo T1: las cuatro declaran módulo en el menú y **ninguna lo exige en la ruta** |
| `Pagination.jsx` | Ver ↓ | — | — | **No** | Gastos no lo necesita hoy (son decenas de filas) pero los gastos variables se acumulan por mes; Equipo tampoco (son unidades) |

---

## Contexto: qué existe hoy

Es la parte más importante del relevamiento: **la spec no puede pedir lo que ya
existe ni dar por hecho lo que no**. Relevado archivo por archivo.

### Lo transversal

| Cosa | Estado real |
|---|---|
| Las cuatro rutas | **Existen** y están envueltas en `MarcoDePantalla` (`App.jsx:289-296`). Alias legacy: `/expenses → /gastos` (`:303`), `/settings → /facturacion` (`:304`), `/calculator → /panel` (`:298`) |
| Los cuatro ítems de menú | **Existen** con su `permission` y su `modulo` (`navegacion.js:42`, `:43`, `:49`, `:61`) |
| `RouteGuard` en las cuatro rutas | **No hay ninguno.** Las cuatro están en `SIN_GUARD_TODAVIA` de `marcoDePantalla.test.js:181-190`, que es **deuda declarada con su motivo escrito**: cerrar cada una exige mirar en producción qué empresas tienen ese módulo en `enabled_modules`, porque una que no lo tenga pierde la pantalla |
| Permisos de las rutas de la API | **Todas declaran uno**, y lo verifica `permisosDeRutas.test.js`, cuya lista `DEUDA_DE_PERMISOS` está **vacía** (`:133`). Lo que la guardia **no** verifica es que el permiso sea el correcto, y su propio comentario lo dice (`:48-52`) |
| `checkSubscription` | `/api/empresas` y `/api/auth` están **exentos enteros** (`middleware/checkSubscription.js:30-36`), así que una empresa con la suscripción vencida sigue invitando y cambiando roles. `/api/afip`, `/api/dashboard` y `/api` (gastos) **sí** pasan por el paywall |
| Tests de render | **Ninguna de las cuatro tiene uno.** Existen seis `renderDe*.test.jsx` y ninguno es de estas pantallas |
| Tests de integración | **Ninguno toca estas cuatro.** Los diez archivos de `src/tests/integracion/` cubren aislamiento, recepciones, saldos, idempotencia, índices y TiendaNube |

### Gastos

**Está**: dos modelos (`FixedExpense`, `GastoVariable`), diez endpoints con su
permiso, una pantalla con dos solapas, y un componente aparte para los
variables que **sí** usa `Can`.

**Falta**: que la pantalla muestre todos los gastos que hay, que el total lo
calcule el servidor, que los importes se lean en argentino, que se pueda editar
un gasto fijo, y **un solo test de cualquier nivel**.

| Cosa | Dónde | Estado real |
|---|---|---|
| `GET /api/expenses` | `routes/general.js:311-321` | `gastos.ver`. `where { empresa_id }` + filtros opcionales `group` y `punto_de_venta_id`. **No devuelve ningún total** y **no aplica `req.puntoDeVentaId`** como caída, a diferencia de `:539` |
| `POST /api/expenses` | `:328-339` | `gastos.crear`. `FixedExpense.create({ ...req.body, empresa_id })` — **mass assignment**, ver hallazgo G4 |
| `PUT /api/expenses/:id` | `:342-353` | `gastos.editar`. Usa `findScoped` (bien). **No lo llama nadie**: `services/api.js:222` declara `updateExpense` y ningún componente lo importa. **Un gasto fijo no se puede corregir desde la pantalla** |
| `DELETE /api/expenses/:id` | `:356-367` | `gastos.eliminar`, `destroy` scopeado. El rol `gerente` **no** tiene ese permiso (`seedPermissions.js:85`) y la pantalla igual dibuja el botón |
| `GET /api/gastos-variables` | `routes/gastosVariables.js:39-82` | `gastos.ver`. Valida `mes` YYYY-MM, agrupa por persona **en el servidor** y devuelve total. Es lo que Gastos fijos debería hacer y no hace |
| `GET /api/gastos-variables/meses`, `/resumen` | `:85`, `:184` | `gastos.ver`. **Ninguno de los dos lo llama la pantalla** |
| `POST` / `PUT` / `DELETE` de variables | `:108`, `:140`, `:169` | Scopeados, con `findScoped` en el PUT y un comentario explícito de que `empresa_id` nunca sale del cuerpo (`:158-159`) |
| `FixedExpense.amount` / `GastoVariable.monto` | `models/FixedExpense.js:26`, `models/GastoVariable.js:55` | `DECIMAL(12,2)` — **vuelven como string** |
| `FixedExpense.group` | `models/FixedExpense.js:33` | `defaultValue: 'gf1'`. Es el resto de la migración del legacy (`scripts/migrar-legacy.js:379` escribe `'gf1'`/`'gf2'`) y es la causa del hallazgo G1 |
| La pantalla | `pages/Expenses.jsx` (218 líneas) + `components/GastosVariables.jsx` (272) | `Table*` de shadcn, `Dialog`, encabezado a mano, totales en el navegador, `err.message`, sin `Can` en la solapa de fijos |
| Los gastos variables **no** entran en el BEP | `Expenses.jsx:17-19`, `gastosVariables.js:17-20` | Escrito en los dos lados y **correcto**: el punto de equilibrio se plantea sobre los fijos. No se toca |

### Panel de control

**Está**: un endpoint que calcula doce cosas, el BEP corregido y testeado en el
navegador, y una pantalla con seis tarjetas, dos listas de alertas y un
simulador de precios.

**Falta**: que los números sean los mismos que muestran las pantallas que los
detallan, que las fechas sean las del negocio, «Requiere tu atención»,
«Actividad reciente», «Accesos rápidos», los sparklines, y **un solo test del
servicio con más aritmética de plata del backend**.

| Cosa | Dónde | Estado real |
|---|---|---|
| `GET /api/dashboard/kpis` | `routes/dashboard.js:7-9` | `dashboard.ver`, que **tienen los cinco roles** (`seedPermissions.js:86`, `:97`, `:103`, `:109`). **No recibe `req.puntoDeVentaId`** |
| `dashboardService.getKpis` | `services/dashboardService.js:16-50` | Doce consultas en `Promise.all`. **Todas filtran por `empresa_id`** — verificado línea por línea |
| `GET /api/alerts` | `routes/general.js:448-505` | `stock.ver`, **distinto** del que pide `/kpis`. Regla vieja de stock bajo: `min_stock > 0` (`:462`), sin filtrar `is_active`, sin sucursal |
| `utils/bep.js` + `bep.test.js` | `apps/web/src/utils/` | **Correcto y probado.** El BEP vive **entero en el navegador**: no hay una línea de punto de equilibrio en `apps/api/src` |
| Sparkline / gráfico | — | **No existe ninguno**, y no hay librería de gráficos en `apps/web/package.json`. Lo más parecido son las barras de progreso a mano de `Dashboard.jsx:212-217` |
| «Requiere tu atención» | — | **No existe.** Lo más cercano son dos listas planas al final: «Alertas de Stock Mínimo» (`Dashboard.jsx:436`) y «Vencimientos Próximos» (`:467`), sin prioridad, sin agregación y sin acción |
| «Actividad reciente» | — | **No existe, y no hay de dónde sacarla**: no hay tabla de auditoría ni registro de eventos. Ver [PENDIENTE N5] |
| «Accesos rápidos» | — | **No existe** |
| Selector de período / Exportar | — | **No existen.** La maqueta los dibuja (`Favalio-Rediseno.dc.html:226-234`). Ver [PENDIENTE N1] |
| `kpis.alerts` | `dashboardService.js:77-80` | Se calcula, se devuelve y **la pantalla no lo lee**: dibuja las del otro endpoint. Dos consultas por request a la basura, con criterio distinto |

### Facturación AFIP (Ajustes)

**Está**: la parte difícil. La firma PKCS#7 del TRA, el manejo del ticket WSAA
con su cache por empresa, el armado del SOAP, la serialización de la numeración
por `(empresa, punto de venta, tipo)`, y una guía para el usuario final
(`docs/GUIA_AFIP.md`). Lo dice la propia auditoría: «la parte difícil está
resuelta y bien resuelta» (`AUDITORIA-AFIP.md:173`).

**Falta**: que la clave privada no salga por la API, que exista un checklist,
que «probar la conexión» pruebe algo, y que el circuito se haya probado alguna
vez.

| Cosa | Dónde | Estado real |
|---|---|---|
| `GET /api/afip/cert-info` | `routes/afip.js:42-71` | `config.ver`. Devuelve `issuer`, `isProduction`, `subject`, `cuit`, `validFrom`, `validTo`. **No devuelve el PEM** — está bien hecho, y es de acá que sale «Certificado vigente hasta …» de la maqueta |
| `GET /api/afip/status` | `:31-39` | `config.ver` → `FEDummy`. **`FEDummy` no lleva `Auth`** (`afipService.js:114-122`): dice si los servidores de AFIP contestan, **no** si el certificado de esta empresa sirve |
| `POST /api/afip/setup` | `:74-158` | `config.editar`. Valida los dos PEM por separado, valida el enum de ambiente y el de condición fiscal, exige cert+key juntos, escribe en transacción y **invalida el cache del ticket WSAA** (`:151`). Es el camino correcto |
| `POST /api/afip/generate-csr` | `:165-197` | `config.editar`. Devuelve `{csr, key, advertencia}`: la clave **recién generada** viaja al navegador y **no se guarda en el servidor** (`afipService.js:358-364`). Es por diseño y está advertido |
| `POST /api/afip/invoice` | `:200-220` | **`ventas.crear`**, que tiene el rol `vendedor`. Emite un comprobante fiscal con `type`, `amount` y `pv` **del cuerpo**, sin crear ninguna `Sale`. **No lo llama el frontend.** Ver hallazgo A4 |
| `GET /api/settings` | `routes/general.js:374-415` | `config.ver`. **Devuelve `afip_cert` y `afip_key` en claro.** Ver hallazgo A1 |
| `GET /api/settings/:key` | `:418-431` | `config.ver`. `GET /api/settings/afip_key` devuelve el PEM crudo |
| `PUT /api/settings/:key` | `:434-445` | `config.editar`. Acepta **cualquier** clave, incluidas las seis de AFIP, y saltea todas las validaciones de `/afip/setup`. Ver hallazgo A3 |
| Dónde vive el material fiscal | `models/Setting.js:20-36` | Filas `afip_cert` y `afip_key` en `settings`, `value` JSONB, PK `(key, empresa_id)`, **en texto plano**. No hay nada en disco. No hay cifrado en ningún lado del repositorio |
| El entorno | `services/afipAuth.js:48-65` | **Por empresa**, en `settings.afip_environment`. Sin valor cae a homologación **y lo registra** con un `logger.warn` que dice que los comprobantes no tienen validez fiscal |
| Prueba en homologación | — | **Nunca se hizo, y no hay marca de haberla hecho.** `AUDITORIA-AFIP.md:223-233`, `PROXIMOS-PROYECTOS.md:124-134`, `PLAN-COMPRAFIT.md:355`. No hay columna, ni setting, ni flag, ni test de integración |
| El punto de venta de ARCA | `settings.afip_pv` | **Uno solo por empresa**, sin relación con `puntos_de_venta`. `sales.js:840-848` lo tiene escrito: «una empresa con dos locales comparte numeración correlativa entre ambos». Es el proyecto 5b |
| Reintentar una venta sin CAE | `POST /api/sales/:id/facturar` (`sales.js:928`) | **Existe, es idempotente y tiene lock.** Se usa desde `InvoicesList.jsx:427` y `Billing.jsx:483`. **Desde `/facturacion` no se ve ni se reintenta nada** |
| Redacción de secretos en logs | `utils/logger.js:56-61`, `config/sentry.js:55` | **Bien puesta.** `afip_key`, `afip_cert`, `*.afip_key`, `*.afip_cert`, más `err.sql` y `err.parameters` con el comentario que explica que sin eso la clave salía en el SQL del INSERT fallido |
| La pantalla | `pages/Settings.jsx` (421 líneas) | Asistente de cuatro pasos, formulario, tarjeta de certificado, «Estado Conexión». Sin `Table*`, con cuatro clases de la paleta de Tailwind, con `err.message`, y con un bug de lectura de la respuesta de estado |

### Equipo

**Está**: las tablas, los nueve endpoints, el catálogo de permisos por rol, y
`sendEmail` **corregido y con su test**.

**Falta**: que una invitación se pueda aceptar, que la pantalla diga la verdad
sobre el envío, que no se pueda dejar la empresa sin admin, sesiones activas, y
**un solo test funcional**.

| Cosa | Dónde | Estado real |
|---|---|---|
| `GET /:empresaId/usuarios` | `routes/empresas.js:749-759` | `equipo.ver` + `requireEmpresaPropia`. `include` de `Usuario` **sin `attributes`**: devuelve `auth0_sub` y `es_superadmin`. Contrastar con `:633`, que sí los limita |
| `POST /:empresaId/usuarios` | `:763-783` | `equipo.invitar`. Incorpora por `auth0_sub` **sin invitación**, y **no valida el rol** contra el catálogo. **No lo usa la UI** |
| `PUT /usuarios/:id` | `:788-802` | **`config.editar`**, no `equipo.*`. Scopeado a mano y correcto. **Sin chequeo de «último admin» ni de «soy yo»** |
| `GET /:empresaId/invitaciones` | `:629-640` | `equipo.ver`. `include` del invitador con `attributes` limitados. Correcto |
| `POST /:empresaId/invitar` | `:648-698` | `equipo.invitar`. Crea la invitación, manda el mail y **devuelve `email_enviado` y un mensaje que dice qué hacer si no salió**. Correcto |
| `POST /invitaciones/:token/re-enviar` | `:701-733` | `equipo.invitar` **y nada más**: sin `requireEmpresa`, sin scoping. Ver hallazgo E6. **No lo llama nadie** |
| `DELETE /invitaciones/:id` | `:736-745` | `equipo.eliminar` con `findScoped`. Correcto |
| `GET /api/auth/invite/:token` | `routes/auth.js:59-86` | **404 siempre.** Ver hallazgo E1 |
| `POST /api/auth/accept-invite/:token` | `routes/auth.js:8-56` | **404 siempre.** Ver hallazgo E1 |
| `services/email.js` | `:34-63` | **Corregido.** Sin `RESEND_API_KEY` devuelve `{ok:false, enviado:false, error:'EMAIL_NO_CONFIGURADO'}`, con `logger.error` por envío y un aviso al arrancar. El comentario `:27-32` documenta el bug histórico y `tests/observabilidad.test.js:125-144` lo ancla. **Es el único de los tres errores caros de `CONVENCIONES.md` que ya está cerrado del lado del servidor** |
| Eliminar un miembro | — | **No hay endpoint.** `equipo.eliminar` solo se usa para revocar invitaciones. Sacar a alguien es `PUT /usuarios/:id` con `is_active:false`, que pide `config.editar`, y **la pantalla no lo expone** |
| Roles y permisos por usuario | `models/UsuarioPermiso.js`, `models/RolPermiso.js` | Los modelos existen y **se leen** en tres lugares. **No hay ningún endpoint que los escriba** — o sea: no se puede escalar permisos por API (bien), y la funcionalidad que el modelo promete no existe (a saber) |
| `es_superadmin` | `models/Usuario.js:41-45` | **Ningún endpoint la escribe**, y hay guardia estática que lo ancla (`tests/superadmin.test.js:116-141`). Cerrado |
| Último acceso / sesiones | — | **No existe nada**: ni columna, ni tabla, ni registro. `usuarios` tiene cinco columnas y `usuario_empresas` nueve, y ninguna es de acceso |
| Auth0 | `middleware/auth.js:107-122` | El usuario se **auto-registra**; la API lo crea just-in-time desde el JWT. **No hay Management API**: invitar a alguien no crea nada en Auth0 |
| La pantalla | `pages/Team.jsx` (278 líneas) | `Table*`, `Dialog`, `Select`, encabezado a mano, fechas con `toLocaleDateString()`, tres estilos distintos de error, sin `Can`, columna Estado clavada en «Activo» |

### El sistema viejo

`legacy/index-legacy.html` **sí tiene** tres de las cuatro, y es la mejor fuente
sobre qué espera Comprafit.

| Pantalla | Qué hacía el legacy |
|---|---|
| **Gastos** | Una sola pantalla «Gastos **y configuración**» (`:2977-3067`) con: cuatro KPI arriba —«Gastos fijos / mes», «Margen mínimo», «Gastos / día», «Facturación prom.» (`:2985-2990`)—, los gastos fijos **agrupados por tienda** con su total (`:3011-3021`), un campo «Facturación mensual promedio» que alimenta el margen mínimo (`:3030`), y los gastos variables del mes **por persona** (`:3035-3043`). Y una **vista distinta para las sucursales**, que solo ven sus propios variables: «Solo vos podés ver y editar tus gastos» (`:3052`) |
| **Panel** | **No existía como pantalla.** El punto de equilibrio vivía adentro de la calculadora de precios del inventario (`:1556-1585`), con tres estrategias —«BEP Justo», «Recomendado», «Agresivo» (`:4019-4021`)—. Y **la cuenta estaba mal**: `updKPIs` hacía `gp = gf/f` (`:3924`) y `calcBEP` lo aplicaba como recargo sobre el costo, `p = c*(1+gp)` (`:3958`). Es exactamente el error que `utils/bep.js` documenta y corrige. **No se reintroduce** |
| **Equipo** | Dos piezas. **«Control de accesos»**, que vivía adentro de Gastos (`:2997-3007`, `:9973-10014`): una tarjeta por persona con su sucursal y **cinco interruptores** —editar observación de venta, eliminar ventas propias, editar fecha de venta, **ver KPIs y totales del día**, editar costos en inventario—. Y **«Sesiones activas»** (`:3070-3084`, `:10016-10088`): un modal con el dispositivo (celular o computadora, deducido del user-agent), el usuario, la hora de inicio, un badge «Este dispositivo», un botón «Cerrar» por sesión y un «Cerrar todas (menos yo)» |
| **Ajustes AFIP** | **No existía.** El legacy no facturaba electrónicamente: es «la razón de migrar» (`PLAN-COMPRAFIT.md`, sección 1) |

Dos cosas que esto cambia respecto de lo que dice el pedido:

- **El «margen mínimo» del legacy es un indicador de la pantalla de Gastos, no
  del Panel.** Comprafit lo miraba al lado de sus gastos fijos, con su
  facturación de referencia al lado. Ver [PENDIENTE N7].
- **Los permisos por persona son lo que Comprafit ya usaba**, y el modelo
  `UsuarioPermiso` existe para eso y no tiene endpoint. Ver [PENDIENTE N9].

### La maqueta

`docs/maqueta/Favalio-Rediseno.dc.html` dibuja **dos** de las cuatro. Las otras
dos caen en el bloque de stub. Verificado en `:1282`:

```js
isStub: !['panel','pos','ventas','inventario','compras','config'].includes(st.route),
```

| Pantalla | En la maqueta |
|---|---|
| **Panel de control** | **Dibujada entera** (`:219-334`): cuatro tarjetas de indicador con etiqueta, valor en mono de 26px, delta con flecha, **sparkline de doce barras** (`:247-251`, con `bars()` en `:1166-1169`) y una nota al pie; «Requiere tu atención» con contador en badge y cuatro filas de ícono + título + meta + acción (`:260-283`, datos en `:1178-1183`); «Actividad reciente» con hora en mono, punto de color, quién + qué e importe (`:285-301`, datos en `:1185-1192`); «Pendientes» (`:305-318`) y «Accesos rápidos» en grilla de 2×2 (`:320-330`). Más un selector «Últimos 30 días» y un botón «Exportar» (`:226-234`) |
| **Facturación AFIP** | **Dibujada entera** (`:686-789`): banner de estado en verde con CUIT, punto de venta, vencimiento del certificado y «Último CAE hace 12 minutos», con un botón **«Probar conexión»** (`:699-706`); **«Puesta en marcha»**, cuatro pasos numerados con su descripción y su acción (`:709-733`, datos en `:1373-1378`); **«Datos de facturación»** con CUIT, punto de venta, condición de IVA, **ambiente como dos botones** (`:755-761`), las dos credenciales como archivos con su metadato y un «Reemplazar» (`:762-774`), «Guardar y verificar» y **«Desvincular AFIP»** en rojo con su explicación (`:778-784`). Más cuatro solapas: «Facturación AFIP», «Empresa», «Equipo», «Suscripción» (`:1368`) |
| **Gastos** | **Es un stub.** El ítem existe en `ROUTES` como `'Gastos fijos'` (`:959`) y cae en el bloque genérico de `:791-802`: «Este módulo existe en el sistema y sigue el mismo patrón de pantalla. Todavía no forma parte del lote rediseñado» |
| **Equipo** | **Es un stub.** Ítem en `:962`, mismo bloque |

**Se anota como supuesto** (Assumptions 2 y 3) para que la verificación no busque
una referencia que no existe. El diseño de Gastos y de Equipo sale del texto de
las secciones 4.7 y 4.11, de los primitivos que la maqueta sí fijó y que
`REGLAS-DISENO.md` ya extrajo, y de la referencia viva, `pages/Comparador.jsx`.

**Y hay dos frases de la maqueta que hoy son falsas**, en la pantalla dibujada
que toca el material más sensible. Ver hallazgo A11.

---

## Hallazgos del relevamiento

Cincuenta y ocho: cuatro transversales, nueve de Gastos, dieciocho del Panel,
trece de Ajustes AFIP y catorce de Equipo. **Cada uno se verificó leyendo el
archivo en la línea citada**, y **el E1 se reprodujo ejecutándolo** contra el
express instalado en `apps/api`.

Lo que **no** entra está al final, en «Queda anotado, fuera de alcance», con su
motivo.

### Transversales

**T1. Las cuatro rutas declaran su módulo en el menú y ninguna lo exige en la
ruta.** `navegacion.js:42`, `:43`, `:49` y `:61` declaran `modulo: 'gastos'`,
`'panel'`, `'facturacion'` y `'equipo'`; `App.jsx:289-296` monta las cuatro sin
`RouteGuard`. Una empresa sin el módulo **no ve el ítem y entra escribiendo la
URL**, que es literalmente lo que el plan (sección 2) dice que no sirve, y lo
que ya pasó con `/proveedores`.

Está registrado como deuda con su motivo escrito
(`marcoDePantalla.test.js:160-190`), y el motivo **sigue valiendo**: cerrar cada
una exige mirar en producción qué empresas tienen ese módulo en
`enabled_modules`, porque una que no lo tenga pierde la pantalla y redirige a
`/pos`. **Cuatro revisiones de producción metidas en un commit de rediseño es
exactamente lo que esa deuda separa.** → **FR-001 a FR-004**, y ver
[PENDIENTE 6].

**T2. Ninguna de las cuatro está en `guardiasDeDiseno.test.js`.** La lista
`NOMBRES` (`:171-191`) tiene diecinueve archivos y no incluye
`pages/Expenses.jsx`, `components/GastosVariables.jsx`, `pages/Dashboard.jsx`,
`pages/Settings.jsx` ni `pages/Team.jsx`. Hoy, adentro de esos cinco archivos:

- **Los `Table*` de shadcn**: `Expenses.jsx:8` y doce usos; `GastosVariables.jsx:9`
  y diez usos; `Team.jsx:9-16`.
- **Las únicas dos reglas `dark:` del repositorio sin guardia**:
  `Dashboard.jsx:238`, `:242`.
- **Trece clases de la paleta de Tailwind**: `Dashboard.jsx:238`, `:242`, `:389`,
  `:391`, `:432`, `:463`, `:466`, `:470`, `:481`; `Settings.jsx:152`, `:154`,
  `:170`, `:321`. La propia guardia usa como ejemplo de hallazgo el texto
  `«L353: border-green-500/30»` (`:205-206`), que es literalmente lo que está en
  `Settings.jsx:321`.

**Entran a la lista antes de reescribirse, no después** (`REGLAS-DISENO.md:348-351`),
y el ancla `expect(ARCHIVOS).toHaveLength(19)` (`:366`) sube con ellas.
→ **FR-005 a FR-007**.

**T3. Ninguna de las cuatro usa `mensajeDeError`, y tres formatean plata por un
camino que la guardia no ve.**

El error, en tres formas distintas y a veces en el mismo archivo:

| Forma | Dónde | Qué ve el usuario |
|---|---|---|
| `err.message` de axios | `Expenses.jsx:56`, `:68`; `Settings.jsx:103`, `:128`; `Team.jsx:99`, `:109` | «Request failed with status code 400». **Los mensajes que el backend sí escribe** —«El certificado no es un PEM válido» (`afip.js:91`), «El certificado y la clave privada se cargan juntos» (`:124`)— **no llegan nunca** |
| `err.response?.data?.error` a mano | `Team.jsx:87`, `GastosVariables.jsx:60`, `:91`, `:105` | El código crudo: `checkPermission` responde `{error:'FORBIDDEN'}` (`middleware/checkPermission.js:40-43`) y el toast dice **«FORBIDDEN»**. Es `mensajeDeError` reimplementado sin su filtro de códigos de máquina (`erroresDeApi.js:57`) |
| `console.error` y nada | `Expenses.jsx:35`, `Dashboard.jsx:64`, `Team.jsx:65` | **Nada.** Un 403 por falta de `equipo.ver` renderiza «Sin miembros aún» (`Team.jsx:137-140`): un equipo vacío, no «no tenés permiso» |

Y el formateo. La guardia de `formato.test.js:313-330` busca **funciones
declaradas** (`pesos`, `formatCurrency`, `fechaDeHoy`) y `*FractionDigits`.
Ninguna de estas tres declara nada:

- `Expenses.jsx:135`, `:163` — `toLocaleString()` **sin locale**. En un navegador
  en inglés `1234.5` sale **«1,234.5»**: es exactamente el error que
  `CONVENCIONES.md` nombra —«leerlos al revés convierte $1.234 en $1,234 y no
  falla nada»— y el mismo caso que `pages/Recipes.jsx`, que sí está anotado en
  `formato.test.js:357`.
- `Dashboard.jsx:342`, `:343`, `:359`, `:360` — ídem, en la prosa del simulador
  de BEP. **La pantalla está en la lista `IMPORTAN` (`formato.test.js:424`)**: la
  migración se hizo en las tarjetas y no en el texto de abajo, y la guardia no
  lo vio.
- `GastosVariables.jsx:139`, `:238`, `:249` — `toLocaleString('es-AR')` con
  locale pero sin decimales fijos: `1234.5` sale «1.234,5» al lado de
  «1.234,50».
- `Team.jsx:208`, `:213` y `Settings.jsx:311` — `toLocaleDateString()` a mano.
- `Dashboard.jsx:481` — `new Date(item.expiration_date).toLocaleDateString()`
  sobre un `DATEONLY` que viaja como `'2026-08-15'`: `new Date()` lo lee como
  medianoche **UTC** y en Argentina muestra el día anterior. **Un lote que vence
  el 1 se muestra vencido el 31.** Es el bug que `fechaCorta` existe para evitar
  y que `formato.js:56-61` documenta.

→ **FR-008 a FR-013**.

**T4. Ninguna de las cuatro tiene un test de render, y tres no tienen ningún
test de su API.** Existen seis `renderDe*.test.jsx` y ninguno es de estas
pantallas. Del lado de la API: no hay `dashboardService.test.js` —**el servicio
con más aritmética de plata del backend es el único sin archivo de test
propio**—, no hay ningún test de `routes/afip.js`, no hay ningún test de gastos,
y **no hay un solo request de test contra las rutas de equipo**, que es
justamente por lo que el 404 del hallazgo E1 lleva ahí sin que nadie lo note.
`utils/bep.js` es la excepción: 20 casos y bien escritos. → **FR-014 a FR-016**.

### Gastos

**G1. Un gasto fijo «General» se dibuja bajo la sucursal equivocada, o no se
dibuja en ninguna, y sigue moviendo el punto de equilibrio.**

Tres piezas que solas no hacen nada y juntas pierden plata de vista:

```js
// models/FixedExpense.js:33
group: { type: DataTypes.STRING, defaultValue: 'gf1' }

// pages/Expenses.jsx:46-50 — el alta NUNCA manda `group`
await api.post('/expenses', { name, amount, punto_de_venta_id })

// pages/Expenses.jsx:72-82 — el agrupador del navegador
for (const pv of puntosDeVenta) {
  groups[pv.id] = {
    expenses: expenses.filter(e =>
      e.punto_de_venta_id === pv.id || e.group === 'gf' + puntosDeVenta.indexOf(pv)),
  }
}
groups['general'] = {
  expenses: expenses.filter(e => !e.punto_de_venta_id && !e.group?.startsWith('gf')),
}
```

`routes/general.js:331` solo completa `group` cuando viene `punto_de_venta_id`.
Entonces un gasto «General» se guarda con `group='gf1'` y:

- Queda **fuera** del bucket «General», porque `startsWith('gf')` es `true`.
- Matchea `'gf'+1` y aparece bajo la **segunda** sucursal de la lista, sumando a
  su tarjeta de total.
- **Con una sola sucursal, `'gf'+0` no matchea nada: el gasto no se dibuja en
  ninguna parte.** Comprafit migra con `scripts/migrar-legacy.js:379`, que
  escribe `'gf1'` y `'gf2'` con `punto_de_venta_id` nulo.

Y al revés: una fila con `punto_de_venta_id` **y** `group='gf1'` matchea las dos
ramas del `||` y **se cuenta dos veces** en las tarjetas.

Mientras tanto `dashboardService.js:47` y `cashflowService.js:27` suman
`FixedExpense` por `empresa_id` a secas: **el gasto que la pantalla no muestra
igual mueve el BEP y el flujo de caja.** → **FR-020 a FR-025**, y ver
[PENDIENTE 4].

**G2. El total de gastos por sucursal lo calcula el navegador, y el servidor no
manda ninguno.** `Expenses.jsx:127`:

```js
const total = group.expenses.reduce((s, e) => s + parseFloat(e.amount), 0)
```

`amount` es `DECIMAL(12,2)` y vuelve como string. Toda la aritmética es del
cliente, en float, sin redondeo final. Es lo contrario de lo que hace la API de
gastos variables, que suma en el servidor y redondea (`gastosVariables.js:75`), y
lo contrario de la regla de `CONVENCIONES.md`: «el total de una venta lo calcula
el servidor». → **FR-026, FR-027**.

**G3. La tarjeta de total de «General» no existe, y filtra por nombre.**
`Expenses.jsx:126`: `.filter(([_, g]) => g.name !== 'General')`. El bucket
General nunca tiene tarjeta, así que **la suma de las tarjetas no es el total de
gastos fijos**. Y filtra por el **nombre** del grupo: una sucursal que se llame
«General» también desaparece de los totales. → **FR-023**.

**G4. `punto_de_venta_id` llega del cuerpo sin validar que la sucursal sea de la
empresa, en cuatro lugares, y uno es mass assignment.**

```js
// routes/general.js:330 — POST /api/expenses
const data = { ...req.body, empresa_id: req.empresaId };
const expense = await FixedExpense.create(data);
```

Nadie resuelve la sucursal con `findScoped` antes. La FK de
`20260604-add-pv-to-fixed-expenses.js:8` apunta a `puntos_de_venta` y **no
incluye `empresa_id`**, así que la base acepta el id de una sucursal ajena: un
gasto propio colgado del punto de venta de otro cliente. Y el spread de
`req.body` deja pasar además `group` —lo que permite fabricar a mano el caso
doble de G1— y cualquier otra columna.

Los otros tres: `general.js:347-348` (el PUT descarta `empresa_id` e `id` y deja
pasar `punto_de_venta_id` y `group`), `gastosVariables.js:130` y `:150`.

**Por qué la guardia no lo ve.** `aislamientoEmpresas.test.js` tiene desde la
funcionalidad 012 el detector del «padre ajeno» (`:255-480`), que es
exactamente este patrón. Falla en las dos formas:

- Para `general.js:330`, `clavesForaneas` corre sobre el texto literal `(data)`
  y encuentra **cero** claves `*_id`, así que el `create` ni se cuenta.
- Para `gastosVariables.js:130`, la clave existe pero el valor es
  `punto_de_venta_id || null`, que no matchea `/^req\.(params|body|query)\./`.

Es la regla que este repositorio ya rompió treinta veces, con una forma nueva.
→ **FR-029 a FR-033**.

**G5. `PUT /api/expenses/:id` no lo llama nadie: un gasto fijo no se puede
corregir.** El endpoint existe, está bien scopeado (`general.js:342-353`), el
helper existe (`services/api.js:222`) y ningún componente lo importa. Para
corregir un importe mal tipeado hay que borrar el gasto y volver a crearlo.
El legacy lo editaba en línea. → **FR-034**.

**G6. El mes de los gastos variables se calcula en UTC.**
`GastosVariables.jsx:26`: `new Date().toISOString().slice(0,7)`. El 31 a las
21:30 hora argentina ya es el mes siguiente, así que el gasto que se carga esa
noche entra en el mes equivocado y desaparece de la vista del mes en curso. Es
el mismo defecto que `formato.js:184-195` documenta y que `fechaDeHoy` resuelve.
→ **FR-035**.

**G7. La pantalla ofrece acciones que la API rechaza.** `Expenses.jsx` no importa
`Can`: «Nuevo Gasto» (`:98`) y el botón de borrar (`:166`) se dibujan siempre.
El rol `gerente` tiene `gastos.crear` y `gastos.editar` pero **no
`gastos.eliminar`** (`seedPermissions.js:85`), así que ve un botón que siempre
devuelve 403. `GastosVariables.jsx:144` y `:252` **sí** usan `Can`: la asimetría
está adentro de la misma pantalla. → **FR-036**.

**G8. `GET /api/expenses` ignora la sucursal activa.** `general.js:311-321` no
aplica `req.puntoDeVentaId` como caída, a diferencia de `:33` y `:539`, y el
frontend nunca manda el parámetro (`Expenses.jsx:32`). La pantalla siempre trae
los gastos de todas las sucursales y los reparte en el navegador. **No es una
fuga** —`empresa_id` está—, pero es la causa de que el agrupado viva del lado
equivocado. → **FR-037**.

**G9. `cashflowService` suma los gastos fijos de todas las sucursales adentro
del balance de una.** `cashflowService.js:19-20` arma el scope con
`punto_de_venta_id` y `:27` suma `FixedExpense` con `{ empresa_id }` a secas.
**Se nombra y no se arregla acá**: es la pantalla de Caja, que está oculta para
el cliente (`PLAN-COMPRAFIT.md` 4.12) y no lleva pasada en esta etapa. Queda
anotado para que no se lea como decidido.

### Panel de control

**P1. «Por Pagar» nunca resta los pagos: solo puede crecer.**
`dashboardService.js:207-224`:

```js
const debts = await SupplierMovement.findAll({
  where: { empresa_id: empresaId, type: 'deuda' },
  attributes: [[fn('COALESCE', fn('SUM', col('amount')), 0), 'total'], 'due_date'],
  group: ['due_date'],
});
let totalPayable = 0;
for (const d of debts) totalPayable += parseFloat(d.total);
```

Solo `type: 'deuda'`. Hay **cuatro** implementaciones del mismo saldo en el
repositorio y ésta es la única rota:

| Dónde | Fórmula |
|---|---|
| **Panel** | `SUM(deuda)` |
| Proveedores | `deuda − pagado`, **en centavos enteros** (`utils/cuentaDeProveedor.js:75-93`, usado en `suppliers.js:351`) |
| Clientes | `SUM(deuda) − SUM(pago)` en SQL (`customerService.js:201-212`) |
| Caja | `totalSupplierDebts − totalSupplierPayments` (`cashflowService.js:138`) |

Pagarle a un proveedor **no baja el número del panel**. Y además acumula en
punto flotante (`:224`, `:231-237`), que es lo que
`cuentaDeProveedor.js:22-27` prohíbe por FR-050 —«`0.1 + 0.2` es
`0.30000000000000004` … una cuenta cancelada se convierte en una cuenta con
deuda, y no falla nada»— y que `utils/centavos.js` existe para resolver. El
`Math.round(x*100)/100` de `:241-246` tapa el residuo al mostrar, **después** de
las comparaciones de tramo de `:234-236`. → **FR-040 a FR-042**.

**P2. «Por Cobrar» y «clientes con deuda» cuentan como deuda las ventas de
contado.** `dashboardService.js:166-168`:

```js
const totalReceivables = await Sale.sum('total', {
  where: { empresa_id: empresaId, status: 'active', customer_id: { [Op.ne]: null } },
});
```

Falta `is_credit: true`. `customerService.js:64-66` lo tiene, con el comentario
que explica por qué: «Solo las ventas a cuenta corriente generan deuda. **Una
venta cobrada en el mostrador no es un saldo pendiente aunque tenga cliente
asignado**». Y `customerService.js:189` lo repite en el SQL de la pantalla de
Clientes.

Lo mismo en el contador de clientes con deuda (`:143-145`), que además compara
así (`:149`):

```js
if (parseFloat(salesTotal) > parseFloat(paymentsTotal)) withDebt++;
```

Dos `SUM` de DECIMAL comparados en float: un cliente que pagó **exactamente** lo
que debía puede quedar del lado equivocado por el residuo. → **FR-043, FR-044**.

**P3. El aging no puede cerrar con el total que tiene 40 píxeles más arriba.**
En la misma tarjeta (`Dashboard.jsx:237-275`): `receivables.total` es ventas
**menos** pagos (`dashboardService.js:172`), y los cuatro tramos son
`Sale.sum('total')` por fecha **sin restar un peso de pagos** (`:180-194`).
Los tramos suman lo **facturado**; el total suma lo **impago**. Nunca cierran.

`customerService._repartirPorAntiguedad` resuelve esto prorrateando el saldo
impago sobre la distribución temporal, y su docstring admite que es una
aproximación; el panel ni lo intenta. Lo que **sí** está bien resuelto acá es el
solapamiento de tramos: `:174-177` documenta que `Op.between` es inclusivo en
los dos extremos y por eso cada tramo es semiabierto. → **FR-045**.

**P4. Las ventas del día 1 se cuentan en el mes actual y en el anterior — y el
arreglo ya existe 130 líneas más abajo, en el mismo archivo.**

```js
// dashboardService.js:39-40
this._salesPeriod(firstOfMonth,     today,         empresaId),  // mes actual
this._salesPeriod(firstOfPrevMonth, firstOfMonth,  empresaId),  // mes anterior

// dashboardService.js:90
where: { ..., date: { [Op.between]: [from, to] } }
```

`Op.between` es inclusivo en los dos extremos: **`firstOfMonth` entra en los
dos**. Es literalmente el defecto que `:174-177` corrige para el aging, con su
comentario explicándolo, en el mismo archivo.

El porcentaje de crecimiento (`Dashboard.jsx:77-80`) hereda el error y además
compara un mes **parcial** contra uno **completo**: el día 3 del mes va a decir
−90 % siempre, y no lo aclara. → **FR-046, FR-047**.

**P5. El Panel corta por la fecha UTC del servidor; las ventas se guardan con la
fecha del negocio.** Seis lugares: `dashboardService.js:17-22`, `:162-164`,
`:218-221`, `:294`, más `general.js:451-452` y `cashflowService.js:15-17`. Todos
`new Date().toISOString().split('T')[0]`.

Del otro lado: `sales.js:115` y `:226` usan `hoyDelNegocio(req.empresaId)`, y
`sales.js:466` escribe la venta con `fechaDelNegocio(zona)`.
`utils/fechas.js:1-15` existe exactamente para esto y su encabezado lo dice:
«Argentina es UTC-3: a partir de las 21:00 hora local, UTC ya está en el día
siguiente … Eso corre el cierre de caja, el listado del día, los reportes por
período». `fechas.test.js:123-133` lo ancla.

**Entre las 21:00 y las 24:00 hora argentina, el corte de mes y el de 30 días del
Panel están un día adelante del que usa el historial de ventas.**
`filtroVentas.js:191-196` incluso *rompe a propósito* si la ruta no le pasa
`hoy`, «preferible a caer en la fecha del servidor, que es UTC y corre un día».
El Panel es el que cae ahí. → **FR-048**.

**P6. `dashboard.ver` abre el saldo de caja, las cuentas por cobrar y los gastos
fijos a los cinco roles.** `routes/dashboard.js:7` pide solo `dashboard.ver`,
que tienen `admin`, `gerente`, `vendedor`, `produccion` y `compras`
(`seedPermissions.js:86`, `:97`, `:103`, `:109`). La respuesta incluye:

- `cashflow.balance` y `projected_30d` — que `GET /api/cashflow/balance` protege
  con `caja.ver` (`routes/cashflow.js:7`).
- `receivables` y `customers.with_debt` — que `GET /api/customers/summary`
  protege con `clientes.ver` (`routes/customers.js:29`).
- `fixed_expenses` y `payables`.

Los roles `produccion` y `compras` **no tienen `caja.ver` ni `clientes.ver`** y
leen los tres abriendo el Panel. `permisosDeRutas.test.js` verifica que cada ruta
declare *algún* permiso, no que sea el correcto, y su propio comentario advierte
que degradar a `dashboard.ver` es justamente la mutación que no ve (`:48-52`).
→ **FR-049, FR-050**, y ver [PENDIENTE 5].

**P7. El simulador arranca con dos números inventados, y no lo dice.**
`Dashboard.jsx:49-50`:

```js
const [targetSales, setTargetSales] = useState(settings.target_sales || 7000000)
const [fixedExpenses, setFixedExpenses] = useState(settings.fixed_expenses_total || 2400000)
```

- **`target_sales` no existe en ningún default**: no está en `useStore.js:19-28`,
  ni en `setup.js:22-31`, ni en `empresas.js:100-102`. La meta de ventas es
  **siempre** el literal 7.000.000.
- **`fixed_expenses_total` tiene default `0`** (`useStore.js:23`, `setup.js:26`),
  que es falsy: toda empresa que no lo haya cargado arranca con **$2.400.000
  inventados**.

`utils/bep.js` está bien; **lo que entra está mal**. El simulador recomienda
precios a partir de datos que no son de la empresa, con la misma cara con la que
mostraría los reales. Es la familia del error que `CONVENCIONES.md` cita
primero. → **FR-051 a FR-053**.

**P8. Dos «gastos fijos» distintos en la misma pantalla.** La tarjeta de
`Dashboard.jsx:280` muestra `kpis.fixed_expenses` —la suma real de
`FixedExpense` (`dashboardService.js:47`)— y el simulador de `:313-318` usa
`settings.fixed_expenses_total`, un valor escrito a mano. Nada los concilia:
**pueden mostrar dos números distintos con la misma etiqueta a cuarenta píxeles
de distancia**, y el de abajo es el que decide el precio. → **FR-054**.

**P9. Un 403 en `/alerts` vacía el Panel entero, en silencio.**
`Dashboard.jsx:56-68` pide los dos endpoints en un `Promise.all` y el `catch` es
`console.error('[Dashboard]', err)`. Como `/alerts` pide `stock.ver`
(`general.js:448`) y `/kpis` pide `dashboard.ver`, **un rol con uno y sin el otro
rechaza la promesa**: `setKpis` y `setAlerts` se saltean y el panel se dibuja
entero con `kpis = null` —seis tarjetas en `-` y `0`— sin un solo cartel que
diga que algo falló. Un panel que dice «$0 por cobrar» porque no pudo preguntar
es peor que uno que no carga. → **FR-055, FR-056**.

**P10. «Stock bajo» del Panel no es el de Inventario ni el de Faltantes, y eso
está escrito.** El Panel y `/api/alerts` exigen `min_stock > 0`
(`dashboardService.js:258`, `:276`; `general.js:461-462`): **un producto en cero
sin mínimo cargado no alerta nunca**. Faltantes e Inventario usan
`utils/stockBajo.js`, que cae a un umbral de 3 unidades cuando el mínimo no está
cargado, y además filtra `is_active` y respeta la sucursal.

La divergencia es **deliberada y está documentada** en tres lugares
(`apps/api/src/utils/stockBajo.js:9-30`, `apps/web/src/utils/stockBajo.js`,
`utils/inventario.js:209-216`), como riesgo 6 del plan: «Inventario va a mostrar
más productos en stock bajo que el panel de control, y es a propósito».

**Lo que cambia acá es que el pedido pone «faltantes» adentro de «Requiere tu
atención».** Un aviso que diga «7 productos por debajo del mínimo» y lleve a una
pantalla que muestra doce es el defecto que esta funcionalidad viene a evitar.
La divergencia deja de ser tolerable cuando el Panel **enlaza** a la pantalla que
la contradice. → **FR-057**, y ver [PENDIENTE 3].

**P11. `kpis.alerts` se calcula, se manda y se tira.**
`dashboardService.js:77-80` devuelve `alerts.low_stock` y `alerts.expiring`
(top 5 cada uno), y la pantalla dibuja `alerts.lowStock`/`alerts.expiringStock`,
que vienen del **otro** endpoint, sin límite y con otro criterio. Dos consultas
por request a la basura, y dos versiones del mismo aviso en el mismo payload.
→ **FR-058**.

**P12. «Saldo Caja» ignora la sucursal seleccionada.**
`dashboardService.js:42` llama a `cashflowService.getBalance(empresaId)` sin
punto de venta; `routes/cashflow.js:9` lo llama con
`req.puntoDeVentaId || null`. `getBalance` acepta el parámetro y lo aplica
(`cashflowService.js:14`, `:19-20`). Con una sucursal seleccionada en la
cabecera, **la pantalla de Caja muestra el saldo de esa sucursal y el Panel el de
la empresa entera, bajo la misma etiqueta**. Lo mismo con «Ventas 30d» contra el
historial, que sí filtra por sucursal (`filtroVentas.js:223-226`).
→ **FR-059**, y ver [PENDIENTE N2].

**P13. «Proy. 30d» esconde un supuesto de crecimiento del 10 %.**
`cashflowService.js:105-109` aplica un `FACTOR_CRECIMIENTO = 1.1` fijo. El
servicio **lo devuelve explícito** en `supuesto_crecimiento` (`:123`), y el
comentario `:98-104` explica que antes se colaba adentro de un campo rotulado
como dato histórico. `Dashboard.jsx:133-137` dibuja el número bajo «Proy. 30d» y
**no lee `supuesto_crecimiento`**: el usuario ve un número 10 % inflado sin
saberlo. → **FR-060**.

**P14. Las ventas anuladas se cuentan distinto en cada pantalla, y dos de esas
pantallas son la misma.**

| Pantalla | ¿Cuenta anuladas? | Dónde |
|---|---|---|
| Panel, «Ventas 30d» y «mes» | **No** (`status:'active'`) | `dashboardService.js:90`, `:105` |
| Historial de ventas, total del período | **Sí, a propósito** | `sales.js:143` + comentario `:140-142` |
| Reports, pestaña **Ventas** | **Sí** — no hay `status` en el `where` | `reports.js:25` |
| Reports, pestaña **Rentabilidad** | **No** | `reports.js:131`, `:156` |
| Caja | **No** | `cashflowService.js:24`, `:68` |

`reports.js:25` y `:131` están **en el mismo archivo y alimentan la misma
pantalla**, y no coinciden. Existe `utils/estadoVenta.js`, cuyo encabezado dice
que «el badge de la fila, la columna Estado del archivo exportado y **lo que
cuente el panel de control** tienen que decir lo mismo»; el Panel no lo importa.

**Reports queda oculto para el cliente** (`PLAN-COMPRAFIT.md` 4.12), así que su
mitad no entra acá; lo que sí entra es que **el Panel y el Historial digan lo
mismo**, porque el cliente ve las dos. → **FR-061**.

**P15. «Ventas 30d» del Panel y «Ventas» de Reports se calculan sobre bases
distintas.** El Panel suma `sales.total` —la cabecera del comprobante, con
descuentos y recargos aplicados (`dashboardService.js:87`)—; `/reports/sales`
recalcula `quantity * unit_price` línea por línea en JavaScript
(`reports.js:57`); `/reports/profit` vuelve a la cabecera (`:130`). **Se nombra y
no se arregla**, por el mismo motivo que P14: Reports está oculto. Queda anotado
para que no se lea como decidido.

**P16. `_customerStats` es un N+1 sin techo.** `dashboardService.js:139-152`:
dos `SUM` **por cada cliente activo con ventas**, secuenciales dentro de un
`for`. Con 500 clientes son 1.000 consultas en serie en cada carga del Panel. El
mismo problema está anotado como `TODO(perf)` en `customerService.js:319-320`, y
`suppliers.js:307-311` ya lo resolvió con tres `GROUP BY` fijos. **Entra solo si
la corrección de P2 pasa por ahí**, que es lo probable: el filtro de `is_credit`
hay que ponerlo en ese mismo loop. → **FR-062**.

**P17. Dos `include` de `Product` sin filtrar, y la guardia no los puede ver.**
`dashboardService.js:279` y `:300`, más `general.js:464` y `:475`. `Product`
tiene `empresa_id` y ninguno de los cuatro lo filtra. El padre (`Stock`) sí está
scopeado, así que hace falta una fila de stock de A apuntando a un producto de B
para que fugue. Lo relevante es que **la guardia no lo puede ver**:
`esHijoConEmpresa` (`aislamientoEmpresas.test.js:541-544`) solo clasifica
`HasMany`/`HasOne`, y `Stock.product` es un `belongsTo`. La excepción está
escrita en `:874-877`. → **FR-063**.

**P18. `Dashboard.jsx:41-44` crea un `AbortController` y nunca le pasa la señal a
nadie.** Código muerto: la protección real la da `useIsMounted` (`:60`, `:66`).
Se nombra porque un `AbortController` que parece estar cancelando y no cancela
es peor que no tenerlo.

### Facturación AFIP

**A1. `GET /api/settings` devuelve la clave privada de AFIP en claro, y esta
pantalla es la que la pide.** `routes/general.js:394-398`:

```js
settings.forEach((s) => {
  if (s.value === null || s.value === '') return;
  obj[s.key] = s.value;          // ← acá entran afip_cert y afip_key
});
```

**No hay ninguna lista de exclusión.** El bucle copia todas las filas de
`settings`, y `afip_cert` y `afip_key` viven ahí (`routes/afip.js:143-146`).

Que es un olvido y no una decisión lo prueba el script de backup, que **sí** la
tiene:

```js
// apps/api/scripts/backup.js:59
const SETTINGS_EXCLUIDOS = ['afip_cert', 'afip_key', 'tiendanube_access_token'];
```

**Y es esta pantalla la que lo dispara.** `Settings.jsx:43-56` llama a
`GET /settings` al montar. El comentario de `Settings.jsx:34-42` dice: «El
certificado y la clave NO se traen: son material sensible y no tiene sentido
devolverlos al navegador». Eso describe lo que hace **el componente** —solo lee
`afip_cuit`, `afip_pv`, `afip_environment` y `tax_condition`—, no lo que hace la
**respuesta HTTP**.

Peor: `store/useStore.js:47-58` hace `initialize()` con el mismo endpoint y
mezcla la respuesta entera en el store global. **La clave privada RSA de
facturación queda en el estado global de la aplicación**, legible desde la
consola del navegador, en el network tab, en cualquier proxy del camino y en la
caché. Punto a favor: `useStore` no usa `persist` ni `localStorage`, así que no
queda en disco.

Alcanza `config.ver`, que tienen `admin` y `gerente`
(`permisosDeRutas.test.js:851` lo fija por igualdad exacta). **Cualquier gerente
se lleva la clave de facturación de la empresa con un solo GET.**

Es el mismo material que la funcionalidad 013 protegió con FR-075: «el token NO
DEBE salir en ninguna respuesta de la API, ni entero ni parcial». Acá el secreto
es peor —es material fiscal— y sale entero. → **FR-070 a FR-074**.

**A2. `GET /api/settings/afip_key` devuelve el PEM crudo.**
`routes/general.js:418-431` acepta cualquier clave y devuelve `setting.value`.
Mismo permiso, mismo alcance. Es el segundo camino y hay que cerrar los dos: la
lista de exclusión va en un solo lugar y la usan los tres endpoints.
→ **FR-071**.

**A3. `PUT /api/settings/:key` es la puerta trasera del setup de AFIP.**
`routes/general.js:434-445` acepta **cualquier** clave con `config.editar` y
saltea todo lo que `POST /afip/setup` construyó:

| `POST /afip/setup` | `PUT /settings/:key` |
|---|---|
| Valida el PEM del certificado (`afip.js:87-93`) | No valida nada |
| Valida el PEM de la clave (`:95-101`) | No valida nada |
| Exige cert y key **juntos** (`:121-126`) | Se puede escribir uno solo |
| Valida `environment ∈ {homologation, production}` (`:78-83`) | Acepta cualquier string |
| **Invalida el cache del ticket WSAA** (`:151`) | **No lo invalida** |

Lo último es lo que muerde: un `PUT /api/settings/afip_environment` con
`"production"` cambia el entorno **dejando cacheado en memoria el ticket WSAA
emitido contra homologación**. Y un `PUT /api/settings/afip_cert` puede dejar
guardado un PEM corrupto, que es justo el caso que el comentario de
`afip.js:85-86` dice haber cerrado. → **FR-072, FR-075, FR-076**.

**A4. `POST /api/afip/invoice` emite un comprobante fiscal real, sin venta, con
el permiso de un cajero.** `routes/afip.js:200-220`:

```js
router.post('/invoice', checkPermission('ventas.crear'), async (req, res) => {
  const { type, amount, customerCuit, pv, customerVatCondition } = req.body;
  const result = await afipService.createVoucher({ type, pv, amount, ..., empresaId: req.empresaId });
```

`ventas.crear` lo tiene el rol `vendedor` (`seedPermissions.js:92-98`). `type`,
`amount` y `pv` salen del cuerpo, sin comparar `pv` contra `settings.afip_pv`.
**No crea ninguna `Sale`**: reintroduce exactamente el «CAE huérfano» que
`POST /api/sales/:id/facturar` fue creado para eliminar
(`AUDITORIA-AFIP.md:80-92`, comentario largo en `sales.js:893-927`). Y no mira
el entorno.

El frontend **no lo llama**. Es el endpoint del botón «Emitir Factura de Prueba
(1 ARS)» que salió del punto de venta en la funcionalidad 011:
`PROXIMOS-PROYECTOS.md:160-163` lo dice —«El endpoint sigue existiendo: lo único
que se sacó es el botón»— y `:150` dice qué hacer con él: si se mudara a esta
pantalla, «**debería emitir solo en homologación y estar deshabilitado con su
motivo cuando `afip_environment` sea `production`**, porque hoy no lo está».
→ **FR-077, FR-078**, y ver [PENDIENTE N12].

**A5. «Probar conexión» no prueba la conexión de esta empresa, y la pantalla lee
mal la respuesta.** Dos defectos apilados:

```js
// services/afipService.js:114-122
async getStatus(empresaId) {
  const client = await this.getClient(empresaId);
  return new Promise((resolve, reject) => {
    client.FEDummy((err, result) => { ... });   // ← sin parámetro Auth
  });
}
```

`FEDummy` **no lleva credenciales**: contesta si los servidores de AFIP están
arriba, y nada más. **Responde OK con el certificado vencido, con la clave
equivocada, o sin ningún certificado cargado.**

Y del otro lado, `Settings.jsx:82` hace `setAfipStatus(res.data)` cuando la API
responde `{ ok: true, data: status }` (`afip.js:34`); el render (`:341`) evalúa
`afipStatus.error`, que en una respuesta exitosa **no existe nunca**. Resultado:
la pantalla dice **«Conectado: API operativa» siempre**, sin mirar los tres
campos `AppServer`/`DbServer`/`AuthServer` que el `FEDummy` devuelve.

La maqueta dibuja encima un banner verde que dice «Conectado a AFIP · Ambiente
de producción» (`Favalio-Rediseno.dc.html:702`). **Un banner verde sobre un
`FEDummy` es la afirmación más cara que puede hacer esta pantalla**, y hoy sería
falsa. → **FR-079 a FR-082**.

**A6. El circuito nunca se probó contra homologación, y no hay forma de saber si
alguien lo probó.** No hay columna, ni setting, ni flag, ni test de integración
contra AFIP —los diez archivos de `src/tests/integracion/` no lo mencionan—, ni
CUIT de homologación en el código. Está escrito en tres lugares:
`AUDITORIA-AFIP.md:223-233`, `PROXIMOS-PROYECTOS.md:124-134` y
`PLAN-COMPRAFIT.md:355` («Nunca se hizo»).

**Y el pedido pone «prueba en homologación hecha» como el cuarto ítem del
checklist.** Un checklist con un ítem que no se puede marcar porque no hay dónde
guardarlo no es un checklist. Es el hallazgo que define el alcance de esta
pantalla. → **FR-083 a FR-086**, y ver [PENDIENTE 2].

**A7. No se valida que el certificado y la clave sean pareja, ni que el CUIT del
certificado coincida con el configurado.** `afip.js:87-101` valida cada PEM por
separado. `AUDITORIA-AFIP.md:215-217` lo tiene anotado: «Hoy se aceptan por
separado y el error aparece recién al firmar, como *"Error al firmar el ticket
de acceso"*».

`GET /afip/cert-info` ya devuelve el CUIT del certificado (`afip.js:62`) y la
pantalla ya lo muestra (`Settings.jsx:310`): **el dato para comparar está y nadie
lo compara**. → **FR-087, FR-088**.

**A8. No hay ningún aviso de vencimiento del certificado.** Los certificados de
ARCA duran dos años. `GET /afip/cert-info` devuelve `validTo` y `validFrom`;
`Settings.jsx:311` pinta `validTo` con `toLocaleDateString()` y nada más — sin
«vence en N días», sin badge, sin nada. `AUDITORIA-AFIP.md:212-213`: «El día que
vence, el comercio deja de poder facturar sin entender por qué».

La maqueta lo dibuja resuelto: «Vence el 14/03/2028 · **595 días restantes**»
(`Favalio-Rediseno.dc.html:1381`). → **FR-089, FR-090**.

**A9. El punto de venta de ARCA no se valida y no tiene relación con las
sucursales.** `POST /afip/setup` valida el enum de ambiente y el de condición
fiscal (`afip.js:78`, `:103`) y **no valida `pv`**: acepta cualquier entero. No
hay ninguna llamada a `FEParamGetPtosVenta` en el repositorio.

Y `puntos_de_venta` no tiene columna con el número fiscal: `sales.js:840-848` lo
dice —«una empresa con dos locales comparte numeración correlativa entre
ambos»—. **Es el proyecto 5b de `PROXIMOS-PROYECTOS.md` y no entra acá**;
Comprafit tiene una sucursal. Lo que sí entra es **validar el número contra AFIP
al guardarlo**, que es el paso que evita descubrir el error con el primer
comprobante. → **FR-091**, y ver [PENDIENTE N11].

**A10. Los mensajes que el backend sí escribe no llegan nunca al usuario.**
`Settings.jsx:103` y `:128` muestran `err.message` de axios. Del otro lado,
`POST /afip/setup` devuelve textos escritos para una persona: «El certificado no
es un PEM válido», «La clave privada no es un PEM válido», «El certificado y la
clave privada se cargan juntos», «Cargá el CUIT de la empresa antes de generar
el pedido de certificado». **Ninguno se muestra.** El usuario ve «Error al
guardar: Request failed with status code 400» en la pantalla donde más importa
saber qué salió mal. → **FR-092**.

**A11. La maqueta y la guía afirman que la clave se cifra y que queda en el
servidor. Las dos cosas son falsas.**

| Dónde | Qué dice | Realidad |
|---|---|---|
| `Favalio-Rediseno.dc.html:730` | «Las llaves privadas se guardan **cifradas en el servidor** y nunca se muestran completas» | Texto plano en `settings.value` (`models/Setting.js:30-33`). No hay cifrado en ningún lado del repositorio |
| `Favalio-Rediseno.dc.html:1380` | «favalio_privada.key · Cargado el 14/03/2026 · **cifrado en servidor**» | Ídem |
| `Favalio-Rediseno.dc.html:1374` | «Se crean el archivo .key (secreto, **queda en el servidor**) y el .csr» | `afipService.js:358-364` **devuelve la clave al navegador** y no la guarda. La advertencia del propio servicio lo dice: «Guardá la clave privada: **no queda almacenada en el servidor** y sin ella el certificado no sirve» |
| `docs/GUIA_AFIP.md:14` | «El sistema te entregará un archivo `.csr` y **guardará la clave privada de forma segura**» | Ídem |
| `docs/GUIA_AFIP.md:45` | «**El sistema cifra tu clave privada.**» | Falso |
| `Settings.jsx:233-241` | «Tus llaves privadas se almacenan de forma segura en tu servidor» | Falso hoy, en los dos sentidos |

**Copiar la maqueta acá es escribir en la pantalla una propiedad de seguridad
que el sistema no tiene.** Es la misma familia que `sendEmail` devolviendo
`ok: true`: el sistema afirma algo que no ocurrió, en el lugar donde el usuario
decide si confiar. Y es peor que en el caso de las invitaciones, porque lo que
está en juego es si el cliente considera seguro subir su material fiscal.

La respuesta correcta **no es cifrar acá** —eso es el proyecto 6 de
`PROXIMOS-PROYECTOS.md`, y se hace para AFIP y TiendaNube juntos, como decidió
la funcionalidad 013 (FR-077)— sino **decir la verdad**: qué se guarda, dónde, y
qué protección tiene hoy. Y arreglar A1, que es la parte que sí depende de esta
funcionalidad. → **FR-093 a FR-096**.

**A12. Desde `/facturacion` no se ve ni se reintenta una venta sin CAE.** El
endpoint existe, es idempotente y tiene lock (`sales.js:928`), y se usa desde
`InvoicesList.jsx:427` y `Billing.jsx:483`. La pantalla que configura la
facturación no dice cuántos comprobantes quedaron sin CAE. La maqueta pone ese
aviso en el Panel («1 comprobante rechazado por AFIP · Reintentar»,
`:1179`), no acá. → **FR-097**, y ver [PENDIENTE N10].

**A13. `Settings.jsx` tiene tres defectos menores del manejo de archivos.**
`downloadFile` (`:107-116`) no llama a `URL.revokeObjectURL`; los dos
`<input type="file">` (`:287`, `:294`) no declaran `accept` ni límite de tamaño;
y `config.cert`/`config.key` **no se limpian después de guardar** (`:118-130`),
así que la clave privada queda en el estado de React hasta que se recargue la
página. → **FR-099**.

### Equipo

**E1. Aceptar una invitación devuelve 404. Siempre. Desde que existe.**
`server.js:422-423`:

```js
app.get('/api/auth/invite/:token', require('./routes/auth'));
app.post('/api/auth/accept-invite/:token', ...authSinEmpresa, require('./routes/auth'));
```

Un `Router` montado con `app.get`/`app.post` **no recibe el `req.url`
recortado** —eso lo hace `app.use`—, así que las rutas internas
`router.get('/invite/:token')` (`routes/auth.js:59`) y
`router.post('/accept-invite/:token')` (`:8`) se comparan contra
`/api/auth/invite/abc` y no matchean.

**Reproducido** con el express instalado en `apps/api` (5.2.1), montando
exactamente esas dos líneas:

```
GET  /api/auth/invite/abc123        -> 404
POST /api/auth/accept-invite/abc123 -> 404
```

**Por qué ninguna guardia lo vio**: `permisosDeRutas.test.js:73-86` y
`aislamientoEmpresas.test.js:246` leen el **texto** de `server.js` y ven un
router montado con su cadena; no hacen requests. Y no hay un solo test de
integración contra `/api/auth`. Es exactamente lo que `CONVENCIONES.md` dice del
cuarto nivel: una guardia estática ve que se llamó, no que haya funcionado.
→ **FR-100 a FR-103**.

**E2. El enlace del mail apunta a una ruta que no existe.**
`services/email.js:90`: `const acceptUrl = \`${frontendUrl}/accept-invite/${token}\``.
En `App.jsx:275-304` **no hay ninguna `<Route path="/accept-invite/...">`**. Lo
único que la aplicación lee es el query param `?invite=` (`App.jsx:132-138`).
Quien haga clic en el mail cae en una ruta sin match: `<main>` vacío y el token
nunca se guarda. → **FR-104**.

**E3. `Team.jsx:85` dice «Invitación enviada» siempre.**

```js
await api.post(`/empresas/${empresaActiva.id}/invitar`, { email, role })
setShowInviteDialog(false)
...
toast.success('Invitación enviada')
```

Del otro lado, `routes/empresas.js:687-694` devuelve `email_enviado: envio.ok` y,
cuando el mail no salió, `message: 'La invitación se creó pero no se pudo enviar
el email. Pasale el enlace de invitación a mano.'` — más un `logger.warn` con el
`requestId` y el id de la invitación.

**La pantalla no lee ninguno de los dos.**

`CONVENCIONES.md` cita `sendEmail` entre los tres errores más caros del
proyecto: «devolvía `ok: true` sin haber enviado nada. Las invitaciones se
perdían en silencio y quien invitaba veía "enviada"». **El servicio ya está
arreglado y tiene su test** (`services/email.js:34-63`,
`tests/observabilidad.test.js:125-144`). Lo que quedó es que **la mitad de la
corrección que llega al usuario no se hizo**: el agujero se mudó de
`services/email.js` a `pages/Team.jsx:85`.

Y no hay salida de emergencia: `POST /invitaciones/:token/re-enviar` existe y
devuelve 502 honesto cuando el mail falla (`empresas.js:716-727`), pero
**la pantalla no tiene botón de reenviar** y `services/api.js:402-410` no
declara el helper. **Nadie llama a ese endpoint.** → **FR-105 a FR-108**.

**E4. El fallo de la aceptación se descarta en silencio.** `App.jsx:140-152`:

```js
api.post(`/auth/accept-invite/${token}`)
  .then(() => { localStorage.removeItem('pendingInvite'); loadEmpresaContext() })
  .catch(() => { localStorage.removeItem('pendingInvite') })
```

El `catch` **borra el token**. Con E1, ese `catch` se ejecuta siempre: el intento
falla, el token se tira, y no se reintenta nunca ni se dice nada. Es el tercer
eslabón de la misma cadena. → **FR-108**.

**E5. Se puede dejar la empresa sin ningún admin, y uno puede degradarse a sí
mismo.** `routes/empresas.js:788-798`:

```js
router.put('/usuarios/:id', requireEmpresa, checkPermission('config.editar'), async (req, res) => {
  const { role, is_active } = req.body;
  const ue = await UsuarioEmpresa.findOne({ where: { id: req.params.id, empresa_id: req.empresaId } });
  if (!ue) return res.status(404)...;
  await ue.update({ role, is_active });
```

El scoping está bien. Lo que no hay es **ningún chequeo de «último admin» ni de
«soy yo»**. Nada impide:

- Degradar al único `admin` a `vendedor`: la empresa queda sin nadie con
  `config.editar` ni `equipo.invitar`. **Nadie puede volver a promover a nadie ni
  invitar.** Solo se sale a mano en la base, o con un superadmin.
- `is_active: false` sobre el único admin: lo mismo, agravado —
  `loadEmpresaContext` filtra por `is_active: true` (`middleware/auth.js:196-200`),
  así que ese usuario pierde la empresa del selector.

Y la pantalla lo facilita: el `Select` de rol se dibuja en **todas** las filas,
incluida la propia (`Team.jsx:152-170`), sin `disabled` y sin confirmación. El id
que necesita es el mismo que la UI ya tiene a mano (`Team.jsx:159`).
→ **FR-109 a FR-112**.

**E6. `POST /invitaciones/:token/re-enviar` no lleva `requireEmpresa` ni
scoping.** `routes/empresas.js:701-707`:

```js
router.post('/invitaciones/:token/re-enviar', checkPermission('equipo.invitar'), async (req, res) => {
  const invitacion = await Invitacion.findOne({
    where: { token: req.params.token, status: 'pending' },
    include: [{ model: Empresa, as: 'empresa' }],
  });
```

`where` **sin `empresa_id`** e `include` de `Empresa` **sin filtrar**. Es la
única ruta de equipo fuera del patrón: las otras seis llevan `requireEmpresa` y
`requireEmpresaPropia` o `findScoped`.

El impacto está acotado —el mail va a `invitacion.email`, el destinatario
legítimo— pero cualquiera con `equipo.invitar` en su empresa y un token ajeno
dispara un envío a costa de otro tenant y **confirma que ese token existe**. Es
la regla que no se negocia, con una forma nueva. → **FR-114**.

**E7. `GET /:empresaId/usuarios` devuelve `auth0_sub` y `es_superadmin`.**
`routes/empresas.js:751-754`: `include: [{ model: Usuario, as: 'usuario' }]`, sin
`attributes`. Devuelve la fila entera de `Usuario` (`models/Usuario.js:10-45`).
Contrastar con `:633`, donde el `include` del invitador **sí** limita a
`['id','nombre','email']`.

Con `equipo.ver` —que tiene también `gerente`— se leen los identificadores
internos de Auth0 de todo el equipo y quién es superadmin de la plataforma.
→ **FR-115**.

**E8. Cambiar el rol de un miembro pide `config.editar` y no `equipo.*`.**
`routes/empresas.js:788`. «Editar la configuración de la empresa» y «cambiar el
rol de una persona» no son lo mismo, y el catálogo tiene `equipo.ver`,
`equipo.invitar` y `equipo.eliminar` pero **no `equipo.editar`**
(`seedPermissions.js:62-64`). El resultado práctico es que solo `admin` puede
hacerlo —`config.editar` no lo tiene `gerente`—, lo cual puede estar bien; lo que
está mal es que el permiso no diga lo que hace. `permisosDeRutas.test.js` no
verifica cuál es. → **FR-116**, y ver [PENDIENTE N9].

**E9. `ROLE_LABELS` no tiene `gerente`.** `Team.jsx:37-42` lista
`admin/vendedor/produccion/compras`. `gerente` existe en el seed
(`seedPermissions.js:126`) y en la migración
`20260605-add-gerente-to-usuario-empresas-role.js`. Un gerente aparece en la
tabla con el `Select` en valor vacío, y si el admin lo toca **solo puede
degradarlo** a uno de los cuatro listados. Es el mismo defecto que `tc3` en los
comprobantes, que `REGLAS-DISENO.md:466-467` cita: agregar un estado sin su
etiqueta dibuja el código crudo. → **FR-117**.

**E10. La columna «Estado» está clavada en «Activo».** `Team.jsx:171-175` pinta
un `CheckCircle` verde y la palabra «Activo» en **todas** las filas: **ni
siquiera lee `m.is_active`**. Un miembro desactivado se ve idéntico a uno activo.
→ **FR-118**.

**E11. `POST /:empresaId/usuarios` incorpora a alguien sin invitación y sin
validar el rol.** `routes/empresas.js:763-779`. Está scopeado a la empresa propia
(bien), pero:

- **No valida `role`** contra el catálogo. `UsuarioEmpresa.role` es un
  `STRING(20)` libre (`models/UsuarioEmpresa.js:18-22`) y el hook `beforeCreate`
  (`:46-52`) solo asigna `rol_id` si el nombre existe en `Rol`. Un rol mal
  escrito crea un **miembro con cero permisos, sin ningún aviso**.
- Incorpora por `auth0_sub` **sin invitación ni consentimiento**, salteando todo
  el flujo de `Invitacion`.
- **No lo usa nadie**: ni la UI ni `services/api.js`.

Superficie sin llamador. → **FR-119**, y ver [PENDIENTE N13].

**E12. La pantalla no tiene forma de sacar a nadie del equipo.** No hay endpoint
de «eliminar miembro»: `equipo.eliminar` solo se usa para revocar invitaciones
(`empresas.js:736`). Desactivar es `PUT /usuarios/:id` con `is_active:false`, que
pide `config.editar`, y **`Team.jsx` no expone ninguna de las dos cosas**.
→ **FR-113**.

**E13. Sesiones activas y último acceso: no existe absolutamente nada.**
`usuarios` tiene cinco columnas (`models/Usuario.js:4-51`) y `usuario_empresas`
nueve (`models/UsuarioEmpresa.js:4-42`); ninguna es de acceso. No hay tabla de
sesiones, ni de auditoría, ni de refresh tokens. La sesión es de Auth0 del lado
del cliente y la API es stateless.

Lo único reutilizable: `loadEmpresaContext` (`middleware/auth.js:107-124`) ya
toca la fila del usuario en **cada request** y ya hace un `update` condicional en
`:121`. Y `middleware/requestId.js` da la traza.

Lo que el legacy mostraba —y es la vara— está en `:10044-10061`: dispositivo
(celular o computadora, deducido del user-agent), usuario, hora de inicio, badge
«Este dispositivo», «Cerrar» por sesión y «Cerrar todas (menos yo)». **Cerrar una
sesión ajena es lo que el último acceso por usuario no puede hacer**, y es la
mitad de la funcionalidad del legacy. → **FR-121 a FR-124**, y ver
[PENDIENTE 1].

**E14. Invitar a alguien no crea nada en Auth0, y nada lo explica.**
`middleware/auth.js:107-122` crea el `Usuario` **just-in-time desde el JWT**; no
hay Management API en el repositorio. La persona invitada tiene que registrarse
por su cuenta **con exactamente ese email**, porque `routes/auth.js:13-20`
matchea `email: usuario.email`. Si se registra con Google usando otro alias, o si
Auth0 no devuelve email y se le asigna el `...placeholder` de
`middleware/auth.js:112`, **la invitación no se puede aceptar nunca** y no hay un
solo mensaje que lo diga. → **FR-125**.

### Queda anotado, fuera de alcance

**Cifrar la clave privada de AFIP en reposo.** Es la sección 6 de
`PROXIMOS-PROYECTOS.md` y la funcionalidad 013 ya tomó la decisión coherente
(FR-077): se hace para AFIP y TiendaNube **juntos**, o no se hace. Cifrar uno
solo deja el otro sin proteger y agrega dos mecanismos para el mismo problema.

Lo que **sí** exige esta funcionalidad, y es la parte que sí depende de ella:
**cerrar A1, A2 y A3, y no afirmar que está cifrada** (A11).

**Probar el circuito AFIP en homologación.** Es el proyecto 2 de
`PROXIMOS-PROYECTOS.md` y **no es código**: es una verificación manual con un
CUIT de prueba. Lo que sí entra acá es **dónde se registra que se hizo**, para
que el checklist pueda marcarlo. Ver [PENDIENTE 2].

**El punto de venta de AFIP por sucursal.** Proyecto 5b. Comprafit tiene una
sucursal y el propio proyecto dice «verificar si eso va a seguir así antes de
construirlo».

**Notas de crédito.** Proyecto 1, y su propio texto dice que la prueba de
homologación va primero.

**El `cashflowService` que suma los gastos fijos de todas las sucursales** (G9) y
**las dos mitades de Reports que no coinciden entre sí** (P14, P15). Las dos
pantallas están ocultas para el cliente y no llevan pasada en esta etapa.

---

## Vocabulario: qué significa cada palabra acá

Sin esto, «gastos fijos» quiere decir dos cosas distintas en la misma pantalla —y
hoy las dice (hallazgo P8).

| Palabra | Qué significa | Dónde vive |
|---|---|---|
| **Gasto fijo** | Un costo que se repite todos los meses. **Alimenta el punto de equilibrio.** No tiene fecha: es un importe mensual | `fixed_expenses` |
| **Gasto variable** | Un gasto de **un mes concreto**, atribuido a una persona. **No entra en el punto de equilibrio**, y está escrito en los dos lados (`Expenses.jsx:17-19`, `gastosVariables.js:17-20`) | `gastos_variables`, columna `mes` (YYYY-MM) |
| **Total de gastos fijos** | La suma de **todas** las filas de `fixed_expenses` de la empresa, con sucursal y sin ella | Hoy: `dashboardService.js:47` |
| **`fixed_expenses_total`** | Un **setting escrito a mano** que hoy alimenta el simulador de precios. **No es lo mismo que el anterior y nada los concilia** | `settings`, default `0` |
| **Facturación de referencia** | La facturación mensual promedio contra la que se calcula el margen mínimo. En el legacy era un campo de la pantalla de Gastos (`:3030`); hoy es `settings.target_sales`, **que no existe en ningún default** | Ver hallazgo P7 |
| **Margen sobre la venta** | `ganancia / precio`. La fracción de lo facturado que tiene que ser margen para cubrir los fijos | `utils/bep.js:33-41` |
| **Recargo sobre el costo** | `ganancia / costo`. Lo que el comerciante aplica para fijar el precio. **No son intercambiables**, y confundirlos es el error que recomendaba precios con pérdida | `utils/bep.js:53-60` |
| **Punto de equilibrio (BEP)** | El par de números de arriba, para un nivel de gastos fijos y una facturación objetivo | `utils/bep.js:72-83` |
| **Stock bajo** | Hoy **dos reglas distintas**: el Panel exige `min_stock > 0`; Faltantes e Inventario caen a un umbral de 3 cuando no hay mínimo cargado | `dashboardService.js:258` vs. `utils/stockBajo.js` |
| **Por cobrar** | Lo que los clientes deben. **Solo las ventas a cuenta corriente** (`is_credit`), menos los pagos | `customerService.js:64-66` es la definición correcta |
| **Por pagar** | Lo que se le debe a los proveedores: deuda **menos** pagos | `utils/cuentaDeProveedor.js:75-93` es la definición correcta |
| **Certificado** | El `.crt` que devuelve ARCA. Es **público**: se puede mostrar su emisor, su sujeto, su CUIT y sus fechas | `settings.afip_cert` |
| **Clave privada** | El `.key`. Es **secreto**: no sale de la API, y **no se muestra ni truncado** | `settings.afip_key` |
| **Ambiente** | `homologation` o `production`, **por empresa**. Sin valor se asume homologación y se registra | `settings.afip_environment` |
| **Homologación** | El servidor de pruebas de ARCA. **Sus comprobantes no tienen validez fiscal** | `wsaahomo.afip.gov.ar`, `wswhomo.afip.gov.ar` |
| **Punto de venta de ARCA** | El número que ARCA declara para Web Services. **Uno por empresa**, sin relación con `puntos_de_venta` | `settings.afip_pv` |
| **Sucursal / punto de venta** | La sucursal del sistema. **No es el punto de venta de ARCA**, y llamarlos igual ya causó confusión | `puntos_de_venta` |
| **Probar la conexión** | Hoy: `FEDummy`, que **no usa el certificado**. Lo que hace falta es otra cosa. Ver [PENDIENTE 2] | `afipService.js:114-122` |
| **Miembro** | Una fila de `usuario_empresas`: un usuario **dentro de una empresa**, con su rol | `usuario_empresas` |
| **Invitación** | Una fila de `invitaciones` con su token, su email, su rol y su vencimiento. **No crea nada en Auth0** | `invitaciones` |
| **Rol** | `admin`, `gerente`, `vendedor`, `produccion`, `compras`. De ahí salen los permisos | `seedPermissions.js` |
| **Sesión activa** | **No existe hoy.** En el legacy era un dispositivo con sesión iniciada, que se podía cerrar remotamente | Ver [PENDIENTE 1] |

---

## Qué se verifica en qué nivel

`docs/specs/CONVENCIONES.md` fija la tabla —tres niveles en `apps/web` y un
cuarto en `apps/api`—; acá se aplica caso por caso, que es donde se equivoca.
**Primero la función pura.** El navegador es el último recurso.

**Y el cuarto nivel no es opcional en esta funcionalidad.** Los tres hallazgos
más caros —el 404 de las invitaciones (E1), la clave privada en la respuesta
(A1) y los cinco errores de plata del Panel— tienen algo en común: **una guardia
estática los ve pasar**. E1 lleva ahí sin que nadie lo note porque las dos
guardias que miran `server.js` leen su texto y no hacen un solo request.

### Gastos

| Afirmación | Nivel | Archivo |
|---|---|---|
| A qué sucursal pertenece cada gasto fijo, incluido el que tiene `group` viejo y no tiene sucursal | **Función pura** | `apps/web/src/utils/gastos.js` |
| Qué gastos quedan en «General», y que **ningún gasto quede afuera de todos los grupos** | **Función pura** | idem — es el hallazgo G1 |
| El total de un grupo, en centavos enteros | **Función pura** | idem, y el del servidor (FR-026) |
| Que el encabezado y las filas compartan `grid-template-columns` | **Test de render** | `apps/web/src/tests/renderDeGastos.test.jsx` |
| Que las tarjetas de total sumen **lo mismo** que las filas de abajo | **Test de render** | idem |
| Que «Nuevo gasto» y «Eliminar» queden **deshabilitados con su explicación** sin el permiso, y no ausentes | **Test de render** | idem |
| Que un error de la API muestre el mensaje del servidor y **no** «Request failed with status code 500» | **Test de render**, espiando `api.post` | idem |
| Que un importe se escriba `1.234,50` **con la configuración regional en inglés** | **Función pura** | `utils/formato.test.js` — el molde ya existe |
| Que `POST /api/expenses` con la sucursal de otra empresa **no cree ninguna fila** | **Integración** | `src/tests/integracion/gastos.integracion.test.js` |
| Que `SUM(amount)` vuelva como string y el total no se rompa | **Integración** | idem |
| Que ningún `create` cuelgue una fila de un padre sin validar | **Guardia estática** | `tests/aislamientoEmpresas.test.js` — hay que **arreglar el detector**, ver FR-033 |
| Que la tabla no use `Table*`, ni hex, ni `dark:` | **Guardia estática** | `tests/guardiasDeDiseno.test.js` |

### Panel de control

| Afirmación | Nivel | Archivo |
|---|---|---|
| La severidad, el orden y la etiqueta de cada aviso de «Requiere tu atención» | **Función pura** | `apps/web/src/utils/panel.js` |
| Que un aviso con cero casos **no se dibuje** | **Función pura** | idem |
| Las alturas del sparkline a partir de una serie, incluida la serie **vacía** y la de un solo punto | **Función pura** | idem |
| El punto de equilibrio | **Función pura** | `utils/bep.js` — **ya existe y no se toca** |
| Que el simulador **no arranque con un número inventado** | **Test de render** | `tests/renderDelPanel.test.jsx` |
| Que un fallo de un endpoint muestre un aviso y **no** seis tarjetas en `-` | **Test de render** | idem |
| Que cada aviso lleve **a la pantalla que lo detalla** | **Test de render** | idem |
| **Que «Por Pagar» baje al registrar un pago** | **Integración** | `src/tests/integracion/panel.integracion.test.js` |
| **Que una venta de contado a un cliente identificado NO cuente como por cobrar** | **Integración** | idem — es P2 |
| **Que el aging sume exactamente el total que la tarjeta muestra arriba** | **Integración** | idem — es P3 |
| **Que una venta del día 1 se cuente en un solo mes** | **Integración** | idem — es P4, y la fixture **tiene que tener una venta ese día** |
| **Que el corte de mes use la zona de la empresa** | **Integración** | idem — con `Empresa.timezone` distinto de UTC y una venta a las 22:00 |
| Que el Panel y el Historial digan lo mismo sobre las ventas del período | **Integración** | idem — los dos endpoints, la misma fixture |
| Que un rol sin `caja.ver` no reciba el saldo de caja en la respuesta del panel | **Integración** | idem |
| Que `dashboardService` no acumule plata en punto flotante | **Función pura** o guardia | El molde es `cuentaDeProveedor.js` |

**Advertencia sobre la fixture**, que es donde este proyecto más se equivocó: la
del Panel necesita **una venta el día 1 del mes**, **una venta de contado a un
cliente identificado**, **un proveedor con deuda y un pago parcial**, **importes
que dejen centavos** —los redondos cierran igual con y sin el defecto—, **un
producto en cero sin `min_stock` cargado**, y **una venta a las 22:00 hora
argentina**. Una fixture de tres ventas redondas pasa con y sin cinco de los seis
defectos.

### Facturación AFIP

| Afirmación | Nivel | Archivo |
|---|---|---|
| El estado de cada paso del checklist —pendiente, hecho, vencido, no verificable— y su tono | **Función pura** | `apps/web/src/utils/puestaEnMarchaAfip.js` |
| Que el checklist esté **completo solo si los cuatro pasos lo están** | **Función pura** | idem |
| Los días que faltan para que venza el certificado, y su umbral de aviso | **Función pura** | idem |
| Que la pantalla **no muestre la clave privada de ninguna forma** | **Test de render** | `tests/renderDeAjustesAfip.test.jsx` |
| Que el banner **no diga «Conectado»** cuando lo único que respondió es `FEDummy` | **Test de render** | idem |
| Que los mensajes de validación del servidor lleguen al usuario | **Test de render**, espiando `api.post` | idem |
| Que pasar a producción **pida confirmación y diga qué implica** | **Test de render** | idem |
| **Que `GET /api/settings` NO devuelva `afip_key` ni `afip_cert`** | **Integración** | `src/tests/integracion/settingsSinSecretos.integracion.test.js` |
| **Que `GET /api/settings/afip_key` no devuelva el PEM** | **Integración** | idem |
| **Que `PUT /api/settings/afip_cert` sea rechazado** | **Integración** | idem |
| Que la empresa B no lea el certificado de la A | **Integración** | idem |
| **Que ninguna respuesta de la API contenga la cadena `PRIVATE KEY`** | **Guardia estática** + integración | Las dos mitades: el texto y la ejecución |
| Que `POST /api/afip/invoice` quede restringido a homologación, o no exista | **Guardia estática** | `tests/permisosDeRutas.test.js` o una propia |

**El caso que tiene que fallar si se revierte la corrección de A1** es concreto:
una petición real a `GET /api/settings` con un `afip_key` sembrado, y una
aserción de que la cadena `-----BEGIN` **no aparece en el cuerpo de la
respuesta**. Es la única forma de que la afirmación sea sobre lo que sale por el
cable, y no sobre lo que el componente decide leer.

### Equipo

| Afirmación | Nivel | Archivo |
|---|---|---|
| El estado de un miembro —activo, desactivado, invitación pendiente, invitación vencida— y su tono | **Función pura** | `apps/web/src/utils/equipo.js` |
| La etiqueta de cada rol, **incluido `gerente`** | **Función pura** | idem — es E9 |
| Si una fila se puede degradar: **no es la propia, y no es el último admin** | **Función pura** | idem — la misma regla la aplican la pantalla y el servidor |
| Que la fila propia tenga el selector **deshabilitado con su explicación** | **Test de render** | `tests/renderDeEquipo.test.jsx` |
| Que la columna Estado **lea `is_active`** | **Test de render** | idem |
| **Que invitar sin que el mail salga muestre el enlace y diga que hay que pasarlo a mano** | **Test de render**, con `api.post` devolviendo `email_enviado: false` | idem — es E3, y es el caso que hoy no existe |
| Que un 403 al cargar diga «no tenés permiso» y no dibuje un equipo vacío | **Test de render** | idem |
| **Que `GET /api/auth/invite/:token` responda 200 con un token válido** | **Integración** | `src/tests/integracion/invitaciones.integracion.test.js` — es E1, y **es el único nivel que lo puede contestar** |
| **Que `POST /api/auth/accept-invite/:token` cree la membresía** | **Integración** | idem |
| Que un token vencido, usado o inexistente **no cree ninguna membresía** | **Integración** | idem |
| **Que no se pueda degradar ni desactivar al último admin** | **Integración** | idem — es E5 |
| Que la empresa B no pueda reenviar una invitación de la A | **Integración** | idem — es E6 |
| Que `GET /:empresaId/usuarios` **no devuelva `auth0_sub` ni `es_superadmin`** | **Integración** | idem |
| Que ningún router se monte con `app.get`/`app.post` en vez de `app.use` | **Guardia estática** | Nueva. Es lo único que impide que E1 vuelva |

**Y una guardia que no existe y tendría que existir**: `permisosDeRutas.test.js`
lee el texto de `server.js` y ve un router montado con su cadena de middlewares.
**No ve que el montaje sea el correcto.** Una guardia que compare el tipo de
montaje contra el tipo del handler —`app.use` para un `Router`— es barata y es lo
único que impide que E1 vuelva con el próximo endpoint. → **FR-103**.

### Pruebas de navegador

**Casi nada baja acá, y es a propósito.** Las cuatro rutas ya están en
`CON_MARCO` (`marcoDeLasPantallas.navegador.js:53-58`), y esas dos afirmaciones
—que el `<body>` no desborde a 1140px y que lo que scrollea sea el contenedor de
1320px— **ya se verifican hoy** para las cuatro. **No se agrega ninguna ruta**;
es la diferencia con la funcionalidad 013.

Lo único que se agrega, si algo:

| Afirmación | Por qué necesita un motor de maquetado |
|---|---|
| Que el nombre de un gasto largo no se meta en la columna de importe | `getBoundingClientRect` devuelve cero en jsdom |
| Que el sparkline de doce barras entre en su tarjeta sin desbordar | idem |
| Que las cuatro tarjetas del Panel arranquen en el mismo píxel | idem |

**Lo que NO baja**, aunque se pueda escribir: el color de un badge, qué avisos
entran, cuánto suma un grupo, qué pasos del checklist están hechos. Todo eso lo
contesta una función pura.

---

## User Scenarios & Testing *(mandatory)*

Las historias van **agrupadas por pantalla**, y dentro de cada una por
prioridad. La numeración es corrida para poder citarlas desde `tasks.md`.

---

## Gastos

### User Story 1 — Ver todos los gastos fijos que hay, en la sucursal que les toca (Priority: P1)

Como dueño, quiero que la pantalla de Gastos muestre **todos** mis gastos fijos y
que cada uno esté bajo la sucursal que le corresponde, para que el total que veo
sea el total que pago.

**Why this priority**: es el hallazgo G1 y es plata que hoy **no se ve**. Un
gasto que la pantalla no dibuja sigue moviendo el punto de equilibrio
(`dashboardService.js:47`) y el flujo de caja (`cashflowService.js:27`): el dueño
fija un precio con un número que no puede auditar. Con una sola sucursal —que es
el caso de Comprafit— el gasto desaparece por completo.

**Independent Test**: cargar un gasto sin sucursal en una empresa de una sola
sucursal y verificar que aparece. Verificable contra hoy, donde no aparece en
ninguna parte.

**Acceptance Scenarios**:

1. **Given** un gasto fijo sin sucursal, **When** miro la pantalla, **Then**
   aparece en «General». Hoy queda excluido de General por su `group='gf1'`
   (`Expenses.jsx:81`) y, con una sola sucursal, no cae en ningún grupo.
2. **Given** una empresa con dos sucursales y un gasto sin sucursal, **When**
   miro, **Then** **no** aparece bajo la segunda sucursal. Hoy sí, por
   `'gf' + indexOf(pv)` (`:76`).
3. **Given** un gasto con sucursal **y** un `group` viejo, **When** miro, **Then**
   aparece **una sola vez**. Hoy matchea las dos ramas del `||` y se cuenta dos
   veces en las tarjetas de total.
4. **Given** cualquier conjunto de gastos, **When** sumo lo que la pantalla
   dibuja, **Then** **da el total de `fixed_expenses` de la empresa**. Es la
   afirmación que cierra las tres anteriores: ningún gasto puede quedar afuera de
   todos los grupos.
5. **Given** el bucket «General», **When** miro los totales, **Then** **tiene su
   tarjeta**. Hoy se filtra por nombre (`:126`) y no la tiene.
6. **Given** una sucursal que se llame literalmente «General», **When** miro,
   **Then** **no desaparece** de los totales.
7. **Given** el agrupado, **When** lo reviso, **Then** es una **función pura** de
   `utils/` con su test, y no un `filter` adentro del `render`.
8. **Given** las filas que ya tienen `group` viejo, **When** se decide qué hacer,
   **Then** **queda escrito**: se migran a `punto_de_venta_id`, o el agrupador
   las interpreta explícitamente. Ver [PENDIENTE 4].

---

### User Story 2 — Los importes se leen en argentino y el total lo calcula el servidor (Priority: P1)

Como dueño, quiero que los importes de Gastos se escriban `1.234,50` y que el
total no dependa de la configuración regional de mi navegador ni de una suma en
punto flotante del cliente.

**Why this priority**: son los hallazgos G2 y T3. `CONVENCIONES.md` lo pone entre
las reglas que no se negocian: «Los importes argentinos se escriben `1.234,50`.
Leerlos al revés convierte $1.234 en $1,234 **y no falla nada**». Y el total de
una suma de plata lo calcula el servidor.

**Independent Test**: abrir la pantalla con el navegador en inglés y verificar
que los importes siguen en formato argentino. Verificable contra hoy, donde
`toLocaleString()` sin locale devuelve `1,234.5`.

**Acceptance Scenarios**:

1. **Given** un gasto de $1.234,50, **When** lo miro con el navegador en
   **inglés**, **Then** dice `$1.234,50`. Hoy dice `$1,234.5`
   (`Expenses.jsx:163`).
2. **Given** un gasto de $1.234,5, **When** lo miro, **Then** dice `$1.234,50`:
   **dos decimales, siempre**. Hoy `GastosVariables.jsx:249` mezcla «1.234,5» con
   «1.234,50» en la misma columna.
3. **Given** cualquier importe, **When** lo miro, **Then** viene de
   `utils/formato.js`, y la pantalla **no declara ningún formateador propio ni
   formatea en línea**.
4. **Given** el total de un grupo, **When** lo miro, **Then** **lo calculó el
   servidor**, no un `reduce` con `parseFloat` en el navegador
   (`Expenses.jsx:127`).
5. **Given** importes con centavos, **When** se suman, **Then** el total no
   arrastra residuo de punto flotante: la suma es en **centavos enteros**, como
   `utils/cuentaDeProveedor.js`.
6. **Given** `DECIMAL(12,2)` que Sequelize devuelve como string, **When** se suma
   o se compara, **Then** hay un test de integración que lo ejercita contra
   Postgres. `'0.00' <= 0` es `true` y `'0.00' === 0` es `false`.
7. **Given** el mes de los gastos variables, **When** se calcula, **Then** sale
   de la fecha del negocio y no de `toISOString()` (`GastosVariables.jsx:26`): el
   31 a las 21:30 sigue siendo el mes en curso.

---

### User Story 3 — Gastos con el patrón del sistema (Priority: P2)

Como dueño, quiero que Gastos se vea y se opere como las demás pantallas —tabla
en grid, panel lateral, solapas de segmento— para no tener que aprender dos
sistemas.

**Why this priority**: es lo que pide 4.7 textualmente. Va en P2 porque una
pantalla prolija con los números mal es peor que una fea con los números bien.

**Independent Test**: abrir `/gastos` y verificar que la tabla es un grid con el
mismo `grid-template-columns` en encabezado y filas, y que editar un gasto abre
un panel lateral.

**Acceptance Scenarios**:

1. **Given** la pantalla, **When** la miro, **Then** arriba hay **tarjetas de
   total por sucursal** y abajo una **tabla en grid** (4.7).
2. **Given** la tabla, **When** la miro, **Then** usa `TablaGrid` / `Encabezado`
   / `Fila` / `BotonDeFila`, con el **mismo string** de `grid-template-columns`
   en los dos lados, y **ningún `Table*` de shadcn** (`Expenses.jsx:8` hoy).
3. **Given** las dos solapas, **When** las miro, **Then** son **segmentos**
   —contenedor con `background: surface-3`, botones de 28px—, como
   `Favalio-Rediseno.dc.html:645-648` y `components/pos/SegmentoDePago.jsx`. Hoy
   es un `border-b-2` a mano (`Expenses.jsx:104-118`).
4. **Given** una fila, **When** la toco, **Then** se abre un **panel lateral** de
   520px con `max-w-[92vw]`, y **no un modal**: se edita un gasto mirando la
   lista.
5. **Given** el panel, **When** cambio el importe y guardo, **Then** se guarda.
   Hoy **un gasto fijo no se puede editar** (hallazgo G5): el endpoint existe y
   no lo llama nadie.
6. **Given** un usuario sin `gastos.eliminar` —el rol `gerente`—, **When** miro,
   **Then** el botón de borrar está **deshabilitado con su explicación**, y no
   ausente. Hoy se dibuja habilitado y la API responde 403 (`Expenses.jsx:166`).
7. **Given** un error de la API, **When** lo veo, **Then** el mensaje viene de
   `mensajeDeError`. Hoy dice «Error: Request failed with status code 500»
   (`:56`).
8. **Given** que la carga falla, **When** miro, **Then** la pantalla lo dice. Hoy
   es un `console.error` y una tabla vacía (`:35`).
9. **Given** la lista vacía, **When** miro, **Then** veo un estado vacío con dos
   líneas, y **es distinto** del de una sucursal sin gastos.
10. **Given** los dos archivos terminados, **When** los reviso, **Then** están en
    `NOMBRES` de `guardiasDeDiseno.test.js` y no tienen hex, `dark:`, clases de
    la paleta ni `Table*`.

---

### User Story 4 — Un gasto no se puede colgar de la sucursal de otra empresa (Priority: P1)

Como dueño de una empresa cliente, quiero que ninguna otra empresa pueda crear
filas colgadas de mis sucursales.

**Why this priority**: es el hallazgo G4 y es la regla que este repositorio ya
rompió treinta veces. Aparece con **una forma nueva que el detector del «padre
ajeno» no ve**, y eso importa más que el caso puntual: mientras el detector no la
vea, la próxima aparición tampoco se detecta.

**Independent Test**: con dos empresas sembradas, `POST /api/expenses` desde la B
con un `punto_de_venta_id` de la A. Tiene que responder 404 y no dejar fila.

**Acceptance Scenarios**:

1. **Given** una sucursal de la empresa A, **When** la empresa B la manda en
   `POST /api/expenses`, **Then** responde **404** y **no se crea ninguna fila**.
   Verificable contra hoy, donde se crea.
2. **Given** lo mismo por `PUT /api/expenses/:id`, **When** llega, **Then** vale
   igual (`general.js:347-348`).
3. **Given** lo mismo en gastos variables (`gastosVariables.js:130`, `:150`),
   **When** llega, **Then** vale igual.
4. **Given** `POST /api/expenses`, **When** mando campos que no corresponden
   —`group`, `id`, `empresa_id`—, **Then** **se ignoran**. Hoy `{ ...req.body }`
   los deja pasar (`:330`).
5. **Given** el detector del padre ajeno, **When** corre sobre
   `FixedExpense.create(data)` con `data` armado antes, **Then** **lo encuentra**.
   Hoy `clavesForaneas` mira el texto literal `(data)` y devuelve cero claves.
6. **Given** el mismo detector, **When** corre sobre
   `punto_de_venta_id: punto_de_venta_id || null`, **Then** **lo encuentra**. Hoy
   el valor no matchea `/^req\.(params|body|query)\./`.
7. **Given** las dos correcciones del detector, **When** corren, **Then** se
   ejercitan contra una **muestra sintética con el defecto**, y se exige que lo
   nombren con archivo y línea. Es el patrón que ese archivo ya usa.
8. **Given** las guardias que ya existen, **When** corre la suite, **Then**
   ninguna empieza a fallar por otra cosa.

---

## Panel de control

### User Story 5 — Los números del Panel son los mismos que muestran las pantallas que los detallan (Priority: P1)

Como dueño, quiero que cuando el Panel diga «$2,9 M por cobrar» y yo entre a la
pantalla de Clientes, el número sea el mismo, para no tener que averiguar cuál de
los dos me está mintiendo.

**Why this priority**: son los hallazgos P1 a P5, y son cinco números que el
dueño usa para decidir. **Un indicador que se calcula distinto que la pantalla
que lo detalla no es un error de redondeo: es dos sistemas.** Cuando no
coinciden, nadie sabe cuál creer, y la respuesta racional es dejar de mirar los
dos. Es lo que vuelve inútil un panel de control.

Y el rediseño lo empeora: la maqueta pone cada indicador **con un enlace a la
pantalla que lo detalla** (`Favalio-Rediseno.dc.html:1179-1182`). Hoy los
números divergentes están lejos; después van a estar a un clic.

**Independent Test**: sembrar un proveedor con deuda y un pago parcial, y
verificar que «Por Pagar» del Panel es igual al saldo de la pantalla de
Proveedores. Verificable contra hoy, donde el Panel muestra la deuda bruta.

**Acceptance Scenarios**:

1. **Given** un proveedor con $100.000 de deuda y $40.000 pagados, **When** miro
   «Por Pagar», **Then** dice **$60.000**, igual que la pantalla de Proveedores.
   Hoy dice $100.000 y **no baja nunca al pagar** (`dashboardService.js:207-224`).
2. **Given** una venta de $50.000 **cobrada en el mostrador** a un cliente
   identificado, **When** miro «Por Cobrar», **Then** **no la incluye**. Hoy sí,
   porque falta `is_credit` (`:167`), y `customerService.js:64-66` tiene el
   filtro con el comentario que explica por qué.
3. **Given** ese mismo cliente, **When** miro «clientes con deuda», **Then**
   **no lo cuenta**. Mismo defecto en `:143-145`.
4. **Given** un cliente que pagó **exactamente** lo que debía, **When** se lo
   evalúa, **Then** **no aparece con deuda**. Hoy es
   `parseFloat(a) > parseFloat(b)` sobre dos `SUM` de DECIMAL (`:149`) y el
   residuo decide.
5. **Given** la tarjeta de cuentas corrientes, **When** sumo los cuatro tramos
   del aging, **Then** **dan el total que la tarjeta muestra arriba**. Hoy los
   tramos son lo facturado y el total lo impago (`:172` vs `:180-194`): nunca
   cierran.
6. **Given** una venta del **día 1** del mes, **When** miro «mes actual» y «mes
   anterior», **Then** está en **uno solo**. Hoy `Op.between` es inclusivo en los
   dos extremos y está en los dos (`:39-40`, `:90`) — el arreglo ya existe 130
   líneas más abajo, en el mismo archivo (`:174-177`).
7. **Given** una empresa con `timezone` de Argentina y una venta a las 22:00 del
   último día del mes, **When** miro el Panel, **Then** la cuenta en ese mes. Hoy
   el Panel corta por UTC (`:17-22`) y la venta se guardó con
   `fechaDelNegocio` (`sales.js:466`): están un día corridos.
8. **Given** el mismo período, **When** comparo «Ventas 30d» del Panel con el
   total del Historial de ventas, **Then** **coinciden o la diferencia está
   explicada en la pantalla**. Hoy el Historial cuenta las anuladas a propósito
   (`sales.js:140-143`) y el Panel no: la diferencia es legítima y **hay que
   decirla**, no taparla.
9. **Given** «Saldo Caja» con una sucursal seleccionada, **When** lo comparo con
   la pantalla de Caja, **Then** **o los dos son de la sucursal, o los dos son de
   la empresa**, y la etiqueta lo dice. Hoy son distintos bajo la misma etiqueta
   (`dashboardService.js:42` vs `routes/cashflow.js:9`). Ver [PENDIENTE N2].
10. **Given** «Proy. 30d», **When** la miro, **Then** dice que supone un
    crecimiento del 10 %. El servicio ya lo devuelve en `supuesto_crecimiento`
    (`cashflowService.js:123`) y la pantalla no lo lee.
11. **Given** cualquiera de estas cuentas, **When** se acumula plata, **Then**
    es en **centavos enteros**. Hoy `:224` y `:231-237` acumulan en float
    **antes** de los cortes de tramo, y el redondeo de `:241-246` llega tarde.
12. **Given** cada uno de estos escenarios, **When** se escribe su test, **Then**
    es un **test de integración contra Postgres**: son `SUM` con `GROUP BY`,
    DECIMAL que vuelve como string y comparaciones de fecha. Un doble no entiende
    nada de eso.

---

### User Story 6 — «Requiere tu atención» dice lo mismo que la pantalla a la que lleva (Priority: P1)

Como dueño, quiero abrir el Panel y ver en una sola lista lo que necesita que yo
haga algo, con el número exacto y un botón que me lleve ahí.

**Why this priority**: es lo único que 4.8 pide como función nueva —«Sumar
"Requiere tu atención", que hoy no existe: faltantes, ventas sin CAE,
vencimientos de stock»— y es lo que convierte el Panel en algo que se usa a la
mañana en vez de un cuadro de números.

**Y arrastra una decisión**: hoy el Panel y Faltantes cuentan «stock bajo» con
reglas distintas, y esa divergencia está documentada como deliberada
(`utils/stockBajo.js:23-30`). Era tolerable mientras estaban en pantallas
separadas. **Un aviso que dice «7 productos por debajo del mínimo» y lleva a una
pantalla que muestra 12 no es tolerable.**

**Independent Test**: sembrar un producto en cero sin `min_stock` cargado y
verificar que el número del aviso coincide con el que muestra Faltantes.

**Acceptance Scenarios**:

1. **Given** el Panel, **When** lo abro, **Then** veo una sección «Requiere tu
   atención» con su contador, como `Favalio-Rediseno.dc.html:260-283`.
2. **Given** esa sección, **When** la miro, **Then** cada fila tiene ícono con su
   tono, título, una línea de detalle y una acción que lleva a la pantalla
   correspondiente.
3. **Given** faltantes, ventas sin CAE y vencimientos de stock, **When** los
   miro, **Then** **los tres están** — son los que nombra 4.8.
4. **Given** un aviso de faltantes, **When** aprieto la acción y llego a
   Faltantes, **Then** **el número es el mismo**. Ver [PENDIENTE 3].
5. **Given** un aviso de ventas sin CAE, **When** aprieto la acción, **Then**
   llego al Historial de ventas **filtrado por las que no tienen CAE**, donde el
   botón de reintentar ya existe (`InvoicesList.jsx:427`).
6. **Given** un producto en cero **sin `min_stock` cargado**, **When** miro,
   **Then** el aviso lo cuenta. Hoy `min_stock > 0` (`:258`) lo excluye: un
   producto agotado que nadie configuró **no alerta nunca**.
7. **Given** que no hay nada que atender, **When** miro, **Then** veo un estado
   vacío que lo dice, distinto de «no se pudo calcular».
8. **Given** que uno de los cálculos falla, **When** miro, **Then** la sección
   dice **qué no pudo calcular**, y los demás avisos se muestran igual. Un aviso
   que no se puede calcular no puede verse igual que un aviso en cero.
9. **Given** la severidad y el orden de los avisos, **When** se los prueba,
   **Then** es una **función pura** de `utils/panel.js`: qué entra, con qué tono
   y en qué orden.
10. **Given** un aviso con cero casos, **When** se arma la lista, **Then** **no
    se dibuja**. Cuatro filas en cero entrenan a no mirar la sección.
11. **Given** `kpis.alerts`, que el servicio ya calcula y la pantalla no lee
    (`dashboardService.js:77-80`), **When** se termina esto, **Then** **hay una
    sola fuente**: o la usa, o deja de calcularse. Dos versiones del mismo aviso
    en el mismo payload se separan y nada avisa.

---

### User Story 7 — El simulador de precios no arranca con números inventados (Priority: P1)

Como dueño, quiero que el punto de equilibrio se calcule con **mis** gastos fijos
y **mi** facturación, o que la pantalla me diga que faltan, y no que me
recomiende precios sobre datos que no son míos.

**Why this priority**: es el hallazgo P7. `utils/bep.js` está bien y probado; **lo
que entra está mal**. Una empresa que no cargó `fixed_expenses_total` —que es el
default, `0`— recibe recomendaciones de precio calculadas sobre $2.400.000 de
gastos y $7.000.000 de facturación inventados, **con la misma cara con la que
mostraría los reales**. Es la familia exacta del error que `CONVENCIONES.md` cita
primero: la calculadora que recomendaba precios con pérdida.

**Independent Test**: entrar con una empresa sin `fixed_expenses_total` cargado y
verificar que la pantalla lo pide en vez de mostrar un resultado.

**Acceptance Scenarios**:

1. **Given** una empresa sin gastos fijos configurados, **When** abro el
   simulador, **Then** **no muestra ningún precio recomendado**: dice qué falta y
   cómo cargarlo. Hoy arranca en $2.400.000 (`Dashboard.jsx:50`).
2. **Given** una empresa sin facturación objetivo, **When** abro, **Then** vale
   lo mismo. Hoy arranca en $7.000.000, y **`target_sales` no existe en ningún
   default del sistema**.
3. **Given** que la empresa **sí** tiene gastos fijos cargados en
   `fixed_expenses`, **When** abro el simulador, **Then** el valor **sale de
   ahí**, que es el mismo número que muestra la tarjeta de arriba. Hoy la tarjeta
   usa `kpis.fixed_expenses` (`:280`) y el simulador `settings.fixed_expenses_total`
   (`:313-318`): **dos números con la misma etiqueta a cuarenta píxeles**.
4. **Given** que los dos valores se pueden editar para simular, **When** los
   cambio, **Then** la pantalla dice **que estoy simulando** y cuál es el valor
   real.
5. **Given** que vacío el campo de gastos fijos, **When** miro, **Then** **no
   dice «$NaN»**. Hoy `parseFloat('')` da `NaN`, `calcularBep` lo tolera y devuelve
   `viable:false`, y la rama de `:358-363` imprime el `NaN` en la prosa.
6. **Given** gastos fijos mayores o iguales a la facturación objetivo, **When**
   miro, **Then** dice que **no hay precio que cierre** y qué hacer. `bep.js:57`
   ya devuelve `null` para ese caso; la pantalla tiene que decirlo bien.
7. **Given** los importes de esa prosa, **When** los miro, **Then** están en
   formato argentino. Hoy son cuatro `toLocaleString()` sin locale (`:342`,
   `:343`, `:359`, `:360`) en la pantalla que **sí** está en la lista `IMPORTAN`
   de la guardia: la migración se hizo en las tarjetas y no acá.
8. **Given** las tres estrategias de precio, **When** las miro, **Then** cada una
   dice si su número es **margen sobre la venta** o **recargo sobre el costo**.
   Es la distinción que `bep.js:1-25` documenta y el error que el legacy tenía
   (`legacy:3958`).

---

### User Story 8 — El Panel dibujado como la maqueta (Priority: P2)

Como dueño, quiero abrir el Panel y ver de un vistazo cómo viene el negocio, con
cuatro indicadores claros en vez de seis tarjetas apretadas.

**Why this priority**: es lo que pide 4.8 y **la maqueta lo dibuja entero**
(`Favalio-Rediseno.dc.html:219-334`), que es más de lo que tuvo cualquiera de
las otras tres pantallas de este hito. Va en P2 porque un indicador bien dibujado
que dice un número equivocado sigue siendo un número equivocado.

**Independent Test**: comparar `/panel` contra el bloque `isPanel` de la maqueta:
cuatro tarjetas con sparkline, «Requiere tu atención», «Actividad reciente» y
«Accesos rápidos».

**Acceptance Scenarios**:

1. **Given** el Panel, **When** lo miro, **Then** hay **cuatro** tarjetas de
   indicador en una grilla de cuatro columnas (`:237-255`), no seis.
2. **Given** una tarjeta, **When** la miro, **Then** tiene etiqueta, valor en
   mono de 26px, delta con su flecha y su tono, **sparkline de doce barras** y
   una nota al pie (`:239-253`).
3. **Given** el sparkline, **When** se dibuja, **Then** **sale de datos reales**
   y no de una función de relleno. La maqueta usa `Math.sin` (`:1166-1169`)
   porque es una maqueta. Ver [PENDIENTE N3].
4. **Given** una serie sin datos suficientes, **When** se dibuja, **Then** **no
   se dibuja un sparkline**: una línea plana inventada es peor que ninguna.
5. **Given** el sparkline, **When** se implementa, **Then** **no se agrega
   ninguna librería de gráficos**: `apps/web/package.json` no tiene ninguna y son
   doce `<div>` con altura porcentual.
6. **Given** «Actividad reciente», **When** la miro, **Then** cada fila tiene
   hora en mono, punto de color, quién y qué, e importe alineado a la derecha
   (`:292-299`). Ver [PENDIENTE N5]: **no hay tabla de auditoría** de dónde
   sacarla.
7. **Given** «Accesos rápidos», **When** los miro, **Then** son una grilla de 2×2
   que lleva a las acciones más frecuentes (`:320-330`). Ver [PENDIENTE N6].
8. **Given** un usuario sin permiso para una de las secciones, **When** entra,
   **Then** esa sección **no se dibuja**, en vez de dibujarse en cero.
9. **Given** el archivo terminado, **When** lo reviso, **Then** está en `NOMBRES`
   de `guardiasDeDiseno.test.js` y **no tiene las dos reglas `dark:` ni las nueve
   clases de la paleta** que tiene hoy.
10. **Given** los importes, **When** los miro, **Then** los grandes van con
    `importeAbreviado` y los exactos con `pesos`. Ya importa las dos
    (`Dashboard.jsx:15`); lo que falta es que las use en los cuatro lugares que
    hoy formatean a mano.
11. **Given** una fecha de vencimiento, **When** la miro, **Then** usa
    `fechaCorta`. Hoy `new Date(...).toLocaleDateString()` sobre un `DATEONLY`
    (`:481`) muestra **el día anterior** en Argentina.

---

### User Story 9 — El Panel no muestra datos que el usuario no puede ver por otro camino (Priority: P2)

Como operador de la plataforma, quiero que el Panel respete los permisos de las
pantallas que resume, para que un permiso no se pueda esquivar entrando por otra
puerta.

**Why this priority**: es el hallazgo P6. `dashboard.ver` lo tienen **los cinco
roles**, y la respuesta trae el saldo de caja, las cuentas por cobrar y los
gastos fijos, que sus propias pantallas protegen con `caja.ver`, `clientes.ver` y
`gastos.ver`. No es una fuga entre empresas: es que el permiso más repartido del
catálogo abre lo que los otros cierran.

**Independent Test**: con un usuario de rol `produccion`, pedir
`GET /api/dashboard/kpis` y verificar que la respuesta **no trae** `cashflow` ni
`receivables`.

**Acceptance Scenarios**:

1. **Given** un usuario con `dashboard.ver` y **sin** `caja.ver`, **When** pide
   los indicadores, **Then** **la respuesta no incluye el saldo de caja**. No
   alcanza con no dibujarlo: tiene que no venir.
2. **Given** un usuario sin `clientes.ver`, **When** pide los indicadores,
   **Then** no vienen `receivables` ni `customers.with_debt`.
3. **Given** un usuario sin `gastos.ver`, **When** pide, **Then** no viene
   `fixed_expenses`.
4. **Given** cualquiera de esos casos, **When** se dibuja el Panel, **Then** la
   tarjeta correspondiente **no está**, y no está en cero ni en `-`.
5. **Given** la corrección, **When** corre `permisosDeRutas.test.js`, **Then**
   sigue en verde y su lista `DEUDA_DE_PERMISOS` sigue vacía.
6. **Given** los cuatro `include` de `Product` sin filtrar
   (`dashboardService.js:279`, `:300`; `general.js:464`, `:475`), **When** se los
   revisa, **Then** llevan su `where` de empresa. La guardia no los puede ver
   porque `Stock.product` es un `belongsTo` (`aislamientoEmpresas.test.js:541-544`,
   excepción escrita en `:874-877`).
7. **Given** el Panel, **When** falla uno de los dos endpoints, **Then** **el
   otro se dibuja igual** y la pantalla dice cuál falló. Hoy un 403 en `/alerts`
   —que pide un permiso distinto— tumba el `Promise.all` y deja el Panel entero
   en `-` sin decir nada (`Dashboard.jsx:56-68`).

---

## Facturación AFIP (Ajustes)

### User Story 10 — La clave privada de facturación no sale de la API (Priority: P0)

Como dueño, quiero que mi clave privada de AFIP no viaje al navegador ni quede en
el estado de la aplicación, porque con ella cualquiera puede facturar con mi
CUIT.

**Why this priority**: **es la única P0 de este documento.** No es una pasada de
diseño: es material fiscal del cliente saliendo por un `GET` que la propia
pantalla dispara al montar, y que además se repite en cada `initialize()` del
store. Alcanza `config.ver`, que tiene el rol `gerente`. Que el arreglo es una
lista de exclusión y no un rediseño lo prueba `scripts/backup.js:59`, que **ya la
tiene escrita**.

**Y por eso debería salir de este hito e ir primero, sola.** Ver «Por qué van
juntas, y por qué AFIP debería ir sola».

**Independent Test**: pedir `GET /api/settings` con un `afip_key` cargado y
verificar que la cadena `-----BEGIN` **no aparece en el cuerpo de la respuesta**.
Verificable contra hoy, donde aparece entera.

**Acceptance Scenarios**:

1. **Given** una empresa con certificado y clave cargados, **When** pido
   `GET /api/settings`, **Then** **la respuesta no contiene `afip_key` ni
   `afip_cert`**, ni enteros ni truncados. Verificable contra hoy
   (`general.js:394-398`).
2. **Given** la misma empresa, **When** pido `GET /api/settings/afip_key`,
   **Then** **no devuelve el PEM** (`general.js:418-431`).
3. **Given** la misma empresa, **When** hago `PUT /api/settings/afip_key` o
   `PUT /api/settings/afip_cert`, **Then** **se rechaza**: el único camino para
   escribir material fiscal es `POST /api/afip/setup`, que valida los PEM, los
   exige juntos e invalida el cache del ticket WSAA (`afip.js:87-151`).
4. **Given** `PUT /api/settings/afip_environment`, **When** llega, **Then** vale
   lo mismo. Cambiar el ambiente por ese camino **deja cacheado en memoria el
   ticket WSAA del ambiente anterior** (`afip.js:151` no se ejecuta).
5. **Given** la lista de claves que no salen, **When** se escribe, **Then** está
   **en un solo lugar** y la usan los tres endpoints y el backup. Hoy
   `backup.js:59` tiene su propia copia: dos listas iguales en dos archivos
   empiezan iguales y terminan distintas.
6. **Given** una clave nueva que alguien agregue mañana —el token de TiendaNube
   ya está en la lista del backup—, **When** se agrega, **Then** hay **una
   guardia** que falla si una clave sensible no está en la lista de exclusión.
   Sin eso, el próximo secreto entra por el mismo agujero.
7. **Given** el store del navegador, **When** se llena con la respuesta de
   `/settings` (`useStore.js:47-58`), **Then** **no hay material fiscal
   adentro**.
8. **Given** los logs y Sentry, **When** algo falla, **Then** la redacción sigue
   funcionando: `logger.js:56-61` y `sentry.js:55` ya cubren `afip_key`,
   `afip_cert`, `err.sql` y `err.parameters`. **No se toca, y no se debilita.**
9. **Given** `POST /api/afip/generate-csr`, **When** devuelve la clave recién
   generada, **Then** **sigue siendo la única salida legítima** y sigue trayendo
   su advertencia (`afipService.js:358-364`). Es una clave que todavía no es de
   nadie y que el servidor no guarda.
10. **Given** que la clave estuvo saliendo, **When** se cierra, **Then** queda
    escrito **qué se hace con el material que ya salió**. Ver [PENDIENTE 1].
11. **Given** `Settings.jsx`, **When** se guarda la configuración, **Then**
    `config.cert` y `config.key` **se limpian del estado de React** (`:118-130`).

---

### User Story 11 — La puesta en marcha dice qué falta, y no deja emitir en producción sin haber probado (Priority: P1)

Como dueño, quiero un checklist que me diga exactamente qué me falta para poder
facturar, para no descubrirlo con el primer cliente esperando el comprobante.

**Why this priority**: es lo que 4.9 pide como función nueva —«es lo que evita la
llamada "no puedo facturar"»— y la maqueta lo dibuja entero (`:709-733`). El
cuarto ítem que el pedido nombra es **«prueba en homologación hecha»**, y hoy
**no hay dónde guardar que se hizo, ni forma de hacerla desde la pantalla, ni
evidencia de que se haya hecho nunca**.

**Una pantalla que invite a emitir sin haber probado el circuito es peor que no
tener la pantalla.** Es la afirmación más cara de este hito.

**Independent Test**: entrar con una empresa sin nada configurado y verificar que
el checklist marca los cuatro pasos como pendientes con su acción; después
cargar todo y verificar que el cuarto **sigue pendiente** hasta que haya
evidencia de la prueba.

**Acceptance Scenarios**:

1. **Given** una empresa recién creada, **When** entro a `/facturacion`, **Then**
   veo el bloque **«Puesta en marcha»** con los cuatro pasos numerados, su
   descripción y su acción (`Favalio-Rediseno.dc.html:709-733`, `:1373-1378`).
2. **Given** el CUIT sin cargar, **When** miro, **Then** el paso está pendiente y
   su acción lleva a cargarlo.
3. **Given** el certificado sin subir, **When** miro, **Then** el paso está
   pendiente y explica el trámite en ARCA. Ya existe la guía escrita
   (`docs/GUIA_AFIP.md`).
4. **Given** el certificado subido, **When** miro, **Then** el paso muestra el
   **CUIT del certificado, su emisor y su vencimiento**. Los tres ya vienen de
   `GET /afip/cert-info` (`afip.js:56-66`).
5. **Given** un certificado **vencido**, **When** miro, **Then** el paso está en
   rojo y dice que hay que renovarlo.
6. **Given** un certificado que vence **pronto**, **When** miro, **Then** avisa
   con los días que faltan, como `Favalio-Rediseno.dc.html:1381` («595 días
   restantes»). Ver [PENDIENTE N8].
7. **Given** el CUIT del certificado distinto del CUIT configurado, **When**
   miro, **Then** **lo dice**. Hoy se aceptan por separado y el error aparece
   recién al firmar, como «Error al firmar el ticket de acceso»
   (`AUDITORIA-AFIP.md:215-217`). El dato para comparar ya está en pantalla
   (`Settings.jsx:310`).
8. **Given** un certificado y una clave que **no son pareja**, **When** los
   guardo, **Then** se rechaza en el momento, no al facturar.
9. **Given** el punto de venta sin declarar, **When** miro, **Then** el paso está
   pendiente. Y **cuando lo cargo, se verifica contra AFIP**: hoy se acepta
   cualquier entero y no hay ninguna llamada a `FEParamGetPtosVenta` en el
   repositorio. Ver [PENDIENTE N11].
10. **Given** los tres pasos anteriores completos y **sin prueba de
    homologación**, **When** miro el cuarto paso, **Then** **está pendiente** y
    dice qué hay que hacer. Ver [PENDIENTE 2].
11. **Given** el checklist incompleto, **When** miro el estado general, **Then**
    **no dice que está todo listo**. La maqueta dibuja el caso completo
    (`:712`: «Ya está completo — se conserva como referencia»); el caso que
    importa es el otro.
12. **Given** el estado de cada paso, **When** se lo prueba, **Then** sale de una
    **función pura** de `utils/puestaEnMarchaAfip.js`, que nunca devuelve
    `undefined` y que tiene un caso por cada combinación.

---

### User Story 12 — «Probar conexión» prueba la conexión de esta empresa (Priority: P1)

Como dueño, quiero que cuando la pantalla diga «Conectado a AFIP» sea porque mi
certificado funcionó, y no porque los servidores de AFIP están encendidos.

**Why this priority**: es el hallazgo A5, y es lo que sostiene el banner verde que
la maqueta dibuja arriba de todo (`:699-706`). Hoy ese banner sería **verde
siempre**: `FEDummy` no lleva credenciales (`afipService.js:114-122`), y encima
`Settings.jsx:82` lee mal la respuesta y muestra «Conectado» aunque la llamada
falle.

**Un cartel verde que no puede ponerse en rojo es peor que no tener cartel**: le
dice al dueño que puede facturar justo cuando no puede.

**Independent Test**: borrar el certificado de una empresa y apretar «Probar
conexión». Tiene que decir que no funciona. Verificable contra hoy, donde dice
«Conectado: API operativa».

**Acceptance Scenarios**:

1. **Given** una empresa **sin certificado**, **When** aprieto «Probar
   conexión», **Then** dice que **no** está conectada, y por qué.
2. **Given** un certificado que ARCA rechaza, **When** pruebo, **Then** vale lo
   mismo: la prueba tiene que **usar el certificado**, no solo preguntar si los
   servidores contestan.
3. **Given** una prueba correcta, **When** miro el banner, **Then** dice **con
   qué CUIT, contra qué ambiente y cuándo** fue la última prueba correcta.
4. **Given** el ambiente en **homologación**, **When** miro el banner, **Then**
   dice explícitamente que **los comprobantes de homologación no tienen validez
   fiscal**. El servidor ya lo registra así (`afipAuth.js:60-63`); la pantalla no
   lo dice.
5. **Given** una respuesta de `FEDummy` con alguno de sus tres campos caído,
   **When** la miro, **Then** la pantalla lo refleja. Hoy no se leen
   (`Settings.jsx:341` evalúa un campo que no existe).
6. **Given** que la llamada de estado **falla**, **When** miro, **Then** dice que
   no pudo comprobar. **No dice «Conectado»**, que es lo que hace hoy.
7. **Given** que la prueba usa el certificado, **When** se implementa, **Then**
   **no emite ningún comprobante en producción**. Una «prueba de conexión» que
   consume numeración correlativa no es una prueba. Ver [PENDIENTE 2].

---

### User Story 13 — La pantalla no afirma nada que el sistema no haga (Priority: P1)

Como dueño, quiero saber exactamente dónde queda mi clave privada y qué
protección tiene, para decidir con información si subo mi material fiscal.

**Why this priority**: es el hallazgo A11, y es la razón por la que este método
existe. La maqueta dice **«Las llaves privadas se guardan cifradas en el
servidor»** (`:730`), la guía dice **«El sistema cifra tu clave privada»**
(`GUIA_AFIP.md:45`), la pantalla actual dice **«se almacenan de forma segura en
tu servidor»** (`Settings.jsx:233-241`), y la maqueta además dice que el `.key`
**«queda en el servidor»** (`:1374`).

**Las cuatro son falsas.** Está en texto plano en `settings.value`, y la clave
del CSR **no** queda en el servidor: se devuelve al navegador y hay que
guardarla (`afipService.js:363`). Es la misma familia que `sendEmail` devolviendo
`ok: true`, en el lugar donde más caro sale: **si el cliente sube su clave
creyendo que se cifra, la decisión que tomó no fue la que creyó tomar.**

**Independent Test**: leer la pantalla terminada y verificar que cada afirmación
sobre seguridad es cierta contra el código.

**Acceptance Scenarios**:

1. **Given** la pantalla, **When** la leo, **Then** **no dice que la clave se
   guarda cifrada**, porque no se guarda cifrada.
2. **Given** la pantalla, **When** la leo, **Then** dice **qué se guarda y
   dónde**: el certificado y la clave quedan en la base de Favalio, asociados a
   la empresa, y no salen por la API.
3. **Given** el paso 1 del checklist, **When** lo leo, **Then** dice que la clave
   privada **se descarga y hay que guardarla**, porque el servidor no la
   conserva. La advertencia ya existe en el servicio (`afipService.js:363`) y la
   pantalla la contradice.
4. **Given** `docs/GUIA_AFIP.md:14` y `:45`, **When** se termina esto, **Then**
   **dicen lo mismo que la pantalla**. Dos documentos que describen la misma
   garantía de dos formas distintas es cómo empezó esto.
5. **Given** el proyecto de cifrado, **When** se lo nombra, **Then** la pantalla
   **no promete una fecha**: es el proyecto 6 de `PROXIMOS-PROYECTOS.md` y se
   hace junto con el token de TiendaNube.
6. **Given** la clave, **When** se muestra la sección de credenciales, **Then**
   se muestran **el nombre del archivo y su metadato**, como la maqueta
   (`:764-773`), y **nunca el contenido**, ni truncado ni «los últimos cuatro».
7. **Given** el circuito nunca probado en homologación, **When** el dueño está a
   punto de pasar a producción, **Then** **la pantalla lo dice**. Ver
   [PENDIENTE 2].

---

### User Story 14 — Ningún camino emite un comprobante fiscal por accidente (Priority: P1)

Como dueño, quiero que nada de esta pantalla —ni ningún endpoint que quedó vivo
detrás— pueda consumir un número de comprobante real sin que yo lo pida.

**Why this priority**: es el hallazgo A4. `POST /api/afip/invoice` sigue vivo con
permiso `ventas.crear` —que tiene el rol **vendedor**—, toma `type`, `amount` y
`pv` del cuerpo, **no mira el ambiente** y **no crea ninguna `Sale`**:
reintroduce el «CAE huérfano» que `POST /api/sales/:id/facturar` fue creado para
eliminar. Un comprobante emitido de más no se borra: se anula con una nota de
crédito, que **no existe** (proyecto 1).

**Independent Test**: con el ambiente en producción, verificar que ningún camino
de la pantalla llama a un endpoint que emita.

**Acceptance Scenarios**:

1. **Given** `POST /api/afip/invoice`, **When** se revisa, **Then** **o se
   elimina, o queda restringido a homologación** y deshabilitado con su motivo
   cuando `afip_environment` es `production`. Es lo que
   `PROXIMOS-PROYECTOS.md:150` ya dejó escrito. Ver [PENDIENTE N12].
2. **Given** que se conserve, **When** se lo llama, **Then** **el punto de venta
   sale de la configuración de la empresa**, no del cuerpo.
3. **Given** que se conserve, **When** se lo llama, **Then** exige un permiso que
   signifique «configurar la facturación», no `ventas.crear`, que tiene un
   cajero.
4. **Given** cualquier acción de la pantalla que pueda emitir, **When** la
   aprieto, **Then** **pide confirmación diciendo exactamente qué va a pasar**:
   qué tipo, con qué numeración y contra qué ambiente.
5. **Given** el cambio de ambiente a producción, **When** lo guardo, **Then**
   pide confirmación y dice que **los comprobantes pasan a ser reales**.
6. **Given** la guardia, **When** corre, **Then** falla si aparece un endpoint
   nuevo que emita sin mirar el ambiente.

---

### User Story 15 — Ajustes AFIP con el patrón del sistema (Priority: P2)

Como dueño, quiero que la pantalla de facturación se vea como el resto y que sus
errores me digan qué pasó.

**Why this priority**: es la mitad de diseño de 4.9. **La maqueta la dibuja
entera**, así que hay poco que decidir y mucho que copiar. Va en P2 porque las
cuatro historias anteriores son las que importan.

**Independent Test**: comparar `/facturacion` contra el bloque `isAfip` de la
maqueta.

**Acceptance Scenarios**:

1. **Given** la pantalla, **When** la miro, **Then** tiene los dos bloques que
   pide 4.9: **«Puesta en marcha»** a la izquierda y **«Datos de facturación»**
   a la derecha, en la grilla `minmax(0,1fr) 400px` de la maqueta (`:708`).
2. **Given** «Datos de facturación», **When** lo miro, **Then** tiene CUIT, punto
   de venta, condición de IVA, **ambiente como dos botones** (`:755-761`), las
   credenciales como archivos con su metadato y un «Reemplazar» (`:762-774`), y
   **«Desvincular AFIP»** en rojo con su explicación (`:778-784`).
3. **Given** «Desvincular», **When** lo aprieto, **Then** pide confirmación
   diciendo qué se pierde —«dejarás de poder emitir comprobantes fiscales»— y al
   confirmar borra el certificado, la clave y la configuración de esa empresa.
   **Hoy no existe.**
4. **Given** un error de validación del servidor, **When** lo veo, **Then** dice
   **«El certificado no es un PEM válido»**, que es lo que la API responde
   (`afip.js:91`). Hoy dice «Error al guardar: Request failed with status code
   400» (`Settings.jsx:128`).
5. **Given** los inputs de archivo, **When** los miro, **Then** declaran `accept`
   y un límite de tamaño (`Settings.jsx:287`, `:294`).
6. **Given** el archivo terminado, **When** lo reviso, **Then** está en `NOMBRES`
   de `guardiasDeDiseno.test.js` y **no tiene las cuatro clases de la paleta** de
   `:152`, `:154`, `:170` y `:321`.
7. **Given** las fechas y los números de la pantalla, **When** los miro, **Then**
   salen de `utils/formato.js`.
8. **Given** un usuario sin `config.editar`, **When** entra, **Then** ve la
   configuración y **no la puede cambiar**, con la explicación a la vista.
9. **Given** que hay ventas sin CAE, **When** miro la pantalla, **Then** lo dice
   y me lleva a reintentarlas. El endpoint y el botón ya existen
   (`sales.js:928`, `InvoicesList.jsx:427`). Ver [PENDIENTE N10].
10. **Given** las cuatro solapas que la maqueta dibuja —«Facturación AFIP»,
    «Empresa», «Equipo», «Suscripción» (`:1368`)—, **When** se decide qué hacer,
    **Then** **queda escrito**: hoy son cuatro rutas separadas del menú. Ver
    [PENDIENTE N14].

---

## Equipo

### User Story 16 — Invitar a alguien y que pueda entrar (Priority: P1)

Como dueño, quiero invitar a una persona a mi empresa y que esa persona pueda
aceptar la invitación y empezar a trabajar.

**Why this priority**: **hoy es imposible.** Son los hallazgos E1, E2 y E4: los
dos endpoints de invitación responden **404 siempre** (reproducido), el enlace
del mail apunta a una ruta que no existe en la aplicación, y el `catch` del
intento borra el token sin decir nada. Tres roturas independientes en la misma
cadena.

Incorporar gente es lo primero que hace un cliente nuevo después del onboarding.
Comprafit tiene dos personas más además del dueño (`legacy:9974-9977`).

**Independent Test**: crear una invitación, abrir su enlace y verificar que la
membresía queda creada. Verificable contra hoy, donde `GET /api/auth/invite/:token`
responde 404.

**Acceptance Scenarios**:

1. **Given** una invitación válida, **When** pido `GET /api/auth/invite/:token`,
   **Then** responde **200** con el email invitado, la empresa y el rol.
   Verificable contra hoy, donde responde 404 por el montaje de
   `server.js:422-423`.
2. **Given** esa invitación, **When** hago `POST /api/auth/accept-invite/:token`
   con sesión, **Then** **se crea la membresía** con el rol de la invitación y la
   invitación queda `accepted`. Hoy responde 404.
3. **Given** el enlace del mail, **When** lo abro, **Then** **la aplicación lo
   atiende**. Hoy `services/email.js:90` linkea a `/accept-invite/:token` y
   `App.jsx:275-304` no tiene esa ruta: el `<main>` queda vacío.
4. **Given** que la aceptación falla, **When** pasa, **Then** **se dice y el
   token no se descarta en silencio**. Hoy el `catch` lo borra
   (`App.jsx:148-150`) y no se reintenta nunca.
5. **Given** un token **vencido**, **When** lo uso, **Then** no se crea ninguna
   membresía y el mensaje dice que venció.
6. **Given** un token **ya usado** o inexistente, **When** lo uso, **Then** vale
   lo mismo, con un mensaje que lo distinga del anterior.
7. **Given** que la persona se registró con **otro email** que el invitado,
   **When** intenta aceptar, **Then** **la pantalla lo explica**. Hoy
   `routes/auth.js:13-20` matchea por email y falla en silencio; no hay
   Management API de Auth0, así que invitar **no crea nada** del otro lado
   (`middleware/auth.js:107-122`).
8. **Given** un miembro **desactivado** con una invitación vieja `pending` de un
   rol más alto, **When** la acepta, **Then** **no se reactiva ni se
   re-promociona solo**. Hoy `routes/auth.js:39` hace
   `ue.update({ is_active: true, role: invitacion.role })` y nada invalida la
   invitación al desactivar al miembro. Ver [PENDIENTE N15].
9. **Given** los dos endpoints, **When** se los prueba, **Then** el test es de
   **integración**: hace el request de verdad. **Es el único nivel que podía
   encontrar E1**, y es exactamente por eso que E1 lleva ahí sin que nadie lo
   note.
10. **Given** `server.js`, **When** corre la guardia estática, **Then** **falla
    si un `Router` se monta con `app.get`/`app.post` en vez de `app.use`**. Sin
    eso, el próximo endpoint que se monte así vuelve a responder 404 sin que
    ninguna guardia lo vea.

---

### User Story 17 — La pantalla dice la verdad sobre el mail (Priority: P1)

Como dueño, quiero saber si el mail de invitación salió o no, para poder pasarle
el enlace a mano si no salió.

**Why this priority**: es el hallazgo E3 y es **uno de los tres motivos por los
que existe este método**. `CONVENCIONES.md` lo pone así: «`sendEmail` devolvía
`ok: true` sin haber enviado nada. Las invitaciones se perdían en silencio y
quien invitaba veía "enviada"».

**El servicio ya está arreglado** (`services/email.js:34-63`), con su comentario
y su test (`tests/observabilidad.test.js:125-144`), y la ruta propaga
`email_enviado` y un mensaje que dice qué hacer (`empresas.js:687-694`). **Lo que
quedó sin hacer es la mitad que llega al usuario**: `Team.jsx:85` hace
`toast.success('Invitación enviada')` incondicionalmente. El agujero se mudó del
servicio a la pantalla.

**Independent Test**: con `api.post` devolviendo `email_enviado: false`,
verificar que la pantalla **no** dice «Invitación enviada». Verificable contra
hoy, donde lo dice igual.

**Acceptance Scenarios**:

1. **Given** que el mail **no salió**, **When** invito, **Then** la pantalla
   **no dice «Invitación enviada»**: dice que la invitación se creó y que el mail
   no salió. El servidor ya manda ese texto exacto (`empresas.js:692-693`).
2. **Given** ese caso, **When** lo miro, **Then** **veo el enlace de invitación**
   para pasarlo a mano, con un botón de copiar. Es lo que el mensaje del servidor
   ya me pide que haga.
3. **Given** una invitación pendiente, **When** la miro, **Then** tengo un botón
   de **reenviar**. El endpoint existe y devuelve 502 honesto cuando el mail
   falla (`empresas.js:716-727`), y **no lo llama nadie**: no hay botón ni helper
   en `services/api.js:402-410`.
4. **Given** que el reenvío falla, **When** lo miro, **Then** vale lo mismo que
   el escenario 1.
5. **Given** que el mail **sí** salió, **When** invito, **Then** lo dice, y dice
   a qué dirección.
6. **Given** el servidor sin `RESEND_API_KEY`, **When** invito, **Then** la
   pantalla lo refleja. El servicio ya devuelve `error: 'EMAIL_NO_CONFIGURADO'`
   y loguea; lo que falta es que el usuario se entere.
7. **Given** cualquier error de la API, **When** lo veo, **Then** viene de
   `mensajeDeError`. Hoy `Team.jsx:87` muestra el código crudo y un 403 dice
   literalmente **«FORBIDDEN»** (`middleware/checkPermission.js:40-43`).
8. **Given** que la carga del equipo falla con 403, **When** miro, **Then** dice
   **«no tenés permiso»**. Hoy es `console.error` y se dibuja «Sin miembros aún»
   (`Team.jsx:65`, `:137-140`): **un equipo vacío, que es una respuesta
   distinta**.

---

### User Story 18 — Una empresa no se puede quedar sin nadie que la administre (Priority: P1)

Como dueño, quiero que el sistema no me deje degradarme a mí mismo ni sacar al
último administrador, porque después no hay forma de volver atrás.

**Why this priority**: es el hallazgo E5, y su modo de falla es **permanente**.
Degradar al único `admin` deja la empresa sin nadie con `config.editar` ni
`equipo.invitar`: **nadie puede promover a nadie ni invitar**, y solo se sale
entrando a la base o con un superadmin. Y la pantalla lo facilita: el selector de
rol se dibuja en todas las filas, incluida la propia, sin `disabled` y sin
confirmación (`Team.jsx:152-170`).

**Independent Test**: con un solo admin, intentar degradarlo. Tiene que ser
rechazado por la API. Verificable contra hoy, donde se acepta.

**Acceptance Scenarios**:

1. **Given** una empresa con **un solo** admin activo, **When** intento
   degradarlo, **Then** **se rechaza**, con un mensaje que explique por qué. Hoy
   `routes/empresas.js:788-798` no chequea nada.
2. **Given** ese mismo caso, **When** intento desactivarlo (`is_active:false`),
   **Then** vale lo mismo.
3. **Given** mi propia fila, **When** miro la pantalla, **Then** el selector de
   rol está **deshabilitado con su explicación**. Hoy se dibuja igual que las
   demás.
4. **Given** mi propia fila, **When** mando el request a mano, **Then** **la API
   lo rechaza igual**. La regla vive en el servidor; la pantalla es la cortesía.
5. **Given** dos admins, **When** degrado a uno, **Then** se puede.
6. **Given** que la regla se aplica en los dos lados, **When** se la prueba,
   **Then** es una **función pura** compartida —«esta fila se puede cambiar»— y
   no dos condiciones escritas por separado que empiezan iguales y terminan
   distintas.
7. **Given** el escenario del último admin, **When** se lo prueba, **Then** es un
   test de **integración**: la afirmación es que la fila **quedó como estaba** en
   la base, no que el handler llamó a algo.
8. **Given** la pantalla, **When** quiero sacar a alguien del equipo, **Then**
   **puedo**. Hoy no hay endpoint de eliminar miembro y la pantalla no expone la
   desactivación (hallazgo E12).

---

### User Story 19 — Ver quién entró, y desde dónde (Priority: P2)

Como dueño, quiero ver quién de mi equipo tiene sesión abierta y poder cerrarla,
como lo tenía en el sistema viejo.

**Why this priority**: es lo único que 4.11 pide como función, y el legacy lo
tenía. Va en P2 porque **no existe absolutamente nada** de dónde partir —ni
columna, ni tabla, ni registro— y porque la decisión de qué construir es
[PENDIENTE 1].

**Lo que el legacy mostraba es la vara** (`legacy:10044-10061`): el dispositivo
—celular o computadora, deducido del user-agent—, el usuario, la hora de inicio,
un badge «Este dispositivo», un botón «Cerrar» por sesión y un «Cerrar todas
(menos yo)».

**Y la diferencia importa**: el último acceso por usuario —la opción simple que
el plan propone— **muestra** pero **no puede cerrar nada**. Es la mitad de lo que
Comprafit tenía. Decirlo es parte del trabajo.

**Independent Test**: entrar con dos usuarios distintos y verificar que la
pantalla lo refleja.

**Acceptance Scenarios**:

1. **Given** un miembro que entró, **When** miro la pantalla, **Then** veo cuándo
   fue la última vez. Hoy **no hay ninguna columna**: `usuarios` tiene cinco y
   `usuario_empresas` nueve, y ninguna es de acceso.
2. **Given** un miembro que **nunca** entró, **When** lo miro, **Then** lo dice,
   y **no muestra una fecha vacía ni «Invalid Date»**.
3. **Given** la fecha, **When** la miro, **Then** sale de `utils/formato.js`. Hoy
   `Team.jsx:208` y `:213` usan `toLocaleDateString()` a mano.
4. **Given** que se elija registrar el último acceso, **When** se escribe,
   **Then** **no agrega un `UPDATE` por request**. `loadEmpresaContext`
   (`middleware/auth.js:107-124`) toca la fila del usuario en **cada** request y
   ya hace un `update` condicional en `:121`: el lugar existe, y la frecuencia de
   escritura es la decisión.
5. **Given** que se elija listar sesiones de Auth0, **When** se escribe, **Then**
   hace falta la Management API, que **hoy no está en el repositorio**, con sus
   credenciales, su rate limit y su manejo de error.
6. **Given** cualquiera de las dos, **When** se decide, **Then** **queda escrito
   si se puede cerrar una sesión ajena o no**, porque es la mitad de lo que el
   legacy hacía y la que el último acceso no cubre.
7. **Given** un usuario sin `equipo.ver`, **When** entra, **Then** no ve nada de
   esto.
8. **Given** el superadmin de plataforma, **When** opera sobre esta empresa,
   **Then** **no aparece en la lista**: no tiene fila en `usuario_empresas` y por
   eso sale gratis (`PLAN-COMPRAFIT.md`, sección 3, «Invisibilidad»). **No se
   agrega ningún filtro especial** que después alguien pueda romper.

---

### User Story 20 — Equipo con el patrón del sistema, y sin filtrar identificadores internos (Priority: P2)

Como dueño, quiero que la pantalla de Equipo se vea como las demás y que no
publique datos internos de la plataforma.

**Why this priority**: es la mitad de diseño de 4.11 más los hallazgos E7, E9,
E10 y E11. El E7 es el que más pesa: `GET /:empresaId/usuarios` devuelve la fila
entera de `Usuario`, incluidos `auth0_sub` y `es_superadmin`
(`empresas.js:751-754`), con `equipo.ver` — que tiene también `gerente`.

**Independent Test**: pedir el listado y verificar que la respuesta no trae
`auth0_sub` ni `es_superadmin`.

**Acceptance Scenarios**:

1. **Given** el listado de miembros, **When** lo pido, **Then** **no trae
   `auth0_sub` ni `es_superadmin`**. El molde está en el mismo archivo:
   `empresas.js:633` limita el `include` del invitador a `['id','nombre','email']`.
2. **Given** la tabla, **When** la miro, **Then** usa `TablaGrid` con el mismo
   `grid-template-columns` en encabezado y filas, y **ningún `Table*`**
   (`Team.jsx:9-16` hoy).
3. **Given** una fila, **When** la toco, **Then** se abre un **panel lateral**
   con el detalle del miembro. Hoy el rol se cambia con un `Select` en línea y
   todo lo demás vive en un `Dialog`.
4. **Given** un miembro con rol **`gerente`**, **When** lo miro, **Then** dice
   «Gerente». Hoy `ROLE_LABELS` (`Team.jsx:37-42`) no lo tiene: el selector queda
   vacío y **solo se lo puede degradar** a uno de los cuatro listados.
5. **Given** cualquier rol nuevo, **When** se agrega, **Then** **la etiqueta y el
   tono salen del mismo lugar**, con las mismas claves, para que agregar uno sin
   etiqueta sea imposible (`REGLAS-DISENO.md:454-467`).
6. **Given** un miembro **desactivado**, **When** lo miro, **Then** la columna
   Estado lo dice. Hoy está clavada en «Activo» para todas las filas y **ni
   siquiera lee `is_active`** (`Team.jsx:171-175`).
7. **Given** una invitación **vencida**, **When** la miro, **Then** se distingue
   de una pendiente.
8. **Given** un usuario sin `equipo.invitar`, **When** miro, **Then** el botón de
   invitar está **deshabilitado con su explicación**. Hoy se dibuja siempre
   (`Team.jsx:122`) y no se importa `Can`.
9. **Given** el permiso de cambiar el rol, **When** se lo revisa, **Then** dice
   lo que hace. Hoy pide `config.editar` (`empresas.js:788`) y el catálogo no
   tiene `equipo.editar` (`seedPermissions.js:62-64`). Ver [PENDIENTE N9].
10. **Given** `POST /:empresaId/usuarios`, **When** se lo revisa, **Then** **o
    valida el rol contra el catálogo, o se elimina**. Hoy acepta cualquier string
    y el hook `beforeCreate` (`UsuarioEmpresa.js:46-52`) deja el miembro **con
    cero permisos, sin ningún aviso** — y **no lo usa nadie**. Ver
    [PENDIENTE N13].
11. **Given** `POST /invitaciones/:token/re-enviar`, **When** se lo revisa,
    **Then** lleva `requireEmpresa` y busca el token **acotado a la empresa**.
    Hoy es la única ruta de equipo sin scoping (`empresas.js:701-707`).
12. **Given** el archivo terminado, **When** lo reviso, **Then** está en
    `NOMBRES` de `guardiasDeDiseno.test.js` y las fechas salen de
    `utils/formato.js`.

---

## Transversal

### User Story 21 — El gate de módulo está en la ruta y no solo en el menú (Priority: P2)

Como operador de la plataforma, quiero que una empresa sin un módulo no pueda
entrar a esa pantalla escribiendo la URL.

**Why this priority**: es el hallazgo T1 y el plan lo dice en la sección 2: «el
gateo va en los tres lados o no sirve». Va en P2 y no en P1 por un motivo
escrito: cerrar cada una **exige mirar en producción qué empresas tienen ese
módulo en `enabled_modules`**, porque una que no lo tenga pierde la pantalla y
redirige a `/pos` (`marcoDePantalla.test.js:160-180`). Cuatro revisiones de
producción metidas en un commit de rediseño es exactamente lo que esa deuda
separa.

**Independent Test**: con el módulo apagado, escribir la URL y verificar que
`RouteGuard` corta, como hace `/ordenes-compra`.

**Acceptance Scenarios**:

1. **Given** una empresa sin `gastos` en `enabled_modules`, **When** escribo
   `/gastos`, **Then** `RouteGuard` corta. Ídem `/panel`, `/facturacion` y
   `/team`.
2. **Given** cada una que se cierre, **When** se la saca de `SIN_GUARD_TODAVIA`,
   **Then** **se le pone el guard en el mismo cambio**. La guardia falla en las
   dos direcciones (`marcoDePantalla.test.js:178-179`).
3. **Given** las cuatro, **When** se decide, **Then** **se cierran de a una, cada
   una con su verificación en producción**, y no las cuatro en un commit. Ver
   [PENDIENTE 6].
4. **Given** el ítem del menú y la ruta, **When** se los compara, **Then**
   declaran **el mismo módulo**. Si difieren, el menú esconde el ítem y la URL
   entra igual, que es lo que pasaba con `/proveedores`
   (`navegacion.js:50-53`).
5. **Given** las cuatro rutas, **When** corre
   `pruebas-de-navegador/marcoDeLasPantallas.navegador.js`, **Then** **siguen
   siendo dieciocho**: no se agrega ninguna ruta en esta funcionalidad.

---

### Edge Cases

**Gastos**

- **Un gasto de importe cero.** Se puede cargar y suma cero. ¿Se muestra?
- **Un gasto de importe negativo.** El input es `type="number"` sin `min`
  (`Expenses.jsx:191`): un negativo baja el punto de equilibrio y nadie lo
  advierte.
- **Un gasto con importe no numérico.** `parseFloat(e.amount)` da `NaN` y el
  total entero se convierte en `NaN`.
- **Una empresa sin sucursales.** `puntosDeVenta` vacío: no hay ninguna tarjeta y
  el bucket «General» —que hoy no tiene tarjeta— es el único que existe.
- **Una sucursal que se llama «General».** Desaparece de los totales
  (`Expenses.jsx:126`).
- **Un gasto colgado de una sucursal que se borró.** La FK no dice qué pasa.
- **Un gasto variable del mes que viene.** El input de mes lo permite; el resumen
  y el total no dicen que es futuro.
- **Dos gastos con el mismo nombre.** Se puede, y no hay nada que los distinga en
  la lista más que el importe.
- **Cientos de gastos variables acumulados.** No hay paginación en ninguna de las
  dos solapas.

**Panel**

- **Una empresa sin ninguna venta.** Todos los indicadores en cero. El delta
  contra el mes anterior divide por cero.
- **El día 1 del mes a las 00:05.** «Mes actual» tiene una venta y «mes anterior»
  el mes entero: el delta dice −99 % y no aclara que el mes está empezando.
- **Una venta el día 1.** Se cuenta dos veces (P4).
- **Una venta a las 22:00 del último día del mes.** Cae en el mes siguiente para
  el Panel y en el actual para el Historial (P5).
- **Una venta anulada.** El Panel no la cuenta, el Historial sí, a propósito
  (P14). La diferencia hay que decirla.
- **Un cliente que pagó exactamente lo que debía.** Puede aparecer con deuda por
  el residuo de punto flotante (P2, escenario 4).
- **Un proveedor con más pagos que deuda** —un anticipo—. `deuda − pagado` da
  negativo: ¿saldo a favor, o cero?
- **Un producto en cero sin `min_stock` cargado.** No alerta nunca en el Panel y
  sí en Faltantes (P10).
- **Quinientos clientes.** Mil consultas en serie por cada carga del Panel (P16).
- **Un rol con `dashboard.ver` y sin `stock.ver`.** El `Promise.all` rechaza y el
  Panel queda entero en `-` (P9).
- **`fixed_expenses_total` en cero, que es el default.** El simulador arranca en
  $2.400.000 (P7).

**AFIP**

- **Un certificado vencido.** `cert-info` lo devuelve y nadie compara contra hoy.
- **Un certificado que vence en tres días.** No avisa nada.
- **Un certificado y una clave que no son pareja.** Se aceptan, y el error
  aparece al facturar como «Error al firmar el ticket de acceso».
- **El CUIT del certificado distinto del CUIT configurado.** Se acepta.
- **Un PEM corrupto por `PUT /api/settings/afip_cert`.** Se guarda sin validar
  (A3).
- **Cambiar el ambiente por `PUT /api/settings/afip_environment`.** El ticket
  WSAA del ambiente anterior **queda cacheado en memoria** (A3).
- **Guardar la configuración sin tocar el certificado.** Ya está resuelto y
  documentado (`afip.js:132-141`): la cadena vacía se saltea. **No se puede
  reabrir**: la versión anterior borraba el certificado y la clave, y era
  irreversible.
- **Generar el CSR y no descargar la clave.** Se pierde: el servidor no la
  guarda. La pantalla dice lo contrario (A11).
- **`FEDummy` responde con `DbServer: 'ERROR'`.** La pantalla no lee los tres
  campos y dice «Conectado» igual.
- **Emitir con el ambiente sin configurar.** Cae a homologación y **lo registra**
  (`afipAuth.js:60-63`). La pantalla no lo dice.
- **Una empresa con dos sucursales y un solo punto de venta de ARCA.** Comparten
  numeración correlativa. Es el proyecto 5b y no entra; **la pantalla lo tiene
  que poder decir**.
- **La suscripción vencida.** `/api/afip` pasa por `checkSubscription`: no se
  puede configurar la facturación con la suscripción vencida. ¿Es lo que se
  quiere?

**Equipo**

- **Invitar a alguien que ya es miembro.** ¿Se rechaza, o se cambia el rol?
- **Invitar dos veces al mismo email.** Dos tokens vivos para la misma persona.
- **Aceptar una invitación con un miembro desactivado y una invitación vieja de
  rol más alto.** Se reactiva y se promociona solo (E1, escenario 8).
- **Aceptar una invitación de una empresa con la suscripción vencida.**
  `/api/auth` está exento del paywall (`checkSubscription.js:32`).
- **Aceptar una invitación de una empresa desactivada.** `routes/auth.js` no
  chequea `Empresa.is_active`.
- **El único admin se degrada a sí mismo.** La empresa queda bloqueada (E5).
- **El único admin se desactiva a sí mismo.** Además pierde la empresa del
  selector (`middleware/auth.js:196-200`).
- **Un rol escrito mal por `POST /:empresaId/usuarios`.** Miembro con cero
  permisos y ningún aviso (E11).
- **Un miembro con rol `gerente`.** El selector queda vacío y solo se lo puede
  degradar (E9).
- **Una invitación vencida que sigue en la lista.** `GET /invitaciones` devuelve
  todas, no solo las `pending` (`empresas.js:629-640`).
- **Dos pestañas aceptando la misma invitación.** No hay guarda de idempotencia
  más allá del `findOrCreate`.
- **Auth0 sin devolver email.** Se asigna un `...placeholder`
  (`middleware/auth.js:112`) y la invitación **no se puede aceptar nunca**.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Transversales a las cuatro pantallas

- **FR-001**: Cada una de las cuatro rutas DEBE llevar `RouteGuard` con **el
  mismo módulo** que declara su ítem de menú, o quedar explícitamente sin módulo
  en los dos lados.
- **FR-002**: Cada ruta que se cierre DEBE salir de `SIN_GUARD_TODAVIA`
  (`marcoDePantalla.test.js:181-190`) **en el mismo cambio** que le pone el
  guard, y cada cierre DEBE ir en su propio corte revertible.
- **FR-003**: Antes de cerrar cada una DEBE verificarse qué empresas tienen ese
  módulo en `enabled_modules`. Una empresa sin el módulo pierde la pantalla.
- **FR-004**: La lista de `pruebas-de-navegador/marcoDeLasPantallas.navegador.js`
  DEBE seguir con **dieciocho** rutas: esta funcionalidad no agrega ninguna.
- **FR-005**: `pages/Expenses.jsx`, `components/GastosVariables.jsx`,
  `pages/Dashboard.jsx`, `pages/Settings.jsx` y `pages/Team.jsx` DEBEN entrar en
  `NOMBRES` de `guardiasDeDiseno.test.js` **antes** de reescribirse, y el ancla
  de cantidad (`:366`) DEBE subir con ellos.
- **FR-006**: Ninguno de esos cinco archivos DEBE contener hexadecimales, reglas
  `dark:`, clases de la paleta de Tailwind ni componentes `Table*` de shadcn.
- **FR-007**: Las tablas de Gastos y de Equipo DEBEN usar `TablaGrid` /
  `Encabezado` / `Fila` / `BotonDeFila`, con el **mismo string** de
  `grid-template-columns` en el encabezado y en las filas.
- **FR-008**: Las cuatro pantallas DEBEN usar `mensajeDeError` de
  `utils/erroresDeApi.js`. **Ningún `catch` DEBE mostrar `err.message`**, que en
  axios es «Request failed with status code 500».
- **FR-009**: **Ningún fallo de carga DEBE quedar en un `console.error`.** Los
  tres actuales (`Expenses.jsx:35`, `Dashboard.jsx:64`, `Team.jsx:65`) DEBEN
  mostrar en pantalla que algo falló, y distinguir «no tenés permiso» de «no se
  pudo cargar».
- **FR-010**: Ningún importe DEBE formatearse con `toLocaleString` en línea.
  Todos salen de `utils/formato.js`.
- **FR-011**: Todo importe DEBE escribirse `1.234,50` **independientemente de la
  configuración regional del navegador**, y con dos decimales siempre.
- **FR-012**: Toda fecha DEBE salir de `utils/formato.js`. Un `DATEONLY` NO DEBE
  pasar por `new Date(...)`, que lo lee como UTC y muestra el día anterior.
- **FR-013**: La guardia de `formato.test.js` DEBE detectar el formateo **en
  línea**, que es el camino por el que estas cuatro pantallas la esquivan. Hoy
  solo mira funciones declaradas y `*FractionDigits`.
- **FR-014**: Cada pantalla DEBE tener su test de render en
  `apps/web/src/tests/renderDe*.test.jsx`.
- **FR-015**: Cada regla —agrupado, severidad, estado, tono, etiqueta— DEBE vivir
  en una **función pura** de `utils/` con su test, y no adentro de un componente.
- **FR-016**: Cada uno de los defectos de plata, de aislamiento y de montaje DEBE
  tener un **test de integración contra Postgres** que falle si se revierte la
  corrección.
- **FR-017**: Cada acción que la API pueda rechazar por permisos DEBE dibujarse
  **deshabilitada con su explicación**, y no ausente ni habilitada.
- **FR-018**: Las cuatro pantallas DEBEN usar `PageHeader`.
- **FR-019**: Cada estado vacío DEBE decir algo distinto del resto: no alcanza
  con reusar el texto.

#### Gastos

- **FR-020**: **Ningún gasto fijo DEBE quedar afuera de todos los grupos.** La
  suma de lo que la pantalla dibuja DEBE ser el total de `fixed_expenses` de la
  empresa.
- **FR-021**: **Ningún gasto fijo DEBE aparecer en más de un grupo.**
- **FR-022**: Un gasto sin sucursal DEBE aparecer en «General», sin importar qué
  tenga en `group`.
- **FR-023**: El bucket «General» DEBE tener su tarjeta de total, y los grupos NO
  DEBEN filtrarse por su nombre.
- **FR-024**: El agrupado DEBE ser una función pura de `utils/` con su test.
- **FR-025**: DEBE quedar escrito qué pasa con las filas que hoy tienen `group`
  `'gf1'`/`'gf2'` y `punto_de_venta_id` nulo —incluidas las que produce
  `scripts/migrar-legacy.js:379`—: se migran, o el agrupado las interpreta
  explícitamente. Ver [PENDIENTE 4].
- **FR-026**: El total de gastos fijos, por grupo y general, **lo DEBE calcular
  el servidor**.
- **FR-027**: Toda suma de plata DEBE hacerse en **centavos enteros**, como
  `utils/cuentaDeProveedor.js`, y NO acumulando `parseFloat`.
- **FR-028**: `GET /api/expenses` DEBE devolver los totales junto con las filas.
- **FR-029**: `POST` y `PUT` de gastos fijos y variables DEBEN verificar que
  `punto_de_venta_id` sea **de la empresa de la sesión** antes de escribir, con
  `findScoped` / `assertEmpresaId`.
- **FR-030**: `POST /api/expenses` NO DEBE hacer `{ ...req.body }`: DEBE tomar
  solo los campos que corresponden.
- **FR-031**: `group` NO DEBE poder escribirse desde el cuerpo del request.
- **FR-032**: Ninguna de las cuatro escrituras DEBE aceptar `empresa_id` ni `id`
  del cuerpo.
- **FR-033**: El detector del «padre ajeno» de `aislamientoEmpresas.test.js` DEBE
  encontrar las **dos formas nuevas**: el `create` con un objeto armado antes, y
  el valor `campo_id || null`. Cada corrección DEBE ejercitarse contra una
  **muestra sintética con el defecto**, exigiendo que lo nombre con archivo y
  línea.
- **FR-034**: Un gasto fijo DEBE poder editarse desde la pantalla. El endpoint ya
  existe (`general.js:342`).
- **FR-035**: El mes de los gastos variables DEBE salir de la fecha del negocio y
  NO de `toISOString()`.
- **FR-036**: La solapa de gastos fijos DEBE gatear sus acciones con `Can`, como
  ya hace la de variables.
- **FR-037**: DEBE quedar escrito si `GET /api/expenses` respeta la sucursal
  activa o devuelve la empresa entera, y la pantalla DEBE decir cuál de las dos.
- **FR-038**: Las dos solapas DEBEN ser **segmentos**, con la forma de
  `Favalio-Rediseno.dc.html:645-648`.
- **FR-039**: La edición DEBE ir en **panel lateral** de 520px con
  `max-w-[92vw]`, y no en un modal.

#### Panel de control

- **FR-040**: «Por Pagar» DEBE ser **deuda menos pagos**, igual que la pantalla
  de Proveedores. Registrar un pago DEBE bajar el número.
- **FR-041**: La definición del saldo de un proveedor DEBE estar **en un solo
  lugar**. Hoy hay cuatro implementaciones y una está mal.
- **FR-042**: Los tramos del aging de «Por Pagar» NO DEBEN calcularse acumulando
  en punto flotante antes de compararse contra un corte.
- **FR-043**: «Por Cobrar» y «clientes con deuda» DEBEN contar **solo las ventas
  a cuenta corriente** (`is_credit`), igual que `customerService.js:64-66`.
- **FR-044**: Un cliente que pagó **exactamente** lo que debía NO DEBE contarse
  con deuda. La comparación DEBE ser en centavos enteros.
- **FR-045**: Los cuatro tramos del aging de «Por Cobrar» DEBEN sumar el total
  que la tarjeta muestra.
- **FR-046**: Una venta NO DEBE contarse en dos períodos a la vez. Los cortes de
  mes DEBEN ser semiabiertos, como ya son los del aging (`:174-177`).
- **FR-047**: El porcentaje de crecimiento DEBE decir que compara un mes parcial
  contra uno completo, o comparar períodos comparables.
- **FR-048**: Todos los cortes de fecha del Panel DEBEN usar `hoyDelNegocio` /
  `fechaDelNegocio` de `utils/fechas.js`, con la zona de la empresa. **Ninguno
  DEBE usar `new Date().toISOString()`.**
- **FR-049**: `GET /api/dashboard/kpis` NO DEBE devolver datos que el usuario no
  puede leer por su propia pantalla: saldo de caja sin `caja.ver`, cuentas por
  cobrar sin `clientes.ver`, gastos fijos sin `gastos.ver`.
- **FR-050**: Una tarjeta que no se puede calcular por permisos NO DEBE dibujarse
  en cero: no se dibuja.
- **FR-051**: El simulador de precios NO DEBE arrancar con ningún valor
  inventado. Sin datos, dice qué falta.
- **FR-052**: Los gastos fijos del simulador DEBEN salir de **la misma fuente**
  que la tarjeta de gastos fijos del Panel.
- **FR-053**: El simulador NO DEBE mostrar `NaN` con un campo vacío, y DEBE decir
  claramente cuándo no hay precio que cierre.
- **FR-054**: `settings.fixed_expenses_total` y la suma real de `fixed_expenses`
  NO DEBEN coexistir como dos números con la misma etiqueta. Ver [PENDIENTE N7].
- **FR-055**: Un fallo en uno de los pedidos del Panel NO DEBE impedir que se
  dibujen los demás.
- **FR-056**: El Panel DEBE distinguir «cero» de «no se pudo calcular».
- **FR-057**: El aviso de faltantes de «Requiere tu atención» DEBE contar **lo
  mismo** que la pantalla a la que lleva. Ver [PENDIENTE 3].
- **FR-058**: Cada aviso DEBE tener **una sola fuente**. `kpis.alerts` o
  `GET /api/alerts`, no los dos.
- **FR-059**: DEBE quedar escrito si los indicadores son de la sucursal activa o
  de la empresa, y la etiqueta DEBE decirlo. Hoy el Panel y Caja difieren bajo la
  misma etiqueta. Ver [PENDIENTE N2].
- **FR-060**: «Proy. 30d» DEBE decir que supone un crecimiento del 10 %. El dato
  ya viene en `supuesto_crecimiento`.
- **FR-061**: El Panel y el Historial de ventas DEBEN decir lo mismo sobre las
  ventas del período, o la pantalla DEBE explicar la diferencia —hoy es que el
  Historial cuenta las anuladas a propósito—.
- **FR-062**: `_customerStats` NO DEBE hacer dos consultas por cliente. El molde
  está en `suppliers.js:307-311`.
- **FR-063**: Los `include` de `Product` de `dashboardService.js:279`, `:300` y
  `general.js:464`, `:475` DEBEN filtrar por empresa.
- **FR-064**: DEBE existir «Requiere tu atención» con faltantes, ventas sin CAE y
  vencimientos de stock, cada uno con su acción a la pantalla que lo detalla.
- **FR-065**: Un aviso con cero casos NO DEBE dibujarse.
- **FR-066**: La severidad, el orden y la etiqueta de los avisos DEBEN salir de
  una función pura.
- **FR-067**: DEBE haber **cuatro** tarjetas de indicador con su sparkline de
  doce barras, como `Favalio-Rediseno.dc.html:237-255`.
- **FR-068**: El sparkline DEBE salir de datos reales. Sin datos suficientes, NO
  se dibuja.
- **FR-069**: El sparkline NO DEBE agregar ninguna librería de gráficos.

#### Facturación AFIP

- **FR-070**: `GET /api/settings` NO DEBE devolver `afip_cert` ni `afip_key`, ni
  enteros ni parciales.
- **FR-071**: `GET /api/settings/:key` NO DEBE devolver ninguna clave sensible.
- **FR-072**: `PUT /api/settings/:key` NO DEBE poder escribir `afip_cert`,
  `afip_key`, `afip_environment` ni `afip_pv`. El único camino es
  `POST /api/afip/setup`.
- **FR-073**: La lista de claves que no salen DEBE estar **en un solo lugar**,
  usada por los tres endpoints y por `scripts/backup.js`.
- **FR-074**: DEBE existir una **guardia** que falle si una clave sensible nueva
  no entra en esa lista, y un test de integración que verifique que la cadena
  `-----BEGIN` no aparece en el cuerpo de `GET /api/settings`.
- **FR-075**: `POST /api/afip/setup` DEBE seguir siendo el único camino que
  valida los PEM, los exige juntos e invalida el cache del ticket WSAA. **La
  guarda de la cadena vacía (`afip.js:132-141`) NO se toca.**
- **FR-076**: Cambiar el ambiente DEBE invalidar el ticket WSAA cacheado, por
  cualquier camino.
- **FR-077**: `POST /api/afip/invoice` DEBE eliminarse, o quedar **restringido a
  homologación**, deshabilitado con su motivo en producción, con el punto de
  venta de la configuración y con un permiso que signifique «configurar la
  facturación». Ver [PENDIENTE N12].
- **FR-078**: Toda acción que pueda emitir un comprobante DEBE pedir confirmación
  diciendo el tipo, la numeración y el ambiente.
- **FR-079**: «Probar conexión» DEBE **usar el certificado de la empresa**.
  `FEDummy` solo dice si los servidores de AFIP contestan.
- **FR-080**: La pantalla NO DEBE decir «Conectado» cuando la comprobación falló
  ni cuando lo único que respondió fue `FEDummy`. El bug de lectura de
  `Settings.jsx:82` DEBE corregirse.
- **FR-081**: El banner DEBE decir contra **qué ambiente** está configurada la
  empresa, y en homologación DEBE decir que **los comprobantes no tienen validez
  fiscal**.
- **FR-082**: «Probar conexión» NO DEBE emitir ningún comprobante en producción.
- **FR-083**: DEBE existir el bloque «Puesta en marcha» con los cuatro pasos que
  nombra 4.9: CUIT cargado, certificado subido y vigente, punto de venta
  declarado, prueba en homologación hecha.
- **FR-084**: El cuarto paso DEBE poder marcarse. Dónde vive esa evidencia es
  [PENDIENTE 2].
- **FR-085**: El checklist NO DEBE decir que está completo si algún paso no lo
  está.
- **FR-086**: El estado de cada paso DEBE salir de una función pura que nunca
  devuelva `undefined`.
- **FR-087**: `POST /api/afip/setup` DEBE verificar que el certificado y la clave
  **sean pareja**, y rechazar si no lo son.
- **FR-088**: DEBE compararse el CUIT del certificado contra el CUIT configurado
  y avisar si difieren. El dato ya está en pantalla.
- **FR-089**: DEBE avisarse antes de que el certificado venza, con los días
  restantes. Ver [PENDIENTE N8].
- **FR-090**: Un certificado vencido DEBE verse como un paso en rojo del
  checklist, no como una fecha más.
- **FR-091**: El punto de venta DEBE verificarse contra AFIP al guardarlo. Ver
  [PENDIENTE N11].
- **FR-092**: Los mensajes de validación que la API ya escribe en castellano
  DEBEN llegar al usuario.
- **FR-093**: La pantalla NO DEBE afirmar que la clave privada se guarda
  **cifrada**, porque no se guarda cifrada.
- **FR-094**: La pantalla NO DEBE afirmar que la clave del CSR **queda en el
  servidor**, porque se devuelve al navegador y no se guarda.
- **FR-095**: `docs/GUIA_AFIP.md:14` y `:45` DEBEN corregirse para decir lo mismo
  que la pantalla.
- **FR-096**: Esta funcionalidad **NO cifra el material fiscal en reposo** —es el
  proyecto 6 de `PROXIMOS-PROYECTOS.md`, junto con el token de TiendaNube— y **no
  puede agregar ningún lugar nuevo donde ese material quede en claro**.
- **FR-097**: La pantalla DEBE decir si hay ventas sin CAE y llevar a
  reintentarlas. Ver [PENDIENTE N10].
- **FR-098**: DEBE existir «Desvincular AFIP» con confirmación que diga qué se
  pierde, como dibuja `Favalio-Rediseno.dc.html:778-784`.
- **FR-099**: `Settings.jsx` DEBE limpiar `config.cert` y `config.key` después de
  guardar, declarar `accept` en sus inputs de archivo y liberar los object URL.

#### Equipo

- **FR-100**: `GET /api/auth/invite/:token` y
  `POST /api/auth/accept-invite/:token` DEBEN responder. Hoy responden **404**
  por el montaje de `server.js:422-423`.
- **FR-101**: Aceptar una invitación válida DEBE crear la membresía con el rol de
  la invitación y marcarla `accepted`.
- **FR-102**: Un token vencido, ya usado o inexistente NO DEBE crear ninguna
  membresía, y los tres casos DEBEN distinguirse en el mensaje.
- **FR-103**: DEBE existir una **guardia estática** que falle si un `Router` se
  monta con `app.get`/`app.post` en vez de `app.use`. Es lo único que impide que
  FR-100 vuelva.
- **FR-104**: El enlace del mail DEBE apuntar a una ruta que la aplicación
  atienda.
- **FR-105**: La pantalla NO DEBE decir «Invitación enviada» cuando el mail no
  salió. `email_enviado` y `message` ya vienen en la respuesta.
- **FR-106**: Cuando el mail no sale, la pantalla DEBE mostrar el enlace de
  invitación para pasarlo a mano, con un botón de copiar.
- **FR-107**: DEBE haber un botón de **reenviar** una invitación pendiente. El
  endpoint ya existe y no lo llama nadie.
- **FR-108**: Un fallo de aceptación NO DEBE descartar el token en silencio
  (`App.jsx:148-150`).
- **FR-109**: NO DEBE poder degradarse ni desactivarse al **último administrador
  activo** de una empresa.
- **FR-110**: Un usuario NO DEBE poder cambiar su propio rol ni desactivarse a sí
  mismo.
- **FR-111**: Las dos reglas anteriores DEBEN aplicarse **en el servidor**, y la
  pantalla DEBE reflejarlas deshabilitando con su explicación.
- **FR-112**: Esas reglas DEBEN salir de una **función pura compartida**, no de
  dos condiciones escritas por separado.
- **FR-113**: DEBE existir una forma de **sacar a alguien del equipo** desde la
  pantalla.
- **FR-114**: `POST /invitaciones/:token/re-enviar` DEBE llevar `requireEmpresa` y
  buscar el token **acotado a la empresa de la sesión**.
- **FR-115**: `GET /:empresaId/usuarios` NO DEBE devolver `auth0_sub` ni
  `es_superadmin`.
- **FR-116**: Cambiar el rol de un miembro DEBE exigir un permiso que signifique
  eso. Ver [PENDIENTE N9].
- **FR-117**: Los roles y sus etiquetas DEBEN salir del mismo lugar, con las
  mismas claves. **`gerente` DEBE estar.**
- **FR-118**: La columna de estado DEBE leer `is_active`, y distinguir una
  invitación pendiente de una vencida.
- **FR-119**: `POST /:empresaId/usuarios` DEBE validar el rol contra el catálogo,
  o eliminarse. Ver [PENDIENTE N13].
- **FR-120**: Un miembro desactivado NO DEBE reactivarse ni promocionarse solo
  por una invitación vieja. Ver [PENDIENTE N15].
- **FR-121**: DEBE poder verse cuándo entró cada miembro por última vez. Qué se
  construye es [PENDIENTE 1].
- **FR-122**: Un miembro que nunca entró DEBE decirlo, y NO mostrar una fecha
  vacía ni «Invalid Date».
- **FR-123**: DEBE quedar escrito **si se puede cerrar una sesión ajena o no**.
  El legacy podía; el último acceso por usuario no.
- **FR-124**: El registro del último acceso NO DEBE agregar una escritura por
  cada request.
- **FR-125**: La pantalla DEBE explicar que la persona invitada tiene que
  registrarse **con ese mismo email**, porque Favalio no crea nada en Auth0.
- **FR-126**: El superadmin de plataforma DEBE seguir sin aparecer en la lista, y
  **sin ningún filtro especial**: sale gratis porque no tiene fila en
  `usuario_empresas`.

---

### Key Entities

| Entidad | Campos que importan acá |
|---|---|
| `FixedExpense` | `id`, `empresa_id`, `name`, `amount` (**DECIMAL(12,2)**), `punto_de_venta_id` (FK **sin `empresa_id`**), `group` (**`defaultValue: 'gf1'`**, el resto de la migración del legacy) |
| `GastoVariable` | `id`, `empresa_id`, `persona`, `nombre`, `monto` (**DECIMAL(12,2)**), `mes` (YYYY-MM), `punto_de_venta_id` |
| `Sale` | `total`, `status` (`active`/anulada), **`is_credit`** —el campo que el Panel ignora—, `customer_id`, `date`, `afip_cae`, `afip_pv` |
| `SupplierMovement` | `empresa_id`, `type` (`deuda`/`pago`), `amount`, `due_date`. **El Panel solo lee `deuda`** |
| `CustomerPayment` | `empresa_id`, `amount` |
| `Stock` | `product_id`, `punto_de_venta_id`, `quantity`, `min_stock`, `expiration_date` |
| `Setting` | PK compuesta `(key, empresa_id)`, `value` JSONB. Claves de esta funcionalidad: `afip_cuit`, `afip_cert`, `afip_key`, `afip_environment`, `afip_pv`, `tax_condition`, `fixed_expenses_total`, y `target_sales` —**que la pantalla lee y nadie escribe**— |
| `Empresa` | `settings` JSONB (los defaults del onboarding), **`timezone`** —que el Panel no usa— |
| `Usuario` | `id`, `auth0_sub`, `email`, `nombre`, `es_superadmin`. **Sin ninguna columna de acceso** |
| `UsuarioEmpresa` | `id`, `usuario_id`, `empresa_id`, `role` (**STRING(20) libre**), `rol_id`, `invited_by`, `accepted_at`, `is_default`, `is_active` |
| `Invitacion` | `token`, `email`, `role` (enum), `empresa_id`, `invited_by`, `status`, `expires_at`, `accepted_at` |
| **Evidencia de la prueba de homologación** | **No existe.** Dónde vive es [PENDIENTE 2] |
| **Último acceso / sesión** | **No existe.** Qué se construye es [PENDIENTE 1] |
| **Corrida de «último CAE»** | La maqueta dibuja «Último CAE hace 12 minutos» (`:703`). Sale de `sales`, no hace falta tabla nueva |

**Migraciones que esta funcionalidad puede necesitar**: lo que resuelvan
[PENDIENTE 1] (último acceso o sesiones), [PENDIENTE 2] (evidencia de la prueba
de homologación) y [PENDIENTE 4] (los `group` viejos de `fixed_expenses`). El
detalle es trabajo de `sdd-plan`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. **`GET /api/settings` no devuelve la clave privada de AFIP.** Verificable
   contra hoy, donde la devuelve entera en cada carga de `/facturacion` y en cada
   `initialize()` del store.
2. `GET /api/settings/afip_key` no devuelve el PEM, y `PUT /api/settings/afip_cert`
   se rechaza.
3. Hay una guardia que falla si una clave sensible nueva no entra en la lista de
   exclusión, y un test que verifica que `-----BEGIN` no sale por el cable.
4. **Una invitación se puede aceptar de punta a punta.** Verificable contra hoy,
   donde `GET /api/auth/invite/:token` responde **404** y el enlace del mail cae
   en una ruta que no existe.
5. Hay una guardia que falla si un `Router` se monta con `app.get`/`app.post`.
6. **Invitar sin que el mail salga no dice «Invitación enviada»**: muestra el
   enlace y explica qué hacer. Verificable contra hoy, donde lo dice igual.
7. Una invitación pendiente se puede reenviar desde la pantalla.
8. No se puede degradar ni desactivar al último administrador, ni cambiarse el
   rol a uno mismo. Verificable contra hoy, donde se puede y deja la empresa
   bloqueada.
9. `GET /:empresaId/usuarios` no devuelve `auth0_sub` ni `es_superadmin`.
10. **«Por Pagar» baja al registrar un pago.** Verificable contra hoy, donde solo
    crece.
11. **Una venta de contado a un cliente identificado no cuenta como por cobrar.**
    Verificable contra hoy, donde cuenta.
12. Los cuatro tramos del aging suman el total que la tarjeta muestra arriba.
13. **Una venta del día 1 se cuenta en un solo mes.** Verificable contra hoy,
    donde se cuenta en dos.
14. **El Panel corta las fechas con la zona de la empresa.** Verificable con una
    venta a las 22:00 del último día del mes, que hoy el Panel pone en el mes
    siguiente y el Historial en el actual.
15. Un rol sin `caja.ver` no recibe el saldo de caja en la respuesta del Panel.
16. El simulador de precios no arranca con $2.400.000 ni con $7.000.000
    inventados, y no muestra `$NaN`.
17. La tarjeta de gastos fijos y el simulador muestran **el mismo** número.
18. Un fallo en uno de los pedidos del Panel no deja las seis tarjetas en `-` sin
    decir nada.
19. «Requiere tu atención» existe, y su aviso de faltantes cuenta lo mismo que la
    pantalla a la que lleva.
20. **La suma de lo que la pantalla de Gastos dibuja es el total de
    `fixed_expenses` de la empresa.** Verificable contra hoy con una empresa de
    una sola sucursal y un gasto sin sucursal, que no se dibuja en ninguna parte.
21. Un gasto fijo se puede editar desde la pantalla.
22. La empresa B no puede crear un gasto colgado de una sucursal de la A:
    responde 404 y no queda ninguna fila. Verificable contra hoy, donde se crea.
23. El detector del «padre ajeno» encuentra las dos formas nuevas, y cada
    corrección se ejercita contra una muestra sintética con el defecto.
24. Un importe se lee `1.234,50` **con el navegador en inglés**. Verificable
    contra hoy, donde dice `1,234.5`.
25. El checklist de puesta en marcha existe, marca los cuatro pasos y **no dice
    que está completo si el de homologación no lo está**.
26. «Probar conexión» falla cuando el certificado no sirve. Verificable contra
    hoy, donde dice «Conectado» siempre.
27. La pantalla no afirma que la clave se guarda cifrada, ni que la clave del CSR
    queda en el servidor, y `docs/GUIA_AFIP.md` dice lo mismo.
28. Ningún camino emite un comprobante fiscal real sin confirmación explícita, y
    `POST /api/afip/invoice` está eliminado o restringido a homologación.
29. Se avisa antes de que el certificado venza.
30. Ninguna de las cuatro pantallas muestra `err.message` de axios, y ningún
    fallo de carga queda en un `console.error`.
31. Las cinco archivos están en `guardiasDeDiseno.test.js` y no tienen hex,
    `dark:`, clases de la paleta ni `Table*`. Las dos únicas reglas `dark:` sin
    guardia del repositorio desaparecen.
32. Las tablas de Gastos y Equipo comparten `grid-template-columns` entre
    encabezado y filas.
33. Las cuatro rutas siguen adentro del marco de 1320px y el `<body>` no desborda
    a 1140px, y **siguen siendo dieciocho rutas**.
34. Cada una de las cuatro pantallas pasa de cero tests a tener los niveles que
    le corresponden: funciones puras, render, e integración contra Postgres.
35. `npm run test:api`, `npm run test:web`,
    `npm --prefix apps/api run test:integracion` y `npm run build` pasan, y las
    guardias de aislamiento, observabilidad, permisos de rutas, marco de pantalla
    y diseño siguen limpias.
36. **Cada criterio de aceptación tiene al menos un test que falla si se revierte
    el cambio que lo implementa**, y esa reversión está **hecha**, no supuesta:
    revertir la línea, correr, ver el rojo, restaurar. **Con dos excepciones, que
    son los dos pasos manuales de `tasks.md` y están enumeradas acá**:

    - **M1 — que el circuito funcione contra ARCA.** Exige un trámite con clave
      fiscal y la respuesta la da un servidor de terceros. Es lo que cubre el
      escenario 2 de US12 («un certificado que ARCA rechaza»). Todo lo de **este**
      lado sí está automatizado: qué se guarda, qué mensaje sale, qué status
      devuelve cada rama, y que la prueba no emita ningún comprobante.
    - **M2 — avisarle al dueño que los números del Panel se van a mover.** Es una
      conversación, no una pantalla.

    ⚠ **Este criterio no se da por cumplido leyendo la suite en verde**, y ese es
    el error que ya se cometió una vez. Una suite verde dice que los tests que
    existen pasan; **no** dice que exista un test por criterio, y menos que ese
    test se caiga al revertir el cambio. Lo único que lo cumple es la lista de
    mutaciones corridas, criterio por criterio.

    **Cuando este hito se declaró cerrado, este criterio era falso.** Medido:
    **US12 —una historia P1 entera— no tenía un solo criterio con un test que se
    pusiera en rojo**. El banner de «Circuito verificado el … con el CUIT … y el
    punto de venta …» se podía reducir a las dos palabras «Circuito verificado.»
    con `renderDeAjustesAfip.test.jsx` y `puestaEnMarchaAfip.test.js` en verde
    (escenario 3); la guardia que corta la verificación cuando **no hay
    certificado cargado** se podía borrar entera con las tres suites de AFIP de la
    API en verde (escenario 1); y la única fixture de servidores de ARCA tenía los
    tres campos en `OK` y `error_servidores` en `null`, así que una pantalla que
    escribiera «OK» fijo o ignorara el error de consulta se leía idéntica a una
    correcta (escenarios 5 y 6).

    Un criterio de éxito que afirma cobertura universal **es exactamente el que
    alguien cita para declarar el hito completo**. Escrito sin sus excepciones y
    sin la exigencia de la mutación hecha, no sostiene ninguna afirmación de
    completitud: dice lo que se quería, no lo que se verificó.

---

## Fuera de alcance

Explícito, para que no se discuta después si estaba incluido.

- **Cifrar el material fiscal en reposo.** Es el proyecto 6 de
  `PROXIMOS-PROYECTOS.md` y la funcionalidad 013 ya tomó la decisión coherente
  (FR-077): se hace para AFIP y TiendaNube juntos, o no se hace. Acá **solo se
  deja de mentir sobre ello** y se cierra la fuga.
- **Probar el circuito AFIP en homologación.** Es el proyecto 2 y no es código:
  es una verificación manual con un CUIT de prueba. Acá entra **dónde se registra
  que se hizo**.
- **Notas de crédito.** Proyecto 1, y su propio texto dice que la prueba de
  homologación va primero.
- **El punto de venta de AFIP por sucursal.** Proyecto 5b. Comprafit tiene una
  sucursal.
- **Alícuotas distintas del 21 %, tipos de comprobante que faltan, concepto
  «servicios».** Proyectos 3, 4 y 5.
- **La reconciliación de CAE.** Un job que compare el último autorizado en AFIP
  contra el último guardado. Está anotado en `AUDITORIA-AFIP.md:207-210`.
- **Rediseñar Caja, Clientes, Reportes, Recetas, Producción e Impuestos.** El
  plan (4.12) dice que no llevan pasada en esta etapa. Por eso **no** entran G9
  (los gastos fijos que `cashflowService` suma de todas las sucursales) ni P15
  (las dos mitades de Reports que no coinciden entre sí), aunque los dos están
  relevados y anotados.
- **Unificar Ajustes, Empresa, Equipo y Suscripción en una pantalla con solapas**,
  como dibuja la maqueta (`:1368`). Hoy son cuatro rutas del menú. Ver
  [PENDIENTE N14].
- **Permisos por usuario.** El modelo `UsuarioPermiso` existe, se lee y **no
  tiene ningún endpoint que lo escriba**. El legacy tenía cinco interruptores por
  persona (`legacy:9978-9984`). Es una funcionalidad propia. Ver [PENDIENTE N9].
- **Exportar el Panel.** La maqueta dibuja el botón (`:232`). Ver [PENDIENTE N1].
- **Vista mobile o para tablet.** Las cuatro son de escritorio, como las demás.
- **Migrar los datos de Comprafit.** Está bloqueado hasta tener acceso al
  hosting viejo (`PLAN-COMPRAFIT.md`, sección 7). Lo que sí entra es que el
  agrupado de gastos **sepa leer** lo que `scripts/migrar-legacy.js` produce
  (FR-025).

---

## Lo que falta decidir

Marcado tal cual se pide: lo que **cambia el resultado** y no está claro en el
pedido, en el plan ni en la maqueta. **Ninguno tiene una respuesta inventada.**

Siete bloqueaban y quince no. Los que no bloquean traen un valor por defecto
propuesto: si nadie dice lo contrario, se toma ese.

---

## Lo que faltaba decidir · **resuelto**

**Los siete están contestados.** Esta tabla manda sobre el planteo largo de más
abajo, que se conserva con las opciones descartadas: el motivo sigue valiendo
cuando alguien pregunte, dentro de un año, por qué se eligió una y no la otra.

| # | Decisión | Quién decidió |
|---|---|---|
| 1 | **Sesiones de verdad, con cierre**: tabla propia, registro de cada acceso y validación contra ella. Se eligió sobre «solo el último acceso» porque ése **no puede cerrar una sesión**, que es la mitad de lo que servía: si alguien deja la empresa, desactivarlo no lo saca hasta que vence su token | Usuario |
| 2 | **La prueba en homologación BLOQUEA el pase a producción.** La pantalla la muestra como paso cumplido o pendiente. Motivo: el circuito nunca se probó, y sin esto **el primer comprobante real de Comprafit sería también la primera prueba del circuito** | Usuario |
| 3 | **Se unifica «stock bajo»** entre Panel y Faltantes. El número del Panel va a cambiar —hoy uno de los dos está mal— y eso es preferible a que la pregunta «¿cuántos productos me faltan?» tenga dos respuestas y nadie sepa cuál creer | Usuario |
| 4 | **Los gastos fijos sin sucursal se asignan a la sucursal por defecto** de cada empresa, con una migración que **informa cuántos movió, uno por uno**. Hoy no se dibujan en ninguna pantalla y **siguen moviendo el punto de equilibrio**: con una sola sucursal desaparecen. Mismo criterio que las filas de stock huérfanas | Usuario |
| 5 | **El Panel se recorta por permiso**: quien no tiene `caja.ver` no ve los indicadores de caja, quien no tiene `clientes.ver` no ve la deuda. Ventas y stock siguen para todos. Hoy `dashboard.ver` lo tienen los cinco roles y un vendedor ve la plata del negocio | Usuario |
| 6 | **Las cuatro rutas quedan SIN gate de módulo.** Panel, Gastos, Equipo y Ajustes son el esqueleto del sistema, no módulos opcionales: toda empresa necesita configurar AFIP y manejar su equipo. Cerrar el gate exigiría revisar `enabled_modules` de cada empresa antes del deploy, y una lista mal armada haría desaparecer cuatro pantallas sin aviso | Usuario |
| 7 | **Los cinco defectos de plata del Panel se corrigen en este hito**, y el cambio se avisa en `OPERACION.md`: los números van a moverse el día del deploy —«Por Pagar» probablemente baje bastante, porque hoy nunca resta lo que se pagó— y hay que poder saber cuál era el que mentía | Usuario |

**Y una que se tomó y ya se ejecutó, fuera del hito**: la fuga de `afip_key` salió
de acá y se cerró sola en `01fc77d`. Es un `if` más su test, no dependía de
ninguna decisión de diseño, y mezclarla en un commit de rediseño habría
significado que no se puede revertir el rediseño sin reabrir la fuga.

---

## El planteo completo de cada pregunta

### Bloqueaban

**[PENDIENTE DE DEFINIR 1] — Sesiones activas: ¿Auth0, último acceso, o las dos
mitades?**

El plan (4.11) ya plantea la disyuntiva: «decidir si se listan sesiones de Auth0
—más fiel, más trabajo— o se registra el último acceso por usuario, que es más
simple y cubre el 90 % del caso». Falta la respuesta, y falta una parte del
planteo.

Hoy **no existe absolutamente nada**: ni columna, ni tabla, ni registro
(hallazgo E13).

| Opción | Qué implica | Qué **no** puede hacer |
|---|---|---|
| **(a) Último acceso por usuario** | Una columna, escrita desde `loadEmpresaContext` (`middleware/auth.js:107-124`), que ya toca la fila en cada request. Falta decidir cada cuánto se escribe: una por request es una escritura por request | **No puede cerrar una sesión ajena.** Y no distingue dos dispositivos del mismo usuario |
| **(b) Sesiones de Auth0** | Management API, que **hoy no está en el repositorio**: credenciales nuevas, rate limit, manejo de error, y un secreto más para rotar | Es lo más parecido al legacy |
| **(c) Sesiones propias** | Una tabla, escrita al entrar, con user-agent y con un mecanismo de invalidación. Es lo que hacía el legacy con `cf_session_*` | Es la más cara, y duplica lo que Auth0 ya sabe |

**Lo que el planteo del plan no dice, y hay que mirar de frente**: el legacy no
solo mostraba las sesiones — **las cerraba**, una por una y todas juntas
(`legacy:10064-10088`). La opción (a) cubre el 90 % de *ver*, y el 0 % de
*cerrar*. Si «sesiones activas» significa «poder echar a alguien de un
dispositivo», (a) no alcanza y hay que decirlo antes y no después.

**Bloquea** porque cambia si hay migración, si hay dependencia externa nueva, y
qué significa exactamente la funcionalidad que 4.11 nombra.

**[PENDIENTE DE DEFINIR 2] — ¿Qué es «prueba en homologación hecha», dónde vive
esa evidencia, y qué habilita?**

Es el cuarto ítem del checklist que pide 4.9, y es **el pendiente más caro de
este hito**.

Hoy: el circuito **nunca se probó** (`AUDITORIA-AFIP.md:223-233`,
`PROXIMOS-PROYECTOS.md:124`, `PLAN-COMPRAFIT.md:355`), no hay dónde registrar que
se probó, y lo único que la pantalla puede hacer es `FEDummy`, que no usa el
certificado (hallazgo A5).

Tres preguntas encadenadas:

1. **¿Qué cuenta como prueba?** Opciones: **(a)** un ticket WSAA obtenido
   correctamente —prueba que el certificado, la clave y la delegación funcionan,
   y **no consume numeración**—; **(b)** un `FECompUltimoAutorizado` contra el
   punto de venta —prueba además que el PV existe, y tampoco consume—; **(c)** un
   CAE de prueba en homologación —prueba el circuito entero, consume numeración
   **de homologación**, que no tiene validez fiscal—.
2. **¿Dónde vive la evidencia?** Un `Setting` por empresa con la fecha y el
   resultado, o una tabla. Sin esto el paso no se puede marcar (FR-084).
3. **¿Qué habilita, y qué bloquea?** Y acá está el nudo: **¿la pantalla deja
   pasar a producción sin la prueba?**

| Postura | Qué pasa |
|---|---|
| **Bloquear** | Nadie factura en producción sin haber probado. Es lo más seguro y es un cambio de producto: hoy se puede |
| **Advertir** | Se puede pasar, con una confirmación que diga que el circuito no se probó |
| **Solo informar** | El checklist lo muestra pendiente y no impide nada. Es lo más barato y **es lo que deja una pantalla que invita a emitir sin haber probado** |

**Bloquea** porque decide qué construir —un endpoint de prueba, una fila, una
migración— y porque **es la diferencia entre una pantalla que evita la llamada
«no puedo facturar» y una que la causa**.

**[PENDIENTE DE DEFINIR 3] — ¿Se unifica la regla de «stock bajo» entre el Panel
y Faltantes?**

Hoy hay dos reglas y la divergencia es **deliberada y está documentada** en tres
lugares como riesgo 6 del plan: «Inventario va a mostrar más productos en stock
bajo que el panel de control, y es a propósito»
(`apps/api/src/utils/stockBajo.js:19-23`). El motivo escrito es que unificarlas
**mueve un número que el usuario mira todos los días**.

**Lo que cambia ahora**: 4.8 pone «faltantes» adentro de «Requiere tu atención»,
y la maqueta pone en cada aviso un botón que lleva a la pantalla que lo detalla.
Un aviso que dice «7 productos por debajo del mínimo» y lleva a una pantalla que
muestra 12 es exactamente el defecto que esta funcionalidad viene a evitar.

- **(a) Unificar**: el Panel pasa a usar `utils/stockBajo.js`. El número que el
  dueño ve **sube** el día que se despliega, y hay que avisarle.
- **(b) No unificar y no enlazar**: el aviso del Panel no lleva a Faltantes. Es
  raro, y le saca al aviso lo que lo hace útil.
- **(c) No unificar y explicar la diferencia en la pantalla**: dos números y una
  nota. Es lo peor de las dos.

**Bloquea** porque decide si el número del Panel cambia, y porque el riesgo 6 del
plan está escrito precisamente para que esto se decida a propósito y no de
costado.

**[PENDIENTE DE DEFINIR 4] — ¿Qué se hace con las filas de `fixed_expenses` que
tienen `group` viejo y `punto_de_venta_id` nulo?**

Es la mitad de datos del hallazgo G1. `models/FixedExpense.js:33` pone
`defaultValue: 'gf1'` y `scripts/migrar-legacy.js:379` escribe `'gf1'`/`'gf2'`
sin sucursal.

- **(a) Migrar los datos**: una migración que convierta `'gf1'`/`'gf2'` en el
  `punto_de_venta_id` que corresponda, y quite el `defaultValue`. **Hay que saber
  a qué sucursal corresponde cada uno**, y en el legacy `gf1` era Ortiz de Ocampo
  y `gf2` era 25 de Mayo (`legacy:3011`, `:3017`) — pero eso vale para Comprafit,
  no en general.
- **(b) No migrar y que el agrupado lo interprete**: la función pura sabe leer
  `group` viejo y lo mapea. El dato queda ambiguo para siempre.
- **(c) Ignorar el `group` viejo**: todo lo que no tenga `punto_de_venta_id` va a
  «General». Es lo más simple y **mueve gastos de sucursal** para quien ya tenga
  datos migrados.

**Bloquea** porque las tres dan totales por sucursal distintos, y porque (a)
necesita una migración que hay que escribir antes de que Comprafit migre sus
datos.

**[PENDIENTE DE DEFINIR 5] — ¿Quién ve el Panel, y con qué nivel de detalle?**

Hoy `dashboard.ver` lo tienen **los cinco roles** y la respuesta trae el saldo de
caja, las cuentas por cobrar y los gastos fijos (hallazgo P6). En el legacy, «Ver
KPIs y totales del día» era **uno de los cinco interruptores por persona**
(`legacy:9982`): Comprafit decidía, para cada empleado, si veía los números.

- **(a) Filtrar la respuesta por permiso**: cada bloque exige el permiso de su
  pantalla. Es lo coherente con el resto del sistema.
- **(b) Un permiso nuevo, `dashboard.finanzas`**: separa «ver el panel» de «ver
  la plata». Hay que sembrarlo y repartirlo por rol.
- **(c) Dejarlo como está**: un cajero ve el saldo de caja de la empresa.

**Bloquea** porque cambia el contrato del endpoint y qué dibuja la pantalla para
cada rol, y porque el legacy dice que a Comprafit esto le importaba.

**[PENDIENTE DE DEFINIR 6] — ¿Se cierra el gate de módulo de las cuatro rutas en
este hito?**

Es el hallazgo T1. Cerrarlo es una línea por ruta; **lo que no es barato es la
verificación**: hay que mirar en producción qué empresas tienen `gastos`,
`panel`, `facturacion` y `equipo` en `enabled_modules`, porque una que no lo
tenga **pierde la pantalla y redirige a `/pos`**. El comentario de
`marcoDePantalla.test.js:166-177` lo explica y dice que por eso no se cierran de
un tirón.

- **(a) Las cuatro, de a una, cada una con su verificación y su corte
  revertible.**
- **(b) Ninguna**: queda como deuda declarada, que es lo que es hoy.
- **(c) Solo las que la verificación diga que son seguras.**

**Bloquea** el alcance de `tasks.md`, y **necesita a alguien que pueda mirar la
base de producción**. No es una decisión de diseño.

**[PENDIENTE DE DEFINIR 7] — ¿Los cinco defectos de plata del Panel entran en
este hito, y qué se le dice al dueño el día que los números cambien?**

Los hallazgos P1 a P5 son correcciones, no funcionalidad. Cada una **mueve un
número que el dueño mira todos los días**:

| Corrección | Qué le pasa al número |
|---|---|
| P1 · «Por Pagar» resta los pagos | **Baja**, y puede bajar mucho |
| P2 · «Por Cobrar» solo cuenta cuenta corriente | **Baja** |
| P2 · «clientes con deuda» | **Baja** |
| P3 · el aging cierra con su total | **Cambian los cuatro tramos** |
| P4 · el día 1 en un solo mes | Se mueve poco, y **el delta cambia** |
| P5 · fechas del negocio | Se mueve poco, salvo cerca del cierre |

Ninguno es discutible como error. Lo que hay que decidir es **si entran acá o en
su propio corte**, y **qué se le dice al cliente el día que abra el Panel y vea
otros números**. Si Comprafit ya viene mirando «Por Pagar» y de golpe baja a la
mitad, la reacción razonable es pensar que el sistema perdió datos.

**Bloquea** el alcance, el orden de los commits y si hace falta un aviso en la
pantalla.

### No bloqueaban

Tienen un valor por defecto propuesto. Si nadie dice lo contrario, se toma ese.

**[PENDIENTE N1] — ¿El Panel lleva selector de período y botón de exportar?** La
maqueta los dibuja (`:226-234`); hoy los períodos están fijos en 30 días y mes.
**Por defecto: entra el selector de período —porque «Ventas · 30 días» sin poder
cambiarlo es un número y no una herramienta— y no entra la exportación**, que es
otra funcionalidad y ya existe en Reports.

**[PENDIENTE N2] — ¿Los indicadores del Panel son de la sucursal activa o de la
empresa?** Hoy son de la empresa y la pantalla de Caja es de la sucursal, bajo la
misma etiqueta (hallazgo P12). **Por defecto: de la empresa, y la etiqueta lo
dice** —«toda la empresa»—, porque el Panel es la vista del dueño y `vista_empresa`
ya existe como permiso. Lo que **no** puede quedar es la ambigüedad actual.

**[PENDIENTE N3] — ¿De dónde salen los datos del sparkline?** La maqueta usa
`Math.sin` porque es una maqueta (`:1166-1169`). **Por defecto: los últimos doce
períodos del mismo indicador** —doce meses para los mensuales, doce días para los
diarios—, y **si no hay doce, no se dibuja**. Una línea inventada en una tarjeta
de plata es peor que un espacio vacío.

**[PENDIENTE N4] — ¿Qué más entra en «Requiere tu atención»?** El pedido nombra
tres: faltantes, ventas sin CAE, vencimientos de stock. La maqueta dibuja cuatro
e incluye órdenes de compra con entrega vencida y clientes con deuda vencida
(`:1178-1183`). **Por defecto: los tres del pedido**, más **el certificado de
AFIP por vencer**, que es el único que no está en ninguna otra pantalla y cuyo
modo de falla —dejar de poder facturar sin entender por qué— es el que más caro
sale.

**[PENDIENTE N5] — ¿De dónde sale «Actividad reciente»?** **No hay tabla de
auditoría ni registro de eventos**: la maqueta muestra ventas, recepciones,
transferencias y rechazos de AFIP con su autor (`:1185-1192`), y de todo eso solo
las ventas tienen autor guardado. **Por defecto: las últimas ventas, con su hora,
su vendedor y su importe**, y se rotula «Últimas ventas» y no «Actividad
reciente». Rotularlo con el nombre de la maqueta y mostrar solo ventas es
prometer un registro que no existe.

**[PENDIENTE N6] — ¿Cuáles son los «Accesos rápidos»?** La maqueta propone nueva
venta, cargar producto, nueva orden de compra y cierre de caja (`:1201-1206`);
**el último va a una pantalla oculta para el cliente**. **Por defecto: nueva
venta, cargar producto, nueva orden de compra y ver faltantes**, y cada uno
respeta el permiso y el módulo: un acceso rápido que lleva a un 403 es peor que
no tenerlo.

**[PENDIENTE N7] — ¿Qué pasa con `settings.fixed_expenses_total` y
`settings.target_sales`?** El primero convive con la suma real de
`fixed_expenses` (hallazgo P8); el segundo **no existe en ningún default** y la
pantalla lo lee (P7). **Por defecto: `fixed_expenses_total` se elimina y el
simulador usa la suma real**, que es lo que el dueño mantiene en la pantalla de
Gastos; y **`target_sales` se crea de verdad**, con su campo en Gastos, como lo
tenía el legacy —«Facturación mensual promedio» (`legacy:3030`)—, porque es un
dato que el sistema no puede deducir.

**[PENDIENTE N8] — ¿Con cuánta anticipación se avisa que el certificado vence?**
**Por defecto: 60 y 30 días**, en el checklist y en «Requiere tu atención», y en
rojo cuando ya venció. Sesenta días alcanzan para el trámite en ARCA sin
apurarse.

**[PENDIENTE N9] — ¿Hace falta un permiso `equipo.editar`?** Hoy cambiar el rol
pide `config.editar` (hallazgo E8). **Por defecto: se crea `equipo.editar` y se
le da a `admin`**, que es exactamente quién puede hacerlo hoy: el cambio es de
nombre, no de alcance, y deja de mezclar «editar la configuración de la empresa»
con «cambiar el rol de una persona».

**Y queda anotado aparte**: los cinco interruptores por persona del legacy
(`legacy:9978-9984`) son otra funcionalidad. El modelo `UsuarioPermiso` existe,
se lee en tres lugares y **no tiene ningún endpoint que lo escriba**. Es
candidato a proyecto propio, no a este hito.

**[PENDIENTE N10] — ¿La pantalla de AFIP muestra las ventas sin CAE?** **Por
defecto: un contador con enlace al Historial filtrado**, y no una lista propia.
El botón de reintentar ya vive ahí (`InvoicesList.jsx:427`) y dos lugares que
listan lo mismo se separan.

**[PENDIENTE N11] — ¿Se valida el punto de venta contra AFIP?** Hoy se acepta
cualquier entero (hallazgo A9). **Por defecto: sí, con
`FECompUltimoAutorizado`**, que ya está implementado
(`afipService.js:124-144`), no consume numeración y falla si el PV no existe. Es
lo mismo que hace falta para [PENDIENTE 2] opción (b): una sola pieza para las
dos cosas.

**[PENDIENTE N12] — ¿Qué se hace con `POST /api/afip/invoice`?** **Por defecto:
se elimina.** `PROXIMOS-PROYECTOS.md:151` ya dice que «es lo más barato y no se
pierde nada **si el proyecto 2 se hace**», y la validación del punto de venta de
[PENDIENTE N11] cubre lo que el botón de prueba pretendía verificar, sin emitir
nada. Si se conserva, tiene que quedar restringido a homologación (FR-077).

**[PENDIENTE N13] — ¿Qué se hace con `POST /:empresaId/usuarios`?** Incorpora por
`auth0_sub` sin invitación, no valida el rol y **no lo usa nadie** (hallazgo
E11). **Por defecto: se elimina.** Superficie sin llamador que además saltea el
flujo de invitación. Si hace falta incorporar a alguien sin mail, el camino es el
enlace de invitación copiado a mano (FR-106).

**[PENDIENTE N14] — ¿Se unifican Ajustes, Empresa, Equipo y Suscripción en una
pantalla con solapas?** La maqueta las dibuja así (`:1368`); hoy son cuatro rutas
del menú. **Por defecto: no se unifican.** Cambiar la navegación de cuatro
pantallas es un rediseño del shell, no una pasada fina, y `/team` y `/suscripcion`
tienen su propio ítem en la barra por decisión del plan (sección 1). Queda
anotado que la maqueta propone otra cosa.

**[PENDIENTE N15] — ¿Desactivar a un miembro invalida sus invitaciones
pendientes?** Hoy no, y por eso una invitación vieja lo reactiva y lo
re-promociona (hallazgo E1, escenario 8). **Por defecto: sí, se revocan.**
Desactivar a alguien y que vuelva a entrar con más permisos por un mail de hace
tres meses es lo contrario de lo que la acción significa.

---

## Assumptions

1. **Las cuatro pantallas ya existen y ya están adentro del marco.** Las cuatro
   rutas están en `App.jsx:289-296` envueltas en `MarcoDePantalla` y en
   `CON_MARCO` de `marcoDeLasPantallas.navegador.js:53-58`. **Esta funcionalidad
   no agrega ninguna ruta**: las dieciocho siguen siendo dieciocho. Es la
   diferencia con la funcionalidad 013.
2. **La maqueta dibuja el Panel y Ajustes AFIP, y NO dibuja Gastos ni Equipo.**
   Verificado en `Favalio-Rediseno.dc.html:1282`:
   `isStub: !['panel','pos','ventas','inventario','compras','config'].includes(st.route)`.
   `gastos` (`:959`) y `equipo` (`:962`) caen en el bloque genérico de stub
   (`:791-802`). **Cualquier cosa que `sdd-verify` quiera comparar contra la
   maqueta para esas dos pantallas no tiene contra qué**: el diseño sale del
   texto de 4.7 y 4.11, de `REGLAS-DISENO.md` y de `pages/Comparador.jsx`.
3. **La maqueta llama «Gastos fijos» a la pantalla de Gastos** (`:959`), y el
   plan la llama «Gastos» con dos solapas (4.7). **Se toma el nombre del plan**,
   porque la pantalla tiene las dos cosas.
4. **Dos frases de la maqueta sobre el material fiscal son falsas** y no se
   copian: que las llaves se guardan cifradas (`:730`, `:1380`) y que la clave
   del CSR queda en el servidor (`:1374`). Ver hallazgo A11 y FR-093 a FR-095.
   **Que la maqueta lo diga no es evidencia de que el sistema lo haga.**
5. **El sistema viejo tenía Gastos y Equipo, y no tenía Panel ni AFIP.** El
   «Control de accesos» y las «Sesiones activas» del legacy vivían adentro de la
   pantalla de Gastos (`legacy:2997-3007`, `:3070-3084`); el punto de equilibrio
   vivía adentro de la calculadora de precios del inventario (`:1556-1585`) y
   **su cuenta estaba mal** (`:3924`, `:3958`). **Esa cuenta no se reintroduce**:
   `utils/bep.js` la corrigió y la documentó.
6. **`utils/bep.js` no se toca.** Está bien, está probado con 20 casos y
   distingue margen sobre venta de recargo sobre costo. **Lo que se arregla es lo
   que entra**, no la fórmula.
7. **`services/email.js` no se toca.** Ya devuelve `ok: false` cuando no envía y
   tiene su test. Lo que falta está del lado de la pantalla.
8. **La guarda de la cadena vacía de `POST /afip/setup` no se toca**
   (`afip.js:132-141`). La versión anterior borraba el certificado y la clave al
   guardar, y era irreversible.
9. **La firma, el WSAA, el SOAP y la serialización de la numeración de AFIP no se
   tocan.** Es «la parte difícil» y está bien resuelta
   (`AUDITORIA-AFIP.md:168-176`).
10. **El material fiscal sigue en `settings` en texto plano.** Es el proyecto 6 y
    se hace junto con el token de TiendaNube. Esta funcionalidad **no lo
    resuelve, no lo empeora, y deja de afirmar lo contrario**.
11. **El circuito AFIP sigue sin probarse en homologación.** Es el proyecto 2 y
    es una verificación manual. Lo que esta funcionalidad hace es **dejar de
    esconderlo**.
12. **Comprafit tiene una sola sucursal hoy**, y por eso el punto de venta de
    ARCA por sucursal (proyecto 5b) no entra. **Y por eso el hallazgo G1 es
    grave**: con una sola sucursal el gasto sin sucursal no se dibuja en ninguna
    parte.
13. **La API no crea usuarios en Auth0.** No hay Management API en el
    repositorio; el usuario se auto-registra y la API lo crea just-in-time desde
    el JWT (`middleware/auth.js:107-122`). Cualquier decisión sobre invitaciones
    y sesiones parte de ahí.
14. **`es_superadmin` sigue sin poder escribirse por ningún endpoint**, con su
    guardia (`tests/superadmin.test.js:116-141`), y el superadmin sigue sin
    aparecer en Equipo porque no tiene fila en `usuario_empresas`. **No se agrega
    ningún filtro especial.**
15. **Los gastos variables no entran en el punto de equilibrio.** Está escrito en
    los dos lados (`Expenses.jsx:17-19`, `gastosVariables.js:17-20`) y es
    correcto: el BEP se plantea sobre los fijos.
16. **Reports, Caja, Clientes, Recetas, Producción e Impuestos siguen ocultas
    para el cliente** (plan 4.12), y por eso sus defectos relevados —G9 y P15— se
    nombran y no se arreglan.
17. **Las cuatro pantallas son cuatro trabajos.** No comparten modelo, servicio
    ni componente; el único punto de contacto es el total de gastos fijos que
    alimenta el BEP. `tasks.md` las corta en fases revertibles por separado, y
    **la corrección de la fuga de `afip_key` va primero y sola** — ver «Por qué
    van juntas, y por qué AFIP debería ir sola».
