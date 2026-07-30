import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Logos from './components/Logos';
import FeaturesBento from './components/FeaturesBento';
import MiniFeatures from './components/MiniFeatures';
import Pricing from './components/Pricing';
import Testimonials from './components/Testimonials';
import FAQ from './components/FAQ';
import Blog from './components/Blog';
import CTA from './components/CTA';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 overflow-x-hidden selection:bg-blue-200 selection:text-blue-900">
      <Navbar />
      
      <main>
        <Hero />
        <Logos />
        <FeaturesBento />
        <MiniFeatures />
        <Pricing />
        <Testimonials />
        <FAQ />
        <Blog />
        <CTA />
      </main>

      <Footer />
    </div>
  );
}

export default App;
