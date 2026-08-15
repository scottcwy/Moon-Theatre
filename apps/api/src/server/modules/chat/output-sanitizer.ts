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

const MOOD_TAG_PATTERN = /\[情绪:\s*(Neutral|Happy|Sad|Angry|Thinking|neutral|happy|sad|angry|thinking)\s*\]/g;

export interface StreamingOutputCleaner {
  push(chunk: string): string;
}

// --- Spec 4 流式增量信封守卫 ---
// 整段 JSON 剥离只对完整文本生效；流式增量里每个 delta 只是片段，模型在
// 「改协议-JSON」挑衅下可能从第一个 delta 就以 {"mood": ... 开头，旧规则对
// 片段放行导致信封外泄。这里做状态化守卫：识别到以信封字段起始的片段
// （{"mood" / {"content" / {"type" 等）就丢弃直到闭合 } 的完整对象结束。
// 只对以 { 开头的罕见前缀做短缓冲判定，正常中文文本零缓冲、零首字延迟；
// 非内部字段的 {…}（如 {"only": "动作"}）按误伤控制原样放行，与整段规则一致。
const ENVELOPE_FIELD_KEYS: Set<string> = new Set(JSON_INTERNAL_FIELD_KEYS);
// 以 { 开头的前缀最长判定长度：超过仍未见字段冒号则按非信封放行。
const ENVELOPE_PREFIX_MAX = 64;

/**
 * 判定 work 开头（跳过前导空白）是否为 JSON 信封起始：
 * - 'envelope'：确认为信封字段起始，调用方需丢弃到闭合 }；
 * - 'pending'：以 { 开头但信息不足（未见字段冒号），先缓冲等下一 chunk；
 * - null：非信封，按普通文本处理（不缓冲）。
 */
function classifyEnvelopeStart(work: string): 'envelope' | 'pending' | null {
  const first = work.search(/\S/);
  if (first === -1) {
    return 'pending';
  }
  if (work[first] !== '{') {
    return null;
  }
  let key = '';
  let quote: '"' | "'" | null = null;
  for (let i = first + 1; i < work.length; i += 1) {
    const c = work[i]!;
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        key += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ':') {
      return ENVELOPE_FIELD_KEYS.has(key.trim()) ? 'envelope' : null;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      continue;
    }
    // 非引号 JSON key 允许的字符：字母/数字/下划线；中文等直接判非信封，
    // 避免 `{他顿了顿…` 这类角色动作被缓冲（零首字延迟）。
    if (!/[A-Za-z0-9_]/.test(c)) {
      return null;
    }
    key += c;
  }
  return work.length - first > ENVELOPE_PREFIX_MAX ? null : 'pending';
}

/**
 * 从信封起始 { 之后扫描花括号深度，返回闭合 } 之后的剩余文本；null 表示
 * 尚未闭合（depth 保留给下一 chunk 续扫）。
 */
function scanEnvelopeClose(work: string, depth: number): { depth: number; after: string | null } {
  let d = depth;
  for (let i = 0; i < work.length; i += 1) {
    if (work[i] === '{') {
      d += 1;
    } else if (work[i] === '}') {
      d -= 1;
      if (d === 0) {
        return { depth: 0, after: work.slice(i + 1) };
      }
    }
  }
  return { depth: d, after: null };
}

/**
 * 增量放行的流式清理器：逐 chunk 剥离内部标签块/行、`[情绪: X]` 标签与
 * 流式 JSON 信封，输出可立即下发的净文本（不做整段/整行缓冲，保证首字尽早到达）。
 * 情绪标签可能跨 chunk，保留少量尾部用于补全；内部标签块以 chunk 内完整块为准，
 * 跨 chunk 的块按 Spec 2 取舍（仅行级清理）不保证剥离。
 */
export function createStreamingOutputCleaner(): StreamingOutputCleaner {
  let moodTail = '';
  // 流式信封守卫状态：pending 前缀缓冲 + 丢弃中的信封深度。
  let envelopeBuffer = '';
  let discardingEnvelope = false;
  let envelopeDepth = 0;

  return {
    push(chunk: string): string {
      let work = moodTail + chunk;
      moodTail = '';

      // 0) 流式信封守卫：丢弃以信封字段起始的增量直到闭合 }（见模块注释）。
      if (discardingEnvelope) {
        const scan = scanEnvelopeClose(work, envelopeDepth);
        if (scan.after === null) {
          envelopeDepth = scan.depth;
          return '';
        }
        discardingEnvelope = false;
        envelopeDepth = 0;
        work = scan.after;
        if (!work) return '';
      } else if (envelopeBuffer) {
        work = envelopeBuffer + work;
        envelopeBuffer = '';
      }

      // 判定/续扫以 { 开头的可能信封；闭合后剩余文本可能紧跟下一段，循环处理。
      for (;;) {
        const verdict = classifyEnvelopeStart(work);
        if (verdict === 'pending') {
          envelopeBuffer = work;
          return '';
        }
        if (verdict === null) {
          break;
        }
        const open = work.search(/\S/);
        const scan = scanEnvelopeClose(work.slice(open + 1), 1);
        if (scan.after === null) {
          discardingEnvelope = true;
          envelopeDepth = scan.depth;
          return '';
        }
        work = scan.after;
        if (!work) return '';
      }

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
