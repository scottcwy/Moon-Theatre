import { describe, expect, it } from 'vitest';
import { legacyScriptTitle, seedCharacters, seedScript } from '../story-data.js';

describe('moon garden seed story data', () => {
  it('defines the Moon Garden script and four prompt-driven agents', () => {
    expect(seedScript.title).toBe('月见庭院：狐神的新娘');
    expect(seedScript.worldSetting).toContain('只在满月出现');

    expect(seedCharacters.map((character) => character.name)).toEqual([
      '白藏',
      '贺茂清玄',
      '月岛澪',
      '久远',
    ]);
  });

  it('does not retain Night Siege characters in the active seed story', () => {
    const serialized = JSON.stringify({ seedScript, seedCharacters });

    expect(serialized).not.toContain('夜色围城');
    expect(serialized).not.toContain('蒋伯驾');
    expect(serialized).not.toContain('程聿怀');
    expect(serialized).not.toContain('以撒');
  });

  it('points character avatars at processed miniapp assets', () => {
    expect(seedCharacters.map((character) => character.avatarUrl)).toEqual([
      '/assets/characters/hakuzo.jpg',
      '/assets/characters/kiyoharu.jpg',
      '/assets/characters/mio.jpg',
      '/assets/characters/kuon.jpg',
    ]);
  });

  it('does not seed mood tag output instructions', () => {
    const serialized = JSON.stringify({ seedScript, seedCharacters });

    expect(serialized).not.toContain('[情绪:');
    expect(serialized).not.toContain('当前情绪标签');
  });

  // ── P1: slug ──
  it('has stable slug moon-garden for Moon Garden script', () => {
    expect(seedScript.slug).toBe('moon-garden');
  });

  // ── P1: genre, searchKeywords, coverUrl, sortOrder ──
  it('has genre 和风悬疑', () => {
    expect(seedScript.genre).toBe('和风悬疑');
  });

  it('has searchKeywords covering狐神 and 月见庭院', () => {
    expect(seedScript.searchKeywords).toContain('狐神');
    expect(seedScript.searchKeywords).toContain('月见庭院');
  });

  it('coverUrl is null (no cover image yet)', () => {
    expect(seedScript.coverUrl).toBeNull();
  });

  it('sortOrder is 0', () => {
    expect(seedScript.sortOrder).toBe(0);
  });

  // ── P1: starterQuestions structure on all characters ──
  it('every active character has starterQuestions with script and free arrays', () => {
    for (const c of seedCharacters) {
      expect(c.starterQuestions).toBeDefined();
      expect(Array.isArray(c.starterQuestions.script)).toBe(true);
      expect(Array.isArray(c.starterQuestions.free)).toBe(true);
    }
  });

  it('starterQuestions.script has 1–3 items per character', () => {
    for (const c of seedCharacters) {
      expect(c.starterQuestions.script.length).toBeGreaterThanOrEqual(1);
      expect(c.starterQuestions.script.length).toBeLessThanOrEqual(3);
    }
  });

  it('starterQuestions.free has 1–3 items per character', () => {
    for (const c of seedCharacters) {
      expect(c.starterQuestions.free.length).toBeGreaterThanOrEqual(1);
      expect(c.starterQuestions.free.length).toBeLessThanOrEqual(3);
    }
  });

  it('starterQuestions each item is 1–100 characters and not a placeholder', () => {
    const placeholders = ['question', 'placeholder', 'TODO', 'TBD', '问题', '占位'];
    for (const c of seedCharacters) {
      for (const q of [...c.starterQuestions.script, ...c.starterQuestions.free]) {
        expect(q.length).toBeGreaterThanOrEqual(1);
        expect(q.length).toBeLessThanOrEqual(100);
        for (const ph of placeholders) {
          expect(q.toLowerCase()).not.toContain(ph.toLowerCase());
        }
      }
    }
  });

  it('白藏 has Japanese-fantasy themed script questions', () => {
    const hakuzo = seedCharacters.find((c) => c.name === '白藏')!;
    expect(hakuzo.starterQuestions.script.some((q) => q.includes('狐嫁') || q.includes('庭院'))).toBe(true);
  });

  it('贺茂清玄 has 阴阳师 themed script questions', () => {
    const kiyoharu = seedCharacters.find((c) => c.name === '贺茂清玄')!;
    expect(kiyoharu.starterQuestions.script.some((q) => q.includes('阴阳寮') || q.includes('缘线') || q.includes('斩'))).toBe(true);
  });

  it('月岛澪 has painter/memory themed script questions', () => {
    const mio = seedCharacters.find((c) => c.name === '月岛澪')!;
    expect(mio.starterQuestions.script.some((q) => q.includes('画') || q.includes('名册') || q.includes('新娘'))).toBe(true);
  });

  it('久远 has north-gate/atonement themed script questions', () => {
    const kuon = seedCharacters.find((c) => c.name === '久远')!;
    expect(kuon.starterQuestions.script.some((q) => q.includes('北门') || q.includes('赎罪') || q.includes('百年'))).toBe(true);
  });

  it('free questions are casual/non-plot oriented', () => {
    for (const c of seedCharacters) {
      for (const q of c.starterQuestions.free) {
        // Free mode questions shouldn't ask about plot mysteries
        expect(q).not.toContain('百年前');
        expect(q).not.toContain('北门');
        expect(q).not.toContain('阴阳寮');
      }
    }
  });
});

// ============================================================
// Legacy script status contract
// ============================================================
describe('legacy script status', () => {
  it('legacyScriptTitle is 夜色围城', () => {
    expect(legacyScriptTitle).toBe('夜色围城');
  });

  it('legacy script title is NOT in active seed data', () => {
    expect(seedScript.title).not.toBe('夜色围城');
  });

  it('active seed script uses status active', () => {
    expect(seedScript.status).toBe('active');
  });

  it('legacy characters are not in seedCharacters', () => {
    const names = seedCharacters.map((c) => c.name);
    expect(names).not.toContain('蒋伯驾');
    expect(names).not.toContain('程聿怀');
    expect(names).not.toContain('以撒');
  });

  // The seed/index.ts sets legacy script to 'retired' at runtime.
  // This test verifies the data contract that the seed does not
  // accidentally activate legacy content.
  it('seedScript does not contain retired as its own status', () => {
    expect(seedScript.status).not.toBe('retired');
    expect(seedScript.status).not.toBe('inactive');
  });
});
