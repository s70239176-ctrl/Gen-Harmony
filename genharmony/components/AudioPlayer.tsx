"use client";

import { useState, useRef, useEffect } from "react";
import { Play, Pause, Music2, ExternalLink } from "lucide-react";
import { Input } from "./ui/Field";
import { Button } from "./ui/Button";

const audioKey = (trackId: string, version: number) => `gh_audio_${trackId}_v${version}`;

export function AudioPlayer({ trackId, version }: { trackId: string; version: number }) {
  const [audioUrl, setAudioUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(audioKey(trackId, version));
    if (saved) setAudioUrl(saved);
    else setAudioUrl("");
    setPlaying(false);
  }, [trackId, version]);

  function handleSave() {
    if (!urlInput.trim()) return;
    const url = urlInput.trim();
    localStorage.setItem(audioKey(trackId, version), url);
    setAudioUrl(url);
    setUrlInput("");
    setShowInput(false);
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play().catch(() => {}); setPlaying(true); }
  }

  if (audioUrl) return (
    <div className="flex items-center gap-3 rounded-sm border border-line bg-rail/60 px-4 py-2.5">
      <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} className="hidden" />
      <button onClick={togglePlay}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-pulse/50 text-pulse hover:bg-pulse/10 transition-colors">
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <p className="flex-1 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
        {playing ? "Now playing" : "Audio — v" + version}
      </p>
      <a href={audioUrl} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink">
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <button onClick={() => { localStorage.removeItem(audioKey(trackId, version)); setAudioUrl(""); }}
        className="font-mono text-[10px] text-muted hover:text-pulse">clear</button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-sm border border-line/60 bg-rail/40 px-4 py-2.5">
        <Music2 className="h-4 w-4 text-muted" />
        <p className="flex-1 font-mono text-[11px] text-muted">
          No audio — generate with Suno/Udio and paste the URL
        </p>
        <button onClick={() => setShowInput((s) => !s)}
          className="font-mono text-[11px] uppercase tracking-[0.1em] text-current hover:underline">
          {showInput ? "Cancel" : "Add URL"}
        </button>
      </div>
      {showInput && (
        <div className="space-y-2">
          <Input label="Audio URL (.mp3 / .wav / direct link)"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="https://cdn.suno.ai/..." />
          <Button variant="secondary" onClick={handleSave} className="w-full">
            Save locally &amp; play
          </Button>
        </div>
      )}
    </div>
  );
}
