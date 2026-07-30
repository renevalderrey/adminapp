import { CONTACT_URL, SIGNUP_URL } from '../config';

export default function CTA() {
  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-12 md:p-20 text-center relative overflow-hidden shadow-xl">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-white opacity-10 blur-2xl"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-indigo-900 opacity-20 blur-3xl"></div>
        
        <div className="relative z-10">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Hacemos la gestión<br/>fácil para todos.
          </h2>
          <p className="text-blue-100 text-lg mb-10 max-w-2xl mx-auto">
            Toma el control de tu empresa hoy. Únete a los emprendedores que ya están simplificando su facturación, inventario y finanzas.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a href={SIGNUP_URL} className="bg-white text-blue-600 hover:bg-gray-50 px-8 py-3 rounded-full font-bold text-lg transition-colors shadow-lg">
              Empieza gratis
            </a>
            <a href={CONTACT_URL} className="bg-blue-700/50 hover:bg-blue-700/70 text-white border border-blue-500 px-8 py-3 rounded-full font-bold text-lg transition-colors">
              Agenda una demo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
