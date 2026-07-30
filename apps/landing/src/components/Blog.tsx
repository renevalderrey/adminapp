export default function Blog() {
  const posts = [
    { title: "Guía definitiva para la facturación electrónica con AFIP", category: "Tutorial", date: "Abril 10, 2026" },
    { title: "Cómo calcular tu Punto de Equilibrio (BEP)", category: "Finanzas", date: "Marzo 22, 2026" },
    { title: "Estrategias para gestionar proveedores eficientemente", category: "Gestión", date: "Febrero 15, 2026" }
  ];

  return (
    <section className="py-24 bg-white border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-12">Desde nuestro blog</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {posts.map((post, idx) => (
            <div key={idx} className="group cursor-pointer">
              <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide mb-2">{post.category} <span className="text-slate-400 mx-2">•</span> <span className="text-slate-500 font-normal">{post.date}</span></p>
              <h3 className="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{post.title}</h3>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
