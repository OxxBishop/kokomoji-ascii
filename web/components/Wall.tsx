'use client';

import { useEffect, useState } from 'react';
import AsciiCanvas from './AsciiCanvas';
import { CELL_ASPECT, PALETTES, type Grid, type Piece } from '@/lib/grid';

/**
 * Every piece at once, each tile cycling its own palette.
 *
 * Density has to come down in this view. Tiles are a fraction of the width the
 * single view gets, and at the single view's column count the characters fall
 * to a couple of pixels and stop reading as characters at all — the wall would
 * show blurry thumbnails, which is the opposite of the point. Fewer columns
 * means chunkier glyphs, which is what survives at tile size.
 */
function wallColumns(tileCount: number): number {
  return tileCount <= 9 ? 55 : 40;
}

/** Tiles boot in sequence rather than all at once. */
const STAGGER_MS = 140;

interface Props {
  pieces: Piece[];
  load: (file: string) => Promise<Grid>;
  decodeKey: number;
}

export default function Wall({ pieces, load, decodeKey }: Props) {
  const cols = wallColumns(pieces.length);

  return (
    <div
      // An explicit width: the surrounding window is sized to its content, so
      // auto-fit would otherwise have nothing to divide and collapse to one
      // column.
      className="grid w-[min(92vw,68rem)] gap-1.5 bg-koko-bg p-1.5"
      style={{
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
      }}
    >
      {pieces.map((piece, index) => (
        <Tile
          key={piece.id}
          piece={piece}
          targetCols={cols}
          load={load}
          decodeKey={decodeKey}
          decodeDelay={index * STAGGER_MS}
        />
      ))}
    </div>
  );
}

interface TileProps {
  piece: Piece;
  targetCols: number;
  load: (file: string) => Promise<Grid>;
  decodeKey: number;
  decodeDelay: number;
}

function Tile({ piece, targetCols, load, decodeKey, decodeDelay }: TileProps) {
  const [grid, setGrid] = useState<Grid | null>(null);
  // Each tile owns its palette, so clicking one recolours only that one.
  const [paletteIndex, setPaletteIndex] = useState(0);
  const palette = PALETTES[paletteIndex];

  const density = piece.densities.reduce((best, candidate) =>
    Math.abs(candidate.cols - targetCols) < Math.abs(best.cols - targetCols)
      ? candidate
      : best
  );

  useEffect(() => {
    let stale = false;
    load(density.file).then((next) => {
      if (!stale) setGrid(next);
    });
    return () => {
      stale = true;
    };
  }, [density.file, load]);

  return (
    <figure className="m-0 border border-koko-line bg-koko-bg">
      <div
        className="relative"
        style={{
          aspectRatio: grid ? `${grid.cols} / ${grid.rows * CELL_ASPECT}` : '1 / 1',
        }}
      >
        <div className="pointer-events-none absolute inset-0 z-10 bg-scanlines opacity-[0.35]" />
        {grid && (
          <AsciiCanvas
            grid={grid}
            palette={palette}
            decodeKey={decodeKey}
            decodeDelay={decodeDelay}
            onClick={() => setPaletteIndex((i) => (i + 1) % PALETTES.length)}
          />
        )}
      </div>

      <figcaption className="flex items-center justify-between gap-2 border-t border-koko-line px-2 py-1.5 font-mono text-[10px] tracking-wider text-koko-dim">
        <span className="truncate text-koko-text">{piece.title}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <i
            className="size-2 border border-koko-line"
            style={{ background: palette.swatch }}
            aria-hidden
          />
          {palette.label}
        </span>
      </figcaption>
    </figure>
  );
}
