import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  db: {},
}));

import { summarizeAdminStatsRows } from '../stats.js';

describe('admin stats service helpers', () => {
  it('normalizes aggregate rows into dashboard stats', () => {
    const now = new Date('2026-06-14T12:00:00.000Z');

    expect(
      summarizeAdminStatsRows({
        usersTotal: [{ total: 8 }],
        usersToday: [{ total: 2 }],
        sessionsTotal: [{ total: 5 }],
        messagesTotal: [{ total: 21 }],
        messagesToday: [{ total: 6 }],
        ordersTotal: [{ total: 4 }],
        creditedOrdersTotal: [{ total: 3 }],
        paidAmount: [{ total: '1800' }],
        walletBalance: [{ total: '240' }],
        modelUsageTotal: [{ total: 9 }],
        moderationFilteredTotal: [{ total: 2 }],
        generatedAt: now,
      }),
    ).toEqual({
      users: { total: 8, today: 2 },
      sessions: { total: 5 },
      messages: { total: 21, today: 6 },
      orders: { total: 4, credited: 3 },
      payments: { paidAmountCents: 1800 },
      wallet: { balancePoints: 240 },
      modelUsage: { total: 9 },
      moderation: { filtered: 2 },
      generatedAt: now.toISOString(),
    });
  });
});
