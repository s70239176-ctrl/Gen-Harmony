"use client";

import { useEffect, useState } from "react";
import { useHarmonyForge } from "@/lib/genlayer";
import type { HistoryEntry } from "@/lib/types";

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{label}</span>
      <div className="h-1 flex-1 rounded-full bg-line">
        <div
          className="h-1 rounded-full bg-gradient-to-r from-pulse to-current transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="led w-7 text-right text-[10px] text-ink">{value}</span>
    </div>
  );
}

export function TrackHistory({ trackId }: { trackId: string }) {
  const { getTrackHistory } = useHarmonyForge();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTrackHistory(trackId)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  if (loading) return (
    <p className="font-mono text-[12px] text-muted">Loading lineage…</p>
  );

  return (
    <ol className="relative space-y-0 border-l border-line pl-6">
      {[...history].reverse().map((entry) => (
        <li key={entry.version} className="relative py-4">
          <span
            className={`absolute -left-[27px] top-5 h-3 w-3 rounded-full border-2 ${
              entry.version === history[history.length - 1]?.version
                ? "border-pulse bg-pulse shadow-glow-pulse"
                : "border-line bg-rail"
            }`}
          />
          <div className="flex items-baseline gap-3 mb-1">
            <span className="led text-[12px] text-ink">v{entry.version}</span>
            {entry.version === 0
              ? <span className="font-mono text-[10px] text-muted">Genesis seed</span>
              : <span className="font-mono text-[10px] text-muted">by {entry.contributor.slice(0, 8)}…</span>
            }
            {entry.proposal_id && (
              <span className="led text-[10px] text-muted/60">#{entry.proposal_id}</span>
            )}
          </div>
          {entry.rationale && (
            <p className="font-body text-[13px] text-muted leading-relaxed mb-2">{entry.rationale}</p>
          )}
          {entry.scores && (
            <div className="mt-2 space-y-1 rounded-sm border border-line/40 bg-rail/40 p-3">
              <ScoreBar label="Originality" value={entry.scores.originality} />
              <ScoreBar label="Quality"     value={entry.scores.quality} />
              <ScoreBar label="Emotional"   value={entry.scores.emotional} />
              <ScoreBar label="Canon fit"   value={entry.scores.canon_fit} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

