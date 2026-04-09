"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Briefing {
  briefing: string;
  model: string;
  market_status: string;
  generated_at: string;
  token_usage: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost: string;
  };
  data_summary: {
    individual_flow: number;
    index_flow: number;
    congressional_trades: number;
    sectors_tracked: number;
  };
}

export default function BriefingPage() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateBriefing() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/briefing");
      if (!resp.ok) {
        const data = await resp.json();
        setError(data.error ?? "Failed to generate briefing");
      } else {
        const data = await resp.json();
        setBriefing(data);
      }
    } catch {
      setError("Network error — check your connection");
    }
    setLoading(false);
  }

  useEffect(() => {
    generateBriefing();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">AI Briefing</h2>
          <p className="text-muted-foreground">
            Claude analyzes today's flow, congressional trades, and sectors
          </p>
        </div>
        <Button
          onClick={generateBriefing}
          disabled={loading}
          className="bg-teal text-teal-foreground hover:bg-teal/90"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating...
            </span>
          ) : (
            "Refresh Briefing"
          )}
        </Button>
      </div>

      {error && (
        <Card className="bg-card border-loss/20">
          <CardContent className="p-5">
            <p className="text-sm text-loss">{error}</p>
          </CardContent>
        </Card>
      )}

      {briefing && (
        <>
          {/* Meta info */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
                  Market
                </p>
                <p className={`text-sm font-bold font-mono ${
                  briefing.market_status === "open" ? "text-profit" :
                  briefing.market_status === "holiday" ? "text-loss" :
                  "text-muted-foreground"
                }`}>
                  {briefing.market_status === "holiday" ? "Holiday" : briefing.market_status?.toUpperCase()}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
                  Stock Flow
                </p>
                <p className="text-xl font-bold font-mono">{briefing.data_summary.individual_flow}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
                  Index Flow
                </p>
                <p className="text-xl font-bold font-mono">{briefing.data_summary.index_flow}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
                  Congress
                </p>
                <p className="text-xl font-bold font-mono">{briefing.data_summary.congressional_trades}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
                  Model
                </p>
                <p className="text-sm font-bold font-mono text-teal">Sonnet</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
                  AI Cost
                </p>
                <p className="text-xl font-bold font-mono text-gold">${briefing.token_usage.estimated_cost}</p>
              </CardContent>
            </Card>
          </div>

          {/* Briefing content */}
          <Card className="bg-card border-border">
            <CardContent className="p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
                <div className="w-10 h-10 rounded-lg bg-[oklch(0.55_0.18_175_/_0.08)] border border-[oklch(0.55_0.18_175_/_0.2)] flex items-center justify-center">
                  <svg className="w-5 h-5 text-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold">Broken Omelette AI Analyst</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {new Date(briefing.generated_at).toLocaleString()} · Claude Sonnet ·{" "}
                    {briefing.token_usage.input_tokens + briefing.token_usage.output_tokens} tokens · ${briefing.token_usage.estimated_cost}
                  </p>
                </div>
              </div>

              <div className="prose prose-sm max-w-none">
                {briefing.briefing.split("\n").map((line, i) => {
                  if (!line.trim()) return <div key={i} className="h-3" />;

                  // Bold headers
                  if (line.startsWith("**") || line.includes("**")) {
                    const parts = line.split(/\*\*(.*?)\*\*/g);
                    return (
                      <p key={i} className="text-sm leading-relaxed mb-1">
                        {parts.map((part, j) =>
                          j % 2 === 1 ? (
                            <strong key={j} className="font-semibold text-foreground">
                              {part}
                            </strong>
                          ) : (
                            <span key={j} className="text-foreground/80">{part}</span>
                          )
                        )}
                      </p>
                    );
                  }

                  // Bullet points
                  if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
                    return (
                      <div key={i} className="flex gap-2 ml-2 mb-1">
                        <span className="text-teal mt-1 flex-shrink-0">-</span>
                        <p className="text-sm leading-relaxed text-foreground/80">
                          {line.trim().slice(2)}
                        </p>
                      </div>
                    );
                  }

                  // Numbered items
                  if (/^\d+\./.test(line.trim())) {
                    const num = line.trim().match(/^(\d+)\./)?.[1];
                    const rest = line.trim().replace(/^\d+\.\s*/, "");
                    return (
                      <div key={i} className="flex gap-2 mb-1">
                        <span className="text-teal font-mono text-xs mt-0.5 w-4 flex-shrink-0">{num}.</span>
                        <p className="text-sm leading-relaxed text-foreground/80">
                          {rest.split(/\*\*(.*?)\*\*/g).map((part, j) =>
                            j % 2 === 1 ? (
                              <strong key={j} className="font-semibold text-foreground">{part}</strong>
                            ) : (
                              <span key={j}>{part}</span>
                            )
                          )}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <p key={i} className="text-sm leading-relaxed text-foreground/80 mb-1">
                      {line}
                    </p>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!briefing && !loading && !error && (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Click "Refresh Briefing" to generate today's AI analysis</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
