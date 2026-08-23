"use client";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHarmonyForge, wagmiConfig } from "@/lib/genlayer";

const queryClient = new QueryClient();

function DebugProposalInner() {
  const { getProposal, getTrack } = useHarmonyForge();
  const [proposalId, setProposalId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const lookupProposal = async () => {
    setLoading(true);
    setError("");
    setResult("");
    try {
      const r = await getProposal(proposalId);
      setResult(JSON.stringify(r, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const lookupTrack = async () => {
    setLoading(true);
    setError("");
    setResult("");
    try {
      const r = await getTrack(trackId);
      setResult(JSON.stringify(r, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: "monospace", maxWidth: 700 }}>
      <h1>Debug: raw contract reads</h1>

      <div style={{ marginBottom: 24 }}>
        <h2>get_proposal</h2>
        <input
          value={proposalId}
          onChange={(e) => setProposalId(e.target.value)}
          placeholder="proposal id, e.g. 0"
          style={{ marginRight: 8, padding: 4 }}
        />
        <button onClick={lookupProposal} disabled={loading || !proposalId}>
          Look up
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h2>get_track</h2>
        <input
          value={trackId}
          onChange={(e) => setTrackId(e.target.value)}
          placeholder="track id, e.g. 0"
          style={{ marginRight: 8, padding: 4 }}
        />
        <button onClick={lookupTrack} disabled={loading || !trackId}>
          Look up
        </button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <pre style={{ color: "red", whiteSpace: "pre-wrap" }}>{error}</pre>}
      {result && (
        <pre style={{ background: "#111", color: "#0f0", padding: 16, whiteSpace: "pre-wrap" }}>
          {result}
        </pre>
      )}
    </div>
  );
}

export default function DebugProposal() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <DebugProposalInner />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
