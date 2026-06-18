import { z } from "zod";
import {
  type Channel,
  type Event,
  type TimStreamsData,
  DuktekChannelSchema,
  DuktekEventSchema,
  DuktekSportsArraySchema,
  DuktekHiburanArraySchema,
  DuktekEventsArraySchema,
  type DuktekChannel,
  type DuktekEvent,
} from "./schemas";

const DUKTEK_BASE =
  "https://cdn.jsdelivr.net/gh/movietrailersxxi-pixel/web@main/assets";

export interface FetchOptions {
  signal?: AbortSignal;
  /** Override the upstream base URL — useful for tests and Workers where the
   * CDN is unreachable from the edge. */
  base?: string;
  /** Optional fetcher — defaults to global fetch. Workers can pass their own
   * to attach cache hints or routing overrides. */
  fetcher?: EdgeFetcher;
}

/** Minimal fetcher shape compatible with both the runtime `fetch` and the
 * Cloudflare Workers `fetch`. Avoids Bun's augmented global type which
 * requires extra methods (preconnect etc.) not present everywhere. Named
 * `EdgeFetcher` to avoid colliding with the built-in `Fetcher` interface
 * from `@cloudflare/workers-types`. */
export type EdgeFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function slugify(name: string): string {
  return String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function channelPageUrl(idIptv: string, namaChannel: string): string {
  const slug = slugify(namaChannel);
  return `https://wc26-pd1.blogspot.com/live-tv-${idIptv}-${slug}.html`;
}

function duktekChannelToHadestv(ch: DuktekChannel, genre: 1 | 2): Channel {
  const pageUrl = channelPageUrl(ch.id_iptv, ch.nama_channel);
  return {
    url: pageUrl,
    name: ch.nama_channel,
    logo: ch.gbr_base64 || "",
    genre,
    vip: false,
    streams: [{ name: "Watch Live", url: pageUrl, vip: false }],
  };
}

function duktekEventToHadestv(ev: DuktekEvent): Event {
  const pageUrl = channelPageUrl(ev.id_iptv, ev.nama_channel);
  const name =
    ev.player_1 && ev.player_2
      ? `${ev.player_1} vs ${ev.player_2}`
      : ev.nama_event || ev.nama_channel || "Untitled event";
  const thumb = ev.thumbnail || ev.logo_1 || "";
  return {
    url: pageUrl,
    name: ev.nama_event ? `${ev.nama_event} — ${name}` : name,
    logo: thumb,
    genre: 1,
    time: ev.jadwal_event,
    isevent: true,
    vip: false,
    featured: true,
    streams: [{ name: "Watch Live", url: pageUrl, vip: false }],
  };
}

async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  fetcher: EdgeFetcher = fetch,
): Promise<T> {
  const resp = await fetcher(url);
  if (!resp.ok) {
    throw new Error(
      `Fetch failed (${resp.status} ${resp.statusText}) for ${url}`,
    );
  }
  const raw: unknown = await resp.json();
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Zod validation failed for ${url}: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export interface DuktekRaw {
  sports: DuktekChannel[];
  hiburan: DuktekChannel[];
  events: DuktekEvent[];
}

export async function fetchDuktekRaw(
  options: FetchOptions = {},
): Promise<DuktekRaw> {
  const base = options.base ?? DUKTEK_BASE;
  const fetcher = options.fetcher ?? fetch;
  const [sports, hiburan, events] = await Promise.all([
    fetchJson(`${base}/tv-sports.dat`, DuktekSportsArraySchema, fetcher),
    fetchJson(`${base}/tv-hiburan.dat`, DuktekHiburanArraySchema, fetcher),
    fetchJson(`${base}/tv-events.dat`, DuktekEventsArraySchema, fetcher),
  ]);
  return { sports, hiburan, events };
}

export async function fetchDuktekData(
  options: FetchOptions = {},
): Promise<TimStreamsData> {
  const { sports, hiburan, events } = await fetchDuktekRaw(options);
  return {
    events: events.map(duktekEventToHadestv),
    channels: [
      ...sports.map((c) => duktekChannelToHadestv(c, 1)),
      ...hiburan.map((c) => duktekChannelToHadestv(c, 2)),
    ],
    replays: [],
  };
}

export { channelPageUrl, slugify };
// Re-export schemas for callers that want to validate locally.
export {
  DuktekChannelSchema,
  DuktekEventSchema,
  type DuktekChannel,
  type DuktekEvent,
};
