# Contratos de API: Panel, Gastos, Equipo y Ajustes AFIP

Complementa a [plan.md](../plan.md) y a [data-model.md](../data-model.md).

---

## Lo primero: el montaje cambia, y eso vale para todo lo de abajo

`server.js` monta hoy así, en este orden:

```js
app.use('/api', ...authEmpresa, require('./routes/general'));      // :396
…
app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'));  // :415
app.get('/api/auth/invite/:token', require('./routes/auth'));      // :422
app.post('/api/auth/accept-invite/:token', ...authSinEmpresa, …);  // :423
```

Los middlewares de `app.use('/api', …)` corren para **todo** lo que empieza con
`/api`, matchee o no el router de atrás. Reproducido contra el express instalado
(5.2.1): `GET /api/auth/invite/abc` **nunca llega al handler** — lo corta
`requireEmpresa` con 403, o `checkJwt` con 401 si no hay token.

Después de este hito:

```js
// ── Rutas que un usuario SIN empresa tiene que poder usar ──
// Van ARRIBA del /api genérico: sus middlewares corren para todo lo que
// empiece con /api, así que un montaje más específico que quede debajo nunca
// recibe el request. Ver decisión 1 del plan.
app.use('/api/auth', require('./routes/auth').publico);
app.use('/api/auth', ...authSinEmpresa, require('./routes/auth').privado);
app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'));
…
app.use('/api', ...authEmpresa, require('./routes/general'));
```

`routes/auth.js` pasa a exportar `{ publico, privado }`, como ya hace
`routes/tiendanube.js`. La guardia de `src/tests/montajeDeRouters.test.js`
verifica **el tipo** (`app.use` para un `Router`) y **el orden** (ningún
`app.use('/api/<algo>')` después del `app.use('/api')`).

⚠ **Ningún test de integración puede distinguir el orden bueno del malo**: con
`BYPASS_AUTH=true`, `server.js:321` clava `req.empresaId = 1` y `requireEmpresa`
nunca dispara. La guardia estática es la única red.

---

## Cabecera nueva: `X-Sesion-Id`

| | |
|---|---|
| **Qué** | Un UUID v4 que el navegador genera una vez y guarda en `localStorage` |
| **Quién la manda** | El interceptor de `services/api.js`, en **todos** los requests, junto a `X-Empresa-Id` y `X-Punto-De-Venta-Id` |
| **Quién la exige** | `registrarSesion`, y **solo** cuando el request trae `Authorization`. Sin token no se pide (el cron, el webhook de TiendaNube y `BYPASS_AUTH` no la mandan) |
| **Sin ella, con token** | `401 { error: 'SESION_REQUERIDA' }` |
| **Con una sesión cerrada** | `401 { error: 'SESION_CERRADA', message: 'Cerraron la sesión de este dispositivo.' }` |

El interceptor de respuesta de `services/api.js:44-50` ya redirige al login con
cualquier 401. Lo que se le agrega: con `SESION_CERRADA`, **borrar el
`X-Sesion-Id` de `localStorage`** antes de salir, para que el próximo ingreso sea
una sesión nueva y no vuelva a chocar contra la cerrada.

**El techo, escrito también acá**: quien tenga el token y no mande la cabecera —o
mande un UUID nuevo— entra igual. Cerrar una sesión cierra el navegador que
coopera; el corte real es `is_active = false` sobre la membresía, que
`loadEmpresaContext` relee en cada request.

---

## Gastos

### `GET /api/expenses` — **modificada** (agrega, no rompe)

`gastos.ver`. Sigue aceptando `punto_de_venta_id`; **`group` deja de aceptarse**
como filtro (nadie lo manda y la columna deja de significar algo).

```json
{
  "ok": true,
  "data": [
    { "id": 12, "name": "Alquiler", "amount": "180000.00",
      "punto_de_venta_id": 3, "group": "pv_3" }
  ],
  "totales": {
    "general": "222500.00",
    "sin_sucursal": "42500.00",
    "por_sucursal": { "3": "180000.00" }
  },
  "alcance": "empresa"
}
```

- **Los totales los calcula el servidor** (FR-026), sumando en centavos enteros:
  `amount` es `DECIMAL(12,2)` y **vuelve como string**.
- `general` es la suma de **todo**, incluido `sin_sucursal`. La tarjeta de
  «General» existe (FR-023) y la suma de las tarjetas es el total.
- `alcance` es `"empresa"` siempre y la pantalla lo muestra: FR-037 pide que
  quede escrito cuál de las dos es, y es la empresa entera porque el agrupado por
  sucursal es la razón de ser de la pantalla. `req.puntoDeVentaId` **no** se
  aplica como caída — a diferencia de `/faltantes`.
- `group` se sigue devolviendo (la columna existe) y **la pantalla no lo lee**.

### `POST /api/expenses` — **modificada (rompe)**

`gastos.crear`. Deja de hacer `{ ...req.body }`.

| Campo | | |
|---|---|---|
| `name` | requerido | `STRING(150)` |
| `amount` | requerido | número; se guarda como `DECIMAL(12,2)` |
| `punto_de_venta_id` | opcional | **pasa por `findScoped(PuntoDeVenta, id, empresaId)`**. De otra empresa → `404 { error: 'Punto de venta no encontrado' }`, no 403: un recurso ajeno no existe |

**`group`, `empresa_id` e `id` del cuerpo se ignoran** (FR-030 a FR-032). `group`
lo sigue escribiendo el servidor como `'pv_' + id` cuando hay sucursal, para no
dejar la columna `NOT NULL` sin valor; **nadie la lee**.

⚠ No se usa `resolverSucursal` de `utils/sucursalDeStock.js` aunque exista y
valide lo mismo: **nunca devuelve `null`** —cae a la sucursal por defecto—, y acá
un gasto sin sucursal es un caso legítimo («General»). Se usa `findScoped`
directo.

### `PUT /api/expenses/:id` — **modificada**

`gastos.editar`. Ya usa `findScoped` (bien). Se le agrega la misma lista blanca
que el `POST` y la misma validación de `punto_de_venta_id`. **Y pasa a tener
llamador**: `services/api.js:222` declara `updateExpense` y ningún componente lo
importa (FR-034).

### `DELETE /api/expenses/:id` — sin cambios

`gastos.eliminar`, ya scopeado. Lo que cambia es la **pantalla**: el rol `gerente`
no tiene ese permiso y hoy ve el botón. Pasa a dibujarse **deshabilitado con su
explicación** (FR-017, FR-036), no ausente.

### `POST` / `PUT` de `/api/gastos-variables` — **modificadas**

Mismo arreglo de `punto_de_venta_id`: hoy llega como `punto_de_venta_id || null`
(`gastosVariables.js:130`, `:150`), que es una de las **dos formas nuevas** que el
detector del padre ajeno no ve (FR-033).

---

## Panel de control

### `GET /api/dashboard/kpis` — **modificada (rompe)**

`dashboard.ver` sigue siendo el permiso de la ruta. Lo que cambia es **qué
devuelve**, y son cuatro cosas a la vez.

#### 1. Los bloques que el usuario no puede ver **no vienen**

No vienen en `null`, no vienen en cero: **la clave no está** (decisión 8 del
plan, FR-049/FR-050).

| Bloque | Permiso | Se lo pierden |
|---|---|---|
| `cashflow` | `caja.ver` | `produccion`, `compras` |
| `receivables` | `clientes.ver` | `produccion`, `compras` |
| `customers.with_debt` | `clientes.ver` | ídem (`customers.active` sigue) |
| `payables` | `proveedores.ver` | `vendedor`, `produccion` |
| `fixed_expenses` | `gastos.ver` | `vendedor`, `produccion`, `compras` |

`sales_*`, `products` y `alerts` siguen para todos.

⚠ El frontend **no puede** leer `kpis.cashflow.balance`. Un bloque ausente se
dibuja como «no tenés permiso para ver esto» o no se dibuja; nunca como `$0`.

#### 2. Los números cambian

Mismo contrato, otros valores. Es el corte 2 del plan y va con su nota en
`OPERACION.md`:

| Campo | Qué cambia |
|---|---|
| `payables.total` | **deuda − pagos**, en centavos. Hoy es solo deuda: **baja** |
| `payables.aging.*` | Reparte el saldo **impago**, no lo facturado |
| `receivables.total` | Solo ventas con `is_credit`: **baja** |
| `receivables.aging.*` | Suma exactamente `receivables.total` |
| `customers.with_debt` | Solo cuenta corriente, comparado en centavos: **baja** |
| `sales_current_month`, `sales_previous_month` | Cortes semiabiertos: la venta del día 1 **deja de contarse dos veces** |
| todo lo que corta por fecha | `hoyDelNegocio(empresaId)` en vez de UTC |
| `products.low_stock`, `alerts.low_stock` | Regla de `utils/stockBajo.js`, con `is_active`: **sube** |

#### 3. Campos nuevos

```json
{
  "series": {
    "ventas":     [ … 12 números … ],
    "cashflow":   [ … ],
    "receivables":[ … ],
    "payables":   [ … ]
  },
  "requiere_atencion": [
    { "tipo": "faltantes", "severidad": "alta", "cantidad": 12,
      "titulo": "12 productos por debajo del mínimo",
      "ruta": "/faltantes", "alcance": "sucursal" },
    { "tipo": "sin_cae", "severidad": "alta", "cantidad": 1,
      "titulo": "1 comprobante sin CAE", "ruta": "/ventas?sin_cae=1",
      "alcance": "empresa" },
    { "tipo": "vencimientos", "severidad": "media", "cantidad": 3, "…": "…" },
    { "tipo": "certificado_afip", "severidad": "media", "dias": 28, "…": "…" }
  ],
  "ultimas_ventas": [
    { "id": 881, "hora": "14:12", "vendedor": "Ana", "total": "12500.00" }
  ],
  "supuesto_crecimiento": 1.1
}
```

- **`series`**: doce períodos reales. **Si no hay doce, la clave del indicador no
  viene** y la tarjeta no dibuja sparkline (FR-068, PENDIENTE N3). **No hay serie
  de `fixed_expenses`**: es un estado, no una serie — decisión 18 del plan.
- **`requiere_atencion`**: los tres del pedido más el certificado de AFIP por
  vencer (PENDIENTE N4). **Un aviso con cero casos no viene** (FR-065). El orden y
  la severidad los decide una función pura del navegador; el servidor manda los
  hechos. `alcance` dice si el número es de la sucursal activa o de la empresa, y
  **el de faltantes es de la sucursal activa porque `GET /api/faltantes` lo es**:
  si no, el aviso diría 12 y la pantalla a la que lleva mostraría 7 (ajuste 5(b)
  del plan).
- **`ultimas_ventas`**: se rotula **«Últimas ventas»** y no «Actividad reciente»
  (PENDIENTE N5). No hay tabla de auditoría.
- **`supuesto_crecimiento`**: ya lo devuelve `cashflowService:123` y la pantalla
  no lo lee. Pasa a mostrarse: «Proy. 30d supone un crecimiento del 10 %»
  (FR-060).

#### 4. Lo que desaparece

`fixed_expenses_total` deja de existir como concepto: el simulador usa
`fixed_expenses` (decisión 13 del plan).

### `GET /api/alerts` — **se borra**

Un solo consumidor en todo el repositorio (`Dashboard.jsx:58`), permiso distinto
del de `/kpis` (`stock.ver` contra `dashboard.ver`), regla vieja de stock bajo y
`include` de `Product` sin filtrar. Todo eso ya viene en `kpis.alerts` (FR-058).

Se borra en el **mismo corte** en que la pantalla deja de llamarlo. De paso
desaparece el modo de falla P9: hoy un rol con uno de los dos permisos y sin el
otro rechaza el `Promise.all` y deja el Panel entero en `-` y `0`, sin un cartel.

---

## Facturación AFIP

### `POST /api/afip/verificar` — **nueva**

`config.editar`. **Ejecuta** la verificación y guarda la evidencia. No recibe
cuerpo: verifica lo que la empresa tiene configurado.

```json
{ "ok": true, "data": {
    "resultado": "ok", "ambiente": "homologation",
    "cuit": "20111111112", "pv": 5, "ultimo_comprobante": 0,
    "verificado_en": "2026-08-06T14:20:11.000Z" } }
```

Dos pasos, en este orden, y el mensaje de error dice **cuál de los dos** falló:

1. `afipAuth.getAccessTicket(empresaId)` — prueba que el certificado, la clave y
   la delegación del servicio funcionan;
2. `afipService.getLastVoucher(pv, 6, empresaId)` → `FECompUltimoAutorizado` —
   prueba que el punto de venta existe. **No consume numeración y no emite
   nada.**

Fallos: `400 ErrorDeNegocio` con el texto de AFIP traducido a castellano. Se
guarda la evidencia **también cuando falla** (`resultado: "error"`), porque
«probé y no anduvo» es un estado del checklist, no la ausencia de uno.

### `POST /api/afip/setup` — **modificada**

`config.editar`. Se conservan las cinco validaciones que ya tiene y **la guarda de
la cadena vacía de `afip.js:132-141` no se toca** (supuesto 8, FR-075). Se le
agregan:

| | |
|---|---|
| **Pareja cert-clave** | Se firma un blob de prueba con la clave y se verifica con la clave pública del certificado. Hoy se validan por separado y el error aparece recién al firmar el TRA, como «Error al firmar el ticket de acceso» (A7, FR-087) |
| **CUIT del certificado** | Se compara contra `afip_cuit`. El dato ya sale de `GET /afip/cert-info:62` y la pantalla ya lo muestra: nadie los compara (FR-088) |
| **Punto de venta** | Se valida contra AFIP con `FECompUltimoAutorizado` antes de guardar (PENDIENTE N11, FR-091) |
| **El bloqueo del pase a producción** | Si el cambio lleva `environment` de algo que no es `production` **a** `production` y el paso 4 no está cumplido → `400 { error: 'CIRCUITO_NO_VERIFICADO' }` con qué hacer |

**El bloqueo es solo sobre la transición.** No toca `POST /api/sales/:id/facturar`:
una empresa que ya está en producción sigue facturando. Y el paso 4 se cumple con
la verificación **o** con tener al menos un `afip_cae` en `sales` — decisión 11
del plan y ajuste 3.

### `GET /api/afip/status` — **modificada (rompe)**

`config.ver`. Deja de ser «probar la conexión». `FEDummy` **no lleva `Auth`**:
contesta si los servidores de ARCA están arriba, y responde OK con el certificado
vencido, con la clave equivocada o sin ningún certificado cargado (A5).

```json
{ "ok": true, "data": {
    "servidores_afip": { "AppServer": "OK", "DbServer": "OK", "AuthServer": "OK" },
    "verificacion": { "resultado": "ok", "verificado_en": "…", "ambiente": "homologation" },
    "ambiente": "homologation" } }
```

La pantalla dibuja **dos cosas distintas**: «los servidores de ARCA responden»
(que es lo que `FEDummy` dice) y «la facturación de esta empresa está verificada»
(que sale de la evidencia). **El banner verde no puede salir de `FEDummy`**
(FR-080). Y el bug de lectura de `Settings.jsx:82` —que hace
`setAfipStatus(res.data)` sobre `{ ok, data }` y después evalúa
`afipStatus.error`, que en una respuesta exitosa no existe nunca— se corrige acá.

En homologación, el banner dice que **los comprobantes no tienen validez fiscal**
(FR-081).

### `POST /api/afip/invoice` — **se borra**

Emite un comprobante fiscal real con `ventas.crear` —que tiene el rol
`vendedor`—, con `type`, `amount` y `pv` del cuerpo, sin crear ninguna `Sale`:
es el «CAE huérfano» que `POST /api/sales/:id/facturar` existe para eliminar. No
lo llama el frontend (PENDIENTE N12, decisión 12 del plan).

Queda una guardia estática: **ninguna ruta fuera de `routes/sales.js` puede
llamar a `afipService.createVoucher`**.

### `DELETE /api/afip/vinculacion` — **nueva**

`config.editar`. Es el «Desvincular AFIP» que dibuja la maqueta (`:778-784`,
FR-098). Borra `afip_cert`, `afip_key`, `afip_pv`, `afip_environment` y
`afip_verificacion`, en transacción, e invalida el ticket WSAA. **No toca
`afip_cuit`** —es un dato de la empresa, no una credencial— y **no toca ninguna
venta ya facturada**. La confirmación de la pantalla dice qué se pierde: «vas a
tener que volver a subir el certificado y la clave, y la clave no se puede
recuperar de acá».

### `PUT /api/settings/:key` — **modificada**

`config.editar`. Hoy rechaza las tres claves de `SETTINGS_SECRETOS`. Pasa a
rechazar también `SETTINGS_DE_SOLO_LECTURA = ['afip_environment', 'afip_pv',
'afip_verificacion']` (FR-072, decisión 10 del plan), con el motivo en el
mensaje:

```json
{ "ok": false, "error": "El ambiente y el punto de venta se cambian desde
  Ajustes → Facturación, que valida el punto de venta contra AFIP y renueva el
  ticket de acceso." }
```

Sin esto, un `PUT /api/settings/afip_environment` con `"production"` cambia el
ambiente **dejando cacheado en memoria el ticket WSAA emitido contra
homologación**, y saltea el bloqueo del pase a producción entero.

### `GET /api/settings` y `GET /api/settings/:key` — **ya están cerradas**

`01fc77d`. No se tocan. Lo que se agrega es la **verificación ejecutada**: un test
de integración que siembra un `afip_key` y afirma que la cadena `-----BEGIN` **no
aparece en el cuerpo de la respuesta** (FR-074). Es la única forma de que la
afirmación sea sobre lo que sale por el cable y no sobre lo que el componente
decide leer.

---

## Equipo

### `GET /api/auth/invite/:token` — **se arregla el montaje**

**Público, sin sesión.** Hoy responde 404 siempre (montaje) y, con el montaje
arreglado en su lugar actual, respondería 401 (orden). Contrato sin cambios:
devuelve `email`, `empresa.name`, `role` y `expires_at`.

### `POST /api/auth/accept-invite/:token` — **se arregla el montaje**

**Autenticado y sin empresa** (`authSinEmpresa`). Hoy responde 404 siempre; con
el montaje arreglado en su lugar actual respondería **403 `NO_EMPRESA`**, que es
la situación exacta de todo invitado. Contrato sin cambios salvo los mensajes:
los tres casos —token inexistente, vencido, ya usado— **se distinguen** (FR-102).
Hoy los tres dicen lo mismo.

Y una regla nueva: **una invitación revocada no reactiva a un miembro
desactivado** (PENDIENTE N15). Hoy `findOrCreate` + `update({ is_active: true,
role })` (`auth.js:38-40`) hace que un mail de hace tres meses devuelva el acceso
—y a veces con más rol— a alguien a quien se desactivó a propósito.

### `POST /api/empresas/:empresaId/invitar` — sin cambios en el servidor

Ya devuelve `email_enviado` y el `message` que dice qué hacer. **La pantalla los
tira** (`Team.jsx:85`, `toast.success('Invitación enviada')` incondicional). Lo
único que cambia del lado del servidor es que la respuesta incluye el `enlace` de
invitación armado, para que la pantalla lo pueda mostrar y copiar cuando el mail
no salió (FR-106).

`services/email.js` **no se toca** salvo la URL del enlace (supuesto 7): pasa de
`${frontendUrl}/accept-invite/${token}` —una ruta que `App.jsx` no atiende— a
`${frontendUrl}/?invite=${token}`, que es el mecanismo que la aplicación **ya
tiene** (`App.jsx:132-138`).

> Alternativa descartada: agregar una `<Route path="/accept-invite/:token">`,
> **porque** el `<Routes>` vive adentro del shell autenticado, que exige contexto
> de empresa y desloguea con `contextError` — justo lo que un invitado no tiene—,
> y porque sumaría una decimonovena ruta contra FR-004.

### `POST /api/empresas/invitaciones/:token/re-enviar` — **modificada**

`equipo.invitar`. Se le agregan `requireEmpresa` y el `where` con `empresa_id`:
hoy busca el token **sin acotar a la empresa** y hace `include` de `Empresa` sin
filtrar (E6, FR-114). Y **pasa a tener llamador**: `services/api.js` no declara el
helper y la pantalla no tiene botón (FR-107).

### `GET /api/empresas/:empresaId/usuarios` — **modificada (rompe)**

`equipo.ver`. El `include` de `Usuario` gana `attributes: ['id','nombre','email']`
—hoy devuelve la fila entera, con `auth0_sub` y `es_superadmin` (E7, FR-115)—.
Contrastar con `:633`, que ya lo hace bien para el invitador.

Gana además, por miembro: `ultimo_acceso` (de `sesiones.vista_en`, el máximo) y
`sesiones_abiertas`. Un miembro que nunca entró manda `ultimo_acceso: null` y la
pantalla dice «nunca entró» — **no una fecha vacía ni «Invalid Date»** (FR-122).

### `PUT /api/empresas/usuarios/:id` — **modificada (rompe el permiso)**

De `config.editar` a **`equipo.editar`** (PENDIENTE N9, FR-116). Mismo alcance
efectivo: solo `admin`. Se le agregan las dos reglas de `utils/equipo.js`:

| Caso | Respuesta |
|---|---|
| Es el **último admin activo** y se lo degrada o desactiva | `400 { error: 'ULTIMO_ADMIN' }` con el motivo |
| Es **uno mismo** (cambiar el propio rol, o desactivarse) | `400 { error: 'NO_TE_PODES_TOCAR' }` |
| `role` fuera del catálogo | `400`, con la lista de roles válidos |

La misma función pura la usa la pantalla para deshabilitar el `Select` **con su
explicación** (FR-111). Hoy el `Select` se dibuja en todas las filas, incluida la
propia, sin `disabled` y sin confirmación.

Y al desactivar (`is_active: false`), **las invitaciones `pending` de ese email
pasan a `revoked`** (PENDIENTE N15).

### `POST /api/empresas/:empresaId/usuarios` — **se borra**

Incorpora por `auth0_sub` **sin invitación ni consentimiento**, no valida el rol
contra el catálogo —`role` es `STRING(20)` libre y un rol mal escrito crea un
miembro con cero permisos, sin aviso— y **no lo usa nadie**: ni la UI ni
`services/api.js` (E11, PENDIENTE N13). Si hace falta incorporar a alguien sin
mail, el camino es el enlace de invitación copiado a mano (FR-106).

### `GET /api/empresas/:empresaId/sesiones` — **nueva**

`equipo.ver` + `requireEmpresaPropia`. Las sesiones de los miembros **activos** de
la empresa.

```json
{ "ok": true, "data": [
  { "id": 4, "usuario_id": 7, "nombre": "Ana", "dispositivo": "computadora",
    "ip": "190.x.x.x", "iniciada_en": "…", "vista_en": "…",
    "es_este_dispositivo": true }
] }
```

- `dispositivo` sale de `utils/dispositivo.js` a partir del user-agent crudo. Es
  una **función pura**: se puede corregir sin migrar nada.
- `es_este_dispositivo` compara contra el `X-Sesion-Id` del propio request. Es el
  badge «Este dispositivo» del legacy (`legacy:10044-10061`).
- Solo sesiones abiertas (`cerrada_en IS NULL`). Las cerradas no se listan: una
  lista de sesiones muertas no contesta ninguna pregunta.

**El aislamiento no sale de un `empresa_id` en la tabla** —`sesiones` no lo tiene,
decisión 3 del plan— sino de la membresía:
`usuario_id IN (SELECT usuario_id FROM usuario_empresas WHERE empresa_id = :empresaId AND is_active = true)`.

### `DELETE /api/empresas/sesiones/:id` — **nueva**

`equipo.editar`. Marca `cerrada_en = NOW()` y `cerrada_por`. Una sesión de alguien
que no es miembro de la empresa de la sesión → **404**, no 403.

⚠ **Cierra esa sesión en todas las empresas a las que esa persona tenga acceso**,
porque una sesión es de un dispositivo y no de una empresa. La confirmación de la
pantalla lo dice con esas palabras (decisión 3 del plan).

### `DELETE /api/empresas/sesiones` — **nueva**

`equipo.ver`. **«Cerrar todas menos esta», de las propias.** Cualquiera puede
cerrar sus propias sesiones; cerrar las de otro es el endpoint de arriba y pide
`equipo.editar`. Nunca cierra la del `X-Sesion-Id` que viene en el request: si lo
hiciera, la respuesta llegaría a un navegador que ya está deslogueado.

---

## Resumen de permisos que cambian

| Ruta | Hoy | Después | Por qué |
|---|---|---|---|
| `PUT /api/empresas/usuarios/:id` | `config.editar` | **`equipo.editar`** (nuevo, solo `admin`) | «Editar la configuración de la empresa» y «cambiar el rol de una persona» no son lo mismo. Mismo alcance efectivo |
| `GET /api/dashboard/kpis` | `dashboard.ver` | `dashboard.ver`, y **la respuesta se recorta** por `caja.ver`, `clientes.ver`, `proveedores.ver` y `gastos.ver` | Un vendedor no puede ver el saldo de caja por su pantalla y sí por el Panel |
| `GET /api/alerts` | `stock.ver` | **no existe** | Un aviso, una fuente |
| `POST /api/afip/invoice` | `ventas.crear` | **no existe** | Un cajero podía emitir un comprobante fiscal sin venta |
| `POST /api/afip/verificar` | — | `config.editar` | Nueva |
| `DELETE /api/afip/vinculacion` | — | `config.editar` | Nueva |
| `GET /api/empresas/:id/sesiones` | — | `equipo.ver` | Nueva |
| `DELETE /api/empresas/sesiones/:id` | — | `equipo.editar` | Nueva |
| `DELETE /api/empresas/sesiones` | — | `equipo.ver` | Nueva. Son las propias |

`permisosDeRutas.test.js` mantiene `DEUDA_DE_PERMISOS` **vacía** y sube con estos
cambios en el mismo corte que cada uno.
