"use client";

import { useState } from "react";
import { GitBranch, Upload } from "lucide-react";
import { Button } from "./ui/Button";
import { Textarea, Input } from "./ui/Field";
import { useHarmonyForge } from "@/lib/genlayer";

const TYPES = ["harmony", "remix", "lyric", "melody", "structure"] as const;

async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ProposeEvolutionForm({
  trackId,
  onProposed,
}: {
  trackId: string;
  onProposed?: (proposalId: string, type: string) => void;
}) {
  const { proposeEvolution } = useHarmonyForge();
  const [type, setType] = useState<(typeof TYPES)[number]>("harmony");
  const [targetElement, setTargetElement] = useState("");
  const [musicalRelationship, setMusicalRelationship] = useState("");
  const [keyTerms, setKeyTerms] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioHash, setAudioHash] = useState("");
  const [hashing, setHashing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setAudioFile(file);
    setAudioHash("");
    if (!file) return;
    setHashing(true);
    try {
      const hash = await hashFile(file);
      setAudioHash(hash);
    } catch {
      setError("Could not hash the selected audio file — try a different file.");
      setAudioFile(null);
    } finally {
      setHashing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (audioUrl.trim() && !audioHash) {
      setError("An audio URL was entered but no file was hashed — upload the audio file, or clear the URL.");
      return;
    }
    if (audioHash && !audioUrl.trim()) {
      setError("An audio file was hashed but no URL was entered — add a URL, or remove the file.");
      return;
    }
    setSubmitting(true);
    try {
      setStatusMsg("Submitting proposal…");
      const proposalId = await proposeEvolution(
        trackId, targetElement, musicalRelationship, keyTerms, type,
        audioUrl.trim(), audioHash
      );
      setTargetElement("");
      setMusicalRelationship("");
      setKeyTerms("");
      setAudioUrl("");
      setAudioFile(null);
      setAudioHash("");
      setStatusMsg(null);
      onProposed?.(proposalId, type);
    } catch (err) {
      const msg = err instanceof Error ? err.message
        : typeof err === "object" ? JSON.stringify(err) : String(err);
      setError(msg);
      setStatusMsg(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-line bg-panel/70 p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <GitBranch className="h-4 w-4 text-current" />
        <h4 className="font-display text-sm font-semibold uppercase tracking-[0.1em] text-ink">
          Propose an evolution
        </h4>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button key={t} type="button" onClick={() => setType(t)}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
              type === t ? "border-current text-current shadow-glow-current" : "border-line text-muted hover:text-ink"
            }`}>
            {t}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <Textarea label="Target element" rows={1} value={targetElement}
          onChange={(e) => setTargetElement(e.target.value)} required
          placeholder="e.g. underlying texture, second verse, outro" />
        <Textarea label="Musical relationship" rows={3} value={musicalRelationship}
          onChange={(e) => setMusicalRelationship(e.target.value)} required
          placeholder="Describe precisely what changes and how it relates to the existing canon content..." />
        <Textarea label="Key terms" rows={1} value={keyTerms}
          onChange={(e) => setKeyTerms(e.target.value)} required
          placeholder="Comma-separated vocabulary anchoring this change, e.g. vocal texture, filtered, swell" />

        <div className="rounded-sm border border-line/60 bg-rail/40 p-3 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            Audio reference — optional
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <Upload className="h-3.5 w-3.5 text-muted shrink-0" />
            <input type="file" accept="audio/*" onChange={handleFileChange}
              className="font-mono text-[11px] text-muted file:mr-2 file:rounded-full file:border file:border-line file:bg-transparent file:px-2.5 file:py-1 file:font-mono file:text-[10px] file:uppercase file:tracking-[0.1em] file:text-current" />
          </label>
          {hashing && <p className="font-mono text-[10px] text-muted">Hashing file…</p>}
          {audioHash && (
            <p className="font-mono text-[10px] text-muted">
              Hashed: {audioHash.slice(0, 16)}… ({audioFile?.name})
            </p>
          )}
          <Input label="Audio URL (where this file is hosted)" value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            placeholder="https://cdn.suno.ai/..." />
          <p className="font-mono text-[10px] text-muted leading-relaxed">
            The hash pins which exact file you mean; the jury cannot listen to
            or analyze it — it is not evidence of quality or originality by
            itself. Leave both blank if you have no audio yet.
          </p>
        </div>
      </div>
      {statusMsg && <p className="mt-3 font-mono text-[11px] text-muted">{statusMsg}</p>}
      {error && <p className="mt-3 font-mono text-[12px] text-pulse">{error}</p>}
      <Button type="submit" variant="secondary" loading={submitting || hashing} className="mt-4 w-full">
        Submit proposal
      </Button>
    </form>
  );
}
