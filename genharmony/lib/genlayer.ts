"use client";

import { defineChain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createConfig, http, useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { useCallback, useMemo } from "react";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Track, Proposal, MintedElement, HistoryEntry } from "./types";

export const genLayerStudio = defineChain({
  id: 61_999,
  name: "GenLayer Studio",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: ["https://studio.genlayer.com:8443/api"] } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [genLayerStudio],
  connectors: [injected()],
  transports: { [genLayerStudio.id]: http() },
});

export const CONTRACT_ADDRESS =
  "0x4F70083C2441EBa28D86694FF5C4d405e5644002" as const;

const GL_KEY = "genharmony_contributor_pk";

function getOrCreateContributorKey(): `0x${string}` {
  if (typeof window === "undefined")
    return "0x0000000000000000000000000000000000000000000000000000000000000001";
  let pk = localStorage.getItem(GL_KEY) as `0x${string}` | null;
  if (!pk) { pk = generatePrivateKey(); localStorage.setItem(GL_KEY, pk); }
  return pk;
}

export function getContributorAddress(): string {
  if (typeof window === "undefined") return "";
  try { return privateKeyToAccount(getOrCreateContributorKey()).address; } catch { return ""; }
}

function coerce<T>(v: unknown): T {
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return v as unknown as T; } }
  return v as unknown as T;
}

export function useHarmonyForge() {
  const { chainId } = useAccount();
  const { data: walletClient } = useWalletClient({ config: wagmiConfig });
  const { switchChainAsync } = useSwitchChain({ config: wagmiConfig });

  const read = useCallback(async <T,>(functionName: string, args: unknown[] = []): Promise<T> => {
    const client = createClient({ chain: studionet });
    const result = await client.readContract({
      address: CONTRACT_ADDRESS, functionName, args: args as never[],
    });
    return coerce<T>(result);
  }, []);

  const write = useCallback(async (
    functionName: string, args: unknown[] = [], value = BigInt(0),
  ): Promise<{ txHash: string; result: unknown }> => {
    if (chainId !== genLayerStudio.id) {
      try { await switchChainAsync({ chainId: genLayerStudio.id }); }
      catch { throw new Error(`Switch to GenLayer Studio (chain ${genLayerStudio.id}) in your wallet.`); }
      throw new Error("Switched to GenLayer Studio — please click again to continue.");
    }
    const pk = getOrCreateContributorKey();
    const account = createAccount(pk);
    const client = createClient({ chain: studionet, account });
    const txHash = await client.writeContract({
      account, address: CONTRACT_ADDRESS, functionName, args: args as never[], value,
    });
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash, status: TransactionStatus.ACCEPTED,
    });
    const result = (receipt as unknown as Record<string, unknown>).result ?? txHash;
    return { txHash: txHash as string, result };
  }, [chainId, switchChainAsync]);

  return useMemo(() => ({
    // writes
    submitSeed: (title: string, seedPrompt: string, genre: string) =>
      write("submit_seed", [title, seedPrompt, genre]).then(({ result }) => coerce<string>(result)),
    proposeEvolution: (trackId: string, text: string, type: string) =>
      write("propose_evolution", [trackId, text, type]).then(({ result }) => coerce<string>(result)),
    forkTrack: (parentTrackId: string, newTitle: string) =>
      write("fork_track", [parentTrackId, newTitle]).then(({ result }) => coerce<string>(result)),
    evaluateProposal: (proposalId: string) =>
      write("evaluate_proposal", [proposalId]).then(({ txHash }) => txHash),
    fundTreasury: (valueWei: bigint) =>
      write("fund_treasury", [], valueWei).then(({ txHash }) => txHash),
    claimRewards: () =>
      write("claim_rewards", []).then(({ txHash }) => txHash),
    mintElement: (trackId: string, kind: string, valueWei: bigint) =>
      write("mint_element", [trackId, kind], valueWei).then(({ result }) => coerce<string>(result)),
    setAudioUrl: (trackId: string, audioUrl: string) =>
      write("set_audio_url", [trackId, audioUrl]).then(({ txHash }) => txHash),
    pause: () => write("pause", []).then(({ txHash }) => txHash),
    unpause: () => write("unpause", []).then(({ txHash }) => txHash),
    updateConfig: (key: string, value: bigint) =>
      write("update_config", [key, value]).then(({ txHash }) => txHash),

    // reads
    getTrack: (trackId: string) => read<Track>("get_track", [trackId]),
    getTrackHistory: (trackId: string) =>
      read<unknown>("get_track_history", [trackId]).then((v) => coerce<HistoryEntry[]>(v)),
    getProposal: (proposalId: string) => read<Proposal>("get_proposal", [proposalId]),
    listActiveTracks: () => read<string[]>("list_active_tracks", []),
    getMyTracks: () =>
      read<unknown>("get_my_tracks", []).then((v) => coerce<string[]>(v)),
    getTracksByGenre: (genre: string) =>
      read<unknown>("get_tracks_by_genre", [genre]).then((v) => coerce<string[]>(v)),
    getTopTracks: (limit = 10) =>
      read<unknown>("get_top_tracks", [String(limit)]).then((v) => coerce<string[]>(v)),
    getPendingRewards: (addr: string) =>
      read<unknown>("get_pending_rewards", [addr]).then(String),
    getTreasuryBalance: () =>
      read<unknown>("get_treasury_balance", []).then(String),
    getContributionCount: (addr: string) =>
      read<unknown>("get_contribution_count", [addr]).then(String),
    getMyMintedElements: () => read<string[]>("get_my_minted_elements", []),
    getMintedElement: (elementId: string) => read<MintedElement>("get_minted_element", [elementId]),
    getEvents: (fromId: number, limit: number) =>
      read<unknown>("get_events", [String(fromId), String(limit)]).then((v) => coerce<ContractEvent[]>(v)),
    getConfig: () =>
      read<unknown>("get_config", []).then((v) => coerce<ContractConfig>(v)),
  }), [read, write]);
}

export interface ContractConfig {
  approval_threshold: number;
  max_reward_bps: number;
  min_reward_score: number;
  max_prompt_chars: number;
  creator_royalty_bps: number;
  is_paused: boolean;
}

export interface ContractEvent {
  id: string;
  type: string;
  data: Record<string, string>;
}

/** 
 * After propose_evolution, scan recent events to find the actual on-chain proposal ID.
 * genlayer-js doesn't always expose receipt.result, so we use the event log as ground truth.
 */
export async function findProposalId(trackId: string, proposer: string, afterEventId: number): Promise<string | null> {
  try {
    const client = createClient({ chain: studionet });
    const events = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_events",
      args: [String(afterEventId), "20"] as never[],
    });
    const parsed = coerce<Array<{ type: string; data: Record<string, string> }>>(events);
    const match = parsed.reverse().find(
      (e) => e.type === "PROPOSAL_SUBMITTED" && e.data.track_id === trackId
    );
    return match?.data.proposal_id ?? null;
  } catch {
    return null;
  }
}
