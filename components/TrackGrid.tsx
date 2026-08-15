"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { RefreshCw, TrendingUp, Layers, Filter } from "lucide-react";
import { useHarmonyForge } from "@/lib/genlayer";
import type { Track } from "@/lib/types";
import { TrackCard } from "./TrackCard";
import { CreateSeedForm } from "./CreateSeedForm";
import { Button } from "./ui/Button";

type Mode = "all" | "top" | "mine";

export function TrackGrid({ onOpen }: { onOpen: (id: string) => void }) {
  const { isConnected } = useAccount();
  const { listActiveTracks, getTopTracks, getMyTracks, getTrack } = useHarmonyForge();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  const [genreFilter, setGenreFilter] = useState("");

  async function refresh(m: Mode = mode) {
    if (!isConnected && m === "mine") return;
    setLoading(true);
    try {
      let ids: string[] = [];
      if (m === "top")       ids = await getTopTracks(20);
      else if (m === "mine") ids = await getMyTracks();
      else                   ids = await listActiveTracks();
      const hydrated = await Promise.all(ids.map((id) => getTrack(id)));
      setTracks(
        genreFilter
          ? hydrated.filter((t) => t.genre.toLowerCase().includes(genreFilter.toLowerCase()))
          : hydrated
      );
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isConnected]);

  function switchMode(m: Mode) { setMode(m); refresh(m); }

  const [featured, ...rest] = tracks;

  if (!isConnected) return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="font-display text-lg text-ink">The deck is dark.</p>
      <p className="max-w-sm font-body text-sm text-muted">
        Connect a wallet to browse the studio.
      </p>
    </div>
  );

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        {/* Featured */}
        <div className="relative overflow-hidden rounded-md border border-line bg-panel p-8">
          <div className="absolute inset-0 bg-grain opacity-30" />
          <p className="relative font-mono text-[11px] uppercase tracking-[0.18em] text-pulse">Now evolving</p>
          {featured ? (
            <button onClick={() => onOpen(featured.id)} className="relative mt-3 block text-left">
              <h2 className="font-display text-3xl font-bold leading-tight text-ink">{featured.title}</h2>
              <p className="mt-1 led text-xs uppercase tracking-[0.12em] text-muted">
                {featured.genre} · v{featured.version} · #{featured.id}
                {(featured.contributors?.length ?? 1) > 1 && ` · ${featured.contributors!.length} contributors`}
              </p>
              <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-muted line-clamp-4">
                {featured.current_content}
              </p>
            </button>
          ) : (
            <p className="relative mt-3 font-body text-sm text-muted">
              {loading ? "Cueing up the catalog…" : "No tracks yet — press the first seed."}
            </p>
          )}
        </div>
        <CreateSeedForm onCreated={() => refresh()} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-sm border border-line overflow-hidden">
          {(["all","top","mine"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                mode === m ? "bg-pulse/20 text-pulse" : "text-muted hover:text-ink"
              }`}
            >
              {m === "all" ? <><Layers className="mr-1 inline h-3 w-3" />All</>
               : m === "top" ? <><TrendingUp className="mr-1 inline h-3 w-3" />Top</>
               : <><Filter className="mr-1 inline h-3 w-3" />Mine</>}
            </button>
          ))}
        </div>
        <input
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && refresh()}
          placeholder="Filter by genre…"
          className="rounded-sm border border-line bg-rail/60 px-3 py-1.5 font-mono text-[11px]
            text-ink placeholder:text-muted/60 focus:border-current/60 focus:outline-none"
        />
        <Button variant="ghost" onClick={() => refresh()} loading={loading} className="!px-3 !py-1.5 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {rest.length === 0 && !loading ? (
        <p className="font-body text-sm text-muted">Nothing else spinning.</p>
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((t) => <TrackCard key={t.id} track={t} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

