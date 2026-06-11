import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { blockedKeywords, reviewLogs } from '../../db/schema.js';

export interface FilterResult {
  blocked: boolean;
  matchedKeyword: string | null;
}

async function loadBlockedKeywords(): Promise<string[]> {
  const rows = await db
    .select({ keyword: blockedKeywords.keyword })
    .from(blockedKeywords)
    .where(eq(blockedKeywords.enabled, true));

  return rows.map((r) => r.keyword);
}

function matchesKeywords(text: string, keywords: string[]): string | null {
  const lowerText = text.toLowerCase();
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      return kw;
    }
  }
  return null;
}

export async function checkInput(
  message: string,
  sessionId: string,
  userId: string,
  messageId?: string,
): Promise<FilterResult> {
  const keywords = await loadBlockedKeywords();
  const matched = matchesKeywords(message, keywords);

  if (matched) {
    await db.insert(reviewLogs).values({
      sessionId,
      messageId: messageId ?? null,
      reviewerId: userId,
      status: 'flagged',
      note: `Auto-flagged: keyword "${matched}" matched in user input`,
    });
    return { blocked: true, matchedKeyword: matched };
  }

  return { blocked: false, matchedKeyword: null };
}

export async function checkOutput(
  content: string,
  sessionId: string,
  messageId?: string,
): Promise<FilterResult> {
  const keywords = await loadBlockedKeywords();
  const matched = matchesKeywords(content, keywords);

  if (matched) {
    await db.insert(reviewLogs).values({
      sessionId,
      messageId: messageId ?? null,
      status: 'flagged',
      note: `Auto-flagged: keyword "${matched}" matched in AI output`,
    });
    return { blocked: true, matchedKeyword: matched };
  }

  return { blocked: false, matchedKeyword: null };
}
