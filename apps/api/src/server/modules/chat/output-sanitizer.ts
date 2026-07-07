const IN_CHARACTER_FALLBACK = '这个问题牵着太深的雾，我不能草率替你下结论。我们换个角度，从你手里的线索慢慢拆开。';

const INTERNAL_LINE_PATTERN = /^(?:analysis|reasoning|chain[- ]?of[- ]?thought|system|assistant_visible|developer)\s*[:：].*$/i;
const GENERIC_AI_REFUSAL_PATTERN = /(作为(?:一个)?AI(?:语言)?模型|作为人工智能|我(?:无法|不能)回答这个问题|I (?:can'?t|cannot) answer)/i;

export function sanitizeAssistantOutput(text: string): string {
  const withoutThinkBlocks = text
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, '');

  const cleaned = withoutThinkBlocks
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !INTERNAL_LINE_PATTERN.test(line))
    .join('\n')
    .trim();

  if (!cleaned || GENERIC_AI_REFUSAL_PATTERN.test(cleaned)) {
    return IN_CHARACTER_FALLBACK;
  }

  return cleaned;
}
