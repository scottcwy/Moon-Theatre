import { config } from '../../config/index.js';

export type ScopeClassification = 'in_scope' | 'out_of_scope';

export const SCOPE_CLASSIFY_TIMEOUT_MS = 3_000;
export const SCOPE_CLASSIFY_GRACE_MS = 500;

export interface ScopeClassifierInput {
  userMessage: string;
  assistantDraft?: string;
  characterName: string;
  characterIdentity: string;
  scriptTitle?: string;
  worldSetting?: string;
}

export interface ScopeClassificationResult {
  classification: ScopeClassification;
  settledInGrace: boolean;
}

async function requestScopeClassification(input: ScopeClassifierInput): Promise<ScopeClassification> {
  if (!config.fastclawBaseUrl || !config.fastclawApiKey) {
    return 'in_scope';
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(config.fastclawTimeoutMs, SCOPE_CLASSIFY_TIMEOUT_MS),
  );
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.fastclawApiKey}`,
    };
    if (config.fastclawAgentId) {
      headers['x-fastclaw-agent-id'] = config.fastclawAgentId;
    }

    const response = await fetch(`${config.fastclawBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        stream: false,
        messages: [
          {
            role: 'system',
            content: [
              '你是剧本杀角色扮演聊天的范围分类器。',
              '只判断用户这轮请求和生成草稿是否仍属于当前角色、线索或剧情可可靠回应的范围。',
              '只输出 in_scope 或 out_of_scope，不要输出解释。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `角色：${input.characterName}（${input.characterIdentity}）`,
              input.scriptTitle ? `剧本：${input.scriptTitle}` : '',
              input.worldSetting ? `世界观：${input.worldSetting}` : '',
              `用户消息：${input.userMessage}`,
              input.assistantDraft ? `助手草稿：${input.assistantDraft}` : '',
            ].filter(Boolean).join('\n'),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Scope classifier responded with status ${response.status}`);
    }
    const parsed = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = String(parsed.choices?.[0]?.message?.content ?? '').trim().toLowerCase();
    if (content === 'in_scope' || content === 'out_of_scope') {
      return content;
    }
    throw new Error('Scope classifier returned invalid output');
  } finally {
    clearTimeout(timeout);
  }
}

export async function classifyChatScope(input: ScopeClassifierInput): Promise<ScopeClassification> {
  return requestScopeClassification(input);
}

/**
 * 非阻塞分类：发起请求后立即返回 Promise，不等待生成结束。
 * - 请求成功/失败都会落定：settledInGrace=true 表示分类已得出终态（含失败回退 in_scope）；
 * - 只有调用方在宽限期（SCOPE_CLASSIFY_GRACE_MS）内未等到结果时，settledInGrace=false。
 * 失败统一快速回退 in_scope，且不阻塞主链路。
 */
export function classifyChatScopeNonBlocking(input: ScopeClassifierInput): Promise<ScopeClassificationResult> {
  return requestScopeClassification(input).then(
    (classification) => ({ classification, settledInGrace: true }),
    (error) => {
      console.warn({
        event: 'scope_classifier_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return { classification: 'in_scope', settledInGrace: true };
    },
  );
}

/** 生成结束后再给分类结果留 SCOPE_CLASSIFY_GRACE_MS 宽限期；超时即按 in_scope 放行。 */
export async function settleScopeWithinGrace(
  promise: Promise<ScopeClassificationResult>,
  graceMs = SCOPE_CLASSIFY_GRACE_MS,
): Promise<ScopeClassificationResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<ScopeClassificationResult>((resolve) => {
        timer = setTimeout(() => resolve({ classification: 'in_scope', settledInGrace: false }), graceMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
