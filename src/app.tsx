import React, { useState, useEffect, useMemo } from "react";
import {
  fetchDuktekData,
  type TimStreamsData,
  type Stream,
  type Event,
  type Channel,
  type Replay,
} from "./api";

const App = () => {
  const [data, setData] = useState<TimStreamsData | null>(null);
  const [activeStream, setActiveStream] = useState<string | null>(null);
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

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Descending into HadesTV...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading">
        <p style={{ color: "#ff6b6b" }}>Failed to load streams</p>
        <p style={{ fontSize: 13, opacity: 0.6 }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="site-header">
        <div className="container header-content">
          <div className="logo-group">
            <div className="logo">
              HADES<span>TV</span>
            </div>
            {userIp && <div className="user-ip">IP: {userIp}</div>}
          </div>
          <nav className="site-nav">
            <a href="#events">Live Events</a>
            <a href="#sports">Sports TV</a>
            <a href="#entertainment">Entertainment</a>
          </nav>
        </div>
      </header>

      <main className="container">
        {activeStream && (
          <section className="player-section">
            <div className="player-wrapper">
              <div className="player-container">
                <iframe
                  src={activeStream}
                  allowFullScreen
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                  referrerPolicy="no-referrer"
                  title="HadesTV Player"
                />
              </div>
              <div className="player-controls">
                <a
                  href={activeStream}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-link"
                >
                  Open in New Tab
                </a>
                <button
                  className="btn btn-close"
                  onClick={() => setActiveStream(null)}
                >
                  Close Player
                </button>
              </div>
            </div>
          </section>
        )}

        <section id="events" className="section">
          <h2 className="section-title">
            Live & Upcoming
            <span className="section-count">{data?.events.length ?? 0}</span>
          </h2>
          {data?.events.length ? (
            <div className="grid">
              {data.events.map((ev) => (
                <Card
                  key={ev.url}
                  item={ev}
                  onPlay={(url) => setActiveStream(url)}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">No upcoming events.</p>
          )}
        </section>

        <section id="sports" className="section">
          <h2 className="section-title">
            Sports TV
            <span className="section-count">{sportsChannels.length}</span>
          </h2>
          {sportsChannels.length ? (
            <div className="grid">
              {sportsChannels.map((ch) => (
                <Card
                  key={ch.url}
                  item={ch}
                  onPlay={(url) => setActiveStream(url)}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">No sports channels available.</p>
          )}
        </section>

        <section id="entertainment" className="section">
          <h2 className="section-title">
            Entertainment
            <span className="section-count">
              {entertainmentChannels.length}
            </span>
          </h2>
          {entertainmentChannels.length ? (
            <div className="grid">
              {entertainmentChannels.map((ch) => (
                <Card
                  key={ch.url}
                  item={ch}
                  onPlay={(url) => setActiveStream(url)}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">No entertainment channels available.</p>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>
            &copy; 2026 HadesTV. Stream from the depths. — Powered by Duktek
            Sports data.
          </p>
        </div>
      </footer>
    </div>
  );
};

const Card = ({
  item,
  onPlay,
}: {
  item: Event | Channel | Replay;
  onPlay: (url: string) => void;
}) => {
  return (
    <div className="card">
      <div className="card-media">
        <img
          src={item.logo}
          alt={item.name}
          className="card-thumb"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="card-overlay">
          {item.streams && item.streams.length > 0 && (
            <button
              className="btn-play-large"
              onClick={() => item.streams[0] && onPlay(item.streams[0].url)}
            >
              <span>Play Stream</span>
            </button>
          )}
        </div>
      </div>
      <div className="card-body">
        <h3 className="card-title">{item.name}</h3>
        {"time" in item && item.time && (
          <p className="card-meta">
            {new Date(
              (item as unknown as { time: string }).time,
            ).toLocaleString()}
          </p>
        )}
        <div className="stream-list">
          {item.streams?.map((s: Stream, idx: number) => (
            <button
              key={idx}
              className="btn-stream"
              onClick={() => onPlay(s.url)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
