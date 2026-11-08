import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  listQuotaPackages: vi.fn(),
  listWalletAccounts: vi.fn(),
  listWalletTransactions: vi.fn(),
}));

vi.stubGlobal('React', React);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test-cookie' }) }) }));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => '/admin/wallet', useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/modules/admin/authentication.js', () => ({ resolveAdminToken: mocks.resolve }));
vi.mock('@/server/modules/admin/index.js', () => ({
  listQuotaPackages: mocks.listQuotaPackages,
  listWalletAccounts: mocks.listWalletAccounts,
  listWalletTransactions: mocks.listWalletTransactions,
}));

const identity = {
  adminAccountId: 'self',
  credentialVersion: 9,
  sessionId: 'SECRET_SESSION',
  expiresAt: new Date(),
  account: { id: 'self', email: 'owner@example.test', active: true, mustChangePassword: false, isProtected: true, createdAt: new Date(), updatedAt: new Date() },
};

const packageId = '11111111-1111-4111-8111-111111111111';
const secondPackageId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

const packages = [
  {
    id: packageId, name: '体验包', priceCents: 600, points: 60, description: '60 点数，适合初次体验',
    recommended: false, active: true, sortOrder: 1,
    createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
  },
  {
    id: secondPackageId, name: '标准包', priceCents: 1800, points: 200, description: null,
    recommended: true, active: false, sortOrder: 2,
    createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
  },
];

const accountRow = {
  id: 'acct-1', userId, userName: '小满', balancePoints: 42,
  totalRechargedPoints: 100, totalConsumedPoints: 58,
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z'),
};
const transactionRow = {
  id: 'tx-1', userId, userName: '小满', type: 'adjust', amount: 10, balanceAfter: 52,
  orderId: null, modelUsageLogId: null, idempotencyKey: 'adj-key-1', description: '客服补偿',
  adminUserId: null, adminAccountId: 'self', adjustmentReason: '客服补偿',
  createdAt: new Date('2026-11-06T00:00:00Z'),
};

const pageProps = (searchParams: Record<string, string> = {}) => ({ searchParams: Promise.resolve(searchParams) }) as never;

/** The quota page takes no props; the wallet page's searchParams are optional, so both are callable bare. */
async function render(load: () => Promise<unknown>) {
  const Page = (await load() as { default: (props: never) => Promise<React.ReactElement> }).default;
  return renderToStaticMarkup(await Page(undefined as never));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(identity);
  mocks.listQuotaPackages.mockResolvedValue(packages);
  mocks.listWalletAccounts.mockResolvedValue({ items: [accountRow], total: 1, page: 1, pageSize: 30 });
  mocks.listWalletTransactions.mockResolvedValue({ items: [transactionRow], total: 1, page: 1, pageSize: 30 });
});

describe.each([
  ['quota packages', () => import('../(console)/quota-packages/page.js')],
  ['wallet', () => import('../(console)/wallet/page.js')],
] as const)('%s page guard', (_name, load) => {
  it('queries nothing without an admin identity', async () => {
    mocks.resolve.mockResolvedValue(null);
    const html = await render(load);
    expect(html).toContain('需要管理员身份');
    expect(mocks.listQuotaPackages).not.toHaveBeenCalled();
    expect(mocks.listWalletAccounts).not.toHaveBeenCalled();
    expect(mocks.listWalletTransactions).not.toHaveBeenCalled();
  });

  it('never serializes session internals', async () => {
    const html = await render(load);
    expect(html).not.toContain('SECRET_SESSION');
    expect(html).not.toContain('credentialVersion');
  });
});

describe('quota package maintenance page (AC-13)', () => {
  const load = () => import('../(console)/quota-packages/page.js');

  it('lists the current values with availability and an edit affordance per package', async () => {
    const html = await render(load);
    expect(html).toContain('<h1>充值套餐</h1>');
    expect(html).toContain('体验包');
    expect(html).toContain('标准包');
    expect(html).toContain('¥6.00');
    expect(html).toContain('¥18.00');
    expect(html).toContain('data-status="active"');
    expect(html).toContain('data-status="inactive"');
    expect(html).toContain('已上架');
    expect(html).toContain('已下架');
    expect(html).toContain(`href="#package-${packageId}"`);
  });

  it('states that existing orders keep their original amount and points', async () => {
    const html = await render(load);
    expect(html).toContain('已有订单按下单时的金额与点数快照保留，不会被重算');
    expect(html).toContain('调价或改点数只影响之后创建的订单');
  });

  it('offers a create form with the documented field names and a per-package explicit save form', async () => {
    const html = await render(load);
    expect(html).toContain('aria-label="新建充值套餐"');
    expect(html).toContain('name="priceYuan"');
    expect(html).toContain('name="points"');
    expect(html).toContain('name="sortOrder"');
    expect(html).toContain('name="recommended"');
    expect(html).toContain('name="active"');
    expect(html).toContain(`aria-label="编辑套餐 体验包"`);
    expect(html).toContain(`aria-label="编辑套餐 标准包"`);
    // The edit form is pre-filled with the stored cents rendered as yuan, so a save sends no phantom change.
    expect(html).toContain('value="6.00"');
    expect(html).toContain('value="18.00"');
    expect(html).toContain('保存修改');
    expect(html).toContain('下架该套餐');
    expect(html).toContain('上架该套餐');
  });

  it('shows a creation-oriented empty state instead of pretending configurations exist', async () => {
    mocks.listQuotaPackages.mockResolvedValue([]);
    const html = await render(load);
    expect(html).toContain('<p class="empty">暂无充值套餐。可用上方表单创建第一个套餐。</p>');
    expect(html).not.toContain('<table');
  });

  it('does not fabricate package figures when the query fails', async () => {
    mocks.listQuotaPackages.mockRejectedValue(new Error('dependency unavailable'));
    const html = await render(load);
    expect(html).toContain('充值套餐暂时无法加载');
    expect(html).not.toContain('¥');
    expect(html).not.toContain('<table');
  });
});

describe('wallet page: adjustments and ledger (AC-14)', () => {
  const load = () => import('../(console)/wallet/page.js');

  it('surfaces the existing ledger filters and forwards only usable values', async () => {
    const html = renderToStaticMarkup(await (await load()).default(pageProps({ userId, type: 'adjust' })));
    expect(html).toContain('aria-label="筛选钱包流水"');
    expect(html).toContain('name="userId"');
    expect(html).toContain('name="type"');
    expect(mocks.listWalletAccounts).toHaveBeenCalledWith({ page: 1, pageSize: 30, userId });
    expect(mocks.listWalletTransactions).toHaveBeenCalledWith({ page: 1, pageSize: 30, userId, type: 'adjust' });
  });

  it('reports an unusable filter and does not silently apply it', async () => {
    const html = renderToStaticMarkup(await (await load()).default(pageProps({ userId: 'not-a-uuid', type: 'refund' })));
    expect(html).toContain('用户 ID 筛选需为完整 UUID，当前输入未用于筛选。');
    expect(html).toContain('流水类型筛选只能是充值、消费或调整，当前输入未用于筛选。');
    expect(mocks.listWalletAccounts).toHaveBeenCalledWith({ page: 1, pageSize: 30 });
    expect(mocks.listWalletTransactions).toHaveBeenCalledWith({ page: 1, pageSize: 30 });
  });

  it('offers a real adjustment form: target user, signed delta, required reason and a visible idempotency key', async () => {
    const html = renderToStaticMarkup(await (await load()).default(pageProps()));
    expect(html).toContain('aria-label="人工调账"');
    expect(html).toContain('name="userId"');
    expect(html).toContain('name="delta"');
    expect(html).toContain('name="reason"');
    expect(html).toContain('name="idempotencyKey"');
    expect(html).toContain('幂等标识');
    expect(html).toContain('调整原因');
    expect(html).toContain('重新生成幂等标识');
    expect(html).toContain('提交调账');
  });

  it('explains that an adjustment is its own ledger entry, never a recharge or paid order', async () => {
    const html = renderToStaticMarkup(await (await load()).default(pageProps()));
    expect(html).toContain('不能伪装成充值或已支付订单');
  });

  it('shows the operator the reason and idempotency key of every adjustment row', async () => {
    const html = renderToStaticMarkup(await (await load()).default(pageProps()));
    expect(html).toContain('客服补偿');
    expect(html).toContain('adj-key-1');
    expect(html).toContain('余额点数');
    expect(html).toContain('42');
  });

  it('prints the sign once, so a debit adjustment reads -5 and a consume row keeps its minus', async () => {
    mocks.listWalletTransactions.mockResolvedValue({
      items: [
        { ...transactionRow, id: 'tx-recharge', type: 'recharge', amount: 10, balanceAfter: 57, adjustmentReason: null, description: null },
        { ...transactionRow, id: 'tx-debit', type: 'adjust', amount: -5, balanceAfter: 52, adjustmentReason: '误发扣回' },
        { ...transactionRow, id: 'tx-consume', type: 'consume', amount: 3, balanceAfter: 49, adjustmentReason: null, description: '聊天消费' },
      ],
      total: 3, page: 1, pageSize: 30,
    });
    const html = renderToStaticMarkup(await (await load()).default(pageProps()));
    expect(html).not.toContain('+-');
    expect(html).toContain('>+10<');
    expect(html).toContain('>-5<');
    expect(html).toContain('>-3<');
  });

  it('lets a phone keypad type a signed delta instead of a digits-only field', async () => {
    const html = renderToStaticMarkup(await (await load()).default(pageProps()));
    const delta = (/<input[^>]*name="delta"[^>]*>/.exec(html)?.[0] ?? '').toLowerCase();
    expect(delta).toContain('inputmode="text"');
    expect(delta).not.toContain('numeric');
  });

  it('does not fabricate wallet figures when the ledger cannot be read', async () => {
    mocks.listWalletAccounts.mockRejectedValue(new Error('dependency unavailable'));
    const html = renderToStaticMarkup(await (await load()).default(pageProps()));
    expect(html).toContain('钱包与流水暂时无法加载');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('余额点数</th>');
    expect(html).not.toContain('aria-label="人工调账"');
  });
});
