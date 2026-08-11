import type { MoodType, PaymentStatus } from '@juben-sha/shared';

export const FIGMA_MOOD_LABELS: Record<MoodType, string> = {
  neutral: '平静',
  happy: '愉悦',
  sad: '低落',
  angry: '愠怒',
  thinking: '思索中',
};

export function getFigmaMoodLabel(mood: MoodType): string {
  return FIGMA_MOOD_LABELS[mood] ?? '平静';
}

/** 分享海报身份标签的通用降级文案；差异化身份由后端 character.identity 字段数据驱动。 */
export const SHARE_IDENTITY_FALLBACK = '剧中角色';

export interface PaymentResultCopy {
  title: string;
  message: string;
  tone: 'success' | 'pending' | 'error' | 'neutral';
}

const PAYMENT_FAILED_COPY: PaymentResultCopy = {
  title: '支付失败',
  message: '支付未完成，可能是支付方式异常、网络异常或平台确认失败。',
  tone: 'error',
};

export function getPaymentResultCopy(status: PaymentStatus | string): PaymentResultCopy {
  const config: Record<string, PaymentResultCopy> = {
    credited: {
      title: '支付成功',
      message: '点数已到账，可以继续与角色对话了。',
      tone: 'success',
    },
    paid: {
      title: '支付确认中',
      message: '已收到支付结果，正在确认点数到账。',
      tone: 'pending',
    },
    prepay_created: {
      title: '等待确认',
      message: '订单已发起，正在等待支付平台确认。',
      tone: 'pending',
    },
    created: {
      title: '等待支付',
      message: '订单已创建，请在支付页完成付款。',
      tone: 'pending',
    },
    failed: PAYMENT_FAILED_COPY,
    closed: {
      title: '支付取消',
      message: '你已取消本次支付，可以重新选择额度包。',
      tone: 'neutral',
    },
    refunded: {
      title: '已退款',
      message: '本次支付已退款，如有疑问请联系客服。',
      tone: 'neutral',
    },
  };

  return config[status] ?? PAYMENT_FAILED_COPY;
}
