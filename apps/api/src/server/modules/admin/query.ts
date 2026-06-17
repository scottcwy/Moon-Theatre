import { z } from 'zod';
import { formatZodIssues, ValidationError } from '../../http/errors.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const optionalUuid = z.string().uuid().optional();
const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

export const listSessionsQuerySchema = paginationSchema.extend({
  userId: optionalUuid,
  status: z.enum(['active', 'archived']).optional(),
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
