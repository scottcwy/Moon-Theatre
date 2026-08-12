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

    it('keeps concrete preference content instead of generic fixed string', () => {
      const result = extractCandidateMemories(
        '我喜欢吃草莓，最喜欢下雨天。记住这一点。',
        '记住了，你爱吃草莓。',
      );
      const userInfo = extractFirstOfType(result, 'user_info');
      expect(userInfo).toBeDefined();
      expect(userInfo!.content).toBe('用户喜欢「吃草莓」');
      expect(userInfo!.content).not.toContain('用户表达了偏好/情感倾向');
    });

    it('keeps concrete past-experience content instead of generic fixed string', () => {
      const result = extractCandidateMemories('我以前在江南水乡长大', '江南的雨确实很温柔。');
      const userInfo = extractFirstOfType(result, 'user_info');
      expect(userInfo).toBeDefined();
      expect(userInfo!.content).toContain('江南水乡');
      expect(userInfo!.content).not.toContain('用户提及过往经历');
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
    it('extracts user-provided plot facts with concrete content', () => {
      const result = extractCandidateMemories('月见庭院的红线为什么一直响', '那是狐嫁契约留下的铃铛。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeDefined();
      expect(story!.content).toContain('月见庭院');
      expect(story!.content).not.toContain('月见庭院中的事件被讨论');
    });

    it('captures the specific location/clue the user provided', () => {
      const result = extractCandidateMemories('北门的结界裂了', '我去查看一下。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeDefined();
      expect(story!.content).toContain('北门');
      expect(story!.content).toContain('结界');
      expect(story!.content).not.toContain('被提及');
    });

    it('does NOT extract story from assistant text alone', () => {
      const result = extractCandidateMemories('有什么线索吗', '我在北门发现了一页新娘名册。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeUndefined();
    });

    it('does NOT fall back to story for plain chat without plot keywords', () => {
      const result = extractCandidateMemories('有什么需要我做的吗', '是的，我有一项任务要委托给你。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeUndefined();
    });
  });

  describe('meta command guard', () => {
    it('does not store meta instructions as story', () => {
      const result = extractCandidateMemories('以后回复不要带情绪标签。', '好的。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeUndefined();
      expect(result.length).toBe(0);
    });

    it('does not misfire on normal dialogue with only one side of the combined rule', () => {
      // 「不要」命中指令词，但无 回复/输出/回答/格式/协议 类词，不判为 meta。
      const result = extractCandidateMemories('你不要走，北门的结界还需要你。', '我不走。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeDefined();
      expect(story!.content).toContain('北门');
    });

    it('does not treat 「请用茶」 as a meta instruction', () => {
      // 「请用」命中指令词，但无 回复/输出/回答/格式/协议 类词；且无剧情关键词，不落兜底 story。
      const result = extractCandidateMemories('请用茶，慢慢说。', '好茶。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeUndefined();
    });
  });

  describe('fallback behavior', () => {
    it('keyword-hit user text always yields a story memory (pattern or fallback)', () => {
      const result = extractCandidateMemories('北门那边好像出事了', '我马上去看看。');
      const story = extractFirstOfType(result, 'story');
      expect(story).toBeDefined();
      expect(story!.content).toContain('北门');
    });

    it('returns no memory for empty/no-keyword chat', () => {
      const result = extractCandidateMemories('嗯', '嗯。');
      expect(result.length).toBe(0);
    });
  });

  describe('max candidates limit', () => {
    it('returns at most 2 candidates per turn', () => {
      const longText = '我叫张三，我来自北方，我是做药材生意的。月见庭院的铃铛很响，我需要你的帮助，我信任你。';
      const result = extractCandidateMemories(longText, '好的，我帮你调查。');
      expect(result.length).toBeLessThanOrEqual(2);
    });
  });
});
