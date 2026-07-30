export default function MiniFeatures() {
  const features = [
    { title: "Múltiples Listas de Precios", desc: "Efectivo, Tarjeta, Mayorista y alianzas especiales." },
    { title: "Control de Caja", desc: "Registro de ingresos, egresos y control de turnos." },
    { title: "Exportación Fácil", desc: "Descarga tus reportes en Excel o PDF al instante." },
    { title: "Historial Detallado", desc: "Auditoría completa de todas las transacciones." },
    { title: "Dashboard Financiero", desc: "Métricas clave de ventas y gastos en tiempo real." },
    { title: "Soporte Técnico", desc: "Asistencia directa para configurar tu cuenta." }
  ];

  return (
    <section className="py-20 bg-white border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-3xl font-bold text-slate-900 mb-2">¿Necesitas más? Lo tenemos.</h2>
        <p className="text-slate-500 mb-16">Características pensadas para que tu negocio funcione como reloj suizo.</p>
        
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-12 gap-x-8">
          {features.map((item, idx) => (
            <div key={idx} className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                {/* SVG Icon Placeholder */}
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <h4 className="font-semibold text-slate-900 mb-2">{item.title}</h4>
              <p className="text-sm text-slate-500 max-w-xs">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
