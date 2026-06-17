import { eq, desc, asc, and, count } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { reviewLogs } from '../../db/schema.js';
import { normalizePagination, type PaginatedResult, type PaginationParams } from './pagination.js';

type ReviewStatus = 'normal' | 'flagged' | 'resolved';

export async function createReview(input: {
  sessionId: string;
  messageId?: string;
  reviewerId?: string;
  status: 'normal' | 'flagged' | 'resolved';
  note?: string;
}) {
  const [row] = await db
    .insert(reviewLogs)
    .values({
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      reviewerId: input.reviewerId ?? 'admin',
      status: input.status,
      note: input.note ?? null,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to create review log');
  }
  return row;
}

export async function listReviewLogs(params: PaginationParams & { sessionId?: string; status?: ReviewStatus }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.sessionId) conditions.push(eq(reviewLogs.sessionId, params.sessionId));
  if (params.status) conditions.push(eq(reviewLogs.status, params.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(reviewLogs)
      .where(where)
      .orderBy(desc(reviewLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(reviewLogs)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}
