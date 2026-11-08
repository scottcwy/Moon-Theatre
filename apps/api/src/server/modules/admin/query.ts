import { z } from 'zod';
import { formatZodIssues, ValidationError } from '../../http/errors.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const optionalUuid = z.string().uuid().optional();
const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * UTC calendar day (`YYYY-MM-DD`), the unit the session list filter offers. A well-shaped but
 * impossible day (2026-02-31) is rejected too, so a typo cannot silently widen or empty the range.
 */
/** `Date.parse` rolls an impossible day over (2026-02-31 → 2026-03-03), so round-trip the parts. */
export function isAdminCalendarDay(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const isoDay = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '创建日期需为 YYYY-MM-DD 格式')
  .refine(isAdminCalendarDay, '创建日期不是有效日期');

export const listSessionsQuerySchema = paginationSchema.extend({
  userId: optionalUuid,
  characterId: optionalUuid,
  mode: z.enum(['script', 'free']).optional(),
  status: z.enum(['active', 'archived']).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: '开始日期不能晚于结束日期' });
  }
});

export const listWalletTransactionsQuerySchema = paginationSchema.extend({
  userId: optionalUuid,
  type: z.enum(['recharge', 'consume', 'adjust']).optional(),
});

export const listModelUsageLogsQuerySchema = paginationSchema.extend({
  userId: optionalUuid,
  sessionId: optionalUuid,
  modelTier: z.enum(['casual', 'standard', 'immersive']).optional(),
});

export const listOrdersQuerySchema = paginationSchema.extend({
  userId: optionalUuid,
  status: z.enum(['created', 'prepay_created', 'paid', 'credited', 'closed', 'failed', 'refunded']).optional(),
});

export const listPaymentsQuerySchema = paginationSchema.extend({
  orderId: optionalUuid,
  status: z.enum(['pending', 'success', 'failed', 'cancelled']).optional(),
});

export const listReviewLogsQuerySchema = paginationSchema.extend({
  sessionId: optionalUuid,
  status: z.enum(['normal', 'flagged', 'resolved']).optional(),
});

export const listMessagesQuerySchema = paginationSchema.extend({
  sessionId: z.string().uuid(),
});

export const listWalletAccountsQuerySchema = paginationSchema.extend({
  userId: optionalUuid,
});

export const listAdminMemoriesQuerySchema = paginationSchema.extend({
  userId: optionalUuid,
  characterId: optionalUuid,
  type: z.enum(['user_info', 'relationship', 'story']).optional(),
  enabled: booleanString.optional(),
});

export function parseAdminQuery<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  searchParams: URLSearchParams,
): z.output<TSchema> {
  const input = Object.fromEntries(searchParams.entries());
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(formatZodIssues(result.error.issues));
  }
  return result.data;
}
