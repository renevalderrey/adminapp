# Operación

Qué hacer cuando algo pasa. Está escrito para el que atiende el problema, no
para el que escribió el código.

---

## Antes del primer cliente real

Una lista corta, en orden. Todo lo que sigue asume que estos puntos están
hechos.

| | Qué | Dónde |
|---|---|---|
| ⬜ | **Correr las migraciones pendientes** | Ver abajo |
| ⬜ | **Configurar `CRON_SECRET`** y un cron externo diario | Render + cron-job.org |
| ⬜ | **Probar el circuito AFIP en homologación** de punta a punta | — |
| ⬜ | **Probar una restauración de respaldo** | Ver abajo |
| ⬜ | **Verificar que los logs se ven** en el panel de Render | — |

Un respaldo que nunca se restauró no es un respaldo. Es un archivo.

---

## Diagnóstico rápido

### ¿Está vivo el sistema?

```
GET https://<api>/api/health
```

| Respuesta | Significa |
|---|---|
| `200` con `base_de_datos: "ok"` | Todo bien |
| `200` con `latencia_ms` alta (> 3000) | Neon estaba suspendida y despertó. Normal en el free tier |
| `503` con `base_de_datos: "error"` | La API responde pero no llega a Postgres |
| No responde | El servicio está dormido (free tier) o caído |

`/api/ping` responde aunque la base esté caída: sirve para saber si el proceso
vive, no si el sistema funciona.

### Los logs

Van a **stdout** y se ven en el panel de Render, en JSON. Los campos útiles:

- `level: 50` (error) o `60` (fatal)
- `empresaId` — casi todos los errores lo llevan
- `msg` — el prefijo dice de dónde viene (`sales:`, `afip:`, `tiendanube:`)

> Antes iban a `./logs/app.log`, un archivo en disco efímero que nadie veía y
> que desaparecía en cada deploy. Si alguien vuelve a poner un transport de
> archivo, se pierden los logs de producción otra vez.

---

## Situaciones

### "No puedo facturar" / AFIP rechaza

Por orden de probabilidad:

1. **¿Está configurado el entorno?** Si `afip_environment` no está definido, el
   sistema usa **homologación** y los comprobantes **no tienen validez fiscal**.
   Queda un `warn` en el log diciéndolo.
2. **¿Se venció el certificado?** Duran 2 años y **no hay ningún aviso**. Ver
   `GET /api/afip/cert-info` → `validTo`.
3. **¿El CUIT del certificado coincide con el configurado?** No se valida. Si
   difieren, AFIP rechaza todo con un mensaje críptico.
4. **¿Se guardó bien la configuración?** Ver más abajo, hubo un caso grave.

El mensaje de AFIP se devuelve tal cual al usuario y queda en el log con
`msg: "afip:invoice"`.

### Una venta quedó sin comprobante

Pasa cuando la venta se guardó pero AFIP falló. **Es el caso previsto**: la
venta existe y se puede reintentar.

```
POST /api/sales/<id>/facturar
```

Es idempotente: si ya tiene CAE, devuelve el que tiene.

> El flujo está en este orden a propósito. Antes se pedía el CAE **antes** de
> guardar, y si el guardado fallaba quedaba un comprobante fiscal emitido sin
> ningún registro en el sistema — imposible de detectar.

### Se anuló una venta que ya tenía CAE

**Anular en la app no da de baja el comprobante ante ARCA.** Para eso hace falta
una nota de crédito, que el sistema todavía no emite.

Para saber cuántas hay pendientes:

```
GET /api/taxes/monotributo → anuladas_con_cae_sin_nc
```

Ese monto **sigue contando** como facturación ante ARCA. Hay que emitir las
notas de crédito por fuera hasta que el sistema las soporte.

### Alguien borró datos por error

1. **Ver si hay un respaldo reciente**: `node scripts/backup.js <empresaId>`
   genera uno *ahora*, pero para recuperar hace falta uno *anterior*.
2. **Neon tiene restauración por punto en el tiempo**, con retención limitada
   en el plan gratuito. Es la vía real de recuperación. Se hace desde el panel
   de Neon.

> Por eso el respaldo periódico importa. `scripts/backup.js --todas` exporta
> todas las empresas a JSON; conviene correrlo con alguna frecuencia y guardar
> el resultado **fuera** de la plataforma.

### Un cliente pide sus datos

```
node scripts/backup.js <empresaId> --salida ./entrega
```

Genera un JSON con todas sus tablas. Es información que está obligado a
conservar: no hay motivo para negarla, incluso si se va.

El certificado y la clave de AFIP **no** se incluyen — son material sensible y
un archivo así suele terminar en un drive compartido.

### Un cliente pagó / hay que activarlo

```
node scripts/suscripcion.js listar
node scripts/suscripcion.js activar <empresaId> --plan pro --meses 1
```

Si ya tenía período pagado, los meses se suman a partir de ahí; no se le comen
días.

**No hay pasarela de pago.** Esto es el mecanismo manual, para cobrar por
transferencia.

### "La app dejó de funcionar" de golpe

Si todo devuelve `402`, es la suscripción. Ver `scripts/suscripcion.js ver <id>`.

El usuario ve una pantalla que lo explica, no un error genérico.

### Todo va lento la primera vez y después bien

Es el free tier funcionando como está documentado:

- **Render** duerme el servicio a los 15 min sin tráfico. El primer request
  tarda ~50 s. Por eso el timeout del frontend está en 60 s.
- **Neon** suspende la base a los 5 min. La primera consulta tarda unos
  segundos; Sequelize reintenta.

Ninguna de las dos cosas es un bug. Se resuelven con plan pago.

---

## Tareas programadas

El cron de suscripciones corre con `setInterval` **dentro del proceso**. En el
free tier, con el servicio dormido, **no dispara**.

Por eso existe:

```
POST /api/tareas/ejecutar
Header: X-Cron-Secret: <CRON_SECRET>
```

Configurar un cron externo gratuito (cron-job.org, GitHub Actions) que lo llame
una vez por día. Además de correr las tareas, despierta el servicio.

Sin `CRON_SECRET` configurado, el endpoint responde 404: no queda una ruta
abierta por olvido.

**Si esto no está configurado, los trials no vencen y los avisos no salen.**

---

## Deploy

### Migraciones

Corren solas al arrancar el contenedor, vía `scripts/migrar.js`, que toma un
advisory lock de PostgreSQL. Si falla, **el contenedor no levanta** — es
preferible a levantar con el schema a medias.

Manualmente:

```
npm --prefix apps/api run db:migrate
```

### Migraciones pendientes de correr

Tres, de las auditorías recientes. Las dos últimas dejan el histórico en su
valor por defecto y puede hacer falta completarlo a mano:

| Migración | Qué agrega | Ojo con el histórico |
|---|---|---|
| `20260730-settings-pk-por-empresa` | PK compuesta en `settings` | La config de AFIP existente queda asignada a la empresa 1 |
| `20260731-ventas-a-cuenta-corriente` | `sales.is_credit` | Las ventas viejas quedan como **contado**. Si hay cuentas corrientes en uso, hay que marcar las impagas |
| `20260731-guardar-punto-de-venta-afip` | `sales.afip_pv` | Queda NULL. Para los comprobantes ya emitidos, completar con el punto de venta que se usaba |

El `UPDATE` de cada caso está en el comentario de la migración.

### Rollback

Las migraciones tienen `down()`. Revertir la de `settings` **falla a propósito**
si dos empresas cargaron la misma clave: elegir cuál sobrevive es una decisión
de negocio, no de la migración.

### Al escalar a más de una instancia

Tres cosas dejan de funcionar bien:

1. **El serializador de numeración AFIP** vive en memoria del proceso. Con
   varias instancias, dos podrían pedir el mismo número de comprobante.
2. **El cron** correría N veces. Con el disparador externo, una sola.
3. **La caché del ticket WSAA** es por proceso: cada instancia pediría el suyo.
   AFIP no permite pedir uno nuevo antes de que venza el anterior.

Ninguna impide escalar, pero las tres hay que resolverlas antes.

---

## Lo que todavía no existe

Para que nadie lo busque:

- **Alertas.** Nadie se entera de un error salvo que mire el panel.
- **Notas de crédito.**
- **Pasarela de pago.**
- **Panel del dueño del SaaS.** Todo se hace con los scripts o contra la base.
- **Cifrado de la clave privada de AFIP.** Está en texto plano en la base.
- **Respaldo automático.** El script existe; correrlo periódicamente, no.
