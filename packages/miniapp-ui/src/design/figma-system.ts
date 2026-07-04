import type { MoodType } from '../types';

export const FIGMA_MOOD_LABELS: Record<MoodType, string> = {
  neutral: '平静',
  happy: '愉悦',
  sad: '低落',
  angry: '愠怒',
  thinking: '思索中',
};

export function getFigmaMoodLabel(mood: MoodType): string {
  return FIGMA_MOOD_LABELS[mood] ?? '平静';
}
