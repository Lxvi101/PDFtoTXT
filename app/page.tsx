import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-16">
        <nav className="flex items-center justify-between">
          <Link href="/" className="text-2xl font-semibold text-slate-100">
            PageSentry
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/sign-in" className="text-sm text-slate-300">
              Sign in
            </Link>
            <Link
              href="/sign-in"
              className="glass-button px-4 py-2 rounded-full text-sm text-slate-100"
            >
              Start free
            </Link>
          </div>
        </nav>

        <section className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-indigo-500/10 border border-indigo-400/30 px-4 py-2 text-xs uppercase tracking-[0.2em] text-indigo-200">
              Secure SaaS OCR
            </span>
            <h1 className="text-5xl md:text-6xl font-bold text-slate-100 leading-tight">
              Turn scanned PDFs into structured text with airtight account
              security.
            </h1>
            <p className="text-lg text-slate-400">
              PageSentry combines Gemini-powered extraction with credit-based
              billing, audit trails, and team-ready security. Every account
              starts with 100 free credits—100 pages of scanning.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/sign-in"
                className="glass-button px-6 py-3 rounded-full text-sm text-slate-100"
              >
                Claim 100 free credits
              </Link>
              <Link
                href="#pricing"
                className="px-6 py-3 rounded-full border border-white/10 text-sm text-slate-300 hover:text-slate-100"
              >
                View pricing
              </Link>
            </div>
            <div className="flex items-center gap-6 text-xs text-slate-500">
              <span>Account-secured access</span>
              <span>1 credit = 1 page</span>
              <span>Zero changes to your scan quality</span>
            </div>
          </div>
          <div className="glass-panel rounded-3xl p-8 space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-400">Credit balance</p>
                <p className="text-3xl font-semibold text-slate-100">100</p>
              </div>
              <span className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full">
                Free tier
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Pages scanned today</span>
                <span>0</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Queue health</span>
                <span>Realtime</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Export format</span>
                <span>Markdown + tables</span>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 text-sm text-slate-400">
              "Finally, a scanner that keeps our data secure and bills us only
              for what we process."
              <p className="text-xs text-slate-500 mt-3">— Operations Lead</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Account-secured access",
              description:
                "BetterAuth keeps every scan locked to authenticated users and sessions.",
            },
            {
              title: "Credit-based billing",
              description:
                "Convex tracks every credit spend and purchase in real time.",
            },
            {
              title: "Stunning extraction",
              description:
                "Page-by-page Gemini OCR preserves tables, formulas, and structure.",
            },
          ].map((item) => (
            <div key={item.title} className="glass-panel rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-slate-100">
                {item.title}
              </h3>
              <p className="text-sm text-slate-400 mt-2">{item.description}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-8 lg:grid-cols-2">
          <div className="glass-panel rounded-2xl p-8 space-y-4">
            <h2 className="text-2xl font-semibold text-slate-100">
              How PageSentry works
            </h2>
            <ul className="space-y-3 text-sm text-slate-400">
              <li>1. Sign in and receive 100 free credits instantly.</li>
              <li>2. Upload your PDF or specify a page range.</li>
              <li>3. Each page is scanned with Gemini 2.0 Flash.</li>
              <li>4. Credits are deducted only when a page succeeds.</li>
              <li>5. Export Markdown, copy text, or continue scanning.</li>
            </ul>
          </div>
          <div className="glass-panel rounded-2xl p-8 space-y-4">
            <h2 className="text-2xl font-semibold text-slate-100">
              Built for secure teams
            </h2>
            <p className="text-sm text-slate-400">
              Every account is isolated with BetterAuth sessions, while Convex
              powers the credits ledger, usage events, and audit-ready
              persistence. Upgrade any time by purchasing credit packs.
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
              <span className="border border-white/10 rounded-full px-3 py-1">
                SOC-ready logs
              </span>
              <span className="border border-white/10 rounded-full px-3 py-1">
                Role-based expansion
              </span>
              <span className="border border-white/10 rounded-full px-3 py-1">
                Secure API access
              </span>
            </div>
          </div>
        </section>

        <section id="pricing" className="space-y-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-100">
                Pricing that scales with usage
              </h2>
              <p className="text-sm text-slate-400">
                Credits roll over and never expire. Start free, upgrade when
                you’re ready.
              </p>
            </div>
            <Link href="/sign-in" className="text-sm text-indigo-300">
              Get started →
            </Link>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                title: "Free",
                price: "$0",
                credits: "100 credits",
                perks: ["Full scanner access", "Email + password auth"],
              },
              {
                title: "Starter Pack",
                price: "$9",
                credits: "500 credits",
                perks: ["Fast credit top-ups", "Team-ready exports"],
              },
              {
                title: "Business Pack",
                price: "$129",
                credits: "10,000 credits",
                perks: ["Priority support", "Custom onboarding"],
              },
            ].map((plan) => (
              <div key={plan.title} className="glass-panel rounded-2xl p-6">
                <h3 className="text-lg font-semibold text-slate-100">
                  {plan.title}
                </h3>
                <p className="text-3xl font-semibold text-slate-100 mt-3">
                  {plan.price}
                </p>
                <p className="text-sm text-slate-400 mt-2">{plan.credits}</p>
                <ul className="text-sm text-slate-400 mt-4 space-y-2">
                  {plan.perks.map((perk) => (
                    <li key={perk}>• {perk}</li>
                  ))}
                </ul>
                <Link
                  href="/sign-in"
                  className="glass-button inline-flex items-center justify-center w-full mt-6 py-2 rounded-full text-sm text-slate-100"
                >
                  Choose {plan.title}
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-semibold text-slate-100">
            Ready to secure your PDF scanning?
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            Launch with 100 credits and upgrade when your team scales.
          </p>
          <Link
            href="/sign-in"
            className="glass-button mt-6 inline-flex px-6 py-3 rounded-full text-sm text-slate-100"
          >
            Start scanning now
          </Link>
        </section>
      </div>
    </div>
  );
}
