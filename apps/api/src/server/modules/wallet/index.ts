export {
  getOrCreateWallet,
  getBalance,
  creditWallet,
  creditWalletInTransaction,
  consumePoints,
  refundConsumedPoints,
  adjustWalletPoints,
} from './service.js';
export type { WalletAccount, CreditResult, ConsumeResult, RefundResult, AdjustmentResult } from './service.js';
export { WalletAdjustmentConflictError } from './service.js';
