"use client";

import { defineChain } from "viem";
import { createConfig, http, useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { useCallback, useMemo } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Track, Proposal, MintedElement } from "./types";

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

function coerce<T>(v: unknown): T {
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as unknown as T;
}

export function useHarmonyForge() {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient({ config: wagmiConfig });
  const { switchChainAsync } = useSwitchChain({ config: wagmiConfig });

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
      if (!isConnected || !address) {
        throw new Error("No wallet connected — please connect first.");
      }

      // If on the wrong chain, prompt a switch then ask the user to retry.
      // wagmi's walletClient won't update until the next render cycle after
      // switchChainAsync resolves, so we can't use it immediately — asking
      // the user to click again is the cleanest UX.
      if (chainId !== genLayerStudio.id) {
        await switchChainAsync({ chainId: genLayerStudio.id }).catch(() => {
          throw new Error(
            `Switch to GenLayer Studio (chain ${genLayerStudio.id}) in your wallet, then try again.`
          );
        });
        throw new Error("Switched to GenLayer Studio — please click again to continue.");
      }

      if (!walletClient?.account) {
        throw new Error("Wallet not ready — please wait a moment and try again.");
      }

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
    [address, isConnected, chainId, walletClient, switchChainAsync],
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
