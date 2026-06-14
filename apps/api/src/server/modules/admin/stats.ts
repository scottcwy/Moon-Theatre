import { count, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  chatSessions,
  messages,
  modelUsageLogs,
  orders,
  users,
  walletAccounts,
} from '../../db/schema.js';

export interface AdminStats {
  users: {
    total: number;
    today: number;
  };
  sessions: {
    total: number;
  };
  messages: {
    total: number;
    today: number;
  };
  orders: {
    total: number;
    credited: number;
  };
  payments: {
    paidAmountCents: number;
  };
  wallet: {
    balancePoints: number;
  };
  modelUsage: {
    total: number;
  };
  moderation: {
    filtered: number;
  };
  generatedAt: string;
}

type AggregateRow = { total: unknown };

export function summarizeAdminStatsRows(input: {
  usersTotal: AggregateRow[];
  usersToday: AggregateRow[];
  sessionsTotal: AggregateRow[];
  messagesTotal: AggregateRow[];
  messagesToday: AggregateRow[];
  ordersTotal: AggregateRow[];
  creditedOrdersTotal: AggregateRow[];
  paidAmount: AggregateRow[];
  walletBalance: AggregateRow[];
  modelUsageTotal: AggregateRow[];
  moderationFilteredTotal: AggregateRow[];
  generatedAt: Date;
}): AdminStats {
  return {
    users: {
      total: readAggregate(input.usersTotal),
      today: readAggregate(input.usersToday),
    },
    sessions: {
      total: readAggregate(input.sessionsTotal),
    },
    messages: {
      total: readAggregate(input.messagesTotal),
      today: readAggregate(input.messagesToday),
    },
    orders: {
      total: readAggregate(input.ordersTotal),
      credited: readAggregate(input.creditedOrdersTotal),
    },
    payments: {
      paidAmountCents: readAggregate(input.paidAmount),
    },
    wallet: {
      balancePoints: readAggregate(input.walletBalance),
    },
    modelUsage: {
      total: readAggregate(input.modelUsageTotal),
    },
    moderation: {
      filtered: readAggregate(input.moderationFilteredTotal),
    },
    generatedAt: input.generatedAt.toISOString(),
  };
}

export async function getAdminStats(now = new Date()): Promise<AdminStats> {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    usersTotal,
    usersToday,
    sessionsTotal,
    messagesTotal,
    messagesToday,
    ordersTotal,
    creditedOrdersTotal,
    paidAmount,
    walletBalance,
    modelUsageTotal,
    moderationFilteredTotal,
  ] = await Promise.all([
    db.select({ total: count() }).from(users),
    db.select({ total: count() }).from(users).where(gte(users.createdAt, todayStart)),
    db.select({ total: count() }).from(chatSessions),
    db.select({ total: count() }).from(messages),
    db.select({ total: count() }).from(messages).where(gte(messages.createdAt, todayStart)),
    db.select({ total: count() }).from(orders),
    db.select({ total: count() }).from(orders).where(eq(orders.status, 'credited')),
    db
      .select({ total: sql<number>`coalesce(sum(${orders.amountCents}), 0)` })
      .from(orders)
      .where(inArray(orders.status, ['paid', 'credited'])),
    db
      .select({ total: sql<number>`coalesce(sum(${walletAccounts.balancePoints}), 0)` })
      .from(walletAccounts),
    db.select({ total: count() }).from(modelUsageLogs),
    db.select({ total: count() }).from(modelUsageLogs).where(eq(modelUsageLogs.status, 'filtered')),
  ]);

  return summarizeAdminStatsRows({
    usersTotal,
    usersToday,
    sessionsTotal,
    messagesTotal,
    messagesToday,
    ordersTotal,
    creditedOrdersTotal,
    paidAmount,
    walletBalance,
    modelUsageTotal,
    moderationFilteredTotal,
    generatedAt: now,
  });
}

function readAggregate(rows: AggregateRow[]): number {
  const value = rows[0]?.total ?? 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}
