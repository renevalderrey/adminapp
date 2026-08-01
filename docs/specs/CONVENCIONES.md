# Convenciones · Desarrollo dirigido por especificación

Lo que todo agente SDD tiene que saber antes de escribir una línea. Se lee una
vez por ciclo, no se copia en cada archivo.

---

## Por qué existe este método

No es ceremonia. Los errores más caros de este proyecto salieron de implementar
sin definir:

- La calculadora de punto de equilibrio confundía margen sobre venta con
  recargo sobre costo y **recomendaba precios que garantizan pérdida**,
  etiquetados como «precio de supervivencia». Nadie había escrito qué era un
  margen.
- `sendEmail` devolvía `ok: true` sin haber enviado nada. Las invitaciones se
  perdían en silencio y quien invitaba veía «enviada».
- El paywall era eludible: una empresa sin fila de suscripción tenía acceso
  ilimitado.

Los tres son el mismo error: **nadie escribió qué tenía que pasar**, así que no
había contra qué verificar.

---

## Dónde va cada cosa

```
docs/specs/NNN-nombre-corto/
  spec.md         qué problema resuelve y cómo se sabe que está resuelto
  plan.md         cómo se construye, y qué alternativas se descartaron
  data-model.md   tablas, columnas, relaciones (solo si toca la base)
  contracts/      contratos de API
  tasks.md        tareas ejecutables, cada una verificable
```

El número es correlativo. Mirar qué carpetas existen antes de elegirlo.

---

## El repositorio

Monorepo:

| Ruta | Qué es |
|---|---|
| `apps/api` | Node + Express + Sequelize + PostgreSQL |
| `apps/web` | React + Vite + Tailwind v4 + shadcn |
| `apps/landing` | Sitio público |
| `legacy/` | El sistema viejo de Comprafit. **Referencia, no se ejecuta** |

> Las specs 001 a 008 son anteriores al monorepo y referencian `backend/src/…`.
> La ruta correcta hoy es `apps/api/src/…`. No copiar esas rutas.

### Comandos

```
npm run test:api          # jest
npm run test:web          # vitest
npm run build             # web + landing
npm --prefix apps/api run db:migrate
```

---

## Reglas que no se negocian

### Aislamiento entre empresas

Toda consulta que reciba un identificador del cliente filtra por `empresa_id`.
**Nunca `Model.findByPk(req.params.id)`** — usar `findScoped` de
`utils/tenantScope.js`.

Hay guardias estáticas que fallan si el patrón reaparece
(`src/tests/aislamientoEmpresas.test.js`, `src/tests/observabilidad.test.js`).
Si una guardia falla, el problema es el código nuevo, no la guardia.

Esto no es teórico: la auditoría encontró veinte endpoints filtrando datos
entre clientes, y ocho más aparecieron un mes después.

### Errores

Ningún `catch` responde 500 con `err.message`. Usar `fallo(req, res, err,
'mensaje en castellano')` de `utils/errores.js`: loguea con contexto y no le
manda al cliente nombres de tabla ni de constraint.

Para errores que **sí** son para el usuario —«Stock insuficiente en Depósito
para Harina»— existe `ErrorDeNegocio`.

### Dinero

Todo cálculo con plata se testea con casos de borde: cantidad cero, precio
cero, descuento del 100 %, devolución parcial, producto sin costo.

El total de una venta lo calcula **el servidor** a partir de las líneas. Nunca
se guarda un total que mandó el cliente.

Los importes argentinos se escriben `1.234,50`. Leerlos al revés convierte
$1.234 en $1,234 y no falla nada.

### Diseño

Todo lo visual sale de los tokens de `apps/web/src/index.css`. **Cero hex en
los componentes.** Las reglas completas están en
[REGLAS-DISENO.md](../REGLAS-DISENO.md); la referencia viva es
`apps/web/src/pages/Comparador.jsx`.

### Módulos no liberados

Clientes, recetas, producción, caja, impuestos y reportes existen solo para
superadmin. El gate va en los tres lados: barra lateral, `RouteGuard` y **API**
(`requireSuperadmin`). Solo en el menú es cosmética.

---

## Cómo se escribe acá

**Los comentarios explican el porqué, no el qué.** El código ya dice qué hace.
Lo que se pierde con el tiempo es por qué se eligió así y qué pasaba antes:

```js
// Mal
// Recorre los productos y actualiza el costo
for (const p of productos) { … }

// Bien
// El costo se propaga a las recetas que usan este producto como insumo. Sin
// esto, un producto elaborado seguiría costeado con el precio viejo y el
// margen que muestra el POS sería mentira.
for (const p of productos) { … }
```

**En castellano**, como el resto del repositorio. Nombres de variables y
funciones nuevas también.

**Los tests documentan el bug que evitan.** Un test llamado `it('funciona')` no
dice nada; `it('NO lee 1.234 como 1,234')` explica qué se está protegiendo.

**Los mensajes de commit** cuentan qué problema real se resolvió, no qué
archivos se tocaron.

---

## Definición de terminado

Una tarea está terminada cuando:

1. El código hace lo que dice el criterio de aceptación de la spec.
2. Tiene tests, y esos tests **fallan** si se revierte el cambio.
3. `npm run test:api` y `npm run test:web` pasan.
4. `npm run build` pasa.
5. Nada nuevo aparece en las guardias estáticas.

Una funcionalidad está terminada cuando **`sdd-verify` no encontró forma de
romper ningún criterio de aceptación**.
