# Tasks: Panel, Gastos, Equipo y Ajustes AFIP

**Input**: documentos de diseño en `docs/specs/014-panel-gastos-equipo-afip/`
(`spec.md`, `plan.md`, `data-model.md`, `contracts/api-endpoints.md`).

**Sesenta y una tareas en diez fases.** Una fase = un corte del plan = uno o
varios commits que se despliegan y se revierten juntos. El orden es el de «Orden
de fases» del plan, **sin permutas**.

`[P]` marca las que se pueden hacer en paralelo porque tocan archivos distintos.

---

## Antes de empezar: ocho cosas que no son tareas

### 1. La numeración sigue de la 013

La última tarea del repositorio es **T1348**. Acá se arranca en **T1349**. Los
números no se reciclan: `guardiasDeDiseno.test.js` y `marcoDePantalla.test.js`
nombran tareas por su número adentro de sus encabezados, y dos T1337 distintas
hacen que esa referencia deje de servir.

### 2. Cómo se verifica, en cuatro niveles

| Nivel | Qué cubre acá | Dónde |
|---|---|---|
| Función pura | El agrupado de gastos y su invariante de suma · el reparto por antigüedad · la severidad, el orden y la etiqueta de un aviso · las alturas del sparkline · `puedeCambiarRol` / `esUltimoAdmin` · `dispositivoDeUserAgent` · el estado y el tono de cada paso del checklist de AFIP · el plan de la migración de gastos · qué hacer cuando falla la aceptación de una invitación | `apps/api/src/tests/*.test.js` · `apps/web/src/utils/*.test.js` y `apps/web/src/tests/*.test.js` |
| Guardia estática | El **tipo y el orden** de los montajes · que nadie fuera de `sales.js` llame a `createVoucher` · que `fixed_expenses_total` no se lea · el detector del padre ajeno con sus dos formas nuevas · el formateo **en línea** · los cinco archivos de diseño | `montajeDeRouters.test.js` · `aislamientoEmpresas.test.js` · `observabilidad.test.js` · `permisosDeRutas.test.js` · `guardiasDeDiseno.test.js` · `formato.test.js` |
| **Integración contra Postgres** | Que las dos rutas de invitación **contesten** · que registrar un pago baje «Por Pagar» · que los cuatro tramos sumen el total · que la venta del día 1 se cuente una vez · que un `POST /expenses` con la sucursal de otra empresa no cree ninguna fila · que `-----BEGIN` no salga por el cable · que un rol sin `caja.ver` no reciba `cashflow` · que dos requests del mismo navegador creen **una** sesión · el conteo de consultas | `apps/api/src/tests/integracion/*.integracion.test.js` |
| Render (jsdom) | Qué se dibuja deshabilitado y con qué explicación · qué mensaje muestra un error de la API · que las tarjetas sumen lo mismo que las filas · que el Panel con un `kpis` recortado no dibuje `$0` · que la columna Estado lea `is_active` · que la pantalla de AFIP no muestre la clave | `apps/web/src/tests/renderDe*.test.jsx` |
| Navegador | **Tres medidas, y nada más**: que un nombre de gasto largo no se meta en la columna de importe, que el sparkline de doce barras no desborde su tarjeta, y que las cuatro tarjetas arranquen en el mismo píxel | `apps/web/pruebas-de-navegador/*.navegador.js` |

Comandos:

```
npm run test:api                              # NO levanta los de integración
npm --prefix apps/api run test:db:levantar    # una vez: contenedor + migraciones
npm --prefix apps/api run test:integracion
npm run test:web
npm run build
node apps/api/scripts/verificar-reversibilidad.js --desde 20260812
```

### 3. ⚠ La guardia de orden de montaje NO puede escribirse como la enuncia el plan

La decisión 1 del plan dice que la guardia verifica que **«ningún
`app.use('/api/<algo>')` quede después del `app.use('/api')` genérico»**. Escrita
así, **falla contra trece montajes que hoy son correctos**: `/api/tiendanube`,
`/api/production`, `/api/customers`, `/api/stock`, `/api/reports`,
`/api/dashboard`, `/api/cashflow`, `/api/taxes`, `/api/empresas`, `/api/import`,
`/api/precios`, `/api/gastos-variables` y `/api/comparador` están todos debajo de
la línea 396 y **están bien**: llevan `...authEmpresa`, la misma cadena que el
montaje genérico, así que que ésta les corra antes no les cambia nada.

Lo que de verdad hay que impedir es otra cosa, y es la que rompe hoy:

> **Un montaje de un subcamino de `/api` cuya cadena sea MÁS DÉBIL que la del
> `/api` genérico —o sea, que no incluya `requireEmpresa`— tiene que estar
> ARRIBA de él.**

Con esa regla, los trece de arriba pasan, `/api/empresas` (que lleva
`authSinEmpresa`) **falla hoy**, y `/api/auth` también. Es la formulación que va
en T1349.

Reproducido contra el express instalado (5.2.1), con el montaje corregido a
`app.use` en los dos casos y moviendo solo su posición:

```
A (app.use('/api/auth', authRouter) DEBAJO del /api genérico)  -> 403
B (app.use('/api/auth', authRouter) ARRIBA  del /api genérico)  -> 200
```

### 4. ⚠ Partir `routes/auth.js` en dos routers rompe DOS anclas de `permisosDeRutas.test.js`

Ninguna de las dos está en el plan y las dos van en el **mismo commit** que la
partición, o `npm run test:api` queda en rojo:

**(a)** `ROUTERS_SIN_SESION` tiene la clave `'routes/auth.js router'`
(`permisosDeRutas.test.js:74`) y se afirma **por igualdad exacta**. Con la
partición la clave pasa a ser `'routes/auth.js publico'`, y el motivo escrito
—«es el MISMO objeto router, así que la guardia lo clasifica por su montaje más
débil y no puede exigirle permisos a ninguna de las dos»— **deja de ser cierto** y
hay que reescribirlo. Un motivo que describe una situación que ya no existe es
peor que no tener motivo.

**(b)** Hoy `POST /accept-invite/:token` **escapa** de `RUTAS_AUTENTICADAS`
justamente porque comparte objeto con la ruta pública. Con `privado` montado
detrás de `authSinEmpresa`, `AUTENTICADO_POR_ROUTER['routes/auth.js privado']`
pasa a `true` y la ruta entra a la guardia: hay que darle una cuarta entrada en
**`SIN_PERMISO_A_PROPOSITO`**, con el motivo real (quien acepta una invitación
todavía no tiene fila en `usuario_empresas`, así que no tiene rol y no puede
tener ningún permiso — es el mismo motivo que `POST /onboarding`).

### 5. ⚠ Sacar `modulo` de los cuatro ítems rompe un ancla de `marcoDePantalla.test.js`

`marcoDePantalla.test.js:198` afirma `expect(items.length).toBeGreaterThanOrEqual(13)`.
Hoy `components/navegacion.js` tiene **catorce** ítems con `modulo`; después de la
decisión 14 quedan **diez**. El ancla hay que bajarla a `10` **y escribir por qué**,
que es exactamente lo que el encargo pide no hacer a ciegas: el número no baja
porque molestaba, baja porque cuatro ítems dejaron de declarar módulo a
propósito, están enumerados, y si bajara de diez es que se perdió uno más que
nadie decidió. Va en T1409, con `SIN_GUARD_TODAVIA`.

### 6. El ancla `toBe(4)` de `analizarIncludes` NO se toca, y eso también hay que verificarlo

`aislamientoEmpresas.test.js:881` cuenta los `include` **de hijos** (`HasMany` /
`HasOne`) con `empresa_id`. Los cuatro `include` de `Product` que este hito toca
—`dashboardService.js:279`, `:300` y `general.js:464`, `:475`— son **`belongsTo`**
(`Stock.belongsTo(Product, as: 'product')`), y el detector **no los clasifica**:
es literalmente el hallazgo P17 («la guardia no los puede ver»). Borrar
`GET /api/alerts` se lleva dos de ellos y el número **sigue siendo 4**.

**No hay tarea de ajuste, y eso es el resultado, no un olvido.** Lo que sí hay es
una verificación: después de T1382, `npm run test:api -- aislamientoEmpresas`
tiene que seguir en verde **sin haber tocado el número**. Si alguien lo baja a 2,
lo que hizo fue sacar dos includes de hijo que este hito no nombra.

### 7. Ninguna guardia queda en rojo a propósito en este hito, y por qué

Los tres hitos anteriores dejaron `guardiasDeDiseno.test.js` en rojo a propósito
—cuatro veces— y su encabezado explica el mecanismo: un archivo de `NOMBRES` que
**todavía no existe** produce el hallazgo «el archivo NO existe: la guardia no
miró nada», que se lee distinto de «L353: `border-green-500/30`».

**Acá no se puede usar ese mecanismo**, y no es preferencia de estilo: los cinco
archivos de FR-005 **existen** y son infractores reales. Meterlos en `NOMBRES`
antes de reescribirlos no produce el hallazgo «no existe» sino hallazgos de color
y de `<table>` — exactamente los que el encabezado advierte que no hay que
confundir con una tarea pendiente. Con cinco archivos en rojo por infracción real
durante cuatro cortes, la próxima infracción de verdad entra sin que nadie la vea.

**Qué se hace en cambio**, y cumple el motivo de FR-005 sin dejar un commit rojo:
cada archivo entra en `NOMBRES` **en el mismo commit que lo reescribe**, y la
tarea exige la comprobación al revés, que es la que importa:

> Agregá el nombre a `NOMBRES`, subí el ancla, corré `npm run test:web` **antes**
> de tocar el componente y **anotá cuántos hallazgos dio**. Tiene que ser > 0. Si
> da cero, la guardia no está mirando ese archivo —ruta mal escrita, nombre mal
> escrito— y reescribirlo no va a demostrar nada. Recién ahí reescribí, y volvé a
> correr.

**Lo que NO vale**: agregar el nombre y el ancla en un commit y reescribir en el
siguiente; sacar un archivo de `NOMBRES`; meter clases adentro de un comentario
para que `lineasQueMatchean` las saltee; o bajar el `toHaveLength`.

El ancla `expect(ARCHIVOS).toHaveLength(19)` sube **once** veces en este hito, de
a una por tarea, hasta **30**:

| Corte | Tarea | Entra | Ancla |
|---|---|---|---|
| 4 | T1370 | `components/PanelDeGasto.jsx` | 20 |
| 4 | T1371 | `pages/Expenses.jsx` | 21 |
| 4 | T1372 | `components/GastosVariables.jsx` | 22 |
| 6 | T1379 | `components/TarjetaDeIndicador.jsx` | 23 |
| 6 | T1380 | `components/RequiereTuAtencion.jsx` | 24 |
| 6 | T1381 | `pages/Dashboard.jsx` | 25 |
| 7 | T1391 | `components/PanelDeMiembro.jsx` | 26 |
| 7 | T1392 | `pages/Team.jsx` | 27 |
| 8 | T1400 | `components/SesionesDelEquipo.jsx` | 28 |
| 9 | T1407 | `components/PuestaEnMarchaAfip.jsx` | 29 |
| 9 | T1407 | `pages/Settings.jsx` | 30 |

### 8. Los dos pasos manuales, y los diez que no lo son

Al final del archivo, sección «Los dos pasos manuales». **Son dos.** La lista del
hito 6 arrancó con doce y diez se podían automatizar; acá cada candidato pasó por
la pregunta «¿de verdad no baja a ninguno de los cuatro niveles?» y solo dos
sobrevivieron.

---

## Phase 1: La cadena de la invitación (corte 1)

**Purpose**: al terminar, el enlace del mail de una invitación lleva a una
pantalla que existe, `GET /api/auth/invite/:token` contesta 200 o 404 —y no 401—,
`POST /api/auth/accept-invite/:token` crea la membresía, y
`POST /api/empresas/onboarding` deja de responder 403 al usuario para el que
existe. Es la única funcionalidad del hito que **nunca funcionó**.

- [x] **T1349** El montaje, en un solo commit porque no se puede partir sin dejar
      la suite en rojo. **(a)** `apps/api/src/routes/auth.js`: pasa de
      `module.exports = router` a `module.exports = { publico, privado }`,
      `publico` con el `GET /invite/:token` y `privado` con el
      `POST /accept-invite/:token`. El molde exacto es `routes/tiendanube.js`.
      **(b)** `apps/api/src/server.js`: se borran las líneas 422-423 y suben,
      **arriba de `app.use('/api', ...authEmpresa, require('./routes/general'))`**
      (línea 396), estas tres —el `/api/empresas` de la línea 415 también sube—:
      ```js
      app.use('/api/auth', require('./routes/auth').publico);
      app.use('/api/auth', ...authSinEmpresa, require('./routes/auth').privado);
      app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'));
      ```
      con el comentario que dice **por qué arriba** (los middlewares de un
      `app.use('/api', …)` corren para todo lo que empiece con `/api`, matchee o
      no el router de atrás). **(c)** Crear
      `apps/api/src/tests/montajeDeRouters.test.js` con las dos reglas y sus
      cuatro muestras sintéticas, siguiendo el molde de
      `observabilidad.test.js:476-537` («El router publico de TiendaNube se monta
      antes del express.json global»), que es la única guardia de orden que ya
      existe:
      - **regla de tipo**: ningún `app.get`/`app.post`/`app.put`/`app.delete` de
        `server.js` puede tener como último argumento un `require('./routes/…')`.
        Muestra mala: la línea 422 de hoy, textual. Muestra buena: el `app.use`
        equivalente.
      - **regla de orden**: todo montaje de un subcamino de `/api` cuya cadena
        **no incluya `requireEmpresa`** tiene que aparecer **antes** del montaje
        genérico `app.use('/api',`. Muestra mala: el orden de hoy
        (`app.use('/api', …authEmpresa, general)` y debajo
        `app.use('/api/empresas', …authSinEmpresa, empresas)`). Muestra buena: el
        orden nuevo. **Y una tercera muestra**: `/api/dashboard` con
        `...authEmpresa` **debajo** del genérico tiene que pasar — sin ella la
        guardia se escribe como la enuncia el plan y sale roja contra trece
        montajes correctos (punto 3 de «Antes de empezar»).
      - **la guardia devuelve `null` si no encuentra el montaje genérico**, y se
        afirma que no es `null` contra el `server.js` real: es lo que impide que
        un renombre la deje pasando por vacío. Es la lección de
        `observabilidad.test.js:505-509`.
      **(d)** `apps/api/src/tests/permisosDeRutas.test.js`: `ROUTERS_SIN_SESION`
      cambia la clave `'routes/auth.js router'` por `'routes/auth.js publico'` con
      el motivo reescrito, y `SIN_PERMISO_A_PROPOSITO` gana su **cuarta** entrada
      para `'routes/auth.js POST /accept-invite/:token'`. Ver punto 4 de «Antes de
      empezar».
      **Verificación**: `npm run test:api -- montajeDeRouters permisosDeRutas
      server` en verde. `npm --prefix apps/api run test:integracion --
      invitaciones` da **404** (y no 401) para
      `GET /api/auth/invite/token-que-no-existe`.
      **El test que evita el defecto**: `montajeDeRouters.test.js` ·
      *«un montaje sin requireEmpresa debajo del /api genérico es un 403 que nunca
      llega al handler»*.
      **Qué se revierte para verlo en rojo**: mover las tres líneas de `server.js`
      de vuelta abajo del `app.use('/api', …)`. La guardia se pone en rojo
      nombrando `/api/auth` y `/api/empresas` con su número de línea.
      ⚠ **Ningún test de integración puede distinguir el orden bueno del malo**:
      con `BYPASS_AUTH=true`, `server.js:321` clava `req.empresaId = 1` y
      `requireEmpresa` nunca dispara. La guardia estática es la única red. No la
      borres creyendo que el test de integración la cubre (riesgo 7 del plan).

- [x] **T1350** En `apps/api/src/routes/auth.js`, el
      `POST /accept-invite/:token`: **(a)** los tres casos —token inexistente,
      vencido, ya usado— se buscan por separado y se distinguen en el mensaje
      (FR-102). Hoy un solo `findOne` con `status:'pending'` y `expires_at > NOW()`
      los colapsa en «Invitación no encontrada, expirada o el email no coincide».
      **(b)** El `findOrCreate` + `update({ is_active: true, role })` de
      `auth.js:38-40` deja de reactivar: si la `UsuarioEmpresa` existe con
      `is_active: false`, **no se reactiva ni se le cambia el rol**, y la respuesta
      dice que hay que pedirle a un administrador que lo vuelva a activar (FR-120,
      PENDIENTE N15). Crear
      `apps/api/src/tests/integracion/invitaciones.integracion.test.js`.
      **Verificación**: `npm --prefix apps/api run test:integracion -- invitaciones`.
      **Los tests que evitan el defecto**: *«un token vencido, uno usado y uno
      inexistente NO dicen los tres lo mismo»* y *«una invitación de hace tres
      meses NO le devuelve el acceso a alguien a quien se desactivó a propósito»*.
      **Qué se revierte para verlo en rojo**: volver a poner
      `await ue.update({ is_active: true, role: invitacion.role, … })` en el `if
      (!created)`. El segundo test falla porque la fila queda con `is_active: true`.

- [x] **T1351** [P] En `apps/api/src/services/email.js:90`, la URL del enlace pasa
      de `${frontendUrl}/accept-invite/${token}` a `${frontendUrl}/?invite=${token}`
      (FR-104), con el comentario que dice **por qué no es una `<Route>` nueva**:
      el `<Routes>` de `App.jsx` vive adentro del shell autenticado, que exige
      contexto de empresa y desloguea con `contextError` —justo lo que un invitado
      no tiene— y sumaría una decimonovena ruta contra FR-004. El mecanismo
      `?invite=` ya existe en `App.jsx:132-138`.
      **Verificación**: `npm run test:api -- email` (o el archivo nuevo
      `src/tests/enlaceDeInvitacion.test.js` si el que existe no cubre el HTML).
      **El test que evita el defecto**: *«el enlace del mail apunta a una ruta que
      App.jsx atiende, y `/accept-invite/` no lo es»*, afirmando que el HTML
      contiene `/?invite=` y **no** contiene `/accept-invite/`.
      **Qué se revierte para verlo en rojo**: la línea 90.

- [x] **T1352** [P] Crear `apps/web/src/utils/invitacion.js` con
      `decidirTrasAceptar(error)` → `{ borrarToken, mensaje, tono }`, pura y que
      **nunca devuelve `undefined`**: 404 → borrar el token y decir que la
      invitación no es válida o venció; 409/«ya sos miembro» → borrar y avisar;
      cualquier otro (red, 500, timeout) → **conservar** el token y decir que se va
      a reintentar. `apps/web/src/App.jsx:140-152` la usa y deja de tener el
      `.catch(() => { localStorage.removeItem('pendingInvite') })` que descarta el
      token en silencio (FR-108, E4). Su test en
      `apps/web/src/utils/invitacion.test.js`.
      **Verificación**: `npm run test:web -- invitacion`, y
      `grep -n "removeItem('pendingInvite')" apps/web/src/App.jsx` no aparece
      adentro de ningún `catch` vacío.
      **El test que evita el defecto**: *«un 500 del servidor NO borra el token: la
      invitación no se pierde porque la API estaba caída»*.
      **Qué se revierte para verlo en rojo**: hacer que `decidirTrasAceptar`
      devuelva `{ borrarToken: true }` para todo.

**Checkpoint**: con la API levantada y un `Invitacion` sembrado a mano,
`curl /api/auth/invite/<token>` devuelve el email y el nombre de la empresa sin
token de sesión. `POST /api/empresas/onboarding` con un usuario sin empresa
devuelve 201 y no 403.

---

## Phase 2: Los números del Panel (corte 2) — servidor solo

**Purpose**: los cinco defectos de plata quedan corregidos **sin tocar una línea
de la pantalla**. Este corte se despliega solo y se revierte solo: el día que
«Por Pagar» baje a la mitad, la respuesta a «¿qué le pasó al sistema?» tiene que
ser «esto y nada más».

⚠ **Los campos nuevos (`series`, `requiere_atencion`, `ultimas_ventas`) NO entran
acá**, aunque sean del servidor: van en T1377, con la pantalla que los consume.
Meterlos acá haría que este corte no se pueda revertir sin romper también lo que
todavía nadie usa.

- [x] **T1353** Crear `apps/api/src/utils/antiguedad.js` con
      `repartirPorAntiguedad(filas, hoy, { fecha, importe })` → los cuatro tramos,
      sacado tal cual de `customerService._repartirPorAntiguedad`
      (`customerService.js:233`, `:249`), **sin cambio de comportamiento**, con su
      docstring diciendo que es una aproximación —hoy lo dice el método privado y
      esa advertencia tiene que llegar a la nota al pie de la tarjeta, no quedarse
      en el código—. `customerService.js` lo importa y borra el método. Su test en
      `apps/api/src/tests/antiguedad.test.js` (**nunca** `utils/antiguedad.test.js`:
      `jest.config.js` no lo levanta).
      **Verificación**: `npm run test:api -- antiguedad customerService`. Los tests
      de `customerService.test.js` pasan **sin haberlos tocado** — es lo único que
      demuestra que la extracción no movió los números de Clientes (riesgo 9 del
      plan).
      **El test que evita el defecto**: *«un saldo de 0 se reparte en cuatro ceros
      y no en un `NaN`»*, y *«los cuatro tramos suman exactamente el total»*.
      **Qué se revierte para verlo en rojo**: cambiar un `<` por un `<=` en
      cualquiera de los tres cortes.

- [x] **T1354** En `apps/api/src/services/dashboardService.js`, `_payables`
      (`:207-249`): deja de sumar solo `type:'deuda'` y pasa a
      `resumenDeCuenta` de `utils/cuentaDeProveedor.js` (deuda − pagado, **en
      centavos enteros**), y el aging pasa a `repartirPorAntiguedad` sobre el saldo
      **impago** (P1, P3, FR-040, FR-041, FR-042). Crear
      `apps/api/src/tests/integracion/panel.integracion.test.js`.
      **La fixture tiene que poder distinguir el defecto**: un proveedor con deuda
      **y un pago parcial**, con importes que tengan centavos que no cierren solos.
      Una fixture con una deuda de 100.000 y ningún pago pasa con y sin la
      corrección.
      **Verificación**: `npm --prefix apps/api run test:integracion -- panel`.
      **Los tests que evitan el defecto**: *«registrar un pago BAJA Por Pagar»* y
      *«los cuatro tramos del aging suman el total que la tarjeta muestra»*.
      **Qué se revierte para verlo en rojo**: volver a
      `where: { type: 'deuda' }`. El primero falla con el total sin restar.

- [x] **T1355** En el mismo archivo, `_customerStats` (`:116-160`) y `_receivables`:
      **(a)** las dos `SUM` por cliente se reemplazan por **dos `GROUP BY` fijos**
      —uno de ventas a cuenta corriente, uno de pagos—, con el molde de
      `suppliers.js:307-311` (P16, FR-062); **(b)** solo cuentan las ventas con
      `is_credit` (P2, FR-043); **(c)** la comparación pasa a **centavos enteros**
      con `utils/centavos.js`, así que un cliente que pagó exactamente lo que debía
      no cuenta con deuda (FR-044); **(d)** el aging de «Por Cobrar» usa
      `repartirPorAntiguedad` sobre el saldo impago, así que los cuatro tramos
      suman el total (P3, FR-045).
      **La fixture tiene que poder distinguir el defecto**: una venta **de contado**
      a un cliente identificado (si no, (b) pasa igual), y un cliente que pagó
      exactamente su deuda con centavos (si no, (c) pasa igual).
      **Verificación**: `npm --prefix apps/api run test:integracion -- panel`, y
      dentro de él `capturarConsultas` afirma que `_customerStats` hace **un número
      fijo** de consultas con 1 cliente y con 20 — hoy hace 2N.
      **Los tests que evitan el defecto**: *«una venta de contado a un cliente
      identificado NO cuenta como por cobrar»*, *«el cliente que pagó exactamente
      lo que debía NO figura con deuda»* y *«veinte clientes no cuestan cuarenta
      consultas»*.
      **Qué se revierte para verlo en rojo**: sacar `is_credit: true` del `where`.

- [x] **T1356** En el mismo archivo, los seis `new Date().toISOString().split('T')[0]`
      (`:17-22`, `:162-164`, `:218-221`, `:294`) pasan a `hoyDelNegocio(empresaId)`
      de `utils/fechas.js`; `getKpis` recibe el `hoy` ya resuelto y lo propaga,
      como hace `filtroVentas.js`. Los cortes de mes pasan de `Op.between` a
      **semiabiertos `[from, to)`** (P4, P5, FR-046, FR-048). Y el `growth` que
      compara un mes parcial contra uno completo gana su rótulo en la respuesta
      (FR-047): un campo `comparacion_parcial: true`, que la pantalla dibuja.
      **La fixture tiene que poder distinguir el defecto**: una venta **el día 1**
      del mes (si no, P4 pasa igual), y `Empresa.timezone` distinto de UTC con una
      venta a las 22:00 hora argentina (si no, P5 pasa igual).
      **Verificación**: `npm --prefix apps/api run test:integracion -- panel`.
      **Los tests que evitan el defecto**: *«la venta del día 1 se cuenta UNA vez,
      no en el mes actual y en el anterior»* y *«el corte del día usa
      Empresa.timezone y no la fecha UTC del servidor»*.
      **Qué se revierte para verlo en rojo**: volver `firstOfMonth`/`today` a
      `Op.between`. El primero falla porque el total del mes anterior incluye la
      venta del día 1.

- [x] **T1357** En el mismo archivo, `_productStats` (`:251-270`) y
      `_lowStockAlerts` (`:271-292`): el
      `literal('quantity <= min_stock AND min_stock > 0')` se va y las filas se
      cuentan con `esStockBajo(fila, umbral)` de `apps/api/src/utils/stockBajo.js`,
      con `Product.is_active` y el `include` de `Product` **filtrado por empresa**
      (P10, P17, FR-063). **Y se reescribe el encabezado de
      `apps/api/src/utils/stockBajo.js`**: hoy dice, en el bloque «Lo que NO se
      toca a proposito», que `GET /api/alerts` y `dashboardService.js:250` siguen
      con la regla vieja y que Inventario va a mostrar más productos que el panel.
      Después de esto es **falso**, y un comentario que describe una divergencia
      que ya no existe es peor que no tener comentario.
      **La fixture tiene que poder distinguir el defecto**: un producto **en cero
      sin `min_stock` cargado** — es el que la regla vieja no ve y la nueva sí, y
      es el que hace que el número **suba**.
      **Verificación**: `npm --prefix apps/api run test:integracion -- panel`, y
      `npm run test:api -- stockBajo`.
      **El test que evita el defecto**: *«un producto en cero SIN mínimo cargado
      cuenta como stock bajo en el Panel, igual que en Faltantes»*.
      **Qué se revierte para verlo en rojo**: volver el `literal`.

- [x] **T1358** El recorte por permiso. `getKpis(empresaId, { permisos, hoy })`
      **omite la clave entera** de cada bloque que el usuario no puede ver —`cashflow`
      con `caja.ver`, `receivables` y `customers.with_debt` con `clientes.ver`,
      `payables` con `proveedores.ver`, `fixed_expenses` con `gastos.ver`—, y
      `apps/api/src/routes/dashboard.js` le pasa los permisos de `req` (decisión 8,
      FR-049, FR-050). **La clave ausente y la clave en cero son cosas distintas**:
      nada devuelve `null`, porque `null` y `0` se confunden en cuanto alguien
      escribe `kpis.cashflow?.balance || 0`, que es lo que la pantalla hace hoy en
      seis lugares.
      **Verificación**: `npm --prefix apps/api run test:integracion -- panel`.
      **El test que evita el defecto**: *«un rol sin caja.ver NO recibe la clave
      cashflow — no la recibe en cero, no la recibe»*, con los cinco roles del
      catálogo y sus permisos leídos de `seedPermissions.js`.
      **Qué se revierte para verlo en rojo**: devolver `cashflow: null` en vez de
      omitirla. El test afirma `expect('cashflow' in data).toBe(false)`.
      ⚠ Con `BYPASS_AUTH` el usuario de la sesión es `admin` y los tiene todos:
      el test tiene que **construir el objeto de permisos a mano** y llamar a
      `getKpis` directo además de pegarle al endpoint, o pasa por vacío.

- [x] **T1359** [P] `docs/OPERACION.md` gana la sección **«Los números del Panel
      cambiaron»**, con la fecha del deploy y la tabla exacta: qué indicador, en qué
      dirección se mueve, por qué. «Por Pagar» **baja** y puede bajar mucho porque
      hasta hoy no restaba los pagos; «Por Cobrar» y «clientes con deuda» **bajan**
      porque contaban las ventas de contado; los cuatro tramos del aging cambian
      porque hasta hoy no podían cerrar con su total; «stock bajo» **sube** porque
      pasa a contar los productos en cero sin mínimo cargado; las ventas del mes
      **bajan** un poco porque la venta del día 1 dejaba de contarse dos veces.
      **Verificación**: `grep -c "Por Pagar" docs/OPERACION.md` ≥ 1 y la sección
      nombra los cinco indicadores. No hay test: es documentación, y su verificación
      es que exista antes de que el corte se despliegue — paso manual M2.

**Checkpoint**: `GET /api/dashboard/kpis` con la sesión de la empresa A devuelve
otros números que ayer, y `panel.integracion.test.js` explica cuál cambió y por
qué. La pantalla sigue siendo la de siempre y no se rompió.

---

## Phase 3: Lo que queda de la superficie fiscal (corte 3)

**Purpose**: se cierra la mitad de A3 que `01fc77d` dejó abierta y desaparece el
único camino que emite un comprobante fiscal sin venta. Tres `if` y un borrado:
no depende de ninguna decisión de diseño y por eso va antes que la pantalla.

- [x] **T1360** En `apps/api/src/utils/settingsSecretos.js`, una **segunda lista**:
      `SETTINGS_DE_SOLO_LECTURA = ['afip_environment', 'afip_pv', 'afip_verificacion']`,
      con su propio motivo escrito (no son secretas —la pantalla las necesita para
      dibujarse— pero **la única mano que las escribe es el servidor**), y
      `esDeSoloLectura(clave)`. **`SETTINGS_SECRETOS` no se toca.** En
      `apps/api/src/routes/general.js:471`, el `PUT /settings/:key` la rechaza con
      400 y el mensaje que **nombra el camino**: «El ambiente y el punto de venta se
      cambian desde Ajustes → Facturación, que valida el punto de venta contra AFIP
      y renueva el ticket de acceso.» (FR-072, decisión 10). Se extiende
      `apps/api/src/tests/settingsSecretos.test.js` y se crea
      `apps/api/src/tests/integracion/settingsSinSecretos.integracion.test.js`.
      **Verificación**: `npm run test:api -- settingsSecretos` y
      `npm --prefix apps/api run test:integracion -- settingsSinSecretos`.
      **Los tests que evitan el defecto**: *«PUT /api/settings/afip_environment con
      "production" responde 400 y NO escribe ninguna fila»* y —el que solo la
      integración puede contestar— *«la cadena `-----BEGIN` no aparece en el cuerpo
      de GET /api/settings»* (FR-074), con un `afip_key` sembrado de verdad.
      **Qué se revierte para verlo en rojo**: sacar `esDeSoloLectura` del `if` de
      `general.js:471`.

- [x] **T1361** En `apps/api/src/routes/afip.js`, todos los caminos que escriben
      ambiente o credenciales pasan por **una sola función**,
      `guardarConfiguracionAfip(empresaId, cambios, { transaction })`, que es la que
      llama a `afipAuth.invalidarCache(empresaId)` (`afipAuth.js:78-80`) — hoy la
      llama solo `POST /setup` en la línea 151 (FR-076, decisión 10).
      **Verificación**: `npm run test:api -- afip`, y una guardia adentro del mismo
      archivo de test: **ninguna escritura de `afip_environment` fuera de
      `guardarConfiguracionAfip`**, buscada sobre el texto de `routes/` y `services/`.
      **El test que evita el defecto**: *«cambiar el ambiente invalida el ticket
      WSAA cacheado, por cualquier camino»* — se cambia el ambiente por el endpoint
      y se afirma que `afipAuth.taCache.has(empresaId)` es `false`.
      **Qué se revierte para verlo en rojo**: sacar la llamada a `invalidarCache` de
      `guardarConfiguracionAfip`.

- [x] **T1362** Borrar `POST /api/afip/invoice` (`apps/api/src/routes/afip.js:200-220`),
      que emite un comprobante fiscal real con `ventas.crear` —el permiso del rol
      `vendedor`— sin crear ninguna `Sale` (A4, FR-077, PENDIENTE N12, decisión 12).
      No lo llama el frontend. Y una **guardia estática nueva** en
      `apps/api/src/tests/aislamientoEmpresas.test.js` o en
      `observabilidad.test.js`: **ninguna ruta fuera de `routes/sales.js` puede
      llamar a `afipService.createVoucher`**, con su muestra sintética mala (un
      `routes/loQueSea.js` que lo llama) y su muestra buena. Sacar la entrada
      correspondiente de `permisosDeRutas.test.js` si la hubiera.
      **Verificación**: `npm run test:api -- afip aislamientoEmpresas permisosDeRutas`.
      **El test que evita el defecto**: *«ninguna ruta fuera de sales.js emite un
      comprobante: el CAE huérfano no vuelve»*.
      **Qué se revierte para verlo en rojo**: pegar de vuelta el handler de
      `/invoice`. La guardia lo nombra con archivo y línea.

**Checkpoint**: `PUT /api/settings/afip_environment` responde 400 con el camino
escrito, `GET /api/settings` no trae ni un `-----BEGIN`, y no queda ningún
endpoint que pueda emitir un comprobante sin una venta detrás.

---

## Phase 4: Gastos · reglas y pantalla (corte 4)

**Purpose**: **la plata se ve sin tocar un dato**. Un gasto fijo sin sucursal
aparece en «General» con su tarjeta, los totales los calcula el servidor en
centavos, y un gasto no se puede colgar de la sucursal de otra empresa. Va
**antes** que la migración: si la migración se revierte, el gasto tiene que
seguir viéndose (ajuste 5(a) del plan).

- [x] **T1363** [P] Crear `apps/web/src/utils/gastos.js` con
      `agruparGastosPorSucursal(gastos, sucursales)`, que reparte **solo por
      `punto_de_venta_id`**: con sucursal, a esa sucursal; sin sucursal, a
      «General». **La columna `group` no se mira** (FR-022, FR-024, decisión 6) —
      `'gf1'` significa «Ortiz de Ocampo» en Comprafit y no significa nada en
      general. Su test en `apps/web/src/tests/gastos.test.js`, y lo que afirma es
      el **invariante**, no tres casos elegidos a mano: sobre una lista de gastos
      cualquiera, **la suma de todos los grupos es igual a la suma de la entrada** y
      **ningún gasto aparece en dos grupos** (FR-020, FR-021).
      **Verificación**: `npm run test:web -- gastos`.
      **Los tests que evitan el defecto**: *«ningún gasto fijo queda afuera de todos
      los grupos»* y *«un gasto con group='gf2' y sin sucursal va a General, no a la
      segunda sucursal»*.
      **Qué se revierte para verlo en rojo**: hacer que la función descarte los
      gastos con `punto_de_venta_id` nulo. El invariante de suma falla.

- [x] **T1364** En `apps/api/src/routes/general.js`, `GET /expenses` (`:311-325`)
      devuelve `{ data, totales: { general, sin_sucursal, por_sucursal }, alcance }`,
      sumado con `sumaEnCentavos` de `utils/centavos.js` sobre `amount` —que es
      `DECIMAL(12,2)` y **vuelve como string**— y **de la misma lectura** que las
      filas, para que no puedan no cerrar (G2, FR-026, FR-027, FR-028). `alcance`
      es `"empresa"` siempre (FR-037, G8): `req.puntoDeVentaId` **no** se aplica
      como caída, a diferencia de `/faltantes`. El filtro `?group=` deja de
      aceptarse. Crear
      `apps/api/src/tests/integracion/gastos.integracion.test.js`.
      **La fixture tiene que poder distinguir el defecto**: importes con centavos
      que no cierren en punto flotante (`0.1 + 0.2`), y al menos un gasto **sin
      sucursal** (si no, `sin_sucursal` sale 0 con y sin la corrección).
      **Verificación**: `npm --prefix apps/api run test:integracion -- gastos`.
      **Los tests que evitan el defecto**: *«el total general es la suma de las
      tarjetas, incluida General»* y *«el SUM de un DECIMAL vuelve como string y el
      total igual cierra al centavo»*.
      **Qué se revierte para verlo en rojo**: sumar con
      `data.reduce((a, g) => a + parseFloat(g.amount), 0)`.

- [x] **T1365** En el mismo archivo, `POST /expenses` (`:328-338`) y
      `PUT /expenses/:id` (`:341-353`): **(a)** se va el
      `const data = { ...req.body, empresa_id }` y quedan **campos explícitos**
      —`name`, `amount`, `punto_de_venta_id`— (FR-030); **(b)** `group`, `empresa_id`
      e `id` del cuerpo se ignoran (FR-031, FR-032); **(c)** `punto_de_venta_id`,
      cuando viene, pasa por `findScoped(PuntoDeVenta, id, empresaId)` **antes de
      escribir**, y una sucursal de otra empresa responde **404** —no 403: un
      recurso ajeno no existe— (G4, FR-029). El servidor sigue escribiendo
      `group = 'pv_' + id` para no dejar la columna `NOT NULL` sin valor; nadie la
      lee.
      ⚠ **No se usa `resolverSucursal` de `utils/sucursalDeStock.js` aunque valide
      exactamente lo que FR-029 pide**: nunca devuelve `null` —cae a la sucursal por
      defecto— y acá un gasto sin sucursal es un caso legítimo («General»).
      `findScoped` directo, y el motivo escrito arriba de la llamada.
      **Verificación**: `npm --prefix apps/api run test:integracion -- gastos`.
      **Los tests que evitan el defecto**: *«POST /expenses con la sucursal de otra
      empresa responde 404 y NO crea ninguna fila»* —se cuenta
      `FixedExpense.count()` antes y después— y *«un empresa_id en el cuerpo no
      cambia de dueño el gasto»*.
      **Qué se revierte para verlo en rojo**: volver al spread del cuerpo.

- [x] **T1366** En `apps/api/src/routes/gastosVariables.js`, `POST /` (`:107-135`)
      y `PUT /:id` (`:138-165`): el `punto_de_venta_id || null` pasa por
      `findScoped(PuntoDeVenta, …)` cuando no es nulo (G4, FR-029), y `mesActual()`
      pasa a salir de `hoyDelNegocio(empresaId)` en vez de `toISOString()` (G6,
      FR-035).
      **Verificación**: `npm --prefix apps/api run test:integracion -- gastos`.
      **Los tests que evitan el defecto**: *«un gasto variable no se cuelga de la
      sucursal de otra empresa»* y *«a las 22:00 de Buenos Aires el mes por defecto
      sigue siendo el de acá y no el de mañana en UTC»*.
      **Qué se revierte para verlo en rojo**: volver
      `cambios.punto_de_venta_id = req.body.punto_de_venta_id || null`.

- [x] **T1367** En `apps/api/src/tests/aislamientoEmpresas.test.js`, el detector
      `analizarCreates` (`:423-483`) gana las **dos formas nuevas** (FR-033,
      decisión 21):
      - **(a) el objeto armado antes**: `const data = { ...req.body, empresa_id };
        … Model.create(data)`. Hoy `clavesForaneas(argumentos)` recibe el
        identificador `data`, devuelve cero claves y el bucle hace `continue`
        (`:437`) **antes de mirar nada**. El detector tiene que resolver el
        identificador a su declaración dentro del mismo ámbito, y tratar un
        `...req.body` como «trae todas las claves foráneas posibles».
      - **(b) el valor destructurado de `req.body` con `|| null`**:
        `const { punto_de_venta_id } = req.body; … create({ punto_de_venta_id:
        punto_de_venta_id || null })`. La normalización de `||` **ya existe**
        (`:456`), pero después el valor queda como `punto_de_venta_id` a secas y
        ninguna de las dos ramas de `:459-460` lo marca: hay que resolver las
        variables destructuradas de `req.body`/`req.params`/`req.query` a su origen.
      **Cada corrección se ejercita contra un archivo sintético con el defecto**,
      exigiendo que el detector lo nombre **con archivo y línea** — dos muestras
      malas y dos buenas, siguiendo el molde de `MUESTRA_CREATE_CORTA_MALA` /
      `…_BUENA` que ya está en el archivo. Sin eso, «arreglé el detector» pasa en
      verde tanto si encuentra el caso como si no.
      **Verificación**: `npm run test:api -- aislamientoEmpresas`.
      **Los tests que evitan el defecto**: *«ve el create que cuelga de un objeto
      armado antes con spread del cuerpo»* y *«ve el punto_de_venta_id
      destructurado del cuerpo con || null»*.
      **Qué se revierte para verlo en rojo**: revertir T1365 o T1366 — el detector
      tiene que nombrar `routes/general.js:331` y
      `routes/gastosVariables.js:130`. **Corré esa reversión de verdad antes de
      cerrar la tarea**: es la única forma de saber que el detector encuentra la
      forma real y no solo la muestra sintética.
      📌 **Queda anotado y no se hace acá**: el detector tampoco ve un
      `Model.update(cambios)` con una clave foránea del cuerpo
      (`gastosVariables.js:150`), porque solo mira `create`/`bulkCreate`/`findOrCreate`.
      Es una **tercera** forma, no está en FR-033 y agregarla es un relevamiento
      propio sobre todos los `update` del repositorio.

- [x] **T1368** [P] En `apps/api/src/models/FixedExpense.js:33`, la columna `group`
      pierde el `defaultValue: 'gf1'`. **La columna se queda** y el `DEFAULT` de la
      base también, así que un `create` sin `group` no falla (data-model, «La
      columna es `STRING(10) NOT NULL`»). Borrarla no es reversible y no gana nada
      — misma decisión que la 013 con `products.tiendanube_variant_id`.
      **Verificación**: `npm run test:api -- modelo` y
      `npm --prefix apps/api run test:integracion -- gastos`.
      **El test que evita el defecto**: *«un gasto creado sin `group` se guarda
      igual: la columna sigue siendo NOT NULL y el DEFAULT de la base la llena»* —
      es el modo de falla que este cambio podría introducir el día del deploy.
      **Qué se revierte para verlo en rojo**: no aplica al revés; el test protege
      contra el efecto colateral, no contra el cambio.

- [x] **T1369** [P] En `apps/web/src/utils/formato.test.js`, la constante
      `PROHIBIDO` (`:311-329`) gana una quinta regla: **el formateo en línea**
      —`.toLocaleString(`, `.toLocaleDateString(`, `new Intl.NumberFormat(`— en
      cualquier archivo de `pages/` o `components/` (FR-013). Hoy la guardia solo
      mira **funciones declaradas** y `*FractionDigits`, que es exactamente el
      camino por el que las cuatro pantallas de este hito la esquivan.
      ⚠ **Hay veinticinco archivos que hoy la infringirían**, así que la regla entra
      con su lista de deuda: `PENDIENTES` se completa con lo que el detector
      encuentre **corriéndolo**, no adivinando, y cada entrada lleva su motivo.
      **Los cinco archivos de FR-005 NO pueden entrar en esa lista**: son los que
      este hito reescribe, y cada corte les saca la infracción. Entre T1369 y T1407
      la lista baja de a uno; el `it('la lista de pendientes no junta polvo')` que
      ya existe (`:406-417`) obliga a borrar la entrada cuando el archivo se migra.
      **Verificación**: `npm run test:web -- formato`.
      **El test que evita el defecto**: *«un importe formateado en línea con
      toLocaleString, sin declarar ninguna función, no esquiva la guardia»*, con su
      muestra sintética.
      **Qué se revierte para verlo en rojo**: sacar la quinta regla de `PROHIBIDO`;
      la muestra sintética deja de dar hallazgos.

- [x] **T1370** Crear `apps/web/src/components/PanelDeGasto.jsx`: panel lateral de
      **520px con `max-w-[92vw]`** sobre `ui/sheet` (FR-039), con el alta y la
      edición de un gasto fijo — la edición es lo que FR-034 pide y hoy no existe
      (`services/api.js:222` declara `updateExpense` y **ningún componente lo
      importa**, verificado con grep sobre todos los `.jsx`). Entra en `NOMBRES` de
      `guardiasDeDiseno.test.js` y el ancla sube a **20**.
      **Verificación**: `npm run test:web -- guardiasDeDiseno renderDeGastos`.
      **El test que evita el defecto**: en `renderDeGastos.test.jsx`, *«editar un
      gasto llama a PUT /expenses/:id y no a POST»* — hoy corregir un gasto obliga a
      borrarlo y volver a crearlo.
      **Qué se revierte para verlo en rojo**: hacer que el botón de guardar llame
      siempre a `createExpense`.

- [x] **T1371** Reescribir `apps/web/src/pages/Expenses.jsx` con el patrón del
      sistema: `PageHeader` (FR-018) · las dos solapas como **segmentos** con la
      forma de `AdminApp-Rediseno.dc.html:645-648` (FR-038) · `TablaGrid` /
      `Encabezado` / `Fila` / `BotonDeFila` con el **mismo string** de
      `grid-template-columns` en el encabezado y en las filas (FR-007) · las
      tarjetas de total por grupo **incluida «General»** y sin filtrar por nombre
      (FR-023) leyendo `totales` del servidor y agrupando con
      `agruparGastosPorSucursal` · el `alcance` escrito en pantalla (FR-037) ·
      `Can` en todas las acciones y el botón «Eliminar» **deshabilitado con su
      explicación** para el rol `gerente`, que no tiene `gastos.eliminar` (G7,
      FR-017, FR-036) · `mensajeDeError` de `utils/erroresDeApi.js` en todos los
      `catch` (FR-008) · el fallo de carga **en pantalla** y no en un
      `console.error` (FR-009, hoy `Expenses.jsx:35`) · el campo **«Facturación
      mensual promedio»** que escribe `settings.target_sales`, como lo tenía el
      legacy (decisión 13, FR-051) · los importes por `utils/formato.js` (FR-010,
      FR-011) · un estado vacío que diga algo propio (FR-019). En
      `apps/web/src/services/api.js`, los helpers de gastos que faltan quedan con
      llamador. Entra en `NOMBRES`, ancla a **21**, y sale de `PENDIENTES` de
      `formato.test.js`. Su test en `apps/web/src/tests/renderDeGastos.test.jsx`.
      **Verificación**: primero agregá el nombre a `NOMBRES` y corré
      `npm run test:web -- guardiasDeDiseno` **antes** de tocar el componente:
      tiene que dar hallazgos > 0 (hoy importa `Table`, `TableBody`, `TableCell`,
      `TableRow` de shadcn). Después reescribí y corré
      `npm run test:web -- guardiasDeDiseno formato renderDeGastos`.
      **Los tests que evitan el defecto**: *«las tarjetas de total suman lo mismo
      que las filas»*, *«un gasto sin sucursal se dibuja en General y General tiene
      su tarjeta»*, *«sin gastos.eliminar el botón está deshabilitado y dice por
      qué»* y *«un 500 muestra el mensaje del servidor y no “Request failed with
      status code 500”»*.
      **Qué se revierte para verlo en rojo**: cambiar `mensajeDeError(err)` por
      `err.message` en un `catch`; el cuarto test falla con el texto de axios.

- [x] **T1372** Reescribir `apps/web/src/components/GastosVariables.jsx` con el
      mismo patrón (FR-006 a FR-012, FR-017, FR-019), leyendo el mes de
      `utils/formato.js` y no de `toISOString()`. Entra en `NOMBRES`, ancla a
      **22**, y sale de `PENDIENTES` de `formato.test.js`. Sus casos van en
      `renderDeGastos.test.jsx`.
      **Verificación**: la misma disciplina de T1371 —hallazgos > 0 antes de
      reescribir— y después `npm run test:web`.
      **El test que evita el defecto**: *«el mes por defecto de la solapa de
      variables no adelanta el día»*.
      **Qué se revierte para verlo en rojo**: volver a `new Date().toISOString()`.

- [x] **T1373** [P] Crear el caso de navegador en
      `apps/web/pruebas-de-navegador/maquetadoDeGastos.navegador.js`: **el nombre de
      un gasto largo no se mete en la columna de importe**. Es geometría —el `right`
      de la caja del nombre contra el `left` de la del importe— y jsdom devuelve
      cero en las tres medidas, así que un test de render pasaría con y sin el
      defecto. Los datos salen del sistema, sembrados por HTTP con
      `pruebas-de-navegador/preparacion.js`, y **no de un doble**.
      **Verificación**: `npm --prefix apps/web run test:navegador -- maquetadoDeGastos`.
      **El test que evita el defecto**: *«“Alquiler del depósito de Ortiz de Ocampo
      y expensas” no invade la columna de importe»*.
      **Qué se revierte para verlo en rojo**: sacarle el `truncate` / `min-w-0` a la
      celda del nombre. ⚠ Verificá que se ponga en rojo de verdad: tres de las once
      primeras pruebas de geometría del repositorio **no** se pusieron en rojo con
      su mutación.

**Checkpoint**: `/gastos` muestra todos los gastos fijos de la empresa, agrupados
por sucursal, con «General» y su tarjeta, con los totales del servidor, y un
gasto se puede editar. **Ningún dato se movió todavía.**

---

## Phase 5: Gastos · la migración (corte 5)

**Purpose**: los gastos fijos que hoy no tienen sucursal pasan a la sucursal por
defecto de su empresa, con el informe fila por fila. **Depende de la fase 4**: la
pantalla ya es correcta con los datos como están, así que revertir esta migración
no vuelve a esconder la plata.

- [x] **T1374** [P] En `apps/api/scripts/verificar-reversibilidad.js`, la función
      `sembrar()` (`:493`) gana **gastos fijos**: al menos uno **sin sucursal** en la
      empresa 1 —que tiene dos sucursales y donde `code='principal'` **no** es la de
      menor id—, uno **con** sucursal (que la migración no debe tocar), y uno sin
      sucursal en la **empresa 2**, que no tiene ninguna sucursal cargada. Importes
      con centavos.
      **Sin esto, el `up` no mueve nada, el `down` no restaura nada y las dos fotos
      dan iguales por la razón equivocada** — es el mismo error que el encabezado del
      script ya documenta para los ENUM y para la fusión de recetas.
      **Verificación**: `node apps/api/scripts/verificar-reversibilidad.js` en verde
      **antes** de que exista la migración (no hay nada que revertir todavía, y eso
      es lo que se quiere: que el sembrado no rompa nada por sí solo).
      **El test que evita el defecto**: no hay uno; lo que hay es la comprobación de
      que **la migración de T1376 mueve filas de verdad** cuando el script la corre.
      **Qué se revierte para verlo en rojo**: en T1376, sacar los gastos sin sucursal
      de `sembrar()` — la comparación de datos del script deja de distinguir el `down`
      correcto del que no restaura nada.

- [x] **T1375** Crear `planificarAsignaciones(gastos, puntosDeVenta)` —exportada
      desde `apps/api/src/migrations/20260813-gastos-fijos-a-su-sucursal.js`— que
      **importa `elegirPorDefecto` de `utils/sucursalDeStock.js:59-69`** en vez de
      reescribir la regla en SQL: son tres escalones (`code = 'principal'`, el activo
      de menor id, el de menor id) y ya la usan tres consumidores. `puntos_de_venta`
      **no tiene `is_default` ni nada parecido** y no se crea. Su test en
      `apps/api/src/tests/gastosFijosASuSucursal.test.js`, **sin Postgres**, con los
      cinco casos que el data-model enumera: empresa sin sucursales, empresa con una
      sola, empresa con tres donde `principal` **no** es la de menor id, gasto que ya
      tiene sucursal (no se toca), y una empresa cuyos gastos suman con centavos.
      **Verificación**: `npm run test:api -- gastosFijosASuSucursal`.
      **Los tests que evitan el defecto**: *«con tres sucursales gana la de
      code='principal' aunque no sea la de menor id»* y *«una empresa sin ninguna
      sucursal no produce ninguna asignación, y eso no es un error»*.
      **Qué se revierte para verlo en rojo**: cambiar `elegirPorDefecto` por
      `puntos[0]`. El primero falla.

- [x] **T1376** Crear `apps/api/src/migrations/20260813-gastos-fijos-a-su-sucursal.js`
      con el molde de `20260809-unico-de-insumo-por-receta.js` **entero**: la tabla
      de archivo `fixed_expenses_sin_sucursal` creada **siempre**, también con cero
      filas movidas · la fila entera antes del cambio en `JSONB` con **las fechas
      como texto (`::text`)** —el driver corta los microsegundos al pasar por `Date`
      y el `down` reinsertaría una fecha distinta— · el **informe por consola**, fila
      por fila con nombre e importe, que es lo único que le permite a alguien
      reasignarlos a mano · la **verificación adentro de la transacción**: la suma de
      `amount` por empresa en una `TEMP TABLE … ON COMMIT DROP` antes de tocar nada,
      comparada antes del commit; si difiere, **no hay commit** · el `down` que
      restaura los `NULL` desde el archivo y hace `DROP TABLE`, con el encabezado
      diciendo que **pisa lo que haya pasado después**.
      ⚠ **Y una advertencia que va escrita en el encabezado de la migración**: para
      una empresa con dos sucursales ya migrada del legacy, esta migración **junta
      los gastos de las dos bajo una sola**. `gf1`/`gf2` solo significan sucursales
      concretas para Comprafit (`legacy:3011`, `:3017`) y una migración que adivina
      no puede distinguir esa empresa de otra. Por eso el informe los lista uno por
      uno.
      **Verificación**: `node apps/api/scripts/verificar-reversibilidad.js --desde 20260813`
      —aplica, revierte, compara el esquema **y los datos**, y vuelve a aplicar—, y
      `npm --prefix apps/api run test:integracion -- gastos`.
      **El test que evita el defecto**: *«el total de gastos fijos por empresa es
      idéntico antes y después»*, ejecutado contra Postgres, y
      `reversibilidadDeMigraciones.test.js` que la levanta con las demás.
      **Qué se revierte para verlo en rojo**: hacer que el `up` escriba
      `punto_de_venta_id` sin archivar la fila. El `down` no restaura y el script
      reporta la diferencia de datos.

**Checkpoint**: `npm --prefix apps/api run db:migrate` imprime el informe con las
filas movidas una por una, y el `down` las devuelve a `NULL`.

---

## Phase 6: Panel · la pantalla (corte 6)

**Purpose**: el Panel dibujado como la maqueta, sobre los números que la fase 2
dejó bien. **Depende de la fase 2**: la pantalla nueva sobre los números viejos
mostraría prolijamente cinco cosas mal.

- [x] **T1377** En `apps/api/src/services/dashboardService.js`, los campos nuevos de
      `GET /api/dashboard/kpis`: **(a)** `series` con **cuatro** claves —`ventas`,
      `cashflow`, `receivables`, `payables`—, doce períodos reales cada una, y **si
      no hay doce, la clave del indicador no viene** (FR-068, PENDIENTE N3). **No hay
      serie de `fixed_expenses`**: es un estado, no una serie, no tiene fecha y no
      hay historia que reconstruir (decisión 18) — la maqueta dibuja cuatro
      sparklines y los datos no dan para cuatro. **(b)** `requiere_atencion` con
      faltantes, ventas sin CAE, vencimientos de stock y el certificado de AFIP por
      vencer; **un aviso con cero casos no viene** (FR-064, FR-065); cada uno con su
      `alcance`, y **el de faltantes es de la sucursal activa** porque
      `GET /api/faltantes` lo es (ajuste 5(b)) — si no, el aviso diría 12 y la
      pantalla a la que lleva mostraría 7. **(c)** `ultimas_ventas` (id, hora,
      vendedor, total). **(d)** `supuesto_crecimiento`, que `cashflowService:123` ya
      devuelve y nadie lee (FR-060). Cada serie sale de **una** consulta con
      `GROUP BY date_trunc('month', …)`, no de doce.
      **Verificación**: `npm --prefix apps/api run test:integracion -- panel`, con
      `capturarConsultas` afirmando que las cuatro series cuestan **cuatro**
      consultas y no cuarenta y ocho.
      **Los tests que evitan el defecto**: *«con once meses de historia la clave de
      la serie no viene, y la tarjeta no dibuja una línea inventada»* y *«las cuatro
      series cuestan cuatro consultas»*.
      **Qué se revierte para verlo en rojo**: rellenar con ceros los meses que
      faltan. El primero falla porque la clave viene.

- [x] **T1378** [P] Crear `apps/web/src/utils/panel.js` con las reglas puras
      (FR-015, FR-066): `severidadDeAviso(aviso)`, `ordenarAvisos(avisos)`,
      `etiquetaDeAviso(aviso)` —que dice el alcance: «en esta sucursal» / «en toda la
      empresa» (FR-059)— y `alturasDelSparkline(serie)`, que tiene que contestar algo
      razonable **con la serie vacía y con un solo punto**. Su test en
      `apps/web/src/tests/panel.test.js`.
      **Verificación**: `npm run test:web -- panel`.
      **Los tests que evitan el defecto**: *«una serie de un solo punto no divide por
      cero»* y *«el aviso de faltantes dice que es de la sucursal activa, no de la
      empresa»*.
      **Qué se revierte para verlo en rojo**: sacar la guarda del máximo cero en
      `alturasDelSparkline`; sale `NaN`.

- [x] **T1379** Crear `apps/web/src/components/TarjetaDeIndicador.jsx`: la tarjeta
      con su valor, su nota al pie con **la definición del número** —que es la parte
      durable de la decisión 7: un número que el dueño puede explicar no se lee como
      un bug la próxima vez— y el sparkline de **doce barras sin ninguna librería de
      gráficos** (FR-067, FR-069), dibujado con `div`s y alturas en porcentaje. Si el
      indicador no trae serie, **no dibuja sparkline** y la tarjeta no deja un hueco.
      Entra en `NOMBRES`, ancla a **23**. Sus casos en
      `apps/web/src/tests/renderDelPanel.test.jsx`.
      **Verificación**: la disciplina de T1371 (hallazgos > 0 antes… acá el archivo
      es nuevo, así que la comprobación es al revés: agregalo a `NOMBRES` **vacío**,
      confirmá el hallazgo «el archivo NO existe», escribilo, y confirmá que baja a
      cero) y `npm run test:web -- guardiasDeDiseno renderDelPanel`.
      **El test que evita el defecto**: *«sin serie, la tarjeta no dibuja doce barras
      en cero»*.
      **Qué se revierte para verlo en rojo**: dibujar el sparkline con
      `serie ?? Array(12).fill(0)`.

- [x] **T1380** Crear `apps/web/src/components/RequiereTuAtencion.jsx`, que ordena y
      pinta los avisos con `utils/panel.js` y lleva a la pantalla que detalla cada
      uno. Entra en `NOMBRES`, ancla a **24**. Casos en `renderDelPanel.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno renderDelPanel`.
      **El test que evita el defecto**: *«sin avisos, el bloque no se dibuja vacío:
      dice que no hay nada que atender»* (FR-019, FR-065).
      **Qué se revierte para verlo en rojo**: dibujar el encabezado del bloque con la
      lista vacía.

- [x] **T1381** Reescribir `apps/web/src/pages/Dashboard.jsx`: **cuatro** tarjetas de
      indicador —**Ventas, Saldo de caja, Por cobrar y Por pagar**, que son las que
      tienen serie reconstruible— y los **gastos fijos en su propia franja, sin
      sparkline, al lado del simulador que los usa** (decisión 18) · la grilla se
      acomoda a las tarjetas que **vinieron**: con `produccion` puede quedar **una
      sola**, y no dibuja huecos (decisión 8, FR-050) · **el frontend no puede leer
      `kpis.cashflow.balance`**: un bloque ausente se dibuja como «no tenés permiso
      para ver esto», nunca como `$0` (FR-056) · el simulador toma
      `kpis.fixed_expenses` y `settings.target_sales`, **`fixed_expenses_total` deja
      de leerse** (decisión 13, FR-052, FR-054) y sin ninguno de los dos **no simula**:
      dice qué falta y adónde cargarlo (FR-051), sin `NaN` con un campo vacío
      (FR-053) · «Proy. 30d» dice que supone el crecimiento que trae
      `supuesto_crecimiento` (FR-060) · el bloque se rotula **«Últimas ventas»** y no
      «Actividad reciente», porque no hay tabla de auditoría y de los cuatro tipos de
      evento de la maqueta solo las ventas tienen autor guardado (decisión 19) · un
      fallo de un pedido **no impide que se dibujen los demás** y muestra un aviso
      (FR-055, FR-009 — hoy `Dashboard.jsx:64` es un `console.error`) · `PageHeader`,
      `mensajeDeError`, `utils/formato.js`. Entra en `NOMBRES`, ancla a **25**, y sale
      de `PENDIENTES` de `formato.test.js`. **Y una guardia por nombre** en
      `guardiasDeDiseno.test.js`: **ningún componente lee `fixed_expenses_total`**
      (decisión 13 — la fila de `settings` se queda porque borrarla no es reversible;
      lo que se ancla es que el código deje de mirarla).
      **Verificación**: la disciplina de T1371, y
      `npm run test:web -- guardiasDeDiseno formato renderDelPanel`.
      **Los tests que evitan el defecto**: *«con el payload del rol `produccion` el
      Panel dibuja UNA tarjeta y ninguna en $0»*, *«el simulador no arranca con
      7.000.000 ni con 2.400.000»*, *«un campo vacío no muestra NaN»* y *«si falla un
      pedido, el resto del Panel se dibuja y aparece un aviso»* (riesgo 8 del plan).
      **Qué se revierte para verlo en rojo**: poner
      `const balance = kpis.cashflow?.balance || 0`. El primer test falla porque
      aparece una tarjeta en `$0,00`.

- [x] **T1382** Borrar `GET /api/alerts` (`apps/api/src/routes/general.js:488` en
      adelante) **en el mismo commit** en que `Dashboard.jsx` deja de llamarlo, y
      borrar `getAlerts` de `apps/web/src/services/api.js` (FR-058, decisión 17).
      Tiene **un solo consumidor** en todo el repositorio (`Dashboard.jsx:58`),
      permiso distinto del de `/kpis` (`stock.ver` contra `dashboard.ver`), regla
      vieja de stock bajo e `include` de `Product` sin filtrar. Con él desaparece el
      modo de falla **P9**: hoy un rol con `dashboard.ver` y sin `stock.ver` rechaza
      el `Promise.all` y deja el Panel entero en `-` y `0`, sin un cartel. Actualizar
      `permisosDeRutas.test.js` si nombraba la ruta.
      **Verificación**: `npm run test:api -- permisosDeRutas aislamientoEmpresas` y
      `npm run test:web`. ⚠ El ancla `expect(deHijos.length).toBe(4)` de
      `aislamientoEmpresas.test.js:881` **no se toca**: los dos `include` que se van
      son `belongsTo` y el detector no los clasifica (punto 6 de «Antes de empezar»).
      Si alguien lo baja, sacó includes de hijo que este hito no nombra.
      **El test que evita el defecto**: en `renderDelPanel.test.jsx`, *«un rol sin
      stock.ver ve el Panel completo y no seis tarjetas en `-`»*.
      **Qué se revierte para verlo en rojo**: volver a poner el `Promise.all` con
      `getAlerts()`.

- [x] **T1383** [P] En `apps/web/pruebas-de-navegador/maquetadoDelPanel.navegador.js`,
      **dos** medidas: que el sparkline de doce barras **no desborde su tarjeta**
      (`scrollWidth` contra `clientWidth` del contenedor) y que las cuatro tarjetas
      **arranquen en el mismo píxel** (`left` de las cuatro cajas). Las dos son
      geometría y en jsdom las tres medidas dan cero siempre.
      **Verificación**: `npm --prefix apps/web run test:navegador -- maquetadoDelPanel`.
      **Los tests que evitan el defecto**: *«el sparkline no desborda su tarjeta»* y
      *«las cuatro tarjetas arrancan en el mismo píxel»*.
      **Qué se revierte para verlo en rojo**: sacarle el `min-w-0` a la tarjeta y
      poner trece barras. ⚠ Comprobalo de verdad: una prueba de geometría puede pasar
      por razones que no tienen nada que ver con lo que dice verificar.

**Checkpoint**: `/panel` dibuja las cuatro tarjetas con sus sparklines reales,
«Requiere tu atención» dice lo mismo que la pantalla a la que lleva, y con el rol
`produccion` no aparece ningún `$0` inventado.

---

## Phase 7: Equipo · reglas y pantalla (corte 7)

**Purpose**: se puede invitar a alguien, ver si el mail salió, reenviar,
cambiar un rol sin dejar la empresa sin admin, y **sacar a alguien del equipo**.
**Depende de la fase 1**: sin el montaje arreglado, invitar sigue sin servir.

⚠ **La premisa de la decisión 1 del usuario es media falsa y conviene tenerlo
presente acá**: «si alguien deja la empresa, desactivarlo no lo saca hasta que
vence su token» **no es lo que hace el código**. `loadEmpresaContext`
(`middleware/auth.js:196-200`) relee `UsuarioEmpresa.findOne({ is_active: true })`
en **cada** request: con `is_active = false`, `req.empresaId` queda sin definir y
`requireEmpresa` responde 403 **en el request siguiente**. Sacar a alguien ya es
instantáneo hoy; lo que falta es el botón, y son estas dos tareas.

- [x] **T1384** En `apps/api/src/seedPermissions.js`, un `Permiso` más:
      `{ codigo: 'equipo.editar', nombre: 'Cambiar roles del equipo', modulo: 'equipo' }`.
      **No hace falta agregarlo al rol `admin`**: `ROLE_PERMISOS.admin` es
      `PERMISOS.map(p => p.codigo)` (`seedPermissions.js:75`) y lo toma solo. **Y
      ningún otro rol lo recibe**: es exactamente quién puede hoy, porque hoy pide
      `config.editar` y `gerente` no lo tiene — el cambio es de **nombre**, no de
      alcance (PENDIENTE N9). `PUT /api/empresas/usuarios/:id` pasa de
      `config.editar` a `equipo.editar` (FR-116), y `permisosDeRutas.test.js` cambia
      el permiso esperado **en el mismo commit** (data-model, «Permiso nuevo»).
      **Verificación**: `npm run test:api -- permisosDeRutas seedPermissions`.
      **El test que evita el defecto**: *«equipo.editar existe en el catálogo y lo
      tiene admin y nadie más»* — el test que ya existe
      (`ningún checkPermission pide un permiso que no existe en el catálogo`) se pone
      en rojo si se cambia la ruta y no el seed, que es el modo de falla: un código
      que no está en el catálogo no lo tiene **nadie** y el endpoint responde 403
      para siempre, para todos.
      **Qué se revierte para verlo en rojo**: cambiar el `checkPermission` de la ruta
      sin agregar el permiso al seed.

- [x] **T1385** [P] Crear `apps/api/src/utils/equipo.js` con
      `puedeCambiarRol({ miembro, yo, miembros })` → `{ puede, motivo }` —que **nunca
      devuelve `undefined`**—, `esUltimoAdmin(miembro, miembros)` y `ETIQUETAS_DE_ROL`
      con los cinco roles del catálogo, **`gerente` incluido** (E9, FR-117: hoy
      `Team.jsx:37-42` no lo tiene). Se **espeja** en `apps/web/src/utils/equipo.js`,
      como ya se hace con `stockBajo.js`, con el comentario que dice que son dos
      copias y por qué (el monorepo no tiene paquete común). Tests de los dos lados:
      `apps/api/src/tests/sesionesYEquipo.test.js` y
      `apps/web/src/utils/equipo.test.js`. **Y una guardia de espejo**: los dos
      archivos tienen que declarar las mismas claves de `ETIQUETAS_DE_ROL` y los
      mismos motivos.
      **Verificación**: `npm run test:api -- sesionesYEquipo` y
      `npm run test:web -- equipo`.
      **Los tests que evitan el defecto**: *«el último admin activo no se puede
      degradar, y el motivo lo dice»*, *«uno no se puede cambiar el rol a sí mismo»*
      y *«los dos espejos declaran los mismos cinco roles, gerente incluido»*.
      **Qué se revierte para verlo en rojo**: sacar `gerente` de una de las dos
      copias; la guardia de espejo falla nombrando la clave que falta.

- [x] **T1386** En `apps/api/src/routes/empresas.js`, `PUT /usuarios/:id`: importa
      `utils/equipo.js` y aplica las dos reglas **en el servidor** (FR-109, FR-110,
      FR-111) — último admin activo → `400 { error: 'ULTIMO_ADMIN' }` con el motivo;
      uno mismo → `400 { error: 'NO_TE_PODES_TOCAR' }`; `role` fuera del catálogo →
      400 con la lista de roles válidos (FR-119, la columna es `STRING(20)` libre y
      un rol mal escrito crea un miembro con cero permisos sin aviso). Y al
      desactivar (`is_active: false`), **las invitaciones `pending` de ese email
      pasan a `revoked`** (PENDIENTE N15), en la misma transacción. Casos en
      `invitaciones.integracion.test.js`.
      **Verificación**: `npm --prefix apps/api run test:integracion -- invitaciones`.
      **Los tests que evitan el defecto**: *«degradar al último admin responde 400 y
      la empresa sigue teniendo un admin»* y *«desactivar a alguien revoca sus
      invitaciones pendientes, así que un mail viejo no lo devuelve»* —este último
      cierra el círculo con T1350—.
      **Qué se revierte para verlo en rojo**: sacar la llamada a `puedeCambiarRol`.
      ⚠ Con `BYPASS_AUTH` la sesión es siempre `admin` de la empresa 1: el caso «uno
      mismo» hay que armarlo pidiendo el cambio sobre **su propia** `UsuarioEmpresa`.

- [x] **T1387** En el mismo archivo, `GET /:empresaId/usuarios`: el `include` de
      `Usuario` gana `attributes: ['id', 'nombre', 'email']` — hoy devuelve la fila
      entera, con `auth0_sub` y `es_superadmin` (E7, FR-115). El molde correcto está
      cincuenta líneas más abajo, en `:633`, que ya lo hace bien para el invitador.
      **Verificación**: `npm --prefix apps/api run test:integracion -- invitaciones`.
      **El test que evita el defecto**: *«el listado del equipo no trae `auth0_sub`
      ni `es_superadmin` en el cuerpo de la respuesta»*, afirmado sobre el **texto**
      del cuerpo y no sobre el objeto parseado — es lo que sale por el cable.
      **Qué se revierte para verlo en rojo**: sacar los `attributes`.
      📌 `ultimo_acceso` y `sesiones_abiertas` **no entran acá**: la tabla `sesiones`
      todavía no existe. Llegan en T1398.

- [x] **T1388** En el mismo archivo,
      `POST /invitaciones/:token/re-enviar`: se le agrega `requireEmpresa` y el
      `where` con `empresa_id` —hoy busca el token **sin acotar a la empresa** y hace
      `include` de `Empresa` sin filtrar (E6, FR-114)—. Casos en
      `invitaciones.integracion.test.js`.
      **Verificación**: `npm --prefix apps/api run test:integracion -- invitaciones`.
      **El test que evita el defecto**: *«la empresa A no puede reenviar una
      invitación de la empresa B: responde 404, no 200»*.
      **Qué se revierte para verlo en rojo**: sacar `empresa_id` del `where`.

- [x] **T1389** Borrar `POST /:empresaId/usuarios` de
      `apps/api/src/routes/empresas.js` (E11, PENDIENTE N13): incorpora por
      `auth0_sub` **sin invitación ni consentimiento**, no valida el rol contra el
      catálogo y **no lo usa nadie** —ni la UI ni `services/api.js`—. Si hace falta
      incorporar a alguien sin mail, el camino es el enlace de invitación copiado a
      mano (FR-106, T1390). Actualizar `permisosDeRutas.test.js`.
      **Verificación**: `npm run test:api -- permisosDeRutas` y
      `grep -rn "empresas/.*\/usuarios" apps/web/src` sin resultados de `POST`.
      **El test que evita el defecto**: el ancla «CADA archivo aporta al menos una
      ruta» y la igualdad exacta de la tabla ruta→permiso de `empresas.js` se ponen
      en rojo si la ruta vuelve sin su fila.
      **Qué se revierte para verlo en rojo**: pegar el handler de vuelta.

- [x] **T1390** En el mismo archivo, `POST /:empresaId/invitar` agrega el `enlace` de
      invitación armado a la respuesta —que ya devuelve `email_enviado` y `message`—
      para que la pantalla lo pueda mostrar y copiar cuando el mail no salió (FR-106).
      **Verificación**: `npm --prefix apps/api run test:integracion -- invitaciones`.
      **El test que evita el defecto**: *«cuando el mail no sale, la respuesta trae el
      enlace con el token para pasarlo a mano»*, con `RESEND_API_KEY` sin definir —que
      es el caso que `observabilidad.test.js:125` ya cubre del otro lado—.
      **Qué se revierte para verlo en rojo**: sacar `enlace` de la respuesta.

- [x] **T1391** Crear `apps/web/src/components/PanelDeMiembro.jsx`: panel lateral de
      520px con `max-w-[92vw]` con el detalle de un miembro, el `Select` de rol
      **deshabilitado con su explicación** cuando `puedeCambiarRol` dice que no
      (FR-111, FR-017) y los dos botones de **desactivar / reactivar** (FR-113, E12).
      Entra en `NOMBRES`, ancla a **26**. Casos en
      `apps/web/src/tests/renderDeEquipo.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno renderDeEquipo`.
      **El test que evita el defecto**: *«la fila propia tiene el selector
      deshabilitado y dice por qué»* — hoy el `Select` se dibuja en todas las filas,
      incluida la propia, sin `disabled` y sin confirmación.
      **Qué se revierte para verlo en rojo**: sacar el `disabled` que sale de
      `puedeCambiarRol`.

- [x] **T1392** Reescribir `apps/web/src/pages/Team.jsx`: `PageHeader` · `TablaGrid`
      con el mismo `grid-template-columns` en encabezado y filas (FR-007) · la
      columna **Estado lee `is_active`** y distingue una invitación pendiente de una
      vencida (E10, FR-118) — hoy `Team.jsx:171-175` la pinta clavada en «Activo» ·
      **no dice «Invitación enviada» cuando el mail no salió**: lee `email_enviado` y
      `message` de la respuesta, que ya vienen y hoy se tiran (`Team.jsx:85`,
      `toast.success` incondicional) (E3, FR-105), y **muestra el enlace con un botón
      de copiar** cuando no salió (FR-106) · botón de **reenviar** una invitación
      pendiente (FR-107) · la pantalla explica que la persona invitada tiene que
      registrarse **con ese mismo email**, porque AdminApp no crea nada en Auth0
      (E14, FR-125) · `mensajeDeError` en todos los `catch` (FR-008) y el fallo de
      carga en pantalla, no en `console.error` (FR-009, hoy `Team.jsx:65`) ·
      `ETIQUETAS_DE_ROL` de `utils/equipo.js`, con `gerente` (FR-117) · el superadmin
      sigue sin aparecer y **sin ningún filtro especial**: sale gratis porque no
      tiene fila en `usuario_empresas` (FR-126). En `apps/web/src/services/api.js`,
      `reenviarInvitacion` y `desactivarMiembro`, que hoy no existen. Entra en
      `NOMBRES`, ancla a **27**, y sale de `PENDIENTES` de `formato.test.js`.
      **Verificación**: la disciplina de T1371, y
      `npm run test:web -- guardiasDeDiseno formato renderDeEquipo contratosDeApi`.
      **Los tests que evitan el defecto**: *«invitar sin que el mail salga muestra el
      enlace y dice que hay que pasarlo a mano»*, *«la columna Estado dice
      “Desactivado” cuando is_active es false»* y *«el catálogo de roles incluye
      gerente»*.
      **Qué se revierte para verlo en rojo**: volver a
      `toast.success('Invitación enviada')` incondicional; el primero falla.

**Checkpoint**: se invita a alguien, la pantalla dice si el mail salió o muestra
el enlace, se reenvía, se cambia un rol, y se saca a alguien del equipo — y el
último admin no se puede degradar por ningún camino.

---

## Phase 8: Sesiones (corte 8)

**Purpose**: ver desde qué dispositivos entró cada miembro y **cerrar uno**.
**Va anteúltima y sola** porque `registrarSesion` corre en **todos** los
requests: es el único cambio del hito que puede dejar la aplicación entera sin
funcionar, y tiene que poder revertirse quitando **una línea** de `server.js` sin
tocar nada más. La tabla se puede quedar.

⚠ **El techo, y va escrito en la pantalla con estas palabras**: sin la Management
API de Auth0 **no se puede revocar un token**. Lo que se construye cierra la
sesión del cliente que **coopera** —el navegador recibe 401, borra su
identificador y sale—; un token usado desde otra herramienta se puede seguir
usando hasta que vence. El corte de verdad es `is_active = false`, que **ya
funciona hoy**. La pantalla dice **«cerrar sesión en ese dispositivo»**, no
«revocar el acceso» (decisión 2 del plan, riesgo 10).

- [x] **T1393** Crear `apps/api/src/migrations/20260812-sesiones-de-usuario.js` con
      la tabla `sesiones` del data-model —`usuario_id` FK `ON DELETE CASCADE`,
      `dispositivo VARCHAR(64)`, `user_agent TEXT`, `ip VARCHAR(45)`, `iniciada_en`,
      `vista_en`, `cerrada_en`, `cerrada_por` FK `ON DELETE SET NULL`— con el
      **`UNIQUE (usuario_id, dispositivo)`**, que es el índice del camino caliente y
      lo que hace idempotente el alta. **No se crean** los índices de `(usuario_id)`
      —lo cubre el único por prefijo— ni de `(vista_en)` —ninguna consulta lo usa y
      sería peso de escritura en la tabla que más se escribe—. Crear
      `apps/api/src/models/Sesion.js` y **registrarlo en
      `apps/api/src/models/index.js`** con sus asociaciones.
      **Verificación**: `node apps/api/scripts/verificar-reversibilidad.js --desde 20260812`
      y `npm run test:api -- asociaciones modeloSale` (el archivo de asociaciones es
      el que se pone en rojo si el modelo no quedó registrado).
      **El test que evita el defecto**: *«`sesiones` tiene el UNIQUE (usuario_id,
      dispositivo)»*, en `reversibilidadDeMigraciones.test.js` / el chequeo de
      esquema — sin el índice, la carrera de T1395 no tiene quién la arbitre.
      **Qué se revierte para verlo en rojo**: sacar el `unique` del índice.

- [x] **T1394** [P] Crear `apps/api/src/utils/dispositivo.js` con
      `dispositivoDeUserAgent(ua)` → `'computadora' | 'celular' | 'desconocido'`.
      Es **pura a propósito**: la etiqueta se puede corregir sin migrar nada, porque
      lo que se guarda es el user-agent crudo. Su test en
      `apps/api/src/tests/dispositivo.test.js`.
      **Verificación**: `npm run test:api -- dispositivo`.
      **El test que evita el defecto**: *«un user-agent vacío o nulo devuelve
      “desconocido” y no rompe»*.
      **Qué se revierte para verlo en rojo**: sacar la guarda del nulo.

- [x] **T1395** Crear `apps/api/src/services/sesionesService.js` con `registrar`,
      `sesionesDeLaEmpresa(empresaId)`, `cerrar(id, porUsuarioId)` y
      `cerrarLasDemas(usuarioId, dispositivoActual)`. **`sesiones` no tiene
      `empresa_id` a propósito** (decisión 3): el aislamiento sale de la membresía,
      `usuario_id IN (SELECT usuario_id FROM usuario_empresas WHERE empresa_id = :id
      AND is_active = true)`, encapsulado en `sesionesDeLaEmpresa` — una sesión ajena
      da 0 filas y **404**, igual que `findScoped`. `registrar` usa `findOrCreate` y
      **atrapa `SequelizeUniqueConstraintError` para releer**, igual que la
      idempotencia de `POST /api/sales`. Crear
      `apps/api/src/tests/integracion/sesiones.integracion.test.js`.
      **Verificación**: `npm --prefix apps/api run test:integracion -- sesiones`.
      **El test que evita el defecto**: *«dos requests simultáneos del mismo
      navegador crean UNA sola sesión»*, con dos promesas en paralelo — el Panel hace
      varios requests al montar y los dos entran por «no existe». **Un test
      secuencial no toca esa mitad nunca**, y los dobles de `modelosFalsos.js` no
      entienden restricciones únicas: lo dice su propio encabezado.
      **Qué se revierte para verlo en rojo**: sacar el `catch` del
      `UniqueConstraintError`. El test falla con el error del driver.

- [x] **T1396** Crear `apps/api/src/middleware/registrarSesion.js` y montarlo en
      `apps/api/src/server.js`, **después de `loadEmpresaContext`** en las dos
      cadenas (`authEmpresa` y `authSinEmpresa`). Las cinco reglas de la decisión 2,
      en este orden: sin `Authorization` → **sigue sin tocar nada** (el cron, el
      webhook de TiendaNube y `BYPASS_AUTH` no la mandan) · con token y sin
      `X-Sesion-Id` → `401 { error: 'SESION_REQUERIDA' }` · fila con `cerrada_en` →
      `401 { error: 'SESION_CERRADA', message: 'Cerraron la sesión de este
      dispositivo.' }` · no existe → `INSERT` con user-agent e IP · existe y abierta
      → `UPDATE vista_en` **solo si pasaron más de cinco minutos** (FR-124).
      **Verificación**: `npm --prefix apps/api run test:integracion -- sesiones`, con
      `capturarConsultas(sequelize, …)` sobre un `GET` representativo.
      **El test que evita el defecto**: *«un GET representativo pasa de N a N+1
      consultas, no a N+4»*, con el número escrito y leído en las dos direcciones —es
      la única forma de que el 20 % no se vuelva un 60 % sin que nadie se entere— y
      *«el mismo request dos veces seguidas hace UN solo UPDATE de vista_en»*.
      **Qué se revierte para verlo en rojo**: sacar la ventana de cinco minutos; el
      segundo test falla con dos `UPDATE`.
      ⚠⚠ **Cómo se hace que el middleware se active en la suite, que el plan da por
      hecho y no es gratis.** `apps/api/src/tests/setup.js:13` fuerza
      `BYPASS_AUTH = 'true'` para **las dos** suites, así que **ningún request de
      ningún test lleva `Authorization`** — y la primera regla de este middleware es
      «sin `Authorization`, seguí sin tocar nada». Escrito ingenuamente, el test de
      conteo mediría **cero** consultas nuevas y pasaría en verde con el middleware
      desconectado. Lo que hay que hacer, y va escrito en el archivo de test:
      **mandar la cabecera a mano** —`.set('Authorization', 'Bearer lo-que-sea')`—
      en los casos que ejercitan sesiones. La cadena de bypass **no mira la
      cabecera** (`server.js:318-322` clava el usuario), así que el request sigue
      resolviendo la empresa 1 y `registrarSesion` **sí** se activa. Los demás
      1400 tests siguen sin mandarla y no se enteran de nada, que es exactamente lo
      que la primera regla compra.
      ⚠ **Esta es la línea que se saca para revertir el corte entero** (riesgo 1 del
      plan). Que esté sola en `server.js` y no repartida es parte del requisito.

- [x] **T1397** En `apps/api/src/routes/empresas.js`, los tres endpoints:
      `GET /:empresaId/sesiones` (`equipo.ver` + `requireEmpresaPropia`, solo las
      abiertas, con `es_este_dispositivo` comparando contra el `X-Sesion-Id` del
      propio request y `dispositivo` derivado con `utils/dispositivo.js`) ·
      `DELETE /sesiones/:id` (`equipo.editar`, marca `cerrada_en` y `cerrada_por`;
      una sesión de alguien que no es miembro → **404**, no 403) ·
      `DELETE /sesiones` (`equipo.ver`, «cerrar todas menos ésta», **de las
      propias**, y **nunca** la del `X-Sesion-Id` del request: si la cerrara, la
      respuesta llegaría a un navegador ya deslogueado). `permisosDeRutas.test.js`
      con las tres filas nuevas.
      **Verificación**: `npm --prefix apps/api run test:integracion -- sesiones` y
      `npm run test:api -- permisosDeRutas`.
      **Los tests que evitan el defecto**: *«la empresa B no puede cerrar una sesión
      de la A: responde 404»*, *«una sesión cerrada responde 401 en el request
      siguiente»* y *«“cerrar todas menos ésta” no cierra la del request»*.
      **Qué se revierte para verlo en rojo**: reemplazar `sesionesDeLaEmpresa` por un
      `Sesion.findByPk(req.params.id)`. El primero falla con un 200.
      ⚠ El segundo test **necesita la cabecera `Authorization` a mano**, por lo que
      dice T1396: sin ella `registrarSesion` no corre y la sesión cerrada no corta
      nada. Con `BYPASS_AUTH` la sesión es siempre la empresa 1, así que «la B no
      puede cerrar una de la A» se arma al revés: se siembra la sesión de un usuario
      que **solo** es miembro de la empresa B y se pide cerrarla desde la sesión de A.

- [x] **T1398** En el mismo archivo, `GET /:empresaId/usuarios` gana, por miembro,
      `ultimo_acceso` (el máximo de `sesiones.vista_en`) y `sesiones_abiertas`
      (FR-121). Un miembro que **nunca entró** manda `ultimo_acceso: null`
      (FR-122). En una sola consulta agregada, no una por miembro.
      **Verificación**: `npm --prefix apps/api run test:integracion -- sesiones`, con
      `capturarConsultas` afirmando que el costo no crece con la cantidad de
      miembros.
      **El test que evita el defecto**: *«un miembro que nunca entró manda null, no
      una fecha vacía»* y *«veinte miembros no cuestan veinte consultas»*.
      **Qué se revierte para verlo en rojo**: devolver `ultimo_acceso: ''`.

- [x] **T1399** En `apps/web/src/services/api.js`, el interceptor de request
      (`:127-135`) manda **`X-Sesion-Id`** junto a `X-Empresa-Id` y
      `X-Punto-De-Venta-Id`: un UUID v4 que `apps/web/src/sesion/ProveedorDeSesion.jsx`
      genera **una vez** y guarda en `localStorage`. Y el interceptor de respuesta
      (`:44-50`), que ya redirige al login con cualquier 401, aprende un caso: con
      `SESION_CERRADA`, **borra el `X-Sesion-Id` de `localStorage` antes de salir**,
      para que el próximo ingreso sea una sesión nueva y no vuelva a chocar contra la
      cerrada.
      **Verificación**: `npm run test:web -- contratosDeApi`.
      **Los tests que evitan el defecto**: *«todos los requests llevan X-Sesion-Id, y
      es el mismo entre dos llamadas»* y *«un 401 SESION_CERRADA borra el
      identificador de localStorage; un 401 cualquiera NO»* — si lo borrara siempre,
      un token vencido abriría una sesión nueva por cada expiración y la lista
      mostraría siete filas del mismo navegador.
      **Qué se revierte para verlo en rojo**: borrar el identificador con cualquier
      401.

- [x] **T1400** Crear `apps/web/src/components/SesionesDelEquipo.jsx` y colgarlo de
      `pages/Team.jsx`: la lista de sesiones abiertas con dispositivo, IP, cuándo
      empezó, cuándo fue el último acceso y el badge **«Este dispositivo»**. El botón
      dice **«Cerrar sesión en ese dispositivo»** y la confirmación dice, con esas
      palabras, que **se va a cerrar esa sesión en todas las empresas a las que esa
      persona tenga acceso** (decisión 3) y que **no revoca el token**: cierra el
      navegador que coopera, y el corte de verdad es desactivar al miembro. Entra en
      `NOMBRES`, ancla a **28**. Casos en `renderDeEquipo.test.jsx`.
      **Verificación**: `npm run test:web -- guardiasDeDiseno renderDeEquipo`.
      **Los tests que evitan el defecto**: *«la confirmación dice “cerrar sesión en
      ese dispositivo” y NO dice “revocar el acceso”»* y *«el badge Este dispositivo
      cae en la fila del propio X-Sesion-Id»*.
      **Qué se revierte para verlo en rojo**: cambiar el texto del botón a «Revocar
      acceso»; el primero falla, y ese es todo el punto (riesgo 10 del plan).

**Checkpoint**: la pantalla de Equipo lista las sesiones abiertas, se cierra una,
y ese navegador recibe 401 en su request siguiente y vuelve al login. Quitando
**una línea** de `server.js` todo vuelve a como estaba.

---

## Phase 9: AFIP · verificación y pantalla (corte 9)

**Purpose**: la puesta en marcha dice qué falta, el circuito se puede verificar
sin emitir nada, y **el pase a producción no se puede hacer sin haberlo
verificado**. **Va al final porque su parte cara no es código**: es el trámite del
certificado de homologación. Si eso se traba, este corte se posterga **sin tocar
ninguno de los otros nueve**.

⚠ **El certificado de homologación y el de producción son DOS certificados
distintos**, emitidos por dos servicios distintos de ARCA, y `docs/GUIA_AFIP.md`
documenta **solo el de producción**. Sin T1408 este bloqueo es un callejón sin
salida para cualquiera que siga la guía: **T1408 no es documentación opcional, es
parte del corte** (ajuste 3 del plan, riesgo 2).

⚠⚠ **Cómo se prueba una fase entera que depende de un servicio de terceros, que
el plan no dice.** A partir de T1402, **todo `POST /afip/setup` llama a AFIP**
(la validación del punto de venta), y `POST /afip/verificar` es una llamada a AFIP
por definición. Ningún test puede pegarle a ARCA. La regla para las cinco tareas
de servidor de esta fase, y va escrita arriba de cada archivo de test:

> **`services/afipAuth` y `services/afipService` se doblan con `jest.mock`** —el
> precedente es `afipNumeracion.test.js:13`—, y lo que el test afirma es **lo que
> pasa de este lado**: qué se guarda, qué NO se guarda, qué status sale, qué dice
> el mensaje. El doble devuelve un ticket y un `FECompUltimoAutorizado` de
> mentira, y **también** los errores que ARCA devuelve de verdad, copiados del
> texto real.
>
> Lo que va a **integración** es solo lo que necesita Postgres: que un `setup`
> rechazado **no deje ninguna fila escrita**, que la evidencia con `resultado:
> "error"` quede guardada, y que la rama del CAE previo lea `sales` de verdad.
>
> **Lo que ningún nivel contesta** —que el circuito de verdad funcione contra
> ARCA— es el paso manual **M1**, y es el único de esta fase.

- [x] **T1401** Crear `apps/api/src/services/afipVerificacion.js` y
      `POST /api/afip/verificar` (`config.editar`) en `apps/api/src/routes/afip.js`.
      **Ejecuta** la verificación en dos pasos, en este orden, y el mensaje de error
      dice **cuál de los dos** falló: `afipAuth.getAccessTicket(empresaId)` —prueba
      el certificado, la clave y la delegación del servicio— y
      `afipService.getLastVoucher(pv, 6, empresaId)` → `FECompUltimoAutorizado`
      —prueba que el punto de venta existe—. **No consume numeración y no emite
      nada.** Guarda la evidencia en la clave de configuración `afip_verificacion`
      con la forma del data-model, **también cuando falla** (`resultado: "error"`),
      porque «probé y no anduvo» es un estado del checklist y no la ausencia de uno.
      El `certificado` es el `sha256` del PEM del **certificado** —que es público— y
      **nunca** de la clave. `permisosDeRutas.test.js` con la fila nueva.
      **Verificación**: `npm run test:api -- afip permisosDeRutas` y
      `npm --prefix apps/api run test:integracion -- settingsSinSecretos`.
      **Los tests que evitan el defecto**: *«un fallo del WSAA y un fallo del punto de
      venta dan mensajes distintos»* y *«la evidencia se guarda también cuando el
      resultado es error»*.
      **Qué se revierte para verlo en rojo**: guardar solo cuando `resultado === 'ok'`.
      ⚠ La clave `afip_verificacion` **ya está** en `SETTINGS_DE_SOLO_LECTURA` desde
      T1360: `PUT /api/settings/:key` no la puede escribir. **Un paso de checklist que
      el cliente puede marcar solo no es un paso de checklist.**

- [x] **T1402** En `apps/api/src/routes/afip.js`, `POST /setup` gana tres
      validaciones y **conserva las cinco que ya tiene**, incluida **la guarda de la
      cadena vacía de `afip.js:132-141`, que no se toca** (supuesto 8, FR-075):
      **(a)** la **pareja cert-clave** —se firma un blob de prueba con la clave y se
      verifica con la clave pública del certificado— porque hoy se validan por
      separado y el error aparece recién al firmar el TRA, como «Error al firmar el
      ticket de acceso» (A7, FR-087); **(b)** el **CUIT del certificado** contra
      `afip_cuit`, dato que ya sale de `GET /afip/cert-info:62` y que la pantalla ya
      muestra: **nadie los compara** (FR-088); **(c)** el **punto de venta** validado
      contra AFIP con `FECompUltimoAutorizado` antes de guardar (PENDIENTE N11,
      FR-091). Todo pasa por `guardarConfiguracionAfip` de T1361.
      **Verificación**: `npm run test:api -- afip`.
      **Los tests que evitan el defecto**: *«un certificado y una clave que no son
      pareja se rechazan en el guardado, no al facturar»* y *«un certificado de otro
      CUIT avisa cuál es cuál»*, con un par PEM generado en el test.
      **Qué se revierte para verlo en rojo**: sacar la verificación de firma.

- [x] **T1403** En el mismo endpoint, **el bloqueo del pase a producción**: si el
      cambio lleva `environment` de algo que no es `production` **a** `production` y
      el paso 4 no está cumplido → `400 { error: 'CIRCUITO_NO_VERIFICADO' }` con qué
      hacer (decisión 2 del usuario, decisión 11 del plan). El paso 4 está cumplido si
      **(a)** hay una verificación `ok` para el CUIT y el punto de venta actuales,
      **o (b)** la empresa tiene al menos una venta con `afip_cae` — **un comprobante
      autorizado es la prueba más fuerte que existe de que el circuito funciona, y es
      lo que impide dejar sin facturar a quien ya factura**. La evidencia **no se
      invalida** al cambiar el certificado: se marca «verificado contra otro
      certificado» y el checklist pide verificar de nuevo, **sin bloquear** — si se
      invalidara, el paso 4 nunca se podría cumplir en el momento de pasar a
      producción, porque el pase implica cambiar el certificado (ajuste 3).
      **El bloqueo es solo sobre la transición**: `POST /api/sales/:id/facturar` no se
      toca, y una empresa que ya está en producción sigue facturando.
      **Verificación**: `npm --prefix apps/api run test:integracion -- afip`.
      **Los tests que evitan el defecto**: *«pasar a producción sin verificar responde
      400 y NO cambia el ambiente»*, *«una empresa con un CAE en `sales` pasa a
      producción sin verificar»* y —el que sostiene la línea que no se cruza—
      *«facturar una venta NO consulta la evidencia: una empresa en producción sigue
      facturando»*.
      **Qué se revierte para verlo en rojo**: sacar la rama (b); el segundo falla.

- [x] **T1404** En el mismo archivo, `GET /status` (`:31`) deja de ser «probar la
      conexión». `FEDummy` **no lleva `Auth`**: contesta si los servidores de ARCA
      están arriba, y responde OK con el certificado vencido, con la clave equivocada
      o sin ningún certificado cargado (A5). Pasa a devolver dos cosas distintas
      —`servidores_afip` (lo que `FEDummy` dice) y `verificacion` (la evidencia de
      T1401)— más `ambiente` (FR-079, FR-082).
      **Verificación**: `npm run test:api -- afip`.
      **El test que evita el defecto**: *«con FEDummy en OK y sin ninguna verificación,
      la respuesta NO dice que la facturación de esta empresa esté lista»*.
      **Qué se revierte para verlo en rojo**: devolver un solo booleano `conectado`.

- [x] **T1405** Crear `DELETE /api/afip/vinculacion` (`config.editar`): borra
      `afip_cert`, `afip_key`, `afip_pv`, `afip_environment` y `afip_verificacion`
      **en transacción** e invalida el ticket WSAA por `guardarConfiguracionAfip`.
      **No toca `afip_cuit`** —es un dato de la empresa, no una credencial— y **no
      toca ninguna venta ya facturada** (FR-098). `permisosDeRutas.test.js` con su
      fila.
      **Verificación**: `npm --prefix apps/api run test:integracion -- afip` y
      `npm run test:api -- permisosDeRutas`.
      **El test que evita el defecto**: *«desvincular no borra el CUIT ni ninguna
      venta con CAE»*.
      **Qué se revierte para verlo en rojo**: agregar `afip_cuit` a la lista de claves
      borradas.

- [x] **T1406** [P] Crear `apps/web/src/utils/puestaEnMarchaAfip.js` con el estado y
      el **tono** de los cuatro pasos —CUIT cargado, certificado subido y vigente,
      punto de venta declarado, **circuito verificado**— y los días hasta el
      vencimiento del certificado (FR-083, FR-086, FR-089, FR-090). **Nunca devuelve
      `undefined`**, y un certificado **vencido** es un paso **en rojo**, no una fecha
      más. Su test en `apps/web/src/tests/puestaEnMarchaAfip.test.js`.
      **Verificación**: `npm run test:web -- puestaEnMarchaAfip`.
      **Los tests que evitan el defecto**: *«un certificado vencido ayer es un paso en
      rojo y no “vence en -1 días”»* y *«con un paso pendiente, el checklist NO dice
      que está completo»* (FR-085).
      **Qué se revierte para verlo en rojo**: comparar la fecha con `>=` en vez de `>`.

- [x] **T1407** Crear `apps/web/src/components/PuestaEnMarchaAfip.jsx` (ancla a
      **29**) y reescribir la sección AFIP de `apps/web/src/pages/Settings.jsx`
      (ancla a **30**, y sale de `PENDIENTES` de `formato.test.js`): el checklist de
      los cuatro pasos con el botón **«Verificar circuito»** · el banner que dice
      contra **qué ambiente** está configurada la empresa y, en homologación, que
      **los comprobantes no tienen validez fiscal** (FR-081) · el banner **nunca**
      sale de `FEDummy` (FR-080), y se corrige el bug de lectura de `Settings.jsx:82`,
      que hace `setAfipStatus(res.data)` sobre un `{ ok, data }` y después evalúa
      `afipStatus.error`, que en una respuesta exitosa **no existe nunca** · «Ventas
      sin CAE» con su enlace a reintentarlas (FR-097) · **«Desvincular AFIP»** con la
      confirmación que dice qué se pierde: «vas a tener que volver a subir el
      certificado y la clave, y la clave no se puede recuperar de acá» (FR-098) ·
      **las tres frases falsas de la maqueta no se copian**: la pantalla dice, textual,
      que el certificado y la clave se guardan **en la base de datos de AdminApp, sin
      cifrar**, que la clave **no sale nunca de la API** y que la del CSR **no se
      guarda: se descarga y hay que conservarla** (FR-093, FR-094, decisión 20) ·
      `config.cert` y `config.key` se limpian después de guardar, los inputs de
      archivo declaran `accept` y los object URL se liberan (A13, FR-099) ·
      `mensajeDeError` en todos los `catch`, y los mensajes que la API ya escribe en
      castellano **llegan al usuario** (A10, FR-092). Su test en
      `apps/web/src/tests/renderDeAjustesAfip.test.jsx`.
      **Verificación**: la disciplina de T1371 para los dos archivos, y
      `npm run test:web -- guardiasDeDiseno formato renderDeAjustesAfip`.
      **Los tests que evitan el defecto**: *«la pantalla no muestra la clave privada
      de ninguna forma, ni enmascarada»*, *«el banner no dice “Conectado” sobre un
      FEDummy»*, *«en homologación dice que los comprobantes no tienen validez
      fiscal»* y *«la pantalla no afirma que la clave se guarda cifrada»* —afirmado
      sobre el texto renderizado, buscando la palabra «cifrad»—.
      **Qué se revierte para verlo en rojo**: poner el banner verde en función de
      `servidores_afip.AppServer === 'OK'`.
      ⚠ **Esta funcionalidad NO cifra el material fiscal en reposo** —es el proyecto 6
      de `PROXIMOS-PROYECTOS.md`, junto con el token de TiendaNube— y **no puede
      agregar ningún lugar nuevo donde ese material quede en claro** (FR-096).

- [x] **T1408** [P] `docs/GUIA_AFIP.md`: **(a)** la sección nueva del **certificado
      de homologación**, que es un trámite distinto del de producción, con otro
      servicio de ARCA, y que hoy **no está documentado ni pedido en ninguna parte** —
      el paso 5 actual presenta el ambiente como un interruptor sobre el mismo
      material, y no lo es—; **(b)** las líneas `:14` y `:45` corregidas para decir lo
      mismo que la pantalla sobre dónde queda la clave y qué pasa con la del CSR
      (FR-095). Van **en el mismo corte** que la pantalla: una guía que dice lo
      contrario de la pantalla es peor que una guía desactualizada.
      **Verificación**: una guardia barata en `renderDeAjustesAfip.test.jsx` o en un
      test propio: **la guía no contiene la palabra «cifrad»** y **contiene
      «homologación»** en un encabezado de sección. No es ceremonia: son las dos
      afirmaciones exactas que hoy están mal.
      **El test que evita el defecto**: *«la guía y la pantalla dicen lo mismo sobre
      la clave privada»*.
      **Qué se revierte para verlo en rojo**: volver a poner «se guarda cifrada» en la
      guía.

**Checkpoint**: `/facturacion` muestra los cuatro pasos con su estado real, el
botón «Verificar circuito» consulta AFIP sin emitir nada, y pasar a producción sin
haber verificado devuelve un error que dice qué hacer.

---

## Phase 10: El gate de módulo (corte 10)

**Purpose**: cerrar la deuda de FR-001 / FR-002 en el sentido que el usuario
eligió: **las cuatro rutas quedan sin gate de módulo**. Son cinco líneas y no
depende de nada; va al final para que el cambio visible no se mezcle con nada.

- [x] **T1409** **(a)** En `apps/web/src/components/navegacion.js`, sale la clave
      `modulo` de los cuatro ítems: `/gastos` (`:42`), `/panel` (`:43`),
      `/facturacion` (`:49`) y `/team` (`:61`). **No se les pone `RouteGuard`**: son
      el esqueleto del sistema (decisión 6 del usuario, decisión 14 del plan).
      **(b)** En `apps/web/src/tests/marcoDePantalla.test.js`, `SIN_GUARD_TODAVIA`
      (`:181-190`) pierde `/gastos`, `/panel`, `/facturacion` y `/team`, y queda con
      `/pos`, `/ventas`, `/inventario` y `/suscripcion`, **que no son de este hito**.
      **(c)** El ancla `expect(items.length).toBeGreaterThanOrEqual(13)` (`:198`) baja
      a **10**, con el comentario que dice **por qué**: `navegacion.js` tenía catorce
      ítems con `modulo` y cuatro dejaron de declararlo a propósito; están
      enumerados; si el número bajara de diez, se perdió uno más que **nadie
      decidió**. Ajustar un número sin leer qué cambió es exactamente cómo una
      guardia deja de servir.
      **Verificación**: `npm run test:web -- marcoDePantalla` y
      `npm --prefix apps/web run test:navegador -- marcoDeLasPantallas`. La lista de
      `marcoDeLasPantallas.navegador.js` **sigue en dieciocho rutas**: esta
      funcionalidad no agrega ninguna (FR-004).
      **El test que evita el defecto**: el `it('la lista de rutas sin guard es
      exactamente la que hay en App.jsx')` que ya existe, que se afirma **en los dos
      sentidos**: sacar una ruta de la lista sin quitarle el módulo la pone en rojo, y
      quitarle el módulo sin sacarla de la lista también.
      **Qué se revierte para verlo en rojo**: sacar `modulo` de los cuatro ítems y
      **no** tocar `SIN_GUARD_TODAVIA`.
      ⚠ **Lo que hay que decir en voz alta**: hoy una empresa sin `gastos` en
      `enabled_modules` **no ve el ítem**; después de esto lo ve. Ése es el cambio
      visible, es el que la decisión 6 pide, y por eso este corte se revierte con una
      línea (riesgo 6 del plan).

**Checkpoint**: las cuatro pantallas están en el menú de toda empresa, y
`marcoDePantalla.test.js` no tiene ninguna deuda de este hito.

---

## Los dos pasos manuales

**Son dos, y las dos veces se preguntó si de verdad no bajan a ninguno de los
cuatro niveles.** Diez candidatos más se descartaron porque sí bajaban; están
listados abajo para que nadie los vuelva a proponer.

- [ ] **M1** **Sacar el certificado de homologación de ARCA y correr
      `POST /api/afip/verificar` contra el ambiente real, para Comprafit.** No baja a
      ningún nivel: exige un trámite en el sitio de ARCA con la clave fiscal del
      contribuyente, y la respuesta la da un servidor de terceros. Lo que **sí** está
      automatizado es todo lo demás: que la evidencia se guarde, que el bloqueo se
      aplique solo sobre la transición, que el CAE previo lo satisfaga, y que el
      mensaje de error diga cuál de los dos pasos falló.
      **Bloquea**: el despliegue del corte 9, y **nada más**. Si el trámite se traba,
      el corte 9 se posterga sin tocar ninguno de los otros nueve — que es lo que la
      spec quería comprar proponiendo «AFIP va sola».

- [ ] **M2** **Avisarle al dueño, antes del deploy del corte 2, que los números del
      Panel se van a mover.** Es una conversación, no una pantalla. Lo que el
      repositorio **sí** puede garantizar —y garantiza en T1359— es que la tabla esté
      escrita en `docs/OPERACION.md` con la fecha, que cada tarjeta lleve su nota al
      pie con la definición, y que el corte sea **uno solo y reversible**.
      **Bloquea**: el despliegue del corte 2. No bloquea ningún commit.

### Los diez que NO son pasos manuales, y adónde bajaron

| Lo que parecía manual | Adónde bajó |
|---|---|
| «Verificar que el montaje quedó bien» | Guardia estática — T1349 |
| «Revisar `enabled_modules` de cada empresa antes de cerrar el gate» | **Desaparece**: la decisión 6 quita el gate en vez de ponerlo |
| «Probar la migración de gastos contra datos reales» | `verificar-reversibilidad.js` — T1374, T1376 |
| «Confirmar que la extracción del repartidor no movió Clientes» | Los tests de `customerService` que ya existen, sin tocarlos — T1353 |
| «Medir que `registrarSesion` no encarece los requests» | `capturarConsultas` — T1396 |
| «Probar dos pestañas del mismo navegador a la vez» | Test de integración con dos promesas — T1395 |
| «Verificar que la clave de AFIP no sale por la API» | Integración sobre el cuerpo crudo — T1360 |
| «Mirar que el sparkline no se desborde» | Prueba de navegador — T1383 |
| «Chequear que el Panel no se rompa para producción y compras» | Render con el payload de cada rol — T1381 |
| «Confirmar que un desactivado no vuelve con un mail viejo» | Integración — T1350 y T1386 |

---

## Resumen

| Fase | Corte | Tareas | Rango | Depende de |
|---|---|---|---|---|
| 1 | La cadena de la invitación | 4 | T1349–T1352 | — |
| 2 | Los números del Panel (servidor) | 7 | T1353–T1359 | — |
| 3 | Lo que queda de la superficie fiscal | 3 | T1360–T1362 | — |
| 4 | Gastos · reglas y pantalla | 11 | T1363–T1373 | — |
| 5 | Gastos · la migración | 3 | T1374–T1376 | 4 |
| 6 | Panel · la pantalla | 7 | T1377–T1383 | 2 |
| 7 | Equipo · reglas y pantalla | 9 | T1384–T1392 | 1 |
| 8 | Sesiones | 8 | T1393–T1400 | 7 |
| 9 | AFIP · verificación y pantalla | 8 | T1401–T1408 | 3 |
| 10 | El gate de módulo | 1 | T1409 | — |
| | **Total** | **61** | | |

**La primera que hay que hacer es T1349**, y no es discutible: es lo único que
hace que `POST /api/empresas/onboarding` deje de responder 403 al usuario recién
registrado, toca `server.js` —el archivo sobre el que se apoyan los otros nueve
cortes— y su guardia es la única red que existe contra que el defecto vuelva.

### Las que pueden ir en paralelo

Dentro de cada fase: **T1351 y T1352** · **T1359** · **T1363, T1368 y T1369** ·
**T1373** · **T1374** · **T1378 y T1383** · **T1385** · **T1394** · **T1406 y
T1408**.

Entre fases: las **1, 2, 3, 4 y 10 no dependen de nada** y se pueden repartir
entre personas distintas. Las únicas dependencias reales son 5←4, 6←2, 7←1, 8←7 y
9←3.
