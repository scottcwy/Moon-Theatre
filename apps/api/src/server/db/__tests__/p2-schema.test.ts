import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// ============================================================
// Migration SQL Contract Tests — 0006 character_return_messages
// ============================================================
describe('0006_character_return_messages.sql', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../../drizzle/0006_character_return_messages.sql',
  );

  function readSql(): string {
    return fs.readFileSync(migrationPath, 'utf-8');
  }

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // --- CREATE TABLE ---
  it('creates character_return_messages table with all columns', () => {
    const sql = readSql();
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"character_return_messages"/i);
    expect(sql).toMatch(/"id"\s+uuid\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/"user_id"\s+uuid\s+NOT\s+NULL/i);
    expect(sql).toMatch(/"character_id"\s+uuid\s+NOT\s+NULL/i);
    expect(sql).toMatch(/"content"\s+text\s+NOT\s+NULL/i);
    expect(sql).toMatch(/"reason"\s+varchar\(\s*16\s*\)\s+NOT\s+NULL/i);
    expect(sql).toMatch(/"window_start"\s+timestamp\s+with\s+time\s+zone\s+NOT\s+NULL/i);
    expect(sql).toMatch(/"created_at"\s+timestamp\s+with\s+time\s+zone\s+DEFAULT\s+now\(\)\s+NOT\s+NULL/i);
    expect(sql).toMatch(/"read_at"\s+timestamp\s+with\s+time\s+zone/i);
  });

  // --- indexes ---
  it('creates unique index character_return_messages_window_unique on (user_id, character_id, window_start)', () => {
    const sql = readSql();
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"character_return_messages_window_unique"\s+ON\s+"character_return_messages".*"user_id","character_id","window_start"/is,
    );
  });

  it('creates index character_return_messages_unread_idx on (user_id, read_at)', () => {
    const sql = readSql();
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"character_return_messages_unread_idx"\s+ON\s+"character_return_messages".*"user_id","read_at"/is,
    );
  });

  // --- foreign keys ---
  it('adds foreign key user_id -> users.id', () => {
    const sql = readSql();
    expect(sql).toMatch(/"character_return_messages_user_id_users_id_fk"/i);
    expect(sql).toMatch(/FOREIGN\s+KEY\s*\(\s*"user_id"\s*\)\s*REFERENCES\s+"public"\."users"\("id"\)/is);
  });

  it('adds foreign key character_id -> characters.id', () => {
    const sql = readSql();
    expect(sql).toMatch(/"character_return_messages_character_id_characters_id_fk"/i);
    expect(sql).toMatch(/FOREIGN\s+KEY\s*\(\s*"character_id"\s*\)\s*REFERENCES\s+"public"\."characters"\("id"\)/is);
  });

  // --- pure additive migration ---
  it('uses statement-breakpoint separators', () => {
    expect(readSql()).toContain('--> statement-breakpoint');
  });

  it('does NOT delete rows', () => {
    expect(readSql()).not.toMatch(/DELETE\s+FROM/i);
  });

  it('does NOT drop columns', () => {
    expect(readSql()).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('does NOT alter pre-existing tables (ALTER only on the new table)', () => {
    const sql = readSql();
    // drizzle adds FK constraints on character_return_messages itself via ALTER TABLE;
    // any ALTER targeting a pre-existing table is forbidden.
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"(?!character_return_messages")/i);
  });
});

// ============================================================
// Drizzle Schema Tests (static / no DB)
// ============================================================
describe('Drizzle schema 0006 changes', () => {
  it('exports characterReturnMessages table', async () => {
    const schema = await import('../schema.js');
    expect(schema.characterReturnMessages).toBeDefined();
    expect(schema.characterReturnMessages.id).toBeDefined();
  });

  it('characterReturnMessages has id uuid primary key', async () => {
    const schema = await import('../schema.js');
    const col = schema.characterReturnMessages.id;
    expect(col).toBeDefined();
    expect(col.name).toBe('id');
    expect(col.dataType).toBe('string');
    expect(col.primary).toBe(true);
  });

  it('characterReturnMessages has userId referencing users', async () => {
    const schema = await import('../schema.js');
    const col = schema.characterReturnMessages.userId;
    expect(col).toBeDefined();
    expect(col.name).toBe('user_id');
    expect(col.notNull).toBe(true);
  });

  it('characterReturnMessages has characterId referencing characters', async () => {
    const schema = await import('../schema.js');
    const col = schema.characterReturnMessages.characterId;
    expect(col).toBeDefined();
    expect(col.name).toBe('character_id');
    expect(col.notNull).toBe(true);
  });

  it('characterReturnMessages has content text notNull', async () => {
    const schema = await import('../schema.js');
    const col = schema.characterReturnMessages.content;
    expect(col).toBeDefined();
    expect(col.name).toBe('content');
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
  });

  it('characterReturnMessages has reason varchar notNull', async () => {
    const schema = await import('../schema.js');
    const col = schema.characterReturnMessages.reason;
    expect(col).toBeDefined();
    expect(col.name).toBe('reason');
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
  });

  it('characterReturnMessages has windowStart timestamp notNull', async () => {
    const schema = await import('../schema.js');
    const col = schema.characterReturnMessages.windowStart;
    expect(col).toBeDefined();
    expect(col.name).toBe('window_start');
    expect(col.dataType).toBe('date');
    expect(col.notNull).toBe(true);
  });

  it('characterReturnMessages has createdAt timestamp default now notNull', async () => {
    const schema = await import('../schema.js');
    const col = schema.characterReturnMessages.createdAt;
    expect(col).toBeDefined();
    expect(col.name).toBe('created_at');
    expect(col.dataType).toBe('date');
    expect(col.notNull).toBe(true);
    expect(col.default).toBeDefined();
  });

  it('characterReturnMessages has readAt timestamp nullable', async () => {
    const schema = await import('../schema.js');
    const col = schema.characterReturnMessages.readAt;
    expect(col).toBeDefined();
    expect(col.name).toBe('read_at');
    expect(col.dataType).toBe('date');
    expect(col.notNull).toBe(false);
  });

  it('exports characterReturnMessagesRelations with user and character', async () => {
    const schema = await import('../schema.js');
    expect(schema.characterReturnMessagesRelations).toBeDefined();
  });
});

// ============================================================
// Migration journal integrity
// ============================================================
describe('Migration journal integrity', () => {
  const journalPath = path.resolve(
    __dirname,
    '../../../../drizzle/meta/_journal.json',
  );

  it('journal has entry for 0006 with correct tag', () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    const entry = journal.entries.find(
      (e: { tag: string }) => e.tag === '0006_character_return_messages',
    );
    expect(entry).toBeDefined();
    expect(entry.idx).toBe(6);
    expect(entry.breakpoints).toBe(true);
  });

  it('journal entries are sorted by idx ascending', () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    const idxs = journal.entries.map((e: { idx: number }) => e.idx);
    const sorted = [...idxs].sort((a, b) => a - b);
    expect(idxs).toEqual(sorted);
  });
});

// ============================================================
// Snapshot integrity
// ============================================================
describe('0006 snapshot integrity', () => {
  const snapshotPath = path.resolve(
    __dirname,
    '../../../../drizzle/meta/0006_snapshot.json',
  );

  it('snapshot file exists', () => {
    expect(fs.existsSync(snapshotPath)).toBe(true);
  });

  it('snapshot contains character_return_messages table with all columns', () => {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const cols = snap.tables['public.character_return_messages'].columns;
    expect(cols.id).toBeDefined();
    expect(cols.user_id).toBeDefined();
    expect(cols.character_id).toBeDefined();
    expect(cols.content).toBeDefined();
    expect(cols.reason).toBeDefined();
    expect(cols.window_start).toBeDefined();
    expect(cols.created_at).toBeDefined();
    expect(cols.read_at).toBeDefined();
    expect(cols.reason.type).toBe('varchar(16)');
  });

  it('snapshot has both indexes', () => {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const indexes = snap.tables['public.character_return_messages'].indexes;
    expect(indexes.character_return_messages_window_unique).toBeDefined();
    expect(indexes.character_return_messages_unread_idx).toBeDefined();
  });

  it('snapshot has both foreign keys', () => {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const fks = snap.tables['public.character_return_messages'].foreignKeys;
    expect(fks['character_return_messages_user_id_users_id_fk']).toBeDefined();
    expect(fks['character_return_messages_character_id_characters_id_fk']).toBeDefined();
  });
});
