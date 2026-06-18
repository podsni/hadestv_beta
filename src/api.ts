export interface Stream {
  name: string;
  url: string;
  vip: boolean;
}

export interface Event {
  url: string;
  name: string;
  logo: string;
  genre: number;
  time: string;
  isevent: boolean;
  vip: boolean;
  featured: boolean;
  streams: Stream[];
}

export interface Channel {
  url: string;
  name: string;
  logo: string;
  genre: number;
  vip: boolean;
  streams: Stream[];
}

export interface Replay {
  url: string;
  name: string;
  logo: string;
  genre: number;
  time: string;
  isevent: boolean;
  vip: boolean;
  featured: boolean;
  streams: Stream[];
}

export interface TimStreamsData {
  events: Event[];
  channels: Channel[];
  replays: Replay[];
}

export interface DuktekChannel {
  id_iptv: string;
  nama_channel: string;
  tagline: string;
  jenis: string;
  url_iptv: string;
  gbr_base64: string;
  url_license: string;
}

export interface DuktekEvent {
  id_iptv: string;
  nama_channel: string;
  url_iptv: string;
  url_license: string;
  jenis: string;
  nama_event: string;
  player_1: string;
  player_2: string;
  logo_1: string;
  logo_2: string;
  jadwal_event: string;
  jadwal_stop: string;
  deskripsi: string;
  deskripsi_en: string;
  id_event: string;
  thumbnail: string;
}

export interface DuktekData {
  sports: DuktekChannel[];
  hiburan: DuktekChannel[];
  events: DuktekEvent[];
}

const API_BASE = "https://api.nuevasantino.xyz/api";
const DUKTEK_BASE =
  "https://cdn.jsdelivr.net/gh/movietrailersxxi-pixel/web@main/assets";

export async function fetchTimStreamsData(): Promise<TimStreamsData> {
  const [evResp, chResp, repResp] = await Promise.all([
    fetch(`${API_BASE}/live-upcoming`),
    fetch(`${API_BASE}/channels`),
    fetch(`${API_BASE}/replays`),
  ]);

  const evData = (await evResp.json()) as unknown as TimStreamsData;
  const chData = (await chResp.json()) as unknown as TimStreamsData;
  const repData = (await repResp.json()) as unknown as TimStreamsData;

  return {
    events: evData.events || [],
    channels: chData.channels || [],
    replays: repData.replays || [],
  };
}

export function slugify(name: string): string {
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

function duktekChannelToHadestv(ch: DuktekChannel, genre: number): Channel {
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
  const name = `${ev.player_1} vs ${ev.player_2}`;
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

export async function fetchDuktekData(): Promise<TimStreamsData> {
  const [sportsResp, hibResp, eventsResp] = await Promise.all([
    fetch(`${DUKTEK_BASE}/tv-sports.dat`),
    fetch(`${DUKTEK_BASE}/tv-hiburan.dat`),
    fetch(`${DUKTEK_BASE}/tv-events.dat`),
  ]);

  if (!sportsResp.ok || !hibResp.ok || !eventsResp.ok) {
    throw new Error(
      `Duktek fetch failed: sports=${sportsResp.status}, hib=${hibResp.status}, events=${eventsResp.status}`,
    );
  }

  const sports = (await sportsResp.json()) as DuktekChannel[];
  const hiburan = (await hibResp.json()) as DuktekChannel[];
  const events = (await eventsResp.json()) as DuktekEvent[];

  return {
    events: events.map(duktekEventToHadestv),
    channels: [
      ...sports.map((c) => duktekChannelToHadestv(c, 1)),
      ...hiburan.map((c) => duktekChannelToHadestv(c, 2)),
    ],
    replays: [],
  };
}

export async function fetchDuktekRaw(): Promise<DuktekData> {
  const [sportsResp, hibResp, eventsResp] = await Promise.all([
    fetch(`${DUKTEK_BASE}/tv-sports.dat`),
    fetch(`${DUKTEK_BASE}/tv-hiburan.dat`),
    fetch(`${DUKTEK_BASE}/tv-events.dat`),
  ]);

  const [sports, hiburan, events] = await Promise.all([
    sportsResp.json() as Promise<DuktekChannel[]>,
    hibResp.json() as Promise<DuktekChannel[]>,
    eventsResp.json() as Promise<DuktekEvent[]>,
  ]);

  return { sports, hiburan, events };
}
