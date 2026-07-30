import { useState } from 'react';

export default function Pricing() {
  const [annual, setAnnual] = useState(true);

  return (
    <section id="pricing" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
            Paga solo por lo <span className="text-blue-600">que necesitas</span>
          </h2>
          <p className="text-xl text-slate-500">
            Únete a cientos de empresas que ya optimizan su gestión.
          </p>

          {/* Toggle */}
          <div className="mt-8 flex items-center justify-center space-x-3">
            <span className={`text-sm font-medium ${!annual ? 'text-slate-900' : 'text-slate-500'}`}>Mensual</span>
            <button 
              onClick={() => setAnnual(!annual)}
              className="relative inline-flex h-6 w-11 items-center rounded-full bg-blue-600 transition-colors focus:outline-none"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${annual ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className={`text-sm font-medium ${annual ? 'text-slate-900' : 'text-slate-500'}`}>Anual <span className="text-green-500 text-xs ml-1 font-bold">-20%</span></span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          
          {/* Plan Inicial */}
          <div className="bg-white rounded-3xl p-8 border border-gray-200 shadow-sm hover:shadow-md transition-all flex flex-col">
            <h3 className="text-lg font-semibold text-slate-900">Plan Inicial</h3>
            <div className="mt-4 mb-2 flex items-baseline">
              <span className="text-4xl font-extrabold text-slate-900">$0</span>
            </div>
            <p className="text-sm text-slate-500 mb-8 min-h-[40px]">
              Ideal para emprendedores y pequeños negocios dando sus primeros pasos.
            </p>
            <button className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-full py-3 font-medium transition-colors mt-auto">
              Comenzar gratis
            </button>
            
            <div className="mt-8 space-y-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-slate-400 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">100 facturas mensuales</span>. Suficiente para arrancar.</p>
              </div>
              <div className="flex items-start">
                <svg className="w-5 h-5 text-slate-400 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">1 sucursal</span>. Control de stock básico.</p>
              </div>
            </div>
          </div>

          {/* Plan Pro */}
          <div className="bg-white rounded-3xl p-8 border-2 border-blue-100 shadow-xl relative flex flex-col scale-105 z-10">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
              Más popular
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Negocios</h3>
            <div className="mt-4 mb-2 flex items-baseline">
              <span className="text-4xl font-extrabold text-slate-900">{annual ? '$45' : '$55'}</span>
              <span className="text-slate-500 ml-1 text-sm">/mes</span>
            </div>
            <p className="text-sm text-slate-500 mb-8 min-h-[40px]">
              Para empresas en crecimiento que buscan centralizar toda su operativa.
            </p>
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-full py-3 font-medium transition-colors mt-auto">
              Prueba gratuita
            </button>
            
            <div className="mt-8 space-y-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-500 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">Facturación ilimitada</span>. Conexión directa con AFIP.</p>
              </div>
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-500 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">Módulos completos</span>. Proveedores, BEP e IA ilimitada.</p>
              </div>
            </div>
          </div>

          {/* Plan Enterprise */}
          <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-3xl p-8 shadow-lg flex flex-col text-white">
            <h3 className="text-lg font-semibold text-blue-100">Corporativo</h3>
            <div className="mt-4 mb-2 flex items-baseline">
              <span className="text-4xl font-extrabold">A medida</span>
            </div>
            <p className="text-sm text-blue-100 mb-8 min-h-[40px]">
              Para organizaciones con alta complejidad y múltiples sucursales.
            </p>
            <button className="w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-full py-3 font-medium transition-colors mt-auto backdrop-blur-sm">
              Hablar con ventas
            </button>
            
            <div className="mt-8 space-y-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-200 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                <p className="text-sm text-blue-50"><span className="font-semibold text-white">Migración dedicada</span>. Traemos tu historial desde cualquier sistema.</p>
              </div>
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-200 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                <p className="text-sm text-blue-50"><span className="font-semibold text-white">Soporte prioritario</span>. Atención 24/7 y SLA garantizado.</p>
              </div>
            </div>
          </div>

        </div>

        {/* Implementation Services (Fractional Team equivalent) */}
        <div className="mt-24 pt-16 border-t border-gray-100 flex flex-col md:flex-row items-center justify-between">
          <div className="md:w-1/2 mb-8 md:mb-0">
            <h3 className="text-3xl font-bold text-slate-900 mb-4">Un equipo de expertos<br/> a tu servicio</h3>
            <p className="text-slate-500 mb-6 max-w-md">
              ¿Necesitas ayuda para configurar el catálogo, vincular AFIP o capacitar a tu personal? Nuestros especialistas lo hacen por ti.
            </p>
            <div className="flex flex-wrap gap-4 text-sm font-medium text-slate-600">
               <span className="flex items-center"><span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span> Capacitación a empleados</span>
               <span className="flex items-center"><span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span> Carga inicial de stock</span>
               <span className="flex items-center"><span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span> Trámites AFIP</span>
            </div>
          </div>
          
          <div className="md:w-1/3 w-full bg-slate-50 rounded-2xl p-8 border border-gray-200 text-center">
             <span className="text-sm text-slate-500 font-medium uppercase tracking-wide">Comienza desde</span>
             <div className="my-2">
               <span className="text-4xl font-extrabold text-slate-900">$150</span><span className="text-slate-500"> / pago único</span>
             </div>
             <button className="w-full mt-4 bg-slate-900 hover:bg-slate-800 text-white rounded-full py-3 font-medium transition-colors">
               Consultar por implementación
             </button>
          </div>
        </div>

      </div>
    </section>
  );
}
