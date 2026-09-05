#!/usr/bin/env node
'use strict';

/**
 * Converts every source image into one packed grid per density, plus a
 * manifest, into web/public/grids/. Run before building the web app.
 *
 *   node scripts/build-grids.js
 *
 * Sources are art/*.{png,jpg,jpeg,webp}. If that is empty it falls back to
 * art/placeholder/, so a fresh clone still builds — the moment real art lands
 * in art/, the placeholder is ignored.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { convert } = require('./convert');
const { pack } = require('./grid-format');

// The slider in the web app steps through exactly these widths. More steps
// means a smoother "watch it degrade" sweep; each one costs a file.
const DENSITIES = [40, 55, 70, 85, 100, 115, 130, 140];

const ROOT = path.join(__dirname, '..');
const ART_DIR = path.join(ROOT, 'art');
const PLACEHOLDER_DIR = path.join(ART_DIR, 'placeholder');
const OUT_DIR = path.join(ROOT, 'web', 'public', 'grids');
const PUBLIC_DIR = path.join(ROOT, 'web', 'public');

// Home-screen icons, generated from the first piece so "Add to Home Screen"
// lands on the actual art rather than a stock glyph.
const ICONS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function imagesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => path.join(dir, name));
}

/** Filename-safe id derived from the source basename. */
function slugify(file) {
  return path
    .basename(file, path.extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Turn a slug into something presentable in the UI. */
function titleize(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  let sources = imagesIn(ART_DIR);
  let usingPlaceholder = false;

  if (sources.length === 0) {
    sources = imagesIn(PLACEHOLDER_DIR);
    usingPlaceholder = true;
  }

  if (sources.length === 0) {
    console.error(
      'build-grids: no images found.\n' +
        '  Put PFPs in art/, or run `npm run art:placeholder` for a stand-in.'
    );
    process.exit(1);
  }

  if (usingPlaceholder) {
    console.error('build-grids: art/ is empty — falling back to art/placeholder/\n');
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pieces = [];
  let totalBytes = 0;

  for (const source of sources) {
    const slug = slugify(source);
    const densities = [];

    for (const cols of DENSITIES) {
      const grid = await convert(source, { cols });
      const file = `${slug}-${cols}.json`;
      const json = JSON.stringify(pack(grid));

      fs.writeFileSync(path.join(OUT_DIR, file), json);
      totalBytes += Buffer.byteLength(json);
      densities.push({ cols, rows: grid.rows, file });
    }

    pieces.push({
      id: slug,
      title: titleize(slug),
      source: path.basename(source),
      placeholder: usingPlaceholder,
      densities,
    });

    console.error(
      `build-grids: ${path.basename(source)} -> ${DENSITIES.length} densities ` +
        `(${DENSITIES[0]}..${DENSITIES[DENSITIES.length - 1]} cols)`
    );
  }

  for (const { file, size } of ICONS) {
    await sharp(sources[0])
      .resize(size, size, { kernel: 'nearest' })
      .png()
      .toFile(path.join(PUBLIC_DIR, file));
  }
  console.error(`build-grids: icons ${ICONS.map((i) => i.size).join('/')} <- ${path.basename(sources[0])}`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    densities: DENSITIES,
    usingPlaceholder,
    pieces,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.error(
    `\nbuild-grids: ${pieces.length} piece(s), ` +
      `${pieces.length * DENSITIES.length} grids, ` +
      `${(totalBytes / 1024).toFixed(0)}KB total -> web/public/grids/`
  );

  // Name a file that actually exists, so nothing has to guess the density
  // list or the slug to play one back.
  const sample = pieces[0].densities[Math.floor(pieces[0].densities.length / 2)];
  console.error(`\nplay it:  node scripts/play.js web/public/grids/${sample.file} --loop`);
}

module.exports = { imagesIn, ART_DIR, PLACEHOLDER_DIR, DENSITIES };

if (require.main === module) {
  main().catch((err) => {
    console.error(`build-grids: ${err.message}`);
    process.exit(1);
  });
}
