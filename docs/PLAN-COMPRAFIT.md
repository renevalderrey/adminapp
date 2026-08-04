# Plan · Dejar AdminApp listo para Comprafit

**Fecha:** 1 de agosto de 2026
**Objetivo:** que Comprafit pueda reemplazar su sistema viejo por AdminApp sin
perder nada de lo que hacía, con el rediseño aplicado, y sin ver una sola
pantalla a medio terminar.

---

## El norte

> **Comprafit abre AdminApp un lunes a la mañana y hace su semana completa sin
> volver al sistema viejo ni una vez.**

Todo lo que sigue se mide contra eso. Una pantalla que existe pero que no
resuelve el paso completo del trabajo no cuenta como hecha.

---

## 1 · Quién ve qué

Dos audiencias con dos productos distintos sobre el mismo código.

### Lo que ve un cliente

Lo que ya tenía en el sistema viejo, más las dos cosas por las que migra:

| Pantalla | Estado |
|---|---|
| Punto de venta | del legacy |
| Historial de ventas | del legacy |
| Inventario (con precios masivos y deshacer) | del legacy |
| Faltantes | del legacy |
| Comparar proveedores | del legacy |
| Proveedores (cuentas corrientes) | del legacy |
| Órdenes de compra | del legacy |
| Gastos (fijos y variables) | del legacy |
| Panel de control (BEP e indicadores) | del legacy |
| Equipo | del legacy |
| **Facturación AFIP** | **nuevo · es la razón de migrar** |
| **TiendaNube** | **nuevo · pedido explícitamente** |
| Suscripción | de plataforma · ver nota |

> **Nota sobre Suscripción.** No es del legacy, pero es la cuenta del cliente:
> si no la ve, no puede saber hasta cuándo tiene el servicio ni renovarlo. Se
> deja visible. Si preferís ocultarla hasta que haya pasarela de pago, es un
> cambio de una línea.

### Lo que ve solo el superadmin

Grupo **«Nuevas funcionalidades»** al final de la barra lateral:

| Pantalla | Por qué no se libera todavía |
|---|---|
| Clientes y cuenta corriente | Funciona, pero el legacy no lo tenía: liberarlo es una decisión comercial, no técnica |
| Recetas y fórmulas | Idem |
| Producción | Idem |
| Flujo de caja | Idem |
| Impuestos (monotributo) | Idem |
| Reportes | Idem |

Liberar cualquiera de estas es cambiar una lista, no escribir código.

---

## 2 · Cómo se implementa el gateo

Hoy conviven dos mecanismos; se agrega un tercero. **Son ortogonales y se
aplican en este orden:**

| Gate | Alcance | Dónde vive |
|---|---|---|
| `permission` | Por usuario dentro de su empresa | `RolPermiso` / `UsuarioPermiso` |
| `modulo` | Por empresa | `empresa.settings.enabled_modules` |
| **`soloSuperadmin`** | **Por plataforma** | **`usuario.es_superadmin` (nuevo)** |

El tercero es el más restrictivo y se evalúa primero: si un ítem es
`soloSuperadmin` y el usuario no lo es, no existe — ni en la barra, ni como
ruta, ni como endpoint.

**El gateo se aplica en los tres lados o no sirve:**

1. **Barra lateral** — el ítem no se dibuja.
2. **Ruta** — `RouteGuard` redirige; entrar por URL a mano no alcanza.
3. **API** — middleware `requireSuperadmin` en los endpoints de esos módulos.

Ocultar solo en el menú es cosmética: cualquiera que abra las herramientas del
navegador ve las rutas.

---

## 3 · Superadmin multi-empresa

### Qué se agrega

- Columna `es_superadmin` en `usuarios`, en `false` por defecto.
- **Solo se activa por script.** No hay endpoint que la escriba: un endpoint
  que otorga superadmin es una escalada de privilegios esperando a que alguien
  encuentre el IDOR.
- `GET /api/empresas/mi-contexto` devuelve **todas** las empresas si el usuario
  es superadmin, en vez de solo aquellas donde tiene membresía.
- `loadEmpresaContext` acepta `X-Empresa-Id` de cualquier empresa si el usuario
  es superadmin. Para el resto sigue exigiendo membresía activa.

### Qué NO se toca

**El scoping por empresa se queda exactamente como está.** El superadmin opera
sobre **una empresa por vez**, la que tiene seleccionada, y cada consulta sigue
filtrando por `req.empresaId`. No hay ninguna consulta nueva que cruce
empresas.

Esto importa: los ocho endpoints con fuga que aparecieron el 31/7 estaban
justamente en el borde entre «qué empresa puedo elegir» y «qué datos veo». El
cambio ensancha **lo primero** para un único usuario marcado en la base, y deja
**lo segundo** intacto.

### Rastro

Cada request donde un superadmin opera sobre una empresa en la que no tiene
membresía se registra con `superadmin: true` y el `empresaId`. Con el
`requestId` que ya existe, queda la traza completa de qué se tocó y cuándo.

### Invisibilidad

La pantalla de Equipo lista filas de `UsuarioEmpresa`. Como el superadmin no
tiene membresía, no aparece: sale gratis, sin filtros especiales que después
alguien pueda romper.

### Guardias

- Test: un usuario **no** superadmin que manda `X-Empresa-Id` de otra empresa
  sigue cayendo en su empresa por defecto (ya existe, no debe romperse).
- Test: un superadmin sí puede seleccionarla.
- Test: `es_superadmin` no se puede setear por ningún endpoint.
- Test estático: ningún endpoint nuevo consulta sin `empresa_id`.

---

## 4 · La pasada fina, pantalla por pantalla

Cada una tiene dos columnas: **diseño** (llevarla a la maqueta) y **función**
(cerrar lo que el legacy hacía y acá todavía no).

El orden es por uso real: lo que Comprafit toca todos los días primero.

### 4.1 · Punto de venta · ✔ hecho

Hito 5, en `docs/specs/011-punto-de-venta/`. Cuatro cortes: `6d8f99a`,
`10b5e60`, `b215fc3` y `6ebe393`.

**Diseño.** Es la pantalla más lejos de la maqueta. Dos columnas: catálogo a la
izquierda con búsqueda y filtros, ticket fijo a la derecha de 400px con su
propio encabezado y el pie de cobro. Botones de medio de pago como segmentos,
no como tres botones sueltos.

**Función.** Lo del legacy ya está (precio manual, vuelto, medio de pago por
ítem, AFIP). Falta:
- Atajos de teclado: buscar con `/`, cobrar con `Enter`, limpiar con `Esc`. En
  un mostrador con cola, el mouse es el cuello de botella.
- Foco automático en la búsqueda al abrir y después de cada venta.

**Dos cosas salieron distintas de lo que dice acá arriba**, y quedan escritas
porque el motivo sigue valiendo:

- **`Enter` no cobra.** Un lector de código de barras escribe en el campo
  enfocado y termina con `Enter`: cada escaneo habría cobrado la venta. `Enter`
  agrega el primer resultado y se cobra con `Ctrl/⌘+Enter`, que es lo que la
  maqueta ya dibujaba.
- **Los tres segmentos no son medios de pago, son niveles de precio.** El medio
  exacto —transferencia, QR, débito— se elige adentro del segmento de efectivo,
  que es lo que permite que el vuelto aparezca solo con billetes de verdad y que
  el efectivo del día deje de incluir plata que entró por CBU.

### 4.2 · Historial de ventas

**Diseño.** Es la pantalla que la maqueta dibuja completa: tabla en grid con
columnas `80px 116px 132px 1fr 116px 128px 128px`, encabezado en `surface-2`,
hora y CAE en monoespaciada, tipo y estado como badges, acciones de 29px al
final. Fila clickeable que abre panel lateral con el detalle.

**Función.**
- Filtros de fecha, sucursal y tipo de comprobante (hoy solo hay fecha).
- Exportar el listado.
- Reintentar la facturación de una venta que quedó sin CAE — el endpoint
  existe, el botón no.

### 4.3 · Inventario

**Diseño.** Tabla en grid. Edición en panel lateral en vez de modal: se edita
un producto mirando la lista, no tapándola.

**Función — es la pantalla con más deuda contra el legacy:**
- **Importar pegando texto.** El legacy lo tenía y es como llega media lista.
- **Exportar a Excel y PDF** desde la propia pantalla (hoy solo desde Reportes,
  que va a quedar oculto para el cliente).
- **Comparar sucursales lado a lado.** Hoy hay pestañas por sucursal; el legacy
  mostraba las dos columnas juntas, que es como se decide una transferencia.
- **Historial de costos con pantalla.** La API lo guarda desde siempre y nadie
  puede verlo.
- **Transferencias entre sucursales.** El endpoint existe y está testeado; la
  pantalla es un formulario mínimo dentro de un modal.

### 4.4 · Proveedores (cuentas corrientes)

**Diseño.** Lista de proveedores a la izquierda, cuenta del seleccionado a la
derecha. Saldo en grande y en mono.

**Función.**
- **Facturas con enlace a Drive.** El modelo `SupplierDocument` existe y el
  endpoint también; no hay UI. El legacy lo tenía y es donde el contador busca.
- **Exportar el asiento contable.** Del legacy, no está.
- Badges de deuda en la lista, para ver de un vistazo a quién se le debe.

### 4.5 · Órdenes de compra

**Diseño.** Tabla en grid, detalle en panel lateral.
**Función.** Completa (recepción parcial, anulación, WhatsApp). Solo diseño.

### 4.6 · Faltantes y Comparador

**Diseño.** Ya nacieron con el sistema nuevo. Ajustes menores: llevar la lista
de faltantes a grid y unificar los botones de filtro a 36px.
**Función.** Completa.

### 4.7 · Gastos

**Diseño.** Tarjetas de total por sucursal arriba, tabla en grid abajo. Las dos
solapas con el estilo de segmentos de la maqueta.
**Función.** Completa (fijos y variables).

### 4.8 · Panel de control

**Diseño.** Cuatro tarjetas de indicador con el sparkline de barras de la
maqueta, y las tres secciones: «Requiere tu atención», «Actividad reciente»,
«Accesos rápidos».
**Función.** El BEP ya está y corregido. Sumar «Requiere tu atención», que hoy
no existe: faltantes, ventas sin CAE, vencimientos de stock.

### 4.9 · Facturación AFIP (Ajustes)

**Diseño.** La maqueta tiene esta pantalla resuelta con dos bloques: **«Puesta
en marcha»** (checklist de lo que falta configurar) y **«Datos de
facturación»**.

**Función.** El checklist de puesta en marcha es nuevo y es lo que evita la
llamada «no puedo facturar»: CUIT cargado, certificado subido y vigente, punto
de venta declarado, prueba en homologación hecha.

### 4.10 · TiendaNube

**No tiene pantalla.** Hoy la vinculación vive escondida en Ajustes y los
endpoints de productos, mapeo y sincronización de stock no tienen interfaz
ninguna. Como el cliente sí lo va a ver, hace falta:
- Estado de la conexión y botón de vincular.
- Mapeo de productos de TiendaNube contra los del sistema.
- Sincronización de stock, con el resultado de la última corrida.

### 4.11 · Equipo

**Diseño.** Tabla en grid.
**Función.** **Sesiones activas** — el legacy las tenía y no están. Requiere
decidir si se listan sesiones de Auth0 o se registra el último acceso por
usuario, que es más simple y cubre el 90 % del caso.

### 4.12 · Las que quedan ocultas

Clientes, Recetas, Producción, Caja, Impuestos y Reportes **no llevan pasada de
diseño en esta etapa**. Ya tienen el marco y la tipografía del sistema de la
pasada anterior; la pasada fina se hace cuando se liberen.

---

## 5 · Metodología: SDD con agentes

El repositorio ya tiene la estructura (`docs/specs/NNN-nombre/` con `spec.md`,
`plan.md`, `data-model.md`, `tasks.md`, `contracts/`). Lo que falta es que
**siempre** se use.

### Los agentes

En `.claude/agents/`:

| Agente | Qué hace | Qué produce |
|---|---|---|
| `sdd-spec` | Convierte un pedido en una especificación: qué problema resuelve, qué NO cubre, criterios de aceptación | `spec.md` |
| `sdd-plan` | De la spec al diseño técnico: modelo de datos, contratos de API, decisiones y sus alternativas descartadas | `plan.md`, `data-model.md`, `contracts/` |
| `sdd-tasks` | Del plan a tareas ejecutables, cada una con su verificación | `tasks.md` |
| `sdd-implement` | Ejecuta una tarea: código y tests en el mismo paso | commits |
| `sdd-verify` | Verifica **contra la spec**, no contra el código. Adversarial: busca en qué caso el criterio de aceptación no se cumple | informe |

### La regla

**Ninguna funcionalidad nueva sin spec.** No por ceremonia: las cinco funciones
del sistema viejo que se reconstruyeron esta semana salieron bien porque antes
se leyó qué hacía cada una y por qué. Las que fallaron históricamente —el BEP
que recomendaba precios con pérdida, el paywall eludible— fallaron por
implementar sin definir.

`sdd-verify` es el que más importa. Es el que hubiera atrapado que
`sendEmail` devolvía `ok: true` sin haber enviado nada.

### Comando

`/sdd <nombre-de-la-feature>` corre el ciclo completo y se detiene después de
la spec para que la revises. Nada se implementa sin ese visto bueno.

---

## 6 · Orden de ejecución

| # | Hito | Por qué en ese orden |
|---|---|---|
| ✔ 1 | Superadmin y gateo de módulos | Sin esto, cualquier pantalla que se toque después hay que revisarla de nuevo para ver quién la ve |
| ✔ 2 | Agentes SDD y `/sdd` | Para que los hitos siguientes se hagan con el método, no a mano |
| ✔ 3 | Historial de ventas | La pantalla que la maqueta dibuja completa: fija el patrón de tabla que copian las demás |
| ✔ 4 | Inventario | La de más deuda funcional |
| ✔ 5 | Punto de venta | La de más uso diario |
| 6 | Proveedores y Órdenes de compra | |
| 7 | TiendaNube | Pantalla nueva completa |
| 8 | Panel, Gastos, Equipo, Ajustes AFIP | |
| 9 | Repaso de coherencia | Recorrer las doce pantallas juntas y corregir lo que se desalineó |

---

## 7 · Pendiente anotado

### Migración de los datos de Comprafit

**Bloqueado hasta tener acceso al hosting de Comprafit.**

Cuando esté:

1. **Rotar primero** la contraseña de la base y el token de aplicación del
   hosting viejo: están en el historial de git.
   Ver [OPERACION.md](OPERACION.md#rotar-las-credenciales-del-hosting-legacy).
2. Crear la empresa Comprafit y su punto de venta.
3. `PHP_API_URL` y `PHP_API_TOKEN` (el nuevo) en el `.env`.
4. Simulación: `npm --prefix apps/api run migrar:legacy -- --empresa=<id>`.
5. Revisar el resumen y aplicar con `--confirmar`.

Sin el token, el script cae al HTML del repositorio, que tiene los datos
**semilla** (55 productos, 392 filas de stock) y no los de hoy. Para una demo
alcanza; para migrar de verdad, no.

### Decisiones que siguen abiertas

Ninguna de estas bloquea el plan, pero conviene resolverlas antes de cobrarle:

- Qué planes existen, con qué precios y en qué moneda.
- Qué pasarela (Stripe no cobra en pesos; el camino es Mercado Pago).
- Términos y Condiciones y Política de Privacidad — requisito de cualquier
  pasarela.
- Notas de crédito de AFIP: anular una venta con CAE deja el comprobante
  vigente ante ARCA.
- Probar el circuito AFIP completo en homologación. **Nunca se hizo.**
