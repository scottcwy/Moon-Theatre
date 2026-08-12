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

// --- Spec 4：JSON 块剥离 ---
// 整段被 ```json … ``` 包裹的块：先拆掉围栏，交给整段 JSON 对象规则处理。
const WHOLE_FENCED_JSON_PATTERN = /^\s*```json\s*([\s\S]*?)```\s*$/i;
// 正文中段出现的 ```json … ``` 块：直接整体删除（协议产物，宁删勿错）。
const EMBEDDED_FENCED_JSON_PATTERN = /```json[\s\S]*?```/gi;
// 整段 JSON 对象：以 { 起、以 } 止。
const WHOLE_JSON_OBJECT_PATTERN = /^\s*\{[\s\S]*\}\s*$/;
// 内部字段名（解析成功路径与疑似块识别共用，覆盖 spec 4.1-1/4.1-4 字段并集）。
const JSON_INTERNAL_FIELD_KEYS = ['mood', 'content', 'type', 'message', 'emotion', 'reply'] as const;
const SUSPICIOUS_JSON_FIELD_PATTERN = /["']?(?:mood|content|type|message|emotion|reply)["']?\s*:/i;

export interface SanitizeAssistantOutputMetadata {
  characterId?: string;
  modelName?: string;
  sessionId?: string;
  userMessageId?: string;
}

export interface SanitizeAssistantOutputResult {
  text: string;
  /** 是否剥离/删除了 JSON 块（含解析失败整块删除），供调用点计入 model_usage_logs.errorCode。 */
  jsonBlockStripped: boolean;
}

export function sanitizeAssistantOutput(
  text: string,
  metadata: SanitizeAssistantOutputMetadata = {},
): SanitizeAssistantOutputResult {
  const withoutJson = stripJsonBlocks(text, metadata);
  const withoutInternalBlocks = withoutJson.text.replace(INTERNAL_TAG_BLOCK_PATTERN, '');

  const cleaned = collapseAdjacentDuplicateSentences(dedupeRepeatedHalves(withoutInternalBlocks
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !INTERNAL_LINE_PATTERN.test(line) && !DANGLING_INTERNAL_TAG_PATTERN.test(line))
    .join('\n')
    .trim()));

  if (!cleaned || GENERIC_AI_REFUSAL_PATTERN.test(cleaned)) {
    return { text: IN_CHARACTER_FALLBACK, jsonBlockStripped: withoutJson.jsonBlockStripped };
  }

  return { text: cleaned, jsonBlockStripped: withoutJson.jsonBlockStripped };
}

function stripJsonBlocks(text: string, metadata: SanitizeAssistantOutputMetadata): { text: string; jsonBlockStripped: boolean } {
  const wholeFencedMatch = WHOLE_FENCED_JSON_PATTERN.exec(text);
  if (wholeFencedMatch) {
    const inner = wholeFencedMatch[1] ?? '';
    const stripped = stripWholeJsonObject(inner, metadata);
    return stripped.jsonBlockStripped ? stripped : { text: inner.trim(), jsonBlockStripped: false };
  }

  const withoutFenced = text.replace(EMBEDDED_FENCED_JSON_PATTERN, '');
  if (withoutFenced !== text) {
    logJsonBlockHit(metadata);
  }

  const whole = stripWholeJsonObject(withoutFenced, metadata);
  return { text: whole.text, jsonBlockStripped: (withoutFenced !== text) || whole.jsonBlockStripped };
}

function stripWholeJsonObject(text: string, metadata: SanitizeAssistantOutputMetadata): { text: string; jsonBlockStripped: boolean } {
  if (!WHOLE_JSON_OBJECT_PATTERN.test(text) || !SUSPICIOUS_JSON_FIELD_PATTERN.test(text)) {
    return { text, jsonBlockStripped: false };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && JSON_INTERNAL_FIELD_KEYS.some((key) => Object.prototype.hasOwnProperty.call(parsed, key))) {
      logJsonBlockHit(metadata);
      const content = parsed.content;
      // content 非空时以其值作为清理后文本；否则整块删除，空值由调用方 !cleaned 兜底。
      if (typeof content === 'string' && content.trim() !== '') {
        return { text: content, jsonBlockStripped: true };
      }
      return { text: '', jsonBlockStripped: true };
    }
    // 可解析但无内部字段：误伤控制，原样保留。
    return { text, jsonBlockStripped: false };
  } catch {
    // 疑似 JSON 块（单引号/无引号 key 等）解析失败：宁删勿错，整块删除。
    console.info({ event: 'output_sanitizer_parse_fail', ...metadata });
    return { text: '', jsonBlockStripped: true };
  }
}

function logJsonBlockHit(metadata: SanitizeAssistantOutputMetadata): void {
  console.info({ event: 'output_sanitizer_hit', kind: 'json-block', ...metadata });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
