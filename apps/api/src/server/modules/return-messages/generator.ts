import { config } from '../../config/index.js';
import { streamChat } from '../fastclaw/adapter.js';
import { fallbackReturnMessageTemplates, returnMessageTemplates } from '../../seed/return-message-templates.js';

/** 留言生成专用短超时（毫秒）：一次性低成本调用，不沿用聊天默认的 120s 超时。 */
export const RETURN_MESSAGE_TIMEOUT_MS = 15_000;

/** 生成内容的字符上限，按 Unicode 码点截断。 */
export const RETURN_MESSAGE_MAX_LENGTH = 200;

/**
 * 固定指令（作为 userMessage，角色内容在前、固定指令在后）。
 * 要求以角色口吻写 1-2 句回访留言，表达惦记/邀请回来，不剧透、不用表情符号/Markdown。
 */
const FIXED_RETURN_MESSAGE_INSTRUCTIONS =
  '请以该角色的口吻写 1-2 句回访留言，表达对用户的惦记并邀请用户回来。不要提及具体剧情，不要剧透，不要使用表情符号或 Markdown 标记。';

// 角色 Agent 架构下的动态上下文：角色身份由 FastClaw 角色卡（SOUL/IDENTITY）承担，
// API 只发生成任务约束；F10 x-fastclaw-no-persist 保证不落库、不触发记忆。
const RETURN_MESSAGE_ROLEPLAY_SYSTEM_CONTEXT = [
  '生成一条角色回访留言：以角色口吻表达对用户的惦记并邀请用户回来。',
  '不要提及具体剧情、不剧透、不使用表情符号或 Markdown 标记；只输出角色对白。',
].join('\n');

export interface ReturnMessageGenerationTarget {
  characterName: string;
  systemPrompt: string | null;
  personalityPrompt: string | null;
  /** 角色 Agent id（characters.agentId），开关内必须存在。 */
  agentId: string | null;
  /** 产品 userId（x-fastclaw-user-id）。 */
  userId: string;
  /** 目标自由会话 key（可选）：F10 只读获取上下文，不写入。 */
  sessionKey?: string | null;
}

/**
 * 生成一条角色回访留言。
 * 开关内：走角色 Agent（agentId + userId + scope=free + noPersist），不再直拼角色 prompt；
 * 关闭开关：保持现状（角色 prompt + 固定指令）。
 * 失败/超时/空内容时用运营模板兜底。永不抛错、永不返回空字符串。
 */
export async function generateReturnMessageContent(target: ReturnMessageGenerationTarget): Promise<string> {
  const deltas: string[] = [];
  let sawDone = false;

  try {
    let systemPrompt: string;
    let options: Parameters<typeof streamChat>[2] = { timeoutMs: RETURN_MESSAGE_TIMEOUT_MS };
    if (config.useRoleplayAgents) {
      systemPrompt = RETURN_MESSAGE_ROLEPLAY_SYSTEM_CONTEXT;
      options = {
        timeoutMs: RETURN_MESSAGE_TIMEOUT_MS,
        agentId: target.agentId ?? undefined,
        userId: target.userId,
        scope: 'free',
        noPersist: true,
        ...(target.sessionKey ? { sessionId: target.sessionKey } : {}),
      };
    } else {
      systemPrompt = [target.systemPrompt, target.personalityPrompt]
        .filter((part): part is string => Boolean(part))
        .join('\n\n');
    }

    for await (const event of streamChat(systemPrompt, FIXED_RETURN_MESSAGE_INSTRUCTIONS, options)) {
      if (event.type === 'delta') {
        deltas.push(event.content);
      } else if (event.type === 'error') {
        return pickReturnMessageTemplate(target.characterName);
      } else if (event.type === 'done') {
        // adapter 内置兜底流（FastClaw 未配置或 fallbackEnabled）产出的是通用聊天文本，
        // 不表达惦记/邀请回来，视为失败，走运营模板兜底。
        if (event.fallback === true) {
          return pickReturnMessageTemplate(target.characterName);
        }
        sawDone = true;
      }
    }
  } catch {
    return pickReturnMessageTemplate(target.characterName);
  }

  const text = deltas.join('').trim();
  if (!sawDone || text.length === 0) {
    return pickReturnMessageTemplate(target.characterName);
  }

  return truncateToMaxLength(text);
}

function pickReturnMessageTemplate(characterName: string): string {
  const characterTemplate = returnMessageTemplates[characterName]?.[0];
  if (characterTemplate) {
    return characterTemplate;
  }
  // seed 保证 fallbackReturnMessageTemplates 非空，索引 0 恒存在。
  return fallbackReturnMessageTemplates[0]!;
}

function truncateToMaxLength(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= RETURN_MESSAGE_MAX_LENGTH) {
    return text;
  }
  return chars.slice(0, RETURN_MESSAGE_MAX_LENGTH).join('');
}
