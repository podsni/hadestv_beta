import React, { useState, useEffect, useMemo } from "react";
import {
  fetchDuktekData,
  type TimStreamsData,
  type Event,
  type Channel,
} from "./api";

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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
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

const App = () => {
  const [data, setData] = useState<TimStreamsData | null>(null);
  const [activeStream, setActiveStream] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userIp, setUserIp] = useState<string | null>(null);

  useEffect(() => {
    fetch("https://api.ipify.org?format=json")
      .then((r) => r.json())
      .then((j) => setUserIp(j.ip))
      .catch(() => {});
    fetchDuktekData()
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  const sportsChannels = useMemo(
    () => (data?.channels || []).filter((c) => c.genre === 1),
    [data],
  );
  const entertainmentChannels = useMemo(
    () => (data?.channels || []).filter((c) => c.genre === 2),
    [data],
  );

  const playStream = (url: string, title: string) => {
    setActiveStream(url);
    setActiveTitle(title);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const closePlayer = () => {
    setActiveStream(null);
    setActiveTitle(null);
  };

  if (loading) {
    return (
      <div className="state-full">
        <div>
          <div className="spinner" />
          <p className="state-mark">
            Descending <em>into the depths</em>
          </p>
          <p>Tuning the broadcast…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-full">
        <div>
          <p className="state-mark">
            Signal <em>lost</em>
          </p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Masthead userIp={userIp} />

      <main className="container">
        {activeStream && (
          <section className="player-section">
            <div className="player-frame">
              <div className="player-aspect">
                <iframe
                  src={activeStream}
                  allowFullScreen
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                  referrerPolicy="no-referrer"
                  title={activeTitle ?? "HadesTV Player"}
                />
              </div>
              <div className="player-bar">
                <span className="now-playing">
                  {activeTitle ?? "Now streaming"}
                </span>
                <span className="actions">
                  <a
                    href={activeStream}
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
                  >
                    Close
                  </button>
                </span>
              </div>
            </div>
          </section>
        )}

        <EventsSection events={data?.events || []} onPlay={playStream} />

        <ChannelsSection
          id="sports"
          kicker="Section II"
          title={
            <>
              The <em>Sports</em> Dial
            </>
          }
          blurb="Forty-nine satellite feeds, refreshed from the wire each visit. Every league, every language."
          channels={sportsChannels}
          onPlay={playStream}
          emptyMessage="No sports feeds currently broadcasting."
        />

        <ChannelsSection
          id="entertainment"
          kicker="Section III"
          title={
            <>
              Late-Night <em>Television</em>
            </>
          }
          blurb="Drama, documentary, wildlife. Forty-two channels from across the archipelago."
          channels={entertainmentChannels}
          onPlay={playStream}
          emptyMessage="No entertainment feeds listed."
        />
      </main>

      <Footer />
    </>
  );
};

const Masthead = ({ userIp }: { userIp: string | null }) => (
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
        <div className="masthead-meta right">A daily dispatch of streams</div>
      </div>
      <div className="masthead-rule" />
      <p className="tagline">
        Streaming <em>from the depths</em> — sports, cinema, and the long tail
        of broadcast television.
      </p>
    </header>

    <nav className="masthead-nav">
      <div className="masthead-nav-inner">
        <nav>
          <a href="#events">Live & Upcoming</a>
          <a href="#sports">Sports TV</a>
          <a href="#entertainment">Entertainment</a>
        </nav>
        {userIp && <span className="ip-pill">IP · {userIp}</span>}
      </div>
    </nav>
  </>
);

const Footer = () => (
  <footer className="site-footer">
    <div className="container">
      <p>Stream from the depths.</p>
      <p className="colophon">
        Set in Fraunces &amp; Inter Tight · Programmed by hand · Served from the
        cloud
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
  if (!events.length) return null;

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
        {events.map((ev) => (
          <EventCard key={ev.url} ev={ev} onPlay={onPlay} />
        ))}
      </div>
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
        {ev.logo && <img src={ev.logo} alt="" loading="lazy" />}
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
        {ch.logo && <img src={ch.logo} alt="" loading="lazy" />}
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
