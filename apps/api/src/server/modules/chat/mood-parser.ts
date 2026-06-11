const MOOD_REGEX = /\[情绪:\s*(Neutral|Happy|Sad|Angry|Thinking|neutral|happy|sad|angry|thinking)\s*\]/;

type MoodType = 'neutral' | 'happy' | 'sad' | 'angry' | 'thinking';

export function parseMood(text: string): { mood: MoodType | null; cleanedText: string } {
  const match = text.match(MOOD_REGEX);
  if (!match) {
    return { mood: null, cleanedText: text };
  }
  const mood = match[1]!.toLowerCase() as MoodType;
  const cleanedText = text.replace(MOOD_REGEX, '').trim();
  return { mood, cleanedText };
}
