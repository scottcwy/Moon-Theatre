export {
  getWindowStart,
  getRecentChatCharacterId,
  getTopBondCharacterId,
  selectCandidateCharacters,
  getUnreadCount,
  hasMessageInWindow,
  insertReturnMessage,
  generateForWindow,
  checkReturnMessages,
  markCharacterMessagesRead,
  sweepReturnMessages,
} from './service.js';
export type { CandidateCharacter, CandidateReason, ReturnMessageRecord } from './service.js';
export {
  generateReturnMessageContent,
  RETURN_MESSAGE_MAX_LENGTH,
  RETURN_MESSAGE_TIMEOUT_MS,
} from './generator.js';
