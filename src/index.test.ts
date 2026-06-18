import { expect, test } from "bun:test";

test("parseM3u extracts channels from a real iptv-org playlist fragment", async () => {
  const { parseM3u } = await import("./m3u");
  const sample = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-id="Test.id@SD" tvg-logo="https://x/logo.png" group-title="Sports",Test Channel (1080p) [Not 24/7]',
    "#EXTVLCOPT:http-referrer=https://example.com/",
    "https://stream.example.com/live.m3u8",
    '#EXTINF:-1 tvg-id="Other.in@Indonesia" group-title="News",Other Channel',
    "https://other.example.com/manifest.m3u8",
  ].join("\n");

  const out = parseM3u(sample);
  expect(out).toHaveLength(2);

  expect(out[0]?.name).toBe("Test Channel");
  expect(out[0]?.logo).toBe("https://x/logo.png");
  expect(out[0]?.category).toBe("Sports");
  expect(out[0]?.url).toBe("https://stream.example.com/live.m3u8");
  expect(out[0]?.referrer).toBe("https://example.com/");
  expect(out[0]?.resolution).toBe("1080p");
  expect(out[0]?.country).toBe("id");

  expect(out[1]?.name).toBe("Other Channel");
  expect(out[1]?.category).toBe("News");
  expect(out[1]?.country).toBe("in");
  expect(out[1]?.referrer).toBe("");
});

test("parseM3u handles channels with no logo or vlc opts", async () => {
  const { parseM3u } = await import("./m3u");
  const out = parseM3u(
    "#EXTINF:-1,Plain Channel\nhttp://example.com/plain.m3u8\n",
  );
  expect(out).toHaveLength(1);
  expect(out[0]?.name).toBe("Plain Channel");
  expect(out[0]?.url).toBe("http://example.com/plain.m3u8");
  expect(out[0]?.logo).toBe("");
});

test("parseM3u skips unescaped commas inside quoted attributes", async () => {
  // Regression: iptv-org ships some http-user-agent values with internal
  // commas (e.g. "Mozilla/5.0 ... KHTML, like Gecko ..."). The first
  // unquoted comma must separate attrs from name, not split the attr value.
  const { parseM3u } = await import("./m3u");
  const sample = [
    '#EXTINF:-1 tvg-id="Foo.id@SD" tvg-logo="https://x/y.png" http-user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36" group-title="Cooking",Dens Food Channel [Geo-blocked]',
    "https://example.com/dens.m3u8",
  ].join("\n");
  const out = parseM3u(sample);
  expect(out).toHaveLength(1);
  expect(out[0]?.name).toBe("Dens Food Channel");
  expect(out[0]?.userAgent).toContain("KHTML, like Gecko");
  expect(out[0]?.userAgent).toContain("Chrome/144.0.0.0");
});
