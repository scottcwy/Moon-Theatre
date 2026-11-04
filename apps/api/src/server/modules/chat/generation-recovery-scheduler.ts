import { recoverGenerationAttempts } from './generation-recovery.js';

export const GENERATION_RECOVERY_INTERVAL_MS = 5 * 60 * 1000;

async function runSafely(recover: () => Promise<unknown>): Promise<void> {
  try {
    await recover();
  } catch (error) {
    console.error({ event: 'chat_generation_recovery_failed', error });
  }
}

export function startGenerationRecoveryScheduler(
  recover: () => Promise<unknown> = () => recoverGenerationAttempts(),
  intervalMs = GENERATION_RECOVERY_INTERVAL_MS,
): NodeJS.Timeout {
  const run = () => {
    void runSafely(recover);
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}
