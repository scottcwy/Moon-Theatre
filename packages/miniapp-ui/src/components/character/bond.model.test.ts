import { describe, expect, it } from 'vitest';
import { BOND_LEVEL_NAMES, bondLevelName, createBondViewModel } from './bond.model';

describe('createBondViewModel', () => {
  it('returns level 1 / 0 totalExp for null input', () => {
    const vm = createBondViewModel(null);
    expect(vm.level).toBe(1);
    expect(vm.totalExp).toBe(0);
    expect(vm.currentLevelExp).toBe(0);
    expect(vm.currentLevelMaxExp).toBe(200);
    expect(vm.progressLabel).toBe('0/200');
  });

  it('returns level 1 / 0 totalExp for undefined input', () => {
    const vm = createBondViewModel(undefined);
    expect(vm.level).toBe(1);
    expect(vm.totalExp).toBe(0);
    expect(vm.progressLabel).toBe('0/200');
  });

  it('computes from cumulative exp: bondLevel 4, bondExp 338 → level 2, 138/500, remaining 362', () => {
    const vm = createBondViewModel({ bondLevel: 4, bondExp: 338 });
    expect(vm.level).toBe(2);
    expect(vm.totalExp).toBe(338);
    expect(vm.currentLevelExp).toBe(138);
    expect(vm.currentLevelMaxExp).toBe(500);
    expect(vm.progressLabel).toBe('138/500');
    expect(vm.remainingExp).toBe(362);
    expect(vm.remainingLabel).toBe('距下一级羁绊还需 362');
    expect(vm.percent).toBe(28);
  });

  it('total experience wins over stale low level: bondLevel 1, bondExp 220 → level 2, 20/500', () => {
    const vm = createBondViewModel({ bondLevel: 1, bondExp: 220 });
    expect(vm.level).toBe(2);
    expect(vm.totalExp).toBe(220);
    expect(vm.currentLevelExp).toBe(20);
    expect(vm.progressLabel).toBe('20/500');
    expect(vm.remainingExp).toBe(480);
  });

  it('derives level from total experience instead of trusting stale high supplied level', () => {
    const vm = createBondViewModel({ bondLevel: 4, bondExp: 38 });
    expect(vm.level).toBe(1);
    expect(vm.totalExp).toBe(38);
    expect(vm.currentLevelExp).toBe(38);
    expect(vm.progressLabel).toBe('38/200');
  });

  it('clamps negative exp to 0 and derives level from the clamped total', () => {
    const vm = createBondViewModel({ bondLevel: 2, bondExp: -5 });
    expect(vm.totalExp).toBe(0);
    expect(vm.level).toBe(1);
    expect(vm.currentLevelExp).toBe(0);
  });

  it('clamps fractional exp to integer', () => {
    const vm = createBondViewModel({ bondLevel: 2, bondExp: 150.7 });
    expect(vm.totalExp).toBe(150);
    expect(vm.level).toBe(1);
    expect(vm.currentLevelExp).toBe(150);
  });

  it('recomputes level from cumulative exp when bondLevel is null', () => {
    const vm = createBondViewModel({ bondExp: 210 });
    expect(vm.level).toBe(2);
    expect(vm.totalExp).toBe(210);
    expect(vm.currentLevelExp).toBe(10);
  });

  it('recomputes level from cumulative exp when bondLevel is missing', () => {
    const vm = createBondViewModel({ bondLevel: undefined, bondExp: 310 });
    expect(vm.level).toBe(2);
    expect(vm.currentLevelExp).toBe(110);
  });

  it('produces name labels correctly', () => {
    const vm = createBondViewModel({ bondLevel: 3, bondExp: 800 });
    expect(vm.level).toBe(3);
    expect(vm.levelLabel).toBe('杯沿');
    expect(vm.compactLevelLabel).toBe('杯沿');
    expect(vm.progressLabel).toBe('100/2000');
    expect(vm.remainingLabel).toBe('距下一级羁绊还需 1900');
  });

  it('ignores inconsistent supplied levels because totalExp is the display source of truth', () => {
    const vm = createBondViewModel({ bondLevel: 3, bondExp: 50 });
    expect(vm.level).toBe(1);
    expect(vm.totalExp).toBe(50);
    expect(vm.currentLevelExp).toBe(50);
  });

  it('carries the overflow into the next level instead of clamping at the level max', () => {
    const vm = createBondViewModel({ bondLevel: 2, bondExp: 750 });
    expect(vm.level).toBe(3);
    expect(vm.currentLevelExp).toBe(50);
    expect(vm.currentLevelMaxExp).toBe(2000);
  });

  it('resets progress at exact level boundary', () => {
    const vm = createBondViewModel({ bondLevel: 1, bondExp: 200 });
    expect(vm.level).toBe(2);
    expect(vm.currentLevelExp).toBe(0);
    expect(vm.percent).toBe(0);
  });

  it('caps display level at 6 and shows 满级 without a next-level hint', () => {
    const vm = createBondViewModel({ bondLevel: 6, bondExp: 27000 });
    expect(vm.level).toBe(6);
    expect(vm.totalExp).toBe(27000);
    expect(vm.currentLevelExp).toBe(16000);
    expect(vm.currentLevelMaxExp).toBe(16000);
    expect(vm.percent).toBe(100);
    expect(vm.remainingExp).toBe(0);
    expect(vm.progressLabel).toBe('16000/16000');
    expect(vm.remainingLabel).toBe('羁绊已满级');
  });

  it('caps display level at 6 exactly at the 26700 exp boundary', () => {
    const vm = createBondViewModel({ bondExp: 26700 });
    expect(vm.level).toBe(6);
    expect(vm.remainingExp).toBe(0);
    expect(vm.remainingLabel).toBe('羁绊已满级');
    expect(vm.progressLabel).toBe('16000/16000');
  });

  it('keeps normal progress inside the second-to-last level', () => {
    const vm = createBondViewModel({ bondExp: 10700 });
    expect(vm.level).toBe(5);
    expect(vm.levelLabel).toBe('不言');
    expect(vm.currentLevelExp).toBe(0);
    expect(vm.remainingExp).toBe(16000);
    expect(vm.percent).toBe(0);
  });

  it('pins the product constraint: spending 1000 casual-tier points (≈10000 exp) reaches level 4 at most', () => {
    const vm = createBondViewModel({ bondExp: 10000 });
    expect(vm.level).toBe(4);
    expect(vm.levelLabel).toBe('留盏');
    expect(vm.progressLabel).toBe('7300/8000');
  });
});

describe('bondLevelName', () => {
  it('maps levels 1–6 to the confirmed names in order', () => {
    expect(BOND_LEVEL_NAMES).toEqual(['檐下', '灯前', '杯沿', '留盏', '不言', '入念']);
    expect([1, 2, 3, 4, 5, 6].map(bondLevelName)).toEqual(['檐下', '灯前', '杯沿', '留盏', '不言', '入念']);
  });

  it('clamps out-of-range and invalid input to the edges', () => {
    expect(bondLevelName(0)).toBe('檐下');
    expect(bondLevelName(-3)).toBe('檐下');
    expect(bondLevelName(7)).toBe('入念');
    expect(bondLevelName(99)).toBe('入念');
    expect(bondLevelName(1.9)).toBe('檐下');
    expect(bondLevelName(NaN)).toBe('檐下');
    expect(bondLevelName(Number('x'))).toBe('檐下');
  });
});
