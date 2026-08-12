import { describe, expect, it } from 'vitest';
import {
  buildElementFailures,
  isRectBelow,
  mergeOffsetAndSize,
  rectanglesOverlap,
} from './runtime-ui-checks.mjs';

describe('runtime UI E2E layout checks', () => {
  it('merges automator offset and size into a stable rectangle', () => {
    expect(mergeOffsetAndSize(
      { left: 12, top: 34 },
      { width: 200, height: 80 },
    )).toEqual({
      left: 12,
      top: 34,
      right: 212,
      bottom: 114,
      width: 200,
      height: 80,
    });
  });

  it('reports zero-sized and offscreen elements as hard failures', () => {
    const failures = buildElementFailures({
      label: 'pay button',
      selector: '.buy__pay-btn',
      rect: { left: 0, top: 820, right: 0, bottom: 820, width: 0, height: 0 },
      viewport: { width: 390, height: 844 },
    });

    expect(failures).toEqual([
      {
        label: 'pay button',
        selector: '.buy__pay-btn',
        reason: 'element has zero width or height',
      },
      {
        label: 'pay button',
        selector: '.buy__pay-btn',
        reason: 'element is fully outside the viewport',
      },
    ]);
  });

  it('reports bottom controls that extend below the viewport', () => {
    const failures = buildElementFailures({
      label: 'chat input',
      selector: '.chat-input-bar',
      rect: { left: 0, top: 812, right: 390, bottom: 884, width: 390, height: 72 },
      viewport: { width: 390, height: 844 },
      mustFitViewportBottom: true,
    });

    expect(failures).toEqual([
      {
        label: 'chat input',
        selector: '.chat-input-bar',
        reason: 'element bottom exceeds viewport bottom',
      },
    ]);
  });

  it('detects real rectangle overlap while allowing touching edges', () => {
    expect(rectanglesOverlap(
      { left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50 },
      { left: 0, top: 50, right: 100, bottom: 120, width: 100, height: 70 },
    )).toBe(false);

    expect(rectanglesOverlap(
      { left: 0, top: 0, right: 100, bottom: 60, width: 100, height: 60 },
      { left: 20, top: 50, right: 120, bottom: 140, width: 100, height: 90 },
    )).toBe(true);
  });

  it('requires custom-header content to start below the system capsule', () => {
    const capsule = { top: 59, bottom: 91, left: 287, right: 374, width: 87, height: 32 };

    expect(isRectBelow({ top: 103 }, capsule, 8)).toBe(true);
    expect(isRectBelow({ top: 95 }, capsule, 8)).toBe(false);
  });
});
