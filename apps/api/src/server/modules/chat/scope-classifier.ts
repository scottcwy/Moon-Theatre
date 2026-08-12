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

export interface ScopeClassifierNonBlockingResult {
  classification: ScopeClassification;
  settledInGrace: boolean;
}

export async function classifyChatScope(input: ScopeClassifierInput): Promise<ScopeClassification> {
  if (!config.fastclawBaseUrl || !config.fastclawApiKey) {
    return 'in_scope';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.fastclawTimeoutMs, SCOPE_CLASSIFY_TIMEOUT_MS));
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
              input.assistantDraft
                ? '只判断用户这轮请求和生成草稿是否仍属于当前角色、线索或剧情可可靠回应的范围。'
                : '只判断用户这轮请求是否仍属于当前角色、线索或剧情可可靠回应的范围。',
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

/**
 * 方案 A 用：调用后立即发起分类（不阻塞调用方），返回分类结果与「是否在宽限期内完成」标记。
 * 宽限期从分类自身发起时计时；stream-runner 在生成完成后还会用 SCOPE_CLASSIFY_GRACE_MS
 * 做一次「生成结束后的宽限等待」，未返回即按 in_scope 放行。
 */
export async function classifyChatScopeNonBlocking(input: ScopeClassifierInput): Promise<ScopeClassifierNonBlockingResult> {
  const startedAt = Date.now();
  const classification = await classifyChatScope(input);
  return {
    classification,
    settledInGrace: Date.now() - startedAt <= SCOPE_CLASSIFY_GRACE_MS,
  };
}
