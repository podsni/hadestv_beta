import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CATEGORIES,
  CATEGORY_BLURBS,
  CATEGORY_LABELS,
  type ChannelCategory,
  type M3uChannel,
} from "./schemas";

interface AppProps {
  initialChannels?: M3uChannel[];
  initialCategory?: ChannelCategory;
  upstreamError?: string | null;
  isServer?: boolean;
}

const PLAY_ICON = (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <circle
      cx="24"
      cy="24"
      r="22"
      fill="rgba(0,0,0,0.55)"
      stroke="rgba(255,255,255,0.85)"
      strokeWidth="1.5"
    />
    <path d="M19 16 L33 24 L19 32 Z" />
  </svg>
);

const RECENT_KEY = "hadestv:recent";
const RECENT_MAX = 8;
const ACTIVE_MAX = 6;
const PAGE_SIZE = 24;
const PAGE_VISIBLE = 5; // number of page numbers to show in pagination
const SEARCH_DEBOUNCE_MS = 200;

type RecentEntry = {
  url: string;
  name: string;
  logo: string;
  ts: number;
};

function loadRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentEntry =>
          typeof x === "object" &&
          x !== null &&
          typeof (x as RecentEntry).url === "string" &&
          typeof (x as RecentEntry).name === "string" &&
          typeof (x as RecentEntry).ts === "number",
      )
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function pushRecent(entry: RecentEntry): RecentEntry[] {
  if (typeof window === "undefined") return [];
  const current = loadRecent().filter((e) => e.url !== entry.url);
  const next = [entry, ...current].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* quota exceeded — ignore */
  }
  return next;
}

// ---------------------------------------------------------------------------
// Global HLS.js loader — only loads once
// ---------------------------------------------------------------------------

interface HlsLike {
  isSupported(): boolean;
  new (): HlsInstance;
  Events: {
    MANIFEST_PARSED: string;
    ERROR: string;
  };
}
interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(element: HTMLMediaElement): void;
  on(
    event: string,
    cb: (
      eventName: string,
      data: { fatal?: boolean; type?: string; details?: string },
    ) => void,
  ): void;
  destroy(): void;
}
type HlsGlobal = HlsLike | undefined;

declare global {
  interface Window {
    Hls?: HlsLike;
  }
}

let hlsLoaderPromise: Promise<HlsGlobal> | null = null;
function loadHls(): Promise<HlsGlobal> {
  if (typeof window === "undefined") return Promise.resolve(undefined);
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLoaderPromise) return hlsLoaderPromise;
  hlsLoaderPromise = new Promise<HlsGlobal>((resolve) => {
    const tryResolve = () => {
      // Defer to next tick so the defer-loaded script can finish attaching
      // window.Hls.
      setTimeout(() => resolve(window.Hls), 0);
    };
    // If the script tag is already in the DOM (we render it in ssr.tsx),
    // just wait for it to attach.
    if (document.querySelector('script[src*="hls.js"]')) {
      // Give the script up to 5s to attach.
      let waited = 0;
      const iv = setInterval(() => {
        waited += 100;
        if (window.Hls || waited > 5000) {
          clearInterval(iv);
          resolve(window.Hls);
        }
      }, 100);
      void tryResolve;
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
    s.async = true;
    s.onload = () => resolve(window.Hls);
    s.onerror = () => resolve(undefined);
    document.head.appendChild(s);
  });
  return hlsLoaderPromise;
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}
function nativeCanPlayHls(): boolean {
  if (typeof document === "undefined") return false;
  const v = document.createElement("video");
  return v.canPlayType("application/vnd.apple.mpegurl") !== "";
}

// ---------------------------------------------------------------------------
// StreamPlayer — one <video> element wired to either native HLS or hls.js
// ---------------------------------------------------------------------------

interface StreamPlayerProps {
  channel: M3uChannel;
  onClose: () => void;
  onError: (url: string, error: string) => void;
}

const StreamPlayer = React.memo(
  ({ channel, onClose, onError }: StreamPlayerProps) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsInstanceRef = useRef<HlsInstance | null>(null);
    const [state, setState] = useState<
      "loading" | "playing" | "error" | "paused"
    >("loading");
    const [muted, setMuted] = useState(true);
    const reportedErrorRef = useRef(false);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      reportedErrorRef.current = false;
      let cancelled = false;

      const wireNative = () => {
        video.src = channel.url;
        video.play().catch(() => {
          // Autoplay blocked — user can press play.
        });
      };

      const wireHlsJs = (Hls: HlsLike) => {
        const hls = new Hls();
        hlsInstanceRef.current = hls;
        hls.loadSource(channel.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {
            /* user-gesture required */
          });
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) {
            setState("error");
            if (!reportedErrorRef.current) {
              reportedErrorRef.current = true;
              onError(
                channel.url,
                `${data.type ?? "fatal"}: ${data.details ?? "stream failed"}`,
              );
            }
            try {
              hls.destroy();
            } catch {
              /* ignore */
            }
            hlsInstanceRef.current = null;
          }
        });
      };

      const start = async () => {
        if (cancelled) return;
        if (!isHlsUrl(channel.url)) {
          wireNative();
          return;
        }
        if (nativeCanPlayHls()) {
          wireNative();
          return;
        }
        const Hls = await loadHls();
        if (cancelled) return;
        if (Hls && Hls.isSupported()) {
          wireHlsJs(Hls);
        } else {
          // Fallback — try setting src directly.
          wireNative();
        }
      };

      void start();

      return () => {
        cancelled = true;
        if (hlsInstanceRef.current) {
          try {
            hlsInstanceRef.current.destroy();
          } catch {
            /* ignore */
          }
          hlsInstanceRef.current = null;
        }
        if (video) {
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
      };
    }, [channel.url, onError]);

    return (
      <article className="player-card" data-state={state}>
        <header className="player-card-head">
          <div className="player-card-id">
            {channel.logo ? (
              <img
                src={channel.logo}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <span className="player-card-bullet" aria-hidden="true" />
            )}
            <div>
              <h3 className="player-card-title">{channel.name}</h3>
              <p className="player-card-meta">
                <span className="player-card-cat">
                  {channel.category || "Live"}
                </span>
                {channel.resolution && (
                  <span className="player-card-res">{channel.resolution}</span>
                )}
              </p>
            </div>
          </div>
          <div className="player-card-actions">
            <button
              type="button"
              className="player-card-iconbtn"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? (
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    d="M5 9v6h4l5 4V5L9 9H5z M17 9l4 6 M21 9l-4 6"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    d="M5 9v6h4l5 4V5L9 9H5z M16 8a5 5 0 010 8 M19 5a9 9 0 010 14"
                  />
                </svg>
              )}
            </button>
            <a
              href={channel.url}
              target="_blank"
              rel="noreferrer"
              className="player-card-iconbtn"
              aria-label="Open source URL"
              title="Open source URL"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  d="M14 4h6v6 M20 4l-8 8 M19 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h6"
                />
              </svg>
            </a>
            <button
              type="button"
              className="player-card-iconbtn"
              onClick={onClose}
              aria-label="Close this stream"
              title="Close (Esc)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  d="M6 6l12 12 M18 6L6 18"
                />
              </svg>
            </button>
          </div>
        </header>

        <div className="player-card-frame">
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted={muted}
            controls
            preload="metadata"
            onPlaying={() => setState("playing")}
            onPause={() => setState("paused")}
            onError={() => {
              setState("error");
              if (!reportedErrorRef.current) {
                reportedErrorRef.current = true;
                onError(channel.url, "video element error");
              }
            }}
            aria-label={`Stream: ${channel.name}`}
          />
          {state === "loading" && (
            <div className="player-card-loading" aria-hidden="true">
              <div className="spinner" />
              <span>Tuning the broadcast</span>
            </div>
          )}
          {state === "error" && (
            <div className="player-card-error" role="alert">
              <p className="state-mark">
                Signal <em>lost</em>
              </p>
              <p>Stream tidak dapat dimuat. Coba sumber lain.</p>
            </div>
          )}
        </div>
      </article>
    );
  },
);
StreamPlayer.displayName = "StreamPlayer";

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const App = ({
  initialChannels,
  initialCategory,
  upstreamError,
  isServer,
}: AppProps) => {
  const initialFromWindow =
    !isServer && typeof window !== "undefined"
      ? ((
          window as unknown as {
            __HADESTV__?: M3uChannel[];
          }
        ).__HADESTV__ ?? undefined)
      : undefined;

  // State. SSR ships the first page slice in `initialChannels`; the full
  // server-side list lives on `window.__HADESTV__` for the client to
  // promote after hydration. This keeps the SSR HTML small (fast first
  // paint on mobile) while still giving the client a complete dataset
  // for search + pagination.
  const [category, setCategory] = useState<ChannelCategory>(
    initialCategory ?? "id",
  );
  const [channels, setChannels] = useState<M3uChannel[]>(
    initialChannels ?? initialFromWindow ?? [],
  );
  const [active, setActive] = useState<M3uChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(upstreamError ?? null);
  const [userIp, setUserIp] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(""); // raw input
  const [search, setSearch] = useState(""); // debounced
  const [page, setPage] = useState(1);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [streamErrors, setStreamErrors] = useState<Record<string, string>>({});

  // Load IP + recent on mount. Promote the SSR-shipped first page to
  // the full server-side list (if available) so search/pagination work.
  useEffect(() => {
    if (isServer) return;
    setRecent(loadRecent());
    if (
      initialFromWindow &&
      initialChannels &&
      initialFromWindow.length > initialChannels.length
    ) {
      setChannels(initialFromWindow);
    }
    fetch("https://api.ipify.org?format=json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const ip =
          j &&
          typeof j === "object" &&
          "ip" in j &&
          typeof (j as { ip: unknown }).ip === "string"
            ? (j as { ip: string }).ip
            : null;
        if (ip) setUserIp(ip);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServer]);

  // ---- derived state ---------------------------------------------------

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        c.resolution.toLowerCase().includes(q),
    );
  }, [channels, search]);

  const featuredChannels = useMemo(
    () => filteredChannels.filter((c) => c.logo).slice(0, 12),
    [filteredChannels],
  );

  const remainingChannels = useMemo(
    () =>
      filteredChannels.filter(
        (c) => !featuredChannels.find((f) => f.url === c.url),
      ),
    [filteredChannels, featuredChannels],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(remainingChannels.length / PAGE_SIZE),
  );
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagedChannels = useMemo(
    () => remainingChannels.slice(pageStart, pageStart + PAGE_SIZE),
    [remainingChannels, pageStart],
  );

  // ---- actions ---------------------------------------------------------

  const fetchCategory = useCallback(async (cat: ChannelCategory) => {
    setLoading(true);
    setError(null);
    setPage(1); // reset to first page on category change
    try {
      const resp = await fetch(`/api/channels?category=${cat}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as {
        channels: M3uChannel[];
      };
      setChannels(json.channels ?? []);
      setCategory(cat);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search input → applied `search`. Avoids re-filtering the
  // whole list on every keystroke (which jankifies typing on mobile).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1); // reset page on new search
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  // Hash sync — shareable deep links to a specific page.
  useEffect(() => {
    if (isServer || typeof window === "undefined") return;
    const m = window.location.hash.match(/page=(\d+)/);
    if (m && m[1]) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) setPage(n);
    }
  }, [isServer]);

  useEffect(() => {
    if (isServer || typeof window === "undefined") return;
    if (page > 1) {
      // Keep URL hash in sync for shareable / refresh-safe pagination.
      const next = `#page=${page}`;
      if (window.location.hash !== next) {
        history.replaceState(null, "", next);
      }
    } else if (window.location.hash.startsWith("#page=")) {
      history.replaceState(null, "", window.location.pathname);
    }
  }, [isServer, page]);

  const scrollToSection = useCallback((id: string) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    if (isServer) return;
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (ev.key === "Escape") {
          (ev.target as HTMLInputElement).blur();
        }
        return;
      }
      if (ev.key === "Escape" && active.length > 0) {
        ev.preventDefault();
        closeAll();
      } else if (ev.key === "/" && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        const input = document.getElementById("search-input");
        if (input instanceof HTMLInputElement) input.focus();
      } else if (ev.key === "c" && active.length > 0 && !ev.metaKey) {
        ev.preventDefault();
        closeOne(active[0]?.url ?? "");
      } else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
        if (pageCount > 1 && page > 1) {
          ev.preventDefault();
          setPage((p) => Math.max(1, p - 1));
          scrollToSection("all");
        }
      } else if (ev.key === "ArrowRight" || ev.key === "PageDown") {
        if (pageCount > 1 && page < pageCount) {
          ev.preventDefault();
          setPage((p) => Math.min(pageCount, p + 1));
          scrollToSection("all");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServer, active, page, pageCount, scrollToSection]);

  const playStream = useCallback((ch: M3uChannel) => {
    setActive((prev) => {
      const without = prev.filter((p) => p.url !== ch.url);
      return [ch, ...without].slice(0, ACTIVE_MAX);
    });
    setRecent(
      pushRecent({
        url: ch.url,
        name: ch.name,
        logo: ch.logo,
        ts: Date.now(),
      }),
    );
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const closeOne = useCallback((url: string) => {
    setActive((prev) => prev.filter((p) => p.url !== url));
  }, []);

  const closeAll = useCallback(() => {
    setActive([]);
  }, []);

  const onStreamError = useCallback((url: string, message: string) => {
    setStreamErrors((prev) => ({ ...prev, [url]: message }));
  }, []);

  if (error && channels.length === 0 && !isServer) {
    return (
      <div className="state-full">
        <div>
          <p className="state-mark">
            Signal <em>lost</em>
          </p>
          <p>{error}</p>
          <p style={{ marginTop: "24px" }}>
            <button
              type="button"
              className="btn"
              onClick={() => fetchCategory(category)}
            >
              Try again
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Masthead
        userIp={userIp}
        onRefresh={() => fetchCategory(category)}
        loading={loading}
      />

      <main className="container">
        {active.length > 0 && (
          <PlayerGrid
            active={active}
            onCloseOne={closeOne}
            onCloseAll={closeAll}
            onError={onStreamError}
            errors={streamErrors}
          />
        )}

        {error && (
          <p className="error-banner" role="status">
            <em>Heads up:</em> {error}. Showing the last cached dispatch.
            <button
              type="button"
              className="btn btn-link"
              onClick={() => fetchCategory(category)}
            >
              Retry
            </button>
          </p>
        )}

        <SearchBar
          value={searchInput}
          onChange={setSearchInput}
          applied={search}
          resultCount={filteredChannels.length}
          category={category}
          onCategoryChange={fetchCategory}
          loading={loading}
        />

        {recent.length > 0 && (
          <RecentRow
            entries={recent.slice(0, 4)}
            onPlay={(entry) => {
              // Reconstruct a minimal M3uChannel from the recent entry.
              playStream({
                url: entry.url,
                name: entry.name,
                logo: entry.logo,
                category: "",
                country: "",
                language: "",
                tvgId: "",
                referrer: "",
                userAgent: "",
                resolution: "",
              });
            }}
          />
        )}

        <FeaturedChannels channels={featuredChannels} onPlay={playStream} />

        <ChannelsList
          channels={pagedChannels}
          totalCount={remainingChannels.length}
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
          onPlay={playStream}
          searchInput={searchInput}
          loading={loading}
        />
      </main>

      <Footer />
    </>
  );
};

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface MastheadProps {
  userIp: string | null;
  onRefresh: () => void;
  loading: boolean;
}

const Masthead = ({ userIp, onRefresh, loading }: MastheadProps) => (
  <>
    <header className="masthead">
      <div className="masthead-inner">
        <div className="masthead-meta left">
          <span className="live-dot" />
          Est. 2024 · Vol. 01
        </div>
        <h1 className="wordmark">
          Hades<span className="ampersand">/</span>TV
        </h1>
        <div className="masthead-meta right">
          <button
            type="button"
            className="refresh-btn"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh channel listings"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="masthead-rule" />
      <p className="tagline">
        Streaming <em>dari kedalaman</em> — saluran langsung, banyak pemain,
        tanpa repot.
      </p>
    </header>

    <nav className="masthead-nav" aria-label="Section navigation">
      <div className="masthead-nav-inner">
        <nav>
          <a href="#now-playing">Sedang Tayang</a>
          <a href="#featured">Sorotan</a>
          <a href="#all">Semua Saluran</a>
          <a href="#recent">Baru Dilihat</a>
        </nav>
        {userIp && <span className="ip-pill">IP · {userIp}</span>}
      </div>
    </nav>
  </>
);

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  applied: string;
  resultCount: number;
  category: ChannelCategory;
  onCategoryChange: (cat: ChannelCategory) => void;
  loading: boolean;
}

const SearchBar = ({
  value,
  onChange,
  applied,
  resultCount,
  category,
  onCategoryChange,
  loading,
}: SearchBarProps) => {
  // Show "applied" indicator when the user has typed but the debounced
  // search hasn't caught up yet (prevents confusion on slow devices).
  const searching = value.trim() !== applied.trim();
  return (
    <div className="search-bar">
      <div className="search-input-wrap">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="search-icon"
          width="16"
          height="16"
        >
          <circle
            cx="11"
            cy="11"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M16 16 L21 21"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <input
          id="search-input"
          type="search"
          className="search-input"
          placeholder="Cari saluran, kategori, negara…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label="Cari saluran"
        />
        {value && (
          <button
            type="button"
            className="search-clear"
            onClick={() => onChange("")}
            aria-label="Bersihkan pencarian"
            title="Bersihkan (Esc)"
          >
            ×
          </button>
        )}
        {!value && (
          <kbd className="search-kbd" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
      <div className="filter-chips" role="tablist" aria-label="Kategori">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={category === cat}
            className={`chip ${category === cat ? "chip-active" : ""}`}
            onClick={() => onCategoryChange(cat)}
            disabled={loading && category !== cat}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>
      {value && (
        <p className="search-results-count" aria-live="polite" role="status">
          {searching ? (
            <span className="search-results-loading">
              <span className="dot-pulse" /> Mencari…
            </span>
          ) : (
            <>
              <strong>{resultCount}</strong> hasil untuk <em>“{applied}”</em>
            </>
          )}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// PlayerGrid — multi-play layout
// ---------------------------------------------------------------------------

interface PlayerGridProps {
  active: M3uChannel[];
  onCloseOne: (url: string) => void;
  onCloseAll: () => void;
  onError: (url: string, message: string) => void;
  errors: Record<string, string>;
}

const PlayerGrid = ({
  active,
  onCloseOne,
  onCloseAll,
  onError,
  errors,
}: PlayerGridProps) => {
  const cols = active.length === 1 ? 1 : active.length === 2 ? 2 : 3;
  return (
    <section id="now-playing" className="player-grid-section">
      <header className="player-grid-head">
        <div>
          <span className="section-kicker">
            Sedang Tayang · {active.length} stream
          </span>
          <h2 className="section-title">
            Multi-<em>play</em>
          </h2>
          <p className="section-blurb">
            Buka beberapa saluran sekaligus. Klik kartu untuk menambahkan, ikon
            × untuk menutup, <kbd>Esc</kbd> untuk menutup semua.
          </p>
        </div>
        <div className="player-grid-actions">
          <span className="player-grid-cols" aria-label="Kolom grid">
            {cols}×{Math.ceil(active.length / cols)}
          </span>
          <button type="button" className="btn btn-link" onClick={onCloseAll}>
            Tutup semua
          </button>
        </div>
      </header>

      <div
        className={`player-grid cols-${Math.min(active.length, 4)}`}
        role="region"
        aria-label={`${active.length} stream sedang diputar`}
      >
        {active.map((ch) => (
          <StreamPlayer
            key={ch.url}
            channel={ch}
            onClose={() => onCloseOne(ch.url)}
            onError={onError}
          />
        ))}
      </div>

      {Object.keys(errors).length > 0 && (
        <p className="player-grid-error">
          {Object.keys(errors).length} stream bermasalah — tutup dan coba
          saluran lain.
        </p>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// FeaturedChannels — logo grid at top of section
// ---------------------------------------------------------------------------

const FeaturedChannels = ({
  channels,
  onPlay,
}: {
  channels: M3uChannel[];
  onPlay: (ch: M3uChannel) => void;
}) => {
  if (channels.length === 0) return null;
  return (
    <section id="featured" className="featured">
      <header className="section-head">
        <div>
          <span className="section-kicker">Sorotan · Featured</span>
          <h2 className="section-title">
            Pick of the <em>day</em>
          </h2>
          <p className="section-blurb">{CATEGORY_BLURBS["id"]}</p>
        </div>
        <div className="section-count">{channels.length} saluran</div>
      </header>
      <div className="featured-grid">
        {channels.map((ch) => (
          <button
            key={ch.url}
            type="button"
            className="featured-card"
            onClick={() => onPlay(ch)}
          >
            <span className="featured-thumb">
              {ch.logo && (
                <img
                  src={ch.logo}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span className="featured-play">{PLAY_ICON}</span>
            </span>
            <span className="featured-name">{ch.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// ChannelsList — compact list with pagination
// ---------------------------------------------------------------------------

interface ChannelsListProps {
  channels: M3uChannel[];
  totalCount: number;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  onPlay: (ch: M3uChannel) => void;
  searchInput: string;
  loading: boolean;
}

const ChannelsList = ({
  channels,
  totalCount,
  page,
  pageCount,
  onPageChange,
  onPlay,
  searchInput,
  loading,
}: ChannelsListProps) => {
  if (totalCount === 0) {
    const isSearching = searchInput.trim().length > 0;
    return (
      <section id="all" className="section">
        <header className="section-head">
          <div>
            <span className="section-kicker">Semua saluran</span>
            <h2 className="section-title">
              Nothing on the <em>wire</em>
            </h2>
            <p className="section-blurb">
              {isSearching
                ? `Tidak ada saluran yang cocok dengan "${searchInput.trim()}".`
                : "Coba kategori lain atau segarkan daftar."}
            </p>
          </div>
        </header>
      </section>
    );
  }

  // Page-number window — show PAGE_VISIBLE pages around current.
  const halfWindow = Math.floor(PAGE_VISIBLE / 2);
  let windowStart = Math.max(1, page - halfWindow);
  const windowEnd = Math.min(pageCount, windowStart + PAGE_VISIBLE - 1);
  if (windowEnd - windowStart < PAGE_VISIBLE - 1) {
    windowStart = Math.max(1, windowEnd - PAGE_VISIBLE + 1);
  }
  const pageNumbers: number[] = [];
  for (let p = windowStart; p <= windowEnd; p++) pageNumbers.push(p);

  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = rangeStart + channels.length - 1;

  return (
    <section id="all" className="section">
      <header className="section-head">
        <div>
          <span className="section-kicker">Semua saluran</span>
          <h2 className="section-title">
            The full <em>roster</em>
          </h2>
          <p className="section-blurb">
            Klik untuk menambahkan ke multi-play. Maksimal enam stream aktif.
          </p>
        </div>
        <div className="section-count">
          {rangeStart}–{rangeEnd} / {totalCount} saluran
        </div>
      </header>

      <ul className="channel-list" aria-busy={loading}>
        {channels.map((ch) => (
          <li key={ch.url}>
            <button
              type="button"
              className="channel-row"
              onClick={() => onPlay(ch)}
            >
              <span className="channel-row-logo">
                {ch.logo ? (
                  <img
                    src={ch.logo}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span aria-hidden>·</span>
                )}
              </span>
              <span className="channel-row-name">{ch.name}</span>
              <span className="channel-row-cat">{ch.category || "—"}</span>
              {ch.resolution && (
                <span className="channel-row-res">{ch.resolution}</span>
              )}
              <span className="channel-row-play" aria-hidden>
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path d="M5 4l6 4-6 4z" fill="currentColor" />
                </svg>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {pageCount > 1 && (
        <nav className="pagination" aria-label="Halaman saluran">
          <button
            type="button"
            className="pagination-btn pagination-arrow"
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Halaman sebelumnya"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                d="M15 6l-6 6 6 6"
              />
            </svg>
            <span>Sebelumnya</span>
          </button>

          <ol className="pagination-pages" role="list">
            {windowStart > 1 && (
              <>
                <PaginationBtn
                  page={1}
                  active={page === 1}
                  onClick={() => onPageChange(1)}
                />
                {windowStart > 2 && (
                  <li className="pagination-ellipsis" aria-hidden>
                    …
                  </li>
                )}
              </>
            )}
            {pageNumbers.map((p) => (
              <PaginationBtn
                key={p}
                page={p}
                active={p === page}
                onClick={() => onPageChange(p)}
              />
            ))}
            {windowEnd < pageCount && (
              <>
                {windowEnd < pageCount - 1 && (
                  <li className="pagination-ellipsis" aria-hidden>
                    …
                  </li>
                )}
                <PaginationBtn
                  page={pageCount}
                  active={page === pageCount}
                  onClick={() => onPageChange(pageCount)}
                />
              </>
            )}
          </ol>

          <button
            type="button"
            className="pagination-btn pagination-arrow"
            disabled={page === pageCount}
            onClick={() => onPageChange(page + 1)}
            aria-label="Halaman berikutnya"
          >
            <span>Selanjutnya</span>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                d="M9 6l6 6-6 6"
              />
            </svg>
          </button>
        </nav>
      )}
    </section>
  );
};

const PaginationBtn = ({
  page,
  active,
  onClick,
}: {
  page: number;
  active: boolean;
  onClick: () => void;
}) => (
  <li>
    <button
      type="button"
      className={`pagination-btn pagination-num ${active ? "pagination-active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={`Halaman ${page}`}
    >
      {page}
    </button>
  </li>
);

// ---------------------------------------------------------------------------
// Recent row
// ---------------------------------------------------------------------------

const RecentRow = ({
  entries,
  onPlay,
}: {
  entries: RecentEntry[];
  onPlay: (entry: RecentEntry) => void;
}) => (
  <section id="recent" className="section">
    <header className="section-head">
      <div>
        <span className="section-kicker">Baru dilihat</span>
        <h2 className="section-title">
          Back to the <em>screen</em>
        </h2>
        <p className="section-blurb">
          Saluran terakhir yang Anda tonton — disimpan di perangkat ini saja.
        </p>
      </div>
      <div className="section-count">{entries.length} feeds</div>
    </header>
    <div className="recent-grid">
      {entries.map((e) => (
        <button
          key={e.url}
          type="button"
          className="recent-card"
          onClick={() => onPlay(e)}
        >
          {e.logo && (
            <img
              src={e.logo}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(ev) => {
                (ev.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <span className="recent-name">{e.name}</span>
          <span className="recent-meta">{timeAgo(Date.now() - e.ts)}</span>
        </button>
      ))}
    </div>
  </section>
);

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "baru saja";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `${d} hari lalu`;
}

const Footer = () => (
  <footer className="site-footer">
    <div className="container">
      <p>Stream dari kedalaman.</p>
      <p className="colophon">
        Set in Fraunces &amp; Inter Tight · Multi-play dengan hls.js · Served
        from the cloud · Tekan <kbd>/</kbd> untuk cari, <kbd>Esc</kbd> untuk
        tutup
      </p>
    </div>
  </footer>
);

export default App;
