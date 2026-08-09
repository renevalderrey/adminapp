# Implementation Plan: Panel, Gastos, Equipo y Ajustes AFIP

**Spec**: [spec.md](./spec.md) · **Modelo de datos**: [data-model.md](./data-model.md) ·
**Contratos**: [contracts/api-endpoints.md](./contracts/api-endpoints.md)

## Summary

Cuatro pantallas que no comparten nada salvo el recorrido del cliente, y por eso
salen en **diez cortes revertibles por separado**. Tres de ellos no tocan una
línea de diseño: la cadena de la invitación —que nunca funcionó—, los cinco
números de plata del Panel, y lo que queda de la superficie fiscal. Recién
después vienen las pasadas de pantalla, y al final las dos piezas caras:
**sesiones con cierre** y **el circuito de AFIP verificado**.

Hay **una migración de datos** (los gastos fijos sin sucursal), **una migración
de esquema** (la tabla de sesiones) y **un permiso nuevo** (`equipo.editar`).

Y hay cinco cosas que la spec da por sentadas y **no son ciertas**. Están en
«Lo que la spec pide y hay que ajustar», antes que las decisiones, porque tres
de ellas cambian qué se construye.

---

## Technical Context

### Qué existe hoy, y qué le pasa a cada pieza

| Pieza | Hoy | Qué le pasa acá |
|---|---|---|
| `server.js:392-423` — la cadena de montajes | `app.use('/api', ...authEmpresa, general)` **antes** de `/api/empresas` y de `/api/auth` | **Se reordena.** Es el hallazgo 1 de abajo |
| `routes/auth.js` | Un `Router` con dos rutas, montado con `app.get`/`app.post` | Se parte en `publico` / `privado` y se monta con `app.use`, como ya hace `routes/tiendanube.js` |
| `middleware/auth.js:101-338` — `loadEmpresaContext` | 4 o 5 consultas por request; relee la membresía **en cada uno** | Le entra la validación de sesión detrás. Es donde se paga el costo de la decisión 1 |
| `services/dashboardService.js` | Doce consultas, cinco defectos de plata, un N+1 | Se corrige entero, sin tocar la pantalla, en su propio corte |
| `routes/general.js:312-370` — gastos | `create` con spread del cuerpo, sin totales, sin scoping del `punto_de_venta_id` | Campos explícitos, totales del servidor, `findScoped` |
| `routes/general.js:459-487` — `PUT /settings/:key` | Bloquea los **tres secretos** de `settingsSecretos.js` | Se le agrega la segunda lista: `afip_environment` y `afip_pv` siguen escribiéndose por acá (hallazgo 4) |
| `utils/settingsSecretos.js` | Creado en `01fc77d`, importado por `routes/general.js` y `scripts/backup.js` | Se le suma `SETTINGS_DE_SOLO_LECTURA`. **La lista de secretos no se toca** |
| `routes/afip.js:200-220` — `POST /invoice` | Emite un comprobante fiscal real con `ventas.crear` y sin `Sale` | **Se elimina** (PENDIENTE N12) |
| `services/afipAuth.js:78-80` — `invalidarCache` | Existe y lo llama solo `POST /afip/setup` | Lo llama todo camino que cambie el ambiente |
| `models/FixedExpense.js:33` — `group` | `STRING(10) NOT NULL DEFAULT 'gf1'` | Deja de tener `defaultValue` y de escribirse desde el cuerpo. **La columna se queda** |
| `utils/stockBajo.js` (los dos lados) | Regla única, con su encabezado diciendo que el Panel quedó afuera **a propósito** | El Panel entra. El encabezado se reescribe: la divergencia deja de existir y el motivo tiene que dejar de estar escrito como vigente |
| `pages/Expenses.jsx`, `pages/Dashboard.jsx`, `pages/Settings.jsx`, `pages/Team.jsx`, `components/GastosVariables.jsx` | Ninguno en `guardiasDeDiseno`, ninguno con test, los cinco con `err.message` | Se reescriben, uno por corte |

### Qué se reusa tal cual, sin escribir nada nuevo

Esto no es relleno: cada línea de acá es una decisión que **no** hay que tomar.

| Se necesita | Ya existe | Dónde |
|---|---|---|
| Elegir la sucursal por defecto de una empresa | `elegirPorDefecto(puntosDeVenta)` — **pura, exportada, tres escalones (`code='principal'`, activo de menor id, menor id)** | `utils/sucursalDeStock.js:59-69` |
| Validar que un `punto_de_venta_id` del cliente sea de la empresa | `findScoped` | `utils/tenantScope.js` |
| Sumar plata sin punto flotante | `aCentavos`, `deCentavos`, `sumaEnCentavos` | `utils/centavos.js` |
| El saldo de un proveedor bien calculado | `resumenDeCuenta` (deuda − pagado, en centavos) | `utils/cuentaDeProveedor.js` |
| Repartir un saldo impago por antigüedad | `_repartirPorAntiguedad`, ya usado para proveedores **y** clientes | `services/customerService.js:233`, `:249` |
| Las fechas del negocio | `hoyDelNegocio(empresaId)`, `fechaDelNegocio(zona)` | `utils/fechas.js` |
| Que un montaje público no herede la cadena de empresa | Dos routers exportados de un archivo | `routes/tiendanube.js` + `server.js:177`, `:402` |
| Invalidar el ticket WSAA de una empresa | `afipAuth.invalidarCache(empresaId)` | `services/afipAuth.js:78` |
| Probar el punto de venta sin emitir nada | `getLastVoucher(pv, tipo, empresaId)` → `FECompUltimoAutorizado` | `services/afipService.js:124-144` |
| Tabla en grid, panel lateral, segmentos, badges, encabezado | `TablaGrid`/`Encabezado`/`Fila`/`BotonDeFila`, `ui/sheet`, `pos/SegmentoDePago`, `PageHeader`, `Can` | `apps/web/src/components/` |
| Formato argentino y errores del servidor | `pesos`, `fechaCorta`, `importeOGuion`; `mensajeDeError` | `utils/formato.js`, `utils/erroresDeApi.js` |
| Contar cuántas consultas cuesta un request | `capturarConsultas(sequelize, accion)` | `src/tests/integracion/espiaDeConsultas.js` |
| El molde de una migración que mueve datos de un cliente e **informa** | `planificarFusiones` + `informar` + tabla de archivo + verificación adentro de la transacción | `migrations/20260809-unico-de-insumo-por-receta.js` |

### Los tres gates, y por qué acá son dos

`CONVENCIONES.md` pide decir dónde van los tres gates. Acá:

- **`soloSuperadmin`**: ninguna de las cuatro. Las cuatro son del cliente.
- **`modulo`**: **ninguna** — decisión 6 del usuario. Eso **no es no hacer nada**:
  hoy los cuatro ítems de menú declaran `modulo` (`navegacion.js:42`, `:43`,
  `:49`, `:61`) y la guardia `marcoDePantalla.test.js` exige que toda ruta cuyo
  ítem declara módulo lleve `RouteGuard` con ese mismo módulo. Cumplir la
  decisión 6 es **sacar `modulo` de los cuatro ítems** y sacarlos de
  `SIN_GUARD_TODAVIA`. Ver decisión 14.
- **`permission`**: los cuatro ítems ya lo declaran, todas las rutas de API ya
  declaran el suyo, y `permisosDeRutas.test.js` lo ancla con `DEUDA_DE_PERMISOS`
  vacía. Lo que cambia es **cuál** en dos casos (`config.editar` →
  `equipo.editar`) y que la **respuesta** del panel se recorta por permiso.

---

## Lo que la spec pide y hay que ajustar

Cinco. Los tres primeros cambian qué se construye; se verificaron ejecutando o
leyendo el archivo citado.

### 1. Arreglar el montaje de `/api/auth` no alcanza: el orden también está mal, y hoy rompe el onboarding

La spec (E1) dice que `server.js:422-423` monta el router con `app.get`/`app.post`
y por eso las dos rutas dan 404. Es cierto. **Lo que falta es que cambiarlo por
`app.use` en ese mismo lugar no arregla nada**, porque cuarenta líneas más
arriba está esto:

```js
// server.js:396
app.use('/api', ...authEmpresa, require('./routes/general'));
// authEmpresa = [checkJwt, extractUser, loadEmpresaContext, requireEmpresa, checkSubscription]
```

Los middlewares de un `app.use('/api', …)` corren para **todo** lo que empiece
con `/api`, independientemente de que el router de atrás matchee o no.
Reproducido contra el express instalado (5.2.1):

```
app.use('/api', cortaSinEmpresa, general);
app.get('/api/auth/invite/:token', authRouter);
GET /api/auth/invite/abc  ->  403 {"error":"NO_EMPRESA"}   ← nunca llega al handler
```

Y con el montaje movido arriba de la línea 396:

```
app.use('/api/auth', authPublico);
app.use('/api', cortaSinEmpresa, general);
GET /api/auth/invite/abc  ->  200
GET /api/expenses sin empresa -> 403   ← lo demás sigue igual
```

Consecuencias, en orden de gravedad:

1. **`GET /api/auth/invite/:token` es público y hoy pasa por `checkJwt`**: quien
   abre el enlace del mail sin haber entrado nunca recibe 401, no 404.
2. **`POST /api/auth/accept-invite/:token` está montado con `authSinEmpresa`
   justamente porque el invitado todavía no tiene empresa** — y `requireEmpresa`
   de la línea 396 lo corta con 403 `NO_EMPRESA` antes de llegar. La cadena
   `authSinEmpresa` **es código muerto tal como está montada**.
3. **Lo mismo le pasa a `/api/empresas`**, montado en la línea 415 con
   `authSinEmpresa`: `POST /api/empresas/onboarding` es el endpoint que usa un
   usuario recién registrado, que por definición no tiene empresa. Hoy responde
   403.
4. **Ningún entorno de prueba lo puede ver.** Con `BYPASS_AUTH=true` —que es lo
   que usan `npm test`, `npm run test:integracion` y las pruebas de navegador—
   `server.js:321` clava `req.empresaId = 1`, así que `requireEmpresa` nunca
   dispara. Un test de integración de la aceptación **pasaría con el montaje mal
   ordenado**.

**Qué se hace**: los dos montajes que necesitan usuario sin empresa
(`/api/auth`, `/api/empresas`) suben **arriba** de `app.use('/api', …)`, y la
guardia estática no verifica solo el tipo de montaje (FR-103) sino también el
**orden**: ningún `app.use('/api/<algo>')` puede quedar después del `app.use('/api')`
genérico. Ver decisión 1.

### 2. La premisa de la decisión 1 es media falsa: desactivar a alguien **sí** lo saca en el request siguiente

La decisión 1 dice, textual: «si alguien deja la empresa, desactivarlo no lo
saca hasta que vence su token». **Eso no es lo que hace el código.**
`loadEmpresaContext` relee la membresía en **cada request**:

```js
// middleware/auth.js:196-200
ue = await UsuarioEmpresa.findOne({
  where: { usuario_id: usuario.id, is_active: true },   // ← se relee siempre
  ...
});
```

Con `is_active:false`, `ue` queda en `null`, `req.empresaId` sin definir y
`requireEmpresa` responde 403 en el request siguiente. La API **no cachea la
membresía**: sacar a alguien ya es instantáneo hoy. Lo que falta es que
**`Team.jsx` no expone la acción** (hallazgo E12 / FR-113), que son dos botones.

Esto no cancela la decisión —el usuario la tomó y se hace— pero **cambia qué
compra**:

| Lo que se creía que faltaba | Lo que de verdad falta |
|---|---|
| Poder echar a alguien que se fue | Ya funciona en la API desde siempre; falta el botón (FR-113, barato) |
| — | **Ver** desde qué dispositivos entró cada uno y cuándo (nuevo, es la mitad del legacy) |
| — | **Cerrar un dispositivo** de alguien que sigue en la empresa: la notebook que quedó abierta en el local (nuevo) |

Y hay un techo que conviene escribir ahora y no cuando alguien lo descubra:
**sin la Management API de Auth0 no se puede revocar un token**. Lo que se
construye cierra la sesión del **cliente que coopera** —el navegador recibe 401,
borra su identificador y sale—; un token robado usado desde otra herramienta se
puede seguir usando hasta que vence. El único corte verdadero es
`is_active = false`, que ya existe. La pantalla tiene que decirlo con esas
palabras: **«cerrar sesión en ese dispositivo»**, no «revocar el acceso».

### 3. «Prueba en homologación» exige un certificado que ARCA emite por otro trámite, y la guía no lo menciona

La decisión 2 hace que la prueba en homologación **bloquee** el pase a
producción. El detalle que lo vuelve caro: **el certificado de homologación y el
de producción son dos certificados distintos**, emitidos por dos servicios
distintos de ARCA. `docs/GUIA_AFIP.md` documenta **solo el de producción**
(«Administración de Certificados Digitales», paso 2) y en el paso 5 dice
«Seleccioná el ambiente (Homologación para pruebas o Producción…)» como si fuera
un interruptor sobre el mismo material.

Con la decisión 2 tal cual, la secuencia real para un cliente nuevo es:

1. sacar un certificado **de homologación** — un trámite que hoy no está
   documentado ni pedido en ninguna parte;
2. cargarlo, verificar, y recién ahí
3. sacar el certificado **de producción**, cargarlo y cambiar el ambiente.

Y encima aparece un candado: si la evidencia de la prueba se invalidara al
cambiar el certificado —que es lo natural, porque una prueba con otra credencial
no prueba nada— **el paso 4 nunca se podría cumplir en el momento de pasar a
producción**, porque el pase implica cambiar el certificado.

**Qué se hace** (decisión 11, con el detalle completo):

- el paso 4 del checklist es **«circuito verificado»**, y se cumple con una
  **verificación ejecutada** —ticket WSAA obtenido + `FECompUltimoAutorizado`
  respondido para el punto de venta configurado— contra el ambiente que la
  empresa tenga puesto. No consume numeración, no emite nada;
- se cumple **también** si la empresa ya obtuvo alguna vez un CAE. Un
  comprobante autorizado es la prueba más fuerte que existe de que el circuito
  funciona, y es lo que impide dejar sin facturar a quien ya factura;
- la evidencia **no se invalida** al cambiar el certificado: registra que esta
  empresa, con este CUIT y este punto de venta, ejercitó el circuito. Sí se
  marca como «verificado contra otro certificado» y el checklist pide verificar
  de nuevo — pero **no bloquea nada**, porque a esa altura ya está en producción;
- **`docs/GUIA_AFIP.md` gana la sección del certificado de homologación.** Sin
  eso el bloqueo es un callejón sin salida para cualquiera que siga la guía, y
  esta funcionalidad habría convertido «no puedo facturar» en «no puedo empezar
  a facturar».

### 4. La fuga de `afip_key` se cerró; `afip_environment` y `afip_pv` siguen escribiéndose por la puerta de atrás

`01fc77d` cerró A1 y A2 y **la mitad** de A3: `PUT /api/settings/:key` rechaza
las claves de `SETTINGS_SECRETOS` (`afip_cert`, `afip_key`,
`tiendanube_access_token`). Pero el hallazgo A3 tiene dos mitades y la que
muerde sigue abierta:

```js
// routes/general.js:471 — solo mira los SECRETOS
if (esSecreto(req.params.key)) return res.status(400)…
```

`PUT /api/settings/afip_environment` con `"production"` sigue funcionando, y
**no invalida el ticket WSAA cacheado** (`afipAuth.taCache`), que se emitió
contra homologación. Lo mismo `afip_pv`, que quedaría fuera de la validación que
la decisión 11 agrega. FR-072 pide las cuatro claves; hoy están dos.

**Qué se hace**: `settingsSecretos.js` gana una segunda lista,
`SETTINGS_DE_SOLO_LECTURA = ['afip_environment', 'afip_pv',
'afip_verificacion']`, con su propio motivo escrito, y el `PUT` la rechaza con un
mensaje que dice cuál es el camino. Ver decisión 10.

### 5. Dos pares de requisitos no pueden cumplirse los dos como están escritos

**(a) FR-022/FR-023 contra la decisión 4.** FR-022 pide que un gasto sin sucursal
aparezca en «General» y FR-023 que «General» tenga su tarjeta; la decisión 4
manda **asignarlos todos a la sucursal por defecto**, con lo cual después de la
migración «General» queda vacío para siempre… salvo que se sigan pudiendo crear
gastos sin sucursal, que es lo que hoy pasa y no cambia.

Se hacen **las dos, en dos cortes y en este orden**: primero la regla pura (los
gastos sin sucursal se dibujan en «General»: la plata se ve **sin tocar un
dato**), después la migración (los que ya existen se asignan a la sucursal por
defecto). El orden importa: **la corrección que hace visible la plata no puede
depender de una migración de datos**, porque si la migración se revierte el
gasto tiene que seguir viéndose. Decisión 6.

**(b) La decisión 3 contra el PENDIENTE N2.** La decisión 3 unifica «stock bajo»
para que el aviso del Panel diga lo mismo que Faltantes; el N2 fija que los
indicadores del Panel son **de toda la empresa**. Pero `GET /api/faltantes` cae
a `req.puntoDeVentaId` cuando hay sucursal activa (`general.js:580-583`): con una
sucursal seleccionada, unificar la **regla** no alcanza — el Panel diría 12 y
Faltantes 7 por el **alcance**, no por el criterio.

Se resuelve así: **los avisos de «Requiere tu atención» siguen el alcance de la
pantalla a la que llevan** (el de faltantes es de la sucursal activa, igual que
`/faltantes`), y **las cuatro tarjetas de indicador son de toda la empresa y lo
dicen en la etiqueta**. Decisión 8.

---

## Decisiones

### 1. `/api/auth` y `/api/empresas` se montan arriba del `/api` genérico, y la guardia mira el orden además del tipo

**Se eligió:** partir `routes/auth.js` en dos routers exportados —`publico` (el
`GET /invite/:token`) y `privado` (el `POST /accept-invite/:token`)— y montarlos
con `app.use`, **arriba** de `app.use('/api', ...authEmpresa, general)`. `/api/empresas`
sube también. La guardia estática de FR-103 verifica dos cosas: que ningún
`Router` se monte con `app.get`/`app.post`, y que **ningún montaje de un
subcamino de `/api` quede después del montaje genérico de `/api`**.

**Alternativas descartadas:**

- **Cambiar `app.get`/`app.post` por `app.use` en el lugar donde están**, que es
  lo que la spec describe, **porque** el `app.use('/api', …)` de la línea 396 ya
  aplicó `checkJwt` y `requireEmpresa`: el 404 se convierte en 401 o en 403 y la
  invitación sigue sin poder aceptarse. Reproducido arriba.
- **Eximir a `/api/auth` dentro de `requireEmpresa`**, con una lista de prefijos
  como la que tiene `checkSubscription`, **porque** son dos listas de exenciones
  para el mismo problema en dos middlewares distintos, y la próxima ruta pública
  se olvida de una de las dos. El orden de montaje es una sola cosa y se puede
  verificar leyendo el archivo.
- **Mover `general.js` a `/api/general`**, que sería lo correcto de raíz,
  **porque** son treinta y pico de rutas del cliente (`/stock`, `/settings`,
  `/expenses`, `/alerts`, `/faltantes`, `/brands`) y renombrar sus URLs es un
  cambio de contrato que no tiene nada que ver con este hito. Queda anotado.

**Lo que hay que aceptar**: `BYPASS_AUTH` clava `req.empresaId = 1`, así que
**ningún test de integración puede distinguir el orden bueno del malo**. La
afirmación se sostiene con la guardia estática, y el test de integración cubre
la otra mitad —que las dos rutas contesten 200/404 y no 404 siempre—.

### 2. La sesión se identifica con un id de dispositivo del cliente, y la validación cuesta una consulta más por request

**Se eligió:** una tabla `sesiones` con una fila por `(usuario, dispositivo)`,
donde `dispositivo` es un UUID que el navegador genera una vez y guarda en
`localStorage`, y manda en la cabecera `X-Sesion-Id`. Un middleware
`registrarSesion`, **después** de `loadEmpresaContext` en las dos cadenas:

- si el request **no trae `Authorization`** (bypass, cron, webhook) → sigue sin
  tocar nada;
- si trae token y **no** trae `X-Sesion-Id` → 401 `SESION_REQUERIDA`;
- si la fila existe y tiene `cerrada_en` → 401 `SESION_CERRADA`;
- si no existe → se crea (`INSERT`), con su user-agent y su IP;
- si existe y está abierta → se actualiza `vista_en` **solo si pasaron más de
  cinco minutos** (FR-124).

Costo medido en consultas: **+1 `SELECT` por request** sobre
`UNIQUE (usuario_id, dispositivo)`, más un `UPDATE` como mucho cada cinco
minutos y un `INSERT` por dispositivo nuevo. Hoy `loadEmpresaContext` hace
cuatro o cinco: es un 20 % más. Se ancla con `capturarConsultas` en un test de
integración, que es la única forma de que ese 20 % no se vuelva un 60 % sin que
nadie se entere.

**Alternativas descartadas:**

- **Solo el último acceso, una columna en `usuarios`** (opción (a) del PENDIENTE
  1), **porque** el usuario eligió lo contrario y porque no distingue dos
  dispositivos de la misma persona, que es justo lo que se quiere ver.
- **Las sesiones de Auth0 por Management API** (opción (b)), **porque** no hay
  Management API en el repositorio: son credenciales nuevas, un secreto más para
  rotar, un rate limit y un modo de falla nuevo en el camino de **todos** los
  requests. Es lo único que revocaría de verdad, y por eso queda anotado como el
  camino si algún día «cerrar sesión» tiene que ser una garantía y no una
  cortesía.
- **Identificar la sesión con el hash del token (`sha256`)**, que sería
  infalsificable, **porque** Auth0 rota el access token cada pocas horas: cada
  rotación abriría una «sesión» nueva y la lista mostraría siete filas del mismo
  navegador. Y cerrarla no serviría: la rotación siguiente vuelve a entrar.
- **Cachear en memoria las sesiones abiertas**, **porque** cerrar una sesión
  dejaría de tener efecto hasta que expire el cache, y con más de un contenedor
  el efecto sería distinto según a quién le toque el request. Se paga la consulta
  y se mide.

**El techo, escrito**: quien tenga el token y no mande la cabecera —o mande un
UUID nuevo— entra igual. Esto cierra la sesión de un navegador que coopera, que
es el caso real (la notebook del local, la computadora que quedó abierta). El
corte de verdad es `is_active = false`, y **eso ya funciona hoy** (ajuste 2).

### 3. Cerrar una sesión la cierra en todas las empresas de esa persona, y la pantalla lo dice

**Se eligió:** `sesiones` no tiene `empresa_id`. Una sesión es de un
**dispositivo de una persona**, y esa persona puede cambiar de empresa con el
selector sin cerrar nada. El aislamiento lo da la membresía: listar y cerrar
pasan por `usuario_id IN (SELECT usuario_id FROM usuario_empresas WHERE
empresa_id = :empresaId AND is_active = true)`, encapsulado en
`sesionesDeLaEmpresa(empresaId)`. Una sesión de alguien que no es de la empresa
→ 0 filas → 404, igual que `findScoped`.

**Alternativas descartadas:**

- **Poner `empresa_id` en `sesiones`**, **porque** habría que elegir cuál —¿la de
  cuando entró?— y quedaría mintiendo en cuanto la persona cambie de empresa; y
  porque duplicar el dato invita a filtrar por él y olvidarse de la membresía,
  que es la que manda.
- **Prohibir cerrar la sesión de alguien con más de una membresía**, **porque** es
  una regla arbitraria que nadie va a poder explicar. Se hace lo contrario: la
  confirmación dice «se va a cerrar esa sesión en todas las empresas a las que
  esta persona tenga acceso».

### 4. «Por Pagar» sale de `utils/cuentaDeProveedor.js` y el aging sale del mismo repartidor que ya usan Clientes y Proveedores

**Se eligió:** `dashboardService._payables` deja de sumar `type:'deuda'` y pasa a
usar `resumenDeCuenta` (deuda − pagado, **en centavos enteros**). El aging deja
de sumar lo facturado y usa `_repartirPorAntiguedad`, que se **saca de
`customerService` a `utils/antiguedad.js`** como función pura con su test —hoy es
un método privado que ya sirve a dos consumidores y va a servir a un tercero—.
Lo mismo para el aging de «Por Cobrar» (P3): los cuatro tramos reparten el saldo
**impago**, y por construcción suman el total de arriba.

**Alternativas descartadas:**

- **Restar los pagos al total y dejar los tramos como están** —lo facturado—,
  **porque** es el defecto P3 exactamente: dos números en la misma tarjeta, a
  cuarenta píxeles, que no pueden cerrar nunca.
- **Escribir el `deuda − pagos` con un `GROUP BY` propio en `dashboardService`**,
  **porque** ya hay cuatro implementaciones del mismo saldo en el repositorio y
  una está rota; una quinta es la próxima que se desincroniza (FR-041).
- **Prorratear con la aproximación documentada, sin decirlo**, **porque** el
  docstring de `_repartirPorAntiguedad` admite que es una aproximación y eso
  tiene que llegar a la nota al pie de la tarjeta, no quedarse en el código.

### 5. Los cortes de fecha del Panel salen de `hoyDelNegocio`, y los períodos son semiabiertos

**Se eligió:** los seis `new Date().toISOString().split('T')[0]` de
`dashboardService` (`:17-22`, `:162-164`, `:218-221`, `:294`) se reemplazan por
`hoyDelNegocio(empresaId)`; `getKpis` pasa a recibir el `hoy` ya resuelto y a
propagarlo, como hace `filtroVentas.js`. Los cortes de mes pasan a ser
`[from, to)` — la venta del día 1 se cuenta **una** vez.

**Alternativas descartadas:**

- **Dejar `Op.between` y restarle un día al corte**, **porque** el archivo ya
  tiene la forma correcta escrita 130 líneas más abajo (`:174-177`, los tramos
  semiabiertos del aging) y dos formas de lo mismo en un archivo es la que
  alguien copia mal.
- **Resolver la zona en el frontend y mandarla**, **porque** la fecha del corte
  es la que decide qué venta entra en qué mes, y eso lo decide el servidor por el
  mismo motivo por el que decide el total de una venta.

### 6. El agrupado de gastos es una función pura que **no mira `group`**, y la migración va después y aparte

**Se eligió:** `apps/web/src/utils/gastos.js` con `agruparGastosPorSucursal(gastos, sucursales)`,
que reparte **solo por `punto_de_venta_id`**: con sucursal, a esa sucursal; sin
sucursal, a «General». La columna `group` **deja de leerse en el navegador** y
deja de escribirse desde el cuerpo (FR-031). El invariante que el test afirma es
el de FR-020/FR-021: **la suma de todos los grupos es igual a la suma de la
entrada, y ningún gasto aparece en dos grupos** — con la lista de gastos como
propiedad, no con tres casos elegidos a mano.

Recién después, en **otro corte**, la migración de la decisión 4 asigna los que
no tienen sucursal a la sucursal por defecto.

**Alternativas descartadas:**

- **Que la función interprete el `group` viejo** (opción (b) del PENDIENTE 4),
  **porque** `'gf1'` significa «Ortiz de Ocampo» en Comprafit y no significa nada
  en general: sería una regla que solo es cierta para un cliente, escrita en un
  archivo que sirve a todos.
- **Hacer la migración primero y que la pantalla dé por sentado que ningún gasto
  queda sin sucursal**, **porque** revertir la migración dejaría la pantalla
  perdiendo gastos otra vez, que es el defecto que se está arreglando. La
  pantalla tiene que ser correcta **con los datos como están hoy**.
- **`DROP COLUMN group`**, **porque** no es reversible y no molesta: se le saca
  el `defaultValue`, se deja de escribir y de leer, y queda como resto de la
  migración del legacy. Igual que `products.tiendanube_variant_id` en la 013.

### 7. Los totales de gastos los calcula el servidor, en centavos, y viajan al lado de las filas

**Se eligió:** `GET /api/expenses` devuelve `{ data, totales: { general, por_sucursal: {…} } }`,
sumado con `sumaEnCentavos` sobre `amount` —que es `DECIMAL(12,2)` y **vuelve
como string**—. La pantalla no suma nada. Es lo que ya hace
`GET /api/gastos-variables` (`gastosVariables.js:75`).

**Alternativas descartadas:**

- **Un endpoint `/expenses/resumen` aparte**, **porque** son dos requests para
  dibujar una pantalla y dos oportunidades de que las tarjetas y las filas se
  vean con datos de momentos distintos.
- **Sumar con `FixedExpense.sum()` y `group`**, **porque** el `SUM` de un DECIMAL
  vuelve como string igual y hay que convertirlo a centavos de todos modos, y
  porque el total general y el de cada grupo tienen que salir de **la misma
  lectura** que las filas o pueden no cerrar.

### 8. El Panel se recorta por permiso omitiendo bloques, no poniéndolos en cero

**Se eligió:** `getKpis(empresaId, { permisos, hoy })` **omite la clave entera**
del bloque que el usuario no puede ver:

| Bloque | Permiso | Quién lo pierde |
|---|---|---|
| `cashflow` | `caja.ver` | `produccion`, `compras` |
| `receivables`, `customers.with_debt` | `clientes.ver` | `produccion`, `compras` |
| `fixed_expenses` | `gastos.ver` | `vendedor`, `produccion`, `compras` |
| `payables` | `proveedores.ver` | `vendedor`, `produccion` |

`payables` no está en FR-049 y se agrega por el mismo principio: es el saldo de
proveedores, y `GET /api/suppliers` lo protege con `proveedores.ver`.

La clave **ausente** y la clave **en cero** son cosas distintas, y esa es toda la
decisión: la pantalla no dibuja la tarjeta que no vino (FR-050) y sabe distinguir
«no tenés permiso» de «da cero» (FR-056). Las cuatro tarjetas de indicador se
acomodan a las que quedan; para `produccion` puede quedar una sola.

Y los avisos de «Requiere tu atención» **siguen el alcance de la pantalla a la
que llevan** —el de faltantes usa `req.puntoDeVentaId`, igual que
`/api/faltantes`—, mientras las tarjetas son de toda la empresa y lo dicen en la
etiqueta. Es el ajuste 5(b).

**Alternativas descartadas:**

- **Devolver `null` en cada bloque**, **porque** `null` y `0` se confunden en
  cuanto alguien escribe `kpis.cashflow?.balance || 0`, que es exactamente lo que
  la pantalla hace hoy en seis lugares.
- **Un permiso nuevo `dashboard.finanzas`** (opción (b) del PENDIENTE 5),
  **porque** hay que sembrarlo, repartirlo por rol y explicarlo, y termina
  diciendo lo mismo que `caja.ver` y `clientes.ver` ya dicen. Cada bloque exige
  el permiso de **su** pantalla: si no lo podés ver allá, no lo ves acá.
- **Cortar la ruta entera con más permisos**, **porque** dejaría a `produccion` y
  `compras` sin Panel, y el Panel también tiene stock y ventas, que sí les
  corresponden.

### 9. «Stock bajo» se unifica leyendo las filas y contando con `esStockBajo`, no traduciendo la regla a SQL

**Se eligió:** `_productStats` y `_lowStockAlerts` dejan el
`literal('quantity <= min_stock AND min_stock > 0')` y pasan a leer las filas
—con `Product.is_active` y el `include` **filtrado por empresa** (FR-063)— y
contar con `esStockBajo(fila, umbral)`. Es exactamente lo que hace
`GET /api/faltantes` hoy.

**Alternativas descartadas:**

- **Escribir la regla en SQL** (`quantity <= CASE WHEN min_stock > 0 THEN
  min_stock ELSE :umbral END`), que sería más barata, **porque** habría **dos**
  escrituras de la misma regla —la de `utils/stockBajo.js` y la del `literal`— y
  el encabezado de ese archivo existe justamente porque eso ya pasó una vez.
- **Que el Panel llame a `GET /api/faltantes`**, **porque** un servicio del
  backend haciendo un request HTTP a su propio proceso es una dependencia nueva
  y un modo de falla nuevo por un `SELECT`.

**Lo que se paga**: el Panel lee las filas de stock en vez de contarlas en la
base. Es lo mismo que ya hace la pantalla de Faltantes, sobre las mismas filas.
Si algún día eso duele, el lugar donde duele es el mismo para las dos.

**Y lo que hay que hacer además**: reescribir el encabezado de
`apps/api/src/utils/stockBajo.js`. Hoy dice que el Panel quedó afuera **a
propósito** y que Inventario va a mostrar más productos; después de esto es
falso, y un comentario que describe una divergencia que ya no existe es peor que
no tener comentario.

### 10. `settingsSecretos.js` gana una segunda lista, y el cambio de ambiente invalida el ticket por cualquier camino

**Se eligió:** además de `SETTINGS_SECRETOS` (que **no se toca**), una lista
`SETTINGS_DE_SOLO_LECTURA = ['afip_environment', 'afip_pv', 'afip_verificacion']`.
`PUT /api/settings/:key` la rechaza con 400 y un mensaje que nombra el camino
(«el ambiente y el punto de venta se cambian desde Ajustes → Facturación, que
valida el punto de venta contra AFIP y renueva el ticket»). Y `afipAuth.invalidarCache`
se llama desde **una sola función** —`guardarConfiguracionAfip`— por la que pasan
todos los caminos que escriben ambiente o credenciales.

**Alternativas descartadas:**

- **Meter esas tres claves en `SETTINGS_SECRETOS`**, **porque** no son secretas:
  la pantalla necesita leer el ambiente y el punto de venta para dibujarse, y
  `sinSecretos` las convertiría en `afip_pv_cargado: true`, que no sirve para
  nada.
- **Una lista blanca de claves escribibles**, que sería más segura, **porque**
  `PUT /settings/:key` escribe hoy claves que nadie enumeró —las de onboarding,
  `fixed_expenses_total`, `target_sales`— y armar esa lista completa es un
  relevamiento propio. Queda anotado: la lista negra cierra lo de AFIP hoy, la
  blanca es el paso siguiente.

### 11. El paso 4 es «circuito verificado», con evidencia que escribe el servidor y que el historial de CAE también satisface

**Se eligió:** un endpoint `POST /api/afip/verificar` (permiso `config.editar`)
que **ejecuta** la verificación —`afipAuth.getAccessTicket` + `getLastVoucher`
para el punto de venta configurado— y guarda el resultado en la clave de
configuración `afip_verificacion`:

```json
{ "verificado_en": "2026-08-06T14:20:11Z", "ambiente": "homologation",
  "cuit": "20111111112", "pv": 5, "ultimo_comprobante": 0,
  "certificado": "sha256:1a2b…", "usuario_id": 7, "resultado": "ok" }
```

Esa clave **no se puede escribir por `PUT /settings/:key`** (decisión 10): la
única mano que la escribe es la del servidor después de que AFIP contestó.

El paso 4 del checklist está cumplido si **(a)** hay una verificación `ok` para
el CUIT y el punto de venta actuales, **o (b)** la empresa tiene al menos una
venta con `afip_cae`. Y el bloqueo de la decisión 2 se aplica en un solo lugar:
`POST /api/afip/setup`, cuando el cambio lleva `environment` de algo que no es
`production` a `production`.

**Alternativas descartadas:**

- **Emitir un CAE de prueba en homologación** (opción (c) del PENDIENTE 2),
  **porque** consume numeración —aunque sea de homologación— y porque requiere
  armar un comprobante completo: un endpoint que emite es la superficie que
  `POST /api/afip/invoice` tenía y que este mismo hito borra.
- **Solo el ticket WSAA** (opción (a)), **porque** no prueba que el punto de venta
  exista, que es la mitad de las llamadas «no puedo facturar».
- **Una tabla `verificaciones_afip` con historial**, **porque** lo que el
  checklist necesita es un estado, no una serie; el historial de intentos reales
  ya vive en las ventas y en los logs. Si algún día hace falta, la fila de
  `settings` se convierte en tabla sin cambiar el contrato de la pantalla.
- **Bloquear la emisión (`POST /api/sales/:id/facturar`) en vez del pase a
  producción**, **porque** eso sí dejaría sin facturar a quien ya factura, que es
  la línea que no se cruza.
- **Invalidar la evidencia al cambiar el certificado**, **porque** el pase a
  producción implica cambiar el certificado y el bloqueo se volvería imposible de
  satisfacer (ajuste 3). Se marca «verificado contra otro certificado» y se pide
  verificar de nuevo, sin bloquear.

### 12. `POST /api/afip/invoice` se elimina, y una guardia impide que vuelva

**Se eligió:** borrarlo (PENDIENTE N12). No lo llama nadie
(`PROXIMOS-PROYECTOS.md:160-163`), emite un comprobante fiscal real con
`ventas.crear` —que tiene el rol `vendedor`—, no crea `Sale` y reintroduce el
«CAE huérfano» que `POST /api/sales/:id/facturar` existe para eliminar. Lo que
ese botón quería comprobar lo comprueba `POST /api/afip/verificar` sin emitir
nada. Se agrega una guardia estática: **ninguna ruta fuera de
`routes/sales.js` puede llamar a `afipService.createVoucher`**.

**Alternativas descartadas:**

- **Dejarlo restringido a homologación** (la otra mitad de FR-077), **porque**
  seguiría siendo un camino que emite sin venta, y la restricción es un `if` que
  alguien va a poder sacar. Borrar es reversible con `git revert`; una fuga
  fiscal no.

### 13. El simulador de precios usa la suma real de gastos fijos, y `fixed_expenses_total` desaparece

**Se eligió:** el PENDIENTE N7 tal cual. `settings.fixed_expenses_total` deja de
leerse y de escribirse: el simulador toma `kpis.fixed_expenses`, que es la suma
real de `fixed_expenses` — la misma que la tarjeta de arriba (FR-052, FR-054). Y
`target_sales` **se crea de verdad**, con su campo «Facturación mensual promedio»
en la pantalla de Gastos, como lo tenía el legacy (`legacy:3030`). Sin ninguno de
los dos cargados, el simulador **no simula**: dice qué falta y adónde cargarlo
(FR-051).

`utils/bep.js` **no se toca** (supuesto 6).

**Alternativas descartadas:**

- **Conciliar los dos números con un aviso**, **porque** son dos respuestas a la
  misma pregunta a cuarenta píxeles de distancia y la de abajo decide el precio.
- **Borrar la fila `fixed_expenses_total` de `settings` con una migración**,
  **porque** dejar de leerla es reversible y borrarla no. La fila queda; el
  código deja de mirarla, y eso se ancla con una guardia por nombre.

### 14. El gate de módulo se cierra **quitándolo**, en su propio corte, en los dos lados

**Se eligió:** decisión 6 del usuario. `modulo` sale de los cuatro ítems de
`components/navegacion.js` (`:42`, `:43`, `:49`, `:61`) **y** las cuatro rutas
salen de `SIN_GUARD_TODAVIA` (`marcoDePantalla.test.js:181-190`). Sin `RouteGuard`:
son el esqueleto. `SIN_GUARD_TODAVIA` queda con `/pos`, `/ventas`, `/inventario`
y `/suscripcion`, que no son de este hito.

**Lo que hay que decir en voz alta**: hoy una empresa sin `gastos` en
`enabled_modules` **no ve el ítem**; después de esto lo ve. Ese es el cambio
visible, es el que la decisión 6 pide, y por eso va en un corte propio que se
revierte con una línea.

**Alternativas descartadas:**

- **Dejar `modulo` en el menú y no poner el guard**, que es lo que hay hoy,
  **porque** la guardia `marcoDePantalla.test.js` lo cuenta como deuda y seguiría
  contándolo: la deuda hay que cerrarla en algún sentido, y el usuario eligió
  cuál.
- **Ponerles `RouteGuard`** (opción (a) del PENDIENTE 6), **porque** exige mirar
  `enabled_modules` en producción y una lista mal armada hace desaparecer cuatro
  pantallas sin aviso.

### 15. `equipo.editar` se crea, y el chequeo de «último admin» es una función pura que corren la pantalla y el servidor

**Se eligió:** el PENDIENTE N9. `equipo.editar` entra en `seedPermissions.js` y se
le da a `admin` —exactamente quién puede hoy—, y `PUT /empresas/usuarios/:id`
pasa de `config.editar` a `equipo.editar`. Las dos reglas de FR-109/FR-110 salen
de `utils/equipo.js`:

```
puedeCambiarRol({ miembro, yo, miembros }) → { puede, motivo }
```

El servidor la importa —vive en `apps/api/src/utils/equipo.js` y se **espeja** en
`apps/web/src/utils/equipo.js`, como ya se hace con `stockBajo.js`— y la pantalla
la usa para deshabilitar el `Select` **con su explicación** (FR-111, FR-017).
Nunca devuelve `undefined`.

**Alternativas descartadas:**

- **Solo en el servidor**, **porque** la pantalla dibujaría un selector que
  siempre falla, que es el defecto G7 en otra pantalla.
- **Solo en la pantalla**, **porque** un `PUT` a mano dejaría la empresa sin
  admin y solo se sale de eso escribiendo en la base.
- **Un único archivo compartido entre `apps/api` y `apps/web`**, **porque** el
  monorepo no tiene paquete común y el precedente del repositorio es el espejo
  con su comentario y su test de los dos lados.

### 16. `_customerStats` deja de ser un N+1 y el filtro `is_credit` entra en la misma consulta

**Se eligió:** las dos `SUM` por cliente se reemplazan por dos `GROUP BY` fijos
—uno de ventas a cuenta corriente, uno de pagos—, con el molde de
`suppliers.js:307-311`, y la comparación pasa a centavos enteros (FR-044). Es una
sola corrección: el `is_credit` que falta (P2) hay que ponerlo en ese mismo
bucle, así que dejarlo como está y arreglar solo el filtro sería tocar el mismo
código dos veces.

**Alternativas descartadas:**

- **Arreglar solo `is_credit` y anotar el N+1**, **porque** es el mismo bloque de
  código y `customerService.js:319-320` ya tiene el `TODO(perf)` de hace meses
  para el mismo problema.

### 17. `GET /api/alerts` se elimina; los avisos salen de `kpis`

**Se eligió:** FR-058. `GET /api/alerts` tiene **un solo consumidor** en todo el
repositorio (`Dashboard.jsx:58`); `kpis.alerts` ya se calcula y se tira (P11). Se
borra el endpoint en el **mismo corte** que la pantalla deja de llamarlo, y el
Panel lee `kpis`. De paso desaparece el modo de falla P9: hoy un rol con
`dashboard.ver` y sin `stock.ver` rechaza el `Promise.all` y vacía el Panel
entero en silencio.

**Alternativas descartadas:**

- **Dejar `/alerts` y que el Panel deje de llamarlo**, **porque** un endpoint sin
  llamador es la superficie que E11 y `POST /afip/invoice` describen: sigue ahí,
  con su permiso distinto y su regla vieja, esperando que alguien lo use.

### 18. Los sparklines salen de series reconstruibles, y son menos de cuatro

**Se eligió:** el PENDIENTE N3 —doce períodos reales, y si no hay doce no se
dibuja— con una precisión que el N3 no hace y hay que hacer: **no todos los
indicadores tienen historia**.

| Tarjeta | ¿Hay serie? | De dónde |
|---|---|---|
| Ventas del mes | **Sí** | `GROUP BY date_trunc('month', date)` sobre `sales`, una consulta |
| Saldo de caja | **Sí** | Los movimientos tienen fecha: saldo acumulado por mes |
| Por cobrar | **Sí, con una consulta acumulada** | ventas a cuenta corriente hasta cada corte menos pagos hasta cada corte |
| Por pagar | **Sí, ídem** | movimientos de proveedor |
| **Gastos fijos** | **No** | `fixed_expenses` es un estado, no una serie: no tiene fecha. **No lleva sparkline** |

Las cuatro tarjetas del encabezado son **Ventas, Saldo de caja, Por cobrar y Por
pagar**; los gastos fijos quedan en su propia franja, sin sparkline, al lado del
simulador que los usa. Y con la decisión 8, un rol puede quedarse con **una**
tarjeta: la grilla se acomoda, no dibuja huecos.

**Alternativas descartadas:**

- **`Math.sin`, como la maqueta** (`:1166-1169`), **porque** la maqueta es una
  maqueta y una línea inventada en una tarjeta de plata es la familia de error
  que abre `CONVENCIONES.md`.
- **Doce consultas por tarjeta**, **porque** son cuarenta y ocho consultas más
  por carga del Panel, encima de las doce que ya hace.
- **Guardar una tabla de instantáneas diarias**, **porque** es una funcionalidad
  propia (y el día que haga falta, es la misma que «Actividad reciente»
  necesita).

### 19. «Actividad reciente» se llama «Últimas ventas»

**Se eligió:** el PENDIENTE N5 tal cual. No hay tabla de auditoría; de los cuatro
tipos de evento que dibuja la maqueta (`:1185-1192`) solo las ventas tienen autor
guardado. Se muestran las últimas ventas con su hora, su vendedor y su importe, y
**se rotula «Últimas ventas»**.

**Alternativas descartadas:**

- **Rotularlo «Actividad reciente» y mostrar solo ventas**, **porque** es
  prometer un registro que no existe, en la misma pantalla donde este hito le
  saca a la maqueta dos frases falsas sobre el cifrado.
- **Construir la tabla de auditoría acá**, **porque** es una funcionalidad propia
  y toca todos los endpoints de escritura del sistema.

### 20. La pantalla de AFIP dice qué se guarda y dónde, y la guía se corrige con ella

**Se eligió:** FR-093 a FR-096. La pantalla dice, textualmente, que el
certificado y la clave se guardan **en la base de datos de Favalio, sin cifrar**,
que la clave **no sale nunca de la API** y que la del CSR **no se guarda: se
descarga y hay que conservarla**. `docs/GUIA_AFIP.md:14` y `:45` se corrigen en el
**mismo corte** que la pantalla: una guía que dice lo contrario de la pantalla es
peor que una guía desactualizada.

**Alternativas descartadas:**

- **Copiar la maqueta** (`:730`, `:1374`, `:1380`), **porque** afirma dos cosas
  falsas sobre el material más sensible del sistema.
- **Cifrar acá para poder decirlo**, **porque** es el proyecto 6 y la 013 ya
  decidió que se hace para AFIP y TiendaNube juntos (supuesto 10).
- **No decir nada**, **porque** el silencio en la pantalla donde el cliente decide
  si sube su material fiscal es lo que hoy tapan tres frases falsas.

### 21. El detector del «padre ajeno» se arregla con una muestra sintética que lo tiene que encontrar

**Se eligió:** FR-033. Las dos formas nuevas —el `create` con un objeto armado
antes (`general.js:331`) y el valor `campo_id || null` (`gastosVariables.js:130`,
`:150`)— se agregan al detector de `aislamientoEmpresas.test.js:255-480`, y
**cada corrección se ejercita contra un archivo sintético con el defecto**,
exigiendo que el detector lo nombre con archivo y línea. Sin eso, «arreglé el
detector» es una afirmación que pasa en verde tanto si encuentra el caso como si
no.

**Alternativas descartadas:**

- **Arreglar las cuatro rutas y no el detector**, **porque** la regla se rompió
  treinta veces y lo que impide la trigésimo primera es el detector.

---

## Project Structure

### Archivos nuevos

**`apps/api`**

| Archivo | Qué |
|---|---|
| `src/migrations/20260812-sesiones-de-usuario.js` | La tabla `sesiones` |
| `src/migrations/20260813-gastos-fijos-a-su-sucursal.js` | La migración de datos de la decisión 4, con su archivo y su informe |
| `src/models/Sesion.js` | |
| `src/middleware/registrarSesion.js` | Decisión 2 |
| `src/services/sesionesService.js` | `registrar`, `sesionesDeLaEmpresa`, `cerrar`, `cerrarLasDemas` |
| `src/utils/antiguedad.js` | `repartirPorAntiguedad`, sacado de `customerService` |
| `src/utils/equipo.js` | `puedeCambiarRol`, `esUltimoAdmin`, `ETIQUETAS_DE_ROL` |
| `src/utils/dispositivo.js` | `dispositivoDeUserAgent(ua)` → `'computadora' \| 'celular' \| 'desconocido'` |
| `src/services/afipVerificacion.js` | Decisión 11: ejecutar, guardar y leer la evidencia |
| `src/tests/integracion/invitaciones.integracion.test.js` | E1, E5, E6, E7 |
| `src/tests/integracion/panel.integracion.test.js` | P1–P5, P10, la fixture con centavos y la venta del día 1 |
| `src/tests/integracion/gastos.integracion.test.js` | G2, G4, los totales, el `DECIMAL` string |
| `src/tests/integracion/sesiones.integracion.test.js` | Alta, cierre, 401, aislamiento y **el conteo de consultas** |
| `src/tests/integracion/settingsSinSecretos.integracion.test.js` | FR-070 a FR-074 ejecutados, incluido `PUT afip_environment` |
| `src/tests/montajeDeRouters.test.js` | Guardia: tipo **y orden** de montaje (decisión 1) |
| `src/tests/gastosFijosASuSucursal.test.js` | La función pura de la migración |
| `src/tests/sesionesYEquipo.test.js`, `src/tests/antiguedad.test.js`, `src/tests/dispositivo.test.js` | Las funciones puras (en `src/tests/`, **nunca** `utils/*.test.js`) |

**`apps/web`**

| Archivo | Qué |
|---|---|
| `src/utils/gastos.js` + `src/tests/gastos.test.js` | Decisión 6 |
| `src/utils/panel.js` + `src/tests/panel.test.js` | Severidad, orden y etiqueta de los avisos; alturas del sparkline |
| `src/utils/puestaEnMarchaAfip.js` + su test | Estado y tono de los cuatro pasos, días hasta el vencimiento |
| `src/utils/equipo.js` + su test | Espejo de `apps/api/src/utils/equipo.js` |
| `src/components/PanelDeGasto.jsx` | Sheet de 520px |
| `src/components/PanelDeMiembro.jsx` | Sheet de 520px |
| `src/components/TarjetaDeIndicador.jsx` | Tarjeta + sparkline de doce barras, **sin librería** (FR-069) |
| `src/components/RequiereTuAtencion.jsx` | |
| `src/components/SesionesDelEquipo.jsx` | |
| `src/components/PuestaEnMarchaAfip.jsx` | |
| `src/tests/renderDeGastos.test.jsx`, `renderDelPanel.test.jsx`, `renderDeAjustesAfip.test.jsx`, `renderDeEquipo.test.jsx` | FR-014 |

**Documentación**

| Archivo | Qué |
|---|---|
| `docs/OPERACION.md` | Sección nueva: «Los números del Panel cambiaron» (decisión 7 del usuario) |
| `docs/GUIA_AFIP.md` | El certificado de homologación, y las dos frases falsas corregidas |

### Archivos modificados

**`apps/api`**

`src/server.js` (orden de montajes, `registrarSesion` en las dos cadenas) ·
`src/routes/auth.js` (dos routers) · `src/routes/general.js` (gastos, `PUT
/settings/:key`, `/alerts` que se borra, el `include` de `Product`) ·
`src/routes/empresas.js` (E5, E6, E7, E9, E11, E12, sesiones) · `src/routes/afip.js`
(`/verificar`, `/invoice` que se borra, pareja cert-clave, CUIT, bloqueo del pase
a producción) · `src/routes/dashboard.js` (permisos a `getKpis`) ·
`src/routes/gastosVariables.js` (G4) · `src/services/dashboardService.js` (P1–P5,
P10, P16, P17, series) · `src/services/customerService.js` (extraer el
repartidor) · `src/services/afipService.js` (`getStatus` deja de ser la prueba) ·
`src/services/email.js` (**solo la URL del enlace**; supuesto 7) ·
`src/middleware/auth.js` (el hueco de `registrarSesion`) ·
`src/utils/settingsSecretos.js` (segunda lista) · `src/utils/stockBajo.js` (el
encabezado) · `src/models/FixedExpense.js` (sin `defaultValue`) ·
`src/seedPermissions.js` (`equipo.editar`) · `src/tests/aislamientoEmpresas.test.js`
(el detector) · `src/tests/permisosDeRutas.test.js` (los permisos que cambian)

**`apps/web`**

`src/pages/Expenses.jsx` · `src/pages/Dashboard.jsx` · `src/pages/Settings.jsx` ·
`src/pages/Team.jsx` · `src/components/GastosVariables.jsx` · `src/App.jsx` (el
`catch` de la aceptación) · `src/services/api.js` (los helpers que faltan:
`updateExpense` ya existe y nadie lo importa; `reenviarInvitacion`,
`cerrarSesion`, `verificarAfip` no existen) · `src/components/navegacion.js`
(sale `modulo`) · `src/sesion/ProveedorDeSesion.jsx` (el `X-Sesion-Id`) ·
`src/tests/marcoDePantalla.test.js` (`SIN_GUARD_TODAVIA`) ·
`src/tests/guardiasDeDiseno.test.js` (`NOMBRES` y el ancla, **de a uno por
corte**) · `src/utils/formato.test.js` (FR-013: detectar el formateo en línea)

---

## Orden de fases

**Diez cortes.** Cada uno se puede commitear, desplegar y revertir solo. El
criterio para separarlos, en este orden de prioridad: (1) lo que nunca funcionó
va antes que lo que se rediseña; (2) lo que **mueve un número que el dueño mira**
va solo y avisado; (3) lo que toca material fiscal va antes que su pantalla; (4)
lo que toca **todos los requests** va lo más tarde posible y solo.

| # | Corte | Qué entra | Depende de |
|---|---|---|---|
| **1** | **La cadena de la invitación** | E1 + el orden de montaje, E2, E4, la guardia de montaje, los tests de integración | — |
| **2** | **Los números del Panel** (servidor solo) | P1–P5, P10 (unificar stock bajo), P16, P17, `hoyDelNegocio`, la decisión 8 en la respuesta. **`OPERACION.md`** | — |
| **3** | **Lo que queda de la superficie fiscal** | La segunda lista de `settings`, la invalidación del ticket por cualquier camino, borrar `POST /afip/invoice` y su guardia | — |
| **4** | **Gastos · reglas y pantalla** | G1 (función pura), G2/G4/G5/G7/G8, FR-026 a FR-039, la reescritura, el detector del padre ajeno | — |
| **5** | **Gastos · la migración** | La decisión 4: los gastos sin sucursal a la sucursal por defecto, con archivo, informe y `down` | 4 |
| **6** | **Panel · la pantalla** | Las cuatro tarjetas, los sparklines, «Requiere tu atención», «Últimas ventas», accesos rápidos, el simulador, borrar `/api/alerts` | 2 |
| **7** | **Equipo · reglas y pantalla** | E3, E5, E7, E9, E10, E11, E12, E13(ver), `equipo.editar`, FR-105 a FR-120, la reescritura | 1 |
| **8** | **Sesiones** | La tabla, el middleware, los endpoints, la pantalla, el `X-Sesion-Id` | 7 |
| **9** | **AFIP · verificación y pantalla** | `POST /afip/verificar`, la evidencia, el bloqueo del pase a producción, el checklist, el banner honesto, «Desvincular», `GUIA_AFIP.md` | 3 |
| **10** | **El gate de módulo** | Decisión 14: sale `modulo` de los cuatro ítems, salen de `SIN_GUARD_TODAVIA` | — |

### Por qué en ese orden, y no en otro

**1 va primero** porque es la única funcionalidad del hito que **nunca funcionó**
—no está mal calculada: no existe— y porque toca `server.js`, que es el archivo
sobre el que se apoyan los otros nueve: hacerlo primero evita que cada corte
siguiente tenga que rebasarse sobre un cambio de montaje. Y destapa de paso que
`POST /api/empresas/onboarding` responde 403 al usuario para el que existe.

**2 va segundo y va solo.** Es la parte que cambia números que el dueño mira
todos los días, y por eso **no puede ir en el mismo commit que un rediseño**: el
día que «Por Pagar» baja a la mitad, la pregunta es «¿qué le pasó al sistema?», y
la respuesta tiene que ser «esto y nada más», no «se rediseñó la pantalla y
además». Se revierte solo si hace falta.

**3 va antes que 9** por lo mismo que la fuga de `afip_key` salió del hito: es un
`if` y un borrado, no depende de ninguna decisión de diseño, y mezclarlo con la
pantalla significa que no se puede revertir la pantalla sin reabrir el agujero.

**4 antes que 5** por el ajuste 5(a): la plata tiene que verse **sin** migrar
datos, para que revertir la migración no vuelva a esconderla.

**6 después de 2** porque la pantalla nueva sobre los números viejos mostraría
prolijamente cinco cosas mal.

**8 va anteúltima y sola** porque `registrarSesion` corre en **todos los
requests**: es el único cambio del hito que puede dejar la aplicación entera sin
funcionar, y tiene que poder revertirse quitando una línea de `server.js` sin
tocar nada más. La tabla se puede quedar.

**9 al final** porque su parte cara no es código: es el trámite del certificado
de homologación (ajuste 3). Si eso se traba, el corte 9 se posterga **sin tocar
ninguno de los otros nueve** — que es exactamente lo que la spec quería comprar
proponiendo «AFIP va sola».

**10 puede ir cuando sea**: son cinco líneas y no depende de nada. Va al final
para que el cambio visible —cuatro ítems de menú que aparecen para empresas que
hoy no los ven— no se mezcle con nada.

### Sobre `guardiasDeDiseno`, y un desvío deliberado de FR-005

FR-005 pide que los cinco archivos entren en `NOMBRES` **antes** de reescribirse.
Se cumple el motivo y no la letra: **cada archivo entra en la lista al principio
de su propio corte**, no los cinco al principio del hito. Meterlos todos de una
deja `npm run test:web` **en rojo durante cuatro cortes**, y una suite roja
permanente es una que nadie mira cuando se pone roja por otra cosa. Con el
archivo entrando en su corte se consigue lo mismo que FR-005 busca —que cada
infracción falle cuando se escribe, y no treinta juntas al final— y cada commit
queda verde. El ancla `expect(ARCHIVOS).toHaveLength(19)` sube de a uno.

### Qué se le dice al dueño el día que los números se muevan (decisión 7)

Tres cosas, y las tres van en el corte 2:

1. **`docs/OPERACION.md`** gana una sección con la tabla exacta —qué indicador,
   en qué dirección se mueve, por qué— y la fecha del deploy. «Por Pagar» baja y
   puede bajar mucho porque hasta hoy no restaba los pagos; «Por Cobrar» y
   «clientes con deuda» bajan porque contaban las ventas de contado; los cuatro
   tramos del aging cambian porque hasta hoy no podían cerrar con su total;
   «stock bajo» **sube** porque pasa a contar los productos en cero sin mínimo
   cargado.
2. **Cada tarjeta lleva su nota al pie con la definición**, que es lo que la
   maqueta ya dibuja (`:247-255`). Es la parte durable: un número que el dueño
   puede explicar no se lee como un bug la próxima vez.
3. **El aviso va antes del deploy, no después.** Es una conversación, no una
   pantalla; lo que el repositorio puede garantizar es que esté escrito y que el
   corte sea uno solo y reversible.

---

## Cómo se verifica

`CONVENCIONES.md` fija los cuatro niveles. Acá, lo que decide cada uno:

### Función pura (`utils/`, test en `src/tests/`)

El agrupado de gastos y su invariante de suma · el reparto por antigüedad · el
estado y el tono de cada paso del checklist de AFIP y los días hasta el
vencimiento · `puedeCambiarRol` / `esUltimoAdmin` y las etiquetas de rol
(incluido `gerente`) · la severidad, el orden y la etiqueta de cada aviso · las
alturas del sparkline con la serie vacía y con un solo punto ·
`dispositivoDeUserAgent` · el plan de la migración de gastos.

### Guardia estática

**Nueva**: el tipo **y el orden** de montaje de los routers (decisión 1) — es lo
único que impide que E1 vuelva. Que ninguna ruta fuera de `sales.js` llame a
`createVoucher`. Que `fixed_expenses_total` no se lea en ningún componente.
**Se arreglan**: el detector del padre ajeno, con muestra sintética (decisión 21);
la guardia de formato, para que vea el formateo **en línea** (FR-013).
**Suben**: `guardiasDeDiseno` (cinco archivos, de a uno), `permisosDeRutas`
(`equipo.editar`), `marcoDePantalla` (`SIN_GUARD_TODAVIA`).

### Integración contra Postgres

Lo que **solo** este nivel puede contestar:

- que `GET /api/auth/invite/:token` y `POST /api/auth/accept-invite/:token`
  **contesten**, y que un token vencido, usado o inexistente no cree membresía;
- que registrar un pago **baje** «Por Pagar»; que una venta de contado a un
  cliente identificado **no** cuente como por cobrar; que los cuatro tramos sumen
  el total; que la venta del día 1 se cuente **una** vez; que el corte de mes use
  `Empresa.timezone`;
- que `POST /api/expenses` con la sucursal de otra empresa **no cree ninguna
  fila**, y que el `SUM(amount)` que vuelve como string no rompa el total;
- que `GET /api/settings` no contenga la cadena `-----BEGIN`, y que
  `PUT /api/settings/afip_environment` sea rechazado;
- que un rol sin `caja.ver` **no reciba la clave** `cashflow`;
- que una sesión cerrada responda 401, que la empresa B no pueda cerrar una
  sesión de la A, y —con `capturarConsultas`— que un `GET` representativo pase de
  N a **N+1** consultas y no a N+4.

**La fixture tiene que poder distinguir el defecto.** Para el Panel: una venta el
día 1, una de contado a cliente identificado, un proveedor con deuda **y un pago
parcial**, importes con centavos que no cierran solos, un producto en cero **sin
`min_stock`**, una venta a las 22:00 hora argentina y `Empresa.timezone` distinto
de UTC. Una fixture de tres ventas redondas pasa con y sin cinco de los seis
defectos.

### Render (jsdom)

Que el encabezado y las filas compartan `grid-template-columns` · que las
tarjetas de total sumen lo mismo que las filas · que «Nuevo gasto» y «Eliminar»
queden **deshabilitados con su explicación** · que un error de la API muestre el
mensaje del servidor y no «Request failed with status code 500» · que el
simulador no arranque con 7.000.000 ni con 2.400.000 · que un fallo de un pedido
muestre un aviso y no seis tarjetas en `-` · que invitar sin que el mail salga
muestre el enlace y diga que hay que pasarlo a mano · que la fila propia tenga el
selector deshabilitado · que la columna Estado **lea `is_active`** · que la
pantalla de AFIP no muestre la clave privada de ninguna forma y que el banner no
diga «Conectado» sobre un `FEDummy`.

### Navegador

**Nada nuevo, salvo tres**: que el nombre de un gasto largo no se meta en la
columna de importe, que el sparkline de doce barras no desborde su tarjeta, y que
las cuatro tarjetas arranquen en el mismo píxel. Las cuatro rutas **ya están** en
`CON_MARCO` y esta funcionalidad **no agrega ninguna** (FR-004): la lista sigue
en dieciocho.

---

## Riesgos

| # | Riesgo | Cómo se detecta | Mitigación |
|---|---|---|---|
| 1 | **`registrarSesion` corre en todos los requests: si falla, no funciona nada.** | El test de integración que cuenta consultas, y el humo del deploy | Va en el corte 8, solo, y se revierte quitando una línea. Sin `Authorization` no hace nada, así que el cron, el webhook y las pruebas de navegador no lo tocan |
| 2 | **El bloqueo del pase a producción deja a un cliente sin poder empezar a facturar** si no consigue el certificado de homologación | No se detecta con un test: se detecta en el teléfono | Decisión 11: el historial de CAE también satisface el paso, y `GUIA_AFIP.md` documenta el trámite **en el mismo corte**. Si el trámite se traba, el corte 9 se posterga sin tocar nada más |
| 3 | **La migración de gastos mueve plata de tarjeta** en la pantalla de alguien que ya la mira | El informe por consola dice fila por fila qué movió | Corte propio (5), archivo con las filas, `down` que restaura los `NULL`, y `scripts/verificar-reversibilidad.js` corrido antes de mergear |
| 4 | **Una empresa sin ninguna sucursal** deja a la migración sin destino | La migración lo cuenta y lo informa | No falla: informa «N gastos de M empresas sin sucursal quedan como estaban» y los deja en «General», que la decisión 6 ya dibuja |
| 5 | **Unificar «stock bajo» sube el número del Panel** y se lee como un bug nuevo | — | `OPERACION.md` en el mismo corte, y va junto con los otros cuatro números para que haya **un** día raro y no cinco |
| 6 | **Quitar `modulo` del menú hace aparecer cuatro ítems** en empresas que hoy no los ven | — | Corte propio (10), se revierte con una línea |
| 7 | **`BYPASS_AUTH` esconde el modo de falla de la fase 1**: ningún test puede distinguir el orden de montaje bueno del malo | La guardia estática de orden | Es la única red. Está escrito en la decisión 1 para que nadie la borre creyendo que el test de integración la cubre |
| 8 | **La decisión 8 rompe la pantalla para `produccion` y `compras`** si el frontend lee `kpis.cashflow.balance` sin preguntar | El test de render con un `kpis` recortado | Claves **ausentes** y no `null`, más el test de render con el payload de cada rol |
| 9 | **Extraer `_repartirPorAntiguedad` mueve los números de Clientes**, que es una pantalla oculta pero existe | Los tests de `customerService` que ya existen | Es una extracción sin cambio de comportamiento: se verifica que los tests de Clientes pasen **sin tocarlos** |
| 10 | **Cerrar una sesión no revoca nada** y alguien lo va a leer como que sí | — | Está en la decisión 2 y tiene que estar en la pantalla con esas palabras. El corte real es `is_active = false`, que es FR-113 y ya funciona |
