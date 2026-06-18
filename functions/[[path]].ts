/// <reference types="@cloudflare/workers-types" />
/**
 * Pages Function — catch-all route mounted on Cloudflare Pages.
 * Hosts the same Hono application that lives in src/worker.ts but is
 * adapted to the Pages Functions signature (EventContext). Static assets
 * served from `dist/` (client.js, style.css) are handled by Pages
 * automatically — anything not matched here falls through to them.
 */
import { handle } from "hono/cloudflare-pages";
import { app } from "../src/hono-app";

// Re-export the Pages Function handler. `handle` adapts a Hono app to the
// Pages Functions runtime — it routes through the Hono app for any request
// that hits this function (everything except static asset URLs which Pages
// serves directly from dist/).
export const onRequest = handle(app);
