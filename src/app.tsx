import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Channel, Event, TimStreamsData } from "./schemas";

interface AppProps {
  initialData?: TimStreamsData;
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

const formatKickoff = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
};

const RECENT_KEY = "hadestv:recent";
const RECENT_MAX = 6;

type RecentEntry = { url: string; name: string; ts: number };

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

const App = ({ initialData, upstreamError, isServer }: AppProps) => {
  const initialFromWindow =
    !isServer && typeof window !== "undefined"
      ? ((window as unknown as { __HADESTV__?: TimStreamsData }).__HADESTV__ ??
        undefined)
      : undefined;

  const [data, setData] = useState<TimStreamsData>(
    initialData ??
      initialFromWindow ?? { events: [], channels: [], replays: [] },
  );
  const [activeStream, setActiveStream] = useState<{
    url: string;
    title: string;
    embedUrl: string;
  } | null>(null);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [playerError, setPlayerError] = useState(false);
  const [error, setError] = useState<string | null>(upstreamError ?? null);
  const [userIp, setUserIp] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState<"all" | 1 | 2>("all");
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  useEffect(() => {
    if (isServer) return;
    setRecent(loadRecent());
    fetch("https://api.ipify.org?format=json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const ip =
          j && typeof j === "object" && "ip" in j && typeof j.ip === "string"
            ? j.ip
            : null;
        if (ip) setUserIp(ip);
      })
      .catch(() => {});
  }, [isServer]);

  // Keyboard shortcuts
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
      if (ev.key === "Escape" && activeStream) {
        ev.preventDefault();
        closePlayer();
      } else if (ev.key === "/" && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        const input = document.getElementById("search-input");
        if (input instanceof HTMLInputElement) input.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServer, activeStream]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const resp = await fetch("/api/channels");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const next: TimStreamsData = await resp.json();
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  const sportsChannels = useMemo(
    () => (data.channels || []).filter((c) => c.genre === 1),
    [data],
  );
  const entertainmentChannels = useMemo(
    () => (data.channels || []).filter((c) => c.genre === 2),
    [data],
  );

  const playStream = useCallback((url: string, title: string) => {
    setPlayerError(false);
    setPlayerLoaded(false);
    // Use the upstream channel page directly. Duktek's blog page wraps a
    // Shaka player iframe that handles its own DRM/streaming logic. We
    // rely on the page being iframe-friendly in modern browsers; if it
    // isn't, the error state shows an "Open in new tab" fallback.
    setActiveStream({ url, title, embedUrl: url });
    setRecent(pushRecent({ url, name: title, ts: Date.now() }));
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const closePlayer = useCallback(() => {
    setActiveStream(null);
    setPlayerLoaded(false);
    setPlayerError(false);
  }, []);

  const filteredSports = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sportsChannels;
    return sportsChannels.filter((c) => c.name.toLowerCase().includes(q));
  }, [sportsChannels, search]);

  const filteredEntertainment = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entertainmentChannels;
    return entertainmentChannels.filter((c) =>
      c.name.toLowerCase().includes(q),
    );
  }, [entertainmentChannels, search]);

  const visibleRecent = useMemo(() => {
    if (!recent.length) return [];
    const byUrl = new Map<string, RecentEntry>();
    for (const ch of data.channels) {
      for (const e of recent) {
        if (e.url === ch.url) byUrl.set(ch.url, e);
      }
    }
    return recent
      .map((r) => byUrl.get(r.url))
      .filter((x): x is RecentEntry => x !== undefined)
      .slice(0, 4);
  }, [recent, data.channels]);

  if (error && data.channels.length === 0 && data.events.length === 0) {
    return (
      <div className="state-full">
        <div>
          <p className="state-mark">
            Signal <em>lost</em>
          </p>
          <p>{error}</p>
          <p style={{ marginTop: "24px" }}>
            <button type="button" className="btn" onClick={refresh}>
              Try again
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Masthead userIp={userIp} onRefresh={refresh} refreshing={refreshing} />

      <main className="container">
        {activeStream && (
          <section className="player-section" aria-label="Player">
            <div className="player-frame">
              <div className="player-aspect">
                {!playerError && (
                  <iframe
                    key={activeStream.embedUrl}
                    src={activeStream.embedUrl}
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                    referrerPolicy="no-referrer"
                    sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts"
                    title={activeStream.title}
                    loading="eager"
                    onLoad={() => setPlayerLoaded(true)}
                    onError={() => setPlayerError(true)}
                  />
                )}
                {playerError && (
                  <div className="player-error" role="alert">
                    <p className="state-mark">
                      Player <em>blocked</em>
                    </p>
                    <p>
                      The upstream embed could not be loaded. Try opening it
                      directly in a new tab.
                    </p>
                    <p style={{ marginTop: "20px" }}>
                      <a
                        href={activeStream.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn"
                      >
                        Open in new tab
                      </a>
                    </p>
                  </div>
                )}
                {!playerLoaded && !playerError && (
                  <div className="player-loading" aria-hidden="true">
                    <div className="spinner" />
                    <span>Tuning the broadcast</span>
                  </div>
                )}
              </div>
              <div className="player-bar">
                <span className="now-playing">
                  {activeStream.title ?? "Now streaming"}
                </span>
                <span className="actions">
                  <a
                    href={activeStream.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-link"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={closePlayer}
                    aria-label="Close player (Esc)"
                  >
                    Close
                  </button>
                </span>
              </div>
            </div>
          </section>
        )}

        {error && (
          <p className="error-banner" role="status">
            <em>Heads up:</em> {error}. Showing the last cached dispatch.
            <button type="button" className="btn btn-link" onClick={refresh}>
              Retry
            </button>
          </p>
        )}

        {visibleRecent.length > 0 && (
          <RecentRow entries={visibleRecent} onPlay={playStream} />
        )}

        <SearchBar
          value={search}
          onChange={setSearch}
          genreFilter={genreFilter}
          onGenreChange={setGenreFilter}
        />

        <EventsSection events={data.events || []} onPlay={playStream} />

        {(genreFilter === "all" || genreFilter === 1) && (
          <ChannelsSection
            id="sports"
            kicker="Section II"
            title={
              <>
                The <em>Sports</em> Dial
              </>
            }
            blurb="Forty-nine satellite feeds, refreshed from the wire each visit. Every league, every language."
            channels={filteredSports}
            onPlay={playStream}
            emptyMessage={
              search.trim()
                ? `No sports feeds matching “${search.trim()}”.`
                : "No sports feeds currently broadcasting."
            }
          />
        )}

        {(genreFilter === "all" || genreFilter === 2) && (
          <ChannelsSection
            id="entertainment"
            kicker="Section III"
            title={
              <>
                Late-Night <em>Television</em>
              </>
            }
            blurb="Drama, documentary, wildlife. Forty-two channels from across the archipelago."
            channels={filteredEntertainment}
            onPlay={playStream}
            emptyMessage={
              search.trim()
                ? `No entertainment feeds matching “${search.trim()}”.`
                : "No entertainment feeds listed."
            }
          />
        )}
      </main>

      <Footer />
    </>
  );
};

// --------------------------------------------------------------------
// Subcomponents
// --------------------------------------------------------------------

interface MastheadProps {
  userIp: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}

const Masthead = ({ userIp, onRefresh, refreshing }: MastheadProps) => (
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
            disabled={refreshing}
            aria-label="Refresh channel listings"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="masthead-rule" />
      <p className="tagline">
        Streaming <em>from the depths</em> — sports, cinema, and the long tail
        of broadcast television.
      </p>
    </header>

    <nav className="masthead-nav" aria-label="Section navigation">
      <div className="masthead-nav-inner">
        <nav>
          <a href="#events">Live &amp; Upcoming</a>
          <a href="#sports">Sports TV</a>
          <a href="#entertainment">Entertainment</a>
          <a href="#recent">Recently Played</a>
        </nav>
        {userIp && <span className="ip-pill">IP · {userIp}</span>}
      </div>
    </nav>
  </>
);

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  genreFilter: "all" | 1 | 2;
  onGenreChange: (g: "all" | 1 | 2) => void;
}

const SearchBar = ({
  value,
  onChange,
  genreFilter,
  onGenreChange,
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
        placeholder="Search channels…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search channels"
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
      <kbd className="search-kbd" aria-hidden="true">
        /
      </kbd>
    </div>
    <div className="filter-chips" role="tablist" aria-label="Genre filter">
      <button
        type="button"
        role="tab"
        aria-selected={genreFilter === "all"}
        className={`chip ${genreFilter === "all" ? "chip-active" : ""}`}
        onClick={() => onGenreChange("all")}
      >
        All
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={genreFilter === 1}
        className={`chip ${genreFilter === 1 ? "chip-active" : ""}`}
        onClick={() => onGenreChange(1)}
      >
        Sports
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={genreFilter === 2}
        className={`chip ${genreFilter === 2 ? "chip-active" : ""}`}
        onClick={() => onGenreChange(2)}
      >
        Entertainment
      </button>
    </div>
  </div>
);

const RecentRow = ({
  entries,
  onPlay,
}: {
  entries: RecentEntry[];
  onPlay: (url: string, title: string) => void;
}) => (
  <section id="recent" className="section">
    <header className="section-head">
      <div>
        <span className="section-kicker">Recently Played</span>
        <h2 className="section-title">
          Back to the <em>screen</em>
        </h2>
        <p className="section-blurb">
          Pick up where you left off — your last few channels, stored locally on
          this device.
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
          onClick={() => onPlay(e.url, e.name)}
        >
          <span className="recent-name">{e.name}</span>
          <span className="recent-meta">{timeAgo(Date.now() - e.ts)}</span>
        </button>
      ))}
    </div>
  </section>
);

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const Footer = () => (
  <footer className="site-footer">
    <div className="container">
      <p>Stream from the depths.</p>
      <p className="colophon">
        Set in Fraunces &amp; Inter Tight · Programmed by hand · Served from the
        cloud · Press <kbd>/</kbd> to search, <kbd>Esc</kbd> to close
      </p>
    </div>
  </footer>
);

const EventsSection = ({
  events,
  onPlay,
}: {
  events: Event[];
  onPlay: (url: string, title: string) => void;
}) => {
  if (!events.length) {
    return (
      <section id="events" className="section">
        <header className="section-head">
          <div>
            <span className="section-kicker">
              Section I · Today's programme
            </span>
            <h2 className="section-title">
              Live <em>&amp; Upcoming</em>
            </h2>
            <p className="section-blurb">
              No fixtures on the wire right now — check back at the next
              kickoff.
            </p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section id="events" className="section">
      <header className="section-head">
        <div>
          <span className="section-kicker">Section I · Today's programme</span>
          <h2 className="section-title">
            Live <em>&amp; Upcoming</em>
          </h2>
          <p className="section-blurb">
            World Cup qualifiers, badminton, the women's volleyball league —
            thirty-seven fixtures across the next fortnight.
          </p>
        </div>
        <div className="section-count">{events.length} fixtures</div>
      </header>

      <div className="events-grid">
        {events.slice(0, 12).map((ev) => (
          <EventCard key={ev.url} ev={ev} onPlay={onPlay} />
        ))}
      </div>
      {events.length > 12 && (
        <details className="events-more">
          <summary>Show all {events.length} fixtures</summary>
          <div className="events-grid" style={{ marginTop: "32px" }}>
            {events.slice(12).map((ev) => (
              <EventCard key={ev.url} ev={ev} onPlay={onPlay} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
};

const EventCard = ({
  ev,
  onPlay,
}: {
  ev: Event;
  onPlay: (url: string, title: string) => void;
}) => {
  const titleParts = ev.name.split(" — ");
  const league = titleParts[0] ?? "";
  const match = titleParts[1] ?? ev.name;
  const splitMatch = match.split(" vs ");

  return (
    <button
      type="button"
      className="event-card"
      onClick={() => onPlay(ev.url, ev.name)}
    >
      <div className="thumb">
        {ev.logo && (
          <img src={ev.logo} alt="" loading="lazy" decoding="async" />
        )}
      </div>
      <div className="meta">
        <span className="league">{league}</span>
        <h3 className="match">
          {splitMatch.length === 2 ? (
            <>
              {splitMatch[0]} <em>vs</em> {splitMatch[1]}
            </>
          ) : (
            match
          )}
        </h3>
        <span className="time">{formatKickoff(ev.time)}</span>
        {(ev.streams?.length ?? 0) > 0 && (
          <span className="channels">
            {ev.streams!.length} feed{ev.streams!.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </button>
  );
};

const ChannelsSection = ({
  id,
  kicker,
  title,
  blurb,
  channels,
  onPlay,
  emptyMessage,
}: {
  id: string;
  kicker: string;
  title: React.ReactNode;
  blurb: string;
  channels: Channel[];
  onPlay: (url: string, title: string) => void;
  emptyMessage: string;
}) => {
  return (
    <section id={id} className="section">
      <header className="section-head">
        <div>
          <span className="section-kicker">{kicker}</span>
          <h2 className="section-title">{title}</h2>
          <p className="section-blurb">{blurb}</p>
        </div>
        <div className="section-count">{channels.length} feeds</div>
      </header>

      {channels.length ? (
        <div className="channels-grid">
          {channels.map((ch) => (
            <ChannelCard key={ch.url} ch={ch} onPlay={onPlay} />
          ))}
        </div>
      ) : (
        <p className="empty-state">{emptyMessage}</p>
      )}
    </section>
  );
};

const ChannelCard = ({
  ch,
  onPlay,
}: {
  ch: Channel;
  onPlay: (url: string, title: string) => void;
}) => {
  return (
    <button
      type="button"
      className="channel-card"
      onClick={() => onPlay(ch.url, ch.name)}
    >
      <div className="thumb">
        {ch.logo && (
          <img src={ch.logo} alt="" loading="lazy" decoding="async" />
        )}
        <span className="play-icon">{PLAY_ICON}</span>
      </div>
      <h3 className="name">{ch.name}</h3>
      <span className="genre">
        {ch.genre === 1 ? "Sports · 24/7" : "Entertainment"}
      </span>
    </button>
  );
};

export default App;
