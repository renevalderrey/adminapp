import { BRAND, CONTACT_URL } from '../config';

export default function Footer() {
  return (
    <footer className="bg-white border-t border-gray-100 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
        <div className="mb-8 md:mb-0">
          <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            {BRAND}
          </span>
          <p className="text-sm text-slate-500 mt-2">© {new Date().getFullYear()} {BRAND}. Todos los derechos reservados.</p>
        </div>

        <div className="flex space-x-12">
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Producto</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#features" className="hover:text-blue-600">Características</a></li>
              <li><a href="#pricing" className="hover:text-blue-600">Precios</a></li>
              <li><a href="#testimonials" className="hover:text-blue-600">Casos de Uso</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Empresa</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#faq" className="hover:text-blue-600">Preguntas frecuentes</a></li>
              <li><a href="#blog" className="hover:text-blue-600">Blog</a></li>
              <li><a href={CONTACT_URL} className="hover:text-blue-600">Contacto</a></li>
            </ul>
          </div>
          {/*
            TODO: Terminos y Privacidad todavia no existen. Son requisito para
            cobrar (pasarela de pago) y para el consentimiento de datos, asi que
            hay que redactarlos antes de salir a venta. Hasta entonces apuntan a
            contacto en lugar de a un ancla muerta.
          */}
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href={CONTACT_URL} className="hover:text-blue-600">Términos</a></li>
              <li><a href={CONTACT_URL} className="hover:text-blue-600">Privacidad</a></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
