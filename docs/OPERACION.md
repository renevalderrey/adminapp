# Operación

Qué hacer cuando algo pasa. Está escrito para el que atiende el problema, no
para el que escribió el código.

> **Dónde corre esto.** El runbook se escribió cuando la API vivía en Render, la
> base en Neon y el frontend en Vercel. Desde el pase a un VPS de Hostinger
> (ver [DESPLIEGUE-HOSTINGER.md](DESPLIEGUE-HOSTINGER.md)) el diagnóstico es el
> mismo, cambia dónde se ejecuta cada cosa:
>
> | Donde dice | En el VPS |
> |---|---|
> | «Render → el servicio → Environment» | editar `/opt/favalio/.env` y `docker compose … up -d` |
> | «panel de Render → Logs» | `docker compose … logs -f api` |
> | «el servicio duerme a los 15 min» | no pasa: el proceso no se suspende |
> | «Neon suspende la base a los 5 min» | no pasa: Postgres corre en el mismo servidor |
> | «Neon guarda un historial / restauración por punto en el tiempo» | **no existe**: el respaldo es el cron de `deploy/respaldo.sh` |
>
> La última fila es la que importa: en el VPS, si el respaldo no está
> configurado y probado, **no hay red**.

---

## Antes del primer cliente real

Una lista corta, en orden. Todo lo que sigue asume que estos puntos están
hechos.

| | Qué | Dónde |
|---|---|---|
| ⬜ | **Rotar las credenciales del hosting legacy** | Panel de Hostinger · [ver abajo](#rotar-las-credenciales-del-hosting-legacy) |
| ⬜ | **Correr las migraciones pendientes** | Ver abajo |
| ⬜ | **Configurar `CRON_SECRET`** y los dos secretos del workflow | `.env` del VPS + GitHub · [ver abajo](#tareas-programadas) |
| ⬜ | **Configurar `SENTRY_DSN`** | sentry.io + `.env` del VPS · [ver abajo](#alertas-de-error) |
| ⬜ | **Configurar el cron de respaldo** del VPS | [DESPLIEGUE-HOSTINGER.md](DESPLIEGUE-HOSTINGER.md#respaldos) |
| ⬜ | **Probar el circuito AFIP en homologación** de punta a punta | — |
| ⬜ | **Probar una restauración de respaldo** | [Ver abajo](#probar-una-restauración) |
| ⬜ | **Verificar que los logs se ven** (`docker compose … logs api`) | — |

Un respaldo que nunca se restauró no es un respaldo. Es un archivo.

---

## Rotar las credenciales del hosting legacy

**Esto es lo único de la lista que no se puede resolver con código.**

`legacy/api.php` tenía hardcodeadas la contraseña de la base MySQL y el token
de aplicación del hosting original. Se redactaron del archivo, pero **siguen en
el historial de git**: cualquiera que clone el repositorio y haga
`git log -p legacy/api.php` las lee.

Redactarlas no las revoca. Hay que cambiarlas en el origen:

1. **Panel de Hostinger → Bases de datos MySQL.** Cambiar la contraseña del
   usuario de la base de Comprafit.
2. **El token de aplicación** (`APP_TOKEN` en `api.php`): elegir uno nuevo y
   ponerlo como variable de entorno `LEGACY_APP_TOKEN` en el hosting.
3. Si el sistema legacy sigue en uso, actualizar los dos valores donde los
   consuma.

**Hacerlo ANTES de migrar los datos**, no después: el script de migración se
conecta a esa API y necesita el token nuevo (`PHP_API_TOKEN`).

Reescribir el historial de git (`git filter-repo`) es una alternativa, pero no
reemplaza a rotar: si el repo ya se clonó una vez, la credencial vieja ya
salió. Rotar sí las invalida.

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

### "El efectivo de ayer no da" — el arqueo cambia el día del deploy del POS

**No se rompió nada.** A partir del día en que se despliega el punto de venta
nuevo (funcionalidad 011), el arqueo de caja y el panel de control muestran
números distintos a los de siempre. Esta sección existe porque este cambio llega
como «el sistema está mal», y sin ella la respuesta se reconstruye desde cero
cada vez.

**1 · Qué cambia.** El «Efectivo» del día **deja de incluir transferencias, QR y
débito**. `GET /api/sales/summary` (`routes/sales.js:203`) y
`dashboardService._salesByMethod` (`:106`) agrupan por
`Sale.payment_method`, y ese campo pasa de tener **tres** valores posibles a
tener hasta **nueve**:

| Antes | Ahora |
|---|---|
| `ef` · `tc3` · `al` | `ef` (efectivo) · `tr` (transferencia) · `qr` · `td` (débito) · `tc1` (crédito 1 pago) · `tc3v` (Visa 3c) · `tc3m` (Master 3c) · `tc3n` (Naranja 3c) · `al` (alianza) |

Así que el total de «Efectivo» **baja**, y aparecen filas que antes no existían.
La suma de todas ellas sigue dando lo mismo que antes.

**2 · Por qué es lo correcto.** El sistema anterior manejaba nueve medios de
pago y el POS ofrecía tres, que además **no eran medios sino niveles de precio**
(efectivo / tarjeta / alianza). Una transferencia se registraba como `ef`: el
arqueo contaba **como billetes plata que entró por CBU**, y el bloque de vuelto
aparecía cuando no correspondía. Ahora el segmento sigue decidiendo el precio
—una transferencia cotiza al precio de efectivo, como siempre— pero se registra
con su medio real, y el vuelto aparece **solo con efectivo de verdad**.

**3 · Qué NO se hizo, y por qué.** **El histórico no se toca.** Las ventas
anteriores conservan el valor que tienen:

- La comparación año contra año **sigue siendo válida para los códigos que ya
  existían**. Lo que no se puede hacer es comparar «efectivo de este mes» contra
  «efectivo del mismo mes del año pasado» y esperar que midan lo mismo: el de
  antes incluía transferencias.
- `tc3` —el código que el POS escribió durante meses— **conserva su significado**
  («tarjeta, sin decir cuál») y ahora tiene etiqueta propia, «T. Crédito 3c», en
  vez de mostrarse crudo en el historial, en el archivo exportado y en el panel.
  No se migró a `tc3v`/`tc3m`/`tc3n` porque **nada en la fila dice si esa tarjeta
  fue Visa, Master o Naranja**, y reescribir el registro contable de una
  operación cerrada a partir de una adivinanza es peor que dejarlo.

**Si alguien pregunta «¿dónde está la plata que falta?»**: sumar las filas
nuevas. Está toda ahí, repartida.

### "El margen de ayer no da" — recibir mercadería cambia el costo desde el deploy de Proveedores

**No se rompió nada.** A partir del día en que se despliega Proveedores y Órdenes
de compra (funcionalidad 012), **el costo de un producto puede cambiar solo por
recibir mercadería**, y con él el margen que muestra el punto de venta. Esta
sección existe porque este cambio llega como «el sistema está mal, el margen de
ayer no da», y sin ella la respuesta se reconstruye desde cero cada vez.

**1 · Qué cambia.** Al recibir una orden de compra, la pantalla propone
—**línea por línea, y con una casilla que hay que marcar**— actualizar el costo
del producto al precio al que se lo acaba de comprar. Si se acepta:

- `Product.cost` pasa a ser ese precio;
- **el producto elaborado que use ese insumo se recostea en cascada**, con la
  misma recursión que usa la recepción de una orden de producción;
- y sobre `Product.cost` se calculan **el margen del POS, el punto de equilibrio
  del panel y el precio recomendado del Comparador**, así que los tres se mueven.

La casilla viene marcada solo cuando el precio nuevo **difiere de verdad** del
costo cargado, y el servidor **vuelve a evaluar el umbral antes de escribir**: la
casilla del navegador es un pedido, no una orden. Si se desmarca, no se escribe
nada — ni el costo ni el historial.

**2 · Por qué es lo correcto.** Hasta este deploy, comprar a $1.200 lo costeado a
$900 **no hacía absolutamente nada**: el sistema seguía calculando el margen sobre
$900. O sea que el número que mostraba era **mentira**, y cuanto más subían los
precios más mentía. Que el margen «baje» el día del deploy no es una pérdida
nueva: es la primera vez que se ve la que ya existía.

**3 · Dónde se ve el porqué, sin abrir el código.** Cada cambio queda registrado
en `ProductCostHistory` con el motivo **«Actualización por recepción de compra»**,
y el panel de historial ya existe en la pantalla: Inventario → abrir el producto →
bloque de historial de costos (`components/HistorialDeCostos.jsx`, dentro de
`PanelProducto`). Ahí se ve **qué costo tenía, cuál tiene, cuándo cambió y por
qué**. La pregunta «¿por qué bajó el margen?» tiene respuesta **en la pantalla**;
no hace falta consultar a nadie.

Si el cambio vino de una cascada —el insumo cambió y el elaborado se recosteó
detrás—, la respuesta de la recepción dice cuántos elaborados se recostearon, y
cada uno tiene su propia fila en su historial.

**4 · Qué NO cambió, y son dos números distintos a propósito.** El saldo del
proveedor sigue siendo **la mercadería recibida**, no la pedida. Una orden emitida
y todavía no entregada **no genera deuda**. El número que el sistema viejo contaba
al emitir la orden se muestra **al lado**, con la etiqueta «pedido pendiente de
recibir», y son dos cosas distintas: uno es lo que se debe, el otro es lo que
falta que llegue. Si alguien compara el saldo de acá contra el del sistema viejo y
no le da, la diferencia es exactamente lo pedido y no recibido.

**Lo que NO se hizo**: dejar la casilla desmarcada por defecto «para que no cambie
nada». Sería tener la corrección escrita y apagada, o sea el problema anterior con
más pasos.

### Los números del Panel cambiaron — cinco indicadores se mueven el día del deploy

**No se rompió nada, y no es un número: son cinco.** A partir del día en que se
despliega el corte 2 de la funcionalidad 014, el Panel de control muestra otros
números. **«Por Pagar» probablemente baje bastante.** Los cinco estaban mal
calculados y salen corregidos **en un solo deploy, a propósito**: que haya **un**
día raro y no cinco.

> **Fecha del deploy**: _completar el día que se despliegue el corte 2._
> El aviso al dueño va **antes** del deploy, no después.

**1 · Qué se mueve, en qué dirección y por qué.**

| Indicador | Se mueve | Por qué |
|---|---|---|
| **Por Pagar** | **BAJA**, y puede bajar mucho | Sumaba **solo las deudas**: pagarle a un proveedor no bajaba el número, así que solo podía crecer. Ahora es **deuda − pagos**, la misma cuenta que muestra la pantalla de Proveedores |
| **Por Pagar · los cuatro tramos** | Cambian todos | Repartían lo **facturado** y por vencimiento; ahora reparten el **saldo impago** por antigüedad, igual que en Proveedores y en Clientes |
| **Por Cobrar** | **BAJA** | Contaba como deuda **las ventas de contado** que tenían cliente identificado. Una venta cobrada en el mostrador no es un saldo pendiente aunque sepamos de quién es |
| **Por Cobrar · los cuatro tramos** | Cambian todos, y ahora **cierran** | El total sumaba lo impago y los tramos sumaban lo facturado: los dos números de la misma tarjeta no podían coincidir nunca. Ahora los cuatro tramos suman exactamente el total de arriba |
| **Clientes con deuda** | **BAJA** | Mismo motivo que «Por Cobrar»: contaba a quien pagó en el mostrador. Además, quien pagó **exactamente** lo que debía ya no queda del lado equivocado por un residuo de centavos |
| **Stock bajo** | **SUBE** | Pasa a contar los productos **en cero sin mínimo cargado**, que antes no alertaban nunca. Es el mismo criterio que ya usan Faltantes e Inventario: los tres decían números distintos |
| **Ventas del mes / del mes anterior** | **Bajan un poco** | La venta del **día 1** se contaba en el mes actual **y** en el anterior. Ahora se cuenta una vez |
| **Todo lo que corta por fecha** | Se corre hasta un día | Los cortes eran la fecha del servidor en **UTC**; ahora son la fecha del negocio, la misma con la que se guardan las ventas. Entre las 21:00 y las 24:00 hora argentina el Panel iba un día adelante del historial |

**2 · Qué NO cambió.** Ninguna venta, ningún pago y ningún movimiento de
proveedor se tocó. **Los datos son los mismos**: lo que cambió es la cuenta que
el Panel hace con ellos. Las pantallas de Proveedores, Clientes, Caja y Faltantes
**ya mostraban los números buenos** — esas no se mueven, y de hecho el Panel pasa
a coincidir con ellas, que es de lo que se trataba.

**3 · Si el dueño pregunta «¿qué le pasó al sistema?»**, la respuesta es «esto y
nada más»: el corte se desplegó solo, sin ninguna pasada de diseño encima, y se
revierte solo. Si algún número queda dudoso, la comparación que vale es contra la
pantalla que lo detalla: **el Panel y esa pantalla ahora tienen que decir lo
mismo.** Si no coinciden, ahí sí hay algo que mirar.

**Lo que NO se hizo**: corregir los cinco de a uno, en cinco deploys. Cinco días
distintos con un número raro cada uno son cinco llamados y ninguna explicación
que sirva para el siguiente.

### "La tienda online no se actualiza"

**Dónde se mira: `/tiendanube`.** Desde el hito 7 hay una pantalla propia y es el
único lugar que dice el estado de la conexión — la tarjeta que estaba al final de
Facturación se sacó justamente para que no haya dos lugares que digan lo mismo y
se separen sin que nada avise.

**1 · Qué dice el bloque de estado, y qué hacer con cada cosa.**

| Lo que se ve | Qué significa | Qué hacer |
|---|---|---|
| **La integración no está configurada en el servidor** | Falta `TIENDANUBE_CLIENT_ID`. **No es lo mismo que «no vinculada»** y por eso se dibuja distinto | Ver «Las tres variables», abajo |
| **No hay ninguna tienda conectada** | El servidor está configurado y esta empresa nunca completó el OAuth | «Conectar con TiendaNube» |
| **Vinculada** | Hay tienda y la última comunicación no falló | Seguir por el punto 2 |
| **Vinculada con error** | La última llamada a TiendaNube falló. El motivo está en la misma tarjeta | Si dice que hay que volver a vincular, el token se revocó del lado de la tienda: desvincular y conectar de nuevo |
| **No pudimos comprobar el estado** | `GET /api/tiendanube/status` no contestó. **No dice «no vinculada»**, que es lo que hacía la tarjeta vieja: una caída de red y una tienda sin conectar se veían idénticas | Recargar; si sigue, mirar los logs con `msg` que empieza en `tiendanube:` |

**2 · Los tres relojes de la pantalla.** Los tres están a la vista a propósito:
una fecha vieja leída como si fuera de ahora es la forma más barata de tomar una
decisión equivocada.

- **«Catálogo actualizado el»** — cuándo se trajo por última vez la lista de
  variantes de TiendaNube. Si es vieja, la tabla puede estar mostrando variantes
  que ya no existen o no mostrar las nuevas. Se arregla con **«Refrescar
  catálogo»**.
- **«Última comunicación»** — la última vez que Favalio le habló a la tienda.
- **«Última reconciliación»** — la corrida diaria que compara lo que tenemos, lo
  que mandamos y lo que la tienda dice, y encola lo que difiere. **Si dice que
  nunca corrió, la red de respaldo no existe**: ver el punto 5.

**3 · ¿Está mapeado?** Una variante **sin mapear no recibe stock nunca**, y no
es un error: es que nadie dijo qué producto del sistema le corresponde. La tabla
lo dice fila por fila y el filtro «Solo sin mapear» las junta. El bloque de
estado cuenta cuántas de cuántas están mapeadas.

**4 · ¿De qué sucursal sale el número?** De **una sola**, la sucursal designada,
y está escrita en la pantalla. El stock de las otras no se publica. Si el número
que ve el cliente en la tienda no es el que se esperaba, lo primero es mirar si
la sucursal designada es la que corresponde. Cambiarla **encola todas las
variantes mapeadas** para volver a empujar, y la confirmación dice cuántas son
antes de aceptar.

Y se publica el **disponible**, no la cantidad. Hoy los dos números coinciden en
casi todos los casos porque no existe el concepto de comprometido; está anotado
en [PROXIMOS-PROYECTOS.md](PROXIMOS-PROYECTOS.md).

**5 · Si nada de lo anterior explica el desfase.** El caso normal no depende del
cron: cada movimiento de stock encola la variante y el empujón sale en el mismo
proceso. Lo que el cron atrapa es **el empujón que se perdió** —la tienda no
contestó, el proceso se reinició—. Sin él, ese empujón queda perdido y la única
señal es que «Última reconciliación» diga que nunca corrió. Ver
[Tareas programadas](#tareas-programadas).

**6 · Lo que la pantalla dice y hay que creerle.** Un pedido de la tienda
**baja el inventario y no registra ninguna venta**: no aparece en facturación, ni
en el flujo de caja, ni en los reportes. Y un pedido **cancelado o devuelto en
TiendaNube no repone el stock**: hay que ajustarlo a mano desde Inventario. Las
dos cosas están escritas en la propia pantalla, y la tarjeta vieja decía lo
contrario —«sincronización bidireccional»—, que es cómo alguien cierra la caja
con una diferencia que no puede explicar.

**7 · Lo que sí es un defecto y hay que mirar en los logs.** Un pedido que
llegó y **no descontó algún ítem** aparece en la pantalla, con el motivo:
`sin_mapeo`, `sin_stock_en_sucursal`, `sin_variante` o `cantidad_cero`. Antes eso
se salteaba en silencio y lo único que quedaba era un inventario mal, que aparece
en un recuento físico tres meses después.

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

**Lo resuelve el usuario, sin llamar a nadie.** En **Historial de ventas** la
venta aparece como **Rechazada**; abriendo la fila, el panel muestra el mensaje
con el que AFIP la rechazó, la fecha del intento y un botón **Reintentar
facturación**. Si lo que falta es el CUIT del comprador, el mismo panel lo pide
y reintenta ahí.

El error queda guardado en la venta (`afip_ultimo_error`, `afip_ultimo_intento`),
así que **sobrevive a cerrar la pestaña**: antes solo se veía en la respuesta
HTTP del momento y después la venta quedaba indistinguible de una venta interna
hecha a propósito.

Como salida de emergencia —sin sesión, o para automatizar— el endpoint sigue
estando:

```
POST /api/sales/<id>/facturar
```

Con el body vacío alcanza: el servidor resuelve el tipo de comprobante desde la
condición fiscal de la empresa, el CUIT desde la ficha del cliente de la venta y
el punto de venta desde la venta o desde `settings.afip_pv`.

Es idempotente: si ya tiene CAE, devuelve el que tiene. Y toma la venta **con
lock**, así que dos reintentos simultáneos dejan un solo CAE, y un reintento que
corre contra una anulación no puede emitir un comprobante sobre una venta
anulada.

> El flujo está en este orden a propósito. Antes se pedía el CAE **antes** de
> guardar, y si el guardado fallaba quedaba un comprobante fiscal emitido sin
> ningún registro en el sistema — imposible de detectar.

### Se anuló una venta que ya tenía CAE

**De acá en adelante no puede pasar: la API lo rechaza.**
`PUT /api/sales/<id>/void` sobre una venta con `afip_cae` devuelve 400 con el
motivo en castellano, y no toca el stock. El bloqueo está en la API y no solo en
la pantalla: un `curl` tampoco puede. En el Historial de ventas el botón
**Anular venta** aparece deshabilitado con la explicación, no ausente.

**Las que hay son histórico**, de cuando se permitía. Se muestran con etiqueta y
color propios —«Anulada · vigente ante ARCA», en ámbar— porque no son una
anulada común: **anular en la app no da de baja el comprobante ante ARCA**. Para
eso hace falta una nota de crédito, que el sistema todavía no emite.

Para saber cuántas hay pendientes, la forma sigue siendo la misma:

```
GET /api/taxes/monotributo → anuladas_con_cae_sin_nc
```

Ese monto **sigue contando** como facturación ante ARCA. Hay que emitir las
notas de crédito por fuera hasta que el sistema las soporte.

### "No me deja subir la foto" — el volumen de imágenes se llenó

**El síntoma es un 507.** Subir la foto de un producto responde:

```json
{ "ok": false, "codigo": "SIN_ESPACIO",
  "error": "No queda espacio para guardar más fotos. Avisale al administrador del sistema." }
```

y en el log queda `msg: 'imagenes: el volumen está lleno'` con el `empresa_id`
de quien la estaba subiendo — que **casi nunca es quien llenó el disco**, ver
abajo. Es el único caso en que la API contesta 507: un archivo que no es una
imagen, o que pesa de más, sale con 400 y con otro mensaje.

**Lo que se llenó, en realidad, es el disco del VPS.** El volumen
`imagenes_favalio` se declara en `docker-compose.produccion.yml` **sin ninguna
opción de tamaño**: no tiene tope propio, crece hasta donde da la máquina. Y en
ese mismo disco están **Postgres y los respaldos**. Así que lo primero no son
las fotos:

```
df -h
```

Con el disco al 100%, el 507 de las fotos es el primer síntoma que se ve, no el
problema: Postgres tampoco puede escribir.

**Cuánto ocupan las fotos.**

```
# El tamaño del volumen: la fila de favalio_imagenes_favalio en VOLUME NAME
docker system df -v

# El desglose, desde adentro de un contenedor descartable y de sólo lectura
docker run --rm -v favalio_imagenes_favalio:/origen:ro alpine du -sh /origen
docker run --rm -v favalio_imagenes_favalio:/origen:ro \
  alpine sh -c 'find /origen -type f | wc -l'
```

**Los respaldos ocupan aparte, y ocupan mucho.** `deploy/respaldo.sh` guarda en
`/var/respaldos/favalio` **catorce** copias del volumen entero
(`DIAS_A_CONSERVAR`), además de las catorce de la base. Si las copias siguen en
el mismo disco, las fotos ocupan quince veces lo que parece. Sacarlas del VPS es
la medida que libera más espacio de una, y hacía falta igual por otro motivo: un
respaldo que vive en el disco que se puede perder no cubre perder el disco.

**Cuánto pesa cada foto** (`apps/api/src/utils/imagenes.js`), que es lo que
permite estimar en vez de adivinar:

| | Medida |
|---|---|
| Foto de producto | **800×800 como máximo**, JPEG **calidad 82** |
| Lo que se acepta subir | **5 MB**, y el tope se aplica **antes** de redimensionar |
| Fotos más chicas | Quedan como están: no se agrandan |

O sea que lo que ocupa el disco **no es lo que sube el cliente**: los 5 MB son el
límite de entrada, y lo que queda guardado es la versión redimensionada.
Reemplazar una foto tampoco acumula — la anterior se borra apenas la nueva quedó
escrita y referenciada. Lo que sí puede acumular es un `unlink` que falló: queda
`msg: 'imagenes: no se pudo borrar la foto anterior'` en el log, y un archivo
huérfano en el volumen que ya no referencia nadie.

**No hay cuota por empresa, y esto es lo que hay que decir con todas las
letras.** En esta etapa **una sola empresa puede llenar el volumen de todas**:
nada limita cuántas fotos sube cada una, y cuando el disco se acaba se acaba para
todo el mundo. Es el **riesgo 10** del plan de la funcionalidad 015, asumido a
propósito y fuera de alcance — no es un descuido, pero tampoco está resuelto.

**Y desde el disco no se puede saber quién ocupa qué.** La ruta de las fotos
**no lleva el `empresa_id`** a propósito: si lo llevara, probando `/img/1/`,
`/img/2/`, … cualquiera podría enumerar las empresas de la plataforma. Los dos
niveles `aa/bb/` salen de un nombre aleatorio, así que un `du` por directorio no
dice nada de nadie. Para atribuir el consumo hay que contarlo desde la base:

```sql
SELECT empresa_id, COUNT(*) AS fotos
FROM products
WHERE image_url LIKE '/img/%'
GROUP BY empresa_id
ORDER BY fotos DESC;
```

El `LIKE '/img/%'` es lo que separa las fotos nuestras de las URLs de terceros
que cargó el importador de CSV: esas no ocupan un byte del volumen. Es un conteo
de fotos y no de bytes, pero con el tope de 800×800 alcanza para saber a quién
hay que llamar.

**Qué hacer, en orden.**

1. **Agrandar el disco del VPS.** Es lo único que resuelve el problema; todo lo
   demás compra tiempo.
2. **Sacar los respaldos del VPS.** Ver arriba: es lo que libera más de una vez.
3. **Bajar `DIAS_A_CONSERVAR`** en el cron, si hay que ganar espacio ya. Es
   achicar la red de seguridad para seguir andando: se vuelve a subir apenas el
   disco alcance.
4. **Llamar a la empresa que se pasó**, con la consulta de arriba en la mano, y
   que borre las fotos que no usa desde la ficha del producto. Sin cuota, es lo
   único que hay.

### Alguien borró datos por error

⚠ **Esto cambió con el pase al VPS, y es el peor lugar del runbook para
enterarse tarde.** Acá decía que la vía real de recuperación era la restauración
por punto en el tiempo de Neon. **Neon no está en el camino de producción**: no
hay historial continuo, no hay «volver a las 14:32». Lo único que existe es la
copia que dejó el cron, y la más nueva puede tener hasta 24 horas.

1. **No sigas escribiendo.** Cada minuto de operación normal es trabajo que la
   restauración va a pisar. Si el borrado fue grande, avisá y frená.
2. **Mirá qué copias hay**, que es lo que fija hasta dónde se puede volver:

   ```bash
   ls -lh /var/respaldos/favalio/
   ```

   Están las de los últimos **14 días** (`DIAS_A_CONSERVAR`): los `.sql.gz` de
   la base y los `favalio-imagenes-*.tar.gz` del volumen de fotos.
3. **Restaurá sobre una base descartable primero, nunca encima de la buena.** El
   procedimiento está en «Probar una restauración». Recién con la copia montada
   al lado se puede ver qué se perdió y sacar sólo eso.
4. **Si el respaldo de anoche no alcanza**, `npm run backup -w apps/api -- --empresa=<id>`
   exporta a JSON lo que hay **ahora**: no recupera lo borrado, pero congela el
   resto antes de tocar nada.

> Por eso el cron importa, y por eso hay que sacar las copias del VPS: un
> respaldo que vive en el mismo disco que la base no cubre el caso en que se
> pierde el disco. `npm run backup -w apps/api -- --todas` exporta todas las
> empresas a JSON y es la red de arriba de ésa.

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

## TiendaNube · habilitarla y configurarla

Tres cosas, y las tres son de panel o de una llamada. Ninguna se resuelve con
código.

### 1 · Habilitar el módulo para una empresa

**Sin esto la pantalla no existe para nadie.** `/tiendanube` cuelga de
`RouteGuard requiredModule="tiendanube"` (`App.jsx`), y ninguna empresa tiene
`tiendanube` en `settings.enabled_modules`: quien escriba la URL a mano termina
en `/pos` y en la barra lateral no aparece el ítem. **No se arregla sacándole el
guard a la ruta** — el gate va en los tres lados (menú, `RouteGuard` y API) o no
sirve.

```
# 1. Leer el settings ACTUAL de la empresa
GET /api/empresas/<id>

# 2. Mandarlo ENTERO, con la clave agregada
PUT /api/empresas/<id>
{ "settings": { …todo lo que devolvió el GET…,
                "enabled_modules": [ …los que ya estaban…, "tiendanube" ] } }
```

⚠⚠ **El `PUT` reemplaza `settings` completo** (`routes/empresas.js:501-511`).
Armarlo de memoria **pisa el resto de la configuración de la empresa**: el punto
de venta de AFIP, la condición fiscal, los márgenes. Hay que leer el JSON actual,
agregarle la clave y mandarlo completo.

⚠ **El `<id>` tiene que ser el de la empresa activa de la sesión**
(`requireEmpresaPropia`): un operador de la plataforma primero cambia de empresa
(`PUT /api/empresas/cambiar-empresa/<id>`) y recién después manda el `PUT`.

Dos detalles que ahorran una confusión:

- Si `enabled_modules` **no existe**, la empresa ve **todas** las pantallas: el
  guard solo filtra cuando la clave es un arreglo. O sea que agregar la clave por
  primera vez **puede sacarle pantallas** a esa empresa si la lista queda corta.
- El dueño de la empresa (`settings.owner_auth0_sub`) pasa el guard siempre, sin
  mirar la lista. Que a él se le vea la pantalla no significa que al resto
  también.

### 2 · Las tres variables de entorno

Van en Render → Environment. Están en `.env.example` bajo «TiendaNube
(opcional)», y «opcional» quiere decir que el resto del sistema arranca sin
ellas, no que la integración funcione.

| Variable | Para qué | Qué pasa si falta |
|---|---|---|
| `TIENDANUBE_CLIENT_ID` | Armar la URL de autorización y canjear el token | La pantalla dice **«no está configurada en el servidor»** y no ofrece conectar. Es un estado propio y distinto de «no vinculada», a propósito |
| `TIENDANUBE_CLIENT_SECRET` | Canjear el token **y verificar la firma del webhook** | **Todo webhook se rechaza con 401 y se ve idéntico a un ataque.** Ver abajo |
| `TIENDANUBE_CONTACT_EMAIL` | La cabecera `User-Agent` que TiendaNube exige | Sale el valor de relleno `contacto@tudominio.com`. TiendaNube puede cortar por eso, y el síntoma es un 4xx que no dice por qué |

**Lo de `TIENDANUBE_CLIENT_SECRET` merece leerse dos veces.** Sin esa variable la
firma no puede validar, así que el webhook responde 401 **a todo**, y **eso es lo
mismo que se ve si alguien estuviera falsificando webhooks**. La diferencia está
en el log: el rechazo dice cuál de las tres cosas faltó —el secreto del servidor,
la cabecera de la firma, o el cuerpo crudo—. Buscar `msg` que empiece en
`tiendanube:`.

Y el 401 no es sólo un pedido que no descuenta: **TiendaNube cuenta los errores y
deshabilita el webhook** cuando se repiten. Un despliegue sin esa variable termina
con la integración apagada del otro lado, y volver a encenderla es reinstalar la
app en la tienda. Por eso todos los demás caminos del webhook responden 200.

### 3 · Si la reconciliación no corre

La reconciliación es la **red de respaldo**, no el mecanismo principal: cada
movimiento de stock encola su variante y el empujón sale en el mismo proceso. Lo
que la reconciliación atrapa es el empujón que se perdió —la tienda no contestó,
el proceso se reinició— y el número que alguien cambió a mano en el panel de
TiendaNube.

La dispara `POST /api/tareas/ejecutar`, o sea el mismo cron que vence los trials.
**Hoy no corre**: faltan los dos secretos, y están sin marcar en la lista de
[Antes del primer cliente real](#antes-del-primer-cliente-real).

- **`CRON_SECRET`** — en Render **y** en GitHub, con el **mismo valor**. Sin él
  configurado en Render, el endpoint responde **404 aunque se lo llame**: no
  queda una ruta abierta por olvido, y desde afuera se ve como si la ruta no
  existiera.
- **`API_URL`** — en GitHub. `.github/workflows/tareas-diarias.yml:50-51` corta
  si falta, así que el workflow falla con el motivo escrito.

El procedimiento completo es el de [Tareas programadas](#tareas-programadas): son
los mismos dos secretos, no dos pares distintos.

**Cómo se sabe que quedó andando**: al día siguiente, en `/tiendanube`, el bloque
de estado deja de decir que la reconciliación nunca corrió. Para no esperar:
pestaña **Actions → Tareas diarias → Run workflow**.

---

## Tareas programadas

El cron de suscripciones corre con `setInterval` **dentro del proceso**. En el
free tier, con el servicio dormido, **no dispara**.

Por eso existe:

```
POST /api/tareas/ejecutar
Header: X-Cron-Secret: <CRON_SECRET>
```

Sin `CRON_SECRET` configurado, el endpoint responde 404: no queda una ruta
abierta por olvido.

**Si esto no está configurado, los trials no vencen y los avisos no salen.**

### Cómo se configura (una sola vez)

Ya existe el workflow `.github/workflows/tareas-diarias.yml`. Corre todos los
días a las 06:00 de Argentina y se puede disparar a mano desde la pestaña
Actions. Se eligió GitHub Actions y no un servicio externo por dos razones: ya
está pago con el repositorio, y el secreto queda en el mismo lugar que el resto
en vez de en el panel de un tercero.

Faltan tres pasos, todos de panel:

1. **Elegir un secreto.** Cualquier cadena larga y aleatoria:
   ```
   openssl rand -hex 32
   ```
2. **Render → el servicio → Environment.** Agregar `CRON_SECRET` con ese valor.
   Guardar (redeploya).
3. **GitHub → Settings → Secrets and variables → Actions.** Agregar:
   - `API_URL` — la URL de la API, sin barra final. Ej:
     `https://favalio-api.onrender.com`
   - `CRON_SECRET` — **el mismo valor** del paso 2.

Para probarlo sin esperar al día siguiente: pestaña **Actions → Tareas diarias
→ Run workflow**. Si los secretos faltan o no coinciden, el workflow falla con
el motivo escrito.

### Cuando `db:migrate` falla con «ya existe»

Pasa **solo en desarrollo**, y la causa es `sequelize.sync({ alter: true })`:
`server.js` lo corre al arrancar en desarrollo y arma el esquema a partir de
los modelos, sin registrar nada en `SequelizeMeta`. La base queda adelantada
y la cadena de migraciones, atrás.

**Por qué importa aunque sea solo en desarrollo.** En producción `sync` está
salteado, así que allá las migraciones son el único camino. Si la cadena nunca
se ejercita localmente, **un error de migración recién se ve en producción** —
que es el peor lugar para verlo.

Cómo se repara, sin borrar nada:

1. Comparar `SequelizeMeta` contra `src/migrations/`.
2. Por cada migración no registrada, **verificar en el esquema si su efecto ya
   está** (la tabla, la columna, la restricción). `sync` crea tablas y
   columnas, pero **no** claves primarias compuestas, índices con condición ni
   cambios de restricciones.
3. Las que ya están: registrarlas con un `INSERT` en `SequelizeMeta`.
4. Las que faltan de verdad: dejar que `db:migrate` las corra.
5. Correr `db:migrate` una segunda vez y confirmar que dice «No migrations
   were executed».

> El 1/8/2026 se reparó así una base de desarrollo con 12 migraciones sin
> registrar. Diez ya estaban aplicadas por `sync`; dos faltaban de verdad, y
> una de ellas era la clave primaria compuesta de `settings` — la corrección
> que impide que una empresa facture con el certificado de AFIP de otra. En esa
> base, esa protección **no estaba**.

**Recomendación**: sacar `sync({ alter: true })` del arranque en desarrollo y
usar migraciones también ahí. Es lo que evita que la deriva vuelva, y hace que
un error de migración se vea en la máquina de quien lo escribió.

---

## Deploy

### El monorepo es workspaces

Hay **un solo `package-lock.json`, en la raíz**, y las tres apps más
`packages/precios` se instalan juntas. Cambió cómo se instala y cómo se
construyen las imágenes, y ninguno de los síntomas dice «lo hiciste como antes»:
dicen otra cosa.

**1 · Se instala una sola vez, desde la raíz.**

```
npm ci
```

Con eso quedan instaladas las tres apps y el paquete. **`install:all` ya no
existe**: si alguien lo copia de un README viejo o de un apunte, npm contesta que
el script no está, y ese es el motivo — no es un clon incompleto ni un `node`
mal instalado. Lo mismo con entrar a `apps/api` y hacer `npm install` ahí: no hay
nada que instalar abajo.

Los scripts de una app se corren desde la raíz con `-w`:

```
npm run migrate -w apps/api
```

Dentro del contenedor no hace falta la bandera: el `WORKDIR` ya es la app
(`/app/apps/api`), así que ahí va `npm run backup -- --todas` a secas, como está
escrito en [DESPLIEGUE-HOSTINGER.md](DESPLIEGUE-HOSTINGER.md).

**2 · Los `docker build` se corren desde la raíz, con `-f`.**

```
docker build -f apps/api/Dockerfile -t favalio-api .
```

El punto del final es el contexto, y el contexto es **la raíz**, no `apps/api`:
el `package-lock.json` vive arriba, y sin él adentro del contexto el `npm ci` de
la imagen no tiene qué respetar — la imagen podría quedar con versiones distintas
de las que se probaron. Entrar a `apps/api` y construir desde ahí falla al copiar
el lock.

El deploy normal del VPS ya lo hace bien y no se toca: en
`docker-compose.produccion.yml` cada servicio declara `context: .` y
`dockerfile: apps/X/Dockerfile`, así que `up -d --build` construye las tres
imágenes con el contexto correcto. Lo de arriba es para cuando alguien construye
una a mano.

**3 · Un `MODULE_NOT_FOUND` de `@favalio/precios` al arrancar el contenedor NO
es una dependencia que falta.**

Es el síntoma más confuso de este cambio, y engaña por **cuándo** aparece: la
imagen se construye entera, sin un error, se sube, y **el contenedor no levanta**.
Instalar algo no lo arregla, porque no falta nada instalado.

Lo que pasó es que **el enlace del workspace quedó colgado**: npm crea ese enlace
durante el `npm ci`, y si el `package.json` de `packages/precios` todavía no está
en la imagen en ese momento, el enlace apunta a un directorio que no existe.
Copiar el código del paquete después no lo repara — el enlace ya se creó mal.

Se arregla en el Dockerfile, no en el `.env` ni en el VPS: el
`COPY packages/precios/package.json` va **antes** del `RUN npm ci`, y el código
del paquete, después. Los Dockerfiles lo tienen así y lo dicen en un comentario;
si alguien reordena los `COPY` «para agruparlos», el defecto vuelve tal cual.

Dos cosas que ahorran perseguir el error equivocado:

- **El mismo import puede fallar en el servidor de desarrollo y andar en el
  build, y ése es otro problema.** `@favalio/precios` es CommonJS a propósito y
  no tiene paso de build; `apps/web/vite.config.js` lo declara en
  `optimizeDeps.include`. Sin esa línea, `npm run dev -w apps/web` rompe y
  `npm run build -w apps/web` anda. Un `MODULE_NOT_FOUND` en el contenedor y uno
  en el servidor de desarrollo no tienen la misma causa.
- **El CI lo agarra antes, si se lo mira.** De los seis jobs de
  `.github/workflows/ci.yml`, el que ve este defecto es **«API — la imagen
  arranca y migra»**: construye la imagen y la levanta de verdad. Los otros cinco
  pueden estar en verde con este problema adentro.

**4 · Si un `npm ci` de la raíz deja `apps/landing` sin `node_modules`.**

Es un árbol viejo, de la época de `npm --prefix`: quedaron `node_modules` propios
adentro de `apps/*` y npm no los adopta. Se borran a mano, **una sola vez**, y se
vuelve a instalar:

```
rm -rf apps/api/node_modules apps/web/node_modules apps/landing/node_modules
npm ci
```

En PowerShell: `Remove-Item -Recurse -Force apps/*/node_modules`.

Después de eso `node_modules` vive solo en la raíz, y que `apps/landing` no tenga
uno propio **es lo correcto**, no lo que hay que arreglar. Landing entró al
workspace aunque no consuma el paquete justamente para esto: dos árboles
conviviendo es el estado en el que un `npm ci` de la raíz borra el
`node_modules` de landing y nadie entiende por qué el build dejó de andar.

> Al regenerar el lock, varias dependencias subieron **dentro de su rango**:
> axios 1.15.0 → 1.19.0, tailwindcss 4.2.4 → 4.3.3, vite 8.0.8 → 8.2.1 y react
> 19.2.5 → 19.2.8. Ninguna es un cambio mayor, pero el bundle que sale de este
> deploy no es el mismo de antes. Si algo se ve raro en el navegador justo
> después del corte y no hay ningún cambio de código que lo explique, esto es lo
> único que cambió.

### Migraciones

Corren solas al arrancar el contenedor, vía `scripts/migrar.js`, que toma un
advisory lock de PostgreSQL. Si falla, **el contenedor no levanta** — es
preferible a levantar con el schema a medias.

Manualmente, desde la raíz del repositorio:

```
npm run migrate -w apps/api
```

### Migraciones pendientes de correr

Seis. Cuatro son de las auditorías recientes y dos entran con Inventario. Las
que dejan el histórico en su valor por defecto pueden necesitar que se lo
complete a mano:

| Migración | Qué agrega | Ojo con el histórico |
|---|---|---|
| `20260730-settings-pk-por-empresa` | PK compuesta en `settings` | La config de AFIP existente queda asignada a la empresa 1 |
| `20260731-ventas-a-cuenta-corriente` | `sales.is_credit` | Las ventas viejas quedan como **contado**. Si hay cuentas corrientes en uso, hay que marcar las impagas |
| `20260731-guardar-punto-de-venta-afip` | `sales.afip_pv` | Queda NULL. Para los comprobantes ya emitidos, completar con el punto de venta que se usaba |
| `20260803-intentos-de-facturacion` | `sales.afip_ultimo_error`, `sales.afip_ultimo_intento` y el índice `(empresa_id, date)` | **Sin `UPDATE`.** Las dos columnas quedan en NULL y toda venta activa sin CAE anterior a la migración se muestra como **Registrada**, nunca como Rechazada |
| `20260804-identidad-de-sucursal-en-stock` | `stock.punto_de_venta_id` pasa a `NOT NULL`, se consolidan los duplicados y `location` queda como espejo | **Es la única que modifica datos de inventario: fusiona filas.** No se corre sin haber mirado antes el informe de acá abajo. Cada fila que desaparece queda entera en `stock_migracion_sucursal` |
| `20260805-historial-de-costos-con-autor` | `product_cost_history.usuario_id` y `.empresa_id` | `empresa_id` se completa desde el producto y queda NULL solo si el producto ya no existe. **`usuario_id` queda NULL en todo el histórico anterior**: ese dato no existe y no se puede inferir, así que la pantalla lo muestra sin autor |

> Las dos últimas llegan con la funcionalidad de Inventario. Si `db:migrate` no
> las nombra, todavía no están en el repositorio y no hay nada que hacer.

El `UPDATE` de cada caso está en el comentario de la migración.

`20260803-intentos-de-facturacion` no lleva ninguno a propósito: no hay forma de
saber cuáles de las ventas viejas sin CAE fallaron y cuáles se registraron así
queriendo, y adivinar sobre una obligación fiscal es peor que no saber. Es
aditiva y sobre columnas nulas, así que es segura mientras la versión anterior
de la aplicación sigue corriendo. `20260805-historial-de-costos-con-autor` es
aditiva por el mismo motivo y puede correrse antes, después o sin la de stock.

### Identidad de sucursal en stock: mirar el informe antes de migrar

`20260804-identidad-de-sucursal-en-stock` es la única migración del sistema que
**cambia cantidades de inventario**. Hasta hoy la sucursal de una fila de stock
era un texto libre (`location`) y el `punto_de_venta_id` podía estar vacío; a
partir de esta migración la sucursal es el id, es obligatorio, y **dos filas del
mismo producto en la misma sucursal no pueden existir**. Las que hoy están
repetidas se fusionan sumando sus cantidades.

Sumar puede estar mal, y la migración no tiene cómo saberlo. Por eso primero se
mira el informe.

#### 1. Cómo se corre el informe

```
npm run informe:stock -w apps/api
```

**No escribe nada**: ni una fila, ni una tabla, ni un índice. Se puede correr
las veces que haga falta, y correrlo por error contra producción no cambia un
solo dato. Es la vista previa, no un ensayo.

Corre exactamente la misma función que después va a correr la migración, así
que lo que muestra es lo que va a pasar, no una segunda opinión.

#### 2. Cómo se lee

Tiene tres partes.

**El resumen**, arriba. Cuántas filas de stock hay, cuántas no tienen sucursal
hoy, cuántas se resuelven por coincidencia de código y cuántas caen a la
sucursal por defecto, cuántas sucursales hay que crear, cuántas fusiones habría
y **cuántas quedaron marcadas «revisar»**. Con eso solo ya se sabe si esto es un
trámite o hay que sentarse a mirar.

**El detalle por empresa.** Las sucursales que tiene, a dónde va cada grupo de
filas, y **cada fusión una por una**: el producto, la sucursal destino, las
filas que se juntan con su `location`, su cantidad, su lote y cuándo se
escribieron por última vez, y qué queda después.

**Los totales**, al pie. El número que importa es **la suma de cantidades**:
tiene que ser exactamente la misma antes y después de migrar. La migración lo
verifica sola —compara producto por producto adentro de una única transacción— y
si no da, **aborta y no queda nada aplicado**. No hace falta comprobarlo a mano
después; lo que hay que confirmar es que el chequeo corrió.

Dos cosas más que conviene saber al leer:

- **Ninguna fila se pierde.** Cada fila que desaparece al fusionarse se copia
  entera —con todas sus columnas— a la tabla `stock_migracion_sucursal` antes de
  borrarse. Ahí queda para siempre: qué decía, con cuál se fusionó y por qué se
  marcó.
- Si el informe dice «no encontró duplicados», es que los leyó y no había. Es
  distinto de una lista vacía porque el script no llegó a mirar: el informe
  siempre dice cuántas filas leyó.

#### 3. Qué hacer si aparecen fusiones marcadas «revisar»

**La marca no es un error.** Es la única señal que hay para distinguir dos
situaciones que en la base se ven idénticas:

- **Dos pilas.** 40 unidades en el depósito y 12 en el mostrador, anotadas
  distinto porque no había sucursales de verdad. Sumar es correcto: son 52.
- **Una sola pila anotada dos veces.** Alguien cargó 100 unidades por la
  pantalla y después importó la lista del proveedor, que traía las mismas 100.
  Sumar da 200 sobre una estantería que tiene 100.

En la fila de stock no queda registrado quién la escribió, así que no hay forma
de decidirlo desde la computadora. Las señales que marcan una fusión son: las
dos filas tienen la misma cantidad, no hay dos lotes distintos que las separen,
se escribieron con menos de 24 horas de diferencia, alguna tiene cantidad
negativa, o alguna tiene disponible mayor que la cantidad.

**Se resuelve contando la mercadería.** No leyendo más el informe: el informe ya
dijo todo lo que sabe. Se agarra la lista de fusiones marcadas y se cuenta lo
que hay en la estantería de cada uno de esos productos.

- **Si el recuento coincide con la suma**, eran dos pilas. No hay nada que
  hacer: se autoriza la migración.
- **Si el recuento dice que la suma infló el inventario**, la fila original está
  entera en `stock_migracion_sucursal` y se corrige **con un ajuste de stock**
  desde la pantalla, no revirtiendo la migración. Revertir para arreglar una
  cantidad es mover una montaña para correr una silla, y además pisa todo lo que
  se haya vendido desde el deploy.
- **Si son muchas** —tantas que contarlas no es realista antes del deploy—, la
  salida es al revés: **corregir los duplicados a mano primero y migrar
  después**. Se unifican las filas repetidas desde la pantalla de Inventario, se
  vuelve a correr el informe, y se migra cuando la lista de marcadas esté vacía o
  sea corta. El informe se puede correr todas las veces que haga falta.

#### 4. Volver atrás

La migración tiene `down()` y restaura desde `stock_migracion_sucursal`: vuelve
a insertar las filas fusionadas con su id original, devuelve los
`punto_de_venta_id` y los `location` anteriores, y borra las sucursales que
creó.

> **El `down` restaura exactamente lo que archivó y pisa cualquier movimiento de
> stock posterior a la migración.** Si entre el deploy y el rollback se vendió,
> se compró o se transfirió mercadería, esos movimientos se pierden. **Es para
> volver atrás minutos después de un deploy, no semanas después.** Un `down` que
> intentara reconciliar lo que pasó en el medio estaría adivinando.

Además el `down` **falla a propósito** si mientras tanto quedaron dos filas con
el mismo `(product_id, location)`: elegir cuál sobrevive es una decisión de
negocio, no de la migración. Es el mismo criterio que el `down` de
`20260730-settings-pk-por-empresa`.

### Rollback

Las migraciones tienen `down()`. Revertir la de `settings` **falla a propósito**
si dos empresas cargaron la misma clave: elegir cuál sobrevive es una decisión
de negocio, no de la migración.

Revertir la de stock tiene su propia advertencia y no es equivalente a las
demás: ver «Identidad de sucursal en stock» acá arriba, punto 4.

### Al escalar a más de una instancia

Tres cosas dejan de funcionar bien:

1. **El serializador de numeración AFIP** vive en memoria del proceso. Con
   varias instancias, dos podrían pedir el mismo número de comprobante.
2. **El cron** correría N veces. Con el disparador externo, una sola.
3. **La caché del ticket WSAA** es por proceso: cada instancia pediría el suyo.
   AFIP no permite pedir uno nuevo antes de que venza el anterior.

Ninguna impide escalar, pero las tres hay que resolverlas antes.

---

## Alertas de error

Cada 500 y cada caída del proceso se reportan a Sentry, **si está configurado**.
Sin `SENTRY_DSN` no se inicializa nada y el sistema funciona igual: la
aplicación no depende de un servicio externo para arrancar.

Configurarlo:

1. Crear una cuenta en sentry.io y un proyecto **Node.js**. El plan gratuito
   (5.000 eventos/mes) sobra para un cliente.
2. Copiar el DSN (`https://...@....ingest.sentry.io/...`).
3. Render → Environment → `SENTRY_DSN`.
4. En Sentry, Alerts → activar el aviso por mail para errores nuevos.

Lo que llega en cada evento: el `requestId`, la ruta, el método y el
`empresaId`. Con el `requestId` se encuentra la línea exacta en los logs de
Render.

Lo que **no** sale del sistema: certificados y claves de AFIP, tokens de
TiendaNube, contraseñas y cabeceras de autorización. Hay un filtro explícito en
`src/config/sentry.js` — un secreto en el panel de un tercero es una fuga igual
que en cualquier otro lado.

---

## Probar una restauración

Un respaldo que nunca se restauró no es un respaldo.

**La base.** En el VPS no hay historial continuo ni «volver a las 14:32»: lo
único que existe es el `.sql.gz` que dejó el cron de `deploy/respaldo.sh`, y el
más nuevo puede tener hasta 24 horas. Se restaura **sobre una base descartable**,
nunca encima de la buena — con la copia montada al lado se puede comparar y
sacar sólo lo que falta.

```bash
# 1 · Qué copias hay. Son las de los últimos 14 días.
ls -lh /var/respaldos/favalio/

# 2 · Una base vacía al lado, en el mismo Postgres.
COMPOSE="docker compose -f /opt/favalio/docker-compose.produccion.yml"
$COMPOSE exec -T postgres createdb -U favalio favalio_prueba

# 3 · Volcar la copia adentro. -T porque no hay TTY.
gunzip -c /var/respaldos/favalio/favalio-2026-08-09-0315.sql.gz \
  | $COMPOSE exec -T postgres psql -U favalio -d favalio_prueba

# 4 · Que los datos estén.
$COMPOSE exec -T postgres psql -U favalio -d favalio_prueba -c \
  "SELECT (SELECT COUNT(*) FROM empresas) AS empresas,
          (SELECT COUNT(*) FROM sales)    AS ventas,
          (SELECT MAX(date) FROM sales)   AS ultima_venta;"

# 5 · Cuando terminaste.
$COMPOSE exec -T postgres dropdb -U favalio favalio_prueba
```

Esto no interrumpe nada: es otra base en el mismo servidor. **Anotar la fecha en
que se probó** — es lo único que convierte el respaldo en respaldo.

⚠ Y **las copias tienen que salir del VPS**. Un respaldo que vive en el mismo
disco que la base no cubre el caso en que se pierde el disco, que es el caso
para el que existe. Sirve `rclone` a cualquier nube, o un `scp` programado desde
otra máquina.

### Restaurar las imágenes

**La base y las fotos son dos restauraciones distintas, y hacen falta las dos.**
`pg_dump` no ve el volumen: la base sabe que la foto existe —`products.image_url`
guarda `/img/aa/bb/xxx.jpg`— y **el archivo vive únicamente en el volumen**.
Restaurar sólo el `.sql.gz` deja un catálogo entero apuntando a fotos que no
están, y eso llega como «las fotos no cargan», no como «faltó restaurar algo».

**Dónde están las copias.** `deploy/respaldo.sh` deja las dos en el mismo
directorio —`/var/respaldos/favalio` por defecto, la variable `DESTINO`— y las
dos rotan igual: se borran a los **14 días** (`DIAS_A_CONSERVAR`).

```
favalio-2026-08-09-0315.sql.gz             ← la base
favalio-imagenes-2026-08-09-0315.tar.gz    ← el volumen de fotos
```

**Cómo se hizo la copia**, porque la restauración es exactamente lo inverso: se
monta el volumen en un contenedor descartable —de **sólo lectura**— y se
empaqueta desde adentro. No se lee del disco del host: dónde guarda Docker el
volumen es un detalle que cambia entre versiones.

```
docker run --rm \
  -v favalio_imagenes_favalio:/origen:ro \
  -v /var/respaldos/favalio:/destino \
  alpine tar -czf /destino/favalio-imagenes-2026-08-09-0315.tar.gz -C /origen .
```

El volumen se llama **`favalio_imagenes_favalio`**: `imagenes_favalio` es el
nombre que le da `docker-compose.produccion.yml` y `favalio` el prefijo del
proyecto (`name: favalio`, arriba del mismo archivo). Con otro prefijo el
volumen se llama distinto y el comando no encuentra nada. Confirmarlo antes de
tocar nada cuesta una línea:

```
docker volume ls | grep imagenes
```

**La restauración**: el mismo `alpine` descartable, el volumen montado **con
escritura**, y `tar -xzf` adentro.

```
docker run --rm \
  -v favalio_imagenes_favalio:/destino \
  -v /var/respaldos/favalio:/origen:ro \
  alpine tar -xzf /origen/favalio-imagenes-2026-08-09-0315.tar.gz -C /destino
```

Tres cosas del procedimiento que no son estilo:

- **Primero se levanta la pila, después se restaura.** `docker compose … up -d`
  es lo que crea el volumen con el nombre y las etiquetas del proyecto. El
  `docker run` de arriba también lo crearía si no existiera, pero nacería sin
  ellas.
- **No hace falta parar nada.** El contenedor descartable monta **el mismo**
  volumen que ya tienen la API y Caddy —no es una copia—, así que lo que se
  descomprime está del otro lado en el momento.
- **`tar -xzf` superpone, no reemplaza.** Lo que ya estaba en el volumen y no
  viene en la copia **queda**. Como los nombres de archivo son aleatorios y no se
  reusan nunca, restaurar encima de un volumen vivo devuelve las fotos que
  faltaban sin pisar las nuevas. Si lo que se busca es dejar el volumen
  **exactamente** como el día de la copia, hay que vaciarlo antes, y eso es otra
  decisión: borra las fotos subidas desde entonces.

**Qué mirar después.** Que el comando no haya dado error no alcanza.

**1 · Que los archivos estén.** Contar los del volumen y compararlos con los de
la copia:

```
docker run --rm -v favalio_imagenes_favalio:/origen:ro \
  alpine sh -c 'find /origen -type f | wc -l'

tar -tzf /var/respaldos/favalio/favalio-imagenes-2026-08-09-0315.tar.gz | grep -vc '/$'
```

Sobre un volumen que estaba vacío los dos números tienen que dar igual. Si se
restauró encima de uno vivo, el del volumen tiene que ser **mayor o igual**: si
da menos, faltan archivos.

**2 · Que la API pueda escribir ahí.** El volumen va montado en
`/var/favalio/imagenes` **con escritura** —la API es la única que escribe— y la
ruta sale de `RUTA_DE_IMAGENES`, que el compose fija en ese mismo valor:

```
docker compose -f /opt/favalio/docker-compose.produccion.yml exec api \
  sh -c 'touch /var/favalio/imagenes/.prueba && rm /var/favalio/imagenes/.prueba && echo escribe'
```

Si eso falla, la próxima subida de foto falla, y **el error no va a hablar del
respaldo**.

**3 · Que Caddy las sirva.** Caddy monta el mismo volumen en la misma ruta pero
de **sólo lectura** —el que escribe es la API; si Caddy pudiera escribir, una
falla suya tocaría el contenido— y las publica bajo `/img/`. La prueba es pedir
una foto que exista, con la ruta tal cual está en `products.image_url`:

```
curl -I https://tienda.<dominio>/img/aa/bb/xxx.jpg     # 200
```

Un **404** acá con el archivo presente en el volumen no es la restauración: es
el `handle /img/*` de `deploy/Caddyfile`. Sin el `uri strip_prefix /img`, Caddy
busca `/var/favalio/imagenes/img/aa/bb/…` y devuelve 404 para **todas** las
fotos.

**Anotar la fecha en que se probó**, igual que con la base.

**Lo que cubre `scripts/backup.js`** (exportar los datos de una empresa a JSON)
es otro caso: devolverle los datos a un cliente que se va, o recuperar algo que
alguien borró por error. No reemplaza lo anterior.

```
npm run backup -w apps/api -- --empresa=<id>
```

---

## Migrar un cliente desde el sistema legacy

El sistema viejo de Comprafit (PHP + MySQL) guardaba todo como JSON en una
tabla clave-valor. El script traduce eso al esquema actual.

```
# 1. Simulación: no escribe nada, dice qué haría
npm run migrar:legacy -w apps/api -- --empresa=<id>

# 2. Si el resumen cierra, aplicar
npm run migrar:legacy -w apps/api -- --empresa=<id> --confirmar
```

Antes de correrlo:

- La empresa destino tiene que **existir** y tener **al menos un punto de
  venta**. El script no los crea.
- Para traer los datos **actuales** hacen falta `PHP_API_URL` y `PHP_API_TOKEN`
  (el token nuevo, después de rotarlo). Sin eso, el script cae al HTML del
  repo, que tiene los datos **semilla** — no los de hoy.
- Migra: marcas, productos, stock por sucursal, gastos fijos, ventas con sus
  ítems, y proveedores con movimientos, pedidos y documentos.
- **No** migra los permisos del legacy: el modelo cambió por completo. Se
  cargan de nuevo desde Equipo.
- Los gastos variables quedan guardados como referencia en `settings`, porque
  todavía no hay pantalla para ellos.

Es idempotente: correrlo dos veces no duplica. Y va en una transacción — si
falla a la mitad, no queda nada a medio migrar.

---

## Lo que todavía no existe

Para que nadie lo busque:

- **Notas de crédito.**
- **Pasarela de pago.**
- **Panel del dueño del SaaS.** Todo se hace con los scripts o contra la base.
- **Cifrado de la clave privada de AFIP.** Está en texto plano en la base.
- **Respaldo automático.** El script existe; correrlo periódicamente, no.

---

## Operadores de la plataforma (superadmin)

Un superadmin puede entrar a la empresa de cualquier cliente y ve los módulos
que todavía no se liberaron. Es el nivel de quien desarrolla y da soporte, no
un rol dentro de una empresa.

```
npm run superadmin -w apps/api -- listar
npm run superadmin -w apps/api -- activar <email>
npm run superadmin -w apps/api -- quitar <email>
```

El usuario tiene que haber entrado al menos una vez para existir en la base.

### Por qué es un script y no un botón

Un endpoint que otorga superadmin es una escalada de privilegios esperando a
que alguien encuentre el IDOR: quien lo llame se vuelve operador de **toda** la
plataforma, no de una empresa. Un script que corre con las credenciales de la
base no tiene esa superficie. Hay un test que falla si algún día aparece código
que escriba `es_superadmin` desde una ruta.

### Qué habilita y qué no

**Habilita** elegir cualquier empresa desde el selector del encabezado, sin
membresía, y ver los módulos no liberados.

**No habilita** ver datos de dos empresas a la vez. Se opera sobre **una
empresa por vez** —la seleccionada— y cada consulta sigue filtrando por
`empresa_id` igual que para cualquier usuario. Lo único que se ensanchó es
*qué* empresa se puede elegir.

### Rastro

Cada request de un superadmin sobre una empresa donde no es miembro se registra
con `superadmin: true` y el `empresaId`. Con el `requestId` se reconstruye todo
lo que tocó en esa sesión:

```
# En los logs de la plataforma
superadmin:true empresaId:12
```

El encabezado además muestra un aviso **«Empresa de cliente»** en ámbar mientras
estás en una empresa ajena. Sin eso es cuestión de tiempo hasta que alguien
cargue una venta en la empresa equivocada.

### Invisibilidad

El superadmin no aparece en la pantalla de Equipo del cliente: esa pantalla
lista membresías, y un superadmin no tiene ninguna en las empresas ajenas.

### Módulos no liberados

Clientes, recetas, producción, caja, impuestos y reportes existen solo para
superadmin. El gate está en tres lugares y hacen falta los tres:

| Dónde | Qué pasa sin él |
|---|---|
| Barra lateral | El ítem se ve y lleva a una pantalla que no carga |
| `RouteGuard` | Entrar por URL a mano funciona |
| **API (`requireSuperadmin`)** | **El menú es cosmética: los datos siguen accesibles** |

La API responde **404**, no 403: un 403 le confirma a quien está probando rutas
que el módulo existe y solo está oculto.

Para liberar uno: sacarlo del grupo «Nuevas funcionalidades» en
`components/navegacion.js`, quitarle `soloSuperadmin` a su ruta en `App.jsx`, y
sacar `requireSuperadmin` de su montaje en `server.js`. El test
`superadmin.test.js` va a fallar hasta que se lo saque también de la lista —
eso es a propósito: liberar un módulo tiene que ser una decisión, no un
descuido.
