/**
 * Pure draft-patch construction for the character editor.
 *
 * Kept out of the client component so the exact payload a save sends can be asserted directly: the
 * agent field is system-owned once assigned, while a legacy row captured with `agent_id IS NULL` may
 * name one exactly once (see `updateCharacterDraft`/`publishCharacter` on the service side).
 */

export const PERSONA_FIELDS = ['systemPrompt', 'personalityPrompt', 'scenarioPrompt', 'safetyPrompt', 'outputFormatPrompt'] as const;
export type PersonaField = typeof PERSONA_FIELDS[number];

export const PERSONA_LABELS: Record<PersonaField, string> = {
  systemPrompt: '系统人设（核心，必填）',
  personalityPrompt: '性格人设',
  scenarioPrompt: '场景人设',
  safetyPrompt: '安全约束补充',
  outputFormatPrompt: '输出格式补充',
};

export interface CharacterEditValues {
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  initialRelationship: string;
  sortOrder: string;
  questionsScript: string;
  questionsFree: string;
  /** Stored agent id, or the draft's own value when the stored one is NULL, or ''. */
  agentId: string;
  persona: Record<PersonaField, string>;
}

/** The stored payload shape the editor pre-fills from (published or draft version). */
export interface EditablePayload {
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  initialRelationship: string;
  agentId?: string;
  sortOrder?: number | null;
  starterQuestions: { script: string[]; free: string[] };
  prompt: Record<PersonaField, string>;
}

export function parseQuestions(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean);
}

/** Maps a validation path from the content contract onto a form control. */
export function controlOf(path: string): string {
  if (path.startsWith('prompt.')) return path.slice('prompt.'.length);
  if (path.startsWith('starterQuestions')) return path.startsWith('starterQuestions.script') ? 'questionsScript' : 'questionsFree';
  return path;
}

/**
 * Form values for one stored version. `storedAgentId` is the character row's `agent_id`: when it is
 * NULL the draft's own value (if any) is preselected, so a saved-but-unpublished assignment is not
 * lost from the operator's view; when it is set, that system-owned value always wins.
 */
export function characterEditValues(
  payload: EditablePayload,
  storedAgentId: string | null,
  fallbackSortOrder = 0,
): CharacterEditValues {
  return {
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    identity: payload.identity,
    description: payload.description,
    initialRelationship: payload.initialRelationship,
    sortOrder: String(payload.sortOrder ?? fallbackSortOrder),
    questionsScript: payload.starterQuestions.script.join('\n'),
    questionsFree: payload.starterQuestions.free.join('\n'),
    agentId: storedAgentId ?? payload.agentId ?? '',
    persona: payload.prompt,
  };
}

export interface CharacterPatchInput {
  form: CharacterEditValues;
  initial: CharacterEditValues;
  /** The character row's `agent_id`; NULL means the one-time assignment is still possible. */
  storedAgentId: string | null;
  /** The published roleplay-agent contract ids, the only assignable values. */
  agentOptions: readonly string[];
}

/**
 * Only changed fields travel; the service merges the patch over the stored payload. A character
 * whose stored agent id is NULL always sends the chosen one (so a second save cannot drop the
 * assignment), and a character that already has one never sends `agentId` at all.
 */
export function buildCharacterEditPatch(input: CharacterPatchInput): {
  patch: Record<string, unknown>;
  issues: Record<string, string>;
} {
  const { form, initial, storedAgentId, agentOptions } = input;
  const patch: Record<string, unknown> = {};
  const issues: Record<string, string> = {};
  for (const key of ['name', 'avatarUrl', 'identity', 'description', 'initialRelationship'] as const) {
    if (form[key] !== initial[key]) patch[key] = form[key];
  }
  if (form.sortOrder !== initial.sortOrder) {
    const order = Number(form.sortOrder);
    if (!Number.isInteger(order) || order < 0 || order > 100000) issues.sortOrder = '排序须为 0 到 100000 的整数。';
    else patch.sortOrder = order;
  }
  if (storedAgentId === null) {
    if (!form.agentId) issues.agentId = '请选择要一次性绑定的 Agent 标识后再保存。';
    else if (!agentOptions.includes(form.agentId)) issues.agentId = '请选择一个已发布的角色 Agent 标识。';
    else patch.agentId = form.agentId;
  }
  if (form.questionsScript !== initial.questionsScript || form.questionsFree !== initial.questionsFree) {
    patch.starterQuestions = {
      script: parseQuestions(form.questionsScript),
      free: parseQuestions(form.questionsFree),
    };
  }
  if (PERSONA_FIELDS.some(field => form.persona[field] !== initial.persona[field])) {
    patch.prompt = { ...form.persona };
  }
  return { patch, issues };
}
