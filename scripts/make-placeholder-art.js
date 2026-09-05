#!/usr/bin/env node
'use strict';

/**
 * Generates a stand-in KOKOMOJI PFP into art/placeholder/.
 *
 * This exists so the toolkit and the web build are runnable in a fresh clone
 * with no source art committed. It is NOT real KOKOMOJI art — it is a
 * synthetic approximation of the format: 1:1, dark purple dot-matrix ground,
 * solid orange head silhouette running off the bottom of the frame, a cream
 * brow plate carrying emoji badges, mechanical greebles down one flank, and a
 * large high-contrast white face-screen with black pixel eyes and mouth.
 *
 * Drop real PFPs into art/ and build-grids.js ignores this entirely.
 *
 * Geometry is written in fractions of the canvas so the proportions stay
 * readable and the native resolution can change without retuning every number.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'art', 'placeholder');
const N = 160; // pixel-art native resolution
const SCALE = 8; // -> 1280x1280, nearest-neighbour, so pixels stay square

const PURPLE = [0x1a, 0x10, 0x29];
const PURPLE_DOT = [0x2b, 0x1b, 0x40];
const ORANGE = [0xe8, 0x64, 0x1e];
const ORANGE_LIT = [0xf5, 0xa1, 0x76];
const CREAM = [0xf0, 0xdc, 0xc4];
const WHITE = [0xff, 0xff, 0xff];
const BLACK = [0x0d, 0x0d, 0x0d];
const BLUE = [0x2f, 0x6f, 0xd8];
const RED = [0xd8, 0x2f, 0x2f];
const GREEN = [0x2f, 0xa8, 0x55];
const YELLOW = [0xf2, 0xc4, 0x33];
const STEEL = [0x8b, 0x8f, 0x96];
const STEEL_DARK = [0x35, 0x38, 0x3d];
const CABLE = [0x22, 0x22, 0x26];

// --- drawing -------------------------------------------------------------

function canvas(n, [r, g, b]) {
  const buf = Buffer.alloc(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return buf;
}

function makeBrush(buf, n) {
  const px = (x, y, color) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = (y * n + x) * 3;
    buf[i] = color[0];
    buf[i + 1] = color[1];
    buf[i + 2] = color[2];
  };

  // All coordinates are fractions of the canvas.
  const u = (v) => v * n;

  const rect = (x, y, w, h, color) => {
    const x0 = Math.round(u(x));
    const y0 = Math.round(u(y));
    for (let dy = 0; dy < Math.round(u(h)); dy++) {
      for (let dx = 0; dx < Math.round(u(w)); dx++) px(x0 + dx, y0 + dy, color);
    }
  };

  const disc = (cx, cy, r, color) => {
    const x = u(cx);
    const y = u(cy);
    const rad = u(r);
    for (let dy = Math.floor(y - rad); dy <= y + rad; dy++) {
      for (let dx = Math.floor(x - rad); dx <= x + rad; dx++) {
        if ((dx - x) ** 2 + (dy - y) ** 2 <= rad * rad) px(dx, dy, color);
      }
    }
  };

  /** Thick line, for cables and antennae. */
  const stroke = (x0, y0, x1, y1, width, color) => {
    const steps = Math.ceil(Math.hypot(u(x1 - x0), u(y1 - y0)) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, color);
    }
  };

  return { px, rect, disc, stroke };
}

/** A small round emoji badge: two eyes and a mouth. */
function badge(brush, cx, cy, r, face, ink = BLACK) {
  brush.disc(cx, cy, r, face);
  const eye = r * 0.26;
  brush.rect(cx - r * 0.48, cy - r * 0.3, eye, eye * 1.9, ink);
  brush.rect(cx + r * 0.22, cy - r * 0.3, eye, eye * 1.9, ink);
  brush.rect(cx - r * 0.34, cy + r * 0.34, r * 0.68, eye, ink);
}

function buildHead() {
  const buf = canvas(N, PURPLE);
  const brush = makeBrush(buf, N);
  const { px, rect, disc, stroke } = brush;

  // Dot-matrix ground.
  for (let y = 0; y < N; y += 3) {
    for (let x = 0; x < N; x += 3) px(x, y, PURPLE_DOT);
  }

  // Antenna rod running off the top-left, with a lit edge.
  stroke(0.36, 0.2, 0.06, 0.02, 0.055, ORANGE);
  stroke(0.35, 0.185, 0.05, 0.005, 0.02, ORANGE_LIT);

  // Cable looping over the crown.
  stroke(0.18, 0.28, 0.2, 0.13, 0.035, CABLE);
  stroke(0.2, 0.13, 0.42, 0.05, 0.035, CABLE);
  stroke(0.56, 0.04, 0.72, 0.05, 0.03, CABLE);
  stroke(0.72, 0.05, 0.76, 0.16, 0.03, CABLE);

  // Head: a capsule so the silhouette runs off the bottom of the frame.
  disc(0.53, 0.42, 0.4, ORANGE);
  rect(0.13, 0.42, 0.8, 0.58, ORANGE);

  // Pointed ear, upper right.
  disc(0.71, 0.13, 0.05, ORANGE);
  rect(0.66, 0.13, 0.1, 0.12, ORANGE);

  // Cream brow plate across the upper right.
  rect(0.47, 0.2, 0.38, 0.16, CREAM);

  // Mechanical greebles down the left flank.
  for (const [x, y, w, h] of [
    [0.21, 0.4, 0.1, 0.09],
    [0.19, 0.53, 0.07, 0.06],
    [0.24, 0.63, 0.08, 0.07],
    [0.28, 0.73, 0.06, 0.05],
    [0.17, 0.47, 0.05, 0.04],
  ]) {
    rect(x, y, w, h, STEEL);
    rect(x + 0.008, y + 0.008, w - 0.016, h - 0.016, STEEL_DARK);
  }

  // Badges on the brow plate and shell.
  badge(brush, 0.66, 0.29, 0.055, BLUE, WHITE);
  badge(brush, 0.55, 0.33, 0.035, BLUE, WHITE);
  badge(brush, 0.38, 0.37, 0.05, BLUE, WHITE);
  badge(brush, 0.79, 0.36, 0.026, BLUE, WHITE);
  badge(brush, 0.84, 0.41, 0.024, BLUE, WHITE);
  badge(brush, 0.58, 0.4, 0.022, RED);
  badge(brush, 0.68, 0.4, 0.024, GREEN);
  badge(brush, 0.76, 0.41, 0.022, GREEN);

  // Boxed yellow badge and a red/white plate on the left.
  rect(0.17, 0.41, 0.11, 0.1, STEEL);
  badge(brush, 0.225, 0.46, 0.035, YELLOW);
  disc(0.26, 0.6, 0.06, WHITE);
  rect(0.22, 0.55, 0.05, 0.09, RED);

  // Face screen.
  disc(0.63, 0.59, 0.245, WHITE);

  // Left eye: a black block with a white slit through it.
  rect(0.46, 0.42, 0.12, 0.14, BLACK);
  rect(0.46, 0.475, 0.12, 0.028, WHITE);

  // Right eye: a tall arch with a notch out of the bottom.
  rect(0.72, 0.42, 0.115, 0.15, BLACK);
  rect(0.755, 0.53, 0.045, 0.04, WHITE);

  // Nose chevron.
  rect(0.655, 0.6, 0.02, 0.022, BLACK);
  rect(0.635, 0.62, 0.02, 0.022, BLACK);
  rect(0.675, 0.62, 0.02, 0.022, BLACK);

  // Mouth.
  rect(0.62, 0.69, 0.11, 0.038, BLACK);

  // Cheek badges sitting on the screen.
  rect(0.45, 0.635, 0.03, 0.03, RED);
  rect(0.485, 0.63, 0.075, 0.05, GREEN);
  rect(0.5, 0.645, 0.016, 0.018, BLACK);
  rect(0.53, 0.645, 0.016, 0.018, BLACK);
  rect(0.79, 0.63, 0.065, 0.05, RED);
  rect(0.805, 0.645, 0.015, 0.018, BLACK);
  rect(0.832, 0.645, 0.015, 0.018, BLACK);

  // Body coil at the bottom edge.
  for (let i = 0; i < 6; i++) rect(0.5, 0.9 + i * 0.017, 0.14, 0.008, RED);

  return buf;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, 'kokomoji-placeholder.png');

  await sharp(buildHead(), { raw: { width: N, height: N, channels: 3 } })
    .resize(N * SCALE, N * SCALE, { kernel: 'nearest' })
    .png()
    .toFile(file);

  console.error(
    `placeholder: ${N * SCALE}x${N * SCALE} -> ${path.relative(process.cwd(), file)}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`placeholder: ${err.message}`);
    process.exit(1);
  });
}
