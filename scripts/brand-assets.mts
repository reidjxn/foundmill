// Generates the static brand files for apps/web from the vector marks in packages/dugout/src/brand/marks.ts.
// Colours come from packages/dugout/src/tokens.css so no hex is duplicated here.
//   pnpm exec tsx scripts/brand-assets.mts
// PNG variants (apple-icon, opengraph-image, maskable icons) are rasterised from these SVGs with
// headless Chromium: pnpm exec tsx scripts/brand-assets.mts --png   (needs playwright-core + a Chromium).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, APP_TAGLINE } from "../packages/config/src/brand.ts";
import {
  MONOGRAM_HEIGHT,
  MONOGRAM_PATH,
  MONOGRAM_WIDTH,
  WORDMARK_HEIGHT,
  WORDMARK_PATH,
  WORDMARK_WIDTH,
  iconSvg,
  monogramSvg,
  wordmarkSvg,
} from "../packages/dugout/src/brand/marks.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = readFileSync(join(root, "packages/dugout/src/tokens.css"), "utf8");
// A token is a hex literal or an alias of another token (`--bg-ink: var(--ink)`); follow aliases to the literal.
const token = (name: string, depth = 0): string => {
  const m = tokens.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8}|var\\((--[a-z0-9-]+)\\))`));
  if (!m) throw new Error(`token ${name} not found in tokens.css`);
  if (m[2]) {
    if (depth > 8) throw new Error(`token ${name} aliases too deeply`);
    return token(m[2], depth + 1);
  }
  return m[1]!.toLowerCase();
};

const ink = token("--bg-ink");
const base = token("--bg-base");
const light = token("--text-primary");
const secondary = token("--text-secondary");

const webApp = join(root, "apps/web/app");
const brandDir = join(root, "apps/web/public/brand");
mkdirSync(brandDir, { recursive: true });

const files: Record<string, string> = {
  // Next.js picks app/icon.svg up as the favicon. The ink tile reads at 16 px in light and dark browser chrome;
  // swap for iconSvg({ fill: base, darkFill: light }) to ship the transparent, scheme-aware letters instead.
  [join(webApp, "icon.svg")]: iconSvg({ tile: ink, fill: light, title: APP_NAME }),
  [join(brandDir, "foundmill-icon-transparent.svg")]: iconSvg({ fill: base, darkFill: light, title: APP_NAME }),
  // Transparent marks for dark surfaces (light letters) and light surfaces (ink letters).
  [join(brandDir, "foundmill-wordmark-light.svg")]: wordmarkSvg({ fill: light, title: APP_NAME }),
  [join(brandDir, "foundmill-wordmark-ink.svg")]: wordmarkSvg({ fill: base, title: APP_NAME }),
  [join(brandDir, "foundmill-monogram-light.svg")]: monogramSvg({ fill: light, title: APP_NAME }),
  [join(brandDir, "foundmill-monogram-ink.svg")]: monogramSvg({ fill: base, title: APP_NAME }),
  // Opaque tile for launchers, link previews and anywhere a square icon is required.
  [join(brandDir, "foundmill-icon-tile.svg")]: iconSvg({ tile: ink, fill: light, title: APP_NAME }),
  // Open Graph card source (rasterised to app/opengraph-image.png by --png).
  [join(brandDir, "foundmill-og.svg")]: ogSvg(),
};

function ogSvg(): string {
  const W = 1200;
  const H = 630;
  const wmH = 92;
  const wmW = (wmH * WORDMARK_WIDTH) / WORDMARK_HEIGHT;
  const scale = wmH / WORDMARK_HEIGHT;
  const x = 96;
  const y = 236;
  const monoH = 28;
  const monoScale = monoH / MONOGRAM_HEIGHT;
  const monoW = MONOGRAM_WIDTH * monoScale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${APP_NAME}">` +
    `<rect width="${W}" height="${H}" fill="${ink}"/>` +
    `<rect x="0" y="${H - 6}" width="${W}" height="6" fill="${light}" opacity="0.08"/>` +
    `<g transform="translate(${x} ${y}) scale(${scale.toFixed(5)})"><path fill="${light}" d="${WORDMARK_PATH}"/></g>` +
    `<text x="${x}" y="${y + wmH + 64}" font-family="Inter, system-ui, sans-serif" font-size="30" fill="${secondary}">${escape(APP_TAGLINE)}</text>` +
    `<g transform="translate(${W - 96 - monoW} ${H - 72 - monoH}) scale(${monoScale.toFixed(5)})"><path fill="${light}" opacity="0.5" d="${MONOGRAM_PATH}"/></g>` +
    `<title>${escape(APP_NAME)} — ${escape(APP_TAGLINE)} (${Math.round(wmW)}px wordmark)</title>` +
    `</svg>`
  );
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

for (const [path, svg] of Object.entries(files)) {
  writeFileSync(path, svg + "\n");
  console.log("wrote", path.replace(root + "/", ""));
}

if (process.argv.includes("--png")) {
  // playwright-core is a dependency of the e2e package, not the root: run the PNG step from e2e
  // (cd e2e && pnpm exec tsx ../scripts/brand-assets.mts --png) or set FM_PLAYWRIGHT to the module path.
  const candidates = [process.env.FM_PLAYWRIGHT, "playwright-core", "@playwright/test"].filter(Boolean) as string[];
  let pw: typeof import("playwright-core") | null = null;
  for (const c of candidates) {
    pw = await import(c).catch(() => null);
    if (pw) break;
  }
  if (!pw) {
    console.error(`none of ${candidates.join(", ")} resolved; run the PNG step from the e2e package or set FM_PLAYWRIGHT.`);
    process.exit(1);
  }
  const executablePath = process.env.FM_CHROMIUM ?? undefined;
  const browser = await pw.chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const render = async (svg: string, out: string, w: number, h: number, bg?: string) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;${bg ? `background:${bg}` : ""}"><img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" width="${w}" height="${h}"/></body></html>`,
    );
    await page.screenshot({ path: out, omitBackground: !bg, clip: { x: 0, y: 0, width: w, height: h } });
    await page.close();
    console.log("wrote", out.replace(root + "/", ""));
  };
  const tile = files[join(brandDir, "foundmill-icon-tile.svg")]!;
  await render(tile, join(webApp, "apple-icon.png"), 180, 180);
  await render(tile, join(brandDir, "foundmill-icon-192.png"), 192, 192);
  await render(tile, join(brandDir, "foundmill-icon-512.png"), 512, 512);
  await render(files[join(brandDir, "foundmill-og.svg")]!, join(webApp, "opengraph-image.png"), 1200, 630, ink);
  await browser.close();
}
