import { describe, it, expect } from 'vitest';
import { parseMood } from '../mood-parser.js';

describe('parseMood', () => {
  it('extracts Neutral mood and cleans text', () => {
    const result = parseMood('你好。很高兴见到你。[情绪: Neutral]');
    expect(result.mood).toBe('neutral');
    expect(result.cleanedText).toBe('你好。很高兴见到你。');
  });

  it('extracts Happy mood with lowercase tag', () => {
    const result = parseMood('今天真是美好的一天！[情绪: happy]');
    expect(result.mood).toBe('happy');
    expect(result.cleanedText).toBe('今天真是美好的一天！');
  });

  it('extracts Sad mood', () => {
    const result = parseMood('或许我们不该相遇。[情绪: Sad]');
    expect(result.mood).toBe('sad');
  });

  it('extracts Angry mood', () => {
    const result = parseMood('你竟敢如此！[情绪: Angry]');
    expect(result.mood).toBe('angry');
  });

  it('extracts Thinking mood', () => {
    const result = parseMood('嗯……让我想想。[情绪: Thinking]');
    expect(result.mood).toBe('thinking');
  });

  it('returns null mood when no mood tag present', () => {
    const result = parseMood('这是一个普通的消息，没有情绪标签。');
    expect(result.mood).toBeNull();
    expect(result.cleanedText).toBe('这是一个普通的消息，没有情绪标签。');
  });

  it('handles text with mood tag in middle', () => {
    const result = parseMood('前半句 [情绪: Happy] 后半句');
    expect(result.mood).toBe('happy');
    expect(result.cleanedText).toBe('前半句  后半句');
  });

  it('handles whitespace variations in mood tag', () => {
    const result = parseMood('文字[情绪:   Neutral   ]结束');
    expect(result.mood).toBe('neutral');
    expect(result.cleanedText).toBe('文字结束');
  });

  it('does not match invalid mood values', () => {
    const result = parseMood('文字[情绪: Excited]结束');
    expect(result.mood).toBeNull();
    expect(result.cleanedText).toBe('文字[情绪: Excited]结束');
  });
});
