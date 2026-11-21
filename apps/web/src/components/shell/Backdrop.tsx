import type { CSSProperties } from 'react';

type Shape = 'x' | 'triangle' | 'circle' | 'square';

/** Where each floating shape lives and how it drifts. Fixed values: the same calm picture on every device. */
const SHAPES: {
  shape: Shape;
  top: number;
  left: number;
  size: number;
  dur: number;
  delay: number;
  dx: number;
  dy: number;
  rot: number;
  alt?: boolean;
}[] = [
  { shape: 'x', top: 8, left: 12, size: 46, dur: 26, delay: -4, dx: 40, dy: 70, rot: 160 },
  { shape: 'triangle', top: 18, left: 78, size: 58, dur: 32, delay: -12, dx: -50, dy: 60, rot: -120, alt: true },
  { shape: 'x', top: 62, left: 88, size: 38, dur: 22, delay: -8, dx: -30, dy: -80, rot: 200, alt: true },
  { shape: 'triangle', top: 74, left: 20, size: 50, dur: 28, delay: -16, dx: 60, dy: -50, rot: 140 },
  { shape: 'circle', top: 40, left: 6, size: 34, dur: 30, delay: -2, dx: 50, dy: 40, rot: 0, alt: true },
  { shape: 'x', top: 86, left: 58, size: 42, dur: 24, delay: -18, dx: -40, dy: -60, rot: -180 },
  { shape: 'triangle', top: 6, left: 46, size: 40, dur: 34, delay: -6, dx: 30, dy: 80, rot: 100, alt: true },
  { shape: 'square', top: 48, left: 64, size: 32, dur: 27, delay: -10, dx: -60, dy: 30, rot: 90 },
  { shape: 'x', top: 30, left: 34, size: 30, dur: 36, delay: -20, dx: 50, dy: -40, rot: 220, alt: true },
  { shape: 'triangle', top: 56, left: 40, size: 36, dur: 25, delay: -14, dx: -40, dy: 50, rot: -160 },
  { shape: 'circle', top: 90, left: 92, size: 28, dur: 29, delay: -7, dx: -50, dy: -30, rot: 0 },
  { shape: 'x', top: 70, left: 2, size: 34, dur: 31, delay: -22, dx: 40, dy: -70, rot: 120, alt: true },
];

function ShapeSvg({ shape }: { shape: Shape }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" className="size-full">
      {shape === 'x' && <path d="M8 8l24 24M32 8L8 32" />}
      {shape === 'triangle' && <path d="M20 6l15 26H5z" />}
      {shape === 'circle' && <circle cx="20" cy="20" r="14" />}
      {shape === 'square' && <rect x="7" y="7" width="26" height="26" rx="2" />}
    </svg>
  );
}

/**
 * The app's background: the GOAT logo as a faint watermark and the controller shapes (✕ △ ○ □)
 * drifting slowly behind the content. Decorative only — hidden from screen readers, never takes a
 * click, and still (no motion) for people who ask for reduced motion.
 */
export function Backdrop() {
  return (
    <div className="goat-backdrop no-print" aria-hidden>
      <img src="/logo.png" alt="" className="goat-watermark" draggable={false} />
      {SHAPES.map((s, i) => (
        <span
          key={i}
          className={s.alt ? 'goat-shape goat-shape-alt' : 'goat-shape'}
          style={
            {
              top: `${s.top}%`,
              left: `${s.left}%`,
              width: s.size,
              height: s.size,
              '--dur': `${s.dur}s`,
              '--delay': `${s.delay}s`,
              '--dx': `${s.dx}px`,
              '--dy': `${s.dy}px`,
              '--rot': `${s.rot}deg`,
            } as CSSProperties
          }
        >
          <ShapeSvg shape={s.shape} />
        </span>
      ))}
    </div>
  );
}
