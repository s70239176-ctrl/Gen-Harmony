"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Stamp, ListMusic, Share2, Check } from "lucide-react";
import { useHarmonyForge } from "@/lib/genlayer";
import type { Track } from "@/lib/types";
import { Button } from "./ui/Button";
import { ProposeEvolutionForm } from "./ProposeEvolutionForm";
import { EvaluateProposalButton } from "./EvaluateProposalButton";
import { MintElementModal } from "./MintElementModal";
import { TrackHistory } from "./TrackHistory";
import { AudioPlayer } from "./AudioPlayer";

interface SessionProposal { id: string; type: string; }

export function TrackDetail({ trackId, onBack }: { trackId: string; onBack: () => void }) {
  const { getTrack } = useHarmonyForge();
  const [track, setTrack] = useState<Track | null>(null);
  const [mintOpen, setMintOpen] = useState(false);
  const [sessionProposals, setSessionProposals] = useState<SessionProposal[]>([]);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"content" | "history">("content");

  async function refresh() { setTrack(await getTrack(trackId)); }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [trackId]);

  function onProposed(proposalId: string, type: string) {
    setSessionProposals((p) => [...p, { id: proposalId, type }]);
  }

  function handleShare() {
    const url = `${window.location.origin}?track=${trackId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!track) return <p className="font-body text-sm text-muted">Cueing up track #{trackId}…</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <button onClick={onBack}
          className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-muted hover:text-ink transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the deck
        </button>
        <button onClick={handleShare}
          className="flex items-center gap-1.5 font-mono text-[11px] text-muted hover:text-ink transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-current" /> : <Share2 className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Share"}
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="relative overflow-hidden rounded-md border border-line bg-panel p-8">
          <div className="absolute inset-0 bg-grain opacity-30" />
          <div className="relative space-y-6">
            <div>
              <p className="led text-[11px] uppercase tracking-[0.16em] text-pulse">
                {track.genre} · v{track.version} · #{track.id}
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-ink">{track.title}</h1>
              <p className="mt-1 font-mono text-[11px] text-muted">
                by {track.creator.slice(0, 8)}…
                {(track.contributors?.length ?? 1) > 1 && (
                  <span className="ml-2 text-muted/60">+{track.contributors!.length - 1} contributors</span>
                )}
              </p>
            </div>

            <div className="flex gap-1 border-b border-line pb-0">
              {(["content", "history"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`pb-2 px-1 font-mono text-[11px] uppercase tracking-[0.1em] border-b-2 transition-colors -mb-px ${
                    tab === t ? "border-pulse text-pulse" : "border-transparent text-muted hover:text-ink"
                  }`}>
                  {t}
                </button>
              ))}
            </div>

            {tab === "content"
              ? <p className="whitespace-pre-wrap font-body text-[15px] leading-relaxed text-ink/90">{track.current_content}</p>
              : <TrackHistory trackId={track.id} />
            }

            <AudioPlayer trackId={track.id} audioUrl={track.audio_url || undefined} onAudioSet={refresh} />

            <Button variant="vinyl" onClick={() => setMintOpen(true)} className="gap-2">
              <Stamp className="h-3.5 w-3.5" />
              Mint v{track.version}
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <ProposeEvolutionForm trackId={track.id} onProposed={onProposed} />
          <div className="rounded-md border border-line bg-panel/70 p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <ListMusic className="h-4 w-4 text-vinyl" />
              <h4 className="font-display text-sm font-semibold uppercase tracking-[0.1em] text-ink">
                Session proposals
              </h4>
            </div>
            {sessionProposals.length === 0
              ? <p className="font-body text-sm text-muted">Propose an evolution above — its on-chain ID appears here.</p>
              : (
                <ul className="space-y-3">
                  {sessionProposals.map((p) => (
                    <li key={p.id} className="flex flex-col gap-2 rounded-sm border border-line/60 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">{p.type}</span>
                        <span className="led text-[10px] text-muted/60">#{p.id}</span>
                      </div>
                      <EvaluateProposalButton proposalId={p.id} onResolved={refresh} />
                    </li>
                  ))}
                </ul>
              )
            }
          </div>
        </div>
      </div>
      <MintElementModal trackId={track.id} open={mintOpen} onClose={() => setMintOpen(false)} />
    </div>
  );
}
