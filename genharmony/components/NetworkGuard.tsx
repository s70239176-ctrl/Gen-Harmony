"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { wagmiConfig, genLayerStudio } from "@/lib/genlayer";
import { AlertTriangle, Zap } from "lucide-react";
import { Button } from "./ui/Button";
import { useState } from "react";

export function NetworkGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain({ config: wagmiConfig });
  const [switching, setSwitching] = useState(false);

  if (!isConnected || chainId === genLayerStudio.id) return null;

  async function handleSwitch() {
    setSwitching(true);
    try { await switchChainAsync({ chainId: genLayerStudio.id }); }
    catch { /* user rejected */ }
    finally { setSwitching(false); }
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-rise-in">
      <div className="flex items-center gap-3 rounded-md border border-vinyl/40 bg-panel px-5 py-3 shadow-glow-vinyl">
        <AlertTriangle className="h-4 w-4 text-vinyl" />
        <p className="font-mono text-[12px] text-ink">
          Wrong network — switch to <span className="text-vinyl">GenLayer Studio</span> to write
        </p>
        <Button variant="vinyl" loading={switching} onClick={handleSwitch} className="!px-3 !py-1.5">
          <Zap className="h-3 w-3" />
          Switch
        </Button>
      </div>
    </div>
  );
}
