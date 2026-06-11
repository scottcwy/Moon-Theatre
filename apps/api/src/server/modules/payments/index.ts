export { type PaymentProvider } from './provider.interface.js';
export { MockPaymentProvider } from './mock-provider.js';

import type { PaymentProvider } from './provider.interface.js';
import { MockPaymentProvider } from './mock-provider.js';

export function createPaymentProvider(provider: string): PaymentProvider {
  switch (provider) {
    case 'mock':
      return new MockPaymentProvider();
    default:
      throw new Error(`Unknown payment provider: ${provider}`);
  }
}