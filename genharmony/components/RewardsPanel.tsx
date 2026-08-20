"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { Coins, Gem, Sparkle } from "lucide-react";
import { useHarmonyForge, getContributorAddress } from "@/lib/genlayer";
import { Button } from "./ui/Button";

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-md border border-line bg-panel p-6">
      <Icon className="h-4 w-4" style={{ color: accent }} />
      <p className="mt-4 led text-2xl text-ink">{value}</p>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{label}</p>
    </div>
  );
}

export function RewardsPanel() {
  const { address, isConnected } = useAccount();
  const { getPendingRewards, getTreasuryBalance, getContributionCount, claimRewards } = useHarmonyForge();

  const [pending, setPending] = useState<bigint>(0n);
  const [treasury, setTreasury] = useState<bigint>(0n);
  const [contributions, setContributions] = useState<bigint>(0n);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!address) return;
    // Rewards are credited on-chain to the GenLayer contributor address
    // (the localStorage-generated signing key), NOT the connected wagmi/
    // MetaMask address — those are two different addresses. Query with
    // the contributor address or this will always show 0.
    const contributorAddress = getContributorAddress();
    if (!contributorAddress) return;
    const [p, t, c] = await Promise.all([
      getPendingRewards(contributorAddress),
      getTreasuryBalance(),
      getContributionCount(contributorAddress),
    ]);
    setPending(BigInt(p));
    setTreasury(BigInt(t));
    setContributions(BigInt(c));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function handleClaim() {
    setError(null);
    setClaiming(true);
    try {
      await claimRewards();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : (typeof err === "object" ? JSON.stringify(err) : String(err)));
    } finally {
      setClaiming(false);
    }
  }

  if (!isConnected) {
    return <p className="font-body text-sm text-muted">Connect a wallet to see what you&apos;ve earned.</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-vinyl">Royalty desk</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-ink">Your rewards</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard icon={Coins} label="Pending GEN" value={Number(formatEther(pending)).toFixed(4)} accent="#FFB627" />
        <StatCard icon={Gem} label="Approved evolutions" value={contributions.toString()} accent="#00E5FF" />
        <StatCard
          icon={Sparkle}
          label="Treasury balance"
          value={Number(formatEther(treasury)).toFixed(2)}
          accent="#FF2E97"
        />
      </div>

      <div className="rounded-md border border-line bg-panel/70 p-6">
        <p className="font-body text-sm text-muted">
          Every approved evolution earns a share of the treasury, scaled by how the jury scored it. Claim
          whenever you like — nothing expires.
        </p>
        {error && <p className="mt-3 font-mono text-[12px] text-pulse">{error}</p>}
        <Button
          variant="vinyl"
          loading={claiming}
          disabled={pending === 0n}
          onClick={handleClaim}
          className="mt-5 gap-2"
        >
          <Coins className="h-3.5 w-3.5" />
          Claim {Number(formatEther(pending)).toFixed(4)} GEN
        </Button>
      </div>
    </div>
  );
}

