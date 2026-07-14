import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// ============================================================
// Migration SQL Contract Tests — 0005 P1 scripts catalog + starterQuestions
// ============================================================
describe('0005_scripts_catalog_and_starter_questions.sql', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../../drizzle/0005_scripts_catalog_and_starter_questions.sql',
  );

  function readSql(): string {
    return fs.readFileSync(migrationPath, 'utf-8');
  }

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // --- nullable column additions ---
  it('adds slug varchar(128) to scripts', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ADD\s+COLUMN\s+"slug"\s+varchar\s*\(\s*128\s*\)/i);
  });

  it('adds genre varchar(128) to scripts', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ADD\s+COLUMN\s+"genre"\s+varchar\s*\(\s*128\s*\)/i);
  });

  it('adds search_keywords text to scripts', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ADD\s+COLUMN\s+"search_keywords"\s+text/i);
  });

  it('adds cover_url varchar(512) to scripts (nullable)', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ADD\s+COLUMN\s+"cover_url"\s+varchar\s*\(\s*512\s*\)/i);
  });

  it('adds sort_order integer to scripts', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ADD\s+COLUMN\s+"sort_order"\s+integer/i);
  });

  it('adds starter_questions jsonb to characters', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"characters"\s+ADD\s+COLUMN\s+"starter_questions"\s+jsonb/i);
  });

  // --- backfill: slug determinism ---
  it('backfills slug for Moon Garden script with stable value moon-garden', () => {
    const sql = readSql();
    expect(sql).toMatch(/'moon-garden'/);
    expect(sql).toMatch(/月见庭院：狐神的新娘/);
  });

  it('backfills slug for Night Siege script with stable value night-siege', () => {
    const sql = readSql();
    expect(sql).toMatch(/'night-siege'/);
    expect(sql).toMatch(/夜色围城/);
  });

  it('resolves duplicate slugs by assigning id-derived slugs to later rows', () => {
    const sql = readSql();
    expect(sql).toMatch(/ROW_NUMBER/i);
    expect(sql).toMatch(/"slug"/);
    // rn > 1 (quoted column reference: r."rn" > 1)
    expect(sql).toMatch(/"rn"\s*>\s*1/);
    // id-derived fallback pattern
    expect(sql).toMatch(/replace\(.*"id".*::text/);
  });

  it('provides id-derived fallback slug for any remaining NULL or empty slug', () => {
    const sql = readSql();
    expect(sql).toMatch(/script-'\s*\|\|\s*replace/i);
    // Must cover both NULL and empty string
    const fallbackMatch = sql.match(/"slug"\s+IS\s+NULL\s+OR\s+"slug"\s*=\s*''/);
    expect(fallbackMatch).not.toBeNull();
  });

  // --- backfill: genre ---
  it('backfills genre with deterministic non-NULL values', () => {
    const sql = readSql();
    expect(sql).toMatch(/'和风悬疑'/);
    expect(sql).toMatch(/'都市悬疑'/);
    // Fallback genre for edge cases
    expect(sql).toMatch(/未分类/);
  });

  // --- backfill: search_keywords ---
  it('backfills search_keywords with empty string', () => {
    const sql = readSql();
    expect(sql).toMatch(/search_keywords["\s]*=\s*''/i);
  });

  // --- backfill: sort_order ---
  it('backfills sort_order with zero', () => {
    const sql = readSql();
    expect(sql).toMatch(/"sort_order"\s*=\s*0/i);
  });

  it('normalizes legacy inactive scripts to retired', () => {
    const sql = readSql();
    expect(sql).toMatch(/SET\s+"status"\s*=\s*'retired'/i);
    expect(sql).toMatch(/WHERE\s+"status"\s*=\s*'inactive'/i);
  });

  // --- backfill: starter_questions ---
  it('backfills starter_questions with empty arrays for old characters', () => {
    const sql = readSql();
    expect(sql).toMatch(/\{"script":\[\s*\],"free":\[\s*\]\}/);
    expect(sql).toMatch(/starter_questions.*IS\s+NULL/i);
  });

  // --- NOT NULL constraints ---
  it('sets slug NOT NULL after backfill', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ALTER\s+COLUMN\s+"slug"\s+SET\s+NOT\s+NULL/i);
  });

  it('sets genre NOT NULL after backfill', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ALTER\s+COLUMN\s+"genre"\s+SET\s+NOT\s+NULL/i);
  });

  it('sets search_keywords NOT NULL after backfill', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ALTER\s+COLUMN\s+"search_keywords"\s+SET\s+NOT\s+NULL/i);
  });

  it('sets sort_order NOT NULL after backfill', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"scripts"\s+ALTER\s+COLUMN\s+"sort_order"\s+SET\s+NOT\s+NULL/i);
  });

  it('sets starter_questions NOT NULL after backfill', () => {
    const sql = readSql();
    expect(sql).toMatch(/ALTER\s+TABLE\s+"characters"\s+ALTER\s+COLUMN\s+"starter_questions"\s+SET\s+NOT\s+NULL/i);
  });

  // --- DEFAULT values ---
  it('sets DEFAULT for search_keywords', () => {
    const sql = readSql();
    expect(sql).toMatch(/search_keywords.*SET\s+DEFAULT\s+''/i);
  });

  it('sets DEFAULT for sort_order', () => {
    const sql = readSql();
    expect(sql).toMatch(/sort_order.*SET\s+DEFAULT\s+0/i);
  });

  it('sets DEFAULT for starter_questions', () => {
    const sql = readSql();
    expect(sql).toMatch(/starter_questions.*SET\s+DEFAULT\s+'\{/i);
  });

  // --- unique constraint ---
  it('adds unique constraint on scripts.slug', () => {
    const sql = readSql();
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+"scripts_slug_unique"\s+UNIQUE/i);
  });

  // --- constraints added AFTER backfill ---
  it('backfills slug before setting NOT NULL', () => {
    const sql = readSql();
    const backfillSlug = sql.search(/'moon-garden'/);
    const setNotNull = sql.search(/ALTER\s+TABLE\s+"scripts"\s+ALTER\s+COLUMN\s+"slug"\s+SET\s+NOT\s+NULL/i);
    expect(backfillSlug).toBeLessThan(setNotNull);
  });

  it('backfills slug before adding unique constraint', () => {
    const sql = readSql();
    const fallbackSlug = sql.search(/script-'\s*\|\|\s*replace/i);
    const uniqueConst = sql.search(/ADD\s+CONSTRAINT\s+"scripts_slug_unique"/i);
    expect(fallbackSlug).toBeLessThan(uniqueConst);
  });

  // --- does NOT touch frozen 0004 changes ---
  it('does NOT contain ALTER for chat_sessions mode/script_id', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"chat_sessions"/i);
  });

  it('does NOT contain ALTER for memories scope/script_id', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"memories"/i);
  });

  it('does NOT contain ALTER for users preferred_name', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"users"/i);
  });

  it('does NOT create chat_mode or memory_scope enums (P0)', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/CREATE\s+TYPE.*chat_mode/i);
    expect(sql).not.toMatch(/CREATE\s+TYPE.*memory_scope/i);
  });

  // --- no destructive operations ---
  it('does NOT DELETE FROM any table', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });

  it('does NOT DROP any column', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });

  // --- SQL style: repeatable / idempotent ---
  it('uses statement-breakpoint separators', () => {
    const sql = readSql();
    expect(sql).toContain('--> statement-breakpoint');
  });

  it('unique constraint uses idempotent DO block', () => {
    const sql = readSql();
    // The ADD CONSTRAINT is inside a DO block with duplicate_object exception
    const uniqueSection = sql.slice(sql.indexOf('scripts_slug_unique') - 200, sql.indexOf('scripts_slug_unique') + 200);
    expect(uniqueSection).toMatch(/DO\s+\$\$/i);
    expect(uniqueSection).toMatch(/duplicate_object/i);
  });
});

// ============================================================
// Drizzle Schema Tests — P1 new columns
// ============================================================
describe('Drizzle schema P1 changes', () => {
  it('scripts table has slug column mapped to slug', async () => {
    const schema = await import('../schema.js');
    expect(schema.scripts.slug).toBeDefined();
    expect(schema.scripts.slug.name).toBe('slug');
  });

  it('scripts.slug is unique', async () => {
    const schema = await import('../schema.js');
    expect(schema.scripts.slug.isUnique).toBe(true);
  });

  it('scripts table has genre column', async () => {
    const schema = await import('../schema.js');
    expect(schema.scripts.genre).toBeDefined();
    expect(schema.scripts.genre.name).toBe('genre');
  });

  it('scripts table has searchKeywords column mapped to search_keywords', async () => {
    const schema = await import('../schema.js');
    expect(schema.scripts.searchKeywords).toBeDefined();
    expect(schema.scripts.searchKeywords.name).toBe('search_keywords');
  });

  it('scripts table has coverUrl column mapped to cover_url (nullable)', async () => {
    const schema = await import('../schema.js');
    expect(schema.scripts.coverUrl).toBeDefined();
    expect(schema.scripts.coverUrl.name).toBe('cover_url');
    expect(schema.scripts.coverUrl.notNull).toBe(false);
  });

  it('scripts table has sortOrder column mapped to sort_order', async () => {
    const schema = await import('../schema.js');
    expect(schema.scripts.sortOrder).toBeDefined();
    expect(schema.scripts.sortOrder.name).toBe('sort_order');
  });

  it('characters table has starterQuestions column mapped to starter_questions', async () => {
    const schema = await import('../schema.js');
    expect(schema.characters.starterQuestions).toBeDefined();
    expect(schema.characters.starterQuestions.name).toBe('starter_questions');
  });

  it('characters.starterQuestions has default value with script and free arrays', async () => {
    const schema = await import('../schema.js');
    const col = schema.characters.starterQuestions;
    // Column should have a SQL-level default
    expect(col.default).toBeDefined();
  });

  it('scripts.status is varchar(32) capable of storing retired', async () => {
    const schema = await import('../schema.js');
    expect(schema.scripts.status).toBeDefined();
    expect(schema.scripts.status.name).toBe('status');
    // varchar(32) — not an enum, so 'retired' is a valid string value
    expect(schema.scripts.status.dataType).toBe('string');
  });
});

// ============================================================
// Journal integrity tests
// ============================================================
describe('Migration journal integrity', () => {
  const journalPath = path.resolve(
    __dirname,
    '../../../../drizzle/meta/_journal.json',
  );

  it('journal has entry for 0005 with correct tag', () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    const entry = journal.entries.find(
      (e: { tag: string }) => e.tag === '0005_scripts_catalog_and_starter_questions',
    );
    expect(entry).toBeDefined();
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
// Snapshot integrity tests
// ============================================================
describe('0005 snapshot integrity', () => {
  const snapshotPath = path.resolve(
    __dirname,
    '../../../../drizzle/meta/0005_snapshot.json',
  );

  it('snapshot file exists', () => {
    expect(fs.existsSync(snapshotPath)).toBe(true);
  });

  it('snapshot contains scripts table with P1 columns', () => {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const scriptCols = snap.tables['public.scripts'].columns;
    expect(scriptCols.slug).toBeDefined();
    expect(scriptCols.slug.notNull).toBe(true);
    expect(scriptCols.genre).toBeDefined();
    expect(scriptCols.genre.notNull).toBe(true);
    expect(scriptCols.search_keywords).toBeDefined();
    expect(scriptCols.search_keywords.notNull).toBe(true);
    expect(scriptCols.cover_url).toBeDefined();
    expect(scriptCols.cover_url.notNull).toBe(false);
    expect(scriptCols.sort_order).toBeDefined();
    expect(scriptCols.sort_order.notNull).toBe(true);
  });

  it('snapshot contains characters table with starter_questions', () => {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const charCols = snap.tables['public.characters'].columns;
    expect(charCols.starter_questions).toBeDefined();
    expect(charCols.starter_questions.notNull).toBe(true);
  });

  it('snapshot has unique constraint on scripts.slug', () => {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const uniqueConstraints = snap.tables['public.scripts'].uniqueConstraints || {};
    const slugConstraint = Object.values(uniqueConstraints).find(
      (c: any) => c.name === 'scripts_slug_unique',
    );
    expect(slugConstraint).toBeDefined();
  });

  it('snapshot contains P0 enums chat_mode and memory_scope', () => {
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    // The snapshot should have enums defined (P0 changes are cumulative)
    const enums = snap.enums || {};
    expect(enums['public.chat_mode']).toBeDefined();
    expect(enums['public.memory_scope']).toBeDefined();
  });
});
