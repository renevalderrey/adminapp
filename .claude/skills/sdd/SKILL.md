---
name: sdd
description: Corre el ciclo de desarrollo dirigido por especificación sobre una funcionalidad — spec, plan, tareas, implementación y verificación. Se detiene después de la spec para que la revises. Usalo para cualquier funcionalidad nueva de Favalio. Trigger - "/sdd", "nueva funcionalidad", "arrancá una feature".
---

# Ciclo SDD

Cinco etapas. Cada una es un agente con su propio criterio de terminado.

```
sdd-spec  →  [ALTO: revisión]  →  sdd-plan  →  sdd-tasks  →  sdd-implement  →  sdd-verify
```

## Cómo se usa

```
/sdd <lo que hay que construir>
```

Ejemplo: `/sdd que el inventario se pueda exportar a PDF`

## Las etapas

### 1 · Especificación

Lanzá el agente **`sdd-spec`** con el pedido tal como llegó.

Produce `docs/specs/NNN-nombre/spec.md`.

### 2 · ALTO

**No sigas solo.** Presentá al usuario:

- Las historias con su prioridad.
- Los criterios de aceptación, en una línea cada uno.
- **Los `[PENDIENTE DE DEFINIR]`**, que son los que hay que resolver con él.

Esperá su visto bueno. Es el único punto del ciclo donde una decisión
equivocada cuesta la funcionalidad entera: seguir de largo acá es exactamente
el error que este método existe para evitar.

Si hay pendientes de definir, usá `AskUserQuestion` en vez de suponer.

### 3 · Diseño técnico

Con la spec aprobada, lanzá **`sdd-plan`**.

Produce `plan.md`, y `data-model.md` y `contracts/` si corresponde.

Si el plan encuentra que algo de la spec no se puede construir como está
pedido, volvé al paso 2.

### 4 · Tareas

Lanzá **`sdd-tasks`**. Produce `tasks.md`.

### 5 · Implementación

Lanzá **`sdd-implement`**. Para funcionalidades grandes, por fases: una fase,
tests verdes, commit, siguiente fase.

Cada fase termina en un punto usable — si al terminar una fase no se puede
probar nada, las tareas estaban mal cortadas.

### 6 · Verificación

Lanzá **`sdd-verify`**. **No lo saltees porque los tests pasan.**

Los tests prueban lo que alguien pensó en probar. `sdd-verify` prueba contra lo
que la spec prometió, que es otra cosa: es el que hubiera atrapado que
`sendEmail` devolvía `ok: true` sin haber enviado nada — porque todos sus tests
pasaban.

Si encuentra hallazgos, se corrigen y se vuelve a verificar. Una funcionalidad
está terminada cuando `sdd-verify` no encuentra forma de romper ningún criterio.

## Cuándo NO usar el ciclo completo

- **Corregir un bug con causa conocida** — se arregla, se le pone un test que
  falla sin el arreglo, y listo.
- **Cambios de estilo o de texto.**
- **Refactor sin cambio de comportamiento** — lo que garantiza que está bien
  son los tests que ya existen.

Para todo lo demás, el ciclo. Los tres errores más caros de este proyecto —el
punto de equilibrio que recomendaba precios con pérdida, el paywall eludible,
los emails que se perdían en silencio— salieron de implementar sin definir.

## El norte

Todo esto apunta a una sola cosa, que está en
[docs/PLAN-COMPRAFIT.md](../../../docs/PLAN-COMPRAFIT.md):

> **Comprafit abre Favalio un lunes a la mañana y hace su semana completa sin
> volver al sistema viejo ni una vez.**

Una funcionalidad que no acerca a eso, o que lo acerca a costa de romper algo
que ya funcionaba, no está terminada aunque pasen los tests.

## Las reglas del repositorio

Están en [docs/specs/CONVENCIONES.md](../../../docs/specs/CONVENCIONES.md). Los
agentes las leen solos; conviene que vos también las conozcas para poder
discutirles.
