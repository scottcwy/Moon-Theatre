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

/**
 * 生成一条角色回访留言。
 * 复用 fastclaw streamChat 非流式收集完整文本；失败/超时/空内容时用运营模板兜底。
 * 永不抛错、永不返回空字符串。
 */
export async function generateReturnMessageContent(character: {
  name: string;
  systemPrompt: string | null;
  personalityPrompt: string | null;
}): Promise<string> {
  const roleContext = [character.systemPrompt, character.personalityPrompt]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');

  const deltas: string[] = [];
  let sawDone = false;

  try {
    for await (const event of streamChat(roleContext, FIXED_RETURN_MESSAGE_INSTRUCTIONS, {
      timeoutMs: RETURN_MESSAGE_TIMEOUT_MS,
    })) {
      if (event.type === 'delta') {
        deltas.push(event.content);
      } else if (event.type === 'error') {
        return pickReturnMessageTemplate(character.name);
      } else if (event.type === 'done') {
        sawDone = true;
      }
    }
  } catch {
    return pickReturnMessageTemplate(character.name);
  }

  const text = deltas.join('').trim();
  if (!sawDone || text.length === 0) {
    return pickReturnMessageTemplate(character.name);
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
