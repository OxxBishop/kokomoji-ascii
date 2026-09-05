#!/usr/bin/env node
'use strict';

/**
 * KOKOMOJI ASCII toolkit — image to ASCII grid.
 *
 *   node scripts/convert.js <image> --cols 110 --out grid.json
 *
 * Samples the source image on a grid of cells, averages the pixel block behind
 * each cell, maps that block's luminance to a character and keeps its average
 * RGB. Output is consumed by scripts/play.js and by web/.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { pack } = require('./grid-format');

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Character ramps, ordered dark -> light: index 0 is drawn for the darkest
 * cells, the last index for the brightest. Swap DEFAULT_RAMP (or pass --ramp)
 * to change the entire look of the output.
 */
const RAMPS = {
  // Ten steps. Reads well at 80-140 cols and is the safest default.
  standard: ' .:-=+*#%@',
  // Long ramp: more tonal steps, softer gradients, wants a dense grid.
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  // Block shading. Chunky and poster-like; ignores letterforms entirely.
  blocks: ' ░▒▓█',
  // Punctuation only — keeps the silhouette, scrambles the surface into noise.
  scatter: ' .·:*+=%@#',
};

const DEFAULT_RAMP = 'standard';

/**
 * A terminal cell is about twice as tall as it is wide. Everything vertical in
 * this file is divided by this number.
 *
 * If we sampled the source on a square grid, N columns across a square image
 * would give N rows, and the terminal would then draw those N rows at 2x the
 * height of the N columns — a circle would come out as a 1:2 ellipse. So we
 * make each *source* block twice as tall as it is wide, which halves the row
 * count, which the terminal's 2:1 cells then stretch back to square.
 *
 * Concretely: a 1:1 source at --cols 110 gives 55 rows, not 110.
 */
const CELL_ASPECT = 2.0;

// Decoding a full-resolution 4K+ source pixel by pixel buys no extra accuracy
// once it is averaged down to ~140 cells wide, so cap the working size.
const MAX_SOURCE_EDGE = 4096;

// Colour composited under any transparent pixels (kokomoji.art background).
const DEFAULT_BACKGROUND = { r: 0x1a, g: 0x10, b: 0x29 };

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** Rec. 709 relative luminance, 0-255. */
function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Read the image as a raw RGB buffer, downscaling first if it is very large. */
async function loadPixels(inputPath, background) {
  let pipeline = sharp(inputPath);
  const meta = await pipeline.metadata();

  if (Math.max(meta.width, meta.height) > MAX_SOURCE_EDGE) {
    pipeline = pipeline.resize({
      width: MAX_SOURCE_EDGE,
      height: MAX_SOURCE_EDGE,
      fit: 'inside',
    });
  }

  if (meta.hasAlpha) pipeline = pipeline.flatten({ background });

  const { data, info } = await pipeline
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Value at a percentile of an already-sorted array. */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = clamp(Math.round((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[index];
}

/**
 * Choose a black and white point from the image's own luminance histogram.
 *
 * These PFPs are not photographs: they are a flat dark ground, a solid
 * mid-luminance head, and a near-white face-screen. Mapped straight down a
 * ramp, the head lands mid-scale and comes out as sparse texture where the
 * source reads as a solid mass.
 *
 * Pulling the black point just above the background pins the ground to blank,
 * and pulling the white point down to AUTO_WHITE_PERCENTILE lifts the head into
 * the dense end of the ramp.
 *
 * The white percentile is a balance. Too low (75 on these PFPs) and the head
 * and the face-screen both clip to the ramp's last character, flattening the
 * shell's badges and greebles; too high (90) and the head stays the sparse
 * texture this was meant to fix. 85 puts the head around index 6 of 10 while
 * leaving the screen as the only thing that reaches the top.
 *
 * Override per image with --levels lo,hi, or turn it off with --no-levels.
 */
const AUTO_BLACK_PERCENTILE = 5;
const AUTO_WHITE_PERCENTILE = 85;

function autoLevels(luminances) {
  const sorted = Float64Array.from(luminances).sort();
  const lo = percentile(sorted, AUTO_BLACK_PERCENTILE);
  const hi = percentile(sorted, AUTO_WHITE_PERCENTILE);
  // Degenerate images (flat, or nearly so) get the identity mapping.
  return hi - lo < 0.02 ? [0, 1] : [lo, hi];
}

/** Average the source into a cols x rows grid and map each cell to a character. */
function buildGrid(pixels, { cols, ramp, gamma, invert, cellAspect, levels }) {
  const { data, width, height, channels } = pixels;

  // Cell footprint in source pixels: as wide as the column stride, and
  // cellAspect times taller — see CELL_ASPECT above.
  const blockW = width / cols;
  const rows = Math.max(1, Math.round(height / (blockW * cellAspect)));

  const total = cols * rows;
  const cells = new Array(total);
  const luminances = new Float64Array(total);

  // Pass 1: average each block and record its luminance.
  for (let row = 0; row < rows; row++) {
    // Derive bounds from the row index so the blocks tile the image exactly
    // and no edge pixels are dropped to rounding.
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));

    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor((col * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / cols));

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let y = y0; y < y1; y++) {
        let offset = (y * width + x0) * channels;
        for (let x = x0; x < x1; x++) {
          sumR += data[offset];
          sumG += data[offset + 1];
          sumB += data[offset + 2];
          offset += channels;
          count++;
        }
      }

      const index = row * cols + col;
      const r = Math.round(sumR / count);
      const g = Math.round(sumG / count);
      const b = Math.round(sumB / count);

      cells[index] = { char: '', r, g, b };
      luminances[index] = luminance(r, g, b) / 255;
    }
  }

  // Pass 2: remap luminance through the levels, then down the ramp. The black
  // and white points need the whole histogram, which is why this is separate.
  const [lo, hi] = levels === 'auto' ? autoLevels(luminances) : levels;
  const span = hi - lo || 1;
  const maxIndex = ramp.length - 1;

  for (let i = 0; i < total; i++) {
    let t = clamp((luminances[i] - lo) / span, 0, 1);
    if (gamma !== 1) t = Math.pow(t, gamma);
    if (invert) t = 1 - t;
    cells[i].char = ramp[clamp(Math.round(t * maxIndex), 0, maxIndex)];
  }

  return { cols, rows, cells, levels: [lo, hi] };
}

async function convert(inputPath, options) {
  // Drop undefined entries first: spreading them would clobber the defaults
  // with undefined rather than falling back to them.
  const provided = Object.fromEntries(
    Object.entries(options || {}).filter(([, value]) => value !== undefined)
  );

  const opts = {
    cols: 110,
    ramp: DEFAULT_RAMP,
    gamma: 1,
    invert: false,
    cellAspect: CELL_ASPECT,
    levels: 'auto',
    background: DEFAULT_BACKGROUND,
    ...provided,
  };

  const ramp = RAMPS[opts.ramp] || opts.ramp;
  if (typeof ramp !== 'string' || ramp.length < 2) {
    throw new Error(
      `Unknown ramp "${opts.ramp}". Known: ${Object.keys(RAMPS).join(', ')}`
    );
  }

  const pixels = await loadPixels(inputPath, opts.background);
  const grid = buildGrid(pixels, { ...opts, ramp });

  return {
    cols: grid.cols,
    rows: grid.rows,
    cells: grid.cells,
    meta: {
      source: path.basename(inputPath),
      sourceWidth: pixels.width,
      sourceHeight: pixels.height,
      ramp: opts.ramp,
      cellAspect: opts.cellAspect,
      gamma: opts.gamma,
      invert: opts.invert,
      levels: grid.levels.map((v) => Number(v.toFixed(4))),
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
    let value = eq === -1 ? undefined : token.slice(eq + 1);
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i++;
      } else {
        value = true;
      }
    }
    args[key] = value;
  }
  return args;
}

const USAGE = `
kokomoji convert — image to ASCII grid JSON

  node scripts/convert.js <image> [options]

Options
  --cols <n>        Grid width in characters             (default 110)
  --out <file>      Output path                          (default <image>.json)
  --ramp <name>     ${Object.keys(RAMPS).join(' | ')}, or a literal ramp string
  --gamma <n>       Tone curve on luminance, >1 darkens  (default 1)
  --invert          Flip the ramp (bright source -> sparse chars)
  --cell-aspect <n> Terminal cell height:width           (default ${CELL_ASPECT})
  --levels <lo,hi>  Black and white point as 0-1 luminance, e.g. 0.08,0.5
  --no-levels       Disable the automatic black/white point
  --packed          Emit the compact blob format (~7x smaller, lossless)
  --preview         Also print the grid to stdout in truecolor
`;

/** Render a grid to a truecolor ANSI string. */
function renderAnsi(grid) {
  const ESC = '\x1b';
  const lines = [];
  for (let row = 0; row < grid.rows; row++) {
    let line = '';
    let last = '';
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[row * grid.cols + col];
      const color = `${cell.r};${cell.g};${cell.b}`;
      // Only re-emit the colour when it actually changes; large flat areas of
      // background collapse to a single escape.
      if (color !== last) {
        line += `${ESC}[38;2;${color}m`;
        last = color;
      }
      line += cell.char;
    }
    lines.push(line + `${ESC}[0m`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];

  if (!input || args.help) {
    process.stdout.write(USAGE);
    process.exit(input ? 0 : 1);
  }

  if (!fs.existsSync(input)) {
    console.error(`convert: no such file: ${input}`);
    process.exit(1);
  }

  // A flag given without a value parses as `true`; treat that as "not set"
  // rather than letting NaN through into the grid maths.
  const num = (value) => {
    const parsed = typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  // --levels lo,hi | --no-levels | (default) auto
  let levels;
  if (args['no-levels']) {
    levels = [0, 1];
  } else if (typeof args.levels === 'string') {
    const parts = args.levels.split(',').map(Number);
    if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) {
      console.error(`convert: --levels wants "lo,hi", got "${args.levels}"`);
      process.exit(1);
    }
    levels = parts;
  }

  const grid = await convert(input, {
    levels,
    cols: num(args.cols),
    ramp: typeof args.ramp === 'string' ? args.ramp : undefined,
    gamma: num(args.gamma),
    invert: args.invert ? true : undefined,
    cellAspect: num(args['cell-aspect']),
  });

  const outPath =
    typeof args.out === 'string'
      ? args.out
      : `${path.basename(input, path.extname(input))}.json`;

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(args.packed ? pack(grid) : grid));

  if (args.preview) process.stdout.write(renderAnsi(grid) + '\n');

  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  const [lo, hi] = grid.meta.levels;
  console.error(
    `convert: ${grid.cols}x${grid.rows} (${grid.cells.length} cells, ${kb}KB` +
      `${args.packed ? ', packed' : ''}) levels ${lo}-${hi} -> ${outPath}`
  );
}

module.exports = { convert, buildGrid, renderAnsi, luminance, RAMPS, CELL_ASPECT };

if (require.main === module) {
  main().catch((err) => {
    console.error(`convert: ${err.message}`);
    process.exit(1);
  });
}
