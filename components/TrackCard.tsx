"use client";

import { Music2 } from "lucide-react";
import type { Track } from "@/lib/types";

function ringColor(genre: string) {
  const hash = genre.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return ["#FF2E97", "#00E5FF", "#FFB627"][hash % 3];
}

export function TrackCard({ track, onOpen }: { track: Track; onOpen: (id: string) => void }) {
  const accent = ringColor(track.genre || "x");
  const contribCount = (track.contributors?.length ?? 1);

  return (
    <button
      onClick={() => onOpen(track.id)}
      className="group relative aspect-[4/5] w-full overflow-hidden rounded-md border border-line
        bg-panel p-5 text-left transition-all duration-200 hover:-translate-y-1"
      style={{ boxShadow: "0 0 0 1px rgba(244,238,255,0.06)" }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = `0 0 0 1px ${accent}55, 0 10px 40px ${accent}22`)}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 0 0 1px rgba(244,238,255,0.06)")}
    >
      <div className="absolute inset-0 bg-grain opacity-40" />

      <div className="relative flex h-full flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="led text-[10px] uppercase tracking-[0.16em] text-muted">
              #{track.id} · {track.genre}
            </p>
            {track.audio_url && (
              <Music2 className="h-3 w-3 text-current" title="Audio available" />
            )}
          </div>
          <h3 className="mt-1 font-display text-base font-semibold leading-snug text-ink">
            {track.title}
          </h3>
        </div>

        <p className="line-clamp-3 font-body text-[13px] leading-relaxed text-muted">
          {track.current_content}
        </p>

        <div className="space-y-2">
          {/* Score bar if history exists */}
          {track.history && track.history.length > 1 && track.history[track.history.length - 1].scores && (
            <div className="grid grid-cols-4 gap-1">
              {(["originality","quality","emotional","canon_fit"] as const).map((k) => {
                const score = track.history![track.history!.length - 1].scores![k];
                return (
                  <div key={k} className="space-y-0.5">
                    <div className="h-1 rounded-full bg-line">
                      <div className="h-1 rounded-full bg-current" style={{ width: `${score}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line
                transition-transform duration-300 group-hover:animate-spin-slow"
              style={{ background: `radial-gradient(circle at 50% 50%, ${accent}33 0%, #0F0825 70%)` }}
            >
              <span className="led text-[10px] text-ink">v{track.version}</span>
              <span className="absolute h-1.5 w-1.5 rounded-full bg-void" />
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] text-muted">{track.creator.slice(0, 6)}…</p>
              {contribCount > 1 && (
                <p className="led text-[10px] text-muted/60">{contribCount} contributors</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

