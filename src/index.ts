import { rm, cp } from "node:fs/promises";

// Clean previous build
await rm("./dist", { recursive: true, force: true });

// Bundle the client-side code
const buildResult = await Bun.build({
  entrypoints: ["./src/client.tsx"],
  outdir: "./dist",
  minify: true,
  naming: "client.[ext]",
});

if (!buildResult.success) {
  // oxlint-disable-next-line no-console
  for (const log of buildResult.logs) console.error(log);
  process.exit(1);
}

// Copy static assets
await cp("./src/style.css", "./dist/style.css");
await cp("./index.html", "./dist/index.html");

// oxlint-disable-next-line no-console
console.log("Build complete → ./dist/");
