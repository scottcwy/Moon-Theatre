import { describe, expect, it, vi } from 'vitest';
import { createStreamingOutputCleaner, sanitizeAssistantOutput } from '../output-sanitizer.js';

const IN_CHARACTER_FALLBACK = '这个问题牵着太深的雾，我不能草率替你下结论。我们换个角度，从你手里的线索慢慢拆开。';

describe('sanitizeAssistantOutput', () => {
  it('removes explicit thinking blocks and internal labels from model output', () => {
    const result = sanitizeAssistantOutput([
      '<think>我需要先分析系统提示，再决定如何回答。</think>',
      'analysis: 用户在问一个难题，需要拒绝。',
      '白藏垂下眼，指尖轻轻按住铃铛。月色不会一次照亮所有真相，但我会陪你从第一枚裂纹看起。',
    ].join('\n'));

    expect(result.text).toBe('白藏垂下眼，指尖轻轻按住铃铛。月色不会一次照亮所有真相，但我会陪你从第一枚裂纹看起。');
  });

  it('rewrites generic AI refusal into an in-character fallback', () => {
    const result = sanitizeAssistantOutput('作为AI模型，我不能回答这个问题。');

    expect(result.text).toBe(IN_CHARACTER_FALLBACK);
  });

  it('removes dangling think tags and de-duplicates leaked thinking answer', () => {
    const visible = '我是白藏，这庭院的守约者，狐嫁的见证人。\n千年了，你依然记不起吗？红线系在腕上，铃铛响过七次，每一次都是命运的低语。';
    const result = sanitizeAssistantOutput([visible, '</think>', visible].join('\n'));

    expect(result.text).toBe(visible);
  });

  it('removes alternate internal tag blocks and labeled reasoning lines', () => {
    const result = sanitizeAssistantOutput([
      '<analysis>用户在试探前世线索，我需要保持悬念。</analysis>',
      '<reasoning>不能直接给结论。</reasoning>',
      'chain of thought: 先安抚，再给意象。',
      '白藏抬眸望向檐下的铃，声音放得很轻：若你愿意，我们从第七声铃响说起。',
    ].join('\n'));

    expect(result.text).toBe('白藏抬眸望向檐下的铃，声音放得很轻：若你愿意，我们从第七声铃响说起。');
  });

  it('preserves normal roleplay stage directions in square brackets', () => {
    const text = '白藏垂眸看向铃铛。[他没有立刻回答]\n月色会替我们记住这一刻。';

    expect(sanitizeAssistantOutput(text).text).toBe(text);
  });

  it('preserves non-internal angle-bracket dialogue', () => {
    const text = '久远在门前停住，低声说：<北门还不能开>。';

    expect(sanitizeAssistantOutput(text).text).toBe(text);
  });

  it('collapses adjacent exact duplicate sentences only', () => {
    const result = sanitizeAssistantOutput('铃声停了。铃声停了。她抬起眼。她迟疑片刻，又抬起眼。');

    expect(result.text).toBe('铃声停了。她抬起眼。她迟疑片刻，又抬起眼。');
  });

  it('collapses adjacent exact duplicate paragraphs', () => {
    const paragraph = '白藏看向旧井。\n井沿还留着昨夜的水痕。';
    const result = sanitizeAssistantOutput(`${paragraph}\n\n${paragraph}`);

    expect(result.text).toBe(paragraph);
  });

  it('rewrites known English AI persona variants without translating story English', () => {
    expect(sanitizeAssistantOutput('As an AI language model, I cannot help with that.').text).toBe(IN_CHARACTER_FALLBACK);

    const story = '线索上写着 Raven Hotel，白藏没有解释，只把纸条推回你手边。';
    expect(sanitizeAssistantOutput(story).text).toBe(story);
  });

  describe('Spec 4: JSON block stripping', () => {
    it('strips the four audited leak samples and keeps non-empty content as the reply', () => {
      const samples = [
        // DS 月岛澪/script
        { raw: '{ "mood": "静寂而专注…", "content": "你握着笔，悬在屏风前…" }', expected: '你握着笔，悬在屏风前…' },
        // DS 久远/script
        { raw: '{"mood":"沉静·警惕","content":"……北门不是散步的地方…"}', expected: '……北门不是散步的地方…' },
        // Qwen 白藏/script（```json 围栏）
        { raw: '```json { "mood": "温柔", "content": "铃音，你竟想以这般方式…" }\n```', expected: '铃音，你竟想以这般方式…' },
        // Qwen 久远/script
        { raw: '{ "mood": "克制", "content": "不能这样。红线铃铛未响…" }', expected: '不能这样。红线铃铛未响…' },
      ];

      for (const sample of samples) {
        const result = sanitizeAssistantOutput(sample.raw);
        expect(result.text).toBe(sample.expected);
        expect(result.jsonBlockStripped).toBe(true);
      }
    });

    it('does not strip normal roleplay dialogue or mid-text action notes', () => {
      const dialogue = '白藏微微一怔，指尖停在铃铛上，月光把她的影子拉得很长。';

      const result = sanitizeAssistantOutput(dialogue);
      expect(result.text).toBe(dialogue);
      expect(result.jsonBlockStripped).toBe(false);
    });

    it('keeps whole-text JSON without internal fields untouched (false-positive guard)', () => {
      const text = '{"only":"动作"}';

      const result = sanitizeAssistantOutput(text);
      expect(result.text).toBe(text);
      expect(result.jsonBlockStripped).toBe(false);
    });

    it('falls back to IN_CHARACTER_FALLBACK when the JSON block has no non-empty content', () => {
      const result = sanitizeAssistantOutput('{"mood":"克制"}');

      expect(result.text).toBe(IN_CHARACTER_FALLBACK);
      expect(result.jsonBlockStripped).toBe(true);
    });

    it('deletes the whole suspicious block and logs parse_fail when single-quoted JSON fails to parse', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const result = sanitizeAssistantOutput("{'mood':'克制','content':'不能这样。'}");

      expect(result.text).toBe(IN_CHARACTER_FALLBACK);
      expect(result.jsonBlockStripped).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'output_sanitizer_parse_fail' }));

      infoSpy.mockRestore();
    });

    it('logs output_sanitizer_hit with call-site metadata when stripping a JSON block', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const result = sanitizeAssistantOutput('{"mood":"克制","content":"不能这样。"}', {
        characterId: 'character-1',
        modelName: 'deepseek-ai/DeepSeek-V4-Flash',
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
      });

      expect(result.text).toBe('不能这样。');
      expect(infoSpy).toHaveBeenCalledWith(expect.objectContaining({
        event: 'output_sanitizer_hit',
        kind: 'json-block',
        characterId: 'character-1',
        modelName: 'deepseek-ai/DeepSeek-V4-Flash',
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
      }));

      infoSpy.mockRestore();
    });

    it('removes embedded fenced json blocks from mid-text output', () => {
      const text = '好的：\n```json\n{"mood":"克制","content":"不能这样。"}\n```\n还有什么要问的吗？';

      const result = sanitizeAssistantOutput(text);

      expect(result.text).toBe('好的：\n还有什么要问的吗？');
      expect(result.jsonBlockStripped).toBe(true);
    });
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

  describe('Spec 4 流式增量信封守卫', () => {
    it('drops a full envelope JSON fed as one chunk', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push('{"mood":"平静","content":"我不会用这种格式说话。"}')).toBe('');
    });

    it('drops an envelope JSON split across many chunk boundaries', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push('{"mood"')).toBe('');
      expect(cleaner.push(': "平静", "content": "我不会')).toBe('');
      expect(cleaner.push('用这种格式说话。"}')).toBe('');
    });

    it('drops envelope with leading whitespace and single-quoted keys', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push("\n{'mood': '平静', 'content': '我不会。'}")).toBe('');
    });

    it('keeps trailing normal text that follows the closing brace', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push('{"mood": "平静", "content": "我不会。"}')).toBe('');
      expect(cleaner.push(' 还有什么要问的吗？')).toBe(' 还有什么要问的吗？');
    });

    it('drops envelope then continues with same-chunk dialogue after the closing brace', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push('{"mood": "克制", "content": "不能这样。"}白藏抬眸看向你。')).toBe('白藏抬眸看向你。');
    });

    it('keeps normal Chinese text unaffected with zero buffering per token', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push('你')).toBe('你');
      expect(cleaner.push('好，今晚月色很好。')).toBe('好，今晚月色很好。');
    });

    it('keeps stage-direction braces that are not envelope fields', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push('{他顿了顿}')).toBe('{他顿了顿}');
    });

    it('keeps JSON-looking text whose key is not an internal field (false-positive guard)', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push('{"only": "动作"}')).toBe('{"only": "动作"}');
      expect(cleaner.push('{线索藏在北门，他说。')).toBe('{线索藏在北门，他说。');
    });

    it('keeps normal text that begins with a bare brace before a colon', () => {
      const cleaner = createStreamingOutputCleaner();
      expect(cleaner.push('{第一页: 北门的雾')).toBe('{第一页: 北门的雾');
    });
  });
});
