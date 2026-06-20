import type { ModelTier, MoodType } from '../types';

export const FIGMA_MOOD_LABELS: Record<MoodType, string> = {
  neutral: '平静',
  happy: '愉悦',
  sad: '低落',
  angry: '愠怒',
  thinking: '思索中',
};

export const FIGMA_SHARE_IDENTITY_LABELS: Record<string, string> = {
  白藏: '庭院狐神',
  贺茂清玄: '冷面阴阳师',
  月岛澪: '绘梦画师',
  久远: '守门武士',
};

export function getFigmaMoodLabel(mood: MoodType): string {
  return FIGMA_MOOD_LABELS[mood] ?? '平静';
}

export function getTierMeta(tier: ModelTier, cost: number) {
  const labels: Record<ModelTier, string> = {
    casual: '轻松',
    standard: '标准',
    immersive: '沉浸',
  };

  return {
    label: labels[tier],
    costLabel: `${cost} 点/次`,
    activeHint: '当前档位',
  };
}

export function getShareIdentityLabel(characterName: string): string {
  return FIGMA_SHARE_IDENTITY_LABELS[characterName] ?? '剧中角色';
}

export function getPaymentResultCopy(status: string) {
  const config: Record<string, { title: string; message: string; tone: 'success' | 'pending' | 'error' | 'neutral' }> = {
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
    failed: {
      title: '支付失败',
      message: '支付未完成，可能是支付方式异常、网络异常或平台确认失败。',
      tone: 'error',
    },
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

  return config[status] ?? config.failed!;
}
