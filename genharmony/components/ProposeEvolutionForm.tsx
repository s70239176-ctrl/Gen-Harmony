"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Field";
import { useHarmonyForge, CONTRACT_ADDRESS } from "@/lib/genlayer";

const TYPES = ["harmony", "remix", "lyric", "melody", "structure"] as const;
const RPC = "https://studio.genlayer.com:8443/api";

async function rpcCall(method: string, args: unknown[]) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: Date.now(),
      method: "gen_call",
      params: [{ to: CONTRACT_ADDRESS, function: method, args }],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result;
}

async function getNextProposalId(): Promise<string> {
  // Probe sequentially until we hit a missing proposal — that index is next
  for (let i = 0; i < 200; i++) {
    try {
      await rpcCall("get_proposal", [String(i)]);
    } catch {
      return String(i);
    }
  }
  return "0";
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
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setSubmitting(true);
    try {
      // Read next proposal ID BEFORE submitting — always current + 1
      setStatus("Reading current proposal count…");
      const nextId = await getNextProposalId();

      setStatus("Submitting proposal…");
      await proposeEvolution(trackId, text, type);

      setText("");
      setStatus(null);
      onProposed?.(nextId, type);
    } catch (err) {
      const msg = err instanceof Error ? err.message
        : typeof err === "object" ? JSON.stringify(err) : String(err);
      setError(msg);
      setStatus(null);
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

      {status && (
        <p className="mt-3 font-mono text-[11px] text-muted">{status}</p>
      )}
      {error && <p className="mt-3 font-mono text-[12px] text-pulse">{error}</p>}

      <Button type="submit" variant="secondary" loading={submitting} className="mt-4 w-full">
        Submit proposal
      </Button>
    </form>
  );
}
