import type { ModelTier, MoodType, OrderStatus, PaymentStatus, WalletTxType } from './constants.js';

export interface User {
  id: string;
  openid: string;
  nickname: string | null;
  avatarUrl: string | null;
  status: 'active' | 'banned';
  createdAt: Date;
  updatedAt: Date;
}

export interface Character {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  scriptId: string;
  initialRelationship: string;
  sortOrder: number;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatSession {
  id: string;
  userId: string;
  characterId: string;
  title: string | null;
  modelTier: ModelTier;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mood: MoodType | null;
  modelTier: ModelTier | null;
  tokensUsed: number | null;
  pointsConsumed: number | null;
  createdAt: Date;
}

export interface Relationship {
  id: string;
  userId: string;
  characterId: string;
  bondLevel: number;
  bondExp: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Memory {
  id: string;
  userId: string;
  characterId: string;
  type: 'user_info' | 'relationship' | 'story';
  content: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotaPackage {
  id: string;
  name: string;
  priceCents: number;
  points: number;
  description: string;
  recommended: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id: string;
  userId: string;
  quotaPackageId: string;
  amountCents: number;
  pointsAmount: number;
  status: OrderStatus;
  merchantOrderNo: string;
  providerTransactionId: string | null;
  paidAt: Date | null;
  creditedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Payment {
  id: string;
  orderId: string;
  provider: string;
  providerTransactionId: string | null;
  prepayParams: string | null;
  callbackRawDigest: string | null;
  verifyResult: 'pending' | 'passed' | 'failed';
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletAccount {
  id: string;
  userId: string;
  balancePoints: number;
  totalRechargedPoints: number;
  totalConsumedPoints: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  type: WalletTxType;
  amount: number;
  balanceAfter: number;
  orderId: string | null;
  modelUsageLogId: string | null;
  idempotencyKey: string;
  description: string | null;
  createdAt: Date;
}

export interface ModelUsageLog {
  id: string;
  userId: string;
  characterId: string;
  sessionId: string;
  modelTier: ModelTier;
  modelName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costEstimateCents: number | null;
  pointsConsumed: number;
  walletTransactionId: string | null;
  status: 'success' | 'failed' | 'filtered';
  createdAt: Date;
}