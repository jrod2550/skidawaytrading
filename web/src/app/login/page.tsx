"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Atmospheric background */}
      <div className="absolute inset-0 bg-[oklch(0.97_0.003_90)]" />

      {/* Animated wave layers */}
      <svg
        className="absolute bottom-0 left-0 w-full h-[60vh] opacity-[0.04] animate-wave"
        viewBox="0 0 1440 600"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          d="M0 400 Q180 300 360 380 Q540 460 720 350 Q900 240 1080 380 Q1260 520 1440 400 L1440 600 L0 600Z"
          fill="oklch(0.55 0.18 175)"
        />
        <path
          d="M0 450 Q240 350 480 420 Q720 490 960 380 Q1200 270 1440 420 L1440 600 L0 600Z"
          fill="oklch(0.55 0.18 175)"
          opacity="0.5"
        />
      </svg>

      {/* Radial glow behind card */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[oklch(0.55_0.18_175_/_0.06)] blur-[120px]" />
      <div className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full bg-[oklch(0.65_0.16_85_/_0.04)] blur-[100px]" />

      {/* Noise overlay */}
      <div className="noise-overlay" />

      {/* Content */}
      <div className="relative z-10 w-full max-w-[420px] px-6">
        {/* Brand header */}
        <div className="mb-10 text-center animate-fade-up" style={{ animationDelay: "0ms" }}>
          {/* Logo mark */}
          <div className="inline-flex items-center justify-center w-20 h-20 mb-6 rounded-2xl glow-teal">
            <Image
              src="/logo.webp"
              alt="Booyah Trading"
              width={80}
              height={80}
              className="rounded-2xl"
            />
          </div>

          <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-foreground">
            Booyah Trading
          </h1>
          <div className="mt-1.5 flex items-center justify-center gap-2">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-[oklch(0.55_0.18_175_/_0.3)]" />
            <span className="text-[11px] font-medium tracking-[0.2em] uppercase text-sand">
              Savannah, GA
            </span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-[oklch(0.55_0.18_175_/_0.3)]" />
          </div>
        </div>

        {/* Login card */}
        <div
          className="animate-fade-up rounded-xl bg-[oklch(1.00_0_0_/_0.85)] backdrop-blur-xl border border-[oklch(0.88_0.008_90)] p-8"
          style={{ animationDelay: "100ms" }}
        >
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className={`text-xs font-medium tracking-wide uppercase transition-colors duration-200 ${
                  focused === "email" ? "text-teal" : "text-sand"
                }`}
              >
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                required
                className="h-11 bg-[oklch(0.96_0.003_90)] border-[oklch(0.88_0.008_90)] text-foreground placeholder:text-[oklch(0.60_0.01_250)] focus:border-teal focus:ring-1 focus:ring-teal/30 transition-all"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="password"
                className={`text-xs font-medium tracking-wide uppercase transition-colors duration-200 ${
                  focused === "password" ? "text-teal" : "text-sand"
                }`}
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                required
                className="h-11 bg-[oklch(0.96_0.003_90)] border-[oklch(0.88_0.008_90)] text-foreground placeholder:text-[oklch(0.60_0.01_250)] focus:border-teal focus:ring-1 focus:ring-teal/30 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-[oklch(0.52_0.22_25_/_0.06)] border border-[oklch(0.52_0.22_25_/_0.15)] px-3 py-2.5">
                <div className="h-1.5 w-1.5 rounded-full bg-loss flex-shrink-0" />
                <p className="text-xs text-loss">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-teal text-teal-foreground font-medium tracking-wide hover:bg-[oklch(0.50_0.18_175)] active:bg-[oklch(0.47_0.18_175)] transition-all duration-200 glow-teal disabled:opacity-50 disabled:shadow-none"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Authenticating
                </span>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <div
          className="animate-fade-up mt-8 text-center"
          style={{ animationDelay: "200ms" }}
        >
          <p className="text-[11px] text-[oklch(0.55_0.01_250)]">
            Institutional flow analysis &middot; Congressional tracking &middot; AI signals
          </p>
        </div>
      </div>
    </div>
  );
}
