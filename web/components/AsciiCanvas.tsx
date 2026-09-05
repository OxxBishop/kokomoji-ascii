'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CELL_ASPECT, type Grid, type Palette } from '@/lib/grid';

// Matches scripts/play.js so the terminal and the web decode look the same.
const DECODE_MS = 2000;
const DECODE_FPS = 20;
const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#%$&@01';
const SCRAMBLE_COLOR = '#4a336b';

interface Props {
  grid: Grid;
  palette: Palette;
  /** Bump to replay the decode animation. Density changes should not bump it. */
  decodeKey: number;
  /** Hold on noise this long before resolving, so a wall of tiles can stagger. */
  decodeDelay?: number;
  onClick: () => void;
}

function shuffledOrder(length: number): Uint32Array {
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

export default function AsciiCanvas({
  grid,
  palette,
  decodeKey,
  decodeDelay = 0,
  onClick,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(10);

  // Which cells have landed. The palette effect repaints only these, so
  // switching palettes mid-decode cannot reveal the image early.
  const resolvedRef = useRef<Uint8Array>(new Uint8Array(0));

  // Read these without making them dependencies of the decode effect —
  // otherwise clicking or resizing mid-animation would restart it.
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const gridRefValue = useRef(grid);
  gridRefValue.current = grid;

  const spans = () =>
    (gridRef.current?.children ?? []) as HTMLCollectionOf<HTMLSpanElement>;

  /**
   * Fit the grid to its frame. Character advance width varies by font, so
   * measure 1ch rather than assuming the usual 0.6em.
   */
  const fit = useCallback(() => {
    const frame = frameRef.current;
    const el = gridRef.current;
    if (!frame || !el) return;

    const probe = document.createElement('span');
    probe.style.cssText =
      'position:absolute;visibility:hidden;white-space:pre;font-size:100px';
    probe.style.fontFamily = getComputedStyle(el).fontFamily;
    probe.textContent = '0'.repeat(100);
    document.body.appendChild(probe);
    const chRatio = probe.getBoundingClientRect().width / 100 / 100;
    probe.remove();

    if (!chRatio) return;

    const byWidth = frame.clientWidth / (grid.cols * chRatio);
    const byHeight = frame.clientHeight / (grid.rows * CELL_ASPECT * chRatio);
    setFontSize(Math.max(1, Math.min(byWidth, byHeight)));
  }, [grid.cols, grid.rows]);

  useLayoutEffect(() => {
    fit();
    const observer = new ResizeObserver(fit);
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [fit]);

  // Paint the finished frame whenever the grid itself changes. Sliding the
  // density swaps grids in place; only an explicit replay re-runs the decode.
  useEffect(() => {
    const cells = grid.cells;
    const nodes = spans();
    if (nodes.length !== cells.length) return;

    const resolved = new Uint8Array(cells.length).fill(1);
    resolvedRef.current = resolved;

    for (let i = 0; i < cells.length; i++) {
      nodes[i].textContent = cells[i].char;
      nodes[i].style.color = palette.color(cells[i]);
    }
    // `palette` is deliberately not a dependency — the palette effect below
    // handles recolouring without rewriting every character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid]);

  // Decode: open on a field of noise and resolve cells in random order over
  // DECODE_MS. Spans are mutated directly — re-rendering ~10k React nodes at
  // 20fps would drop frames.
  useEffect(() => {
    const owned = gridRefValue.current;
    const cells = owned.cells;
    const nodes = spans();
    const total = cells.length;
    if (nodes.length !== total) return;

    // Painting the finished frame is the correct decode for reduced motion.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const resolved = new Uint8Array(total);
    resolvedRef.current = resolved;

    const order = shuffledOrder(total);

    for (let i = 0; i < total; i++) {
      nodes[i].textContent =
        SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      nodes[i].style.color = SCRAMBLE_COLOR;
    }

    // The noise is already painted; the delay just holds it there.
    const start = performance.now() + decodeDelay;
    const frameMs = 1000 / DECODE_FPS;
    let lastFrame = -frameMs;
    let cursor = 0;
    let raf = 0;

    const tick = (now: number) => {
      // The grid moved on without us; stop rather than paint stale cells.
      if (gridRefValue.current !== owned) return;

      const elapsed = now - start;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }

      // Step on the animation's own clock, not the display's, so the decode
      // stays chunky at 20fps on a 120Hz screen.
      if (elapsed - lastFrame >= frameMs || elapsed >= DECODE_MS) {
        lastFrame = elapsed;
        const target = Math.round(Math.min(1, elapsed / DECODE_MS) * total);
        for (; cursor < target; cursor++) {
          const i = order[cursor];
          nodes[i].textContent = cells[i].char;
          nodes[i].style.color = paletteRef.current.color(cells[i]);
          resolved[i] = 1;
        }
      }

      if (elapsed < DECODE_MS) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [decodeKey, decodeDelay]);

  // Recolour on palette change — cells that have already landed, only.
  useEffect(() => {
    const nodes = spans();
    const resolved = resolvedRef.current;
    for (let i = 0; i < nodes.length; i++) {
      if (resolved[i]) nodes[i].style.color = palette.color(grid.cells[i]);
    }
  }, [palette, grid]);

  return (
    <div
      ref={frameRef}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      aria-label={`ASCII rendering, ${grid.cols} by ${grid.rows} characters. Activate to cycle palette.`}
      className="flex h-full w-full cursor-pointer items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-koko-accent"
    >
      <div
        ref={gridRef}
        aria-hidden
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: `${CELL_ASPECT}ch`,
          gridTemplateColumns: `repeat(${grid.cols}, 1ch)`,
          gridAutoRows: `${CELL_ASPECT}ch`,
        }}
        className="grid select-none font-mono [contain:layout_paint] [text-rendering:optimizeSpeed]"
      >
        {grid.cells.map((cell, i) => (
          <span key={i}>{cell.char}</span>
        ))}
      </div>
    </div>
  );
}
