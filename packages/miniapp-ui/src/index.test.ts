import { describe, expect, it } from 'vitest';
import * as MiniappUi from './index';

describe('@juben-sha/miniapp-ui exports', () => {
  it('exposes the first reusable component set for playbook previews', () => {
    expect(MiniappUi).toEqual(expect.objectContaining({
      Badge: expect.any(Function),
      BaseButton: expect.any(Function),
      BalancePanel: expect.any(Function),
      BottomAction: expect.any(Function),
      CharacterPosterCard: expect.any(Function),
      ChatSessionRow: expect.any(Function),
      IconButton: expect.any(Function),
      MemoryCard: expect.any(Function),
      MoodChip: expect.any(Function),
      NoticeBlock: expect.any(Function),
      PageContainer: expect.any(Function),
      PageSection: expect.any(Function),
      PageShell: expect.any(Function),
      PointsBadge: expect.any(Function),
      PrimaryButton: expect.any(Function),
      QuotaPackageCard: expect.any(Function),
      SearchBar: expect.any(Function),
      TonalButton: expect.any(Function),
      getPaymentResultCopy: expect.any(Function),
      getShareIdentityLabel: expect.any(Function),
      getTierMeta: expect.any(Function),
    }));
  });
});
