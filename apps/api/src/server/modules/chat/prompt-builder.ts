import type { Script, CharacterWithPrompts } from './service.js';

export interface PromptContext {
  memories?: Array<{ type: string; content: string }>;
  bondLevel?: number;
  bondExp?: number;
}

export function buildSystemPrompt(
  character: CharacterWithPrompts,
  script: Script | null,
  context?: PromptContext
): string {
  const parts: string[] = [];
  const prompts = character.prompts;

  if (script) {
    const scriptContext = [`剧本：${script.title}`, script.worldSetting].filter(Boolean).join('\n');
    parts.push(scriptContext);
  }

  if (context?.bondLevel || context?.bondExp) {
    const bondLine = `当前羁绊等级：Lv.${context.bondLevel ?? 1}`;
    parts.push(bondLine);
  }

  if (prompts?.[0]?.systemPrompt) {
    parts.push(prompts[0].systemPrompt);
  }
  if (prompts?.[0]?.personalityPrompt) {
    parts.push(prompts[0].personalityPrompt);
  }
  if (prompts?.[0]?.scenarioPrompt) {
    parts.push(prompts[0].scenarioPrompt);
  }
  if (prompts?.[0]?.safetyPrompt) {
    parts.push(prompts[0].safetyPrompt);
  }
  if (prompts?.[0]?.outputFormatPrompt) {
    parts.push(prompts[0].outputFormatPrompt);
  }

  if (context?.memories && context.memories.length > 0) {
    const memoryLines = context.memories.map(
      (m) => `[记忆-${m.type}] ${m.content}`
    );
    parts.push('已知信息：\n' + memoryLines.join('\n'));
  }

  return parts.join('\n\n');
}
