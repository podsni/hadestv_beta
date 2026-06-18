/**
 * Hono application shared between the Pages Functions entrypoint and any
 * future edge runtimes. Keep this file runtime-agnostic — no `Fetcher`
 * types from the Cloudflare SDK, no Workers-only globals.
 */
import { Hono } from "hono";
import {
  CATEGORIES,
  type ChannelCategory,
  ChannelsResponseSchema,
  type HealthResponse,
} from "./schemas";
import { fetchCategory, getCategoryLabel, listCategories } from "./m3u";
import { renderApp } from "./ssr";

export interface AppEnv {
  /** Cloudflare Workers Static Assets binding — Pages injects this
   * automatically when [assets] is set in wrangler.toml. */
  STATIC?: { fetch: (request: Request) => Promise<Response> };
}

export const app = new Hono<{ Bindings: AppEnv }>();

/** Edge-aware fetcher with cache hints. The `cf` property isn't on the
 * standard RequestInit type, hence the cast through `unknown`. */
const edgeFetcher: (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> = (input, init) => {
  return fetch(input, {
    ...init,
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as unknown as RequestInit);
};

function isCategory(value: string | undefined): value is ChannelCategory {
  return (
    typeof value === "string" &&
    (CATEGORIES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    upstream: listCategories().map(
      (cat) => `https://iptv-org.github.io/iptv/${endpointFor(cat)}`,
    ),
    fetchedAt: new Date().toISOString(),
    counts: {},
  } satisfies HealthResponse),
);

app.get("/api/channels", async (c) => {
  const requested = c.req.query("category");
  const category: ChannelCategory = isCategory(requested) ? requested : "id";

  try {
    const result = await fetchCategory(category, { fetcher: edgeFetcher });
    const payload = ChannelsResponseSchema.parse({
      category: getCategoryLabel(result.category),
      fetchedAt: result.fetchedAt,
      count: result.channels.length,
      channels: result.channels,
    });
    return c.json(payload, 200, {
      "cache-control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      "x-hadestv-render": "api",
      "x-hadestv-category": result.category,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 502);
  }
});

app.get("/api/stats", async (c) => {
  const counts: Record<string, number> = {};
  let ok = true;
  await Promise.all(
    listCategories().map(async (cat) => {
      try {
        const r = await fetchCategory(cat, { fetcher: edgeFetcher });
        counts[cat] = r.channels.length;
      } catch {
        counts[cat] = 0;
        ok = false;
      }
    }),
  );
  return c.json({
    ok,
    upstream: listCategories().map(
      (cat) => `https://iptv-org.github.io/iptv/${endpointFor(cat)}`,
    ),
    fetchedAt: new Date().toISOString(),
    counts,
  });
});

function endpointFor(cat: ChannelCategory): string {
  switch (cat) {
    case "id":
      return "countries/id.m3u";
    case "sports":
      return "categories/sports.m3u";
    case "news":
      return "categories/news.m3u";
    case "movies":
      return "categories/movies.m3u";
    case "kids":
      return "categories/kids.m3u";
  }
}

// ---------------------------------------------------------------------------
// SSR home page — Pages will only call this function for non-static paths
// (i.e. anything not in dist/), so SSR wins for `/` and APIs win for
// `/api/*`. Static client.js + style.css + any other dist/ files are
// served directly by Pages with the right Content-Type.
// ---------------------------------------------------------------------------

app.get("/", async (c) => {
  const category: ChannelCategory = "id";
  let channels: import("./schemas").M3uChannel[] = [];
  let upstreamError: string | null = null;

  try {
    const result = await fetchCategory(category, { fetcher: edgeFetcher });
    channels = result.channels;
  } catch (err) {
    upstreamError = err instanceof Error ? err.message : String(err);
  }

  const html = renderApp({
    initialChannels: channels,
    initialCategory: category,
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
