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
  const { evaluateProposal, getTrack } = useHarmonyForge();
  const [state, setState] = useState<State>("idle");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== "judging" && state !== "polling") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  // Poll the TRACK version — not the proposal — to determine the verdict.
  // If track.version > initialVersion → approved (scores are in track history).
  // If unchanged after maxAttempts → rejected or still running.
  async function pollTrackForVerdict(maxAttempts = 60) {
    setState("polling");
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const track = await getTrack(trackId);
        if (track.version > initialVersion) {
          // Approved — pull scores from the latest history entry
          const history = track.history ?? [];
          const latest = history[history.length - 1];
          const s = latest?.scores;
          const composite = s
            ? Math.round((s.originality + s.quality + s.emotional + s.canon_fit) / 4)
            : 0;
          setVerdict({
            status: "approved",
            composite_score: composite,
            rationale: latest?.rationale ?? null,
          });
          setState("done");
          onResolved?.(track);
          return;
        }
      } catch { /* keep polling */ }
    }
    // Track didn't change — proposal was rejected or jury is still running
    setState("timeout");
  }

  async function handleEvaluate() {
    setState("judging");
    setError(null);
    try {
      await evaluateProposal(proposalId);
      await pollTrackForVerdict();
    } catch (err) {
      const raw = err instanceof Error ? err.message
        : typeof err === "object" && err !== null ? JSON.stringify(err)
        : String(err);
      if (raw.includes("non-whitespace") || raw.includes("JSON at position")) {
        // Receipt decode noise from genlayer-js — tx went through
        await pollTrackForVerdict();
      } else {
        setError(raw);
        setState("error");
      }
    }
  }

  async function checkNow() {
    try {
      const track = await getTrack(trackId);
      if (track.version > initialVersion) {
        const history = track.history ?? [];
        const latest = history[history.length - 1];
        const s = latest?.scores;
        const composite = s
          ? Math.round((s.originality + s.quality + s.emotional + s.canon_fit) / 4)
          : 0;
        setVerdict({
          status: "approved",
          composite_score: composite,
          rationale: latest?.rationale ?? null,
        });
        setState("done");
        onResolved?.(track);
      } else {
        // Still pending or rejected — poll a bit more
        setVerdict({ status: "rejected", composite_score: 0, rationale: "The jury did not approve this evolution. Try a more substantial contribution." });
        setState("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
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
          ? "LLM consensus takes 30–90s — do not close this tab"
          : "Transaction confirmed — watching for canon update…"}
      </p>
    </div>
  );

  if (state === "timeout") return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-sm border border-vinyl/40 bg-rail/60 px-4 py-2.5">
        <Hourglass className="h-4 w-4 text-vinyl shrink-0" />
        <p className="font-mono text-[12px] text-vinyl">Jury still deliberating or proposal rejected</p>
      </div>
      <Button variant="ghost" onClick={checkNow} className="gap-2 !px-3 !py-1.5">
        <RefreshCw className="h-3.5 w-3.5" />Check now
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
              {approved && verdict.composite_score > 0 && ` · ${verdict.composite_score}/100`}
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
