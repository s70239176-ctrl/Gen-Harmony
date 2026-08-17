"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Field";
import { useHarmonyForge, findProposalId } from "@/lib/genlayer";

const TYPES = ["harmony", "remix", "lyric", "melody", "structure"] as const;

export function ProposeEvolutionForm({
  trackId,
  onProposed,
}: {
  trackId: string;
  onProposed?: (proposalId: string, type: string) => void;
}) {
  const { proposeEvolution, getEvents } = useHarmonyForge();
  const [type, setType] = useState<(typeof TYPES)[number]>("harmony");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Snapshot event count before write so we can scan forward after
      let eventCountBefore = 0;
      try {
        const events = await getEvents(0, 100);
        eventCountBefore = Array.isArray(events) ? events.length : 0;
      } catch { /* best effort */ }

      const rawId = await proposeEvolution(trackId, text, type);

      // If rawId is a clean integer string — it's the real proposal ID
      if (/^\d+$/.test(String(rawId))) {
        setText("");
        onProposed?.(String(rawId), type);
        return;
      }

      // Otherwise (tx hash returned) — scan events to find real ID
      const realId = await findProposalId(trackId, "", eventCountBefore);
      if (realId !== null) {
        setText("");
        onProposed?.(realId, type);
        return;
      }

      // Last resort: use rawId and warn
      console.warn("Could not resolve proposal ID, using raw:", rawId);
      setText("");
      onProposed?.(String(rawId), type);
    } catch (err) {
      const msg = err instanceof Error ? err.message
        : typeof err === "object" ? JSON.stringify(err) : String(err);
      setError(msg);
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

      <Textarea label="Contribution" rows={3} value={text}
        onChange={(e) => setText(e.target.value)} required
        placeholder="Add a half-time breakdown that strips to a single arpeggiated synth..." />

      {error && <p className="mt-3 font-mono text-[12px] text-pulse">{error}</p>}

      <Button type="submit" variant="secondary" loading={submitting} className="mt-4 w-full">
        Submit proposal
      </Button>
    </form>
  );
}
