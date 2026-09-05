/**
 * Grid loading and palettes.
 *
 * Grids are produced by scripts/convert.js and written by scripts/build-grids.js
 * into public/grids/ in the packed format — one character per cell in a single
 * string, and 3 bytes per cell of RGB as base64. See scripts/grid-format.js.
 */

/**
 * A character cell is twice as tall as it is wide — the same assumption
 * convert.js sampled the source with. Changing one without the other
 * stretches the art.
 */
export const CELL_ASPECT = 2;

export interface Cell {
  char: string;
  r: number;
  g: number;
  b: number;
}

export interface Grid {
  cols: number;
  rows: number;
  cells: Cell[];
}

export interface PackedGrid {
  cols: number;
  rows: number;
  chars: string;
  rgb: string;
  meta?: Record<string, unknown>;
}

export interface Density {
  cols: number;
  rows: number;
  file: string;
}

export interface Piece {
  id: string;
  title: string;
  source: string;
  placeholder: boolean;
  densities: Density[];
}

export interface Manifest {
  generatedAt: string;
  densities: number[];
  usingPlaceholder: boolean;
  pieces: Piece[];
}

/** Packed blobs -> cells. Mirrors unpack() in scripts/grid-format.js. */
export function unpack(packed: PackedGrid): Grid {
  const binary = atob(packed.rgb);
  const chars = Array.from(packed.chars);
  const cells: Cell[] = new Array(chars.length);

  for (let i = 0; i < chars.length; i++) {
    cells[i] = {
      char: chars[i],
      r: binary.charCodeAt(i * 3),
      g: binary.charCodeAt(i * 3 + 1),
      b: binary.charCodeAt(i * 3 + 2),
    };
  }

  return { cols: packed.cols, rows: packed.rows, cells };
}

/** Rec. 709 relative luminance, 0-1. Matches the ramp mapping in convert.js. */
export function luminance(cell: Cell): number {
  return (0.2126 * cell.r + 0.7152 * cell.g + 0.0722 * cell.b) / 255;
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

export interface Palette {
  id: string;
  label: string;
  /** Colour for a cell. */
  color: (cell: Cell) => string;
  /** Swatch shown in the status bar. */
  swatch: string;
  /** True when the palette keeps the source image's hues. */
  sourceColour: boolean;
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return [0, 0, l];

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function fromHsl(h: number, s: number, l: number): string {
  if (s === 0) {
    const v = Math.round(l * 255);
    return `rgb(${v},${v},${v})`;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, h) * 255);
  const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
  return `rgb(${r},${g},${b})`;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Push saturation and lightness while leaving hue alone, so the piece still
 * reads as the source image rather than as a tinted screen.
 */
function shift(satMul: number, contrast: number, lift: number) {
  return (cell: Cell) => {
    const [h, s, l] = toHsl(cell.r, cell.g, cell.b);
    const boosted = clamp01(s * satMul);
    const curved = clamp01((l - 0.5) * contrast + 0.5 + lift);
    return fromHsl(h, boosted, curved);
  };
}

/** Scale a fixed hue by the cell's luminance, with a floor so darks stay lit. */
function phosphor(hue: [number, number, number], floor: number) {
  return (cell: Cell) => {
    const t = floor + (1 - floor) * luminance(cell);
    return `rgb(${Math.round(hue[0] * t)},${Math.round(hue[1] * t)},${Math.round(hue[2] * t)})`;
  };
}

/**
 * The cycle runs image-faithful palettes first — clicking should recolour the
 * piece without turning it into something other than the source art. The
 * single-phosphor terminal looks come last.
 */
export const PALETTES: Palette[] = [
  {
    id: 'source',
    label: 'SOURCE',
    color: (cell) => `rgb(${cell.r},${cell.g},${cell.b})`,
    swatch: '#e8641e',
    sourceColour: true,
  },
  {
    id: 'vivid',
    label: 'VIVID',
    color: shift(1.65, 1.2, 0.02),
    swatch: '#ff5c00',
    sourceColour: true,
  },
  {
    id: 'neon',
    label: 'NEON',
    color: shift(2.2, 1.05, 0.16),
    swatch: '#ff8a3d',
    sourceColour: true,
  },
  {
    id: 'ink',
    label: 'INK',
    // Hue preserved, lightness crushed to two steps: the image survives, the
    // tonal detail moves entirely into the characters.
    color: (cell) => {
      const [h, s] = toHsl(cell.r, cell.g, cell.b);
      const bright = luminance(cell) > 0.4;
      return fromHsl(h, clamp01(s * 1.5), bright ? 0.72 : 0.26);
    },
    swatch: '#b34a12',
    sourceColour: true,
  },
  {
    id: 'green',
    label: 'P1 GREEN',
    color: phosphor([0x36, 0xff, 0x6a], 0.12),
    swatch: '#36ff6a',
    sourceColour: false,
  },
  {
    id: 'amber',
    label: 'P3 AMBER',
    color: phosphor([0xff, 0xb0, 0x00], 0.14),
    swatch: '#ffb000',
    sourceColour: false,
  },
  {
    id: 'bw',
    label: 'HIGH CONTRAST',
    color: (cell) => (luminance(cell) > 0.42 ? '#ffffff' : '#241738'),
    swatch: '#ffffff',
    sourceColour: false,
  },
];
