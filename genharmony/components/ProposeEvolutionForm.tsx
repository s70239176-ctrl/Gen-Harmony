"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Field";
import { useHarmonyForge } from "@/lib/genlayer";

const TYPES = ["harmony", "remix", "lyric", "melody", "structure"] as const;

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      setStatusMsg("Submitting proposal…");
      const proposalId = await proposeEvolution(
        trackId, targetElement, musicalRelationship, keyTerms, type
      );
      setTargetElement("");
      setMusicalRelationship("");
      setKeyTerms("");
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
      </div>
      {statusMsg && <p className="mt-3 font-mono text-[11px] text-muted">{statusMsg}</p>}
      {error && <p className="mt-3 font-mono text-[12px] text-pulse">{error}</p>}
      <Button type="submit" variant="secondary" loading={submitting} className="mt-4 w-full">
        Submit proposal
      </Button>
    </form>
  );
}
