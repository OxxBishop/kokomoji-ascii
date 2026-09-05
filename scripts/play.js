#!/usr/bin/env node
'use strict';

/**
 * KOKOMOJI ASCII toolkit — terminal player.
 *
 *   node scripts/play.js grid.json
 *   node scripts/play.js grid.json --loop --fps 30
 *
 * Renders a grid from convert.js in 24-bit ANSI truecolor, with a decode
 * animation: the frame opens as a field of random characters and resolves to
 * the real image over DECODE_SECONDS, cells landing in random order.
 *
 * Built for screen recording — alternate screen buffer, hidden cursor, the
 * art centred in the viewport, and a clean restore on exit.
 */

const fs = require('fs');
const path = require('path');
const { unpack } = require('./grid-format');

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DECODE_SECONDS = 2.0;
const DEFAULT_FPS = 20;

// Characters the unresolved cells are drawn from before they land.
const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#%$&@01';

// Unresolved cells are drawn in this colour, so the image is not legible
// through the noise before it resolves.
const SCRAMBLE_RGB = [0x4a, 0x33, 0x6b];

const LOOP_PAUSE_SECONDS = 1.4;

// ---------------------------------------------------------------------------
// ANSI
// ---------------------------------------------------------------------------

const ESC = '\x1b';
const CSI = `${ESC}[`;

const ansi = {
  altScreenOn: `${CSI}?1049h`,
  altScreenOff: `${CSI}?1049l`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  home: `${CSI}H`,
  clear: `${CSI}2J`,
  reset: `${CSI}0m`,
  fg: (r, g, b) => `${CSI}38;2;${r};${g};${b}m`,
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Compose one frame.
 *
 * `resolved` is a Uint8Array flag per cell: 1 means draw the real character in
 * its real colour, 0 means draw this cell's scramble character.
 */
function renderFrame(grid, resolved, scramble, padLeft, padTop) {
  const { cols, rows, cells } = grid;
  const pad = ' '.repeat(padLeft);
  const [sr, sg, sb] = SCRAMBLE_RGB;
  const scrambleColor = ansi.fg(sr, sg, sb);

  let out = '\n'.repeat(padTop);

  for (let row = 0; row < rows; row++) {
    let line = pad;
    // Only re-emit a colour escape when the colour actually changes; flat
    // background collapses to one escape per run instead of one per cell.
    let last = '';

    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;

      if (resolved[i]) {
        const cell = cells[i];
        const color = ansi.fg(cell.r, cell.g, cell.b);
        if (color !== last) {
          line += color;
          last = color;
        }
        line += cell.char;
      } else {
        if (scrambleColor !== last) {
          line += scrambleColor;
          last = scrambleColor;
        }
        line += scramble[i];
      }
    }

    out += line + ansi.reset + '\n';
  }

  return out;
}

/** Fisher-Yates, so cells resolve in a genuinely random order. */
function shuffled(length) {
  const order = new Uint32Array(length);
  for (let i = 0; i < length; i++) order[i] = i;
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

function randomScramble(length) {
  const scramble = new Array(length);
  for (let i = 0; i < length; i++) {
    scramble[i] = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
  }
  return scramble;
}

/** Centre the art in the viewport, without going negative on small terminals. */
function layout(grid) {
  const termCols = process.stdout.columns || grid.cols;
  const termRows = process.stdout.rows || grid.rows;
  return {
    padLeft: Math.max(0, Math.floor((termCols - grid.cols) / 2)),
    padTop: Math.max(0, Math.floor((termRows - grid.rows) / 2)),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run one decode pass, from full noise to the finished image. */
async function decode(grid, { fps, instant }) {
  const total = grid.cols * grid.rows;
  const { padLeft, padTop } = layout(grid);

  if (instant) {
    const resolved = new Uint8Array(total).fill(1);
    process.stdout.write(
      ansi.home + renderFrame(grid, resolved, [], padLeft, padTop)
    );
    return;
  }

  const resolved = new Uint8Array(total);
  const scramble = randomScramble(total);
  const order = shuffled(total);

  const frames = Math.max(1, Math.round(DECODE_SECONDS * fps));
  const frameMs = 1000 / fps;
  let cursor = 0;

  for (let frame = 1; frame <= frames; frame++) {
    // Resolve up to the share of cells this frame is responsible for. Using
    // the frame number rather than a fixed batch keeps the last frame exact
    // even when total does not divide evenly.
    const target = Math.round((frame / frames) * total);
    for (; cursor < target; cursor++) resolved[order[cursor]] = 1;

    const started = Date.now();
    process.stdout.write(
      ansi.home + renderFrame(grid, resolved, scramble, padLeft, padTop)
    );

    // Subtract the time spent composing so the animation holds its wall-clock
    // duration on slow terminals instead of stretching out.
    const elapsed = Date.now() - started;
    if (frame < frames) await sleep(Math.max(0, frameMs - elapsed));
  }
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
kokomoji play — terminal player for ASCII grids

  node scripts/play.js <grid.json> [options]

Options
  --instant     Skip the decode animation, paint the finished frame
  --fps <n>     Animation frame rate                     (default ${DEFAULT_FPS})
  --loop        Repeat forever; ctrl-c to stop
  --no-alt      Draw inline instead of on the alternate screen
`;

let usingAltScreen = false;
let restored = false;

function restoreTerminal() {
  if (restored) return;
  restored = true;
  if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false);
  process.stdout.write(ansi.showCursor + ansi.reset);
  if (usingAltScreen) process.stdout.write(ansi.altScreenOff);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];

  if (!input || args.help) {
    process.stdout.write(USAGE);
    process.exit(input ? 0 : 1);
  }

  if (!fs.existsSync(input)) {
    console.error(`play: no such file: ${input}`);
    process.exit(1);
  }

  const grid = unpack(JSON.parse(fs.readFileSync(input, 'utf8')));
  if (!grid.cells || !grid.cols || !grid.rows) {
    console.error(`play: ${path.basename(input)} is not a grid produced by convert.js`);
    process.exit(1);
  }

  const fps = Number(args.fps) > 0 ? Number(args.fps) : DEFAULT_FPS;
  const instant = Boolean(args.instant);
  const loop = Boolean(args.loop);
  usingAltScreen = !args['no-alt'];

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      restoreTerminal();
      process.exit(0);
    });
  }
  process.on('exit', restoreTerminal);

  if (usingAltScreen) process.stdout.write(ansi.altScreenOn);
  process.stdout.write(ansi.hideCursor + ansi.clear);

  do {
    process.stdout.write(ansi.clear);
    await decode(grid, { fps, instant });
    if (loop) await sleep(LOOP_PAUSE_SECONDS * 1000);
  } while (loop);

  if (usingAltScreen && process.stdin.isTTY) {
    // Hold the finished frame on the alternate screen until a keypress,
    // otherwise the recording ends on a flash of the old shell. Only when
    // stdin is a terminal — piped input would never deliver that keypress.
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();
    await new Promise((resolve) => process.stdin.once('data', resolve));
  }

  restoreTerminal();
}

if (require.main === module) {
  main().catch((err) => {
    restoreTerminal();
    console.error(`play: ${err.message}`);
    process.exit(1);
  });
}
