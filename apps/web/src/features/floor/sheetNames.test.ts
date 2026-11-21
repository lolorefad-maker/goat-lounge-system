import { describe, expect, it } from 'vitest';
import { SHEET_NAME_MAX, withName } from './sheetNames';

describe('withName', () => {
  it('keeps the names typed on the same day', () => {
    const a = withName({ day: null, names: {} }, '2026-11-22', 'ps-1', 'الكبير');
    const b = withName(a, '2026-11-22', 'ps-2', 'جنب الباب');
    expect(b).toEqual({ day: '2026-11-22', names: { 'ps-1': 'الكبير', 'ps-2': 'جنب الباب' } });
  });

  it('starts empty on a new day', () => {
    const old = { day: '2026-11-21', names: { 'ps-1': 'أمس' } };
    expect(withName(old, '2026-11-22', 'ps-2', 'اليوم')).toEqual({ day: '2026-11-22', names: { 'ps-2': 'اليوم' } });
  });

  it('removes a cleared name and caps the length', () => {
    const a = withName({ day: 'd', names: { 'ps-1': 'x' } }, 'd', 'ps-1', '   ');
    expect(a.names).toEqual({});
    expect(withName(a, 'd', 'ps-1', 'a'.repeat(99)).names['ps-1']).toHaveLength(SHEET_NAME_MAX);
  });
});
