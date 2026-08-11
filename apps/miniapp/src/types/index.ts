export type { User, Character, ChatSession, Message, Relationship, Memory, QuotaPackage, Order, Payment, WalletAccount, WalletTransaction, ModelUsageLog } from '@juben-sha/shared';
export { MODEL_TIERS, MODEL_TIER_LABELS, MOOD_TYPES, MOOD_LABELS, ORDER_STATUSES, PAYMENT_STATUSES, WALLET_TX_TYPES, BOTTOM_TABS } from '@juben-sha/shared';
export type { ModelTier, MoodType, OrderStatus, PaymentStatus, WalletTxType } from '@juben-sha/shared';

export type ChatMode = 'script' | 'free';

export type CharacterGender = 'male' | 'female';

export interface StarterQuestions {
  script: string[];
  free: string[];
}

export interface RelationshipView {
  bondLevel: number;
  bondExp: number;
}
