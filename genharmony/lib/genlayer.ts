"use client";

import { defineChain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createConfig, http, useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { useCallback, useMemo } from "react";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Track, Proposal, MintedElement } from "./types";

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
  "0xeff4707d94140272f6C5895897e74ac583541b5e" as const;

const GL_KEY = "genharmony_contributor_pk";

function getOrCreateContributorKey(): `0x${string}` {
  if (typeof window === "undefined")
    return "0xeff4707d94140272f6C5895897e74ac583541b5e000000000000000000000001";
  let pk = localStorage.getItem(GL_KEY) as `0x${string}` | null;
  if (!pk) { pk = generatePrivateKey(); localStorage.setItem(GL_KEY, pk); }
  return pk;
}

export function getContributorAddress(): string {
  if (typeof window === "undefined") return "";
  try { return privateKeyToAccount(getOrCreateContributorKey()).address; } catch { return ""; }
}

function coerce<T>(v: unknown): T {
  if (typeof v === "string") {
    const trimmed = v.trim();
    const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
    if (looksLikeJson) {
      try { return JSON.parse(trimmed) as T; } catch { /* fall through */ }
    }
    return v as unknown as T;
  }
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
    waitFor: TransactionStatus = TransactionStatus.ACCEPTED,
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
    // Guard against the SDK never resolving if the tx lands in a terminal
    // failure state (UNDETERMINED / CANCELED / VALIDATORS_TIMEOUT /
    // LEADER_TIMEOUT) instead of the status we're waiting for — without
    // this, waiting for FINALIZED specifically could hang forever on a
    // failed consensus round rather than surfacing an error.
    const receiptPromise = client.waitForTransactionReceipt({
      hash: txHash, status: waitFor,
    });
    // FINALIZED requires waiting through the full appeal window on top of
    // consensus acceptance, so it needs materially more time than ACCEPTED.
    const timeoutMs = waitFor === TransactionStatus.FINALIZED ? 480_000 : 180_000;
    const timeoutMinutes = timeoutMs / 60_000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `Transaction ${txHash} did not reach ${waitFor} within ${timeoutMinutes} minutes — it may still be processing on-chain. Check the explorer for its real status.`
      )), timeoutMs)
    );
    const receipt = await Promise.race([receiptPromise, timeoutPromise]);
    console.log("RAW RECEIPT for", functionName, JSON.stringify(receipt, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
    // receipt.result (top-level) is a numeric transaction-outcome/status enum
    // (e.g. maps to TransactionResult), NOT the contract function's actual
    // return value — reading it directly silently returns the wrong thing
    // (a small integer that can coincidentally look like a valid id).
    // The real decoded return value is base64-encoded calldata nested at
    // consensus_data.leader_receipt[0].result, which must be run through
    // genlayer-js's own calldata decoder to get the actual typed value.
    let result: unknown = txHash;
    const leaderResult = (receipt as unknown as {
      consensus_data?: { leader_receipt?: Array<{ result?: unknown }> };
    })?.consensus_data?.leader_receipt?.[0]?.result;
    // leader_receipt[0].result is an object shaped { status: "return", payload: { readable: "<json-encoded value>" } }.
    // payload.readable is a JSON-encoded string (e.g. the literal text `"26"`
    // for a proposal id of 26), so it needs one JSON.parse to unwrap into the
    // real value — not base64/binary calldata as the shape elsewhere in this
    // SDK might suggest.
    const readable = (leaderResult as { status?: string; payload?: { readable?: string } })
      ?.payload?.readable;
    if (typeof readable === "string") {
      try {
        result = JSON.parse(readable);
      } catch {
        // leave result as the txHash fallback; callers validate shape themselves
      }
    }
    return { txHash: txHash as string, result };
  }, [chainId, switchChainAsync]);

  return useMemo(() => ({
    // writes
    submitSeed: (title: string, seedPrompt: string, genre: string) =>
      write("submit_seed", [title, seedPrompt, genre]).then(({ result }) => coerce<string>(result)),
    proposeEvolution: (trackId: string, text: string, type: string) =>
      write("propose_evolution", [trackId, text, type]).then(({ result, txHash }) => {
        const id = String(coerce<unknown>(result));
        // propose_evolution returns a plain numeric proposal id, not a hash.
        // If the SDK failed to surface receipt.result, write() falls back to
        // txHash — catch that here rather than let a hash silently pass as
        // an authoritative proposal id to the caller.
        if (!/^\d+$/.test(id) || id === txHash) {
          throw new Error(
            `propose_evolution did not return a usable proposal id (got "${id}"). ` +
            `Transaction ${txHash} may have succeeded on-chain — check the explorer, ` +
            `then look up the proposal via get_next_proposal_id or track history.`
          );
        }
        return id;
      }),
    forkTrack: (parentTrackId: string, newTitle: string) =>
      write("fork_track", [parentTrackId, newTitle]).then(({ result }) => coerce<string>(result)),
    evaluateProposal: (proposalId: string) =>
      write("evaluate_proposal", [String(proposalId)]).then(({ txHash }) => txHash),
    fundTreasury: (valueWei: bigint) =>
      write("fund_treasury", [], valueWei).then(({ txHash }) => txHash),
    claimRewards: () =>
      write("claim_rewards", []).then(({ txHash }) => txHash),
    mintElement: (trackId: string, kind: string, valueWei: bigint) =>
      write("mint_element", [trackId, kind], valueWei).then(({ result }) => coerce<string>(result)),
    // reads
    getTrack: (trackId: string) => read<Track>("get_track", [trackId]),
    getProposal: (proposalId: string) => read<Proposal>("get_proposal", [proposalId]),
    listActiveTracks: () => read<string[]>("list_active_tracks", []),
    getMyTracks: (address: string) =>
      read<unknown>("get_my_tracks", [address]).then((v) => coerce<string[]>(v)),
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
    getNextProposalId: () =>
      read<unknown>("get_next_proposal_id", []).then((v) => String(v)),
    getMintedElement: (elementId: string) => read<MintedElement>("get_minted_element", [elementId]),
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
