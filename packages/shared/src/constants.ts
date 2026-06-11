export const APP_NAME = 'juben-sha';

export const MODEL_TIERS = {
  CASUAL: 'casual',
  STANDARD: 'standard',
  IMMERSIVE: 'immersive',
} as const;

export type ModelTier = (typeof MODEL_TIERS)[keyof typeof MODEL_TIERS];

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  casual: '轻松',
  standard: '标准',
  immersive: '沉浸',
};

export const MOOD_TYPES = {
  NEUTRAL: 'neutral',
  HAPPY: 'happy',
  SAD: 'sad',
  ANGRY: 'angry',
  THINKING: 'thinking',
} as const;

export type MoodType = (typeof MOOD_TYPES)[keyof typeof MOOD_TYPES];

export const MOOD_LABELS: Record<MoodType, string> = {
  neutral: '平静',
  happy: '开心',
  sad: '悲伤',
  angry: '愤怒',
  thinking: '思考中',
};

export const ORDER_STATUSES = {
  CREATED: 'created',
  PREPAY_CREATED: 'prepay_created',
  PAID: 'paid',
  CREDITED: 'credited',
  CLOSED: 'closed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

export const PAYMENT_STATUSES = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

export const WALLET_TX_TYPES = {
  RECHARGE: 'recharge',
  CONSUME: 'consume',
  ADJUST: 'adjust',
} as const;

export type WalletTxType = (typeof WALLET_TX_TYPES)[keyof typeof WALLET_TX_TYPES];

export const BOTTOM_TABS = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'chat', label: '对话', icon: 'chat' },
  { key: 'memory', label: '记忆', icon: 'memory' },
  { key: 'profile', label: '我的', icon: 'profile' },
] as const;