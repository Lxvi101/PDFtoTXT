"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/authClient";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) {
          throw new Error(res.error.message || "Sign in failed");
        }
      } else {
        const res = await authClient.signUp.email({
          name,
          email,
          password,
        });
        if (res.error) {
          throw new Error(res.error.message || "Sign up failed");
        }
      }
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full glass-panel rounded-3xl p-10 space-y-6">
        <div className="space-y-2 text-center">
          <Link href="/" className="text-2xl font-semibold text-slate-100">
            PageSentry
          </Link>
          <p className="text-sm text-slate-400">
            {mode === "sign-in"
              ? "Welcome back. Access your secure scanning workspace."
              : "Create your account and claim 100 free credits."}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setMode("sign-in")}
            className={`px-4 py-2 rounded-full text-sm ${
              mode === "sign-in"
                ? "bg-indigo-500/20 text-indigo-200 border border-indigo-400/40"
                : "text-slate-400 border border-white/10"
            }`}
          >
            Sign in
          </button>
          <button
            onClick={() => setMode("sign-up")}
            className={`px-4 py-2 rounded-full text-sm ${
              mode === "sign-up"
                ? "bg-indigo-500/20 text-indigo-200 border border-indigo-400/40"
                : "text-slate-400 border border-white/10"
            }`}
          >
            Sign up
          </button>
        </div>

        {error && (
          <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "sign-up" && (
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-slate-500">
                Full name
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="w-full rounded-xl bg-slate-900/60 border border-slate-700 px-4 py-3 text-slate-100 focus:outline-none focus:border-indigo-400"
                placeholder="Alex Carter"
              />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-slate-500">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-xl bg-slate-900/60 border border-slate-700 px-4 py-3 text-slate-100 focus:outline-none focus:border-indigo-400"
              placeholder="you@company.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-slate-500">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-xl bg-slate-900/60 border border-slate-700 px-4 py-3 text-slate-100 focus:outline-none focus:border-indigo-400"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="glass-button w-full py-3 rounded-xl text-sm text-slate-100"
          >
            {isLoading
              ? "Securing account..."
              : mode === "sign-in"
              ? "Sign in"
              : "Create account"}
          </button>
        </form>

        <p className="text-xs text-center text-slate-500">
          By continuing you agree to the PageSentry security policy and usage
          terms.
        </p>
      </div>
    </div>
  );
}
