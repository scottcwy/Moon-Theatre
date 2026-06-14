export {
  getOrCreateWallet,
  getBalance,
  creditWallet,
  creditWalletInTransaction,
  consumePoints,
  refundConsumedPoints,
} from './service.js';
export type { WalletAccount, CreditResult, ConsumeResult, RefundResult } from './service.js';
