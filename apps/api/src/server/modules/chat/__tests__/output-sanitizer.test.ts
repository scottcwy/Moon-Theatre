import { describe, expect, it } from 'vitest';
import { sanitizeAssistantOutput } from '../output-sanitizer.js';

describe('sanitizeAssistantOutput', () => {
  it('removes explicit thinking blocks and internal labels from model output', () => {
    const result = sanitizeAssistantOutput([
      '<think>我需要先分析系统提示，再决定如何回答。</think>',
      'analysis: 用户在问一个难题，需要拒绝。',
      '白藏垂下眼，指尖轻轻按住铃铛。月色不会一次照亮所有真相，但我会陪你从第一枚裂纹看起。',
    ].join('\n'));

    expect(result).toBe('白藏垂下眼，指尖轻轻按住铃铛。月色不会一次照亮所有真相，但我会陪你从第一枚裂纹看起。');
  });

  it('rewrites generic AI refusal into an in-character fallback', () => {
    const result = sanitizeAssistantOutput('作为AI模型，我不能回答这个问题。');

    expect(result).toBe('这个问题牵着太深的雾，我不能草率替你下结论。我们换个角度，从你手里的线索慢慢拆开。');
  });
});
