import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RETURN_MESSAGE_SWEEP_INTERVAL_MS,
  startReturnMessageScheduler,
} from '../scheduler.js';

const schedulerSource = readFileSync(resolve(__dirname, '../scheduler.ts'), 'utf8');
const instrumentationSource = readFileSync(
  resolve(__dirname, '../../../../instrumentation.ts'),
  'utf8',
);

describe('return message scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs the sweep immediately, then on the hourly interval, and returns an unref()ed timer', () => {
    const sweep = vi.fn().mockResolvedValue(undefined);

    const timer = startReturnMessageScheduler(sweep);

    expect(sweep).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RETURN_MESSAGE_SWEEP_INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(2);

    expect(typeof timer.unref).toBe('function');
    expect(timer.hasRef()).toBe(false);
  });

  it('catches sweep failures and logs them without an unhandled rejection', async () => {
    const error = new Error('sweep failed');
    const sweep = vi.fn().mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    startReturnMessageScheduler(sweep);
    await vi.advanceTimersByTimeAsync(0);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'return_message_sweep_failed', error }),
    );
  });

  it('wires scheduler and instrumentation sources (static)', () => {
    expect(schedulerSource).toContain('setInterval');
    expect(schedulerSource).toContain('unref()');
    expect(instrumentationSource).toContain('NEXT_RUNTIME');
    expect(instrumentationSource).toContain('startReturnMessageScheduler');
  });
});
