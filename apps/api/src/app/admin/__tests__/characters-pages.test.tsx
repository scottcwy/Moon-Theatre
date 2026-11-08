import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/server/http/errors.js';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }),
  listAdminCharacters: vi.fn(),
  loadCharacterListItem: vi.fn(),
  listAdminScripts: vi.fn(),
  getCharacterPreview: vi.fn(),
  getCharacterDraftDiff: vi.fn(),
  getCharacterEditState: vi.fn(),
  getCharacterSummary: vi.fn(),
  listPublishTasks: vi.fn(),
  getPublishedCharacterVersion: vi.fn(),
  listSessions: vi.fn(),
  listMessages: vi.fn(),
  getSessionMetadata: vi.fn(),
  getTurnVersionAttributions: vi.fn(),
  readCharacterBaseContext: vi.fn(),
  recordAdminAudit: vi.fn(),
}));

vi.stubGlobal('React', React);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test-cookie' }) }) }));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, usePathname: () => '/admin/characters', useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/modules/admin/authentication.js', () => ({ resolveAdminToken: mocks.resolve }));
vi.mock('@/server/modules/admin/index.js', () => ({
  listAdminCharacters: mocks.listAdminCharacters,
  loadCharacterListItem: mocks.loadCharacterListItem,
  listAdminScripts: mocks.listAdminScripts,
  getCharacterPreview: mocks.getCharacterPreview,
  getCharacterDraftDiff: mocks.getCharacterDraftDiff,
  getCharacterEditState: mocks.getCharacterEditState,
  getCharacterSummary: mocks.getCharacterSummary,
  listPublishTasks: mocks.listPublishTasks,
  getPublishedCharacterVersion: mocks.getPublishedCharacterVersion,
  listSessions: mocks.listSessions,
  listMessages: mocks.listMessages,
  getSessionMetadata: mocks.getSessionMetadata,
  readCharacterBaseContext: mocks.readCharacterBaseContext,
  recordAdminAudit: mocks.recordAdminAudit,
}));
vi.mock('@/server/modules/chat/index.js', () => ({ getTurnVersionAttributions: mocks.getTurnVersionAttributions }));

const identity = {
  adminAccountId: 'self',
  credentialVersion: 9,
  sessionId: 'SECRET_SESSION',
  expiresAt: new Date(),
  account: { id: 'self', email: 'owner@example.test', active: true, mustChangePassword: false, isProtected: true, createdAt: new Date(), updatedAt: new Date() },
};
const characterId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const draftVersionId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';

const personas = {
  systemPrompt: 'PERSONA-SYSTEM-PROMPT',
  personalityPrompt: 'PERSONA-PERSONALITY',
  scenarioPrompt: 'PERSONA-SCENARIO',
  safetyPrompt: 'PERSONA-SAFETY',
  outputFormatPrompt: 'PERSONA-OUTPUT',
};
const publishedPayload = {
  name: '顾青梧', avatarUrl: 'https://cdn.example.test/a.png', identity: '冷面刀客', description: '简介',
  scriptId: null, initialRelationship: '初识', agentId: 'role-qingwu', starterQuestions: { script: [], free: ['今日天气如何？'] },
  prompt: personas, sortOrder: 7,
};
const preflightReady = { ready: true, readyModelTiers: 1, warning: null };
const MODEL_PROFILE_PREFLIGHT_WARNING = '运行前置缺失：当前没有已发布的模型档位版本，发布后新回合会被拒绝（需先发布模型档位）。';
const preflightMissing = { ready: false, readyModelTiers: 0, warning: MODEL_PROFILE_PREFLIGHT_WARNING };

const preview = {
  characterId, versionId, versionNo: 3, versionStatus: 'published', isPublished: true,
  card: { name: '顾青梧', avatarUrl: 'https://cdn.example.test/a.png', identity: '冷面刀客', description: '简介' },
  detail: { name: '顾青梧', avatarUrl: 'https://cdn.example.test/a.png', identity: '冷面刀客', description: '简介', initialRelationship: '初识', scriptId: null },
  starterQuestions: { script: [], free: ['今日天气如何？'] },
  availableModes: ['free'],
  script: null,
  scriptSnapshot: null,
  validity: { valid: true, issues: [] },
  preflight: preflightReady,
};
const baseContextRecorded = {
  id: '66666666-6666-4666-8666-666666666666',
  agentId: 'role-qingwu',
  displayNo: 2,
  contentHash: 'f'.repeat(64),
  source: 'publish',
  capturedByAdminAccountId: 'self',
  contentVersionId: versionId,
  contentVersionNo: 3,
  createdAt: new Date('2026-11-07T02:00:00Z'),
};
const baseContextInSync = {
  characterId,
  agentId: 'role-qingwu',
  status: 'in-sync',
  recorded: baseContextRecorded,
  live: { readable: true, contentHash: 'f'.repeat(64), failure: null },
  published: { versionId, versionNo: 3, contentHash: 'f'.repeat(64) },
  matchesPublished: true,
  checkedAt: new Date('2026-11-07T02:05:00Z'),
};
const listItem = {
  character: { id: characterId, name: '顾青梧', status: 'active', agentId: 'role-qingwu', scriptId: null, sortOrder: 7, identity: '冷面刀客', description: '简介', avatarUrl: 'https://cdn.example.test/a.png', updatedAt: new Date('2026-11-07T00:00:00Z') },
  prompt: null,
  publishState: { status: 'active', publishedVersionId: versionId, publishedVersionNo: 3 },
  draftState: { hasDraft: false, draftVersionId: null, draftVersionNo: null, changedFields: [] },
  lastPublishTask: { id: 'task-1', versionId, status: 'committed', recoveryState: null, lastError: null, createdAt: new Date('2026-11-07T00:00:00Z'), updatedAt: new Date('2026-11-07T00:00:00Z') },
};

/** The bounded-list shape every read returns: the page rows plus the page facts. */
function pageOf(items: unknown[], overrides: Partial<{ total: number; page: number; pageSize: number }> = {}) {
  return { items, total: items.length, page: 1, pageSize: 20, ...overrides };
}

function controlTag(html: string, name: string): string {
  return new RegExp(`<(?:input|textarea)(?=[^>]*name="${name}")[^>]*>`).exec(html)?.[0] ?? '';
}

function guardAbsent() {
  mocks.resolve.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(identity);
  mocks.listAdminCharacters.mockResolvedValue(pageOf([listItem]));
  mocks.loadCharacterListItem.mockResolvedValue(listItem);
  mocks.listAdminScripts.mockResolvedValue([{ id: 'script-1', title: '月满楼', status: 'active' }]);
  mocks.getCharacterPreview.mockResolvedValue(preview);
  mocks.getPublishedCharacterVersion.mockResolvedValue({ character: listItem.character, version: { id: versionId, versionNo: 3, status: 'published', payload: publishedPayload } });
  mocks.getCharacterEditState.mockResolvedValue({
    characterId,
    status: 'active',
    agentId: 'role-qingwu',
    scriptId: null,
    sortOrder: 7,
    published: { versionId, versionNo: 3, updatedAt: new Date('2026-11-07T00:00:00Z'), payload: publishedPayload, validity: { valid: true, issues: [] } },
    draft: null,
    editable: { versionId, versionNo: 3, updatedAt: new Date('2026-11-07T00:00:00Z'), source: 'published' },
    changedFields: [],
    preflight: preflightReady,
  });
  mocks.getCharacterSummary.mockResolvedValue({ id: characterId, name: '顾青梧', status: 'active' });
  mocks.listPublishTasks.mockResolvedValue([{ id: 'task-1', entityId: characterId, versionId, versionNo: 3, status: 'committed', recoveryState: null, lastError: null, createdAt: new Date('2026-11-07T00:00:00Z'), updatedAt: new Date('2026-11-07T00:00:00Z') }]);
  mocks.getCharacterDraftDiff.mockResolvedValue({ characterId, draftVersionId: null, draftVersionNo: null, publishedVersionId: versionId, changedFields: [] });
  mocks.listSessions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  mocks.listMessages.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  mocks.getSessionMetadata.mockResolvedValue({ id: sessionId, userId: 'user-1', characterId, title: null, modelTier: 'standard', mode: 'free', status: 'active', createdAt: new Date('2026-11-07T00:00:00Z'), updatedAt: new Date('2026-11-07T00:00:00Z'), characterName: '顾青梧', userName: '小满' });
  mocks.getTurnVersionAttributions.mockResolvedValue([]);
  mocks.readCharacterBaseContext.mockResolvedValue(baseContextInSync);
  mocks.recordAdminAudit.mockResolvedValue('audit-1');
});

describe.each([
  ['characters list', () => import('../(console)/characters/page.js'), () => ({})],
  ['character edit', () => import('../(console)/characters/[id]/edit/page.js'), () => ({ params: Promise.resolve({ id: characterId }) })],
  ['character preview', () => import('../(console)/characters/[id]/preview/page.js'), () => ({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) })],
  ['sessions list', () => import('../(console)/sessions/page.js'), () => ({ searchParams: Promise.resolve({}) })],
  ['session history', () => import('../(console)/sessions/[id]/page.js'), () => ({ params: Promise.resolve({ id: sessionId }), searchParams: Promise.resolve({}) })],
] as const)('%s page', (_name, load, props) => {
  it('queries nothing for an absent or restricted identity', async () => {
    guardAbsent();
    const Page = (await load()).default;
    const html = renderToStaticMarkup(await Page(props() as never));
    expect(html).toContain('需要管理员身份');
    for (const mock of [mocks.listAdminCharacters, mocks.loadCharacterListItem, mocks.listAdminScripts, mocks.getCharacterPreview, mocks.listSessions, mocks.listMessages, mocks.getSessionMetadata, mocks.recordAdminAudit]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it('never serializes session internals', async () => {
    const Page = (await load()).default;
    const html = renderToStaticMarkup(await Page(props() as never));
    expect(html).not.toContain('SECRET_SESSION');
    expect(html).not.toContain('credentialVersion');
  });
});

describe('characters list', () => {
  it('shows publish state, draft divergence and the last publish result as separate columns', async () => {
    mocks.listAdminCharacters.mockResolvedValue(pageOf([{
      ...listItem,
      draftState: { hasDraft: true, draftVersionId, draftVersionNo: 4, changedFields: ['name', 'prompt.systemPrompt'] },
      lastPublishTask: { ...listItem.lastPublishTask, status: 'committed', recoveryState: 'audit_pending' },
    }]));
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({}));
    expect(html).toContain('已上架');
    expect(html).toContain('有草稿改动');
    expect(html).toContain('姓名');
    expect(html).toContain('系统人设');
    expect(html).toContain('已提交，审计待恢复');
    expect(html).toContain(`href="/admin/characters/${characterId}/edit"`);
    expect(html).toContain(`href="/admin/characters/${characterId}/preview"`);
    expect(html).toContain(`href="/admin/sessions?characterId=${characterId}"`);
    expect(html).toContain('role-qingwu');
  });

  it('surfaces the content-incomplete reason straight from the list read, with no preview read at all', async () => {
    mocks.listAdminCharacters.mockResolvedValue(pageOf([{
      ...listItem,
      publishedValidity: { valid: false, issues: [{ path: 'prompt.systemPrompt', message: 'is required' }] },
    }]));
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({}));
    expect(html).toContain('内容待补全：系统人设');
    expect(html).toContain('去补全');
    expect(html).toContain(`href="/admin/characters/${characterId}/edit"`);
    // Only the human label, never the raw English validation text.
    expect(html).not.toContain('is required');
    expect(mocks.getCharacterPreview).not.toHaveBeenCalled();
  });

  it('flags a live character without a published version', async () => {
    mocks.listAdminCharacters.mockResolvedValue(pageOf([{
      ...listItem,
      publishState: { status: 'active', publishedVersionId: null, publishedVersionNo: null },
      lastPublishTask: null,
    }]));
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({}));
    expect(html).toContain('线上版本缺失');
    expect(mocks.getCharacterPreview).not.toHaveBeenCalled();
  });

  it('offers draft-only creation and never advertises trial chat or reply comparison', async () => {
    mocks.listAdminCharacters.mockResolvedValue(pageOf([]));
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({}));
    expect(html).toContain('<p class="empty">');
    expect(html).toContain('暂无角色卡');
    expect(html).toContain('href="/admin/characters/new"');
    expect(html).toContain('新建角色');
    expect(html).not.toContain('暂未提供新建入口');
    for (const banned of ['试聊', '回复比较', '问题标注']) expect(html).not.toContain(banned);
  });

  it('reports a dependency failure without rendering partial data', async () => {
    mocks.listAdminCharacters.mockRejectedValue(new Error('dependency unavailable'));
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({}));
    expect(html).toContain('角色卡暂时无法加载');
    expect(html).not.toContain('顾青梧');
  });

  it('applies the search term, status and page and keeps them in the pagination links', async () => {
    mocks.listAdminCharacters.mockResolvedValue(pageOf([listItem], { total: 41, page: 2, pageSize: 20 }));
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'qingwu', status: 'active', page: '2' }) }));
    expect(mocks.listAdminCharacters).toHaveBeenCalledWith({ page: 2, pageSize: 20, query: 'qingwu', status: 'active' });
    expect(html).toContain('aria-label="搜索角色卡"');
    expect(html).toContain('name="q"');
    expect(html).toContain('name="status"');
    // The page facts come from the count read, never from counting the rendered rows.
    expect(html).toContain('共 41 个角色');
    expect(html).toContain('本页显示 1 个');
    expect(html).toContain('第 2 / 3 页');
    expect(html).toContain('href="/admin/characters?page=3&amp;q=qingwu&amp;status=active"');
    expect(html).toContain('href="/admin/characters?page=1&amp;q=qingwu&amp;status=active"');
    expect(html).toContain('当前筛选：关键词「qingwu」 · 已上架');
    expect(html).toContain('清除筛选');
  });

  it('reports unusable search input and does not apply it', async () => {
    mocks.listAdminCharacters.mockResolvedValue(pageOf([]));
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ q: 'x'.repeat(129), status: 'deleted', page: '0' }),
    }));
    // A typo must not silently widen a 1000-role list: nothing of it reaches the query.
    expect(mocks.listAdminCharacters).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(html).toContain('搜索关键词最多 128 个字符');
    expect(html).toContain('发布状态筛选只能是已上架或未上架');
    expect(html).toContain('页码需为大于 0 的整数');
  });

  it('distinguishes no matches from having no characters at all', async () => {
    mocks.listAdminCharacters.mockResolvedValue(pageOf([]));
    const Page = (await import('../(console)/characters/page.js')).default;
    const filtered = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: '不存在' }) }));
    expect(filtered).toContain('当前筛选下没有匹配的角色卡');
    expect(filtered).not.toContain('暂无角色卡');
    const empty = renderToStaticMarkup(await Page({}));
    expect(empty).toContain('暂无角色卡');
    expect(empty).not.toContain('当前筛选下没有匹配的角色卡');
  });

  it('offers the emergency unpublish entry inside the always-visible first cell (mobile, AC-18)', async () => {
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({}));
    const entry = /<a(?=[^>]*data-character-unpublish-entry)[^>]*>[^<]*<\/a>/.exec(html)?.[0] ?? '';
    expect(entry).toContain(`href="/admin/characters/${characterId}/preview#emergency-unpublish"`);
    expect(entry).toContain('下架（需确认）');
    // It sits in the 角色 cell, which is visible at 390px without scrolling the table to 操作.
    expect(html.indexOf('data-character-unpublish-entry')).toBeLessThan(html.indexOf('>编辑</a>'));
    expect(html.indexOf('data-character-unpublish-entry')).toBeGreaterThan(html.indexOf('<strong>顾青梧</strong>'));
  });

  it('offers no unpublish entry for a character that is not on the shelf', async () => {
    mocks.listAdminCharacters.mockResolvedValue(pageOf([{
      ...listItem,
      publishState: { status: 'inactive', publishedVersionId: null, publishedVersionNo: null },
    }]));
    const Page = (await import('../(console)/characters/page.js')).default;
    const html = renderToStaticMarkup(await Page({}));
    expect(html).not.toContain('data-character-unpublish-entry');
    expect(html).toContain('未上架');
  });
});

describe('character create page', () => {
  it('offers draft-only creation with the contract agent ids and no publish control', async () => {
    const Page = (await import('../(console)/characters/new/page.js')).default;
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('新建角色卡');
    expect(html).toContain('只创建草稿');
    expect(html).toMatch(/<select[^>]*name="agentId"/);
    expect(html).toContain('role-baizang');
    expect(html).toContain('白藏');
    expect(html).toContain('无剧本（仅自由聊天）');
    expect(html).toContain('月满楼');
    for (const control of ['name', 'avatarUrl', 'identity', 'description', 'initialRelationship', 'sortOrder', 'systemPrompt', 'questionsFree']) {
      expect(html).toContain(`name="${control}"`);
    }
    expect(html).toContain('创建草稿');
    expect(html).not.toContain('发布此版本');
    for (const banned of ['试聊', '回复比较', '问题标注']) expect(html).not.toContain(banned);
  });

  it('warns that an unpublished script cannot be published yet', async () => {
    mocks.listAdminScripts.mockResolvedValue([
      { id: 'script-1', title: '月满楼', status: 'active' },
      { id: 'script-2', title: '未上架剧本', status: 'inactive' },
    ]);
    const Page = (await import('../(console)/characters/new/page.js')).default;
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('未上架剧本（未上架）');
    expect(html).toContain('需先在剧本页上架剧本');
    expect(html).toContain('data-script-status="inactive"');
  });

  it('queries nothing for an absent identity', async () => {
    guardAbsent();
    const Page = (await import('../(console)/characters/new/page.js')).default;
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('需要管理员身份');
    expect(mocks.listAdminScripts).not.toHaveBeenCalled();
  });
});

describe('character edit page', () => {
  it('splits the editor into the four approved sections with a read-only agent id', async () => {
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    for (const heading of ['展示资料', '角色人设', '开场引导', '预览与发布']) expect(html).toContain(heading);
    expect(controlTag(html, 'agentId').toLowerCase()).toContain('readonly');
    expect(html).not.toMatch(/<select[^>]*name="agentId"/);
    expect(html).toContain('role-qingwu');
    expect(html).toContain('name="sortOrder"');
    expect(html).toContain('今日天气如何？');
    for (const banned of ['试聊', '回复比较', '问题标注']) expect(html).not.toContain(banned);
  });

  it('prefills the persona fields when the editable base is the published version', async () => {
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toContain('PERSONA-SYSTEM-PROMPT');
    expect(html).toContain('PERSONA-OUTPUT');
    expect(html).not.toContain('人设不可编辑');
    expect(controlTag(html, 'personalityPrompt').toLowerCase()).not.toContain('readonly');
  });

  it('edits the persona from the pending draft base, so a draft never blocks persona editing', async () => {
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      draftState: { hasDraft: true, draftVersionId, draftVersionNo: 4, changedFields: ['name', 'prompt.systemPrompt'] },
    });
    mocks.getCharacterEditState.mockResolvedValue({
      characterId,
      status: 'active',
      agentId: 'role-qingwu',
      scriptId: null,
      sortOrder: 7,
      published: { versionId, versionNo: 3, updatedAt: new Date('2026-11-07T00:00:00Z'), payload: publishedPayload, validity: { valid: true, issues: [] } },
      draft: {
        versionId: draftVersionId, versionNo: 4, updatedAt: new Date('2026-11-07T01:00:00Z'),
        payload: { ...publishedPayload, name: '顾青梧·改', prompt: { ...personas, systemPrompt: 'DRAFT-PERSONA-TEXT' } },
        validity: { valid: true, issues: [] },
      },
      editable: { versionId: draftVersionId, versionNo: 4, updatedAt: new Date('2026-11-07T01:00:00Z'), source: 'draft' },
      changedFields: ['name', 'prompt.systemPrompt'],
      preflight: preflightReady,
    });
    mocks.getCharacterPreview.mockResolvedValue({ ...preview, versionId: draftVersionId, versionNo: 4, versionStatus: 'draft', isPublished: false, card: { ...preview.card, name: '顾青梧·改' } });
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(mocks.getCharacterEditState).toHaveBeenCalledWith(characterId);
    expect(mocks.getCharacterPreview).toHaveBeenCalledWith(characterId, draftVersionId);
    expect(html).toContain('顾青梧·改');
    expect(html).toContain('DRAFT-PERSONA-TEXT');
    expect(html).toContain('当前编辑基准：版本 v4（草稿）');
    expect(html).not.toContain('人设不可编辑');
    expect(controlTag(html, 'personalityPrompt').toLowerCase()).not.toContain('readonly');
  });

  it('lists the bounded publish task history next to the last-task summary', async () => {
    mocks.listPublishTasks.mockResolvedValue([
      { id: 'task-2', entityId: characterId, versionId: draftVersionId, versionNo: 4, status: 'failed', recoveryState: 'audit_pending', lastError: 'injected activation failure', createdAt: new Date('2026-11-07T02:00:00Z'), updatedAt: new Date('2026-11-07T02:00:00Z') },
      { id: 'task-1', entityId: characterId, versionId, versionNo: 3, status: 'committed', recoveryState: null, lastError: null, createdAt: new Date('2026-11-07T01:00:00Z'), updatedAt: new Date('2026-11-07T01:00:00Z') },
    ]);
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(mocks.listPublishTasks).toHaveBeenCalledWith('character', characterId, 5);
    expect(html).toContain('发布任务记录');
    expect(html).toContain('发布失败');
    expect(html).toContain('injected activation failure');
    expect(html).toContain('版本 v4');
    expect(html).toContain('版本 v3');
  });

  it('turns the agent field into a one-time selector when the stored character has no agent id', async () => {
    // S1 repair: a legacy row with `agent_id IS NULL` can only be fixed by naming an agent once.
    mocks.getCharacterEditState.mockResolvedValue({
      characterId,
      status: 'active',
      agentId: null,
      scriptId: null,
      sortOrder: 7,
      published: { versionId, versionNo: 3, updatedAt: new Date('2026-11-07T00:00:00Z'), payload: { ...publishedPayload, agentId: '' }, validity: { valid: false, issues: [{ path: 'agentId', message: 'is required' }] } },
      draft: null,
      editable: { versionId, versionNo: 3, updatedAt: new Date('2026-11-07T00:00:00Z'), source: 'published' },
      changedFields: [],
      preflight: preflightReady,
    });
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toMatch(/<select[^>]*name="agentId"/);
    expect(controlTag(html, 'agentId')).toBe('');
    // Same published contract list as the create page: an operator cannot type a routing id.
    for (const agentId of ['role-baizang', 'role-yisa']) expect(html).toContain(agentId);
    expect(html).toContain('一次性');
    expect(html).toContain('发布时写入');
    expect(html).toContain('内容待补全：Agent 标识');
  });

  it('offers an explicit audit-finalize action only for a task stuck in 审计待恢复', async () => {
    mocks.listPublishTasks.mockResolvedValue([
      { id: 'task-pending', entityId: characterId, versionId, versionNo: 3, status: 'committed', recoveryState: 'audit_pending', lastError: null, createdAt: new Date('2026-11-07T01:00:00Z'), updatedAt: new Date('2026-11-07T01:00:00Z') },
      { id: 'task-done', entityId: characterId, versionId, versionNo: 2, status: 'committed', recoveryState: null, lastError: null, createdAt: new Date('2026-11-07T00:00:00Z'), updatedAt: new Date('2026-11-07T00:00:00Z') },
    ]);
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toContain('审计待恢复');
    expect(html).toContain('尝试完成审计收尾');
    expect(html).toContain('不会重新执行发布');
    const actions = html.match(/data-finalize-audit="[^"]+"/g) ?? [];
    expect(actions).toEqual(['data-finalize-audit="task-pending"']);
  });

  it('tells the operator how to resolve a stale edit baseline', async () => {
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toContain('草稿已在其他页面更新');
    expect(html).toContain('刷新本页');
  });

  it('shows the model-profile preflight beside the publish confirmation in 预览与发布', async () => {
    mocks.getCharacterEditState.mockResolvedValue({
      characterId,
      status: 'active',
      agentId: 'role-qingwu',
      scriptId: null,
      sortOrder: 7,
      published: { versionId, versionNo: 3, updatedAt: new Date('2026-11-07T00:00:00Z'), payload: publishedPayload, validity: { valid: true, issues: [] } },
      draft: null,
      editable: { versionId, versionNo: 3, updatedAt: new Date('2026-11-07T00:00:00Z'), source: 'published' },
      changedFields: [],
      preflight: preflightMissing,
    });
    mocks.getCharacterPreview.mockResolvedValue({ ...preview, preflight: preflightMissing });
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toContain(MODEL_PROFILE_PREFLIGHT_WARNING);
    expect(html).toContain('data-preflight="model-profile"');
    expect(html).toContain('我确认发布此版本');
  });

  it('answers a friendly not-found state for an unknown character', async () => {
    mocks.getCharacterEditState.mockRejectedValue(new NotFoundError('Character'));
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toContain('角色卡不存在');
    expect(mocks.getCharacterPreview).not.toHaveBeenCalled();
  });

  it('offers an explicit first-draft action for a version-less character and drops the dead-end promise', async () => {
    // The verified dead end: an existing character with no content version at all (inactive legacy
    // row, or a row created before versioning) could never be edited, completed or published.
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      character: { ...listItem.character, name: '未纳管旧角色', status: 'inactive', agentId: null, sortOrder: 0 },
      publishState: { status: 'inactive', publishedVersionId: null, publishedVersionNo: null },
      draftState: { hasDraft: false, draftVersionId: null, draftVersionNo: null, changedFields: [] },
      lastPublishTask: null,
    });
    mocks.getCharacterEditState.mockResolvedValue({
      characterId,
      status: 'inactive',
      agentId: null,
      scriptId: null,
      sortOrder: 0,
      published: null,
      draft: null,
      editable: null,
      changedFields: [],
      preflight: preflightReady,
    });
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    // Kept only as the explanation that precedes the action.
    expect(html).toContain('暂无可编辑内容');
    expect(html).toContain(`data-first-draft="${characterId}"`);
    expect(html).toMatch(/<button[^>]*>创建首个草稿<\/button>/);
    expect(html).toContain('不会在打开本页时自动写入');
    // The one-time agent assignment is announced before the draft exists too.
    expect(html).toContain('尚未绑定 Agent 标识');
    // The old copy promised a flow that does not exist anywhere in the console.
    expect(html).not.toContain('请先通过内容初始化或发布流程生成首个版本');
    expect(html).not.toContain('内容初始化');
    // Without a baseline there is no edit form to submit.
    expect(html).not.toContain('aria-label="角色卡编辑"');
    expect(mocks.getCharacterPreview).not.toHaveBeenCalled();
  });

  it('renders the normal form with the one-time agent selector once the first draft exists', async () => {
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      character: { ...listItem.character, name: '未纳管旧角色', status: 'inactive', agentId: null, sortOrder: 0 },
      publishState: { status: 'inactive', publishedVersionId: null, publishedVersionNo: null },
      draftState: { hasDraft: true, draftVersionId, draftVersionNo: 1, changedFields: [] },
      lastPublishTask: null,
    });
    mocks.getCharacterEditState.mockResolvedValue({
      characterId,
      status: 'inactive',
      agentId: null,
      scriptId: null,
      sortOrder: 0,
      published: null,
      draft: {
        versionId: draftVersionId,
        versionNo: 1,
        updatedAt: new Date('2026-11-07T00:00:00Z'),
        payload: { ...publishedPayload, agentId: '', prompt: { ...personas, systemPrompt: '' } },
        validity: { valid: false, issues: [{ path: 'agentId', message: 'is required' }, { path: 'prompt.systemPrompt', message: 'is required' }] },
      },
      editable: { versionId: draftVersionId, versionNo: 1, updatedAt: new Date('2026-11-07T00:00:00Z'), source: 'draft' },
      changedFields: [],
      preflight: preflightReady,
    });
    mocks.getCharacterPreview.mockResolvedValue({ ...preview, versionId: draftVersionId, versionNo: 1, versionStatus: 'draft', isPublished: false });
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).not.toContain('暂无可编辑内容');
    expect(html).not.toContain('data-first-draft');
    expect(html).toMatch(/<select[^>]*name="agentId"/);
    expect(html).toContain('当前编辑基准：版本 v1（草稿）');
    expect(html).toContain('角色人设');
    // The seeded draft is invalid content, and the page says why publishing is refused for now.
    expect(html).toContain('该版本无法通过内容校验，发布会被拒绝');
  });
});

describe('character preview page', () => {
  it('renders card, detail and starter questions as data and never the persona prompts', async () => {
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('冷面刀客');
    expect(html).toContain('今日天气如何？');
    expect(html).toContain('初识');
    for (const persona of Object.values(personas)) expect(html).not.toContain(persona);
    expect(html).not.toContain('systemPrompt');
  });

  it('shows validity issues and image risks without any image processing claim', async () => {
    // S1 readiness speaks about the live content; the previewed version reports its own verdict.
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      publishedValidity: { valid: false, issues: [{ path: 'prompt.systemPrompt', message: 'is required' }] },
    });
    mocks.getCharacterPreview.mockResolvedValue({
      ...preview,
      card: { ...preview.card, avatarUrl: '' },
      validity: { valid: false, issues: [{ path: 'prompt.systemPrompt', message: 'is required' }] },
    });
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('内容待补全：系统人设');
    expect(html).toContain('内容校验：1 项未通过');
    expect(html).toContain('内容校验未通过，发布会被拒绝');
    expect(html).toContain('头像为空');
    expect(html).toContain('后台不处理图片');
    expect(html).toContain('我确认发布此版本');
  });

  it('does not alarm a healthy published character because the previewed draft is invalid', async () => {
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      draftState: { hasDraft: true, draftVersionId, draftVersionNo: 4, changedFields: ['prompt.systemPrompt'] },
      publishedValidity: { valid: true, issues: [] },
    });
    mocks.getCharacterPreview.mockResolvedValue({
      ...preview,
      versionId: draftVersionId,
      versionNo: 4,
      versionStatus: 'draft',
      isPublished: false,
      validity: { valid: false, issues: [{ path: 'prompt.systemPrompt', message: 'is required' }] },
    });
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('内容待补全');
    expect(html).not.toContain('线上版本缺失');
    // The draft's own verdict is still stated where publishing is decided.
    expect(html).toContain('内容校验未通过，发布会被拒绝');
    expect(html).toContain('草稿 v4（尚未发布）');
  });

  it('warns that the bound script is not published instead of claiming the content is publishable', async () => {
    mocks.getCharacterPreview.mockResolvedValue({
      ...preview,
      script: { id: 'script-1', title: '月满楼', slug: 'script-1', coverUrl: null, status: 'inactive' },
    });
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('归属剧本未上架');
    expect(html).toContain('发布前需先上架剧本');
    expect(html).toContain('data-preflight="script"');
  });

  it('shows no script warning when the bound script is active', async () => {
    mocks.getCharacterPreview.mockResolvedValue({
      ...preview,
      script: { id: 'script-1', title: '月满楼', slug: 'script-1', coverUrl: null, status: 'active' },
    });
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('归属剧本未上架');
  });

  it('offers unpublish with explicit confirmation only for a published character', async () => {
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('我确认下架');
    expect(html).toContain('我确认发布此版本');
  });

  it('reaches the emergency unpublish from the top and states its honest effect (mobile, AC-18)', async () => {
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));

    // One anchor from the header to the panel that holds the confirmation, and the panel itself is a
    // plain section: no disclosure, no hidden control, no horizontal scroll needed to reach it.
    expect(html).toMatch(/<a href="#emergency-unpublish">[^<]*<\/a>/);
    expect(html).toMatch(/<section class="panel" id="emergency-unpublish" data-emergency-unpublish="true" aria-labelledby="preview-publish">/);
    expect(html).not.toContain('<details');

    const action = /<div class="publish-action" data-unpublish-action="true">(.*?)<\/div>/s.exec(html)?.[1] ?? '';
    // The confirmation says what actually stops and what survives.
    expect(action).toContain('停止公开展示与新会话');
    expect(action).toContain('历史聊天、版本与发布记录保留');
    // The gate is one explicit Chinese confirmation; it is enabled for a live character, and the
    // action itself is rendered right next to it (only the unticked box keeps it disabled).
    const checkbox = /<input[^>]*type="checkbox"[^>]*>/.exec(action)?.[0] ?? '';
    expect(checkbox).not.toContain('disabled');
    expect(action).toContain('>我确认下架</label>');
    const button = /<button[^>]*data-action="unpublish"[^>]*>[^<]*<\/button>/.exec(action)?.[0] ?? '';
    expect(button).toContain('下架');
    expect(button).toContain('type="button"');
  });

  it('offers no unpublish shortcut for a character that is not on the shelf', async () => {
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      publishState: { status: 'inactive', publishedVersionId: null, publishedVersionNo: null },
    });
    mocks.getCharacterPreview.mockResolvedValue({ ...preview, versionStatus: 'draft', isPublished: false, versionNo: 1 });
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('<a href="#emergency-unpublish">');
    // No live character, no reachable confirmation: the checkbox is disabled, so the action cannot run.
    expect(/<input[^>]*type="checkbox"[^>]*>我确认下架/.exec(html)?.[0] ?? '').toContain('disabled');
  });

  it('previews the requested draft version', async () => {
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({ versionId: draftVersionId }) });
    expect(mocks.getCharacterPreview).toHaveBeenCalledWith(characterId, draftVersionId);
  });

  it('previews the newest draft by default and says which version and validity it shows', async () => {
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      publishState: { status: 'inactive', publishedVersionId: null, publishedVersionNo: null },
      draftState: { hasDraft: true, draftVersionId, draftVersionNo: 1, changedFields: [] },
      lastPublishTask: null,
    });
    mocks.getCharacterPreview.mockResolvedValue({
      ...preview,
      versionId: draftVersionId,
      versionNo: 1,
      versionStatus: 'draft',
      isPublished: false,
    });
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    // D1: no ?versionId= means the service picks the newest draft, so the draft-only character that
    // the create flow just produced has a preview instead of a 404.
    expect(mocks.getCharacterPreview).toHaveBeenCalledWith(characterId, undefined);
    const status = /<span[^>]*data-preview-version-status="draft"[^>]*>[^<]*<\/span>/.exec(html)?.[0] ?? '';
    expect(status).toContain('草稿 v1（尚未发布）');
    expect(html).toContain('未指定版本：默认预览最新草稿');
    expect(html).toContain('内容校验：通过');
  });

  it('reports the model-profile preflight next to the publish confirmation without blocking publish', async () => {
    mocks.getCharacterPreview.mockResolvedValue({ ...preview, preflight: preflightMissing });
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain(MODEL_PROFILE_PREFLIGHT_WARNING);
    expect(html).toContain('data-preflight="model-profile"');
    expect(html).toContain('我确认发布此版本');
    // Honest wording: publish itself still succeeds; only a following turn is refused.
    expect(html).toContain('发布仍会成功');
    expect(html).toContain('新回合会被拒绝');
    const checkbox = /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? '';
    expect(checkbox).not.toContain('disabled');
  });

  it('shows no preflight warning when a published model profile version exists', async () => {
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('运行前置缺失');
    expect(html).not.toContain('data-preflight="model-profile"');
  });

  it('explains a character that has neither a draft nor a published version instead of a generic failure', async () => {
    mocks.getCharacterPreview.mockRejectedValue(new NotFoundError('Character draft or published version'));
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('该角色还没有任何内容版本');
    expect(html).not.toContain('角色卡预览暂时无法加载');
  });

  it('points a version-less character at the edit-page first-draft action', async () => {
    mocks.getCharacterPreview.mockRejectedValue(new NotFoundError('Character draft or published version'));
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    // "请先保存一次完整草稿" is now an action that exists, on the edit page.
    expect(html).toContain(`href="/admin/characters/${characterId}/edit"`);
    expect(html).toContain('创建首个草稿');
  });
});

describe('sessions list page', () => {
  it('keeps the empty state and adds links into a session transcript', async () => {
    mocks.listSessions.mockResolvedValue({ items: [{ id: sessionId, userId: 'user-1', characterId, title: null, modelTier: 'standard', status: 'active', createdAt: new Date(), updatedAt: new Date(), characterName: '顾青梧', userName: '小满' }], total: 1, page: 1, pageSize: 20 });
    const Page = (await import('../(console)/sessions/page.js')).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="/admin/sessions/${sessionId}"`);
    expect(html).toContain('顾青梧');
    mocks.listSessions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const empty = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(empty).toContain('暂无玩家会话。玩家开始聊天后，会话将显示在这里。');
  });

  it('filters by character and mode and names the character in the filter summary', async () => {
    const Page = (await import('../(console)/sessions/page.js')).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ characterId, mode: 'free' }) }));
    expect(mocks.listSessions).toHaveBeenCalledWith({ page: 1, pageSize: 50, characterId, mode: 'free' });
    expect(mocks.getCharacterSummary).toHaveBeenCalledWith(characterId);
    expect(html).toContain('角色《顾青梧》');
    expect(html).toContain('自由模式');
    expect(html).not.toContain('暂不支持');
    expect(html).toContain(`href="/admin/characters/${characterId}/edit"`);
    expect(html).toContain('返回角色编辑');
    expect(html).toContain(`value="${characterId}"`);
  });

  it('keeps every filter in the pagination links and names what is filtered in the empty state', async () => {
    mocks.listSessions.mockResolvedValue({ items: [], total: 120, page: 1, pageSize: 50 });
    const Page = (await import('../(console)/sessions/page.js')).default;
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ characterId, mode: 'script', userId, status: 'active' }),
    }));
    expect(mocks.listSessions).toHaveBeenCalledWith({ page: 1, pageSize: 50, characterId, mode: 'script', userId, status: 'active' });
    expect(html).toContain(
      `href="/admin/sessions?page=2&amp;characterId=${characterId}&amp;mode=script&amp;userId=${userId}&amp;status=active"`,
    );
    expect(html).toContain('当前筛选下暂无玩家会话');
    expect(html).toContain('角色《顾青梧》');
    expect(html).toContain('剧本模式');
  });

  it('filters sessions by created date and keeps the range in pagination links and the summary', async () => {
    mocks.listSessions.mockResolvedValue({ items: [], total: 120, page: 1, pageSize: 50 });
    const Page = (await import('../(console)/sessions/page.js')).default;
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ characterId, mode: 'free', from: '2026-11-01', to: '2026-11-07' }),
    }));
    expect(mocks.listSessions).toHaveBeenCalledWith({
      page: 1, pageSize: 50, characterId, mode: 'free', from: '2026-11-01', to: '2026-11-07',
    });
    expect(html).toContain('name="from"');
    expect(html).toContain('name="to"');
    expect(html).toContain('创建日期 2026-11-01 至 2026-11-07');
    expect(html).toContain(
      `href="/admin/sessions?page=2&amp;characterId=${characterId}&amp;mode=free&amp;from=2026-11-01&amp;to=2026-11-07"`,
    );
  });

  it('explains an unusable or inverted created-date range instead of silently dropping it', async () => {
    const Page = (await import('../(console)/sessions/page.js')).default;
    const malformed = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ from: '2026/11/01' }) }));
    expect(mocks.listSessions).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });
    expect(malformed).toContain('创建日期需为 YYYY-MM-DD');
    const inverted = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ from: '2026-11-07', to: '2026-11-01' }) }));
    expect(mocks.listSessions).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });
    expect(inverted).toContain('开始日期不能晚于结束日期');
  });

  it('asks for a complete player UUID and a known mode instead of silently dropping the filter', async () => {
    const Page = (await import('../(console)/sessions/page.js')).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ userId: 'user-1', mode: 'roleplay' }) }));
    expect(mocks.listSessions).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    expect(html).toContain('玩家 ID 需为完整 UUID');
    expect(html).toContain('模式只能是剧本或自由');
  });

  it('stays usable when the character in the filter no longer exists', async () => {
    mocks.getCharacterSummary.mockResolvedValue(null);
    const Page = (await import('../(console)/sessions/page.js')).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ characterId }) }));
    expect(mocks.listSessions).toHaveBeenCalledWith({ page: 1, pageSize: 50, characterId });
    expect(html).toContain('角色已不存在');
  });
});

describe('session history page', () => {
  it('paginates the transcript and shows 版本未知 where no snapshot exists', async () => {
    mocks.listMessages.mockResolvedValue({
      items: [
        { id: 'm-user', role: 'user', content: '第一回合的问题', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date('2026-11-07T00:00:00Z') },
        { id: 'm-legacy', role: 'user', content: '旧问题', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date('2026-11-07T00:01:00Z') },
        { id: 'm-assistant', role: 'assistant', content: '回复正文', mood: '平静', modelTier: 'standard', tokensUsed: 12, pointsConsumed: null, createdAt: new Date('2026-11-07T00:02:00Z') },
      ], total: 41, page: 2, pageSize: 20,
    });
    mocks.getTurnVersionAttributions.mockResolvedValue([
      { userMessageId: 'm-user', contentVersionId: versionId, contentVersionNo: 3, modelProfileVersionId: 'model-version-1', versionUnknown: false },
      { userMessageId: 'm-legacy', contentVersionId: null, contentVersionNo: null, modelProfileVersionId: null, versionUnknown: true },
    ]);
    const Page = (await import('../(console)/sessions/[id]/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }), searchParams: Promise.resolve({ page: '2' }) }));
    expect(mocks.listMessages).toHaveBeenCalledWith({ sessionId, page: 2, pageSize: 20 });
    expect(html).toContain('版本 v3');
    expect(html).toContain('版本未知');
    expect(html).toContain('回复正文');
    expect(html).toContain('小满');
    expect(html).toContain(`href="/admin/sessions/${sessionId}?page=1"`);
    expect(html).toContain(`href="/admin/sessions/${sessionId}?page=3"`);
    expect(html).toContain(`href="/admin/characters/${characterId}/edit"`);
    expect(html).toContain('返回角色编辑');
  });

  it('links a snapshotted turn to the version content it was accepted with and keeps 版本未知 inert', async () => {
    mocks.listMessages.mockResolvedValue({
      items: [
        { id: 'm-user', role: 'user', content: '第一回合的问题', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date('2026-11-07T00:00:00Z') },
        { id: 'm-legacy', role: 'user', content: '旧问题', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date('2026-11-07T00:01:00Z') },
      ], total: 2, page: 1, pageSize: 20,
    });
    mocks.getTurnVersionAttributions.mockResolvedValue([
      { userMessageId: 'm-user', contentVersionId: versionId, contentVersionNo: 3, modelProfileVersionId: 'model-version-1', versionUnknown: false },
      { userMessageId: 'm-legacy', contentVersionId: null, contentVersionNo: null, modelProfileVersionId: null, versionUnknown: true },
    ]);
    const Page = (await import('../(console)/sessions/[id]/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }), searchParams: Promise.resolve({}) }));
    // AC-25: the badge opens exactly that turn's version content, through the guarded preview page.
    expect(html).toContain(`href="/admin/characters/${characterId}/preview?versionId=${versionId}"`);
    expect(html).toMatch(/<a[^>]*href="\/admin\/characters\/[^"]*preview\?versionId=[^"]*"[^>]*>[^<]*版本 v3/);
    // A turn without a snapshot stays text, with an accessible explanation instead of a dead link.
    expect(html).not.toMatch(/<a[^>]*>版本未知/);
    expect(html).toContain('aria-describedby="version-unknown-note"');
    expect(html).toContain('该回合没有保存角色卡版本快照');
  });

  it('does not render the transcript when the access audit fails', async () => {
    mocks.listMessages.mockResolvedValue({ items: [{ id: 'm-user', role: 'user', content: 'SECRET-CHAT-TEXT', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date() }], total: 1, page: 1, pageSize: 20 });
    mocks.recordAdminAudit.mockRejectedValue(new Error('audit down'));
    const Page = (await import('../(console)/sessions/[id]/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('无法记录本次聊天原文访问');
    expect(html).not.toContain('SECRET-CHAT-TEXT');
  });

  it('shows a friendly not-found state for an unknown session', async () => {
    mocks.getSessionMetadata.mockRejectedValue(new Error('Session not found'));
    const Page = (await import('../(console)/sessions/[id]/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('会话暂时无法加载');
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });
});

/**
 * Batch 3 step 1 (plan W): the derived FastClaw base context is shown as a separate, honest fact —
 * the recorded version (`b#` + capture time) and whether the live files still match it. Nothing here
 * renders persona text: the read model carries hashes and ordinals only.
 */
describe('character base context surfaces', () => {
  it('shows the recorded base context with its ordinal, time and state on the edit page', async () => {
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(mocks.readCharacterBaseContext).toHaveBeenCalledWith(characterId);
    expect(html).toContain('基础上下文（FastClaw 派生缓存）');
    expect(html).toContain('data-base-context-badge');
    expect(html).toContain('b2');
    expect(html).toContain('发布时记录');
    expect(html).toContain('已同步');
    expect(html).toContain('重建基础上下文');
    // The disclosure stays truthful about the runtime: the console files still drive a turn.
    expect(html).toContain('运行时会话仍使用控制台里的实时文件');
    // The base-context section itself carries hashes/ordinals only (the persona editor is elsewhere).
    const section = /<section[^>]*aria-labelledby="section-base-context"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(section).not.toBe('');
    expect(section).not.toContain(personas.systemPrompt);
    expect(section).not.toContain('# Soul');
  });

  it('says the console was hand-edited, offers the rebuild and never claims a sync', async () => {
    mocks.readCharacterBaseContext.mockResolvedValue({
      ...baseContextInSync,
      status: 'drifted',
      live: { readable: true, contentHash: '0'.repeat(64), failure: null },
    });
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toContain('控制台已被手改，与已发布版本不一致');
    expect(html).toContain('data-base-context-notice');
    expect(html).toContain('重建基础上下文');
    expect(html).not.toContain('基础上下文：</p>');
  });

  it('reports an unreadable FastClaw as unavailable instead of in-sync', async () => {
    mocks.readCharacterBaseContext.mockResolvedValue({
      ...baseContextInSync,
      status: 'unavailable',
      live: { readable: false, contentHash: null, failure: 'unreachable' },
      matchesPublished: null,
    });
    const Page = (await import('../(console)/characters/[id]/preview/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('FastClaw 不可用，无法核对基础上下文');
    expect(html).not.toContain('已同步');
  });

  it('says 基础上下文未记录 when nothing was ever recorded', async () => {
    mocks.readCharacterBaseContext.mockResolvedValue({
      ...baseContextInSync,
      status: 'unrecorded',
      recorded: null,
      matchesPublished: null,
    });
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toContain('基础上下文未记录');
  });

  it('keeps the edit page usable when the base context state cannot be read at all', async () => {
    mocks.readCharacterBaseContext.mockRejectedValue(new Error('dependency down'));
    const Page = (await import('../(console)/characters/[id]/edit/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: characterId }) }));
    expect(html).toContain('无法读取基础上下文状态');
    // The rest of the editor still renders: a FastClaw/PG hiccup must not hide the content form.
    expect(html).toContain('name="name"');
  });

  it('shows 基础上下文 b# next to the version badge and 基础上下文未记录 for a legacy turn', async () => {
    mocks.listMessages.mockResolvedValue({
      items: [
        { id: 'm-user', role: 'user', content: '第一回合的问题', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date('2026-11-07T00:00:00Z') },
        { id: 'm-old', role: 'user', content: '更早的问题', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date('2026-11-07T00:01:00Z') },
      ], total: 2, page: 1, pageSize: 20,
    });
    mocks.getTurnVersionAttributions.mockResolvedValue([
      { userMessageId: 'm-user', contentVersionId: versionId, contentVersionNo: 3, modelProfileVersionId: 'model-version-1', agentContextVersionId: baseContextRecorded.id, agentContextVersionNo: 2, versionUnknown: false },
      { userMessageId: 'm-old', contentVersionId: versionId, contentVersionNo: 2, modelProfileVersionId: 'model-version-1', agentContextVersionId: null, agentContextVersionNo: null, versionUnknown: false },
    ]);
    const Page = (await import('../(console)/sessions/[id]/page.js')).default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('版本 v3');
    expect(html).toContain('基础上下文 b2');
    expect(html).toContain('基础上下文未记录');
    expect(html).not.toContain(personas.systemPrompt);
  });
});
