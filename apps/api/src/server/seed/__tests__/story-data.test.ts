import { describe, expect, it } from 'vitest';
import { legacyScriptTitle, seedCharacters, seedScripts } from '../story-data.js';

const moonGarden = seedScripts.find((script) => script.slug === 'moon-garden')!;
const moonTower = seedScripts.find((script) => script.slug === 'moon-tower')!;

describe('seed story data', () => {
  it('defines three scripts and nineteen prompt-driven agents', () => {
    expect(seedScripts.map((script) => script.slug)).toEqual(['moon-garden', 'moon-tower', 'yunyun']);
    expect(seedScripts.map((script) => script.title)).toEqual(['月见庭院：狐神的新娘', '流氓叙事', '芸芸']);

    expect(seedCharacters.map((character) => character.name)).toEqual([
      '白藏',
      '贺茂清玄',
      '月岛澪',
      '久远',
      '程聿怀',
      '蒋伯驾',
      '程走柳',
      '缪宏谟',
      '黛利拉',
      '以撒',
      '羌青瓷',
      '奥丁',
      '阿奇',
      '南窗',
      '赋霄',
      '岑奕岚',
      '季沧海',
      '知何',
      '叶上秋',
    ]);
  });

  it('keeps the Moon Garden script fields', () => {
    expect(moonGarden.worldSetting).toContain('只在满月出现');
    expect(moonGarden.genre).toBe('和风悬疑');
    expect(moonGarden.searchKeywords).toContain('狐神');
    expect(moonGarden.searchKeywords).toContain('月见庭院');
    expect(moonGarden.coverUrl).toBeNull();
    expect(moonGarden.sortOrder).toBe(0);
    expect(moonGarden.status).toBe('active');
  });

  it('defines the Moon Tower script', () => {
    expect(moonTower.title).toBe('流氓叙事');
    expect(moonTower.slug).toBe('moon-tower');
    expect(moonTower.genre).toBe('现代情感');
    expect(moonTower.searchKeywords).toContain('布雷诺');
    expect(moonTower.searchKeywords).toContain('流氓叙事');
    expect(moonTower.coverUrl).toBeNull();
    expect(moonTower.sortOrder).toBe(1);
    expect(moonTower.status).toBe('active');
  });

  it('assigns every character to a script slug with correct grouping', () => {
    for (const character of seedCharacters) {
      expect(character.scriptSlug).toBeDefined();
      expect(seedScripts.some((script) => script.slug === character.scriptSlug)).toBe(true);
      expect(character.status).toBe('active');
    }
    expect(seedCharacters.filter((character) => character.scriptSlug === 'moon-garden')).toHaveLength(4);
    expect(seedCharacters.filter((character) => character.scriptSlug === 'moon-tower')).toHaveLength(9);
    expect(seedCharacters.filter((character) => character.scriptSlug === 'yunyun')).toHaveLength(6);
  });

  it('defines the YunYun script', () => {
    const yunyun = seedScripts.find((script) => script.slug === 'yunyun')!;
    expect(yunyun.title).toBe('芸芸');
    expect(yunyun.genre).toBe('古风仙侠情感');
    expect(yunyun.searchKeywords).toContain('云乡');
    expect(yunyun.coverUrl).toBeNull();
    expect(yunyun.sortOrder).toBe(2);
    expect(yunyun.status).toBe('active');
  });

  it('gives every YunYun character the dream acquaintance relationship', () => {
    for (const character of seedCharacters.filter((c) => c.scriptSlug === 'yunyun')) {
      expect(character.initialRelationship).toBe('似曾相识的梦中旧识');
      expect(character.prompt).toBeDefined();
      expect(character.prompt.systemPrompt.length).toBeGreaterThan(20);
      expect(character.prompt.personalityPrompt.length).toBeGreaterThan(20);
      expect(character.prompt.scenarioPrompt.length).toBeGreaterThan(0);
      expect(character.prompt.safetyPrompt.length).toBeGreaterThan(0);
      expect(character.prompt.outputFormatPrompt.length).toBeGreaterThan(0);
    }
  });

  it('gives every Moon Tower character the Brenow acquaintance relationship', () => {
    for (const character of seedCharacters.filter((c) => c.scriptSlug === 'moon-tower')) {
      expect(character.initialRelationship).toBe('初识于布雷诺');
    }
  });

  it('points character avatars at processed miniapp assets', () => {
    expect(seedCharacters.map((character) => character.avatarUrl)).toEqual([
      '/assets/characters/hakuzo.jpg',
      '/assets/characters/kiyoharu.jpg',
      '/assets/characters/mio.jpg',
      '/assets/characters/kuon.jpg',
      '/assets/characters/chengyuhuai.jpg',
      '/assets/characters/jiangbojia.jpg',
      '/assets/characters/chengzouliu.jpg',
      '/assets/characters/miaohongmo.jpg',
      '/assets/characters/delilah.jpg',
      '/assets/characters/isaac.jpg',
      '/assets/characters/qiangqingci.jpg',
      '/assets/characters/odin.jpg',
      '/assets/characters/archie.jpg',
      '/assets/characters/nanchuang.jpg',
      '/assets/characters/fuxiao.jpg',
      '/assets/characters/cenyilan.jpg',
      '/assets/characters/jicanghai.jpg',
      '/assets/characters/zhihe.jpg',
      '/assets/characters/yeshangqiu.jpg',
    ]);
  });

  it('does not seed mood tag output instructions', () => {
    const serialized = JSON.stringify({ seedScripts, seedCharacters });

    expect(serialized).not.toContain('[情绪:');
    expect(serialized).not.toContain('当前情绪标签');
  });

  // ── starterQuestions structure on all characters ──
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

  // ── spoiler guard on user-facing fields ──
  it('user-facing seed fields contain no spoiler terms', () => {
    const spoilerTerms = ['延迟', '怒河', '受控燃烧', '解离', '献祭', '1990', '卧底', '杀手', '牺牲', '死亡', '复活', 'SECRET-'];
    const texts: string[] = [];
    for (const script of seedScripts) {
      texts.push(script.description, script.worldSetting);
    }
    for (const character of seedCharacters) {
      texts.push(
        character.description,
        character.identity,
        character.initialRelationship,
        ...character.starterQuestions.script,
        ...character.starterQuestions.free,
      );
    }
    for (const text of texts) {
      expect(text).not.toMatch(/T0\d/);
      for (const term of spoilerTerms) {
        expect(text).not.toContain(term);
      }
    }
  });

  // ── themed starter questions ──
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

  it('程聿怀 has reporter/truth themed script questions', () => {
    const chengyuhuai = seedCharacters.find((c) => c.name === '程聿怀')!;
    expect(chengyuhuai.starterQuestions.script.some((q) => q.includes('真相') || q.includes('孤挺花'))).toBe(true);
  });

  it('阿奇 has magician themed script questions', () => {
    const archie = seedCharacters.find((c) => c.name === '阿奇')!;
    expect(archie.starterQuestions.script.some((q) => q.includes('魔术') || q.includes('大义'))).toBe(true);
  });
});

// ============================================================
// Legacy script deletion contract
// ============================================================
describe('legacy script status', () => {
  it('legacyScriptTitle is 夜色围城', () => {
    expect(legacyScriptTitle).toBe('夜色围城');
  });

  it('legacy script title is NOT in active seed data', () => {
    expect(seedScripts.map((script) => script.title)).not.toContain('夜色围城');
  });

  it('all seeded scripts use status active', () => {
    for (const script of seedScripts) {
      expect(script.status).toBe('active');
    }
  });

  it('former legacy characters are promoted into Moon Tower as active', () => {
    for (const name of ['蒋伯驾', '程聿怀', '以撒']) {
      const character = seedCharacters.find((c) => c.name === name)!;
      expect(character).toBeDefined();
      expect(character.scriptSlug).toBe('moon-tower');
      expect(character.status).toBe('active');
    }
  });
});
