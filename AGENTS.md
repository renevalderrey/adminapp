# AdminApp

SaaS multi-empresa de gestión comercial y facturación electrónica (AFIP).
Monorepo: `apps/api` (Node + Express + Sequelize + PostgreSQL), `apps/web`
(React + Vite + Tailwind v4), `apps/landing`.

`legacy/` es el sistema anterior de Comprafit. Es **referencia**, no se
ejecuta.

---

## Antes de escribir código

Leé, en este orden:

| Documento | Qué te dice |
|---|---|
| [docs/specs/CONVENCIONES.md](docs/specs/CONVENCIONES.md) | Cómo se trabaja acá y qué reglas no se negocian |
| [docs/REGLAS-DISENO.md](docs/REGLAS-DISENO.md) | El sistema de diseño: tokens, tipografía, patrones |
| [docs/PLAN-COMPRAFIT.md](docs/PLAN-COMPRAFIT.md) | Hacia dónde va el producto y en qué orden |
| [docs/OPERACION.md](docs/OPERACION.md) | Qué hacer cuando algo se rompe en producción |

---

## El método

Toda funcionalidad nueva pasa por el ciclo SDD: **`/sdd <lo que hay que
construir>`**.

```
spec  →  [revisión]  →  plan  →  tareas  →  implementación  →  verificación
```

Los cinco agentes están en `.claude/agents/`. El que más importa es
`sdd-verify`: verifica contra la especificación, no contra el código.

**Excepciones al ciclo**: corregir un bug con causa conocida, cambios de texto
o estilo, y refactors sin cambio de comportamiento.

---

## Las cuatro reglas que rompen cosas si se olvidan

### 1 · Aislamiento entre empresas

Toda consulta con un id que viene del cliente filtra por `empresa_id`.
**Nunca `Model.findByPk(req.params.id)`** — usar `findScoped` de
`apps/api/src/utils/tenantScope.js`.

Hay guardias estáticas que fallan si el patrón reaparece. Si una falla, el
problema es el código nuevo.

### 2 · Errores

En los `catch`: `fallo(req, res, err, 'mensaje en castellano')` de
`utils/errores.js`. **Nunca** `res.status(500).json({ error: err.message })` —
eso no loguea nada y le manda al cliente nombres de tabla y de constraint.

### 3 · Colores

Todo sale de los tokens de `apps/web/src/index.css`. **Cero hex en los
componentes.**

```jsx
// Mal — no existe en modo oscuro
<Button className="bg-[#00B4B6] hover:bg-[#008B8E] text-white">

// Bien
<Button>                                    // el primario ya es la marca
<button className="bg-brand hover:bg-brand-dark text-white">
```

Un botón principal por pantalla. Los secundarios son `variant="outline"`.

> Esta regla reemplaza a la anterior de este archivo, que mandaba hardcodear
> `#00B4B6` en cada botón. Con el sistema de tokens eso rompe el modo oscuro y
> obliga a tocar cada pantalla cuando cambia un color.

### 4 · Módulos no liberados

Clientes, recetas, producción, caja, impuestos y reportes existen solo para
superadmin. El gate va en los **tres** lados: barra lateral, `RouteGuard` y API
(`requireSuperadmin`). Solo en el menú es cosmética.

---

## Comandos

```
npm run dev               # api + web + landing
npm run test:api          # jest
npm run test:web          # vitest
npm run build             # web + landing

npm --prefix apps/api run db:migrate
npm --prefix apps/api run superadmin -- listar
npm --prefix apps/api run suscripcion -- listar
npm --prefix apps/api run backup -- --empresa=<id>
npm --prefix apps/api run migrar:legacy -- --empresa=<id>
```

---

## Referencia viva

`apps/web/src/pages/Comparador.jsx` está construida con el sistema de diseño de
punta a punta. Cuando una regla de `REGLAS-DISENO.md` no se entienda, mirar
ahí.
