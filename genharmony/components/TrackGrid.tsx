"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, TrendingUp, Layers, Filter } from "lucide-react";
import { useHarmonyForge } from "@/lib/genlayer";
import type { Track } from "@/lib/types";
import { TrackCard } from "./TrackCard";
import { CreateSeedForm } from "./CreateSeedForm";
import { Button } from "./ui/Button";

type Mode = "all" | "top" | "mine";

export function TrackGrid({ onOpen }: { onOpen: (id: string) => void }) {
  const { listActiveTracks, getTopTracks, getMyTracks, getTrack } = useHarmonyForge();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  const [genreFilter, setGenreFilter] = useState("");
  const [modeError, setModeError] = useState<string | null>(null);

  const refresh = useCallback(async (m: Mode, genre: string) => {
    setLoading(true);
    setModeError(null);
    try {
      let ids: string[] = [];

      if (m === "top") {
        try { ids = await getTopTracks(20); }
        catch {
          setModeError("Top tracks unavailable on this contract — showing all");
          ids = await listActiveTracks();
        }
      } else if (m === "mine") {
        try { ids = await getMyTracks(); }
        catch {
          setModeError("Mine filter unavailable on this contract — showing all");
          ids = await listActiveTracks();
        }
      } else {
        ids = await listActiveTracks();
      }

      if (!Array.isArray(ids) || ids.length === 0) {
        setTracks([]); return;
      }

      const hydrated = await Promise.all(
        ids.map((id) => getTrack(String(id)).catch(() => null))
      );
      const valid = hydrated.filter(Boolean) as Track[];
      setTracks(genre
        ? valid.filter((t) => t.genre.toLowerCase().includes(genre.toLowerCase()))
        : valid
      );
    } catch (err) {
      console.error("TrackGrid refresh error:", err);
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, [listActiveTracks, getTopTracks, getMyTracks, getTrack]);

  useEffect(() => { refresh("all", ""); }, [refresh]);

  function switchMode(m: Mode) {
    setMode(m);
    refresh(m, genreFilter);
  }

  const [featured, ...rest] = tracks;

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
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
              {loading ? "Cueing up the catalog…" : "No tracks yet — press your first seed."}
            </p>
          )}
        </div>
        <CreateSeedForm onCreated={() => refresh(mode, genreFilter)} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {(["all", "top", "mine"] as Mode[]).map((m) => (
            <button key={m} onClick={() => switchMode(m)}
              className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                mode === m ? "bg-pulse/20 text-pulse" : "text-muted hover:text-ink"
              }`}>
              {m === "all" ? <><Layers className="mr-1 inline h-3 w-3" />All</>
               : m === "top" ? <><TrendingUp className="mr-1 inline h-3 w-3" />Top</>
               : <><Filter className="mr-1 inline h-3 w-3" />Mine</>}
            </button>
          ))}
        </div>
        <input value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && refresh(mode, genreFilter)}
          placeholder="Filter by genre…"
          className="rounded-sm border border-line bg-rail/60 px-3 py-1.5 font-mono text-[11px]
            text-ink placeholder:text-muted/60 focus:border-current/60 focus:outline-none" />
        <Button variant="ghost" onClick={() => refresh(mode, genreFilter)}
          loading={loading} className="ml-auto !px-3 !py-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {modeError && (
        <p className="font-mono text-[11px] text-vinyl">{modeError}</p>
      )}

      {rest.length === 0 && !loading
        ? <p className="font-body text-sm text-muted">Nothing spinning yet — submit a seed above.</p>
        : <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {rest.map((t) => <TrackCard key={t.id} track={t} onOpen={onOpen} />)}
          </div>
      }
    </div>
  );
}
