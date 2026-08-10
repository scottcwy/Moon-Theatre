import { describe, expect, it } from 'vitest';

/**
 * 真实 PostgreSQL 回归（模块 6 常聊角色聚合）。
 * 禁止 mock：drizzle mock 不会复现 PG 对 GROUP BY/ORDER BY 的规划校验。
 * 修复前 `latestUserMessageAtSql()` 的相关子查询直接出现在 ORDER BY，
 * 引用了不在 GROUP BY 中的 chat_sessions.id，真实 PG 报
 * `subquery uses ungrouped column "chat_sessions.id" from outer query`；
 * 修复后子查询包进 `max(...)` 聚合，真实 PG 可规划。
 * 需要本地开发库容器（juben-sha-postgres）；无 DATABASE_URL 时跳过。
 */
const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);

describeRealPg('character-summary-service 真实 PG 回归', () => {
  it('getFrequentCharacterSummaries 在真实 PostgreSQL 上可规划且可执行', async () => {
    // 直接复用生产查询链（含 ORDER BY 修复），与生产完全一致。
    // 不存在用户 → 空结果，等价 LIMIT 0；若 PG 无法规划会在此抛错。
    const { getFrequentCharacterSummaries } = await import('../character-summary-service.js');
    const result = await getFrequentCharacterSummaries('00000000-0000-0000-0000-000000000000', 1, 0);

    expect(result).toEqual({ summaries: [], hasMore: false });
  });
});
