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
const GENERIC_AI_REFUSAL_PATTERN = /(作为(?:一个)?AI(?:语言)?模型|作为人工智能|我(?:无法|不能)回答这个问题|I (?:can'?t|cannot) answer)/i;

export function sanitizeAssistantOutput(text: string): string {
  const withoutInternalBlocks = text.replace(INTERNAL_TAG_BLOCK_PATTERN, '');

  const cleaned = dedupeRepeatedHalves(withoutInternalBlocks
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !INTERNAL_LINE_PATTERN.test(line) && !DANGLING_INTERNAL_TAG_PATTERN.test(line))
    .join('\n')
    .trim());

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
  if (first.length >= 20 && first === second) {
    return first;
  }

  return text;
}
