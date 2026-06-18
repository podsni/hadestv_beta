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
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [streamErrors, setStreamErrors] = useState<Record<string, string>>({});

  // Load IP + recent on mount.
  useEffect(() => {
    if (isServer) return;
    setRecent(loadRecent());
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
  }, [isServer]);

  const fetchCategory = useCallback(async (cat: ChannelCategory) => {
    setLoading(true);
    setError(null);
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
        // 'c' closes the most recently added player.
        ev.preventDefault();
        closeOne(active[0]?.url ?? "");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServer, active]);

  const playStream = useCallback((ch: M3uChannel) => {
    setActive((prev) => {
      // Dedupe by URL — move to top if already present.
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

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q),
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
          value={search}
          onChange={setSearch}
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
          channels={remainingChannels}
          onPlay={playStream}
          search={search}
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
  category: ChannelCategory;
  onCategoryChange: (cat: ChannelCategory) => void;
  loading: boolean;
}

const SearchBar = ({
  value,
  onChange,
  category,
  onCategoryChange,
  loading,
}: SearchBarProps) => (
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
        placeholder="Cari saluran…"
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
        >
          ×
        </button>
      )}
      <kbd className="search-kbd" aria-hidden="true">
        /
      </kbd>
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
  </div>
);

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
// ChannelsList — compact list of remaining channels
// ---------------------------------------------------------------------------

const ChannelsList = ({
  channels,
  onPlay,
  search,
}: {
  channels: M3uChannel[];
  onPlay: (ch: M3uChannel) => void;
  search: string;
}) => {
  if (channels.length === 0) {
    return (
      <section id="all" className="section">
        <header className="section-head">
          <div>
            <span className="section-kicker">Semua saluran</span>
            <h2 className="section-title">
              Nothing on the <em>wire</em>
            </h2>
            <p className="section-blurb">
              {search.trim()
                ? `Tidak ada saluran yang cocok dengan “${search.trim()}”.`
                : "Coba kategori lain atau segarkan daftar."}
            </p>
          </div>
        </header>
      </section>
    );
  }
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
        <div className="section-count">{channels.length} saluran</div>
      </header>
      <ul className="channel-list">
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
    </section>
  );
};

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
