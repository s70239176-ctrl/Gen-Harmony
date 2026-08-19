import { NextRequest, NextResponse } from "next/server";

const GL_RPC = "https://studio.genlayer.com:8443/api";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(GL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, no-cache" },
  });
}
