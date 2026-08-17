"use client";

import { useConnect } from "wagmi";
import { wagmiConfig } from "@/lib/genlayer";
import { Disc3, Sparkles, GitBranch, Coins, Radio } from "lucide-react";
import { Button } from "./ui/Button";

const steps = [
  { icon: Disc3, label: "Seed", color: "text-pulse", desc: "Press a musical idea — a vibe, a lyric fragment, a mood — onto the chain." },
  { icon: GitBranch, label: "Evolve", color: "text-current", desc: "The collective proposes harmonies, remixes, and structures. An LLM jury decides what gets merged." },
  { icon: Coins, label: "Earn", color: "text-vinyl", desc: "Approved contributions earn GEN from the shared treasury, split between every collaborator." },
];

const examples = [
  { title: "Midnight Static", genre: "Synthwave", v: 3, accent: "#FF2E97" },
  { title: "Glass Signal",    genre: "Ambient",   v: 1, accent: "#00E5FF" },
  { title: "Copper Bloom",    genre: "Neo-soul",  v: 5, accent: "#FFB627" },
];

export function WelcomePage() {
  const { connectors, connect, isPending } = useConnect({ config: wagmiConfig });

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background gradient blobs */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-40 top-0 h-[600px] w-[600px] rounded-full bg-pulse/10 blur-[140px]" />
        <div className="absolute -right-40 top-40 h-[500px] w-[500px] rounded-full bg-current/8 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-vinyl/6 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-32">
        {/* Hero */}
        <div className="mb-20 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-panel/60 px-4 py-1.5 backdrop-blur-sm">
            <Radio className="h-3.5 w-3.5 text-pulse animate-flicker" />
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              Built on GenLayer · AI-powered consensus
            </span>
          </div>

          <h1 className="font-display text-6xl font-bold leading-none tracking-tight text-ink lg:text-8xl">
            Gen
            <span className="relative">
              <span className="text-pulse" style={{ textShadow: "0 0 40px rgba(255,46,151,0.6)" }}>
                Harmony
              </span>
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl font-body text-lg leading-relaxed text-muted">
            A decentralised studio where music evolves through collective intelligence.
            Seed a track. Propose an evolution. Let the on-chain LLM jury decide what becomes canon.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              variant="primary"
              loading={isPending}
              onClick={() => connect({ connector: connectors[0] })}
              className="gap-2 px-8 py-3 text-sm"
            >
              <Sparkles className="h-4 w-4" />
              Connect wallet to enter
            </Button>
            <p className="font-mono text-[11px] text-muted">
              MetaMask · any injected wallet
            </p>
          </div>
        </div>

        {/* How it works */}
        <div className="mb-20">
          <p className="mb-8 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            How it works
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {steps.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.label}
                  className="relative overflow-hidden rounded-md border border-line bg-panel/60 p-6 backdrop-blur-sm">
                  <div className="absolute inset-0 bg-grain opacity-20" />
                  <div className="relative">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                      <Icon className={`h-4 w-4 ${s.color}`} />
                      <span className={`font-display text-sm font-semibold ${s.color}`}>{s.label}</span>
                    </div>
                    <p className="font-body text-sm leading-relaxed text-muted">{s.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Example track cards */}
        <div>
          <p className="mb-8 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Live on the deck
          </p>
          <div className="grid grid-cols-3 gap-5 opacity-60">
            {examples.map((e) => (
              <div key={e.title}
                className="relative aspect-[4/5] overflow-hidden rounded-md border border-line bg-panel p-5">
                <div className="absolute inset-0 bg-grain opacity-40" />
                <div className="relative flex h-full flex-col justify-between">
                  <div>
                    <p className="led text-[10px] uppercase tracking-[0.16em] text-muted">{e.genre}</p>
                    <h3 className="mt-2 font-display text-sm font-semibold text-ink">{e.title}</h3>
                  </div>
                  <div className="flex items-center justify-between">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-line"
                      style={{ background: `radial-gradient(circle at 50% 50%, ${e.accent}33 0%, #0F0825 70%)` }}
                    >
                      <span className="led text-[10px] text-ink">v{e.v}</span>
                    </div>
                    <div className="h-2 w-16 rounded-full bg-line overflow-hidden">
                      <div className="h-2 rounded-full" style={{ width: `${(e.v / 6) * 100}%`, background: e.accent }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center font-mono text-[10px] text-muted/40">
            Connect to see live tracks and contribute
          </p>
        </div>
      </div>
    </div>
  );
}
