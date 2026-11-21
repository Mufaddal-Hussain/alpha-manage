// Renders the placeholder home-screen icons into public/icons/ (T090). Run with: node scripts/generate-icons.mjs
// The mark is four tiles on the brand colour. When the owner supplies a logo under public/brand/, replace `mark` below
// (or just overwrite the PNGs) and keep the sizes: 192, 512, a maskable 512 and the 180px apple-touch-icon.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.join(process.cwd(), "public", "icons");
mkdirSync(out, { recursive: true });

const BRAND = "#9a3412";
const TILE = "#fff7ed";

/** The tile mark scaled into `size`; `scale` is the share of the icon it fills (maskable icons keep to the centre 60%). */
function svg(size, scale) {
  const span = size * scale;
  const gap = span * 0.08;
  const tile = (span - gap) / 2;
  const x0 = (size - span) / 2;
  const r = tile * 0.14;
  const rects = [0, 1]
    .flatMap((row) => [0, 1].map((col) => ({ row, col })))
    .map(({ row, col }, i) => `<rect x="${x0 + col * (tile + gap)}" y="${x0 + row * (tile + gap)}" width="${tile}" height="${tile}" rx="${r}" fill="${TILE}" opacity="${i === 3 ? 0.55 : 1}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${BRAND}"/>${rects}</svg>`;
}

const icons = [
  { file: "icon-192.png", size: 192, scale: 0.64 },
  { file: "icon-512.png", size: 512, scale: 0.64 },
  // Maskable: the platform may crop to a circle or a rounded square, so everything stays inside the central safe zone.
  { file: "icon-maskable-512.png", size: 512, scale: 0.5 },
  // iOS rounds the corners itself and fills transparent areas with black, so this one is full-bleed too.
  { file: "apple-touch-icon.png", size: 180, scale: 0.64 },
];

const browser = await chromium.launch();
for (const { file, size, scale } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0">${svg(size, scale)}</body>`);
  const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(path.join(out, file), png);
  await page.close();
}
writeFileSync(path.join(out, "icon.svg"), svg(512, 0.64));
await browser.close();
console.log("icons written to", out);
