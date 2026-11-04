import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  adminAuditLogs,
  adminSessions,
  payments,
} from '../schema.js';

describe('0012 runtime hardening migration', () => {
  const migrationPath = path.resolve(__dirname, '../../../../drizzle/0012_runtime_payment_hardening.sql');

  it('adds active payment, audit dedupe and unique indexes without deleting rows', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "active" boolean');
    expect(sql).toContain('payments_order_active_unique');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "dedupe_key" varchar(160)');
    expect(sql).toContain('admin_audit_logs_dedupe_key_unique');
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('keeps schema indexes aligned with the migration', () => {
    const paymentIndexes = getTableConfig(payments).indexes;
    expect(paymentIndexes.find((index) => index.config.name === 'payments_order_active_unique')?.config.unique)
      .toBe(true);
    const auditIndexes = getTableConfig(adminAuditLogs).indexes;
    expect(auditIndexes.find((index) => index.config.name === 'admin_audit_logs_dedupe_key_unique')?.config.unique)
      .toBe(true);
    const sessionIndexes = getTableConfig(adminSessions).indexes;
    expect(sessionIndexes.find((index) => index.config.name === 'admin_sessions_subject_unique')?.config.unique)
      .toBe(true);
  });
});
