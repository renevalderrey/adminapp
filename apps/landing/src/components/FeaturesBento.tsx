export default function FeaturesBento() {
  return (
    <section id="features" className="py-24 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-16">
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
            Controla tu negocio como nunca antes,<br className="hidden md:block"/> sin complicaciones.
          </h2>
          <p className="text-xl text-slate-500">
            Olvídate del desorden. Conecta tus datos, automatiza tu facturación y entiende tus finanzas al instante.
          </p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Main Feature - Span 2 columns on desktop */}
          <div className="md:col-span-2 bg-white rounded-3xl p-8 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="aspect-video w-full bg-slate-50 border border-dashed border-gray-200 rounded-xl mb-6 flex items-center justify-center">
              <span className="text-slate-400">Imagen / Mockup Facturación</span>
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-2">Facturación Electrónica Nativa</h3>
            <p className="text-slate-500">
              Integración directa con AFIP. Emite facturas A, B y C con un solo clic. Genera tickets, calcula impuestos automáticamente y lleva tu contabilidad al día sin esfuerzo.
            </p>
          </div>

          {/* Secondary Feature */}
          <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="aspect-square w-full bg-slate-50 border border-dashed border-gray-200 rounded-xl mb-6 flex items-center justify-center">
              <span className="text-slate-400 text-center px-4">Imagen / Mockup <br/> Stock</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Inventario Multi-Sucursal</h3>
            <p className="text-slate-500">
              Control centralizado de stock en diferentes ubicaciones. Actualizaciones en tiempo real.
            </p>
          </div>

          {/* Tertiary Feature 1 */}
          <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-40 w-full bg-slate-50 border border-dashed border-gray-200 rounded-xl mb-6 flex items-center justify-center">
              <span className="text-slate-400">Imagen / Mockup BEP</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Análisis de Rentabilidad</h3>
            <p className="text-slate-500">
              Calculadora de Punto de Equilibrio y control exhaustivo de gastos fijos (GF1/GF2).
            </p>
          </div>

          {/* Tertiary Feature 2 */}
          <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-40 w-full bg-slate-50 border border-dashed border-gray-200 rounded-xl mb-6 flex items-center justify-center">
              <span className="text-slate-400">Imagen / Mockup Proveedores</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Módulo de Proveedores</h3>
            <p className="text-slate-500">
              Comparador de precios, gestión de cuentas corrientes y armado inteligente de pedidos.
            </p>
          </div>

          {/* Tertiary Feature 3 */}
          <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-40 w-full bg-slate-50 border border-dashed border-gray-200 rounded-xl mb-6 flex items-center justify-center">
              <span className="text-slate-400 text-center">Imagen / Mockup <br/> IA</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Carga Inteligente con IA</h3>
            <p className="text-slate-500">
              Automatiza el ingreso de productos leyendo PDFs o imágenes de listas de precios instantáneamente.
            </p>
          </div>

        </div>
      </div>
    </section>
  );
}
