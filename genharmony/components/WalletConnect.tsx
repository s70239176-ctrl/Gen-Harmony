"use client";

import { useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { Power, Wallet, Loader2 } from "lucide-react";
import { Button } from "./ui/Button";
import { getContributorAddress } from "@/lib/genlayer";
import { useEffect, useState } from "react";

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnect() {
  const { address, isConnected, isReconnecting } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const [glAddress, setGlAddress] = useState("");

  useEffect(() => {
    setGlAddress(getContributorAddress());
  }, []);

  if (isReconnecting) {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-line bg-rail/60 px-3 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
        <span className="font-mono text-[11px] text-muted">Reconnecting…</span>
      </div>
    );
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3 rounded-sm border border-line bg-rail/60 px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-current shadow-glow-current animate-flicker" />
        <div className="leading-tight">
          <p className="led text-[12px] text-ink">{truncate(address)}</p>
          {balance && (
            <p className="led text-[10px] text-muted">
              {Number(balance.formatted).toFixed(3)} {balance.symbol}
            </p>
          )}
          {glAddress && (
            <p className="led text-[10px] text-pulse" title="Your unique GenLayer contributor address">
              GL {truncate(glAddress)}
            </p>
          )}
        </div>
        <button
          onClick={() => disconnect()}
          aria-label="Disconnect wallet"
          className="ml-1 rounded-sm border border-line p-1.5 text-muted transition-colors hover:border-pulse/50 hover:text-pulse"
        >
          <Power className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <Button
      variant="primary"
      loading={isPending}
      onClick={() => connect({ connector: connectors[0] })}
      className="gap-2"
    >
      <Wallet className="h-3.5 w-3.5" />
      Connect wallet
    </Button>
  );
}
