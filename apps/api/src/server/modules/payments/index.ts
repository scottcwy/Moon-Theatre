export { type PaymentProvider } from './provider.interface.js';
export { MockPaymentProvider } from './mock-provider.js';
export { AggregatePaymentProvider, type AggregateConfig } from './aggregate-provider.js';

import type { PaymentProvider } from './provider.interface.js';
import { MockPaymentProvider } from './mock-provider.js';
import { AggregatePaymentProvider } from './aggregate-provider.js';
import { config } from '../../config/index.js';

export function createPaymentProvider(provider: string): PaymentProvider {
  switch (provider) {
    case 'mock':
      return new MockPaymentProvider();
    case 'aggregate':
      return new AggregatePaymentProvider({
        merchantId: config.paymentMerchantId,
        appId: config.paymentAppId,
        secret: config.paymentSecret,
        publicKey: config.paymentPublicKey,
        privateKey: config.paymentPrivateKey,
        notifyUrl: config.paymentNotifyUrl,
        returnUrl: config.paymentReturnUrl,
      });
    default:
      throw new Error(`Unknown payment provider: ${provider}`);
  }
}
