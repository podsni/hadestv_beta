import { z } from "zod";

/**
 * Schemas for iptv-org M3U streams.
 *
 * Source: https://github.com/iptv-org/iptv (community-curated open M3U list).
 * Each M3U file is a flat text document — we parse it into structured channel
 * entries server-side and validate at the network boundary so the rest of
 * the app can trust its inputs.
 */

/** Parsed M3U channel — one stream per entry. */
export const M3uChannelSchema = z.object({
  url: z.string(),
  name: z.string(),
  logo: z.string().optional().default(""),
  category: z.string().optional().default(""),
  country: z.string().optional().default(""),
  language: z.string().optional().default(""),
  tvgId: z.string().optional().default(""),
  referrer: z.string().optional().default(""),
  userAgent: z.string().optional().default(""),
  resolution: z.string().optional().default(""),
});
export type M3uChannel = z.infer<typeof M3uChannelSchema>;

/** API response shape — keeps the inner channel list generic. */
export const ChannelsResponseSchema = z.object({
  category: z.string(),
  fetchedAt: z.string(),
  count: z.number(),
  channels: z.array(M3uChannelSchema),
});
export type ChannelsResponse = z.infer<typeof ChannelsResponseSchema>;

/** Health endpoint response. */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  upstream: z.array(z.string()),
  fetchedAt: z.string(),
  counts: z.record(z.string(), z.number()),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Categories we ship from iptv-org. Kept as a union so the URL
 *  ?category=... is validated before fetching upstream. */
export const ChannelCategorySchema = z.enum([
  "id", // Indonesia
  "sports",
  "news",
  "movies",
  "kids",
]);
export type ChannelCategory = z.infer<typeof ChannelCategorySchema>;

export const CATEGORIES: readonly ChannelCategory[] = [
  "id",
  "sports",
  "news",
  "movies",
  "kids",
] as const;

export const CATEGORY_LABELS: Readonly<Record<ChannelCategory, string>> = {
  id: "Indonesia",
  sports: "Sports",
  news: "News",
  movies: "Movies",
  kids: "Kids",
};

export const CATEGORY_BLURBS: Readonly<Record<ChannelCategory, string>> = {
  id: "Saluran lokal dari Sabang sampai Merauke — berita, hiburan, dan olahraga.",
  sports:
    "Pertandingan langsung dari seluruh dunia — sepak bola, bulu tangkis, basket, dan banyak lagi.",
  news: "Saluran berita 24/7 — liputan internasional, lokal, dan breaking news.",
  movies: "Saluran film klasik, dokumenter, dan sinema dunia.",
  kids: "Saluran ramah anak — kartun, edukasi, dan tontonan keluarga.",
};
