#!/usr/bin/env node
/**
 * A dependency-free static file server for the built Storybook (`storybook-static`), used by the accessibility run
 * (`a11y/playwright.config.ts`). Usage: `node scripts/serve-static.mjs <dir> <port>`. Serves files under <dir> only;
 * a path that resolves outside it, or is missing, is a 404.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "storybook-static");
const port = Number(process.argv[3] ?? 6007);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  let file = resolve(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return void res.writeHead(404).end();
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    statSync(file);
  } catch {
    return void res.writeHead(404).end();
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => process.stdout.write(`serving ${root} on http://127.0.0.1:${port}\n`));
