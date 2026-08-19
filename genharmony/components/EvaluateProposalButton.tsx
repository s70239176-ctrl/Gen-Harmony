"use client";

import { useState, useEffect } from "react";
import { Gavel, CheckCircle2, XCircle, Clock, RefreshCw, Hourglass } from "lucide-react";
import { Button } from "./ui/Button";
import { VuMeter } from "./VuMeter";
import { useHarmonyForge } from "@/lib/genlayer";
import type { Track } from "@/lib/types";

type State = "idle" | "judging" | "polling" | "done" | "timeout" | "error";

interface Verdict {
  status: "approved" | "rejected";
  composite_score: number;
  rationale: string | null;
}

export function EvaluateProposalButton({
  proposalId,
  trackId,
  initialVersion,
  onResolved,
}: {
  proposalId: string;
  trackId: string;
  initialVersion: number;
  onResolved?: (updatedTrack?: Track) => void;
}) {
  const { evaluateProposal, getProposal, getTrack } = useHarmonyForge();
  const [state, setState] = useState<State>("idle");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pollLabel, setPollLabel] = useState("");

  useEffect(() => {
    if (state !== "judging" && state !== "polling") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  function verdictFrom(p: { status: string; scores: { originality: number; quality: number; emotional: number; canon_fit: number } | null; rationale: string | null }): Verdict {
    const s = p.scores;
    const composite = s
      ? Math.round((s.originality + s.quality + s.emotional + s.canon_fit) / 4)
      : 0;
    return {
      status: p.status as "approved" | "rejected",
      composite_score: composite,
      rationale: p.rationale,
    };
  }

  async function poll(maxAttempts = 40) {
    setState("polling");
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      setPollLabel(`Checking proposal #${proposalId} · ${elapsed}s elapsed`);
      try {
        const proposal = await getProposal(proposalId);
        if (proposal.status !== "pending") {
          const v = verdictFrom(proposal);
          setVerdict(v);
          setState("done");
          if (v.status === "approved") {
            const track = await getTrack(trackId).catch(() => undefined);
            onResolved?.(track);
          } else {
            onResolved?.();
          }
          return;
        }
      } catch {
        // proposal not readable yet — keep polling
      }
    }
    setState("timeout");
    setPollLabel("");
  }

  async function handleEvaluate() {
    setState("judging");
    setError(null);
    setPollLabel("");
    try {
      // Confirm it's actually pending before spending gas
      const existing = await getProposal(proposalId).catch(() => null);
      if (existing && existing.status !== "pending") {
        setVerdict(verdictFrom(existing));
        setState("done");
        if (existing.status === "approved") {
          const track = await getTrack(trackId).catch(() => undefined);
          onResolved?.(track);
        }
        return;
      }

      await evaluateProposal(proposalId);
      await poll();
    } catch (err) {
      const raw = err instanceof Error ? err.message
        : typeof err === "object" && err !== null ? JSON.stringify(err)
        : String(err);
      // genlayer-js sometimes throws a cosmetic receipt-decode error even
      // though the tx went through fine — poll instead of treating as fatal
      if (raw.includes("non-whitespace") || raw.includes("JSON at position")) {
        await poll();
      } else {
        setError(raw);
        setState("error");
      }
    }
  }

  if (state === "judging" || state === "polling") return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-sm border border-line bg-rail/60 px-4 py-2.5">
        <VuMeter label={state === "judging" ? "Jury deliberating" : "Watching on-chain"} />
        <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-muted">
          <Clock className="h-3 w-3" />{elapsed}s
        </span>
      </div>
      <p className="font-mono text-[10px] text-muted">
        {pollLabel || (state === "judging"
          ? "LLM consensus takes 30–90s — do not close this tab"
          : "Polling every 3s…")}
      </p>
    </div>
  );

  if (state === "timeout") return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-sm border border-vinyl/40 bg-rail/60 px-4 py-2.5">
        <Hourglass className="h-4 w-4 text-vinyl shrink-0" />
        <p className="font-mono text-[12px] text-vinyl">Still deliberating after 2 minutes</p>
      </div>
      <Button variant="ghost" onClick={() => poll(20)} className="gap-1.5 !px-3 !py-1.5">
        <RefreshCw className="h-3.5 w-3.5" />Keep polling
      </Button>
    </div>
  );

  if (state === "done" && verdict) {
    const approved = verdict.status === "approved";
    return (
      <div className="space-y-2">
        <div className={`rounded-sm border px-4 py-3 ${approved ? "border-current/40" : "border-pulse/40"}`}>
          <div className={`flex items-center gap-2 ${approved ? "text-current" : "text-pulse"}`}>
            {approved ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            <p className="font-mono text-[12px] uppercase tracking-[0.1em]">
              {approved ? "Merged into canon" : "Rejected"}
              {verdict.composite_score > 0 && ` · ${verdict.composite_score}/100`}
            </p>
          </div>
          {verdict.rationale && (
            <p className="mt-2 font-body text-[13px] text-muted leading-snug">{verdict.rationale}</p>
          )}
        </div>
        <button onClick={() => onResolved?.()}
          className="flex items-center gap-1.5 font-mono text-[11px] text-muted hover:text-ink transition-colors">
          <RefreshCw className="h-3 w-3" />Refresh track &amp; history
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={handleEvaluate} className="gap-2">
        <Gavel className="h-3.5 w-3.5" />Convene the jury
      </Button>
      {state === "error" && error && (
        <p className="font-mono text-[12px] text-pulse">{error}</p>
      )}
    </div>
  );
}
