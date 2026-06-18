import {
  CATEGORIES,
  CATEGORY_LABELS,
  type ChannelCategory,
  type M3uChannel,
} from "./schemas";

/**
 * Parses an iptv-org M3U playlist text into structured channel entries.
 *
 * Format (per iptv-org spec):
 *
 *     #EXTM3U
 *     #EXTINF:-1 tvg-id="..." tvg-logo="https://..." group-title="Sports",Channel Name (1080p)
 *     #EXTVLCOPT:http-referrer=https://example.com/
 *     https://stream.example.com/playlist.m3u8
 *
 * The line immediately after an #EXTINF is the stream URL. We also pick up
 * the optional #EXTVLCOPT directives (referrer / user-agent) — many iptv-org
 * feeds refuse requests without these headers, but the browser <video> tag
 * can't set them. We surface them so the UI can show a "proxy required" hint.
 */
export function parseM3u(text: string): M3uChannel[] {
  const lines = text.split(/\r?\n/);
  const channels: M3uChannel[] = [];
  let pending: Partial<M3uChannel> | null = null;
  let pendingVlcOpts: { referrer?: string; userAgent?: string } = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTM3U")) {
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      pending = parseExtInf(line);
      pendingVlcOpts = {};
      continue;
    }

    if (line.startsWith("#EXTVLCOPT")) {
      const opt = parseVlcOpt(line);
      if (opt) {
        pendingVlcOpts = { ...pendingVlcOpts, ...opt };
      }
      continue;
    }

    if (line.startsWith("#")) {
      // Unknown directive — ignore.
      continue;
    }

    // Stream URL — bind to the pending EXTINF.
    if (pending) {
      const referrer = pendingVlcOpts.referrer ?? pending.referrer ?? "";
      const userAgent = pendingVlcOpts.userAgent ?? pending.userAgent ?? "";
      channels.push({
        url: line,
        name: pending.name ?? "",
        logo: pending.logo ?? "",
        category: pending.category ?? "",
        country: pending.country ?? "",
        language: pending.language ?? "",
        tvgId: pending.tvgId ?? "",
        referrer,
        userAgent,
        resolution: pending.resolution ?? "",
      });
      pending = null;
      pendingVlcOpts = {};
    }
  }

  return channels;
}

function parseExtInf(line: string): Partial<M3uChannel> {
  // #EXTINF:<duration> <attrs>,<name>
  // The display name starts at the FIRST comma that's OUTSIDE any
  // quoted attribute value. Some iptv-org feeds ship http-user-agent
  // strings with unescaped commas inside the quoted value (e.g.
  // "Mozilla/5.0 ... KHTML, like Gecko ..."), so a naive
  // `line.indexOf(",")` splits inside the attribute and leaks raw
  // M3U metadata into the channel name.
  const commaIdx = findUnquotedComma(line);
  const head = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
  const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "";

  const attrs = parseAttrList(head);

  const tvgName = attrs["tvg-name"] ?? "";
  const tvgLogo = attrs["tvg-logo"] ?? "";
  const groupTitle = attrs["group-title"] ?? "";
  const tvgId = attrs["tvg-id"] ?? "";
  // http-referrer / http-user-agent can be declared on the EXTINF line
  // itself (not just in a following #EXTVLCOPT directive). Pick them up
  // here so the player has the headers it needs even when there's no
  // accompanying EXTVLCOPT line.
  const inlineReferrer = attrs["http-referrer"] ?? attrs["referrer"] ?? "";
  const inlineUserAgent = attrs["http-user-agent"] ?? attrs["user-agent"] ?? "";

  // tvg-id often encodes country and language: e.g. "AFBTVKupang.id@SD"
  // or "AngelTV.in@Indonesia". Pull out the trailing segments if present.
  const idCountry = extractAfterDot(tvgId);
  const idLang = extractAfterAt(tvgId);

  const { name: cleanName, resolution } = stripQualitySuffix(name);

  return {
    name: cleanName || tvgName || "Untitled",
    logo: tvgLogo,
    category: groupTitle,
    tvgId,
    country: idCountry,
    language: idLang,
    resolution,
    referrer: inlineReferrer,
    userAgent: inlineUserAgent,
  };
}

function findUnquotedComma(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === "," && !inQuote) return i;
  }
  return -1;
}

function parseVlcOpt(
  line: string,
): { referrer?: string; userAgent?: string } | null {
  // #EXTVLCOPT:key=value
  const eq = line.indexOf(":");
  const rest = eq >= 0 ? line.slice(eq + 1).trim() : "";
  if (!rest) return null;
  const colon = rest.indexOf("=");
  if (colon < 0) return null;
  const key = rest.slice(0, colon).trim().toLowerCase();
  const value = rest.slice(colon + 1).trim();
  if (key === "http-referrer" || key === "referrer") return { referrer: value };
  if (key === "http-user-agent" || key === "user-agent")
    return { userAgent: value };
  return null;
}

function parseAttrList(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Match key="value" pairs, allowing escaped quotes.
  const re = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

function extractAfterDot(s: string): string {
  const i = s.lastIndexOf(".");
  if (i < 0 || i === s.length - 1) return "";
  return s.slice(i + 1).split(/[@\s]/)[0] ?? "";
}

function extractAfterAt(s: string): string {
  const i = s.indexOf("@");
  if (i < 0) return "";
  const tail = s.slice(i + 1).split(/[.\s]/)[0] ?? "";
  return tail;
}

// Strips "(1080p) [Geo-blocked] [Not 24/7]" style suffixes from channel names.
// Captures the resolution (e.g. "1080p") when present.
const TRAILING_NOTE_RE = /\s*(?:\(\d{3,4}p\)|\[[^\]]*\])\s*$/i;
const RESOLUTION_RE = /\((\d{3,4}p)\b[^)]*\)/i;

function stripQualitySuffix(name: string): {
  name: string;
  resolution: string;
} {
  const trimmed = name.trim();
  const resMatch = trimmed.match(RESOLUTION_RE);
  const resolution = resMatch?.[1] ?? "";
  // Repeatedly strip trailing tokens until nothing matches. Handles
  // "(1080p) [Not 24/7]" or "[Geo-blocked] (720p)".
  let clean = trimmed;
  let changed = true;
  while (changed) {
    const before = clean;
    clean = clean.replace(TRAILING_NOTE_RE, "").trim();
    changed = clean !== before;
  }
  return { name: clean, resolution };
}

// ---------------------------------------------------------------------------
// Server-side fetcher
// ---------------------------------------------------------------------------

const IPTV_BASE = "https://iptv-org.github.io/iptv";

const SOURCE_URLS: Readonly<Record<ChannelCategory, string>> = {
  id: `${IPTV_BASE}/countries/id.m3u`,
  sports: `${IPTV_BASE}/categories/sports.m3u`,
  news: `${IPTV_BASE}/categories/news.m3u`,
  movies: `${IPTV_BASE}/categories/movies.m3u`,
  kids: `${IPTV_BASE}/categories/kids.m3u`,
};

export interface EdgeFetcher {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface FetchOptions {
  fetcher?: EdgeFetcher;
  /** Optional override for testing. */
  override?: Partial<Record<ChannelCategory, string>>;
}

export interface FetchResult {
  category: ChannelCategory;
  channels: M3uChannel[];
  fetchedAt: string;
}

export async function fetchCategory(
  category: ChannelCategory,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const fetcher = options.fetcher ?? fetch;
  const url = options.override?.[category] ?? SOURCE_URLS[category];

  const resp = await fetcher(url, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as unknown as RequestInit);
  if (!resp.ok) {
    throw new Error(
      `Failed to fetch ${category} (${resp.status} ${resp.statusText}) from ${url}`,
    );
  }
  const text = await resp.text();
  const channels = parseM3u(text);
  return { category, channels, fetchedAt: new Date().toISOString() };
}

export function getCategoryLabel(category: ChannelCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function listCategories(): readonly ChannelCategory[] {
  return CATEGORIES;
}

export { SOURCE_URLS };
