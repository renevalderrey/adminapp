# AdminApp · Diagnóstico y plan de análisis

**Fecha:** 30 de julio de 2026
**Alcance:** estado del producto de cara a salir a venta, y plan para auditar
lo que todavía no se auditó.

---

## Cómo leer este documento

Está dividido en dos partes, y la distinción importa:

- **Parte 1 — Diagnóstico verificado.** Hallazgos que se confirmaron leyendo o
  ejecutando el código durante la reestructuración a monorepo. No son
  sospechas.
- **Parte 2 — Plan de análisis.** Las áreas que *todavía no se auditaron*, con
  el método concreto para hacerlo. Acá sí hay hipótesis.

Lo que sigue no es una lista de deseos de refactor. El criterio de corte es una
sola pregunta: **¿esto bloquea cobrarle a un cliente real?**

---

# Parte 1 · Diagnóstico verificado

## 1.1 Lo que está bien

Conviene empezar por acá, porque la base es mejor de lo que sugiere el desorden
superficial.

**El modelo de dominio es sólido y está completo.** 31 modelos Sequelize con
multi-tenancy real de tres niveles: `Empresa` → `UsuarioEmpresa` → `Rol` /
`Permiso`, más `PuntoDeVenta` para multi-sucursal y `Suscripcion` para el
ciclo de vida comercial. Esto no es un CRUD inflado: hay recetas, órdenes de
producción, cuentas corrientes de clientes y proveedores, movimientos de stock,
historial de costos y configuración impositiva. Modelar esto bien es la parte
difícil, y ya está hecha.

**Hay transacciones donde hacen falta.** Se verificó uso de transacciones en
`sales.js` (12), `products.js` (11), `stock.js` (8), `productionService.js` (17)
y `costService.js` (7). En un POS con descuento de stock, esto es la diferencia
entre un sistema confiable y uno que corrompe inventario. Está bien resuelto.

**El sistema de permisos es granular y funciona.** `RolPermiso` con overrides
por usuario (`UsuarioPermiso`), soporte de wildcards (`clientes.*`), y gateo de
módulos por empresa vía `settings.enabled_modules`. Está reflejado en el
frontend con `<Can>` y `RouteGuard`.

**Hay especificaciones escritas.** `docs/specs/` tiene 5 features documentadas
con spec, data-model, plan, tasks y contratos de API. Es más disciplina de la
que sugiere "lo desarrollé sin orden".

**Migraciones versionadas.** 6 migraciones Sequelize, y producción ya evita
`sync({ alter: true })`.

## 1.2 El bloqueante crítico: fuga de datos entre clientes

> **RESUELTO** (30/07/2026). Lo que sigue describe el estado en que se
> encontró el sistema. El detalle de la corrección, con la cobertura endpoint
> por endpoint, está en [AUDITORIA-AISLAMIENTO.md](AUDITORIA-AISLAMIENTO.md).
>
> La auditoría completa encontró **20 endpoints vulnerables**, no los 8 que se
> ven en la tabla de abajo, más tres causas estructurales que no se habían
> detectado en el primer relevamiento:
>
> - La configuración de AFIP era **global**: `settings` tenía `key` como única
>   clave primaria, así que existía una sola fila de certificado, CUIT y
>   entorno para toda la base. Una empresa facturaba con la identidad fiscal
>   de otra.
> - `customerService.getSummary()` agregaba las cuentas por cobrar y por pagar
>   de **todas** las empresas y se las mostraba a cualquier usuario.
> - `POST /api/empresas/:empresaId/invitar` permitía invitarse a uno mismo a
>   otra empresa.

**Este es el único hallazgo que por sí solo impide vender.**

El patrón de autorización tiene un agujero sistémico. `checkPermission(codigo)`
verifica que el usuario tenga el permiso **en su empresa activa**
(`req.empresaId`). Lo que *no* hace —y no puede hacer, porque no conoce la
ruta— es verificar que el recurso identificado por `:id` en la URL pertenezca a
esa empresa.

Las rutas hacen `Model.findByPk(req.params.id)` directo. El resultado: un
usuario autenticado de la empresa A, con permisos normales en su propia
empresa, puede leer y modificar datos de la empresa B enumerando ids.

Confirmado en:

| Archivo | Endpoints afectados | Exposición |
|---|---|---|
| `routes/empresas.js` | `PUT /:id`, `DELETE /:id` | Editar o desactivar la empresa de otro cliente |
| `routes/customers.js` | `GET /:id`, `PUT /:id`, `DELETE /:id`, `GET /:id/debt`, `GET /:id/payments`, `GET /:id/sales` | Leer y modificar la cartera de clientes, deudas y ventas de otro cliente |

Todos corregidos. Ver la tabla completa en
[AUDITORIA-AISLAMIENTO.md](AUDITORIA-AISLAMIENTO.md).

El conteo grueso de scoping por archivo (queries vs. menciones de `empresa_id`)
señala dónde mirar primero:

```
routes/customers.js    7 queries / 1 empresa_id   ← peor ratio, confirmado vulnerable
routes/afip.js         1 query  / 0 empresa_id
routes/taxes.js        1 query  / 0 empresa_id
routes/empresas.js    28 queries / 14 empresa_id  ← corregido parcialmente
routes/products.js    20 queries / 11 empresa_id
routes/suppliers.js   14 queries / 12 empresa_id
```

Es una heurística, no una prueba: un archivo puede delegar el scoping a un
service. Sirve para priorizar, no para concluir.

**Por qué esto es distinto de un bug común.** Un cálculo mal hecho se corrige y
se recalcula. Una fuga entre empresas cliente, una vez que hay dos clientes reales en
la misma base, es un incidente de datos: hay que notificar, y destruye la
confianza que un SaaS de facturación necesita para existir. Tiene que estar
cerrado *antes* del segundo cliente, no después.

## 1.3 Cero cobertura de tests

La suite reportaba verde sin ejecutar un solo test. Tres causas encadenadas:

1. `testMatch` apuntaba a `**/__tests__/**`, un directorio inexistente.
2. `--passWithNoTests` convertía "0 tests" en éxito.
3. `src/tests/setup.js` llamaba `beforeAll()` dentro de un archivo de
   `setupFiles`, donde ese global todavía no existe: habría tirado
   `ReferenceError` apenas corriera algo.

Corregido. La suite pasó de 0 a **119 tests**: smoke tests de arranque,
unitarios de los helpers de scoping, y guardias estáticos que fallan si los
patrones de fuga entre empresas reaparecen.

Pero eso cubre el aislamiento, no el cálculo. La cobertura de **lógica de
negocio sigue siendo 0%** sobre ~9.500 líneas de API. Es el Frente 2.

Para dimensionar el riesgo: el sistema calcula precios con márgenes, punto de
equilibrio, costos de receta, deudas de cuenta corriente e IVA. Un error de
signo o de redondeo en cualquiera de esos caminos produce un número
plausible-pero-incorrecto que nadie detecta hasta que un cliente factura mal.
Ese es exactamente el tipo de fallo que los tests atrapan y la inspección
visual no.

## 1.4 Hallazgos menores ya corregidos

Se arreglaron durante la reestructuración; se listan para que quede registro:

- **`trust proxy` ausente** → el rate limiting estaba efectivamente roto detrás
  del proxy de Render (todos los usuarios contaban como una sola IP).
- **Logos en filesystem efímero** → se perdían en cada deploy, y la ruta
  cruzaba de paquete a un directorio que en producción no existe.
- **`/api/ping` antes del middleware de CORS** → sin cabeceras CORS, con lo
  cual un warm-up desde el navegador quedaba bloqueado.
- **`audience` de Auth0 hardcodeado** en `Login.jsx` mientras `main.jsx` usaba
  la variable de entorno: si diferían, el token salía con audience equivocado.
- **`nginx.conf` con `proxy_pass` a `http://backend:5000`**, hostname de un
  docker-compose eliminado. nginx aborta al cargar si no resuelve el upstream.
- **`err.message` devuelto al cliente** en varios handlers, filtrando nombres
  de tabla y constraints.

## 1.5 Deuda conocida, no bloqueante

- **Bundle del frontend: 1,43 MB en un solo chunk** (438 KB gzip), sin code
  splitting. En 3G o en un celular de gama baja es una primera carga lenta.
  Se resuelve con `React.lazy` por ruta; las 18 páginas ya están separadas.
- **`@anthropic-ai/sdk` en `dependencies` pero nunca importado.** Dependencia
  muerta: peso de instalación y superficie de supply chain sin contrapartida.
  El README menciona extracción por IA desde PDF/imágenes — o la feature se
  perdió, o nunca se conectó. Hay que decidir cuál.
- **`migrate.js` setea `NODE_TLS_REJECT_UNAUTHORIZED = '0'`**, que desactiva la
  verificación TLS de todo el proceso. Es un script one-off de migración
  PHP→Postgres, no un camino de producción, pero no debería quedar en el repo
  con esa línea.
- **Páginas muy grandes**: `Production.jsx` (681), `Orders.jsx` (656),
  `Customers.jsx` (601), `Billing.jsx` (594). Mezclan fetching, estado, cálculo
  y presentación. No está roto; sí es donde más va a costar cambiar cosas.
- **`subscriptionCron` no corre** con el servicio dormido en Render free. Los
  vencimientos de suscripción no se procesan de forma confiable. Es una
  limitación del plan, no del código, pero condiciona el cobro.

---

# Parte 2 · Plan de análisis

Cinco frentes, ordenados por lo que bloquea vender. Cada uno indica el método,
no solo el objetivo — el objetivo sin método es una intención.

## Frente 1 · Auditoría de aislamiento entre empresas cliente

> **ESTADO: CERRADO** (30/07/2026). 20 endpoints corregidos, 119 tests.
> Ver [AUDITORIA-AISLAMIENTO.md](AUDITORIA-AISLAMIENTO.md) para el detalle
> endpoint por endpoint.
>
> La auditoría encontró más de lo previsto. Además de los IDOR esperados:
> la configuración de AFIP era **global** —una sola fila de certificado y CUIT
> para todas las empresas, con lo cual una facturaba con la identidad fiscal de
> otra—; `getSummary` agregaba totales financieros de toda la base sin filtro;
> y `POST /:empresaId/invitar` permitía invitarse a uno mismo a otra empresa.
>
> Queda pendiente: cifrar la clave privada de AFIP en reposo, y los tests de
> integración contra base real.

**Bloquea vender. Es lo primero.**

Alcance: las 16 rutas de `apps/api/src/routes` y los 12 services.

Método:

1. Inventariar cada endpoint que reciba un identificador de recurso por URL,
   body o query.
2. Para cada uno, determinar si la consulta filtra por `req.empresaId` —
   directamente o a través de un service.
3. Clasificar: correcto / vulnerable / no aplica (recursos globales como
   `Permiso`).
4. Corregir con un patrón único y repetible, no caso por caso. Dos opciones,
   y conviene decidirla antes de tocar nada:
   - **Middleware por ruta**, al estilo del `requireEmpresaPropia` que ya se
     agregó en `empresas.js`. Explícito y fácil de auditar, pero hay que
     acordarse de ponerlo.
   - **Scope por defecto en Sequelize** que inyecte `empresa_id` en todo
     modelo que lo tenga. Imposible de olvidar, pero implícito: cuesta más
     entender por qué una query devuelve lo que devuelve.
5. Escribir un test de regresión por endpoint corregido: usuario de la empresa
   A pide un recurso de la empresa B y debe recibir 403 o 404.

Entregable: tabla de cobertura endpoint por endpoint, con estado.

## Frente 2 · Verificación de la lógica de negocio con dinero

**Bloquea vender.** Un error acá factura mal, y facturar mal tiene
consecuencias fiscales para el cliente.

Los caminos a verificar, en orden de impacto:

| Área | Qué verificar | Dónde |
|---|---|---|
| Precios y márgenes | Margen sobre costo vs. sobre precio, recargo de tarjeta, descuento de alianza, redondeo | `services/costService.js`, `routes/products.js` |
| Punto de equilibrio (BEP) | Reparto de gastos fijos entre sucursales, cálculo del margen mínimo | `routes/general.js`, `Dashboard.jsx` |
| Costo de recetas | Costeo recursivo, insumo que es a la vez producto, cambio de costo retroactivo | `services/productionService.js`, `costService.js` |
| Cuenta corriente | Deuda = ventas − pagos − adelantos; signo de cada movimiento | `routes/customers.js`, `services/customerService.js` |
| IVA e impuestos | Discriminado vs. incluido, condición fiscal (Monotributo / RI) | `services/taxService.js`, `routes/taxes.js` |
| Stock | Descuento en venta, devolución en anulación, transferencia entre sucursales, stock negativo | `routes/stock.js`, `routes/sales.js` |

Método: tests unitarios con casos derivados de operaciones reales, incluyendo
los bordes que rompen las cosas — cantidad cero, precio cero, descuento del
100 %, devolución parcial, producto sin costo cargado.

Meta razonable: cobertura alta en services de cálculo. No hace falta 80 % de
todo el repo; hace falta ~100 % de lo que toca plata.

## Frente 3 · Estado real de la integración AFIP

**Bloquea vender**, porque es la promesa central del producto y es lo que un
cliente no puede resolver por su cuenta.

Preguntas abiertas, en orden:

1. ¿Está probada contra homologación, o solo escrita? `.env.example` sugiere
   `afip_environment: 'homologation'` como default.
2. ¿Cómo se manejan y renuevan los certificados por empresa? ¿Se guardan
   cifrados? Un certificado AFIP es material sensible del cliente.
3. ¿Qué pasa cuando AFIP no responde o rechaza? ¿La venta se pierde, queda
   pendiente, se reintenta?
4. ¿Qué tipos de comprobante están soportados de verdad? El código menciona A,
   B y C. ¿Notas de crédito y débito?
5. ¿Numeración correlativa por punto de venta, y qué pasa si se saltea un
   número?

Método: leer `services/afipService.js` y `afipAuth.js` contra la
`docs/GUIA_AFIP.md` existente, y probar el circuito completo en homologación
con un CUIT de prueba.

Este frente puede terminar siendo el más grande. Conviene medirlo temprano.

## Frente 4 · Ciclo de suscripción y cobro

**Bloquea facturar**, que es distinto de bloquear vender: se puede vender
manualmente al principio, pero no escala.

- `checkSubscription` existe. ¿Qué hace exactamente al vencer el trial:
  bloquea, degrada, avisa?
- Trial de 15 días + 3 de gracia está en el código. ¿Coincide con lo que
  promete la landing? (Hoy la landing muestra planes que **no** están
  conectados a ningún cobro.)
- **No hay pasarela de pago integrada.** Para Argentina, la decisión práctica
  es Mercado Pago. Es trabajo nuevo, no auditoría.
- **No existen Términos y Condiciones ni Política de Privacidad.** Son
  requisito de cualquier pasarela y del consentimiento de datos. Hoy la landing
  los linkea a contacto con un TODO.

## Frente 5 · Operabilidad

**No bloquea la primera venta, sí bloquea dormir tranquilo.**

- **Backups.** Neon free tiene retención limitada. Antes del primer cliente
  real hace falta una política de backup y una restauración probada. Un backup
  que nunca se restauró no es un backup.
- **Observabilidad.** Hay `pino` estructurado, que es buena base. Falta que los
  logs salgan a algún lado consultable y que los errores 500 avisen.
- **Onboarding de un cliente nuevo.** ¿Cuántos pasos manuales hay hoy entre
  "se registra" y "puede facturar"? Cada paso manual es un límite duro de
  escala.
- **Escalar réplicas.** Las migraciones corren en el arranque del contenedor.
  Con más de una instancia corren en paralelo. Mover a pre-deploy job antes de
  escalar.

---

## Orden sugerido

```
1. Frente 1  (aislamiento)     ─┐  bloqueantes de venta,
2. Frente 2  (lógica de dinero) ├─ en este orden
3. Frente 3  (AFIP)            ─┘

4. Frente 4  (cobro)            ← bloqueante de facturación
5. Frente 5  (operabilidad)     ← antes del primer cliente real

6. Deuda de 1.5                 ← cuando haya aire
```

Frentes 1 y 2 se pueden trabajar en paralelo si hay más de una persona: tocan
los mismos archivos pero con lentes distintas. El 3 conviene medirlo ya, aunque
se ejecute después, porque su tamaño es la mayor incógnita del plan.

---

## Respuesta corta a "¿está óptimo para salir a venta?"

**Todavía no, y falta menos de lo que parece.**

Lo que suele hundir un proyecto en este punto —un modelo de dominio mal
pensado— acá está resuelto y es bueno. La funcionalidad existe y es amplia.

Lo que falta no es construir: es **verificar**. Hay una fuga de datos entre
clientes confirmada en dos archivos y probablemente presente en más; hay ~9.500
líneas de lógica financiera sin un solo test; y hay una incógnita del tamaño de
AFIP sin medir.

Con **un cliente único** (Comprafit) el riesgo de la fuga entre empresas cliente es
nulo en la práctica: no hay otro empresa cliente del que filtrar. Eso abre un camino
razonable: salir con Comprafit mientras se ejecutan los frentes 1 y 2, y no
sumar el segundo cliente hasta que el frente 1 esté cerrado y con tests de
regresión.

Esa secuencia convierte el bloqueante en una condición de crecimiento, que es
mucho más manejable.
