import { describe, expect, it } from 'vitest';
import { createStreamingOutputCleaner, sanitizeAssistantOutput } from '../output-sanitizer.js';

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

  it('removes dangling think tags and de-duplicates leaked thinking answer', () => {
    const visible = '我是白藏，这庭院的守约者，狐嫁的见证人。\n千年了，你依然记不起吗？红线系在腕上，铃铛响过七次，每一次都是命运的低语。';
    const result = sanitizeAssistantOutput([visible, '</think>', visible].join('\n'));

    expect(result).toBe(visible);
  });

  it('removes alternate internal tag blocks and labeled reasoning lines', () => {
    const result = sanitizeAssistantOutput([
      '<analysis>用户在试探前世线索，我需要保持悬念。</analysis>',
      '<reasoning>不能直接给结论。</reasoning>',
      'chain of thought: 先安抚，再给意象。',
      '白藏抬眸望向檐下的铃，声音放得很轻：若你愿意，我们从第七声铃响说起。',
    ].join('\n'));

    expect(result).toBe('白藏抬眸望向檐下的铃，声音放得很轻：若你愿意，我们从第七声铃响说起。');
  });

  it('preserves normal roleplay stage directions in square brackets', () => {
    const text = '白藏垂眸看向铃铛。[他没有立刻回答]\n月色会替我们记住这一刻。';

    expect(sanitizeAssistantOutput(text)).toBe(text);
  });

  it('preserves non-internal angle-bracket dialogue', () => {
    const text = '久远在门前停住，低声说：<北门还不能开>。';

    expect(sanitizeAssistantOutput(text)).toBe(text);
  });

  it('collapses adjacent exact duplicate sentences only', () => {
    const result = sanitizeAssistantOutput('铃声停了。铃声停了。她抬起眼。她迟疑片刻，又抬起眼。');

    expect(result).toBe('铃声停了。她抬起眼。她迟疑片刻，又抬起眼。');
  });

  it('collapses adjacent exact duplicate paragraphs', () => {
    const paragraph = '白藏看向旧井。\n井沿还留着昨夜的水痕。';
    const result = sanitizeAssistantOutput(`${paragraph}\n\n${paragraph}`);

    expect(result).toBe(paragraph);
  });

  it('rewrites known English AI persona variants without translating story English', () => {
    expect(sanitizeAssistantOutput('As an AI language model, I cannot help with that.')).toBe('这个问题牵着太深的雾，我不能草率替你下结论。我们换个角度，从你手里的线索慢慢拆开。');

    const story = '线索上写着 Raven Hotel，白藏没有解释，只把纸条推回你手边。';
    expect(sanitizeAssistantOutput(story)).toBe(story);
  });
});

describe('createStreamingOutputCleaner', () => {
  it('strips a mood tag in a single chunk without adding trailing newlines', () => {
    const cleaner = createStreamingOutputCleaner();
    expect(cleaner.push('你好，今晚月色很好。[情绪: Happy]')).toBe('你好，今晚月色很好。');
  });

  it('completes a mood tag that spans chunks and strips it', () => {
    const cleaner = createStreamingOutputCleaner();
    expect(cleaner.push('你好，[情绪: Ha')).toBe('你好，');
    expect(cleaner.push('ppy]')).toBe('');
  });

  it('emits partial lines immediately so the first token is not buffered', () => {
    const cleaner = createStreamingOutputCleaner();
    expect(cleaner.push('你')).toBe('你');
    expect(cleaner.push('好。')).toBe('好。');
  });

  it('strips a complete internal think block within one chunk', () => {
    const cleaner = createStreamingOutputCleaner();
    expect(cleaner.push('<think>我应该表现出悲伤。</think>你好。')).toBe('你好。');
  });

  it('strips complete internal labeled lines and keeps normal text', () => {
    const cleaner = createStreamingOutputCleaner();
    expect(cleaner.push('analysis: 内部推理\n白藏抬眸。')).toBe('白藏抬眸。');
  });

  it('preserves normal roleplay stage directions and angle-bracket dialogue', () => {
    const cleaner = createStreamingOutputCleaner();
    expect(cleaner.push('白藏垂眸。[他没有立刻回答]\n他说：<北门还不能开>。')).toBe('白藏垂眸。[他没有立刻回答]\n他说：<北门还不能开>。');
  });
});
