'use strict';

/**
 * Grid serialisation.
 *
 * The canonical format is one object per cell:
 *
 *   { cols, rows, cells: [{ char, r, g, b }, ...] }
 *
 * which is readable but costs ~35 bytes per cell — a 140-column grid runs to
 * 340KB, and the web build ships several densities of several images. The
 * packed format stores the same data losslessly as two flat blobs:
 *
 *   { cols, rows, chars: "....", rgb: "<base64>" }
 *
 * `chars` is one character per cell in row-major order; `rgb` is base64 over
 * 3 bytes per cell in the same order. That is ~4 bytes per cell before
 * transport compression — around 7x smaller, with identical pixels out.
 */

/** Canonical cells -> packed blobs. */
function pack(grid) {
  const { cols, rows, cells } = grid;
  const chars = new Array(cells.length);
  const rgb = Buffer.allocUnsafe(cells.length * 3);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    chars[i] = cell.char;
    rgb[i * 3] = cell.r;
    rgb[i * 3 + 1] = cell.g;
    rgb[i * 3 + 2] = cell.b;
  }

  return {
    cols,
    rows,
    chars: chars.join(''),
    rgb: rgb.toString('base64'),
    ...(grid.meta ? { meta: grid.meta } : {}),
  };
}

/** Packed blobs -> canonical cells. Passes an already-canonical grid through. */
function unpack(grid) {
  if (Array.isArray(grid.cells)) return grid;

  const rgb = Buffer.from(grid.rgb, 'base64');
  const chars = Array.from(grid.chars);
  const cells = new Array(chars.length);

  for (let i = 0; i < chars.length; i++) {
    cells[i] = {
      char: chars[i],
      r: rgb[i * 3],
      g: rgb[i * 3 + 1],
      b: rgb[i * 3 + 2],
    };
  }

  return { cols: grid.cols, rows: grid.rows, cells, ...(grid.meta ? { meta: grid.meta } : {}) };
}

module.exports = { pack, unpack };
