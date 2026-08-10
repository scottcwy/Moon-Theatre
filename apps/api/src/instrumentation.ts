/**
 * Next.js 15 instrumentation：仅在 Node.js runtime 注册进程内调度器，
 * edge runtime 直接跳过，避免加载服务端模块。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { startReturnMessageScheduler } = await import(
    './server/modules/return-messages/scheduler.js'
  );
  startReturnMessageScheduler();
}
