import { renderToString } from "react-dom/server";
import App from "./app";
import type { ChannelCategory, M3uChannel } from "./schemas";

export interface RenderOptions {
  initialChannels: M3uChannel[];
  initialCategory: ChannelCategory;
  upstreamError: string | null;
  requestUrl: string;
}

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter+Tight:wght@400;500;600&display=swap">';

const HLS_SCRIPT =
  '<script defer src="https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js"></script>';

/** Serialise state for the client to consume during hydration. */
function serialiseData(data: unknown): string {
  // Escape `</` to prevent script-tag breakout even with adversarial data.
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderApp(opts: RenderOptions): string {
  const markup = renderToString(
    <App
      initialChannels={opts.initialChannels}
      initialCategory={opts.initialCategory}
      upstreamError={opts.upstreamError}
      isServer
    />,
  );

  const initialScript =
    `<script>window.__HADESTV__=${serialiseData(opts.initialChannels)};` +
    `window.__HADESTV_CATEGORY__=${JSON.stringify(opts.initialCategory)};` +
    `window.__HADESTV_ERROR__=${JSON.stringify(opts.upstreamError)};</script>`;

  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light">
    <meta name="theme-color" content="#F2EDE2">
    <title>Hades/TV — Streaming dari kedalaman</title>
    <meta name="description" content="Saluran TV langsung dari seluruh dunia — Indonesia, olahraga, berita, film, dan anak-anak. Multi-play dengan pemain video langsung.">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text y=%22.9em%22 font-size=%2228%22>📺</text></svg>">
    ${FONT_LINK}
    ${HLS_SCRIPT}
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <div id="root">${markup}</div>
    ${initialScript}
    <script type="module" src="/client.js"></script>
  </body>
</html>`;
}
