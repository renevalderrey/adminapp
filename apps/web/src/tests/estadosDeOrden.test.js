import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESTADOS } from '@/utils/ordenDeCompra'

// ════════════════════════════════════════════
//  El contrato de los estados de orden entre el navegador y la base
//
//  Los cuatro estados de una orden de compra viven en DOS lados que nada obliga
//  a mantener juntos: el `ENUM` de `supplier_orders`
//  (`apps/api/src/models/Supplier.js`), que es lo único que la base acepta
//  guardar, y `utils/ordenDeCompra.js`, que es lo que la pantalla sabe dibujar.
//
//  Si se separan no falla nada, y ahí está el problema:
//
//   · un estado que el modelo tiene y la web no, se dibuja como código crudo
//     —«partial» en el badge— y nadie lo ve hasta que un cliente lo pregunta;
//   · un estado que la web tiene y el modelo no, es un filtro que no devuelve
//     nunca nada y una etiqueta que no le toca a ninguna orden.
//
//  Esto ya pasó, con el mismo mecanismo, con los medios de pago: el POS escribía
//  `tc3`, un código que no estaba en ninguna lista de etiquetas, y el historial,
//  el archivo exportado y el panel lo imprimieron crudo durante meses.
//
//  Por eso el archivo del modelo se lee COMO TEXTO, igual que hace
//  `tests/mediosDePago.test.js` con `exportVentas.js`: son dos paquetes, el
//  monorepo todavía no tiene uno compartido, e importar Sequelize desde vitest
//  para preguntarle el ENUM levanta la conexión a la base. Es grosero y es
//  exactamente lo que hace falta.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

/** El modelo de la API, leído como texto desde el otro paquete del monorepo. */
const MODELO = fs.readFileSync(
  path.join(AQUI, '../../../api/src/models/Supplier.js'),
  'utf8'
)

/**
 * Los valores del `ENUM` de la columna `status` de `SupplierOrder`.
 *
 * El recorte arranca en `sequelize.define('SupplierOrder'` y sigue por
 * `status: {`, en ese orden, porque el archivo define TRES modelos y tiene otro
 * `DataTypes.ENUM` doce líneas más abajo —el `type` de `SupplierMovement`, que
 * es `deuda` / `pago`—. Un `indexOf('DataTypes.ENUM')` a secas encontraría
 * cualquiera de los dos según el orden en que estén escritos.
 */
function estadosDelModelo() {
  const modelo = MODELO.indexOf("sequelize.define('SupplierOrder'")
  expect(modelo, 'no se encontró el modelo SupplierOrder').toBeGreaterThan(-1)

  const campo = MODELO.indexOf('status: {', modelo)
  expect(campo, 'no se encontró el campo status').toBeGreaterThan(modelo)

  const abre = MODELO.indexOf('DataTypes.ENUM(', campo)
  expect(abre, 'el campo status dejó de ser un ENUM').toBeGreaterThan(campo)

  const cierra = MODELO.indexOf(')', abre)
  const bloque = MODELO.slice(abre, cierra)

  return [...bloque.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('Los estados de la pantalla y los del modelo no se separaron', () => {
  it('la lista de la pantalla y el ENUM del modelo no se separaron', () => {
    // La igualdad se afirma en LOS DOS SENTIDOS: una clave de más en la web es
    // un estado que la base no puede guardar; una de más en el modelo es un
    // estado que la pantalla dibujaría crudo.
    const modelo = [...estadosDelModelo()].sort()
    const pantalla = Object.keys(ESTADOS).sort()

    expect(pantalla).toEqual(modelo)
  })

  it('la lectura del modelo encontró algo: no pasa por leer vacío', () => {
    // Una guardia que lee con una ruta equivocada compara dos listas vacías y
    // pasa siempre. Si el archivo se mueve o el modelo se renombra, falla acá y
    // no en silencio.
    expect(estadosDelModelo()).toEqual(
      expect.arrayContaining(['pending', 'partial', 'received', 'cancelled'])
    )
  })
})

// ════════════════════════════════════════════
//  Las copias de la lista no vuelven
//
//  Sin esta guardia la copia vuelve la próxima vez que alguien necesite una
//  etiqueta y no quiera importar nada — que es exactamente cómo llegaron a ser
//  dos, con textos distintos entre sí.
// ════════════════════════════════════════════

const PANTALLAS = ['pages/Orders.jsx', 'pages/PurchaseOrders.jsx'].map((nombre) => ({
  nombre,
  contenido: fs.readFileSync(path.join(SRC, nombre), 'utf8'),
}))

describe('Ninguna de las dos pantallas tiene su propia copia de las etiquetas', () => {
  it.each(PANTALLAS)('$nombre NO declara su propio STATUS_LABELS', ({ contenido }) => {
    expect(contenido).not.toMatch(/STATUS_LABELS\s*=\s*\{/)
    expect(contenido).not.toMatch(/STATUS_VARIANTS\s*=\s*\{/)
  })

  it.each(PANTALLAS)('$nombre usa la lista compartida', ({ contenido }) => {
    // Sin esto, borrar la copia y dejar el badge mostrando `o.status` pelado
    // también pasaría la guardia de arriba: la pantalla quedaría dibujando el
    // código crudo, que es el defecto que este archivo existe para impedir.
    expect(contenido).toMatch(/from '@\/utils\/ordenDeCompra'/)
    expect(contenido).toMatch(/ESTADOS\[/)
  })
})
