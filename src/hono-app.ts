/**
 * Hono application shared between the Pages Functions entrypoint and any
 * future edge runtimes. Keep this file runtime-agnostic — no `Fetcher`
 * types from the Cloudflare SDK, no Workers-only globals.
 */
import { Hono } from "hono";
import { fetchDuktekData, fetchDuktekRaw, type EdgeFetcher } from "./api";
import { renderApp } from "./ssr";
import type { TimStreamsData } from "./schemas";

export interface AppEnv {
  /** Cloudflare Workers Static Assets binding — Pages injects this
   * automatically when [assets] is set in wrangler.toml. */
  STATIC?: { fetch: (request: Request) => Promise<Response> };
  /** Override the Duktek CDN URL. */
  DUKTEK_BASE?: string;
}

export const app = new Hono<{ Bindings: AppEnv }>();

/** Edge-aware fetcher with cache hints. The `cf` property isn't on the
 * standard RequestInit type, hence the cast through `unknown`. */
const edgeFetcher: EdgeFetcher = (input, init) => {
  return fetch(input, {
    ...init,
    cf: { cacheTtl: 300, cacheEverything: true },
  } as unknown as RequestInit);
};

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.get("/api/health", (c) =>
  c.json({ ok: true, ts: new Date().toISOString() }),
);

app.get("/api/channels", async (c) => {
  try {
    const data = await fetchDuktekData({
      base: c.env.DUKTEK_BASE,
      fetcher: edgeFetcher,
    });
    return c.json(data satisfies TimStreamsData);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 502);
  }
});

app.get("/api/stats", async (c) => {
  try {
    const raw = await fetchDuktekRaw({
      base: c.env.DUKTEK_BASE,
      fetcher: edgeFetcher,
    });
    return c.json({
      ok: true,
      counts: {
        sports: raw.sports.length,
        hiburan: raw.hiburan.length,
        events: raw.events.length,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 502);
  }
});

// ---------------------------------------------------------------------------
// SSR home page — Pages will only call this function for non-static paths
// (i.e. anything not in dist/), so SSR wins for `/` and APIs win for
// `/api/*`. Static client.js + style.css + any other dist/ files are
// served directly by Pages with the right Content-Type.
// ---------------------------------------------------------------------------

app.get("/", async (c) => {
  let data: TimStreamsData = { events: [], channels: [], replays: [] };
  let upstreamError: string | null = null;
  try {
    data = await fetchDuktekData({
      base: c.env.DUKTEK_BASE,
      fetcher: edgeFetcher,
    });
  } catch (err) {
    upstreamError = err instanceof Error ? err.message : String(err);
  }

  const html = renderApp({
    initialData: data,
    upstreamError,
    requestUrl: c.req.url,
  });
  return c.html(html, 200, {
    "cache-control":
      "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    "x-hadestv-render": "ssr",
  });
});

// 404 for anything else so Pages Static Assets can handle it.
app.notFound((c) => c.notFound());
