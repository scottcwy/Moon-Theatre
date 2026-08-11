import { describe, expect, it } from 'vitest';
import { parsePositiveInteger } from '../pagination.js';

describe('parsePositiveInteger', () => {
  it('parses plain positive integers', () => {
    expect(parsePositiveInteger('12', 1)).toBe(12);
    expect(parsePositiveInteger(' 5 ', 1)).toBe(5);
  });

  it('falls back when the value is not a pure number (trailing garbage)', () => {
    expect(parsePositiveInteger('12abc', 50)).toBe(50);
  });

  it('falls back for non-numeric, negative, zero, float and exponent forms', () => {
    expect(parsePositiveInteger('abc', 50)).toBe(50);
    expect(parsePositiveInteger('-3', 50)).toBe(50);
    expect(parsePositiveInteger('0', 50)).toBe(50);
    expect(parsePositiveInteger('1.5', 50)).toBe(50);
    expect(parsePositiveInteger('1e3', 50)).toBe(50);
  });

  it('falls back for null and empty input', () => {
    expect(parsePositiveInteger(null, 50)).toBe(50);
    expect(parsePositiveInteger('', 50)).toBe(50);
    expect(parsePositiveInteger('   ', 50)).toBe(50);
  });
});
