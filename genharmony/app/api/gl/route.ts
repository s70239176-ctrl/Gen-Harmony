export const runtime = "edge"; // No timeout limit on Vercel Edge functions

const GL_RPC = "https://studio.genlayer.com:8443/api";

export async function POST(req: Request) {
  const body = await req.json();

  const controller = new AbortController();
  // 3 minute timeout — long enough for LLM evaluation (30-90s) + buffer
  const t = setTimeout(() => controller.abort(), 180_000);

  try {
    const res = await fetch(GL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "proxy error";
    return new Response(JSON.stringify({ error: { message: msg } }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    clearTimeout(t);
  }
}
