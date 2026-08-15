"use client";

import { defineChain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createConfig, http, useAccount, useWalletClient } from "wagmi";
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
  "0x5a284C186D6A858a63576340Fea352d0Bf5021Eb" as const;

const GL_KEY = "genharmony_contributor_pk";

/**
 * Returns this browser's contributor private key.
 * Generated once and persisted in localStorage — each user/device gets a
 * unique GenLayer address. This is NOT a shared key; every contributor signs
 * their own transactions with their own key and their own on-chain address.
 *
 * Note: MetaMask cannot sign GenLayer's custom transaction format (genlayer-js
 * requires a LocalAccount). A MetaMask Snap would be needed for hardware-wallet
 * backed signing — that integration is not yet stable in genlayer-js.
 */
function getOrCreateContributorKey(): `0x${string}` {
  if (typeof window === "undefined") return "0x0000000000000000000000000000000000000000000000000000000000000001";
  let pk = localStorage.getItem(GL_KEY) as `0x${string}` | null;
  if (!pk) {
    pk = generatePrivateKey();
    localStorage.setItem(GL_KEY, pk);
  }
  return pk;
}

export function getContributorAddress(): string {
  if (typeof window === "undefined") return "";
  try {
    const pk = getOrCreateContributorKey();
    return privateKeyToAccount(pk).address;
  } catch {
    return "";
  }
}

function coerce<T>(v: unknown): T {
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as unknown as T;
}

export function useHarmonyForge() {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ config: wagmiConfig });

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

  const write = useCallback(
    async (
      functionName: string,
      args: unknown[] = [],
      value = BigInt(0),
    ): Promise<{ txHash: string; result: unknown }> => {
      // Reads work without a wallet; writes need the user to be present
      if (!isConnected && !walletClient) {
        throw new Error("Please connect your wallet first.");
      }

      // Per-contributor key: unique to this browser/user, never shared
      const pk      = getOrCreateContributorKey();
      const account = createAccount(pk);
      const client  = createClient({ chain: studionet, account });

      const txHash = await client.writeContract({
        account,
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
    [isConnected, walletClient],
  );

  return useMemo(
    () => ({
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
