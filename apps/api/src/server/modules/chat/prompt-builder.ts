import type { Script, CharacterWithPrompts } from './service.js';

export function buildSystemPrompt(character: CharacterWithPrompts, script: Script | null): string {
  const parts: string[] = [];
  const prompts = character.prompts;

  if (script) {
    const scriptContext = [`剧本：${script.title}`, script.worldSetting].filter(Boolean).join('\n');
    parts.push(scriptContext);
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

  return parts.join('\n\n');
}
