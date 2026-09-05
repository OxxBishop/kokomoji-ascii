'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsciiCanvas from './AsciiCanvas';
import {
  CELL_ASPECT,
  PALETTES,
  unpack,
  type Grid,
  type Manifest,
  type PackedGrid,
} from '@/lib/grid';

const SLIDER_MIN = 40;
const SLIDER_MAX = 140;

interface Props {
  manifest: Manifest;
}

export default function Studio({ manifest }: Props) {
  const [pieceIndex, setPieceIndex] = useState(0);
  const [requestedCols, setRequestedCols] = useState(85);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [decodeKey, setDecodeKey] = useState(0);
  const [grid, setGrid] = useState<Grid | null>(null);

  const cache = useRef(new Map<string, Grid>());
  const piece = manifest.pieces[pieceIndex];
  const palette = PALETTES[paletteIndex];

  // The slider moves freely across 40-140 but only pregenerated densities
  // exist, so snap to the nearest one. Showing both numbers makes the
  // quantisation visible instead of mysterious.
  const density = useMemo(() => {
    return piece.densities.reduce((best, candidate) =>
      Math.abs(candidate.cols - requestedCols) < Math.abs(best.cols - requestedCols)
        ? candidate
        : best
    );
  }, [piece, requestedCols]);

  const load = useCallback(async (file: string): Promise<Grid> => {
    const cached = cache.current.get(file);
    if (cached) return cached;

    const response = await fetch(`/grids/${file}`);
    if (!response.ok) throw new Error(`failed to load ${file}`);

    const unpacked = unpack((await response.json()) as PackedGrid);
    cache.current.set(file, unpacked);
    return unpacked;
  }, []);

  // Swap in the current density.
  useEffect(() => {
    let stale = false;
    load(density.file).then((next) => {
      if (!stale) setGrid(next);
    });
    return () => {
      stale = true;
    };
  }, [density, load]);

  // Warm every density for this piece so dragging the slider never stalls.
  // The whole set is well under 200KB.
  useEffect(() => {
    piece.densities.forEach((entry) => void load(entry.file).catch(() => {}));
  }, [piece, load]);

  const cyclePalette = () => setPaletteIndex((index) => (index + 1) % PALETTES.length);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-6">
      {/* The window hugs the art, so this wrapper takes its width from the
          canvas rather than stretching to an arbitrary max-width. */}
      <div className="flex w-fit max-w-full flex-col gap-4">
        <Header />

        <section className="flex flex-col border border-koko-line bg-koko-panel shadow-[0_0_60px_-15px_rgba(232,100,30,0.25)]">
          <TitleBar
            title={piece.title}
            right={grid ? `${grid.cols}×${grid.rows}` : '—'}
          />

          <div className="flex justify-center overflow-hidden bg-koko-bg p-1.5">
            {/* Height-driven, so the art always fits the viewport and the box
                matches the grid's own aspect instead of letterboxing it. */}
            <div
              className="relative"
              style={{
                aspectRatio: grid
                  ? `${grid.cols} / ${grid.rows * CELL_ASPECT}`
                  : '1 / 1',
                height: 'min(70dvh, 88vw)',
              }}
            >
              <div className="pointer-events-none absolute inset-0 z-10 bg-scanlines opacity-[0.35]" />
              {grid ? (
                <AsciiCanvas
                  grid={grid}
                  palette={palette}
                  decodeKey={decodeKey}
                  onClick={cyclePalette}
                />
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-xs text-koko-dim">
                  LOADING GRID&hellip;
                </div>
              )}
            </div>
          </div>

          <StatusBar
            requestedCols={requestedCols}
            actualCols={density.cols}
            onCols={setRequestedCols}
            paletteLabel={palette.label}
            paletteSwatch={palette.swatch}
            onPalette={cyclePalette}
            onReplay={() => setDecodeKey((key) => key + 1)}
            cells={grid ? grid.cells.length : 0}
          />
        </section>

        {manifest.pieces.length > 1 && (
          <nav className="flex flex-wrap justify-center gap-2 font-mono text-[11px]">
            {manifest.pieces.map((entry, index) => (
              <button
                key={entry.id}
                onClick={() => {
                  setPieceIndex(index);
                  setDecodeKey((key) => key + 1);
                }}
                className={`border px-3 py-1.5 uppercase tracking-widest transition-colors ${
                  index === pieceIndex
                    ? 'border-koko-accent text-koko-accent'
                    : 'border-koko-line text-koko-dim hover:border-koko-dim hover:text-koko-text'
                }`}
              >
                {entry.title}
              </button>
            ))}
          </nav>
        )}

        <Footer manifest={manifest} />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="font-mono">
      <h1 className="text-sm tracking-[0.35em] text-koko-accent">
        KOKOMOJI<span className="text-koko-dim">/</span>ASCII
      </h1>
      <p className="mt-1 text-[11px] tracking-wide text-koko-dim">
        click art &rarr; palette
        <span className="mx-2 text-koko-line">|</span>
        drag density &rarr; resolution
      </p>
    </header>
  );
}

function TitleBar({ title, right }: { title: string; right: string }) {
  return (
    <div className="flex items-center justify-between border-b border-koko-line px-3 py-2 font-mono text-[11px] text-koko-dim">
      <div className="flex items-center gap-2">
        <span className="flex gap-1.5" aria-hidden>
          <i className="size-2 rounded-full bg-koko-accent/70" />
          <i className="size-2 rounded-full bg-koko-line" />
          <i className="size-2 rounded-full bg-koko-line" />
        </span>
        <span className="ml-1 tracking-wider">
          kokomoji@ascii<span className="text-koko-line">:</span>
          <span className="text-koko-text">~/{title.toLowerCase().replace(/\s+/g, '-')}</span>
        </span>
      </div>
      <span className="tabular-nums tracking-wider">{right}</span>
    </div>
  );
}

interface StatusBarProps {
  requestedCols: number;
  actualCols: number;
  onCols: (cols: number) => void;
  paletteLabel: string;
  paletteSwatch: string;
  onPalette: () => void;
  onReplay: () => void;
  cells: number;
}

function StatusBar({
  requestedCols,
  actualCols,
  onCols,
  paletteLabel,
  paletteSwatch,
  onPalette,
  onReplay,
  cells,
}: StatusBarProps) {
  const snapped = requestedCols !== actualCols;

  return (
    <div className="flex flex-col gap-3 border-t border-koko-line px-3 py-3 font-mono text-[11px] text-koko-dim sm:flex-row sm:items-center sm:gap-6">
      <label className="flex flex-1 items-center gap-3">
        <span className="tracking-widest">DENSITY</span>
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={1}
          value={requestedCols}
          onChange={(event) => onCols(Number(event.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-none bg-koko-line accent-koko-accent"
          aria-label="Grid width in columns"
        />
        <span className="w-24 shrink-0 tabular-nums tracking-wider text-koko-text">
          {snapped && <span className="text-koko-line">{requestedCols}&rarr;</span>}
          {actualCols} COLS
        </span>
      </label>

      <div className="flex items-center gap-4">
        <button
          onClick={onPalette}
          className="flex items-center gap-2 tracking-widest transition-colors hover:text-koko-text"
        >
          <i
            className="size-2.5 border border-koko-line"
            style={{ background: paletteSwatch }}
            aria-hidden
          />
          {paletteLabel}
        </button>

        <span className="hidden tabular-nums text-koko-dim/60 sm:inline">
          {cells.toLocaleString()} CELLS
        </span>

        <button
          onClick={onReplay}
          className="tracking-widest transition-colors hover:text-koko-text"
        >
          [REPLAY]
        </button>
      </div>
    </div>
  );
}

function Footer({ manifest }: { manifest: Manifest }) {
  return (
    <footer className="font-mono text-[10px] leading-relaxed tracking-wider text-koko-line">
      {manifest.usingPlaceholder && (
        <p className="mb-1 text-koko-accent/70">
          PLACEHOLDER ART &mdash; add PFPs to art/, run `npm run build:grids`
        </p>
      )}
      <p>
        {manifest.pieces.length} PIECE(S)
        <span className="mx-2">&middot;</span>
        {manifest.densities.length} DENSITIES
        <span className="mx-2">&middot;</span>
        2:1 CELL CORRECTION
      </p>
    </footer>
  );
}
