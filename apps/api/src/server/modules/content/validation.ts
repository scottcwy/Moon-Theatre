/** Validation shared by draft save, publish and JSON import paths. */
import { ValidationError } from '../../http/errors.js';

export type ContentEntityType = 'script' | 'character';

export interface PromptDraft {
  systemPrompt: string;
  personalityPrompt: string;
  scenarioPrompt: string;
  safetyPrompt: string;
  outputFormatPrompt: string;
}

export interface StarterQuestionsDraft {
  script: string[];
  free: string[];
}

export interface ScriptDraft {
  title: string;
  description: string;
  worldSetting: string;
  slug: string;
  genre: string;
  searchKeywords?: string;
  coverUrl?: string | null;
  sortOrder?: number;
}

export interface CharacterDraft {
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  scriptId?: string | null;
  initialRelationship: string;
  agentId: string;
  starterQuestions: StarterQuestionsDraft;
  prompt: PromptDraft;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ContentValidationError extends ValidationError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(
      `Content validation failed: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    );
    this.name = 'ContentValidationError';
    this.issues = issues;
  }
}

const AGENT_ID = /^role-[a-z0-9][a-z0-9-]{1,62}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

function text(value: unknown, path: string, issues: ValidationIssue[], required = true): string {
  if (typeof value !== 'string') {
    issues.push({ path, message: 'must be a string' });
    return '';
  }
  const result = value.trim();
  if (required && !result) issues.push({ path, message: 'is required' });
  return result;
}

function optionalText(value: unknown, path: string, issues: ValidationIssue[]): string | null {
  if (value == null || value === '') return null;
  return text(value, path, issues, false);
}

function questions(value: unknown, path: string, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'must be an array' });
    return [];
  }
  if (value.length > 12) issues.push({ path, message: 'must contain at most 12 questions' });
  return value.map((item, index) => {
    const question = text(item, `${path}[${index}]`, issues);
    if (question.length > 256) issues.push({ path: `${path}[${index}]`, message: 'must be at most 256 characters' });
    return question;
  });
}

export function validateScriptDraft(input: unknown): ScriptDraft {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const result: ScriptDraft = {
    title: text(value.title, 'title', issues),
    description: text(value.description, 'description', issues),
    worldSetting: text(value.worldSetting, 'worldSetting', issues),
    slug: text(value.slug, 'slug', issues).toLowerCase(),
    genre: text(value.genre, 'genre', issues),
    searchKeywords: optionalText(value.searchKeywords, 'searchKeywords', issues) ?? '',
    coverUrl: optionalText(value.coverUrl, 'coverUrl', issues),
    sortOrder: typeof value.sortOrder === 'number' && Number.isInteger(value.sortOrder) ? value.sortOrder : 0,
  };
  if (result.slug && !SLUG.test(result.slug)) issues.push({ path: 'slug', message: 'must contain lowercase letters, digits and hyphens only' });
  if (result.title.length > 128) issues.push({ path: 'title', message: 'must be at most 128 characters' });
  if (result.slug.length > 128) issues.push({ path: 'slug', message: 'must be at most 128 characters' });
  if (issues.length) throw new ContentValidationError(issues);
  return result;
}

export function validateCharacterDraft(input: unknown): CharacterDraft {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const rawQuestions = (value.starterQuestions && typeof value.starterQuestions === 'object')
    ? value.starterQuestions as Record<string, unknown> : {};
  const rawPrompt = (value.prompt && typeof value.prompt === 'object')
    ? value.prompt as Record<string, unknown> : {};
  const issues: ValidationIssue[] = [];
  const scriptId = value.scriptId == null || value.scriptId === '' ? null : text(value.scriptId, 'scriptId', issues);
  const result: CharacterDraft = {
    name: text(value.name, 'name', issues),
    avatarUrl: text(value.avatarUrl, 'avatarUrl', issues),
    identity: text(value.identity, 'identity', issues),
    description: text(value.description, 'description', issues),
    scriptId,
    initialRelationship: text(value.initialRelationship, 'initialRelationship', issues),
    agentId: text(value.agentId, 'agentId', issues),
    starterQuestions: {
      script: questions(rawQuestions.script, 'starterQuestions.script', issues),
      free: questions(rawQuestions.free, 'starterQuestions.free', issues),
    },
    prompt: {
      systemPrompt: text(rawPrompt.systemPrompt, 'prompt.systemPrompt', issues),
      personalityPrompt: text(rawPrompt.personalityPrompt, 'prompt.personalityPrompt', issues),
      scenarioPrompt: text(rawPrompt.scenarioPrompt, 'prompt.scenarioPrompt', issues),
      safetyPrompt: text(rawPrompt.safetyPrompt, 'prompt.safetyPrompt', issues),
      outputFormatPrompt: text(rawPrompt.outputFormatPrompt, 'prompt.outputFormatPrompt', issues),
    },
  };
  if (result.agentId && !AGENT_ID.test(result.agentId)) issues.push({ path: 'agentId', message: 'must be a stable role-* routing id' });
  if (!scriptId && result.starterQuestions.script.length > 0) {
    issues.push({ path: 'starterQuestions.script', message: 'script questions require a scriptId' });
  }
  if (issues.length) throw new ContentValidationError(issues);
  return result;
}

export function validateContentDraft(entityType: ContentEntityType, input: unknown): ScriptDraft | CharacterDraft {
  return entityType === 'script' ? validateScriptDraft(input) : validateCharacterDraft(input);
}
