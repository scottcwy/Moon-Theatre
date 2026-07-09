import { describe, expect, it } from 'vitest';
import { createBondViewModel } from './bond.model';

describe('createBondViewModel', () => {
  it('returns level 1 / 0 totalExp for null input', () => {
    const vm = createBondViewModel(null);
    expect(vm.level).toBe(1);
    expect(vm.totalExp).toBe(0);
    expect(vm.currentLevelExp).toBe(0);
    expect(vm.currentLevelMaxExp).toBe(100);
    expect(vm.progressLabel).toBe('0/100');
  });

  it('returns level 1 / 0 totalExp for undefined input', () => {
    const vm = createBondViewModel(undefined);
    expect(vm.level).toBe(1);
    expect(vm.totalExp).toBe(0);
    expect(vm.progressLabel).toBe('0/100');
  });

  it('computes from cumulative exp: bondLevel 4, bondExp 338 → level 4, 38/100, remaining 62', () => {
    const vm = createBondViewModel({ bondLevel: 4, bondExp: 338 });
    expect(vm.level).toBe(4);
    expect(vm.totalExp).toBe(338);
    expect(vm.currentLevelExp).toBe(38);
    expect(vm.currentLevelMaxExp).toBe(100);
    expect(vm.progressLabel).toBe('38/100');
    expect(vm.remainingExp).toBe(62);
    expect(vm.remainingLabel).toBe('距下一等级还需 62 默契度');
    expect(vm.percent).toBe(38);
  });

  it('total experience wins over stale low level: bondLevel 1, bondExp 220 → level 3, 20/100', () => {
    const vm = createBondViewModel({ bondLevel: 1, bondExp: 220 });
    expect(vm.level).toBe(3);
    expect(vm.totalExp).toBe(220);
    expect(vm.currentLevelExp).toBe(20);
    expect(vm.progressLabel).toBe('20/100');
    expect(vm.remainingExp).toBe(80);
  });

  it('derives level from total experience instead of trusting stale high supplied level', () => {
    const vm = createBondViewModel({ bondLevel: 4, bondExp: 38 });
    expect(vm.level).toBe(1);
    expect(vm.totalExp).toBe(38);
    expect(vm.currentLevelExp).toBe(38);
    expect(vm.progressLabel).toBe('38/100');
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
    expect(vm.level).toBe(2);
    expect(vm.currentLevelExp).toBe(50);
  });

  it('recomputes level from cumulative exp when bondLevel is null', () => {
    const vm = createBondViewModel({ bondExp: 210 });
    expect(vm.level).toBe(3);
    expect(vm.totalExp).toBe(210);
    expect(vm.currentLevelExp).toBe(10);
  });

  it('recomputes level from cumulative exp when bondLevel is missing', () => {
    const vm = createBondViewModel({ bondLevel: undefined, bondExp: 310 });
    expect(vm.level).toBe(4);
    expect(vm.currentLevelExp).toBe(10);
  });

  it('produces labels correctly', () => {
    const vm = createBondViewModel({ bondLevel: 3, bondExp: 250 });
    expect(vm.levelLabel).toBe('羁绊 Lv.3');
    expect(vm.compactLevelLabel).toBe('♥ Lv.3');
    expect(vm.progressLabel).toBe('50/100');
    expect(vm.remainingLabel).toBe('距下一等级还需 50 默契度');
  });

  it('ignores inconsistent supplied levels because totalExp is the display source of truth', () => {
    const vm = createBondViewModel({ bondLevel: 3, bondExp: 50 });
    expect(vm.level).toBe(1);
    expect(vm.totalExp).toBe(50);
    expect(vm.currentLevelExp).toBe(50);
  });

  it('clamps currentLevelExp to 100 when exceeding a level', () => {
    const vm = createBondViewModel({ bondLevel: 2, bondExp: 250 });
    expect(vm.level).toBe(3);
    expect(vm.currentLevelExp).toBe(50);
  });

  it('resets progress at exact level boundary', () => {
    const vm = createBondViewModel({ bondLevel: 2, bondExp: 200 });
    expect(vm.level).toBe(3);
    expect(vm.currentLevelExp).toBe(0);
    expect(vm.percent).toBe(0);
  });
});
