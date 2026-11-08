import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), query: vi.fn(), noStore: vi.fn(), redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }) }));
vi.stubGlobal('React', React);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test-cookie' }) }) }));
vi.mock('next/cache', () => ({ unstable_noStore: mocks.noStore }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, usePathname: () => '/admin/accounts', useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/modules/admin/authentication.js', () => ({ resolveAdminToken: mocks.resolve }));
vi.mock('@/server/modules/admin/index.js', () => Object.fromEntries(['getAdminStats','listSessions','getCharacterSummary','listOrders','listPayments','listWalletAccounts','listWalletTransactions','listQuotaPackages','listModelUsageLogs','listBlockedKeywords','listReviewLogs','listAdminAccounts'].map(key => [key, mocks.query])));
vi.mock('@/server/modules/admin/accounts.js', () => ({ listAdminAccounts: mocks.query }));
// Pages that read searchParams accept the Next.js page props; the empty promise keeps them on defaults.
const pageProps = { searchParams: Promise.resolve({}) } as never;
const account = { id: 'self', email: 'owner@example.test', active: true, mustChangePassword: false, isProtected: true, createdAt: new Date(), updatedAt: new Date() };
const identity = { adminAccountId: 'self', credentialVersion: 9, sessionId: 'SECRET_SESSION', expiresAt: new Date(), account };
const pages = [
  ['overview', () => import('../(console)/page.js')],
  ['sessions', () => import('../(console)/sessions/page.js')],
  ['orders', () => import('../(console)/orders/page.js')],
  ['payments', () => import('../(console)/payments/page.js')],
  ['wallet', () => import('../(console)/wallet/page.js')],
  ['quota', () => import('../(console)/quota-packages/page.js')],
  ['models', () => import('../(console)/model-usage/page.js')],
  ['keywords', () => import('../(console)/blocked-keywords/page.js')],
  ['reviews', () => import('../(console)/review-logs/page.js')],
  ['accounts', () => import('../(console)/accounts/page.js')],
  ['account', () => import('../(console)/account/page.js')],
] as const;
beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue(Object.assign([], { items: [], total: 0, sessions: { total: 0 }, orders: { total: 0 }, payments: { paidAmountCents: 0 }, wallet: { balancePoints: 0 }, modelUsage: { total: 0 }, users: { total: 0, today: 0 }, messages: { total: 0, today: 0 }, moderation: { filtered: 0 } })); });
describe.each(pages)('%s independent SSR guard', (_name, load) => {
  it.each(['absent', 'restricted', 'expired', 'disabled'])('%s identity cannot query business/account data', async state => {
    mocks.resolve.mockImplementation(async (_token, options) => {
      if (state === 'restricted' && options?.allowRestricted) return { ...identity, account: { ...account, mustChangePassword: true } };
      return null;
    });
    const Page = (await load()).default;
    try { renderToStaticMarkup(await Page(pageProps)); } catch (error) { expect(String(error)).toContain('redirect:'); }
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.noStore).toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith('test-cookie', {});
  });
  it('full identity passes the real page guard and never serializes session internals', async () => {
    mocks.resolve.mockResolvedValue(identity);
    const html = renderToStaticMarkup(await (await load()).default(pageProps));
    expect(html).not.toContain('SECRET_SESSION');
    expect(html).not.toContain('credentialVersion');
    if (_name !== 'account') expect(mocks.query).toHaveBeenCalled();
  });
});
it('overview preserves its original thrown service failure instead of silently changing it to successful page data', async () => {
  mocks.resolve.mockResolvedValue(identity);
  mocks.query.mockRejectedValue(new Error('dependency unavailable'));
  const Page = (await import('../(console)/page.js')).default;
  await expect(Page()).rejects.toThrow('dependency unavailable');
});
it('review rows preserve independent and historical reviewer attribution', async () => {
  mocks.resolve.mockResolvedValue(identity);
  mocks.query.mockResolvedValue({ items: [{ id: 'r1', sessionId: 'session-1', reviewerAdminAccountId: 'new-admin-id', reviewerId: null, status: 'flagged' }, { id: 'r2', sessionId: 'session-2', reviewerId: 'legacy-id', status: 'normal' }], total: 2 });
  const Page = (await import('../(console)/review-logs/page.js')).default;
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('new-admin-id');
  expect(html).toContain('历史用户');
  expect(html).toContain('data-status="flagged"');
});
it('account rows explain protection/self constraints and disabled-account recovery', async () => {
  mocks.resolve.mockResolvedValue(identity);
  mocks.query.mockResolvedValue([account, { ...account, id: 'other', isProtected: false, active: false, mustChangePassword: true, email: 'disabled@example.test' }]);
  const Page = (await import('../(console)/accounts/page.js')).default;
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('受保护账号不能被重置或停用');
  expect(html).toContain('disabled@example.test');
  expect(html).toContain('恢复登录须由服务器处理');
  expect(html).not.toContain('启用账号');
  expect(html).toContain('name="confirmation"');
});
it('loading boundaries show useful skeletons without private identity', async () => {
  const Loading = (await import('../(console)/loading.js')).default;
  const html = renderToStaticMarkup(<Loading />);
  expect(html).toContain('正在加载');
  expect(html).toContain('skeleton');
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('console layout redirects missing/restricted identity before rendering account navigation', async () => {
  const Layout = (await import('../(console)/layout.js')).default;
  mocks.resolve.mockResolvedValue(null);
  await expect(Layout({ children: 'private' })).rejects.toThrow('redirect:/admin/login?notice=expired');
  mocks.resolve.mockResolvedValue({ ...identity, account: { ...account, mustChangePassword: true } });
  await expect(Layout({ children: 'private' })).rejects.toThrow('redirect:/admin/change-password');
  mocks.resolve.mockResolvedValue(identity);
  const html = renderToStaticMarkup(await Layout({ children: 'private' }));
  expect(html).toContain('owner@example.test');
  expect(html).toContain('aria-current="page"');
  expect(html).not.toContain('SECRET_SESSION');
  expect(mocks.query).not.toHaveBeenCalled();
});
it('login redirects full/restricted identities only to safe internal destinations', async () => {
  const Page = (await import('../login/page.js')).default;
  mocks.resolve.mockResolvedValue(identity);
  await expect(Page({ searchParams: Promise.resolve({ next: 'https://evil.test' }) })).rejects.toThrow('redirect:/admin');
  mocks.resolve.mockResolvedValue({ ...identity, account: { ...account, mustChangePassword: true } });
  await expect(Page({ searchParams: Promise.resolve({ next: '/admin/accounts' }) })).rejects.toThrow('redirect:/admin/change-password?next=%2Fadmin%2Faccounts');
});
it('password page allows restricted identity, redirects absent identity and performs no list queries', async () => {
  const Page = (await import('../change-password/page.js')).default;
  mocks.resolve.mockResolvedValue(null);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/admin/login?notice=expired');
  mocks.resolve.mockResolvedValue({ ...identity, account: { ...account, mustChangePassword: true } });
  expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).toContain('修改密码');
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.resolve).toHaveBeenLastCalledWith('test-cookie', { allowRestricted: true });
});

const emptyTablePages = [
  [pages[1], ['暂无玩家会话。玩家开始聊天后，会话将显示在这里。']],
  [pages[2], ['暂无订单记录。玩家创建订单后可在此查看。']],
  [pages[3], ['暂无支付记录。产生支付后可在此查看。']],
  [pages[4], ['暂无钱包账户。玩家开通钱包后可在此查看。', '暂无钱包流水。产生点数变动后可在此查看。']],
  [pages[5], ['暂无充值套餐，请联系配置维护人员。']],
  [pages[6], ['暂无模型用量。产生模型调用后可在此查看。']],
  [pages[7], ['暂无屏蔽关键词。当前没有已配置的过滤条目。']],
  [pages[8], ['暂无审核记录。产生审核记录后可在此查看。']],
  [pages[9], ['暂无管理员账号。可在下方创建普通管理员；若账号状态异常，请联系服务器维护人员。']],
] as const;
const populatedRow = {
  ...account, id: 'row-1', userId: 'user-1', characterId: 'character-1',
  sessionId: 'session-1', merchantOrderNo: 'order-1', provider: 'provider-1',
  modelName: 'model-1', keyword: 'keyword-1', name: 'package-1', amountCents: 100,
};
function populatedResult() {
  return Object.assign([populatedRow], { items: [populatedRow], total: 1 });
}
describe.each(emptyTablePages)('%s empty-table presentation', ([, load], messages) => {
  it('renders the complete useful description outside any wide scrolling table', async () => {
    mocks.resolve.mockResolvedValue(identity);
    const html = renderToStaticMarkup(await (await load()).default(pageProps));
    for (const message of messages) expect(html).toContain(`<p class="empty">${message}</p>`);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('class="table-wrap"');
  });
  it('keeps populated data in a labeled keyboard-focusable local table scroller', async () => {
    mocks.resolve.mockResolvedValue(identity);
    mocks.query.mockResolvedValue(populatedResult());
    const html = renderToStaticMarkup(await (await load()).default(pageProps));
    expect(html).toMatch(/class="table-wrap" role="region" aria-label="[^"]+" tabindex="0"><table>/);
    expect(html).toContain('<th scope="col"');
    expect(html).not.toContain('class="empty"');
  });
});
it.each(['accounts', 'transactions'])('wallet handles empty %s independently of its populated sibling', async empty => {
  mocks.resolve.mockResolvedValue(identity);
  const emptyResult = { items: [], total: 0 };
  mocks.query.mockResolvedValueOnce(empty === 'accounts' ? emptyResult : populatedResult())
    .mockResolvedValueOnce(empty === 'transactions' ? emptyResult : populatedResult());
  const Page = (await import('../(console)/wallet/page.js')).default;
  const html = renderToStaticMarkup(await Page());
  expect(html.match(/<table>/g)).toHaveLength(1);
  expect(html).toContain(`<p class="empty">${empty === 'accounts' ? '暂无钱包账户。玩家开通钱包后可在此查看。' : '暂无钱包流水。产生点数变动后可在此查看。'}</p>`);
});
