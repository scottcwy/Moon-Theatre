import { describe, it, expect } from 'vitest';
import { extractCandidateMemories } from '../extractor.js';
import type { CandidateMemory } from '../extractor.js';

function extractFirstOfType(memories: CandidateMemory[], type: string): CandidateMemory | undefined {
  return memories.find((m) => m.type === type);
}

describe('extractCandidateMemories', () => {
  describe('user_info patterns', () => {
    it('extracts self-name from user text', () => {
      const result = extractCandidateMemories('我叫张三，很高兴认识你', '你好张三，我是这里的守夜人。');
      const userInfo = extractFirstOfType(result, 'user_info');
      expect(userInfo).toBeDefined();
      expect(userInfo!.content).toContain('张三');
    });

    it('extracts origin from user text', () => {
      const result = extractCandidateMemories('我来自北方的小镇', '北方来的旅人啊，月见庭院欢迎你。');
      const userInfo = extractFirstOfType(result, 'user_info');
      expect(userInfo).toBeDefined();
      expect(userInfo!.content).toContain('北方');
    });

    it('extracts profession/identity from user text', () => {
      const result = extractCandidateMemories('我是做药材生意的', '药材生意？在这座庭院里可不容易。');
      const userInfo = extractFirstOfType(result, 'user_info');
      expect(userInfo).toBeDefined();
      expect(userInfo!.content).toContain('药材');
    });

    it('does not attribute assistant statements to user_info', () => {
      const result = extractCandidateMemories('今天天气不错', '我叫李明，我是这里的守卫。');
      const userInfo = extractFirstOfType(result, 'user_info');
      expect(userInfo).toBeUndefined();
    });

    it('deduplicates identical candidate memories', () => {
      const result = extractCandidateMemories('我叫张三', '张三你好，我叫张三。');
      const userInfoCount = result.filter((m) => m.type === 'user_info').length;
      expect(userInfoCount).toBeLessThanOrEqual(1);
    });
  });

  describe('relationship patterns', () => {
    it('detects trust statements from character', () => {
      const result = extractCandidateMemories('你好', '我信任你，把这件事交给你。');
      const rel = extractFirstOfType(result, 'relationship');
      expect(rel).toBeDefined();
      expect(rel!.content).toContain('信任');
    });

    it('detects defensive statements', () => {
      const result = extractCandidateMemories('你说的是真的吗', '我防备你，因为你来得太突然。');
      const rel = extractFirstOfType(result, 'relationship');
      expect(rel).toBeDefined();
      expect(rel!.content).toContain('防备');
    });
  });

  describe('story patterns', () => {
    it('detects garden-related event mentions', () => {
      const result = extractCandidateMemories('月见庭院的红线为什么一直响', '那是狐嫁契约留下的铃铛。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeDefined();
      expect(story!.content).toContain('月见庭院');
    });

    it('detects key plot keywords', () => {
      const result = extractCandidateMemories('有什么线索吗', '我在北门发现了一页新娘名册。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeDefined();
    });

    it('detects quest/mission mentions', () => {
      const result = extractCandidateMemories('有什么需要我做的吗', '是的，我有一项任务要委托给你。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeDefined();
      expect(story!.content).toContain('任务');
    });
  });

  describe('fallback behavior', () => {
    it('returns fallback story memory when no pattern matches', () => {
      const result = extractCandidateMemories('嗯', '嗯。');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.type).toBe('story');
      expect(result[0]!.content).toContain('用户说');
    });
  });

  describe('max candidates limit', () => {
    it('returns at most 3 candidates per turn', () => {
      const longText = '我叫张三，我来自北方，我是做药材生意的。月见庭院的铃铛很响，我需要你的帮助，我信任你。';
      const result = extractCandidateMemories(longText, '好的，我帮你调查。');
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });
});
