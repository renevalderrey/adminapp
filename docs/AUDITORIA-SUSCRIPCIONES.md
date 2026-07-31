# Auditoría del ciclo de suscripción y cobro (Frente 4)

**Fecha:** 31 de julio de 2026
**Método:** 7 agentes sobre 3 áreas (ciclo de vida, promesas vs implementación,
requisitos para cobrar), con verificación adversarial. Más verificación manual.
**Resultado:** 44 hallazgos confirmados — 29 defectos y 15 ausencias.

---

## Respuesta corta

**No se le puede cobrar a nadie todavía.** No por un bug: porque las piezas para
recibir plata no existen.

Y hay algo más urgente que eso: **la landing promete cosas que el producto no
puede cumplir**. Esa página ya está pública.

---

## Lo más urgente: lo que se promete no existe

| La landing dice | La realidad |
|---|---|
| **"Plan Inicial $0 — Comenzar gratis"** | No existe un plan gratuito permanente. Todo alta crea un trial de 15 días + 3 de gracia y después bloquea |
| "100 facturas mensuales" | No hay ningún contador de facturas |
| "1 sucursal" como límite del plan gratis | No hay límite de sucursales |
| Planes "Negocios" y "Corporativo" | `Suscripcion.plan` vale siempre `'free'`. Nada lo cambia |
| **"IA ilimitada"** | `@anthropic-ai/sdk` está en las dependencias pero **nunca se importa**. La funcionalidad no existe |
| "Módulos completos: Proveedores, BEP e IA" | Proveedores y BEP sí existen. IA no |

El caso concreto: un emprendedor entra, elige *"Plan Inicial $0 — Comenzar
gratis"*, carga su catálogo, factura dos semanas. **El día 18 abre la app y todo
responde 402.** Perdió el acceso a sus propios datos, después de que le
prometieron que era gratis.

Esto no es un bug que se arregla en el backend. Son dos caminos:

1. **Implementar el plan gratuito**: hace falta un estado de suscripción
   degradado (no `expired`) y los contadores que apliquen los topes.
2. **Corregir la página**: decir que la prueba es por tiempo y no ofrecer un
   plan gratuito perpetuo.

Es una decisión comercial, no técnica. **Hasta que se resuelva, la landing está
haciendo una promesa que el sistema incumple a los 18 días.**

Otros dos detalles de la misma página, menores pero públicos:

- El toggle anual dice **"-20%"** pero pasa de $55 a $45, que es **18,2%**.
- Los precios están en `$` **sin indicar moneda**. Para un producto argentino,
  $45/mes en pesos o en dólares son cosas muy distintas.

---

## Defectos corregidos

### Los trials no vencían nunca

`expireTrials` exigía `trial_ends_at < now AND grace_period_ends < now`. Pero
`grace_period_ends` es nullable, y en SQL comparar NULL con una fecha devuelve
NULL, que no matchea en un `WHERE`.

Toda suscripción sin período de gracia quedaba en `trialing` **para siempre**.
`setup.js` creaba justamente una así.

*Verificado que el test lo detecta: reintroduciendo el `where` anterior, fallan
2 tests y señalan el caso del trial sin gracia.*

### El paywall era eludible

`checkSubscription` hacía `if (!sub) return next()`. Una empresa sin fila de
suscripción tenía **acceso ilimitado y gratis**. No es un estado transitorio: es
un agujero permanente.

Además, de los cinco estados del enum, dos no bloqueaban nada:

- `cancelled` — cancelar dejaba el acceso abierto para siempre.
- `past_due` — una suscripción impaga seguía funcionando hasta que el cron la
  pasara a `expired`.

Ahora cada estado se resuelve explícitamente, respetando el período ya pagado, y
un estado desconocido bloquea en vez de pasar de largo.

### IDOR en `GET /empresas/:id/suscripcion`

Sin `checkPermission` ni validación del `:id`. Cualquier usuario autenticado
podía leer el plan, el estado y las fechas de vencimiento de cualquier otra
empresa cliente. Se escapó del Frente 1.

### El usuario vencido veía una app rota

La API devolvía 402 y el frontend no lo manejaba: cada pantalla mostraba su
propio error genérico. El usuario no entendía que tenía que renovar — parecía
que el sistema se había roto.

Ahora hay una pantalla dedicada que además aclara que **los datos siguen
guardados**. Un comercio que pierde acceso a su historial de facturación tiene
motivos para asustarse, y merece que se lo digan.

---

## Ausencias que se resolvieron

### No existía forma de activar una suscripción

La única ruta era un `GET`. Ningún código escribía nunca `status = 'active'`:
los estados `active` y `past_due` del enum eran **inalcanzables**. Marcar a un
cliente como pago exigía editar la base con SQL suelto.

Nuevo `scripts/suscripcion.js`: `listar`, `ver`, `activar`, `extender`,
`cancelar`.

**No es una pasarela de pago.** Es el mínimo para cobrar por transferencia y
activar a mano, que es como arranca cualquier SaaS chico en Argentina.

Se hizo como script y no como endpoint a propósito: activar una suscripción es
una operación del dueño del SaaS, no de un usuario de una empresa, y el modelo
de roles es *por empresa* — no existe el concepto de operador de la plataforma.
Un endpoint tendría que inventar un mecanismo de autenticación nuevo.

### No había ningún aviso

Solo existían dos plantillas de email: bienvenida e invitación. Nada del ciclo
de facturación. El usuario se enteraba de que se le venció el trial cuando la
app empezaba a devolverle 402 en medio de una venta.

Cuatro plantillas nuevas (trial por vencer, trial vencido, suscripción activada,
cuenta suspendida) y el cron avisa a los 5 días y a 1 día.

---

## Lo que falta para cobrar

### Decisiones comerciales

1. **¿Existe el plan gratuito permanente?** De la respuesta depende si hay que
   construir un estado degradado con contadores, o corregir la landing.
2. **¿Qué planes hay realmente, con qué precios y en qué moneda?** Hoy la
   landing y el código no coinciden en nada.
3. **¿Qué límites tiene cada plan?** Ninguno está implementado: el plan gratuito
   y el pago son funcionalmente idénticos.
4. **¿Qué pasarela?** Stripe no procesa cobros locales en pesos argentinos. Las
   columnas `stripe_customer_id` y `stripe_subscription_id` están muertas —
   nadie las lee ni las escribe. Para Argentina el camino es Mercado Pago.

### Trámites externos

5. **Términos y Condiciones y Política de Privacidad.** No existen. Son
   requisito de cualquier pasarela y del consentimiento de datos. Hoy el footer
   de la landing los apunta a contacto.
6. **Quién le factura a la PyME que paga.** AdminApp le cobra a sus clientes y
   tiene que emitirles comprobante. No hay nada en el código para eso — y es
   irónico, siendo un sistema de facturación.

### Trabajo técnico

7. **El modelo no guarda período, monto, moneda ni historial de cobros.**
   `Suscripcion` tiene el estado actual y nada más. No se puede responder
   "cuánto pagó este cliente y cuándo".
8. **El cron vive en el proceso**, sin lock ni registro de corridas. Con varias
   instancias corre N veces; en el free tier de Render, con el servicio dormido,
   no corre. Los vencimientos no se procesan de forma confiable.
9. **No hay panel del dueño del SaaS.** Ver empresas, vencimientos y cobros solo
   se puede por base de datos o con el script nuevo.
10. **La exportación de datos queda detrás del paywall.** `Reports.jsx` exporta a
    XLSX/CSV, pero `/api/reports` pasa por `checkSubscription`: al vencer, 402.
    El comercio pierde acceso a su historial fiscal justo cuando más lo
    necesita. **Conviene decidir si la exportación debe quedar exenta.**

### El paywall sigue teniendo una fuga

Un mismo usuario puede repetir el onboarding y sacarse un trial nuevo cada 15
días: `POST /api/empresas/onboarding` no limita cuántas empresas crea.

No lo bloqueé porque tener dos negocios es legítimo, y decidir el límite es una
decisión de producto. Pero mientras no se resuelva, el trial es renovable
indefinidamente.

---

## El mínimo para cobrarle al primer cliente

Si se acepta cobrar por transferencia y activar a mano:

1. ✅ **Script de activación** — hecho.
2. ✅ **Emails del ciclo** — hechos.
3. ⬜ **Decidir los planes reales** y alinear la landing.
4. ⬜ **Términos y Privacidad** redactados y publicados.
5. ⬜ **Definir quién emite la factura** de AdminApp al cliente.

Los puntos 3, 4 y 5 no son código.

Después de eso, la pasarela es una optimización: deja de hacer falta perseguir
transferencias a mano, pero el negocio ya puede cobrar.
