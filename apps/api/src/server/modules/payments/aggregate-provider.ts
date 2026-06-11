import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { PaymentProvider } from './provider.interface.js';
import type { CreatePrepayInput, CreatePrepayResult, VerifiedPaymentNotify } from '@juben-sha/shared';
import type { PaymentStatus } from '@juben-sha/shared';

function sign(params: Record<string, string>, secret: string): string {
  const sortedKeys = Object.keys(params).filter((k) => params[k] !== '' && k !== 'sign').sort();
  const stringA = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
  const stringSignTemp = `${stringA}&key=${secret}`;
  return createHmac('sha256', secret).update(stringSignTemp).digest('hex').toUpperCase();
}

function verifySign(params: Record<string, string>, signValue: string, secret: string): boolean {
  const computed = sign(params, secret);
  const expected = Buffer.from(computed);
  const received = Buffer.from(signValue);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface AggregateConfig {
  merchantId: string;
  appId: string;
  secret: string;
  publicKey: string;
  privateKey: string;
  notifyUrl: string;
  returnUrl: string;
}

export class AggregatePaymentProvider implements PaymentProvider {
  private config: AggregateConfig;

  constructor(config: AggregateConfig) {
    this.config = config;
  }

  async createPrepay(input: CreatePrepayInput): Promise<CreatePrepayResult> {
    this.assertConfigured();

    const nonceStr = randomUUID().replace(/-/g, '').slice(0, 32);
    const timeStamp = String(Math.floor(Date.now() / 1000));

    const params: Record<string, string> = {
      appid: this.config.appId,
      mch_id: this.config.merchantId,
      nonce_str: nonceStr,
      body: input.description,
      out_trade_no: input.orderId,
      total_fee: String(input.amountCents),
      notify_url: this.config.notifyUrl,
      trade_type: 'JSAPI',
      timeStamp,
    };

    params.sign = sign(params, this.config.secret);

    return {
      providerOrderId: `agg_${input.orderId}`,
      prepayParams: {
        timeStamp,
        nonceStr,
        package: `prepay_id=agg_${input.orderId}`,
        signType: 'HMAC-SHA256',
        paySign: params.sign,
        appId: this.config.appId,
        merchantId: this.config.merchantId,
      },
    };
  }

  async verifyNotify(headers: Record<string, string>, rawBody: string): Promise<VerifiedPaymentNotify> {
    this.assertConfigured();

    const bodyParams = parseNotifyParams(rawBody);

    const receivedSign = bodyParams.sign ?? headers['x-payment-sign'] ?? '';
    if (!receivedSign) {
      throw new Error('Missing payment signature');
    }

    const valid = verifySign(bodyParams, receivedSign, this.config.secret);
    if (!valid) {
      throw new Error('Signature verification failed');
    }

    return {
      providerTransactionId: bodyParams.transaction_id ?? '',
      orderId: bodyParams.out_trade_no ?? '',
      amountCents: parseInt(bodyParams.total_fee ?? '0', 10),
      status: bodyParams.result_code === 'SUCCESS' ? 'success' : 'failed',
      paidAt: bodyParams.time_end ? formatTimeEnd(bodyParams.time_end) : null,
      rawDigest: receivedSign,
    };
  }

  normalizeStatus(notify: VerifiedPaymentNotify): PaymentStatus {
    return notify.status;
  }

  private assertConfigured(): void {
    const missing = [
      ['PAYMENT_MERCHANT_ID', this.config.merchantId],
      ['PAYMENT_APP_ID', this.config.appId],
      ['PAYMENT_SECRET', this.config.secret],
      ['PAYMENT_NOTIFY_URL', this.config.notifyUrl],
    ].filter(([, value]) => !value);

    if (missing.length > 0) {
      throw new Error(`Aggregate payment provider is not configured: ${missing.map(([key]) => key).join(', ')}`);
    }
  }
}

function parseNotifyParams(rawBody: string): Record<string, string> {
  if (!rawBody) return {};

  try {
    const json = JSON.parse(rawBody) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(json)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
  } catch {
    const bodyParams: Record<string, string> = {};
    const params = new URLSearchParams(rawBody);
    params.forEach((value, key) => {
      bodyParams[key] = value;
    });
    return bodyParams;
  }
}

function formatTimeEnd(timeEnd: string): string | null {
  if (!timeEnd || timeEnd.length < 14) return null;
  const y = timeEnd.slice(0, 4);
  const m = timeEnd.slice(4, 6);
  const d = timeEnd.slice(6, 8);
  const h = timeEnd.slice(8, 10);
  const mi = timeEnd.slice(10, 12);
  const s = timeEnd.slice(12, 14);
  return `${y}-${m}-${d}T${h}:${mi}:${s}.000Z`;
}
