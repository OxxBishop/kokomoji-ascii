#!/usr/bin/env node
'use strict';

/**
 * Readability report for every piece, at the density where it is most likely
 * to break down.
 *
 *   node scripts/check-grids.js [--cols 40]
 *
 * The thing that fails at low density is not the silhouette, which survives
 * almost anything, but the small dark features inside the bright face-screen —
 * the eyes and the mouth. Those read because they are BLANK cells surrounded
 * by dense ones. If a piece has thinner linework or lower contrast than the
 * rest, its auto-levels white point lands somewhere else and those features
 * fill in, so the face becomes one solid block.
 *
 * So: find the brightest region, and measure how much of it is punched out.
 */

const path = require('path');
const { convert, RAMPS, CELL_ASPECT } = require('./convert');

const DEFAULT_COLS = 40;

// Below this share of blank cells inside the bright region, the dark features
// have filled in and the face is reading as one mass.
const MIN_PUNCHED = 0.04;

function analyse(grid, ramp) {
  const { cols, rows, cells } = grid;
  const blank = ramp[0];
  const dense = new Set(ramp.slice(Math.ceil(ramp.length * 0.7)));

  // The face-screen is the largest concentration of dense cells. Take its
  // bounding box and look at what sits inside it.
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!dense.has(cells[row * cols + col].char)) continue;
      if (col < minX) minX = col;
      if (col > maxX) maxX = col;
      if (row < minY) minY = row;
      if (row > maxY) maxY = row;
    }
  }

  if (maxX < 0) return { punched: 0, region: 0, blankTotal: 0 };

  let region = 0;
  let punched = 0;
  for (let row = minY; row <= maxY; row++) {
    for (let col = minX; col <= maxX; col++) {
      region++;
      if (cells[row * cols + col].char === blank) punched++;
    }
  }

  const blankTotal = cells.filter((cell) => cell.char === blank).length;
  return { punched: punched / region, region, blankTotal: blankTotal / cells.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const colsArg = argv.indexOf('--cols');
  const cols = colsArg === -1 ? DEFAULT_COLS : Number(argv[colsArg + 1]);

  const { imagesIn, ART_DIR, PLACEHOLDER_DIR } = require('./build-grids');
  let sources = imagesIn(ART_DIR);
  if (sources.length === 0) sources = imagesIn(PLACEHOLDER_DIR);

  if (sources.length === 0) {
    console.error('check-grids: no images in art/');
    process.exit(1);
  }

  const ramp = RAMPS.standard;
  console.log(`Readability at --cols ${cols}\n`);
  console.log('piece                     levels        aspect   blank   punched');
  console.log('-'.repeat(70));

  let failures = 0;

  for (const source of sources) {
    const grid = await convert(source, { cols });
    const { punched, blankTotal } = analyse(grid, ramp);

    // A 1:1 source must give rows = cols / CELL_ASPECT, or the head is an egg.
    const expected = Math.round(
      (grid.meta.sourceHeight / grid.meta.sourceWidth) * (cols / CELL_ASPECT)
    );
    const aspectOk = grid.rows === expected;

    const [lo, hi] = grid.meta.levels;
    const flag = punched < MIN_PUNCHED ? '  <- features filling in' : '';
    if (!aspectOk || punched < MIN_PUNCHED) failures++;

    console.log(
      `${path.basename(source).padEnd(24)} ` +
        `${`${lo.toFixed(3)}-${hi.toFixed(3)}`.padEnd(13)} ` +
        `${(aspectOk ? 'ok' : `BAD ${grid.rows}!=${expected}`).padEnd(8)} ` +
        `${`${(blankTotal * 100).toFixed(0)}%`.padStart(5)}   ` +
        `${`${(punched * 100).toFixed(1)}%`.padStart(6)}${flag}`
    );
  }

  console.log(
    `\nlevels are chosen per image from its own histogram — differing values ` +
      `across\npieces is the tuning working, not drifting.`
  );

  if (failures) {
    console.log(
      `\n${failures} piece(s) need attention. For one that is filling in, try a ` +
        `higher\nwhite point: --levels <lo>,<higher hi>, or --ramp detailed for more steps.`
    );
    process.exitCode = 1;
  } else {
    console.log('\nall pieces pass.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`check-grids: ${err.message}`);
    process.exit(1);
  });
}
