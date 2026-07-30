export default function Footer() {
  return (
    <footer className="bg-white border-t border-gray-100 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
        <div className="mb-8 md:mb-0">
          <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            GestiónSaaS
          </span>
          <p className="text-sm text-slate-500 mt-2">© {new Date().getFullYear()} GestiónSaaS Inc. Todos los derechos reservados.</p>
        </div>
        
        <div className="flex space-x-12">
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Producto</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#" className="hover:text-blue-600">Características</a></li>
              <li><a href="#" className="hover:text-blue-600">Precios</a></li>
              <li><a href="#" className="hover:text-blue-600">Casos de Uso</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Empresa</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#" className="hover:text-blue-600">Sobre Nosotros</a></li>
              <li><a href="#" className="hover:text-blue-600">Blog</a></li>
              <li><a href="#" className="hover:text-blue-600">Contacto</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#" className="hover:text-blue-600">Términos</a></li>
              <li><a href="#" className="hover:text-blue-600">Privacidad</a></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
