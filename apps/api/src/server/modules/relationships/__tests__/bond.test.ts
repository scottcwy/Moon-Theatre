import { describe, it, expect } from 'vitest';
import { calculateBondLevel, calculateBondExpForNextLevel } from '../service.js';

describe('calculateBondLevel', () => {
  it('returns level 1 at 0 exp', () => {
    expect(calculateBondLevel(0)).toBe(1);
  });

  it('returns level 1 below 100 exp', () => {
    expect(calculateBondLevel(50)).toBe(1);
    expect(calculateBondLevel(99)).toBe(1);
  });

  it('returns level 2 at exactly 100 exp', () => {
    expect(calculateBondLevel(100)).toBe(2);
  });

  it('returns level 2 between 100 and 199 exp', () => {
    expect(calculateBondLevel(150)).toBe(2);
    expect(calculateBondLevel(199)).toBe(2);
  });

  it('returns level 3 at 200 exp', () => {
    expect(calculateBondLevel(200)).toBe(3);
  });

  it('caps at MAX_LEVEL (10)', () => {
    expect(calculateBondLevel(900)).toBe(10);
    expect(calculateBondLevel(5000)).toBe(10);
  });

  it('level progression is monotonic', () => {
    const levels: number[] = [];
    for (let exp = 0; exp <= 950; exp += 100) {
      levels.push(calculateBondLevel(exp));
    }
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!);
    }
  });
});

describe('calculateBondExpForNextLevel', () => {
  it('returns 100 for level 1 to reach level 2', () => {
    expect(calculateBondExpForNextLevel(1)).toBe(100);
  });

  it('returns 200 for level 2 to reach level 3', () => {
    expect(calculateBondExpForNextLevel(2)).toBe(200);
  });

  it('returns 0 at max level', () => {
    expect(calculateBondExpForNextLevel(10)).toBe(0);
  });
});
