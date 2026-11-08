import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/server/http/errors.js';
import { AdminNavigation } from '../navigation.js';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }),
  listAdminUsers: vi.fn(),
  getAdminUser: vi.fn(),
}));

vi.stubGlobal('React', React);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test-cookie' }) }) }));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, usePathname: () => '/admin/users', useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/modules/admin/authentication.js', () => ({ resolveAdminToken: mocks.resolve }));
vi.mock('@/server/modules/admin/index.js', () => ({
  listAdminUsers: mocks.listAdminUsers,
  getAdminUser: mocks.getAdminUser,
}));

const userId = '11111111-1111-4111-8111-111111111111';
const bannedUserId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const characterId = '44444444-4444-4444-8444-444444444444';

const identity = {
  adminAccountId: 'self',
  credentialVersion: 9,
  sessionId: 'SECRET_SESSION',
  expiresAt: new Date(),
  account: { id: 'self', email: 'owner@example.test', active: true, mustChangePassword: false, isProtected: true, createdAt: new Date(), updatedAt: new Date() },
};

const row = {
  id: userId,
  nickname: '小满',
  status: 'active',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  balancePoints: 42,
  sessionCount: 3,
  lastMessageAt: new Date('2026-11-02T05:30:00Z'),
};
const bannedRow = { ...row, id: bannedUserId, nickname: '阿月', status: 'banned', balancePoints: 0, sessionCount: 0, lastMessageAt: null };

const profile = {
  user: {
    id: userId,
    nickname: '小满',
    avatarUrl: 'https://cdn.example.test/a.png',
    status: 'active',
    openidPreview: 'openid_f…',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
  },
  wallet: { exists: true, balancePoints: 42, totalRechargedPoints: 100, totalConsumedPoints: 58 },
  stats: { sessionCount: 2, messageCount: 7, lastMessageAt: new Date('2026-11-02T05:30:00Z'), lastSessionAt: new Date('2026-11-02T04:00:00Z') },
  recentSessions: [{
    id: sessionId,
    characterId,
    characterName: '顾青梧',
    title: null,
    mode: 'free',
    status: 'active',
    messageCount: 7,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-02T04:00:00Z'),
  }],
};

const listProps = (searchParams: Record<string, string> = {}) => ({ searchParams: Promise.resolve(searchParams) });
const detailProps = (id = userId) => ({ params: Promise.resolve({ id }) });

function guardAbsent() {
  mocks.resolve.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(identity);
  mocks.listAdminUsers.mockResolvedValue({ items: [row, bannedRow], total: 2, page: 1, pageSize: 20 });
  mocks.getAdminUser.mockResolvedValue(profile);
});

describe.each([
  ['users list', () => import('../(console)/users/page.js'), () => listProps()],
  ['user detail', () => import('../(console)/users/[id]/page.js'), () => detailProps()],
] as const)('%s page', (_name, load, props) => {
  it('queries nothing for an absent or restricted identity', async () => {
    guardAbsent();
    const Page = (await load()).default;
    const html = renderToStaticMarkup(await Page(props() as never));
    expect(html).toContain('需要管理员身份');
    expect(mocks.listAdminUsers).not.toHaveBeenCalled();
    expect(mocks.getAdminUser).not.toHaveBeenCalled();
  });

  it('never serializes session internals', async () => {
    const Page = (await load()).default;
    const html = renderToStaticMarkup(await Page(props() as never));
    expect(html).not.toContain('SECRET_SESSION');
    expect(html).not.toContain('credentialVersion');
  });
});

describe('users list page', () => {
  it('shows ban state, wallet balance, session count and last message per user with a link to the profile', async () => {
    const Page = (await import('../(console)/users/page.js')).default;
    const html = renderToStaticMarkup(await Page(listProps()));
    expect(html).toContain('<h1>用户管理</h1>');
    expect(html).toContain('aria-label="搜索用户"');
    expect(html).toContain('name="q"');
    expect(html).toContain('name="status"');
    expect(html).toContain('小满');
    expect(html).toContain('阿月');
    expect(html).toContain('data-status="active"');
    expect(html).toContain('data-status="banned"');
    expect(html).toContain('已封禁');
    expect(html).toContain(`href="/admin/users/${userId}"`);
    expect(html).toContain(`href="/admin/users/${bannedUserId}"`);
    expect(html).toContain('42');
    expect(html).toContain('共 2 位用户');
    expect(mocks.listAdminUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('applies the search, status and page from the URL and keeps them in the pagination links', async () => {
    mocks.listAdminUsers.mockResolvedValue({ items: [bannedRow], total: 60, page: 2, pageSize: 20 });
    const Page = (await import('../(console)/users/page.js')).default;
    const html = renderToStaticMarkup(await Page(listProps({ q: '阿月', status: 'banned', page: '2' })));
    expect(mocks.listAdminUsers).toHaveBeenCalledWith({ page: 2, pageSize: 20, query: '阿月', status: 'banned' });
    expect(html).toContain('当前筛选：关键词「阿月」 · 已封禁');
    expect(html).toContain('href="/admin/users?page=3&amp;q=');
    expect(html).toContain('page=1');
    expect(html).toContain('清除筛选');
  });

  it('offers the AdminTable empty state for an empty database and for an empty filter result', async () => {
    mocks.listAdminUsers.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const Page = (await import('../(console)/users/page.js')).default;
    expect(renderToStaticMarkup(await Page(listProps()))).toContain('暂无用户。玩家首次登录后会出现在这里。');

    mocks.listAdminUsers.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const filtered = renderToStaticMarkup(await Page(listProps({ q: '不存在' })));
    expect(filtered).toContain('当前筛选下没有匹配的用户（关键词「不存在」）');
    expect(filtered).not.toContain('<table>');
  });

  it('ignores an invalid status or over-long term and says so instead of querying with it', async () => {
    const Page = (await import('../(console)/users/page.js')).default;
    const html = renderToStaticMarkup(await Page(listProps({ status: 'deleted', q: 'a'.repeat(129) })));
    expect(mocks.listAdminUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(html).toContain('用户状态筛选只能是正常或已封禁，当前输入未用于筛选。');
    expect(html).toContain('搜索关键词最多 128 个字符，当前输入未用于筛选。');
  });

  it('renders a load error instead of partial data when the query fails', async () => {
    mocks.listAdminUsers.mockRejectedValue(new Error('dependency down'));
    const Page = (await import('../(console)/users/page.js')).default;
    expect(renderToStaticMarkup(await Page(listProps()))).toContain('用户暂时无法加载');
  });
});

describe('user detail page', () => {
  it('shows the profile, wallet summary, usage totals and recent sessions with a chat-history link', async () => {
    const Page = (await import('../(console)/users/[id]/page.js')).default;
    const html = renderToStaticMarkup(await Page(detailProps()));
    expect(html).toContain('<h1>用户详情</h1>');
    expect(html).toContain('小满');
    expect(html).toContain('openid_f…');
    expect(html).toContain('余额点数');
    expect(html).toContain('累计充值');
    expect(html).toContain('累计消费');
    expect(html).toContain('封禁不改动钱包余额与流水，也不删除会话或消息。');
    expect(html).toContain('顾青梧');
    expect(html).toContain(`href="/admin/sessions/${sessionId}"`);
    expect(html).toContain(`href="/admin/sessions?userId=${userId}"`);
    expect(html).toContain('href="/admin/users"');
    expect(mocks.getAdminUser).toHaveBeenCalledWith(userId);
  });

  it('requires an explicit confirmation that existing tokens stop working, and offers unban for a banned user', async () => {
    const Page = (await import('../(console)/users/[id]/page.js')).default;
    const active = renderToStaticMarkup(await Page(detailProps()));
    expect(active).toContain('封禁该用户');
    expect(active).toContain('name="confirmation"');
    expect(active).toContain('我确认封禁该用户');
    expect(active).toContain('现有登录凭据');
    expect(active).toContain('确认封禁');
    expect(active).toContain('解封后');
    expect(active).not.toContain('确认解封');

    mocks.getAdminUser.mockResolvedValue({ ...profile, user: { ...profile.user, status: 'banned' } });
    const banned = renderToStaticMarkup(await Page(detailProps()));
    expect(banned).toContain('data-status="banned"');
    expect(banned).toContain('解除封禁');
    expect(banned).toContain('我确认解除该用户的封禁');
    expect(banned).toContain('确认解封');
  });

  it('never renders chat bodies, persona prompts, raw openid or credential material', async () => {
    const Page = (await import('../(console)/users/[id]/page.js')).default;
    const html = renderToStaticMarkup(await Page(detailProps()));
    for (const forbidden of ['openid_full_profile', 'systemPrompt', '# Soul', '这段正文', 'passwordHash', 'SECRET_SESSION']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('answers a malformed id or a missing user with a 用户不存在 page and no query', async () => {
    const Page = (await import('../(console)/users/[id]/page.js')).default;
    expect(renderToStaticMarkup(await Page(detailProps('not-a-uuid')))).toContain('用户不存在');
    expect(mocks.getAdminUser).not.toHaveBeenCalled();

    mocks.getAdminUser.mockRejectedValue(new NotFoundError('User'));
    const html = renderToStaticMarkup(await Page(detailProps()));
    expect(html).toContain('用户不存在');
    expect(html).toContain('返回用户列表');
  });

  it('renders a load error instead of partial data for an unexpected failure', async () => {
    mocks.getAdminUser.mockRejectedValue(new Error('dependency down'));
    const Page = (await import('../(console)/users/[id]/page.js')).default;
    expect(renderToStaticMarkup(await Page(detailProps()))).toContain('用户暂时无法加载');
  });
});

it('adds the user console entry to the sidebar navigation', () => {
  const html = renderToStaticMarkup(<AdminNavigation />);
  expect(html).toContain('href="/admin/users"');
  expect(html).toContain('用户管理');
  // The mocked pathname is /admin/users, so the entry marks itself as the current page.
  expect(html).toContain('aria-current="page"');
});
