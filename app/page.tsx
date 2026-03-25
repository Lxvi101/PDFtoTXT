import Link from "next/link";

function NoiseOverlay() {
  return <div className="noise-bg fixed inset-0 z-50 pointer-events-none opacity-[0.05]"></div>;
}

function GridBackground() {
  return <div className="fixed inset-0 grid-bg pointer-events-none z-[-1]"></div>;
}

function Marquee({ text }: { text: string }) {
  return (
    <div className="w-full overflow-hidden bg-[#CCFF00] py-4 transform -skew-y-2 border-y-4 border-black relative z-10">
      <div className="flex animate-marquee whitespace-nowrap">
        {Array(10)
          .fill(text)
          .map((item, i) => (
            <span key={i} className="text-black font-bold text-2xl mx-8 uppercase tracking-widest font-[Syncopate]">
              {item}
            </span>
          ))}
      </div>
    </div>
  );
}

function GlitchText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`glitch-text inline-block relative ${className}`} data-text={text}>
      {text}
    </span>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen text-[#f0f0f0] bg-[#050505] selection:bg-[#CCFF00] selection:text-black overflow-x-hidden relative">
      <NoiseOverlay />
      <GridBackground />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-6 py-6 backdrop-blur-sm border-b border-white/5">
        <Link href="/" className="text-2xl font-bold font-[Syncopate] tracking-tighter hover:text-[#CCFF00] transition-colors">
          DOCMIND
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/sign-in" className="hidden md:block text-sm uppercase tracking-widest text-[#f0f0f0]/60 hover:text-[#CCFF00] transition-colors">
            Login
          </Link>
          <Link href="/sign-in" className="cta-button">
            Launch App
          </Link>
        </div>
      </nav>

      <main className="pt-32 pb-20 relative z-10">
        
        {/* Hero Section */}
        <section className="px-6 min-h-[80vh] flex flex-col items-center justify-center text-center relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#CCFF00] rounded-full blur-[150px] opacity-10 pointer-events-none"></div>
          
          <div className="space-y-2 mb-8">
            <span className="inline-block px-4 py-1 border border-[#CCFF00] text-[#CCFF00] text-xs uppercase tracking-[0.3em] font-bold bg-[#CCFF00]/10 backdrop-blur-md">
              THE AI PRE-PROCESSING LAYER
            </span>
          </div>
          
          <h1 className="text-[12vw] leading-[0.8] font-[Syncopate] font-bold tracking-tighter text-transparent bg-clip-text bg-linear-to-b from-white to-white/50 select-none">
            YOUR AI IS<br />
            <span className="text-[#CCFF00]">BLIND</span>
          </h1>
          
          <p className="max-w-xl mx-auto mt-12 text-lg md:text-xl text-[#f0f0f0]/60 font-light leading-relaxed">
            LLMs struggle with PDFs. They lose context, hallucinate on tables, and choke on layouts. We convert documents into <span className="text-[#CCFF00] font-bold">semantic Markdown</span>—the only language your AI truly understands.
          </p>

          <div className="mt-12 flex flex-col sm:flex-row gap-6 items-center">
            <Link href="/sign-in" className="cta-button group">
              <span className="relative z-10">Convert for AI</span>
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
            </Link>
            <Link href="#how-it-works" className="text-sm uppercase tracking-widest text-[#f0f0f0]/40 hover:text-[#f0f0f0] transition-colors border-b border-transparent hover:border-[#f0f0f0]">
              See Protocol
            </Link>
          </div>
        </section>

        {/* Marquee */}
        <div className="py-20">
          <Marquee text="PIXELS ARE NOT DATA • STRUCTURE IS CONTEXT • STOP FEEDING JUNK TO YOUR MODEL • CLEAN MARKDOWN EXPORTS • NATIVE LATEX PARSING • " />
        </div>

        {/* Stats Grid - The Problem */}
        <section className="px-6 py-20 max-w-7xl mx-auto">
          <div className="text-center mb-16 space-y-4">
             <h2 className="text-4xl md:text-5xl font-[Syncopate] font-bold uppercase text-white">THE CONTEXT GAP</h2>
             <p className="text-xl text-[#f0f0f0]/60 max-w-2xl mx-auto">
               Sending raw PDFs to an LLM is like asking a human to read a book in a dark room. Precision requires structure.
             </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Raw PDF Input", value: "Opaque" },
              { label: "Standard OCR", value: "Flat Text" },
              { label: "DocMind Output", value: "Semantic" },
              { label: "Token Efficiency", value: "Optimized" }
            ].map((stat, i) => (
              <div key={i} className="glass-card neon-border group">
                <p className="text-[#f0f0f0]/40 text-xs uppercase tracking-widest mb-2">{stat.label}</p>
                <p className="text-3xl font-[Syncopate] font-bold group-hover:text-[#CCFF00] transition-colors">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Feature Bento Grid - The Solution */}
        <section id="how-it-works" className="px-6 py-20 max-w-7xl mx-auto space-y-20">
          <div className="text-center space-y-4">
            <h2 className="text-4xl md:text-6xl font-[Syncopate] font-bold uppercase">
              Model <span className="text-transparent bg-clip-text bg-linear-to-r from-[#7000FF] to-[#CCFF00]">Ready</span>
            </h2>
            <p className="text-[#f0f0f0]/60 max-w-2xl mx-auto">
              Don&apos;t train on noise. We extract the signal.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 grid-rows-2 gap-6 h-[800px] md:h-[600px]">
            {/* Feature 1 - Large */}
            <div className="md:col-span-2 row-span-2 glass-card neon-border relative overflow-hidden group">
              <div className="absolute inset-0 bg-linear-to-br from-[#7000FF]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative z-10 h-full flex flex-col justify-between">
                <div>
                  <h3 className="text-3xl font-bold mb-4 font-[Syncopate]">Structure Preservation</h3>
                  <p className="text-[#f0f0f0]/60 max-w-md">
                    An AI can&apos;t analyze a financial table if it looks like a soup of numbers. We reconstruct rows, columns, and headers so your model can perform accurate reasoning.
                  </p>
                </div>
                <div className="mt-8 border border-white/10 rounded bg-black/50 p-4 font-mono text-xs text-[#CCFF00]/80">
                  {`# Financial Report 2026`}
                  <br />
                  <br />
                  {`| Category | Q1 | Q2 | Growth |`}
                  <br />
                  {`| :--- | :--- | :--- | :--- |`}
                  <br />
                  {`| Revenue | $2.4M | $3.1M | +29% |`}
                  <br />
                  {`| Operating Costs | $1.1M | $1.0M | -9% |`}
                </div>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="glass-card neon-border flex flex-col justify-center items-center text-center group">
              <div className="w-16 h-16 rounded-full border border-[#CCFF00] flex items-center justify-center mb-6 group-hover:bg-[#CCFF00] group-hover:text-black transition-all duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <h3 className="text-xl font-bold font-[Syncopate] mb-2">Zero Hallucination</h3>
              <p className="text-sm text-[#f0f0f0]/60">By providing exact text representations of visuals and math (LaTeX), we reduce model guessing.</p>
            </div>

            {/* Feature 3 */}
            <div className="glass-card neon-border flex flex-col justify-center items-center text-center group">
              <div className="w-16 h-16 rounded-full border border-[#7000FF] flex items-center justify-center mb-6 group-hover:bg-[#7000FF] transition-all duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <h3 className="text-xl font-bold font-[Syncopate] mb-2">API Ready</h3>
              <p className="text-sm text-[#f0f0f0]/60">Designed for developers building RAG pipelines. Integrate clean data streams directly into your application.</p>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="px-6 py-20 max-w-7xl mx-auto relative">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#7000FF] rounded-full blur-[150px] opacity-10 pointer-events-none"></div>

          <h2 className="text-4xl md:text-6xl font-[Syncopate] font-bold uppercase text-center mb-20">
            Data <span className="text-[#CCFF00]">Capacity</span>
          </h2>

          <div className="grid md:grid-cols-3 gap-8 items-end">
            {[
              {
                title: "Initiate",
                price: "0",
                credits: "100",
                features: ["Basic Text Extraction", "100 Page Limit", "Community Support"],
                color: "border-white/10"
              },
              {
                title: "Professional",
                price: "9",
                credits: "500",
                features: ["Table & Math Optimization", "Export to CSV", "Email Support"],
                color: "border-[#CCFF00]",
                popular: true
              },
              {
                title: "Enterprise",
                price: "129",
                credits: "10k",
                features: ["Dedicated API", "RAG Pipeline Integration", "24/7 SLAS"],
                color: "border-[#7000FF]"
              }
            ].map((plan, i) => (
              <div key={i} className={`glass-card relative ${plan.popular ? 'bg-white/5 border-[#CCFF00] transform scale-105 z-10' : 'border-white/10 opacity-80 hover:opacity-100 hover:scale-[1.02]'} transition-all duration-300`}>
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#CCFF00] text-black text-xs font-bold px-3 py-1 uppercase tracking-widest">
                    Recommended
                  </div>
                )}
                <h3 className="text-lg font-[Syncopate] font-bold uppercase mb-2 text-[#f0f0f0]">{plan.title}</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-bold text-[#f0f0f0]">$</span>
                  <span className={`text-6xl font-bold font-[Syncopate] ${plan.popular ? 'text-[#CCFF00]' : 'text-white'}`}>{plan.price}</span>
                </div>
                <div className="mb-8 p-4 bg-black/40 border border-white/5 rounded text-center">
                  <span className="block text-2xl font-bold text-white">{plan.credits}</span>
                  <span className="text-xs uppercase tracking-widest text-[#f0f0f0]/40">Credits Included</span>
                </div>
                <ul className="space-y-4 mb-8">
                  {plan.features.map((feat, j) => (
                    <li key={j} className="flex items-center gap-3 text-sm text-[#f0f0f0]/70">
                      <div className={`w-1.5 h-1.5 rounded-full ${plan.popular ? 'bg-[#CCFF00]' : 'bg-white'}`}></div>
                      {feat}
                    </li>
                  ))}
                </ul>
                <Link href="/sign-in" className={`block w-full py-4 text-center text-xs font-bold uppercase tracking-widest transition-colors ${plan.popular ? 'bg-[#CCFF00] text-black hover:bg-white' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                  Select Plan
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* CTA Footer */}
        <section className="px-6 py-32 text-center relative overflow-hidden">
           <div className="absolute inset-0 bg-linear-to-t from-[#CCFF00]/5 to-transparent pointer-events-none"></div>
           <h2 className="text-3xl md:text-5xl font-[Syncopate] font-bold uppercase mb-8">
             Stop Feeding <GlitchText text="Noise" /> To Your AI.
           </h2>
           <Link href="/sign-in" className="cta-button inline-block text-lg px-12 py-6">
             Get Clean Data
           </Link>
        </section>
        
        <footer className="px-6 py-8 border-t border-white/10 text-center md:text-left md:flex justify-between items-center text-xs text-[#f0f0f0]/30 uppercase tracking-widest">
          <div>
            &copy; 2026 DocMind Systems. All rights reserved.
          </div>
          <div className="flex gap-6 mt-4 md:mt-0 justify-center">
            <Link href="#" className="hover:text-[#CCFF00] transition-colors">Privacy</Link>
            <Link href="#" className="hover:text-[#CCFF00] transition-colors">Terms</Link>
            <Link href="#" className="hover:text-[#CCFF00] transition-colors">Contact</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}