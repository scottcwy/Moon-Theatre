import { describe, expect, it } from 'vitest';
import { getFigmaMoodLabel, getPaymentResultCopy, getShareIdentityLabel, getTierMeta } from './figma-system';

describe('figma visual system copy helpers', () => {
  it('localizes mood labels from the Figma chat exports', () => {
    expect(getFigmaMoodLabel('happy')).toBe('愉悦');
    expect(getFigmaMoodLabel('neutral')).toBe('平静');
    expect(getFigmaMoodLabel('thinking')).toBe('思索中');
  });

  it('uses Chinese tier labels with point costs', () => {
    expect(getTierMeta('standard', 3)).toEqual({
      label: '标准',
      costLabel: '3 点/次',
      activeHint: '当前档位',
    });
  });

  it('replaces Figma share-card English leftovers with Chinese labels', () => {
    expect(getShareIdentityLabel('白藏')).toBe('庭院狐神');
    expect(getShareIdentityLabel('unknown')).toBe('剧中角色');
  });

  it('does not describe default payment failures as insufficient balance', () => {
    expect(getPaymentResultCopy('failed').message).toBe('支付未完成，可能是支付方式异常、网络异常或平台确认失败。');
    expect(getPaymentResultCopy('failed').message).not.toContain('余额不足');
  });
});
