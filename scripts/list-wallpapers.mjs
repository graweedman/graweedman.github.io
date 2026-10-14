// Lists the images in wallpapers/ into wallpapers.json, so the page can pick one at random.
// Run after adding or removing wallpapers:   node scripts/list-wallpapers.mjs
// (The GitHub workflow also runs it on every update.)

import { readdir, readFile, writeFile } from "node:fs/promises";

const DIR = "wallpapers";
const OUT = "wallpapers.json";
const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

const files = (await readdir(DIR).catch(() => []))
  .filter((f) => IMAGE.test(f) && !f.startsWith("."))
  .sort()
  .map((f) => `${DIR}/${f}`);

const json = JSON.stringify({ wallpapers: files }, null, 2) + "\n";
const previous = await readFile(OUT, "utf8").catch(() => "");
if (previous === json) console.log(`No changes (${files.length} wallpapers).`);
else { await writeFile(OUT, json); console.log(`Wrote ${files.length} wallpapers to ${OUT}.`); }
