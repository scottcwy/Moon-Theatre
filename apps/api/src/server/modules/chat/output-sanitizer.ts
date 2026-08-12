const IN_CHARACTER_FALLBACK = '这个问题牵着太深的雾，我不能草率替你下结论。我们换个角度，从你手里的线索慢慢拆开。';

const INTERNAL_LINE_PATTERN = /^(?:analysis|reasoning|chain[- ]?of[- ]?thought|system|assistant_visible|developer)\s*[:：].*$/i;
const INTERNAL_TAG_NAMES = [
  'think',
  'thinking',
  'analysis',
  'reasoning',
  'chain-of-thought',
  'chain_of_thought',
  'cot',
  'scratchpad',
  'internal_monologue',
  'reflection',
].join('|');
const INTERNAL_TAG_BLOCK_PATTERN = new RegExp(`<(?:${INTERNAL_TAG_NAMES})\\b[^>]*>[\\s\\S]*?<\\/(?:${INTERNAL_TAG_NAMES})>`, 'gi');
const DANGLING_INTERNAL_TAG_PATTERN = new RegExp(`^<\\/?(?:${INTERNAL_TAG_NAMES})\\b[^>]*>$`, 'i');
const GENERIC_AI_REFUSAL_PATTERN = /(作为(?:一个)?AI(?:语言)?模型|作为人工智能|我是(?:AI|人工智能)|我的系统提示|As an AI language model|I am an AI|I (?:can'?t|cannot) (?:answer|help with that)|我(?:无法|不能)回答这个问题)/i;

export function sanitizeAssistantOutput(text: string): string {
  const withoutInternalBlocks = text.replace(INTERNAL_TAG_BLOCK_PATTERN, '');

  const cleaned = collapseAdjacentDuplicateSentences(dedupeRepeatedHalves(withoutInternalBlocks
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !INTERNAL_LINE_PATTERN.test(line) && !DANGLING_INTERNAL_TAG_PATTERN.test(line))
    .join('\n')
    .trim()));

  if (!cleaned || GENERIC_AI_REFUSAL_PATTERN.test(cleaned)) {
    return IN_CHARACTER_FALLBACK;
  }

  return cleaned;
}

function dedupeRepeatedHalves(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length % 2 !== 0) {
    return text;
  }

  const midpoint = lines.length / 2;
  const first = lines.slice(0, midpoint).join('\n');
  const second = lines.slice(midpoint).join('\n');
  if (first === second) {
    return first;
  }

  return text;
}

function collapseAdjacentDuplicateSentences(text: string): string {
  return text.replace(/([^。！？!?]+[。！？!?])\1+/g, '$1');
}

const MOOD_TAG_PATTERN = /\[情绪:\s*(Neutral|Happy|Sad|Angry|Thinking|neutral|happy|sad|angry|thinking)\s*\]/g;

export interface StreamingOutputCleaner {
  push(chunk: string): string;
}

/**
 * 增量放行的流式清理器：逐 chunk 剥离内部标签块/行与 `[情绪: X]` 标签，
 * 输出可立即下发的净文本（不做整段/整行缓冲，保证首字尽早到达）。
 * 情绪标签可能跨 chunk，保留少量尾部用于补全；内部标签块以 chunk 内完整块为准，
 * 跨 chunk 的块按 Spec 2 取舍（仅行级清理）不保证剥离。
 */
export function createStreamingOutputCleaner(): StreamingOutputCleaner {
  let moodTail = '';

  return {
    push(chunk: string): string {
      let work = moodTail + chunk;
      moodTail = '';

      // 1) 本 chunk 内完整内部标签块剥离
      work = work.replace(INTERNAL_TAG_BLOCK_PATTERN, '');

      // 2) 剥离情绪标签；结尾疑似未闭合标签保留少量尾部，等下一个 chunk 补全
      work = work.replace(MOOD_TAG_PATTERN, '');
      const partialMood = work.match(/\[情绪:[^\]]*$/i);
      if (partialMood) {
        moodTail = partialMood[0];
        work = work.slice(0, work.length - moodTail.length);
      }

      // 3) 完整行才做内部行/悬挂标签过滤；半行原样放行（保 TTFT）
      const lines = work.split('\n');
      const kept: string[] = [];
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        const isCompleteLine = i < lines.length - 1 || work.endsWith('\n');
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (isCompleteLine && (INTERNAL_LINE_PATTERN.test(trimmed) || DANGLING_INTERNAL_TAG_PATTERN.test(trimmed))) {
          continue;
        }
        kept.push(line);
      }
      return kept.join('\n');
    },
  };
}
