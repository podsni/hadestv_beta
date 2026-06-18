import { renderToString } from "react-dom/server";
import App from "./app";
import type { TimStreamsData } from "./schemas";

export interface RenderOptions {
  initialData: TimStreamsData;
  upstreamError: string | null;
  requestUrl: string;
}

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter+Tight:wght@400;500;600&display=swap">';

/** Serialise state for the client to consume during hydration. */
function serialiseData(data: TimStreamsData): string {
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
      initialData={opts.initialData}
      upstreamError={opts.upstreamError}
      isServer
    />,
  );

  const initialScript =
    `<script>window.__HADESTV__=${serialiseData(opts.initialData)};` +
    `window.__HADESTV_ERROR__=${JSON.stringify(opts.upstreamError)};</script>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light">
    <meta name="theme-color" content="#F2EDE2">
    <title>Hades/TV — Streaming from the depths</title>
    <meta name="description" content="A daily dispatch of streams — sports, cinema, and the long tail of broadcast television.">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text y=%22.9em%22 font-size=%2228%22>📺</text></svg>">
    ${FONT_LINK}
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <div id="root">${markup}</div>
    ${initialScript}
    <script type="module" src="/client.js"></script>
  </body>
</html>`;
}
