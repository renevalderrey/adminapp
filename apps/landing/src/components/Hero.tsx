export default function Hero() {
  return (
    <section className="relative pt-32 pb-20 overflow-hidden">
      {/* Background blobs for the soft gradient effect */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] opacity-30 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-400 to-purple-400 rounded-full blur-3xl mix-blend-multiply filter animate-blob"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 tracking-tight mb-6">
          Gestión inteligente <br className="hidden md:block" /> para tu empresa
        </h1>
        <p className="mt-4 text-xl md:text-2xl text-slate-500 max-w-3xl mx-auto mb-10">
          El primer sistema para controlar tu stock, proveedores y facturación que amarás. Y el último que necesitarás.
        </p>

        {/* Placeholder for Dashboard Mockup */}
        <div className="relative mx-auto max-w-5xl">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-2xl p-2 md:p-4 aspect-video flex items-center justify-center relative overflow-hidden">
             {/* Decorative Window Controls */}
             <div className="absolute top-4 left-4 flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                <div className="w-3 h-3 rounded-full bg-green-400"></div>
             </div>
             
             <div className="w-full h-full border border-dashed border-gray-300 rounded-xl bg-slate-50 flex items-center justify-center flex-col mt-6">
                <span className="text-slate-400 text-lg font-medium">Imagen / Mockup del Sistema</span>
                <span className="text-slate-400 text-sm mt-2">(Dashboard Principal)</span>
             </div>
          </div>
        </div>
      </div>
    </section>
  );
}
