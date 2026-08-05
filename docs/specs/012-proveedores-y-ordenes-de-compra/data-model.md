# Modelo de datos: Proveedores y Órdenes de compra — pasada fina

Complementa a [plan.md](./plan.md).

**Ninguna tabla nueva. Ninguna columna nueva. Ningún tipo cambia.** Lo único que
agrega este hito son **cuatro índices**, y existen por una sola razón: la decisión
4 del plan mueve el cálculo del saldo al servidor, y con eso tres tablas que hasta
hoy solo se consultaban por `supplier_id` pasan a consultarse por `empresa_id` en
cada carga de pantalla.

---

## Por qué hace falta la migración

Hoy `Orders.jsx:95-97` suma los movimientos en el navegador, sobre lo que le trajo
`GET /api/suppliers`. Esa consulta trae **todos** los proveedores con **todos** sus
movimientos y **todos** sus documentos, unidos por `supplier_id`, que sí está
indexado (`models/Supplier.js:89`, `:137`, `:178`).

A partir de la decisión 4, la consulta principal es otra:

```sql
SELECT supplier_id, type, SUM(amount)
  FROM supplier_movements
 WHERE empresa_id = $1
 GROUP BY supplier_id, type;
```

**Ninguna de las tres tablas hijas tiene índice por `empresa_id`.** Sin él, esa
consulta es un barrido secuencial de la tabla entera —de **todas** las empresas
cliente— cada vez que alguien abre la pantalla de proveedores. Es el caso donde
un cambio que mejora la corrección empeora el rendimiento si no se acompaña, y por
eso la migración va en el **mismo corte** que el endpoint (corte 4 del plan) y no
después.

---

## Los cuatro índices

| Tabla | Columnas | Qué consulta sirve |
|---|---|---|
| `supplier_movements` | `(empresa_id, supplier_id)` | El `GROUP BY` de saldos del listado, y el `SUM` del saldo inicial de cada página del historial |
| `supplier_orders` | `(empresa_id, status)` | `pendiente_de_recibir`: las órdenes `pending`/`partial` de la empresa |
| `supplier_orders` | `(empresa_id, date)` | `getOrders`: el filtro principal más el `ORDER BY date DESC` que ya tiene (`purchaseService.js:235`) |
| `supplier_documents` | `(empresa_id, supplier_id)` | El conteo de documentos por proveedor del listado (FR-086) |

**Por qué compuestos y no `(empresa_id)` a secas.** Los cuatro casos filtran por
empresa **y** agrupan, ordenan o filtran por una segunda columna. Un índice de una
sola columna obliga a Postgres a leer la fila para la segunda condición; el
compuesto la resuelve en el índice. Y el orden importa: `empresa_id` va primero
porque es el único que está **siempre** presente —es la regla que no se negocia—
mientras que `status`, `date` y `supplier_id` son opcionales.

**Por qué `(empresa_id, date)` y no `(empresa_id, date, id)`.** El
`ORDER BY date DESC, id DESC` de `getOrders` desempata por `id`, pero el desempate
solo importa dentro de una misma fecha y las órdenes de un día son pocas. Tres
columnas para ordenar un puñado de filas es índice que se paga en cada `INSERT`
sin que se note el beneficio.

**Los índices que ya existen no se tocan.** `supplier_orders(supplier_id)`,
`supplier_orders(date)`, `supplier_movements(supplier_id)`,
`supplier_movements(date)` y `supplier_documents(supplier_id)` siguen sirviendo a
las consultas por proveedor, que también siguen existiendo.

---

## El archivo

`apps/api/src/migrations/20260808-indices-de-empresa-en-proveedores.js`

Sigue el molde de `20260807-punto-de-venta-en-cashflow.js`, que es el más reciente
y el que salió del proyecto 0 de `PROXIMOS-PROYECTOS.md`: **SQL crudo, una sola
transacción, `IF NOT EXISTS` en el `up` e `IF EXISTS` en el `down`**.

```js
// El saldo del proveedor pasa a calcularlo el servidor (spec 012, decision 4).
// Con eso, tres tablas que hasta hoy solo se consultaban por supplier_id pasan a
// consultarse por empresa_id en cada carga de pantalla, y ninguna de las tres
// tenia indice por esa columna: el listado de proveedores era un barrido
// secuencial de los movimientos de TODAS las empresas cliente.
//
// Los cuatro son compuestos porque las cuatro consultas filtran por empresa Y
// agrupan, ordenan o filtran por una segunda columna. empresa_id va primero
// porque es el unico que esta siempre.

module.exports = {
  up: async (queryInterface) => {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_supplier_movements_empresa_supplier
          ON supplier_movements (empresa_id, supplier_id);
      `, { transaction: t });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_supplier_orders_empresa_status
          ON supplier_orders (empresa_id, status);
      `, { transaction: t });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_supplier_orders_empresa_date
          ON supplier_orders (empresa_id, date);
      `, { transaction: t });
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_supplier_documents_empresa_supplier
          ON supplier_documents (empresa_id, supplier_id);
      `, { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  // Reversible de verdad: un indice no guarda datos. El down deja el esquema
  // exactamente como estaba y el up puede volver a correr.
  down: async (queryInterface) => {
    const t = await queryInterface.sequelize.transaction();
    try {
      for (const nombre of [
        'idx_supplier_documents_empresa_supplier',
        'idx_supplier_orders_empresa_date',
        'idx_supplier_orders_empresa_status',
        'idx_supplier_movements_empresa_supplier',
      ]) {
        await queryInterface.sequelize.query(
          `DROP INDEX IF EXISTS ${nombre};`, { transaction: t },
        );
      }
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
```

**Sin `CONCURRENTLY`, y hay que decir por qué.** `CREATE INDEX CONCURRENTLY` no
puede correr dentro de una transacción, y las migraciones de este repositorio
corren con lock (`0264075`, «migraciones con lock»). Las tres tablas son chicas
—son las compras de un negocio, no sus ventas— así que el lock de escritura dura
lo que tarda el índice. Si alguna vez dejan de serlo, el cambio es sacar la
transacción y usar `CONCURRENTLY` en un archivo propio.

---

## Y el modelo también cambia

`apps/api/src/models/Supplier.js` gana los mismos cuatro índices en sus bloques
`indexes`:

```js
// supplier_orders  (:88)
indexes: [
  { fields: ['supplier_id'] },
  { fields: ['date'] },
  { fields: ['empresa_id', 'status'] },
  { fields: ['empresa_id', 'date'] },
],

// supplier_movements  (:136)
indexes: [
  { fields: ['supplier_id'] },
  { fields: ['date'] },
  { fields: ['empresa_id', 'supplier_id'] },
],

// supplier_documents  (:177)
indexes: [
  { fields: ['supplier_id'] },
  { fields: ['empresa_id', 'supplier_id'] },
],
```

**Esto no es cosmético.** El proyecto 0 de `PROXIMOS-PROYECTOS.md` cierra con
«faltan además tres índices que los modelos declaran y las migraciones no crean».
Este hito no puede agregar un cuarto caso al revés: un índice que la migración
crea y el modelo no declara desaparecería la primera vez que alguien levante una
base con `sync({ alter: true })` en desarrollo, y nadie lo notaría porque el
`SELECT` sigue funcionando —solo tarda—.

**Los nombres de índice tienen que coincidir.** Sequelize nombra los índices que
declara el modelo como `<tabla>_<col>_<col>`, no como el `idx_…` de la migración.
Sobre una base creada por migraciones eso significa que `sync({ alter: true })`
puede intentar crear un segundo índice con el nombre suyo sobre las mismas
columnas. Para evitarlo, cada entrada del modelo lleva su `name` explícito, igual
que el de la migración:

```js
{ name: 'idx_supplier_movements_empresa_supplier', fields: ['empresa_id', 'supplier_id'] },
```

---

## Lo que este hito NO cambia del modelo, y por qué

| Cosa | Por qué se queda como está |
|---|---|
| `SupplierOrder.detail` sigue siendo **JSONB** | Supuesto 5 de la spec. La identidad de línea del contrato es la **posición en el arreglo** (decisión 1 del plan), que no cuesta ninguna columna |
| No se agrega `linea_id` a las líneas del `detail` | Decisión 1 del plan: las órdenes viejas no lo tendrían y el respaldo sería la posición igual, o sea dos caminos donde uno alcanza |
| `SupplierMovement.due_date` sigue sin usarse | Supuesto 8 de la spec. Existe en el modelo desde siempre y ninguna de las dos secciones del plan menciona vencimientos |
| No se agregan «entrega estimada» ni «condición de pago» a `supplier_orders` | [PENDIENTE 7]. La maqueta las dibuja (`:1136-1137`) y el modelo no las tiene; no se inventan columnas |
| No se asocia `SupplierDocument` a una orden | Fuera de alcance explícito de la spec. El legacy lo tenía (`:8182`) y queda anotado en `PROXIMOS-PROYECTOS.md` |
| No se agrega una columna `saldo` a `suppliers` | Decisión 4 del plan: es una segunda fuente de verdad para plata |
| `supplier_movements.type` y `supplier_orders.status` siguen `ENUM` en el modelo y `VARCHAR` en las migraciones | Es el desajuste abierto del proyecto 0, sobre ocho columnas de todo el sistema. Arreglarlo exige contemplar los dos estados posibles del esquema y es ese proyecto, no éste. **Los índices se crean igual sobre las dos formas**: un índice no depende del tipo de la columna. Riesgo 8 del plan |

---

## Cómo se verifica

1. `npm --prefix apps/api run db:migrate` sobre una base con datos: los cuatro
   índices existen (`\di supplier*` en `psql`) y ninguna consulta cambió de
   resultado.
2. `npm --prefix apps/api run verificar:esquema` pasa. **Ojo con lo que este
   chequeo puede y no puede decir**: hace un `findOne` por modelo, o sea que
   verifica que la tabla y todas las columnas existan. **No mira índices** —está
   escrito en su propio comentario—, así que si la migración se olvidara de uno,
   el chequeo pasaría igual. Lo que sí lo detecta es el paso 4.
3. El `down` corre sin error, `\di` no muestra ninguno de los cuatro, y el `up`
   vuelve a correr sin error. Es el requisito de proyecto 0: las migraciones tienen
   que poder recrear la base, y una que no se puede revertir no se puede probar.
4. Contra Postgres con datos: `EXPLAIN ANALYZE` del `GROUP BY` de movimientos
   usa `idx_supplier_movements_empresa_supplier` y no un `Seq Scan`. Es el único
   paso que verifica que el índice sirva para lo que se creó, y por eso es el que
   no se puede saltear.
