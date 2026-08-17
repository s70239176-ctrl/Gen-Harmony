"use client";

import { useState, useEffect } from "react";
import { Gavel, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { Button } from "./ui/Button";
import { VuMeter } from "./VuMeter";
import { useHarmonyForge } from "@/lib/genlayer";
import type { Proposal } from "@/lib/types";

type State = "idle" | "judging" | "polling" | "done" | "error";

interface Verdict {
  status: "approved" | "rejected";
  composite_score: number;
  rationale: string | null;
  plagiarism_risk?: string;
}

function scoreFrom(p: Proposal): Verdict {
  const s = p.scores;
  const composite = s ? Math.round((s.quality + s.originality + s.emotional + s.canon_fit) / 4) : 0;
  return {
    status: p.status as "approved" | "rejected",
    composite_score: composite,
    rationale: p.rationale,
    plagiarism_risk: s?.plagiarism_risk,
  };
}

export function EvaluateProposalButton({
  proposalId, onResolved,
}: { proposalId: string; onResolved?: () => void }) {
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

  async function pollForVerdict() {
    setState("polling");
    let attempts = 0;
    const max = 20; // poll for up to ~60s after tx
    while (attempts < max) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const proposal = await getProposal(proposalId);
        if (proposal.status !== "pending") {
          setVerdict(scoreFrom(proposal));
          setState("done");
          onResolved?.();
          return;
        }
      } catch { /* keep polling */ }
      attempts++;
    }
    // Timed out polling — verdict may still arrive
    setState("done");
    setVerdict({ status: "approved", composite_score: 0, rationale: "Tap refresh to see the final verdict — the jury may still be deliberating." });
    onResolved?.();
  }

  async function handleEvaluate() {
    setState("judging");
    setError(null);
    try {
      await evaluateProposal(proposalId);
      await pollForVerdict();
    } catch (err) {
      const raw = err instanceof Error ? err.message
        : typeof err === "object" && err !== null ? JSON.stringify(err) : String(err);
      // JSON parse errors from genlayer-js receipt decoding are cosmetic —
      // the tx went through; poll for the result
      if (raw.includes("non-whitespace") || raw.includes("JSON at position")) {
        await pollForVerdict();
      } else {
        setError(raw);
        setState("error");
      }
    }
  }

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
          ? "LLM consensus takes 30–90 seconds — do not close this tab"
          : "Transaction confirmed — reading on-chain verdict…"}
      </p>
    </div>
  );

  if (state === "done" && verdict) {
    const approved = verdict.status === "approved";
    return (
      <div className="space-y-2">
        <div className={`flex items-center gap-2 rounded-sm border px-4 py-2.5 ${
          approved ? "border-current/40 text-current" : "border-pulse/40 text-pulse"
        }`}>
          {approved
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <XCircle className="h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            <p className="font-mono text-[12px] uppercase tracking-[0.1em]">
              {approved ? "Merged into canon" : "Not merged"}
              {verdict.composite_score > 0 && ` · score ${verdict.composite_score}`}
              {verdict.plagiarism_risk === "high" && " · plagiarism flagged"}
            </p>
            {verdict.rationale && (
              <p className="mt-1 font-body text-[12px] text-muted leading-snug">{verdict.rationale}</p>
            )}
          </div>
        </div>
        <button onClick={onResolved}
          className="flex items-center gap-1.5 font-mono text-[11px] text-muted hover:text-ink transition-colors">
          <RefreshCw className="h-3 w-3" />Refresh track
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
