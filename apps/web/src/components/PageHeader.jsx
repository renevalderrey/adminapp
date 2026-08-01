// ════════════════════════════════════════════
//  Encabezado de pantalla
//
//  Todas las pantallas arrancan igual: título, una línea que explica para qué
//  sirve, y las acciones a la derecha.
//
//  La descripción no es relleno. Antes cada pantalla tenía su propio título con
//  su propio tamaño y ninguna decía qué hacía: el usuario nuevo abría
//  "Impuestos" y tenía que deducirlo de la tabla.
//
//  Ver docs/REGLAS-DISENO.md → Patrones → Encabezado de pantalla.
// ════════════════════════════════════════════

export default function PageHeader({ titulo, descripcion, icono: Icono, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2">
          {Icono && <Icono className="h-6 w-6 shrink-0 text-brand" strokeWidth={1.8} />}
          {titulo}
        </h1>
        {descripcion && (
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">{descripcion}</p>
        )}
      </div>

      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
