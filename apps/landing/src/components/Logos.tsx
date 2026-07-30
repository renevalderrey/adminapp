export default function Logos() {
  return (
    <section className="py-10 border-b border-gray-100 bg-white/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-8">
          Integraciones y herramientas compatibles
        </p>
        <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-60 grayscale hover:grayscale-0 transition-all duration-300">
           {/* Placeholder texts for logos, since we don't have actual SVG logos yet */}
           <span className="text-xl font-bold font-serif">AFIP</span>
           <span className="text-xl font-bold font-sans">Excel</span>
           <span className="text-xl font-bold italic">WhatsApp</span>
           <span className="text-xl font-bold font-mono">PDF</span>
           <span className="text-xl font-bold">MercadoPago</span>
        </div>
      </div>
    </section>
  );
}
