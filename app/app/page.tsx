"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Scanner, { type ScanRunsState } from "@/components/Scanner";
import { authClient } from "@/lib/authClient";

type CreditEvent = {
  _id: string;
  type: "grant" | "purchase" | "spend" | "refund";
  amount: number;
  reason: string;
  createdAt: number;
  metadata?: {
    pageNumber?: number;
    packId?: string;
    requestId?: string;
  };
};

type Overview = {
  user: {
    credits: number;
    plan: string;
    name: string;
    email: string;
    isAdmin?: boolean;
  };
  totals: {
    granted: number;
    purchased: number;
    spent: number;
    refunded: number;
  };
  recentEvents: CreditEvent[];
};

type UsageItem = {
  _id: string;
  pageNumber: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  createdAt: number;
};

const CREDIT_PACKS = [
  {
    id: "starter",
    name: "Starter",
    credits: 500,
    price: 9,
    description: "Weekly reports.",
  },
  {
    id: "pro",
    name: "Pro",
    credits: 2500,
    price: 39,
    description: "High-volume teams.",
  },
  {
    id: "business",
    name: "Business",
    credits: 10000,
    price: 129,
    description: "Enterprise batching.",
  },
];

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: 'currency', currency: 'USD' }).format(value);

const formatTime = (value: number) =>
  new Date(value).toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function AppPage() {
  const session = authClient.useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recentUsage, setRecentUsage] = useState<UsageItem[]>([]);
  const [scanRuns, setScanRuns] = useState<ScanRunsState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState<string | null>(null);

  const availableCredits = overview?.user?.credits ?? null;

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/credits");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to load credits");
      }
      setOverview(data.overview);
      setRecentUsage(data.recentUsage ?? []);
      setScanRuns(data.scanRuns ?? { active: [], recent: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load overview");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handlePurchase = async (packId: string) => {
    setPurchaseLoading(packId);
    setError(null);
    try {
      const response = await fetch("/api/credits/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Purchase failed");
      }
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              user: {
                ...prev.user,
                credits: data.credits,
              },
            }
          : prev,
      );
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setPurchaseLoading(null);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  const totals = useMemo(() => {
    if (!overview) return null;
    return overview.totals;
  }, [overview]);

  // Calculate generic usage cost for display purposes (rough estimate based on tokens)
  const estimatedSpend = recentUsage.reduce((acc, curr) => acc + curr.cost, 0);

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-sans selection:bg-[#CCFF00] selection:text-black">
      {/* Background Pattern */}
      <div className="fixed inset-0 dot-pattern pointer-events-none z-0 opacity-50" />

      <div className="relative z-10 max-w-[1400px] mx-auto p-4 md:p-8 space-y-8">
        
        {/* Top Navigation / Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-white/5">
          <div className="space-y-1">
            <Link href="/" className="text-xl font-bold tracking-tighter text-white flex items-center gap-2">
              <div className="w-3 h-3 bg-[#CCFF00] rounded-full"></div>
              DOCMIND <span className="text-white/30 font-normal">CONSOLE</span>
            </Link>
          </div>
          
          <div className="flex items-center gap-4 bg-[#0A0A0A] border border-white/10 rounded-full px-4 py-2">
            <div className="flex flex-col text-right mr-2">
              <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Authenticated</span>
              <span className="text-xs font-mono text-white">{session?.data?.user?.email}</span>
            </div>
            <div className="h-8 w-px bg-white/10"></div>
            <button
              onClick={handleSignOut}
              className="text-xs font-medium text-white/60 hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg text-sm font-mono">
            Error: {error}
          </div>
        )}

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT COLUMN: Stats & Credits (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Usage Snapshot Panel - Inspired by xAI Dashboard */}
            <div className="tech-panel p-0">
              <div className="tech-panel-header">
                <h2 className="text-sm font-bold uppercase tracking-widest text-white">Usage Snapshot</h2>
                <span className="text-[10px] font-mono text-[#CCFF00] bg-[#CCFF00]/10 px-2 py-1 rounded">LIVE</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/5">
                {/* Metric 1 */}
                <div className="p-6 md:p-8 flex flex-col justify-between h-40">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-white/40">Available Credits</p>
                    <p className="text-4xl md:text-5xl font-mono font-light text-white tracking-tighter">
                      {isLoading ? "..." : overview?.user?.isAdmin ? "∞" : formatNumber(availableCredits ?? 0)}
                    </p>
                  </div>
                  <div className="w-full bg-white/5 h-1 mt-4 rounded-full overflow-hidden">
                    <div className="h-full bg-[#CCFF00] w-[70%]"></div>
                  </div>
                </div>

                {/* Metric 2 */}
                <div className="p-6 md:p-8 flex flex-col justify-between h-40">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-white/40">Pages Scanned</p>
                    <p className="text-4xl md:text-5xl font-mono font-light text-white tracking-tighter">
                      {isLoading || !totals ? "..." : formatNumber(totals.spent)}
                    </p>
                  </div>
                  <p className="text-xs text-white/30 mt-4">Lifetime usage count</p>
                </div>

                {/* Metric 3 */}
                <div className="p-6 md:p-8 flex flex-col justify-between h-40">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-white/40">Est. Spend</p>
                    <p className="text-4xl md:text-5xl font-mono font-light text-white tracking-tighter">
                      {isLoading ? "..." : formatCurrency(estimatedSpend)}
                    </p>
                  </div>
                  <p className="text-xs text-white/30 mt-4">Based on Gemini API costs</p>
                </div>
              </div>
            </div>

            {/* Main Action Area: Scanner */}
            <div className="tech-panel min-h-[500px]">
               <div className="tech-panel-header">
                <h2 className="text-sm font-bold uppercase tracking-widest text-white">Console</h2>
                <div className="flex gap-2">
                   <div className="w-2 h-2 rounded-full bg-red-500/20 border border-red-500/50"></div>
                   <div className="w-2 h-2 rounded-full bg-amber-500/20 border border-amber-500/50"></div>
                   <div className="w-2 h-2 rounded-full bg-green-500/20 border border-green-500/50"></div>
                </div>
              </div>
              <div className="p-6 md:p-8">
                <Scanner
                  availableCredits={overview?.user?.isAdmin ? Infinity : availableCredits}
                  scanRuns={scanRuns}
                  onRunsChanged={loadOverview}
                  onCreditsUpdate={(credits) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            user: {
                              ...prev.user,
                              credits,
                            },
                          }
                        : prev,
                    )
                  }
                />
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Secondary Info (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Purchase Credits */}
            <div className="tech-panel p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-4">Add Capacity</h3>
              <div className="space-y-3">
                {CREDIT_PACKS.map((pack) => (
                  <div key={pack.id} className="group relative">
                    <button
                      onClick={() => handlePurchase(pack.id)}
                      disabled={purchaseLoading === pack.id}
                      className="w-full flex items-center justify-between p-4 bg-white/5 border border-white/5 hover:border-[#CCFF00]/50 hover:bg-[#CCFF00]/5 transition-all duration-300 rounded text-left group-disabled:opacity-50"
                    >
                      <div>
                        <div className="text-white font-medium group-hover:text-[#CCFF00] transition-colors">{pack.name}</div>
                        <div className="text-[10px] text-white/40 uppercase tracking-wider">{formatNumber(pack.credits)} Credits</div>
                      </div>
                      <div className="font-mono text-lg text-white">
                        ${pack.price}
                      </div>
                    </button>
                    {purchaseLoading === pack.id && (
                      <div className="absolute inset-0 bg-[#0A0A0A]/80 flex items-center justify-center text-xs font-mono text-[#CCFF00]">
                        PROCESSING...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Scan runs (Convex): active + history */}
            <div className="tech-panel p-0">
              <div className="tech-panel-header">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white">Run Index</h3>
                <span className="text-[10px] font-mono text-white/40">
                  {scanRuns?.active?.length ? `${scanRuns.active.length} active` : "—"}
                </span>
              </div>
              <div className="p-0 max-h-56 overflow-y-auto">
                {scanRuns?.recent?.length ? (
                  <div className="divide-y divide-white/5">
                    {scanRuns.recent.slice(0, 12).map((run) => (
                      <div
                        key={run._id}
                        className="p-3 flex items-start justify-between gap-2 text-[11px] hover:bg-white/5 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-white/80 truncate">
                            {(run.fileName || run.triggerRunId).slice(0, 24)}
                          </p>
                          <p className="text-white/35 mt-0.5">
                            {run.pageCount} pg · {formatTime(run.createdAt)}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${
                            run.isActive
                              ? "bg-[#CCFF00]/15 text-[#CCFF00] border border-[#CCFF00]/30"
                              : run.status === "completed"
                                ? "bg-white/5 text-white/50 border border-white/10"
                                : run.status === "stopped"
                                  ? "bg-amber-500/10 text-amber-400/90 border border-amber-500/20"
                                  : "bg-rose-500/10 text-rose-400/90 border border-rose-500/20"
                          }`}
                        >
                          {run.isActive ? "active" : run.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-[10px] text-white/25 font-mono">
                    No scans yet
                  </div>
                )}
              </div>
            </div>

            {/* Activity Feed */}
            <div className="tech-panel flex-1">
              <div className="tech-panel-header">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white">System Log</h3>
              </div>
              <div className="p-0">
                {overview?.recentEvents?.length ? (
                  <div className="divide-y divide-white/5">
                    {overview.recentEvents.map((event) => (
                      <div key={event._id} className="p-4 flex items-start justify-between text-xs hover:bg-white/5 transition-colors">
                        <div className="flex gap-3">
                          <span className={`font-mono font-bold ${event.type === 'spend' ? 'text-white/40' : 'text-[#CCFF00]'}`}>
                            {event.type === 'spend' ? 'OUT' : 'IN_'}
                          </span>
                          <div>
                            <p className="text-white font-medium capitalize">{event.reason.replace('_', ' ')}</p>
                            <p className="text-white/30 mt-0.5">{formatTime(event.createdAt)}</p>
                          </div>
                        </div>
                        <span className="font-mono text-white/60">
                          {event.type === "spend" ? "-" : "+"}
                          {formatNumber(event.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-white/20 font-mono">
                    -- NO ACTIVITY LOGGED --
                  </div>
                )}
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
