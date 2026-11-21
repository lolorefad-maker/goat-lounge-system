import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '../../i18n';

/**
 * Look of the floor sheet (Google Sheet view), per device: text size of the whole grid and a
 * fill / text color per column. Display only — nothing here touches money or the server.
 */

export const SHEET_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const;
export type SheetCol = (typeof SHEET_COLS)[number];

/** Hues a column can take. Each maps to a `--pal-*` token in styles/index.css. */
export const FILL_HUES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'brown', 'gray'] as const;
/** Text adds `ink` (the theme's main text color: black in light, white in dark). */
export const TEXT_HUES = ['ink', ...FILL_HUES] as const;
export type Hue = (typeof TEXT_HUES)[number];

/** Text size steps of the grid (1 = as designed). */
export const FONT_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75] as const;
export const FONT_MIN = FONT_STEPS[0];
export const FONT_MAX = FONT_STEPS[5];

export interface ColFormat {
  fill?: Hue;
  text?: Hue;
}

/** Next text size step up (+1) or down (−1); an unknown saved value starts from 1. */
export function stepFont(scale: number, dir: 1 | -1): number {
  const i = FONT_STEPS.indexOf(scale as (typeof FONT_STEPS)[number]);
  const from = i === -1 ? FONT_STEPS.indexOf(1) : i;
  const next = Math.min(FONT_STEPS.length - 1, Math.max(0, from + dir));
  return FONT_STEPS[next]!;
}

/** Sets one property of a column; `null` removes it, and an empty column is dropped. */
export function setColProp(
  cols: Partial<Record<SheetCol, ColFormat>>,
  col: SheetCol,
  key: keyof ColFormat,
  hue: Hue | null,
): Partial<Record<SheetCol, ColFormat>> {
  const cur: ColFormat = { ...cols[col] };
  if (hue) cur[key] = hue;
  else delete cur[key];
  const out = { ...cols };
  if (cur.fill || cur.text) out[col] = cur;
  else delete out[col];
  return out;
}

const isHue = (v: unknown): v is Hue => typeof v === 'string' && (TEXT_HUES as readonly string[]).includes(v);

interface SheetFormatState {
  fontScale: number;
  cols: Partial<Record<SheetCol, ColFormat>>;
  bigger: () => void;
  smaller: () => void;
  resetFont: () => void;
  setFill: (col: SheetCol, hue: Hue | null) => void;
  setText: (col: SheetCol, hue: Hue | null) => void;
  resetAll: () => void;
}

export const useSheetFormat = create<SheetFormatState>()(
  persist(
    (set) => ({
      fontScale: 1,
      cols: {},
      bigger: () => set((s) => ({ fontScale: stepFont(s.fontScale, 1) })),
      smaller: () => set((s) => ({ fontScale: stepFont(s.fontScale, -1) })),
      resetFont: () => set({ fontScale: 1 }),
      setFill: (col, hue) => set((s) => ({ cols: setColProp(s.cols, col, 'fill', hue === 'ink' ? null : hue) })),
      setText: (col, hue) => set((s) => ({ cols: setColProp(s.cols, col, 'text', hue) })),
      resetAll: () => set({ fontScale: 1, cols: {} }),
    }),
    {
      name: 'lounge-floor-sheet-format',
      storage: safeStorage,
      partialize: (s) => ({ fontScale: s.fontScale, cols: s.cols }) as SheetFormatState,
      // Saved data comes from this device's storage: keep only values the sheet knows.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SheetFormatState>;
        const fontScale = (FONT_STEPS as readonly number[]).includes(p.fontScale as number) ? (p.fontScale as number) : 1;
        const cols: Partial<Record<SheetCol, ColFormat>> = {};
        for (const col of SHEET_COLS) {
          const c = p.cols?.[col];
          if (!c) continue;
          const fill = isHue(c.fill) && c.fill !== 'ink' ? c.fill : undefined;
          const text = isHue(c.text) ? c.text : undefined;
          if (fill || text) cols[col] = { ...(fill && { fill }), ...(text && { text }) };
        }
        return { ...current, fontScale, cols };
      },
    },
  ),
);
