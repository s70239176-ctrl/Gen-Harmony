"use client";

import { useState, useEffect } from "react";
import { Gavel, CheckCircle2, XCircle, Clock, RefreshCw, Hourglass } from "lucide-react";
import { Button } from "./ui/Button";
import { VuMeter } from "./VuMeter";
import { useHarmonyForge } from "@/lib/genlayer";
import type { Proposal } from "@/lib/types";

type State = "idle" | "judging" | "polling" | "done" | "timeout" | "error";

interface Verdict {
  status: "approved" | "rejected";
  composite_score: number;
  rationale: string | null;
  plagiarism_risk?: string;
}

function scoreFrom(p: Proposal): Verdict {
  const s = p.scores;
  const composite = s
    ? Math.round((s.quality + s.originality + s.emotional + s.canon_fit) / 4)
    : 0;
  return {
    status: p.status as "approved" | "rejected",
    composite_score: composite,
    rationale: p.rationale,
    plagiarism_risk: s?.plagiarism_risk,
  };
}

export function EvaluateProposalButton({
  proposalId,
  onResolved,
}: {
  proposalId: string;
  onResolved?: () => void;
}) {
  const { evaluateProposal, getProposal } = useHarmonyForge();
  const [state, setState] = useState<State>("idle");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== "judging" && state !== "polling") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  async function pollForVerdict(maxAttempts = 60) {
    setState("polling");
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const p = await getProposal(proposalId);
        if (p.status !== "pending") {
          setVerdict(scoreFrom(p));
          setState("done");
          onResolved?.();
          return;
        }
      } catch { /* keep polling */ }
    }
    setState("timeout");
  }

  async function handleEvaluate() {
    setState("judging");
    setError(null);

    // Validate the proposal exists and is still pending before spending gas
    try {
      const existing = await getProposal(proposalId);
      if (existing.status !== "pending") {
        // Already has a verdict — just show it directly
        setVerdict(scoreFrom(existing));
        setState("done");
        return;
      }
    } catch {
      setError(`Proposal #${proposalId} not found on-chain. Make sure you submitted the proposal first.`);
      setState("error");
      return;
    }

    try {
      await evaluateProposal(proposalId);
      await pollForVerdict();
    } catch (err) {
      const raw = err instanceof Error ? err.message
        : typeof err === "object" && err !== null ? JSON.stringify(err)
        : String(err);

      // Receipt JSON parse errors from genlayer-js are cosmetic — tx went through
      if (raw.includes("non-whitespace") || raw.includes("JSON at position")) {
        await pollForVerdict();
      } else if (raw.includes("already evaluated")) {
        // Contract rejected the call — fetch and show the existing verdict
        try {
          const p = await getProposal(proposalId);
          setVerdict(scoreFrom(p));
          setState("done");
          onResolved?.();
        } catch {
          setError("Proposal already evaluated — refresh the page to see the result.");
          setState("error");
        }
      } else {
        setError(raw);
        setState("error");
      }
    }
  }

  async function checkNow() {
    try {
      const p = await getProposal(proposalId);
      if (p.status !== "pending") {
        setVerdict(scoreFrom(p));
        setState("done");
        onResolved?.();
      } else {
        await pollForVerdict(20);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  // ---- render states ----

  if (state === "judging" || state === "polling") return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-sm border border-line bg-rail/60 px-4 py-2.5">
        <VuMeter label={state === "judging" ? "Jury deliberating" : "Reading verdict"} />
        <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-muted">
          <Clock className="h-3 w-3" />{elapsed}s
        </span>
      </div>
      <p className="font-mono text-[10px] text-muted">
        {state === "judging"
          ? "LLM consensus takes 30–90s — do not close this tab"
          : "Transaction confirmed — polling for on-chain verdict…"}
      </p>
    </div>
  );

  if (state === "timeout") return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-sm border border-vinyl/40 bg-rail/60 px-4 py-2.5">
        <Hourglass className="h-4 w-4 text-vinyl shrink-0" />
        <p className="font-mono text-[12px] text-vinyl">Jury still deliberating</p>
      </div>
      <Button variant="ghost" onClick={checkNow} className="gap-2 !px-3 !py-1.5">
        <RefreshCw className="h-3.5 w-3.5" />Check verdict now
      </Button>
    </div>
  );

  if (state === "done" && verdict) {
    const approved = verdict.status === "approved";
    return (
      <div className="space-y-2">
        <div className={`rounded-sm border px-4 py-3 ${
          approved ? "border-current/40" : "border-pulse/40"
        }`}>
          <div className={`flex items-center gap-2 ${approved ? "text-current" : "text-pulse"}`}>
            {approved
              ? <CheckCircle2 className="h-4 w-4 shrink-0" />
              : <XCircle className="h-4 w-4 shrink-0" />}
            <p className="font-mono text-[12px] uppercase tracking-[0.1em]">
              {approved ? "Merged into canon" : "Rejected"}
              {verdict.composite_score > 0 && ` · ${verdict.composite_score}/100`}
            </p>
          </div>
          {verdict.plagiarism_risk === "high" && (
            <p className="mt-1 font-mono text-[11px] text-pulse">⚠ Plagiarism risk flagged</p>
          )}
          {verdict.rationale && (
            <p className="mt-2 font-body text-[13px] text-muted leading-snug">
              {verdict.rationale}
            </p>
          )}
        </div>
        <button onClick={onResolved}
          className="flex items-center gap-1.5 font-mono text-[11px] text-muted hover:text-ink transition-colors">
          <RefreshCw className="h-3 w-3" />Refresh track &amp; history
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={handleEvaluate} className="gap-2">
        <Gavel className="h-3.5 w-3.5" />
        Convene the jury
      </Button>
      {state === "error" && error && (
        <p className="font-mono text-[12px] text-pulse">{error}</p>
      )}
    </div>
  );
}
