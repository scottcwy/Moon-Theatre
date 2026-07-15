import type { ChatMode, StarterQuestions } from '../../types';

export interface ChatRenderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type ChatModelTier = 'casual' | 'standard' | 'immersive';

export function getInitialModelTier(): ChatModelTier {
  return 'casual';
}

export function createClientMessageId(now = Date.now(), random = Math.random()): string {
  const randomPart = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36);
  return `chat_${now.toString(36)}_${randomPart}`;
}

const STREAM_TIMEOUT_MESSAGE = '这次回应准备得太久了，或换个更具体的问题再试一次吧';
const STREAM_OUT_OF_SCOPE_MESSAGE = '这个问题超出了当前角色和剧情能可靠回应的范围。可以换成和角色、线索或当前剧情更相关的问题。';
const STREAM_IN_PROGRESS_MESSAGE = '上一条回应还在生成，请稍后再试。';
const STREAM_INSUFFICIENT_POINTS_MESSAGE = '点数不足，请先充值后继续。';
const STREAM_GENERIC_FAILURE_MESSAGE = '这次回应没能送达，请稍后再试。';
const STREAM_SCOPE_MISMATCH_MESSAGE = '会话模式已变化，请重新进入对应聊天。';
const STREAM_SCRIPT_UNAVAILABLE_MESSAGE = '该剧本已下架，历史对话仍可查看。';
const STREAM_CLIENT_ID_COLLISION_MESSAGE = '这次发送状态发生冲突，请重新发送一条新消息。';
const STREAM_INPUT_BLOCKED_MESSAGE = '这条内容无法发送，请换一种表达后再试。';
const STREAM_OUTPUT_FILTERED_MESSAGE = '这次回复未通过安全检查，请换个问题再试。';

export function getFriendlyStreamErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized === 'out_of_scope' || normalized.includes('out_of_scope')) {
    return STREAM_OUT_OF_SCOPE_MESSAGE;
  }
  if (normalized === 'timeout' || normalized === 'upstream_incomplete' || normalized.includes('aborted') || normalized.includes('timeout')) {
    return STREAM_TIMEOUT_MESSAGE;
  }
  if (normalized === 'in_progress') {
    return STREAM_IN_PROGRESS_MESSAGE;
  }
  if (normalized === 'insufficient_points' || normalized.includes('insufficient points')) {
    return STREAM_INSUFFICIENT_POINTS_MESSAGE;
  }
  if (normalized === 'session_scope_mismatch') return STREAM_SCOPE_MISMATCH_MESSAGE;
  if (normalized === 'script_unavailable') return STREAM_SCRIPT_UNAVAILABLE_MESSAGE;
  if (normalized === 'client_message_id_collision') return STREAM_CLIENT_ID_COLLISION_MESSAGE;
  if (normalized === 'input_blocked') return STREAM_INPUT_BLOCKED_MESSAGE;
  if (normalized === 'output_filtered') return STREAM_OUTPUT_FILTERED_MESSAGE;
  if (
    normalized === 'upstream_error' ||
    normalized === 'generation_failed' ||
    normalized === 'unknown' ||
    normalized.includes('fastclaw') ||
    normalized.includes('stream error') ||
    normalized.includes('stream request failed')
  ) {
    return STREAM_GENERIC_FAILURE_MESSAGE;
  }
  return /[a-z]/i.test(message) ? STREAM_GENERIC_FAILURE_MESSAGE : message;
}

export function getDefaultChatMode(availableModes: ChatMode[], lastUsedMode: ChatMode | null): ChatMode {
  if (lastUsedMode && availableModes.includes(lastUsedMode)) return lastUsedMode;
  if (availableModes.includes('script')) return 'script';
  return 'free';
}

export interface CharacterScriptMetadata {
  scriptId: string | null;
  script: { id: string; title: string } | null;
}

export interface SessionScriptMetadata {
  scriptId: string | null;
  scriptTitle: string | null;
}

export function resolveCharacterScriptMetadata(
  current: CharacterScriptMetadata | null,
  session: SessionScriptMetadata,
): CharacterScriptMetadata {
  if (session.scriptId) {
    return {
      scriptId: session.scriptId,
      script: { id: session.scriptId, title: session.scriptTitle || '剧本模式' },
    };
  }
  return current || { scriptId: null, script: null };
}

export function getEmptyModeScope(
  mode: ChatMode,
  character: CharacterScriptMetadata,
): { mode: ChatMode; scriptId?: string; scriptTitle?: string } | null {
  if (mode === 'free') return { mode: 'free' };

  const scriptId = character.script?.id || character.scriptId || undefined;
  if (!scriptId) return null;

  return {
    mode: 'script',
    scriptId,
    scriptTitle: character.script?.title,
  };
}

export function getModeLabel(mode: ChatMode): string {
  return mode === 'script' ? '剧本模式' : '自由聊天';
}

export function getVisibleStarterQuestions(
  questions: StarterQuestions,
  mode: ChatMode,
  hasSuccessfulTurn: boolean,
): string[] {
  if (hasSuccessfulTurn) return [];
  return questions[mode].filter((question) => question.trim().length > 0).slice(0, 3);
}

export function applyStarterQuestion(inputValue: string, question: string): { applied: boolean; value: string } {
  if (inputValue.trim()) return { applied: false, value: inputValue };
  return { applied: true, value: question };
}

export function isSuccessfulDoneEvent(result: { blocked?: boolean; outOfScope?: boolean; fallback?: boolean }): boolean {
  return !result.blocked && !result.outOfScope && !result.fallback;
}

export function shouldReconcileStreamError(code: string): boolean {
  const normalized = code.toLowerCase();
  return !['script_unavailable', 'session_scope_mismatch', 'client_message_id_collision', 'input_blocked', 'output_filtered', 'out_of_scope'].includes(normalized);
}

export function shouldRenderStandaloneTypingIndicator(sending: boolean, messages: ChatRenderMessage[]): boolean {
  if (!sending || messages.length === 0) return false;

  const last = messages[messages.length - 1];
  return !(last?.role === 'assistant' && !last.content);
}
