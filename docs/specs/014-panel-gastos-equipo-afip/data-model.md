# Modelo de datos: Panel, Gastos, Equipo y Ajustes AFIP

Complementa a [plan.md](./plan.md).

**Una tabla nueva, una migración de datos, un permiso nuevo y una fila de
`settings` que nace.** Ninguna tabla existente cambia de forma: lo único que se
toca de una columna que ya existe es el `defaultValue` de `fixed_expenses.group`,
que vive en el modelo y no en el esquema.

---

## Lo que NO se hace, y por qué va primero

### `fixed_expenses.group` no se borra

La columna es el resto de la migración del legacy (`scripts/migrar-legacy.js:379`
escribe `'gf1'` y `'gf2'`). Después de este hito **nadie la lee y nadie la
escribe**: el agrupado sale de `punto_de_venta_id` (decisión 6 del plan) y el
cuerpo del request no la puede tocar (FR-031).

Se le saca el `defaultValue: 'gf1'` del **modelo**; el `DEFAULT` de la base se
queda. Borrar la columna no es reversible y no gana nada, y es la misma decisión
que tomó la 013 con `products.tiendanube_variant_id`.

⚠ La columna es `STRING(10) NOT NULL`. Sin `defaultValue` en el modelo, un
`FixedExpense.create({...})` sin `group` **usa el `DEFAULT` de la base** —que
sigue siendo `'gf1'`— y no falla. Eso es lo que se quiere: la columna queda como
dato muerto con un valor cualquiera, no como una fuente de `NOT NULL violation`
el día del deploy.

### No se crea una tabla de sesiones de Auth0

No hay Management API en el repositorio (supuesto 13 de la spec). Lo que se
guarda es lo que Favalio sabe: qué dispositivos pidieron datos, cuándo, y cuáles
están cerrados. Ver el techo escrito en la decisión 2 del plan.

### No se crea `verificaciones_afip`

La evidencia de la verificación es un **estado**, no una serie: una fila de
`settings` por empresa alcanza (decisión 11 del plan). El día que haga falta el
historial, se convierte en tabla sin cambiarle el contrato a la pantalla.

### No se agrega `is_default` a `puntos_de_venta`

La decisión 4 del usuario habla de «la sucursal por defecto de cada empresa», y
**esa columna no existe**. No se crea: la regla ya está escrita, es pura, está
testeada y la usan tres consumidores —`elegirPorDefecto` de
`utils/sucursalDeStock.js:59-69`, con sus tres escalones: `code = 'principal'`,
el activo de menor id, el de menor id—. Agregar una columna sería una cuarta
respuesta a una pregunta que ya tiene una.

### No se agrega `afip_environment` a `sales`

Sería lo correcto para saber contra qué ambiente se obtuvo cada CAE, y la
decisión 11 lo roza (el historial de CAE satisface el paso 4 del checklist sin
distinguir ambiente). **No entra acá**: es una columna nueva en la tabla más
caliente del sistema, y la pregunta que contesta —«¿este CAE fue de prueba?»— no
la hace ninguna pantalla de este hito. Queda anotado.

---

## Tabla nueva: `sesiones`

Una fila por **(usuario, dispositivo)**. No por empresa: ver la decisión 3 del
plan.

| Columna | Tipo | Nulo | Qué |
|---|---|---|---|
| `id` | `SERIAL` PK | no | |
| `usuario_id` | `INTEGER` FK → `usuarios(id)` `ON DELETE CASCADE` | no | De quién es el dispositivo |
| `dispositivo` | `VARCHAR(64)` | no | El UUID que el navegador genera una vez y guarda en `localStorage`. Llega en `X-Sesion-Id` |
| `user_agent` | `TEXT` | sí | Crudo. La etiqueta («computadora» / «celular») la deriva `utils/dispositivo.js`, que es una función pura y se puede corregir sin migrar nada |
| `ip` | `VARCHAR(45)` | sí | 45 = IPv6 con notación mixta. Es lo que contesta «desde dónde» de la US19 |
| `iniciada_en` | `TIMESTAMPTZ` | no | `DEFAULT NOW()` |
| `vista_en` | `TIMESTAMPTZ` | no | El último acceso. **Se actualiza como mucho cada 5 minutos** (FR-124) |
| `cerrada_en` | `TIMESTAMPTZ` | sí | `NULL` = abierta. Es lo único que el middleware mira para cortar |
| `cerrada_por` | `INTEGER` FK → `usuarios(id)` `ON DELETE SET NULL` | sí | Quién la cerró. Sin esto, «me cerraron la sesión» no tiene respuesta |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | no | |

### Índices

| Índice | Para qué |
|---|---|
| `UNIQUE (usuario_id, dispositivo)` | **Es el índice del camino caliente**: el middleware busca por acá en cada request. Y es lo que hace que el `INSERT` de una sesión nueva sea idempotente ante dos requests en paralelo del mismo navegador |
| `(usuario_id)` | El listado por miembro. Lo cubre el único de arriba por prefijo, así que **no se crea uno aparte** |
| `(vista_en)` | Para poder barrer las sesiones viejas algún día. **No se crea todavía**: un índice que no usa ninguna consulta es peso de escritura en la tabla que más se escribe |

⚠ **El `UNIQUE` es el que sostiene la garantía y hay que probarlo ejecutándolo.**
Dos requests simultáneos del mismo navegador —el Panel hace varios al montar—
entran los dos por «no existe» y los dos intentan insertar. El que pierde tiene
que atrapar `SequelizeUniqueConstraintError` y releer, igual que la idempotencia
de `POST /api/sales`. **Un test secuencial no toca esa mitad nunca**
(`CONVENCIONES.md`, cuarto nivel).

### Retención

No se borra nada en esta funcionalidad. Una fila por dispositivo por persona: son
unidades por empresa, no miles. Si algún día crece, el barrido es
`DELETE … WHERE vista_en < NOW() - INTERVAL '180 days'` y ahí sí hace falta el
índice de `vista_en`.

### Reversibilidad

`down`: `DROP TABLE sesiones`. Sin ambigüedad — la tabla nace acá y nada más
depende de ella. Se verifica con `scripts/verificar-reversibilidad.js`, que la
aplica, la revierte y compara el esquema columna por columna.

---

## Migración de datos: los gastos fijos sin sucursal

`20260813-gastos-fijos-a-su-sucursal.js`. Es la decisión 4 del usuario, y **mueve
datos de un cliente**: sigue el molde de `20260809-unico-de-insumo-por-receta.js`
entero — archivo, informe fila por fila, verificación adentro de la transacción y
`down` que restaura.

### Qué se mueve

Toda fila de `fixed_expenses` con `punto_de_venta_id IS NULL` pasa a tener el id
de la **sucursal por defecto de su empresa**, calculada con `elegirPorDefecto` de
`utils/sucursalDeStock.js` — la misma función que ya usan las ventas, el import
y TiendaNube. La migración la **importa**, no la reescribe en SQL: el módulo
requiere los modelos adentro de cada función, así que se puede cargar sin base.

**Las empresas sin ninguna sucursal no se tocan.** No es un error: son gastos que
se quedan en `NULL` y que la pantalla dibuja en «General», que existe desde el
corte anterior. Se informan aparte.

### Qué NO se mueve, y por qué importa

**El `group` no se mira.** Una fila con `group = 'gf2'` y sin sucursal va a la
sucursal por defecto igual que una con `'gf1'`. La alternativa —mapear `gf1` y
`gf2` a la primera y la segunda sucursal— **solo es cierta para Comprafit**
(`legacy:3011`, `:3017`: `gf1` era Ortiz de Ocampo y `gf2` era 25 de Mayo), y una
migración que adivina no puede distinguir esa empresa de otra.

⚠ Consecuencia que hay que decir: **para una empresa con dos sucursales que ya
migró del legacy, esta migración junta los gastos de las dos bajo una sola.** Hoy
esos gastos **no se dibujan en ninguna parte** (hallazgo G1), así que no hay
número que se mueva en pantalla; lo que se mueve es dónde van a aparecer a partir
de ahora. Por eso el informe los lista **uno por uno con su nombre y su importe**:
es lo único que le permite a alguien reasignarlos a mano en cinco minutos.

### El archivo

`fixed_expenses_sin_sucursal`, creada **siempre** —también con cero filas
movidas, por el mismo motivo que la del molde: quien pregunte «¿esta migración me
tocó los gastos?» encuentra una tabla vacía y no un error—.

| Columna | Qué |
|---|---|
| `id` | PK |
| `empresa_id` | |
| `fixed_expense_id` | La fila que se movió |
| `punto_de_venta_id_asignado` | A dónde fue |
| `fila` | `JSONB` con la fila entera antes del cambio, con las fechas **como texto** (`::text`) — el molde documenta por qué: el driver corta los microsegundos al pasar por `Date` y el `down` reinsertaría una fecha distinta |
| `created_at`, `updated_at` | |

### La verificación adentro de la transacción

Lo que esta migración promete es que **ningún total se mueve**: la suma de
`amount` por empresa tiene que ser idéntica antes y después. Se toma una foto en
una `TEMP TABLE … ON COMMIT DROP` antes de tocar nada y se compara antes del
commit. Si difiere, no hay commit.

Es la promesa más fuerte que se puede hacer acá, y es barata: la migración no
crea ni borra filas, solo escribe una columna.

### El informe

Sale **siempre**, con `console.log`, como el del molde (`scripts/migrar.js` corre
con `stdio: 'inherit'`, así que queda en el log del contenedor):

```
[fixed_expenses] 412 gasto(s) fijo(s) leídos en 7 empresa(s).
[fixed_expenses] 9 gasto(s) sin sucursal se asignan a la sucursal por defecto:
[fixed_expenses]   empresa 1 · «Alquiler» $180.000,00 → Ortiz de Ocampo (id 3)
[fixed_expenses]   empresa 1 · «Luz» $42.500,00 → Ortiz de Ocampo (id 3)
[fixed_expenses]   …
[fixed_expenses] ⚠ empresa 5: 2 gasto(s) sin sucursal y la empresa no tiene
[fixed_expenses]   ninguna cargada. Quedan como estaban y se ven en «General».
[fixed_expenses] El total de gastos fijos por empresa no cambió.
[fixed_expenses] Todo lo que se movió quedó en fixed_expenses_sin_sucursal. El down lo restaura.
```

### `down`

`UPDATE fixed_expenses SET punto_de_venta_id = NULL FROM fixed_expenses_sin_sucursal
… WHERE …` y `DROP TABLE`. **Pisa lo que haya pasado después**: si entre el
deploy y el rollback alguien reasignó ese gasto a mano, la reasignación se
pierde. Es para volver atrás minutos después de un deploy, igual que el `down` de
`20260804` y el del molde. Queda escrito en el encabezado.

### La parte pura, y su test

`planificarAsignaciones(gastos, puntosDeVenta)` se exporta y se prueba en
`src/tests/gastosFijosASuSucursal.test.js`, **sin Postgres** — igual que
`planificarFusiones`. Los casos que tienen que estar: empresa sin sucursales,
empresa con una sola, empresa con tres donde una se llama `principal` y no es la
de menor id, gasto que **ya** tiene sucursal (no se toca), y una empresa cuyos
gastos suman con centavos.

### Y `scripts/verificar-reversibilidad.js`

La corre: aplica, revierte, compara el esquema, y vuelve a aplicar. Su función
`sembrar()` tiene que ganar **un gasto fijo sin sucursal** — si no, el `up` no
mueve nada, el `down` no restaura nada y las dos fotos dan iguales por la razón
equivocada. Es el mismo error que el encabezado del script ya documenta para los
ENUM y para la fusión de recetas.

---

## Permiso nuevo: `equipo.editar`

`seedPermissions.js`: un `Permiso` más y una línea en el rol `admin`. **Ningún
otro rol lo recibe** — es exactamente quién puede cambiar roles hoy, porque hoy
pide `config.editar` y `gerente` no lo tiene. El cambio es de **nombre**, no de
alcance (PENDIENTE N9).

`seedPermissions` hace `findOrCreate` de cada permiso y reasigna los del rol, así
que corre solo al arrancar: **no hace falta migración**. Lo que sí hace falta es
que `permisosDeRutas.test.js` cambie el permiso esperado de
`PUT /api/empresas/usuarios/:id`, en el mismo corte.

---

## Fila nueva de `settings`: `afip_verificacion`

PK compuesta `(key, empresa_id)`, `value` `JSONB`. No es migración: la fila nace
la primera vez que alguien verifica.

```json
{
  "verificado_en": "2026-08-06T14:20:11.000Z",
  "resultado": "ok",
  "ambiente": "homologation",
  "cuit": "20111111112",
  "pv": 5,
  "ultimo_comprobante": 0,
  "certificado": "sha256:1a2b3c…",
  "usuario_id": 7
}
```

- `certificado` es el `sha256` del PEM del **certificado** —que es público— y
  **nunca** de la clave. Sirve para decir «esto se verificó con otro
  certificado», no para bloquear (decisión 11 del plan).
- La clave entra en `SETTINGS_DE_SOLO_LECTURA`: `PUT /api/settings/:key` la
  rechaza. **La única mano que la escribe es el servidor, después de que AFIP
  contestó.** Un paso de checklist que el cliente puede marcar solo no es un paso
  de checklist.
- **No entra** en `SETTINGS_SECRETOS`: no es secreta y la pantalla la necesita
  para dibujar el checklist.

### Las otras dos filas de `settings` que cambian de estado

| Clave | Hoy | Después |
|---|---|---|
| `fixed_expenses_total` | Default `0`, la lee el simulador, convive con la suma real | **Nadie la lee.** La fila se queda (borrarla no es reversible); una guardia por nombre impide que vuelva a leerse |
| `target_sales` | **La pantalla la lee y nadie la escribe**: el simulador cae al literal 7.000.000 | Se escribe de verdad, desde el campo «Facturación mensual promedio» de Gastos. Sin cargar, el simulador **no simula** |

---

## Entidades que se leen y no cambian

| Entidad | Qué se usa acá |
|---|---|
| `FixedExpense` | `amount` es `DECIMAL(12,2)` y **vuelve como string**: toda suma pasa por `utils/centavos.js`. `punto_de_venta_id` es la **única** fuente del agrupado |
| `Sale` | `is_credit` —el campo que el Panel ignora hoy—, `status`, `date`, `total`, `afip_cae` (que satisface el paso 4 del checklist) |
| `SupplierMovement` | `type` (`deuda`/`pago`): el Panel deja de leer solo `deuda` |
| `CustomerPayment` | `amount`, para el `deuda − pagos` en centavos |
| `Stock` | `quantity`, `min_stock`, `expiration_date`, `punto_de_venta_id`. El `include` de `Product` **pasa a filtrar por empresa** (FR-063) |
| `Empresa` | `timezone` — que el Panel no usa hoy y va a usar en los seis cortes de fecha |
| `UsuarioEmpresa` | `is_active` es el corte real de acceso: `loadEmpresaContext` lo relee en **cada** request. `role` sigue siendo `STRING(20)` libre y **se valida contra el catálogo** en las escrituras (FR-119) |
| `Usuario` | `auth0_sub` y `es_superadmin` **dejan de salir** por `GET /:empresaId/usuarios` (FR-115). El superadmin sigue sin aparecer porque no tiene fila en `usuario_empresas`, sin ningún filtro especial (FR-126) |
| `Invitacion` | `token`, `status`, `expires_at`. Al desactivar a un miembro, sus invitaciones `pending` pasan a `revoked` (PENDIENTE N15) |
| `Setting` | PK `(key, empresa_id)`. `afip_cert` y `afip_key` **siguen en texto plano** y esta funcionalidad no agrega ningún lugar nuevo donde queden en claro (FR-096) |

---

## Restricción de aislamiento, en una línea por tabla

| Tabla | Cómo se aísla |
|---|---|
| `fixed_expenses` | `empresa_id` en todo `where`; el `punto_de_venta_id` del cuerpo pasa por `findScoped(PuntoDeVenta, …)` **antes** de escribir |
| `gastos_variables` | Ídem. Hoy el valor llega como `punto_de_venta_id \|\| null`, que es una de las dos formas que el detector no ve |
| `sesiones` | **No tiene `empresa_id` a propósito.** Toda lectura y todo cierre pasan por `usuario_id IN (SELECT usuario_id FROM usuario_empresas WHERE empresa_id = :empresaId AND is_active = true)`, encapsulado en `sesionesDeLaEmpresa`. Una sesión ajena → 0 filas → 404 |
| `settings` | PK compuesta con `empresa_id`; ya está |
| `stock`, `products` | El padre ya está scopeado; el `include` de `Product` pasa a filtrar también, porque `belongsTo` es la forma que la guardia **no puede ver** |
