import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// ============================================================
// Migration SQL Contract Tests
// ============================================================
describe('0004_chat_modes_and_memory_scopes.sql', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../../drizzle/0004_chat_modes_and_memory_scopes.sql',
  );

  function readSql(): string {
    return fs.readFileSync(migrationPath, 'utf-8');
  }

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // --- enum creation ---
  it('creates chat_mode enum with values script and free', () => {
    const sql = readSql();
    expect(sql).toMatch(/CREATE\s+TYPE\s+.*chat_mode.*ENUM\s*\([^)]*'script'[^)]*'free'[^)]*\)/i);
  });

  it('creates memory_scope enum with values shared and script', () => {
    const sql = readSql();
    expect(sql).toMatch(/CREATE\s+TYPE\s+.*memory_scope.*ENUM\s*\([^)]*'shared'[^)]*'script'[^)]*\)/i);
  });

  // --- nullable column additions ---
  it('adds preferred_name varchar(20) to users', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"users"\s+ADD\s+COLUMN\s+"preferred_name"\s+varchar\s*\(\s*20\s*\)/i);
  });

  it('adds mode column to chat_sessions', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"chat_sessions"\s+ADD\s+COLUMN\s+"mode"/i);
  });

  it('adds script_id column to chat_sessions', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"chat_sessions"\s+ADD\s+COLUMN\s+"script_id"/i);
  });

  it('adds scope column to memories', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"memories"\s+ADD\s+COLUMN\s+"scope"/i);
  });

  it('adds script_id column to memories', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"memories"\s+ADD\s+COLUMN\s+"script_id"/i);
  });

  // --- foreign keys ---
  it('adds fk for chat_sessions.script_id -> scripts.id', () => {
    const sql = readSql();
    expect(sql).toMatch(/chat_sessions.*script_id.*scripts.*id/i);
    expect(sql).toMatch(/FOREIGN\s+KEY/i);
  });

  it('adds fk for memories.script_id -> scripts.id', () => {
    const sql = readSql();
    expect(sql).toMatch(/memories.*script_id.*scripts.*id/i);
    expect(sql).toMatch(/FOREIGN\s+KEY/i);
  });

  // --- backfill: sessions from characters.script_id ---
  it('backfills chat_sessions.mode and script_id using characters.script_id', () => {
    const sql = readSql();
    // Must join characters to resolve script_id
    expect(sql).toMatch(/FROM\s+"characters"/i);
    expect(sql).toMatch(/UPDATE\s+"chat_sessions"/i);
    // Must set mode to script or free
    expect(sql).toMatch(/'script'/);
    expect(sql).toMatch(/'free'/);
  });

  // --- archive duplicate active sessions per scope ---
  it('archives duplicate active sessions keeping latest per scope', () => {
    const sql = readSql();
    // Window function ranking
    expect(sql).toMatch(/ROW_NUMBER/i);
    // Archive: status = 'archived'
    expect(sql).toMatch(/'archived'/i);
    // Partition by user_id, character_id, mode, script_id
    expect(sql).toMatch(/"user_id"/);
    expect(sql).toMatch(/"character_id"/);
    expect(sql).toMatch(/"mode"/);
    expect(sql).toMatch(/"script_id"/);
  });

  // --- backfill: memories ---
  it('sets user_info memories to scope=shared', () => {
    const sql = readSql();
    expect(sql).toMatch(/user_info/);
    expect(sql).toMatch(/'shared'/);
  });

  it('sets relationship memories to scope=shared', () => {
    const sql = readSql();
    expect(sql).toMatch(/relationship/);
    expect(sql).toMatch(/'shared'/);
  });

  it('sets story memories with known script to scope=script and script_id', () => {
    const sql = readSql();
    expect(sql).toMatch(/story/);
    expect(sql).toMatch(/'script'/);
  });

  it('disables story memories when script cannot be confirmed', () => {
    const sql = readSql();
    expect(sql).toMatch(/enabled["\s]*=\s*false/i);
    expect(sql).toMatch(/story/i);
  });

  // --- check constraints ---
  it('adds check constraint: script mode requires script_id, free mode forbids it', () => {
    const sql = readSql();
    expect(sql).toMatch(/chat_sessions.*CHECK/i);
    expect(sql).toMatch(/'script'.*script_id.*NOT NULL|script_id.*NOT NULL.*'script'/i);
    expect(sql).toMatch(/'free'.*script_id.*NULL|script_id.*NULL.*'free'/i);
  });

  it('adds check constraint: script scope requires script_id, shared scope forbids it', () => {
    const sql = readSql();
    expect(sql).toMatch(/memories.*CHECK/i);
    expect(sql).toMatch(/'script'.*script_id.*NOT NULL|script_id.*NOT NULL.*'script'/i);
    expect(sql).toMatch(/'shared'.*script_id.*NULL|script_id.*NULL.*'shared'/i);
  });

  // --- conditional unique index ---
  it('adds conditional unique index for active free sessions', () => {
    const sql = readSql();
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(sql).toMatch(/chat_sessions.*active.*free|free.*active.*chat_sessions/i);
  });

  it('adds conditional unique index for active script sessions', () => {
    const sql = readSql();
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(sql).toMatch(/chat_sessions.*active.*script|script.*active.*chat_sessions/i);
  });

  // --- no "retired" ---
  it('does NOT reference "retired" anywhere', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/retired/i);
  });

  // --- no message deletion ---
  it('does NOT DELETE FROM messages', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"messages"/i);
  });

  // --- SQL style: repeatable / idempotent patterns ---
  it('uses statement-breakpoint separators', () => {
    const sql = readSql();
    expect(sql).toContain('--> statement-breakpoint');
  });

  it('foreign keys use idempotent pattern (DO block or IF NOT EXISTS)', () => {
    const sql = readSql();
    expect(sql).toMatch(/duplicate_object|IF\s+NOT\s+EXISTS/i);
  });

  it('check constraints use idempotent pattern', () => {
    const sql = readSql();
    // Check constraints added via DO block should handle duplicate_object
    const checkSection = sql.slice(sql.indexOf('CHECK'));
    if (checkSection.includes('duplicate_object') || checkSection.includes('IF NOT EXISTS')) {
      // idempotent - good
    } else {
      // may still be idempotent via IF NOT EXISTS
      expect(sql).toMatch(/duplicate_object|IF\s+NOT\s+EXISTS/i);
      return;
    }
    expect(true).toBe(true);
  });

  it('unique indices use IF NOT EXISTS', () => {
    const sql = readSql();
    const uniqueIndices = sql.match(/CREATE\s+UNIQUE\s+INDEX/g);
    if (uniqueIndices && uniqueIndices.length > 0) {
      // Each CREATE UNIQUE INDEX should be IF NOT EXISTS
      expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    }
  });

  // --- order verification ---
  it('defines enums before referencing them in ALTER TABLE', () => {
    const sql = readSql();
    const createChatMode = sql.search(/CREATE\s+TYPE.*chat_mode/i);
    const alterSessions = sql.search(/ALTER\s+TABLE\s+"chat_sessions"\s+ADD\s+COLUMN\s+"mode"/i);
    expect(createChatMode).toBeLessThan(alterSessions);
  });

  it('backfills data before adding check constraints', () => {
    const sql = readSql();
    const updateSessions = sql.search(/UPDATE\s+"chat_sessions"/i);
    const chatCheck = sql.search(/chat_sessions.*CHECK/i);
    expect(updateSessions).toBeLessThan(chatCheck);
  });

  it('backfills data before adding unique indices', () => {
    const sql = readSql();
    const archiveDupes = sql.search(/'archived'/);
    const uniqueIndex = sql.search(/CREATE\s+UNIQUE\s+INDEX.*chat_sessions/i);
    expect(archiveDupes).toBeLessThan(uniqueIndex);
  });
});

// ============================================================
// Drizzle Schema Tests (static / no DB)
// ============================================================
describe('Drizzle schema P0 changes', () => {
  it('exports chatModeEnum with enumName chat_mode and values [script, free]', async () => {
    const schema = await import('../schema.js');
    expect(schema.chatModeEnum).toBeDefined();
    expect(schema.chatModeEnum.enumName).toBe('chat_mode');
    expect(schema.chatModeEnum.enumValues).toEqual(['script', 'free']);
  });

  it('exports memoryScopeEnum with enumName memory_scope and values [shared, script]', async () => {
    const schema = await import('../schema.js');
    expect(schema.memoryScopeEnum).toBeDefined();
    expect(schema.memoryScopeEnum.enumName).toBe('memory_scope');
    expect(schema.memoryScopeEnum.enumValues).toEqual(['shared', 'script']);
  });

  it('users table has preferredName column mapped to preferred_name', async () => {
    const schema = await import('../schema.js');
    expect(schema.users.preferredName).toBeDefined();
    expect(schema.users.preferredName.name).toBe('preferred_name');
  });

  it('chatSessions table has mode column', async () => {
    const schema = await import('../schema.js');
    expect(schema.chatSessions.mode).toBeDefined();
    expect(schema.chatSessions.mode.name).toBe('mode');
  });

  it('chatSessions table has scriptId column referencing scripts', async () => {
    const schema = await import('../schema.js');
    expect(schema.chatSessions.scriptId).toBeDefined();
    expect(schema.chatSessions.scriptId.name).toBe('script_id');
  });

  it('memories table has scope column', async () => {
    const schema = await import('../schema.js');
    expect(schema.memories.scope).toBeDefined();
    expect(schema.memories.scope.name).toBe('scope');
  });

  it('memories table has scriptId column referencing scripts', async () => {
    const schema = await import('../schema.js');
    expect(schema.memories.scriptId).toBeDefined();
    expect(schema.memories.scriptId.name).toBe('script_id');
  });
});
