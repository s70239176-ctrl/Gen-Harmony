"use client";
import dynamic from "next/dynamic";
const DebugProposal = dynamic(() => import("@/components/DebugProposal"), { ssr: false });
export default function DebugPage() {
  return <DebugProposal />;
}
