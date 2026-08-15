"use client";

import { useState, useRef } from "react";
import { Play, Pause, Music2, ExternalLink } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Field";
import { useHarmonyForge } from "@/lib/genlayer";

interface Props {
  trackId: string;
  audioUrl?: string;
  onAudioSet?: () => void;
}

export function AudioPlayer({ trackId, audioUrl, onAudioSet }: Props) {
  const { setAudioUrl } = useHarmonyForge();
  const [playing, setPlaying] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  }

  async function handleSave() {
    if (!urlInput.trim()) return;
    setSaving(true); setError(null);
    try {
      await setAudioUrl(trackId, urlInput.trim());
      setShowInput(false);
      onAudioSet?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  }

  if (audioUrl) return (
    <div className="flex items-center gap-3 rounded-sm border border-line bg-rail/60 px-4 py-2.5">
      <audio
        ref={audioRef}
        src={audioUrl}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <button
        onClick={togglePlay}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-pulse/50
          text-pulse transition-colors hover:bg-pulse/10"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <div className="flex-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
          {playing ? "Now playing" : "Audio available"}
        </p>
      </div>
      <a
        href={audioUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted hover:text-ink"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-sm border border-line/60 bg-rail/40 px-4 py-2.5">
        <Music2 className="h-4 w-4 text-muted" />
        <p className="flex-1 font-mono text-[11px] text-muted">
          No audio yet — generate with Suno/Udio and paste the URL below
        </p>
        <button
          onClick={() => setShowInput((s) => !s)}
          className="font-mono text-[11px] uppercase tracking-[0.1em] text-current hover:underline"
        >
          {showInput ? "Cancel" : "Add URL"}
        </button>
      </div>
      {showInput && (
        <div className="space-y-2">
          <Input
            label="Audio URL"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://cdn.suno.ai/..."
          />
          {error && <p className="font-mono text-[12px] text-pulse">{error}</p>}
          <Button variant="secondary" loading={saving} onClick={handleSave} className="w-full">
            Save audio URL on-chain
          </Button>
        </div>
      )}
    </div>
  );
}

