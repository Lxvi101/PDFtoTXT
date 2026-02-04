"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Scanner from "@/components/Scanner";
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
    description: "Perfect for weekly reports and decks.",
  },
  {
    id: "pro",
    name: "Pro",
    credits: 2500,
    price: 39,
    description: "High-volume teams with steady scanning.",
  },
  {
    id: "business",
    name: "Business",
    credits: 10000,
    price: 129,
    description: "Enterprise workloads and batch processing.",
  },
];

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);

const formatTime = (value: number) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function AppPage() {
  const session = authClient.useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recentUsage, setRecentUsage] = useState<UsageItem[]>([]);
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

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/" className="text-2xl font-semibold text-slate-100">
              PageSentry
            </Link>
            <p className="text-sm text-slate-400">
              Secure, credit-based PDF scanning built for teams.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-slate-400">{session?.data?.user?.email}</p>
              <p className="text-sm text-slate-200">{session?.data?.user?.name}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="glass-button px-4 py-2 rounded-lg text-sm text-slate-200"
            >
              Sign out
            </button>
          </div>
        </header>

        {error && (
          <div className="glass-panel rounded-xl p-4 border border-rose-500/30 text-rose-200 text-sm">
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-3">
          <div className="glass-panel rounded-2xl p-6">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Available Credits
            </p>
            <p className="text-3xl font-semibold text-slate-100 mt-3">
              {isLoading ? "—" : formatNumber(availableCredits ?? 0)}
            </p>
            <p className="text-sm text-slate-400 mt-2">
              1 credit equals 1 scanned page.
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-6">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Usage Summary
            </p>
            <p className="text-3xl font-semibold text-slate-100 mt-3">
              {isLoading || !totals ? "—" : formatNumber(totals.spent)}
            </p>
            <p className="text-sm text-slate-400 mt-2">
              Pages processed across all documents.
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-6">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Plan
            </p>
            <p className="text-3xl font-semibold text-slate-100 mt-3 capitalize">
              {isLoading ? "—" : overview?.user?.plan || "free"}
            </p>
            <p className="text-sm text-slate-400 mt-2">
              New accounts get 100 credits to start.
            </p>
          </div>
        </div>

        <section className="glass-panel rounded-2xl p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-100">
                Buy more credits
              </h2>
              <p className="text-sm text-slate-400">
                Credits unlock every scanned page. Choose a pack below.
              </p>
            </div>
            <p className="text-xs text-slate-500">
              Secure checkout ready for Stripe integration.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3 mt-6">
            {CREDIT_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="border border-white/5 rounded-xl p-5 bg-white/5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-100">
                    {pack.name}
                  </h3>
                  <span className="text-sm text-emerald-300 font-medium">
                    ${pack.price}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-2">{pack.description}</p>
                <p className="text-2xl font-semibold text-slate-200 mt-4">
                  {formatNumber(pack.credits)}
                  <span className="text-sm text-slate-400"> credits</span>
                </p>
                <button
                  onClick={() => handlePurchase(pack.id)}
                  disabled={purchaseLoading === pack.id}
                  className="glass-button w-full mt-4 py-2 rounded-lg text-sm text-slate-200"
                >
                  {purchaseLoading === pack.id ? "Processing..." : "Buy credits"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-slate-100">Recent activity</h3>
            <div className="mt-4 space-y-3">
              {overview?.recentEvents?.length ? (
                overview.recentEvents.map((event) => (
                  <div
                    key={event._id}
                    className="flex items-center justify-between text-sm text-slate-300 border-b border-white/5 pb-2"
                  >
                    <div>
                      <p className="font-medium capitalize">{event.type}</p>
                      <p className="text-xs text-slate-500">{event.reason}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-200">
                        {event.type === "spend" ? "-" : "+"}
                        {formatNumber(event.amount)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatTime(event.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">
                  Activity will appear once you scan or buy credits.
                </p>
              )}
            </div>
          </div>
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-slate-100">Recent scans</h3>
            <div className="mt-4 space-y-3">
              {recentUsage.length ? (
                recentUsage.map((usage) => (
                  <div
                    key={usage._id}
                    className="flex items-center justify-between text-sm text-slate-300 border-b border-white/5 pb-2"
                  >
                    <div>
                      <p className="font-medium">Page {usage.pageNumber}</p>
                      <p className="text-xs text-slate-500">
                        {usage.inputTokens + usage.outputTokens} tokens
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-200">
                        ${usage.cost.toFixed(5)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatTime(usage.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">
                  Your latest scans will show up here.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-2xl p-6">
          <Scanner
            availableCredits={availableCredits}
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
        </section>
      </div>
    </div>
  );
}
