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

  async function poll(maxAttempts = 80) {
    setState("polling");
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        // Check proposal status via genlayer-js (handles CORS correctly)
        setPollLabel(`Checking proposal #${proposalId}…`);
        const proposal = await getProposal(proposalId);

        if (proposal.status === "approved") {
          const s = proposal.scores;
          const composite = s
            ? Math.round((s.originality + s.quality + s.emotional + s.canon_fit) / 4)
            : 0;
          const track = await getTrack(trackId).catch(() => null);
          setVerdict({ status: "approved", composite_score: composite, rationale: proposal.rationale });
          setState("done");
          onResolved?.(track ?? undefined);
          return;
        }

        if (proposal.status === "rejected") {
          const s = proposal.scores;
          const composite = s
            ? Math.round((s.originality + s.quality + s.emotional + s.canon_fit) / 4)
            : 0;
          setVerdict({ status: "rejected", composite_score: composite, rationale: proposal.rationale });
          setState("done");
          onResolved?.();
          return;
        }

        // Still pending — also check track version as backup signal
        setPollLabel(`Proposal pending · also checking track version…`);
        const track = await getTrack(trackId).catch(() => null);
        if (track && track.version > initialVersion) {
          const history = track.history ?? [];
          const latest = history[history.length - 1];
          const s = latest?.scores;
          const composite = s
            ? Math.round((s.originality + s.quality + s.emotional + s.canon_fit) / 4)
            : 0;
          setVerdict({ status: "approved", composite_score: composite, rationale: latest?.rationale ?? null });
          setState("done");
          onResolved?.(track);
          return;
        }

        setPollLabel(`Still pending · ${elapsed}s elapsed`);
      } catch { /* keep polling */ }
    }
    setState("timeout");
    setPollLabel("");
  }

  async function handleEvaluate() {
    setState("judging");
    setError(null);
    setPollLabel("");
    try {
      await evaluateProposal(proposalId);
      await poll();
    } catch (err) {
      const raw = err instanceof Error ? err.message
        : typeof err === "object" && err !== null ? JSON.stringify(err)
        : String(err);
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
          : "Polling via genlayer-js every 3s…")}
      </p>
    </div>
  );

  if (state === "timeout") return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-sm border border-vinyl/40 bg-rail/60 px-4 py-2.5">
        <Hourglass className="h-4 w-4 text-vinyl shrink-0" />
        <p className="font-mono text-[12px] text-vinyl">Still running after 4 minutes</p>
      </div>
      <p className="font-mono text-[10px] text-muted">
        Check GenLayer Studio to see the proposal status, then come back and click below.
      </p>
      <div className="flex gap-2 flex-wrap">
        <Button variant="ghost" onClick={() => poll(30)} className="gap-1.5 !px-3 !py-1.5">
          <RefreshCw className="h-3.5 w-3.5" />Keep polling
        </Button>
        <button
          onClick={async () => {
            try {
              const proposal = await getProposal(proposalId);
              if (proposal.status !== "pending") {
                const s = proposal.scores;
                const composite = s ? Math.round((s.originality + s.quality + s.emotional + s.canon_fit) / 4) : 0;
                setVerdict({ status: proposal.status as "approved"|"rejected", composite_score: composite, rationale: proposal.rationale });
                setState("done");
                if (proposal.status === "approved") onResolved?.();
              } else {
                await poll(20);
              }
            } catch { await poll(20); }
          }}
          className="font-mono text-[11px] text-current hover:underline transition-colors">
          Check now
        </button>
        <button
          onClick={() => { setVerdict({ status: "rejected", composite_score: 0, rationale: "Manually marked." }); setState("done"); }}
          className="font-mono text-[11px] text-muted hover:text-pulse transition-colors">
          Mark rejected
        </button>
      </div>
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
