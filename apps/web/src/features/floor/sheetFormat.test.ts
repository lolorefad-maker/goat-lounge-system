import { describe, expect, it } from 'vitest';
import { FONT_MAX, FONT_MIN, setColProp, stepFont } from './sheetFormat';

describe('stepFont', () => {
  it('moves one step and stops at both ends', () => {
    expect(stepFont(1, 1)).toBe(1.15);
    expect(stepFont(1, -1)).toBe(0.85);
    expect(stepFont(FONT_MIN, -1)).toBe(FONT_MIN);
    expect(stepFont(FONT_MAX, 1)).toBe(FONT_MAX);
  });

  it('starts from 100% when the saved size is unknown', () => {
    expect(stepFont(2.4, 1)).toBe(1.15);
  });
});

describe('setColProp', () => {
  it('sets fill and text independently', () => {
    const a = setColProp({}, 'F', 'fill', 'yellow');
    const b = setColProp(a, 'F', 'text', 'red');
    expect(b).toEqual({ F: { fill: 'yellow', text: 'red' } });
    expect(a).toEqual({ F: { fill: 'yellow' } }); // not mutated
  });

  it('drops a column once it has no color left', () => {
    const a = setColProp({ F: { fill: 'yellow' }, J: { text: 'blue' } }, 'F', 'fill', null);
    expect(a).toEqual({ J: { text: 'blue' } });
  });
});
