

export default function FAQ() {
  const faqs = [
    {
      question: "¿Qué necesito para empezar a facturar electrónicamente?",
      answer: "Solo necesitas tu CUIT y tu Clave Fiscal nivel 3. Nuestro sistema te guía paso a paso para generar los certificados en AFIP y delegar el servicio web, todo en menos de 10 minutos."
    },
    {
      question: "¿Puedo importar mis productos desde otro sistema o Excel?",
      answer: "¡Sí! Puedes importar todo tu catálogo masivamente usando archivos de Excel o CSV. Además, nuestra IA te permite subir una lista de precios en PDF o imagen y la convierte automáticamente en productos."
    },
    {
      question: "¿Hay límite de usuarios o sucursales?",
      answer: "Depende del plan que elijas. El plan Inicial está pensado para 1 sucursal, mientras que el plan Negocios y Corporativo te permiten gestionar múltiples ubicaciones de forma centralizada con usuarios ilimitados."
    },
    {
      question: "¿Qué es la calculadora de Punto de Equilibrio (BEP)?",
      answer: "Es una herramienta integrada que analiza tus costos fijos y el costo de tu mercadería para indicarte exactamente a qué precio debes vender para no perder dinero y alcanzar tus objetivos de ganancia."
    },
    {
      question: "¿Ofrecen prueba gratuita?",
      answer: "Sí, puedes probar todas las funcionalidades del plan Negocios de forma totalmente gratuita por 14 días. No requiere tarjeta de crédito."
    }
  ];

  return (
    <section className="py-24 bg-slate-50 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row gap-12">
          
          <div className="md:w-1/3">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Preguntas Frecuentes</h2>
            <p className="text-slate-500 mb-6">
              ¿Tienes alguna otra duda? <a href="#" className="text-blue-600 hover:underline font-medium">Habla con nosotros</a>.
            </p>
          </div>

          <div className="md:w-2/3 space-y-8">
            {faqs.map((faq, index) => (
              <div key={index} className="border-b border-gray-200 pb-8 last:border-0 last:pb-0">
                <h4 className="text-lg font-semibold text-slate-900 mb-2">{faq.question}</h4>
                <p className="text-slate-600 leading-relaxed">{faq.answer}</p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </section>
  );
}
