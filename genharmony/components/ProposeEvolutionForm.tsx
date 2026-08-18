"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Field";
import { useHarmonyForge } from "@/lib/genlayer";
import { CONTRACT_ADDRESS } from "@/lib/genlayer";

const TYPES = ["harmony", "remix", "lyric", "melody", "structure"] as const;
const RPC_URL = "https://studio.genlayer.com:8443/api";

async function findPendingProposalForTrack(trackId: string): Promise<string | null> {
  // Scan proposals 0-29, find one that is pending for this track
  for (let i = 29; i >= 0; i--) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: i + 100,
          method: "gen_call",
          params: [{ to: CONTRACT_ADDRESS, function: "get_proposal", args: [String(i)] }]
        }),
      });
      const json = await res.json();
      if (json.error) continue;
      const proposal = typeof json.result === "string"
        ? JSON.parse(json.result)
        : json.result;
      if (proposal?.track_id === trackId && proposal?.status === "pending") {
        return String(i);
      }
    } catch { continue; }
  }
  return null;
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
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await proposeEvolution(trackId, text, type);

      // Scan directly for the pending proposal on this track
      setSubmitting(false);
      setResolving(true);

      const realId = await findPendingProposalForTrack(trackId);

      if (realId !== null) {
        setText("");
        onProposed?.(realId, type);
      } else {
        setError("Proposal submitted but ID could not be resolved — check Studio and enter the ID manually.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message
        : typeof err === "object" ? JSON.stringify(err) : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
      setResolving(false);
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

      {resolving && (
        <p className="mt-3 font-mono text-[11px] text-muted animate-pulse">
          Resolving proposal ID…
        </p>
      )}
      {error && <p className="mt-3 font-mono text-[12px] text-pulse">{error}</p>}

      <Button type="submit" variant="secondary"
        loading={submitting || resolving} className="mt-4 w-full">
        Submit proposal
      </Button>
    </form>
  );
}
