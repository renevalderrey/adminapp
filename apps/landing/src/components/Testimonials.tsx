export default function Testimonials() {
  const reviews = [
    { name: "Juan Pérez", role: "Dueño de Retail", text: "Antes pasábamos horas cuadrando la caja y el stock. Ahora todo está automatizado. Nos ahorra al menos 10 horas a la semana." },
    { name: "María Gómez", role: "Distribuidora Mayorista", text: "El control de proveedores y la calculadora de punto de equilibrio cambiaron por completo cómo vemos nuestra rentabilidad." },
    { name: "Carlos Ruiz", role: "Emprendedor", text: "La integración con AFIP es transparente. Emitir facturas nunca fue tan rápido, y el soporte técnico siempre está ahí." },
  ];

  return (
    <section id="testimonials" className="py-24 bg-slate-50 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Cientos de emprendedores<br/>ya confían en nosotros</h2>
        <p className="text-slate-500 mb-12">No tomes solo nuestra palabra. Mira lo que dicen nuestros usuarios.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {reviews.map((rev, idx) => (
            <div key={idx} className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-slate-600 mb-6 italic">"{rev.text}"</p>
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold mr-3">
                  {rev.name.charAt(0)}
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">{rev.name}</h4>
                  <span className="text-xs text-slate-500">{rev.role}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
