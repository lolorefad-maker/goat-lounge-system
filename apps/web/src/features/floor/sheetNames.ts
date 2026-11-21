import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '../../i18n';

/**
 * Names the cashier types for the devices in the sheet's first column. They belong to one working
 * day (the day is the shift): a new day starts with the column empty. Saved on this device; the
 * station's own name (prices, bills, reports) never changes.
 */

export const SHEET_NAME_MAX = 40;
export const NO_NAMES: Readonly<Record<string, string>> = Object.freeze({});

interface SheetNamesState {
  /** The business day the names were typed on. */
  day: string | null;
  names: Record<string, string>;
  setName: (day: string, stationId: string, name: string) => void;
}

/** Applies one typed name; names from an older day are dropped first. Empty input removes the name. */
export function withName(
  state: { day: string | null; names: Record<string, string> },
  day: string,
  stationId: string,
  name: string,
): { day: string; names: Record<string, string> } {
  const names = state.day === day ? { ...state.names } : {};
  const value = name.slice(0, SHEET_NAME_MAX);
  if (value.trim()) names[stationId] = value;
  else delete names[stationId];
  return { day, names };
}

export const useSheetNames = create<SheetNamesState>()(
  persist(
    (set) => ({
      day: null,
      names: {},
      setName: (day, stationId, name) => set((s) => withName(s, day, stationId, name)),
    }),
    {
      name: 'lounge-floor-sheet-names',
      storage: safeStorage,
      partialize: (s) => ({ day: s.day, names: s.names }) as SheetNamesState,
      // Saved data comes from this device's storage: keep only short strings.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SheetNamesState>;
        const names: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.names ?? {})) {
          if (typeof v === 'string' && v.trim()) names[k] = v.slice(0, SHEET_NAME_MAX);
        }
        return { ...current, day: typeof p.day === 'string' ? p.day : null, names };
      },
    },
  ),
);

/** The names typed today (another day's names are not shown). */
export const useTodayNames = (day: string) => useSheetNames((s) => (s.day === day ? s.names : NO_NAMES));
