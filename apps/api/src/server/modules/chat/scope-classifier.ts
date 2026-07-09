import { config } from '../../config/index.js';

export type ScopeClassification = 'in_scope' | 'out_of_scope';

export interface ScopeClassifierInput {
  userMessage: string;
  assistantDraft: string;
  characterName: string;
  characterIdentity: string;
  scriptTitle?: string;
  worldSetting?: string;
}

export async function classifyChatScope(input: ScopeClassifierInput): Promise<ScopeClassification> {
  if (!config.fastclawBaseUrl || !config.fastclawApiKey) {
    return 'in_scope';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.fastclawTimeoutMs, 10_000));
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
              `助手草稿：${input.assistantDraft}`,
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
