import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../http/errors.js';
import {
  listModelUsageLogsQuerySchema,
  listAdminMemoriesQuerySchema,
  listMessagesQuerySchema,
  listOrdersQuerySchema,
  listPaymentsQuerySchema,
  listReviewLogsQuerySchema,
  listSessionsQuerySchema,
  listWalletAccountsQuerySchema,
  listWalletTransactionsQuerySchema,
  parseAdminQuery,
} from '../query.js';

describe('admin query parsing', () => {
  it('normalizes pagination defaults and enum filters', () => {
    const query = parseAdminQuery(
      listSessionsQuerySchema,
      new URLSearchParams('status=active&page=2&pageSize=30'),
    );

    expect(query).toEqual({
      status: 'active',
      page: 2,
      pageSize: 30,
    });
  });

  it('rejects invalid session status values before they reach Drizzle enums', () => {
    expect(() => parseAdminQuery(listSessionsQuerySchema, new URLSearchParams('status=deleted'))).toThrow(ValidationError);
  });

  it('rejects invalid wallet transaction types', () => {
    expect(() => parseAdminQuery(listWalletTransactionsQuerySchema, new URLSearchParams('type=refund'))).toThrow(ValidationError);
  });

  it('rejects invalid model usage tiers', () => {
    expect(() => parseAdminQuery(listModelUsageLogsQuerySchema, new URLSearchParams('modelTier=vip'))).toThrow(ValidationError);
  });

  it('rejects invalid order, payment, and review statuses', () => {
    expect(() => parseAdminQuery(listOrdersQuerySchema, new URLSearchParams('status=unknown'))).toThrow(ValidationError);
    expect(() => parseAdminQuery(listPaymentsQuerySchema, new URLSearchParams('status=paid'))).toThrow(ValidationError);
    expect(() => parseAdminQuery(listReviewLogsQuerySchema, new URLSearchParams('status=open'))).toThrow(ValidationError);
  });

  it('validates admin list identifiers and memory filters', () => {
    expect(() => parseAdminQuery(listMessagesQuerySchema, new URLSearchParams())).toThrow(ValidationError);
    expect(() => parseAdminQuery(listWalletAccountsQuerySchema, new URLSearchParams('userId=nope'))).toThrow(ValidationError);
    expect(() => parseAdminQuery(listAdminMemoriesQuerySchema, new URLSearchParams('type=private'))).toThrow(ValidationError);
    expect(() => parseAdminQuery(listAdminMemoriesQuerySchema, new URLSearchParams('enabled=yes'))).toThrow(ValidationError);
    expect(parseAdminQuery(listAdminMemoriesQuerySchema, new URLSearchParams('enabled=false'))).toEqual({
      page: 1,
      pageSize: 20,
      enabled: false,
    });
  });
});
