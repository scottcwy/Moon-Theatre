import { z } from 'zod';
import { formatZodIssues, ValidationError } from '../../http/errors.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * `%`/`_`/`\` are literal characters of the operator's term, not LIKE syntax. PostgreSQL's default
 * LIKE escape character is the backslash, so prefixing them is enough and keeps the term a bound
 * parameter instead of SQL text.
 */
export function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

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

/**
 * User search (AC-11): one term matches nickname substring, openid prefix or user-id prefix. A blank
 * term is "no filter" so an empty search box still submits; an over-long term or an unknown status is
 * a client error with Chinese copy instead of a silently widened query.
 */
export const listAdminUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(128, '搜索关键词最多 128 个字符').optional(),
  status: z.enum(['active', 'banned'], { message: '用户状态只能是正常或已封禁' }).optional(),
});

/**
 * Character list (AC-18): the same bounded page contract as users, with a term over the character
 * name, the agent id or the bound script title, plus the publish state. A blank term is "no filter";
 * an over-long term or an unknown status is a client error with Chinese copy instead of a silently
 * widened query.
 */
export const listAdminCharactersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(128, '搜索关键词最多 128 个字符').optional(),
  status: z.enum(['active', 'inactive'], { message: '角色发布状态只能是已上架或未上架' }).optional(),
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
