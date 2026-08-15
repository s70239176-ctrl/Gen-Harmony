"use client";

import { useState, useEffect } from "react";
import { Gavel, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "./ui/Button";
import { VuMeter } from "./VuMeter";
import { useHarmonyForge } from "@/lib/genlayer";

type State = "idle" | "judging" | "submitted" | "error";

export function EvaluateProposalButton({
  proposalId, onResolved,
}: { proposalId: string; onResolved?: () => void; }) {
  const { evaluateProposal } = useHarmonyForge();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Tick a visible timer while the LLM jury deliberates (takes 30-90s)
  useEffect(() => {
    if (state !== "judging") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  async function handleEvaluate() {
    setState("judging");
    setError(null);
    try {
      await evaluateProposal(proposalId);
      setState("submitted");
      onResolved?.();
    } catch (err) {
      const raw = err instanceof Error ? err.message
        : typeof err === "object" && err !== null ? JSON.stringify(err) : String(err);
      if (raw.includes("non-whitespace") || raw.includes("JSON at position")) {
        setState("submitted"); onResolved?.();
      } else {
        setError(raw); setState("error");
      }
    }
  }

  if (state === "judging") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-sm border border-line bg-rail/60 px-4 py-2.5">
          <VuMeter label="Jury deliberating" />
          <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-muted">
            <Clock className="h-3 w-3" />
            {elapsed}s
          </span>
        </div>
        <p className="font-mono text-[10px] text-muted">
          LLM consensus takes 30–90 seconds — do not close this tab
        </p>
      </div>
    );
  }

  if (state === "submitted") {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-current/40 px-4 py-2.5 text-current">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-mono text-[12px] uppercase tracking-[0.1em]">
          Submitted — refresh track to see verdict
        </span>
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

