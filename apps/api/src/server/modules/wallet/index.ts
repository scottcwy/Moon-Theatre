export {
  getOrCreateWallet,
  getBalance,
  creditWallet,
  creditWalletInTransaction,
  consumePoints,
  refundConsumedPoints,
  refundConsumedPointsInTransaction,
  adjustWalletPoints,
} from './service.js';
export type { WalletAccount, CreditResult, ConsumeResult, RefundResult, AdjustmentResult } from './service.js';
export { WalletAdjustmentConflictError, InsufficientBalanceError } from './service.js';
