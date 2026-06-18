import { z } from "zod";

/**
 * Zod schemas for the Duktek Sports .dat files.
 * Each .dat file is a JSON array — we validate at the network boundary
 * so the rest of the app can trust its inputs.
 */

export const DuktekStreamSchema = z.object({
  name: z.string(),
  url: z.string(),
  vip: z.boolean().optional().default(false),
});

export const DuktekChannelSchema = z.object({
  id_iptv: z.string(),
  nama_channel: z.string(),
  tagline: z.string().optional().default(""),
  jenis: z.string().optional().default(""),
  url_iptv: z.string(),
  gbr_base64: z.string().optional().default(""),
  url_license: z.string().optional().default(""),
});

export const DuktekEventSchema = z.object({
  id_iptv: z.string(),
  nama_channel: z.string(),
  url_iptv: z.string(),
  url_license: z.string().optional().default(""),
  jenis: z.string().optional().default(""),
  nama_event: z.string().optional().default(""),
  player_1: z.string().optional().default(""),
  player_2: z.string().optional().default(""),
  logo_1: z.string().optional().default(""),
  logo_2: z.string().optional().default(""),
  jadwal_event: z.string().optional().default(""),
  jadwal_stop: z.string().optional().default(""),
  deskripsi: z.string().optional().default(""),
  deskripsi_en: z.string().optional().default(""),
  id_event: z.string().optional().default(""),
  thumbnail: z.string().optional().default(""),
});

export const DuktekSportsArraySchema = z.array(DuktekChannelSchema);
export const DuktekHiburanArraySchema = z.array(DuktekChannelSchema);
export const DuktekEventsArraySchema = z.array(DuktekEventSchema);

/** Output schemas used by the UI — what we hand to React. */

export const StreamSchema = DuktekStreamSchema;

export const ChannelSchema = z.object({
  url: z.string(),
  name: z.string(),
  logo: z.string(),
  genre: z.union([z.literal(1), z.literal(2)]),
  vip: z.boolean(),
  streams: z.array(StreamSchema),
});

export const EventSchema = z.object({
  url: z.string(),
  name: z.string(),
  logo: z.string(),
  genre: z.union([z.literal(1), z.literal(2)]),
  time: z.string(),
  isevent: z.literal(true),
  vip: z.boolean(),
  featured: z.boolean(),
  streams: z.array(StreamSchema),
});

export const ReplaySchema = EventSchema.extend({
  isevent: z.literal(false),
});

export const TimStreamsDataSchema = z.object({
  events: z.array(EventSchema),
  channels: z.array(ChannelSchema),
  replays: z.array(ReplaySchema),
});

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  upstream: z.string(),
  counts: z.object({
    sports: z.number(),
    hiburan: z.number(),
    events: z.number(),
  }),
  fetchedAt: z.string(),
});

export type Stream = z.infer<typeof StreamSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Event = z.infer<typeof EventSchema>;
export type Replay = z.infer<typeof ReplaySchema>;
export type TimStreamsData = z.infer<typeof TimStreamsDataSchema>;
export type DuktekChannel = z.infer<typeof DuktekChannelSchema>;
export type DuktekEvent = z.infer<typeof DuktekEventSchema>;
