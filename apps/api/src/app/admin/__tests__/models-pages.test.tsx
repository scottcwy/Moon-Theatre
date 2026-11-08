import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  listAdminModels: vi.fn(),
  listAdminModelVersions: vi.fn(),
}));

vi.stubGlobal('React', React);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test-cookie' }) }) }));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => '/admin/models', useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/modules/admin/authentication.js', () => ({ resolveAdminToken: mocks.resolve }));
vi.mock('@/server/modules/admin/index.js', () => ({
  listAdminModels: mocks.listAdminModels,
  listAdminModelVersions: mocks.listAdminModelVersions,
}));

const identity = {
  adminAccountId: 'self',
  credentialVersion: 9,
  sessionId: 'SECRET_SESSION',
  expiresAt: new Date(),
  account: { id: 'self', email: 'owner@example.test', active: true, mustChangePassword: false, isProtected: true, createdAt: new Date(), updatedAt: new Date() },
};

const standardId = '11111111-1111-4111-8111-111111111111';
const casualId = '22222222-2222-4222-8222-222222222222';

const standardProfile = {
  id: standardId, tier: 'standard', modelName: 'deepseek-ai/DeepSeek-V4-Flash', provider: 'siliconflow',
  enabled: true, pointsPerCall: 3, displayName: '标准', description: '平衡质量与响应速度',
  costEstimateCents: 5, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-11-04T10:00:00Z'),
};
const casualProfile = {
  ...standardProfile, id: casualId, tier: 'casual', displayName: '轻松', pointsPerCall: 1,
  enabled: false, description: null, updatedAt: new Date('2026-11-05T10:00:00Z'),
};

const standardVersions = [
  {
    id: '33333333-3333-4333-8333-333333333333', versionNo: 2, status: 'published', provider: 'siliconflow',
    modelName: 'deepseek-ai/DeepSeek-V4-Flash', pointsPerCall: 3, runtimeParams: { maxTokens: 768, thinking: 'off' },
    configHash: 'f'.repeat(64), createdByEmail: 'owner@example.test', isCurrent: true,
    createdAt: new Date('2026-11-06T10:00:00Z'), publishedAt: new Date('2026-11-06T10:00:00Z'),
  },
  {
    id: '44444444-4444-4444-8444-444444444444', versionNo: 1, status: 'published', provider: 'siliconflow',
    modelName: 'deepseek-ai/DeepSeek-V4-Flash', pointsPerCall: 5, runtimeParams: {}, configHash: 'a'.repeat(64),
    createdByEmail: null, isCurrent: false,
    createdAt: new Date('2026-11-01T10:00:00Z'), publishedAt: new Date('2026-11-01T10:00:00Z'),
  },
];

async function renderPage() {
  const Page = (await import('../(console)/models/page.js') as { default: (props: never) => Promise<React.ReactElement> }).default;
  return renderToStaticMarkup(await Page(undefined as never));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(identity);
  mocks.listAdminModels.mockResolvedValue([standardProfile, casualProfile]);
  mocks.listAdminModelVersions.mockResolvedValue(standardVersions);
});

describe('/admin/models page', () => {
  it('queries nothing without an admin identity', async () => {
    mocks.resolve.mockResolvedValue(null);
    const html = await renderPage();
    expect(html).toContain('需要管理员身份');
    expect(html).not.toContain('模型档位');
    expect(mocks.listAdminModels).not.toHaveBeenCalled();
    expect(mocks.listAdminModelVersions).not.toHaveBeenCalled();
  });

  it('resolves the identity from the session cookie before any query', async () => {
    await renderPage();
    expect(mocks.resolve).toHaveBeenCalledWith('test-cookie', {});
    expect(mocks.listAdminModels).toHaveBeenCalledTimes(1);
    expect(mocks.listAdminModelVersions).toHaveBeenCalledTimes(2);
    expect(mocks.listAdminModelVersions).toHaveBeenCalledWith(standardId);
    expect(mocks.listAdminModelVersions).toHaveBeenCalledWith(casualId);
  });

  it('never renders a figure when the tier list fails', async () => {
    mocks.listAdminModels.mockRejectedValue(new Error('db down'));
    const html = await renderPage();
    expect(html).toContain('模型档位暂时无法加载');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('每次点数');
    expect(html).not.toContain('编辑档位');
  });

  it('states the four boundaries the operator must know', async () => {
    const html = await renderPage();
    expect(html).toContain('实际推理模型由 FastClaw Agent 配置决定');
    expect(html).toContain('本页不保存、不接收任何密钥');
    expect(html).toContain('model_profile_unavailable');
    expect(html).toContain('恢复会生成新版本，不改动历史');
    expect(html).toContain('不做真实服务商调用');
    expect(html).toContain('无法核对不等于成功');
  });

  it('renders the tier table with provider/model, points, current version and status', async () => {
    const html = await renderPage();
    expect(html).toContain('aria-label="模型档位列表，可横向滚动"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('轻松');
    expect(html).toContain('标准');
    expect(html).toContain('siliconflow / deepseek-ai/DeepSeek-V4-Flash');
    expect(html).toContain('data-points="3"');
    expect(html).toContain('v2');
    expect(html).toContain('data-tier="standard"');
    expect(html).toContain('data-tier="casual"');
    expect(html).toContain('已启用');
    expect(html).toContain('已禁用');
    expect(html).toContain('新回合会被拒绝');
  });

  it('offers an inline editor per tier with declared parameters and no secret input', async () => {
    const html = await renderPage();
    expect(html).toContain('aria-label="编辑档位 标准"');
    expect(html).toContain('aria-label="编辑档位 轻松"');
    for (const name of ['provider', 'modelName', 'pointsPerCall', 'displayName', 'description', 'maxTokens', 'temperature', 'maxToolIterations', 'thinking']) {
      expect(html, name).toContain(`name="${name}"`);
    }
    expect(html).toContain('name="enabled"');
    expect(html).toContain('保存修改');
    expect(html).toContain('发布当前配置');
    // No input may collect a credential: `maxTokens` is an allowlisted runtime parameter, `token` alone
    // is not a field this page asks for.
    const names = [...html.matchAll(/name="([^"]+)"/g)].map(match => match[1]!);
    expect(names).not.toHaveLength(0);
    for (const name of names) {
      expect(name, name).not.toMatch(/api[-_]?key|secret|credential|password|access[-_]?token/i);
    }
    expect(html).not.toContain('credentialRef');
  });

  it('renders the version history with creator, hash, current marker and a restore action', async () => {
    const html = await renderPage();
    expect(html).toContain('data-version-no="2"');
    expect(html).toContain('data-version-no="1"');
    expect(html).toContain('当前');
    expect(html).toContain('owner@example.test');
    expect(html).toContain('未记录创建人');
    expect(html).toContain('f'.repeat(12));
    expect(html).toContain('恢复');
    expect(html).toContain('恢复会生成新版本，不改动历史');
  });

  it('shows one stable idempotency key for the editing session, not a key per click', async () => {
    const html = await renderPage();
    // The operator can read (and the same key is re-sent) the identifier of this editing session.
    expect(html).toMatch(/name="idempotencyKey"[^>]*value="model-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/);
    // Read-only: the operator copies it; the form cannot type a different one.
    expect(html).toContain('readOnly');
    expect(html).toContain('重新生成幂等标识');
  });

  it('renders the declared runtime parameters in every version-history row', async () => {
    const html = await renderPage();
    // Restore re-applies the declared parameters, so the row an operator picks must show them. The
    // attribute exists only on a history cell (the tier table and the check panel print other copies).
    expect(html).toContain('data-runtime-params="maxTokens=768、thinking=off"');
    expect(html).toContain('data-runtime-params="未声明"');
    expect(html).not.toContain('credentialRef');
  });

  it('renders one check panel per tier labelled 配置一致性检查', async () => {
    const html = await renderPage();
    expect(html.match(/配置一致性检查/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('aria-label="配置一致性检查 标准"');
    expect(html).toContain('aria-label="配置一致性检查 轻松"');
  });

  it('warns that a disabled tier is not usable even after publishing', async () => {
    const html = await renderPage();
    expect(html).toContain('禁用状态下即使发布也不会被新回合使用');
  });
});
