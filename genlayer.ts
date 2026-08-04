"use client";

import { defineChain } from "viem";
import { createConfig, http, useWalletClient, useAccount } from "wagmi";
import { injected } from "wagmi/connectors";
import { useCallback, useMemo } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Track, Proposal, MintedElement } from "./types";

// ---------------------------------------------------------------------------
// wagmi config — wallet connection UI
// ---------------------------------------------------------------------------
export const genLayerStudio = defineChain({
  id: 61_999,
  name: "GenLayer Studio",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [genLayerStudio],
  connectors: [injected()],
  transports: { [genLayerStudio.id]: http() },
});

export const CONTRACT_ADDRESS =
  "0x3F51358206490CcB8eDD2D40Fd8bb42bCd39F363" as const;

// ---------------------------------------------------------------------------
// Safe coercion — readContract may return string or already-parsed value
// ---------------------------------------------------------------------------
function coerce<T>(v: unknown): T {
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as unknown as T;
}

// ---------------------------------------------------------------------------
// useHarmonyForge
//
// FIX 3: Writes are signed by the CONNECTED wallet (via wagmi useWalletClient),
// not a shared environment-variable key. Each contributor signs their own
// transactions — canon credit and reward payouts go to their address.
//
// genlayer-js createClient accepts any viem Account. wagmi's walletClient.account
// is a viem Account backed by the injected provider (MetaMask / browser wallet),
// so passing it directly gives per-user signing without exposing any private key.
// ---------------------------------------------------------------------------
export function useHarmonyForge() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient({ config: wagmiConfig });

  // ---- reads — no wallet needed ----------------------------------------
  const read = useCallback(
    async <T,>(functionName: string, args: unknown[] = []): Promise<T> => {
      const client = createClient({ chain: studionet });
      const result = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args: args as never[],
      });
      return coerce<T>(result);
    },
    [],
  );

  // ---- writes — signed by the connected wallet -------------------------
  const write = useCallback(
    async (
      functionName: string,
      args: unknown[] = [],
      value = BigInt(0),
    ): Promise<{ txHash: string; result: unknown }> => {
      if (!walletClient?.account) {
        throw new Error("No wallet connected — please connect first.");
      }

      // Pass the wagmi wallet client's viem Account directly to genlayer-js.
      // This routes signing through the user's browser wallet (MetaMask etc.)
      // rather than any shared private key.
      const client = createClient({
        chain: studionet,
        account: walletClient.account,
      });

      const txHash = await client.writeContract({
        account: walletClient.account,
        address: CONTRACT_ADDRESS,
        functionName,
        args: args as never[],
        value,
      });

      const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
      });

      const result =
        (receipt as unknown as Record<string, unknown>).result ?? txHash;
      return { txHash: txHash as string, result };
    },
    [walletClient],
  );

  // ---- public API -------------------------------------------------------
  return useMemo(
    () => ({
      // writes
      submitSeed: (title: string, seedPrompt: string, genre: string) =>
        write("submit_seed", [title, seedPrompt, genre])
          .then(({ result }) => coerce<string>(result)),

      proposeEvolution: (trackId: string, text: string, type: string) =>
        write("propose_evolution", [trackId, text, type])
          .then(({ result }) => coerce<string>(result)),

      forkTrack: (parentTrackId: string, newTitle: string) =>
        write("fork_track", [parentTrackId, newTitle])
          .then(({ result }) => coerce<string>(result)),

      evaluateProposal: (proposalId: string) =>
        write("evaluate_proposal", [proposalId])
          .then(({ txHash }) => txHash),

      fundTreasury: (valueWei: bigint) =>
        write("fund_treasury", [], valueWei).then(({ txHash }) => txHash),

      claimRewards: () =>
        write("claim_rewards", []).then(({ txHash }) => txHash),

      mintElement: (trackId: string, kind: string, valueWei: bigint) =>
        write("mint_element", [trackId, kind], valueWei)
          .then(({ result }) => coerce<string>(result)),

      // reads
      getTrack: (trackId: string) =>
        read<Track>("get_track", [trackId]),
      getProposal: (proposalId: string) =>
        read<Proposal>("get_proposal", [proposalId]),
      listActiveTracks: () =>
        read<string[]>("list_active_tracks", []),
      getPendingRewards: (addr: string) =>
        read<unknown>("get_pending_rewards", [addr]).then(String),
      getTreasuryBalance: () =>
        read<unknown>("get_treasury_balance", []).then(String),
      getContributionCount: (addr: string) =>
        read<unknown>("get_contribution_count", [addr]).then(String),
      getMyMintedElements: () =>
        read<string[]>("get_my_minted_elements", []),
      getMintedElement: (elementId: string) =>
        read<MintedElement>("get_minted_element", [elementId]),
    }),
    [read, write],
  );
}
