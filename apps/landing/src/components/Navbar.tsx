export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex-shrink-0 flex items-center">
            <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              GestiónSaaS
            </span>
          </div>
          
          {/* Nav Links */}
          <div className="hidden md:flex space-x-8">
            <a href="#features" className="text-gray-600 hover:text-gray-900 font-medium text-sm">Características</a>
            <a href="#integrations" className="text-gray-600 hover:text-gray-900 font-medium text-sm">Integraciones</a>
            <a href="#pricing" className="text-gray-600 hover:text-gray-900 font-medium text-sm">Precios</a>
            <a href="#testimonials" className="text-gray-600 hover:text-gray-900 font-medium text-sm">Testimonios</a>
          </div>

          {/* CTA Buttons */}
          <div className="flex items-center space-x-4">
            <a href="#" className="text-gray-600 hover:text-gray-900 font-medium text-sm hidden md:block">
              Iniciar sesión
            </a>
            <a href="#" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full font-medium text-sm transition-colors">
              Prueba Gratis
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
