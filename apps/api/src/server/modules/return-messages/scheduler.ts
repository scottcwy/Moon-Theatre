import { sweepReturnMessages } from './service.js';

export const RETURN_MESSAGE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** 执行一次清扫，失败只记录日志，绝不向上抛（避免 unhandled rejection）。 */
async function runSweepSafely(sweep: () => Promise<void>): Promise<void> {
  try {
    await sweep();
  } catch (error) {
    console.error({ event: 'return_message_sweep_failed', error });
  }
}

/**
 * 启动进程内每小时回访补发调度器：启动时立即跑一次，之后按 intervalMs 周期执行。
 * timer 已 unref()，不阻止进程退出。
 */
export function startReturnMessageScheduler(
  sweep: () => Promise<void> = () => sweepReturnMessages(),
  intervalMs: number = RETURN_MESSAGE_SWEEP_INTERVAL_MS,
): NodeJS.Timeout {
  const run = () => {
    void runSweepSafely(sweep);
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}
