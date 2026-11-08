import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_LIMITS_COPY } from '@/server/modules/media/limits.js';
import type { AdminScriptCoverState } from '@/server/modules/admin/content.js';

/**
 * The reusable media control, mounted where the brief requires it: the character create form, the
 * character edit form and the script cover form. The manual URL input keeps its existing name, so
 * every already-published absolute URL stays editable and valid; the file picker only fills it.
 */
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }),
  listAdminScripts: vi.fn(),
  // Typed against the real contract: a drifting fixture (e.g. `draft` instead of
  // `draftVersionNo`/`draftCoverUrl`) fails the typecheck instead of passing through `any`.
  getAdminScriptCoverState: vi.fn<(id: string) => Promise<AdminScriptCoverState>>(),
  listPublishTasks: vi.fn(),
  loadCharacterListItem: vi.fn(),
  getCharacterPreview: vi.fn(),
  readCharacterBaseContext: vi.fn(),
}));

vi.stubGlobal('React', React);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test-cookie' }) }) }));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, usePathname: () => '/admin/characters', useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server/modules/admin/authentication.js', () => ({ resolveAdminToken: mocks.resolve }));
vi.mock('@/server/modules/admin/index.js', () => ({
  listAdminScripts: mocks.listAdminScripts,
  getAdminScriptCoverState: mocks.getAdminScriptCoverState,
  listPublishTasks: mocks.listPublishTasks,
  loadCharacterListItem: mocks.loadCharacterListItem,
  getCharacterPreview: mocks.getCharacterPreview,
  readCharacterBaseContext: mocks.readCharacterBaseContext,
}));

const { CharacterCreateForm, CharacterEditForm } = await import('../character-forms.js');
const { characterEditValues } = await import('../character-patch.js');
const scriptsListPage = await import('../(console)/scripts/page.js');
const scriptCoverPage = await import('../(console)/scripts/[id]/page.js');
const previewPage = await import('../(console)/characters/[id]/preview/page.js');

const identity = {
  adminAccountId: 'self', credentialVersion: 9, sessionId: 'SECRET_SESSION', expiresAt: new Date(),
  account: { id: 'self', email: 'owner@example.test', active: true, mustCreatePassword: false, mustChangePassword: false, isProtected: true, createdAt: new Date(), updatedAt: new Date() },
};
const scriptId = '11111111-1111-4111-8111-111111111111';
const characterId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const mediaUrl = 'https://api.example.test/api/media/44444444-4444-4444-8444-444444444444';

const payload = {
  name: '顾青梧', avatarUrl: mediaUrl, identity: '冷面刀客', description: '简介',
  initialRelationship: '初识', sortOrder: 7, agentId: 'role-qingwu',
  starterQuestions: { script: [], free: [] },
  prompt: { systemPrompt: 's', personalityPrompt: 'p', scenarioPrompt: 'c', safetyPrompt: 'f', outputFormatPrompt: 'o' },
};

// Annotated, not inferred: the mock must carry exactly the fields `AdminScriptCoverState` declares.
const scriptState: AdminScriptCoverState = {
  script: { id: scriptId, title: '月满楼', slug: 'moon-tower', status: 'active', coverUrl: mediaUrl, updatedAt: new Date('2026-11-07T00:00:00Z') },
  baselineAt: new Date('2026-11-07T00:00:00.000Z'),
  draftVersionNo: null,
  draftCoverUrl: null,
  editableCoverUrl: mediaUrl,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(identity);
  mocks.listAdminScripts.mockResolvedValue([scriptState.script]);
  mocks.getAdminScriptCoverState.mockResolvedValue(scriptState);
  mocks.listPublishTasks.mockResolvedValue([]);
  mocks.readCharacterBaseContext.mockResolvedValue(null);
  mocks.loadCharacterListItem.mockResolvedValue({
    character: { id: characterId, name: '顾青梧', status: 'active', agentId: 'role-qingwu', scriptId: null, sortOrder: 7 },
    publishState: { status: 'active', publishedVersionId: versionId, publishedVersionNo: 3 },
    draftState: { hasDraft: false, draftVersionId: null, draftVersionNo: null, changedFields: [] },
    lastPublishTask: null,
  });
  mocks.getCharacterPreview.mockResolvedValue({
    characterId, versionId, versionNo: 3, versionStatus: 'published', isPublished: true,
    card: { name: '顾青梧', avatarUrl: mediaUrl, identity: '冷面刀客', description: '简介' },
    detail: { name: '顾青梧', avatarUrl: mediaUrl, identity: '冷面刀客', description: '简介', initialRelationship: '初识', scriptId },
    starterQuestions: { script: [], free: [] }, availableModes: ['script', 'free'],
    script: { id: scriptId, title: '月满楼', slug: 'moon-tower', coverUrl: mediaUrl, status: 'active' },
    scriptSnapshot: { title: '月满楼', worldSetting: '世界观' },
    validity: { valid: true, issues: [] }, preflight: { ready: true, readyModelTiers: 1, warning: null },
  });
});

function fileInput(html: string, name: string): string {
  return new RegExp(`<input(?=[^>]*type="file")(?=[^>]*data-media-file="${name}")[^>]*>`).exec(html)?.[0] ?? '';
}

function manualInput(html: string, name: string): string {
  const tag = new RegExp(`<input(?=[^>]*name="${name}")[^>]*>`).exec(html)?.[0] ?? '';
  return tag.includes('type="file"') ? '' : tag;
}

describe('character avatar upload control', () => {
  it('mounts the manual URL field and the file picker in the create form', () => {
    const html = renderToStaticMarkup(<CharacterCreateForm agents={[{ agentId: 'role-qingwu', name: '顾青梧' }]} scripts={[]} />);
    expect(manualInput(html, 'avatarUrl')).toContain('required');
    expect(fileInput(html, 'avatarUrl')).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain(MEDIA_LIMITS_COPY);
    expect(html).toContain('上传并使用');
    expect(html).not.toContain('MEDIA_ROOT');
    expect(html).not.toContain('/data/media');
  });

  it('keeps the same field name and the existing value in the edit form', () => {
    const values = characterEditValues(payload, 'role-qingwu');
    const html = renderToStaticMarkup(<CharacterEditForm
      characterId={characterId}
      versionId={versionId}
      versionNo={3}
      editedFrom="published"
      agentId="role-qingwu"
      agentOptions={[{ agentId: 'role-qingwu', name: '顾青梧' }]}
      scriptTitle={null}
      scriptStatus={null}
      values={values}
    />);
    expect(manualInput(html, 'avatarUrl')).toContain(`value="${mediaUrl}"`);
    expect(fileInput(html, 'avatarUrl')).toContain('data-media-file="avatarUrl"');
    expect(html).toContain(MEDIA_LIMITS_COPY);
    expect(html).toContain('上传并使用');
  });
});

describe('script cover pages', () => {
  const props = (id = scriptId) => ({ params: Promise.resolve({ id }) });

  it('guards the list before querying and shows each script with its cover', async () => {
    mocks.resolve.mockResolvedValue(null);
    const blocked = renderToStaticMarkup(await scriptsListPage.default());
    expect(blocked).toContain('需要管理员身份');
    expect(mocks.listAdminScripts).not.toHaveBeenCalled();

    mocks.resolve.mockResolvedValue(identity);
    const html = renderToStaticMarkup(await scriptsListPage.default());
    expect(html).toContain('<h1>剧本封面</h1>');
    expect(html).toContain('月满楼');
    expect(html).toContain(`href="/admin/scripts/${scriptId}"`);
    expect(html).toContain(`src="${mediaUrl}"`);
    expect(html).toContain('更新封面');
  });

  it('renders a load failure instead of a partial table', async () => {
    mocks.listAdminScripts.mockRejectedValue(new Error('down'));
    const html = renderToStaticMarkup(await scriptsListPage.default());
    expect(html).toContain('剧本封面暂时无法加载');
    expect(html).not.toContain('<table>');
  });

  it('guards the cover editor before loading the script', async () => {
    mocks.resolve.mockResolvedValue(null);
    const html = renderToStaticMarkup(await scriptCoverPage.default(props()));
    expect(html).toContain('需要管理员身份');
    expect(mocks.getAdminScriptCoverState).not.toHaveBeenCalled();
  });

  it('offers manual URL entry plus upload, with limits copy and an honest publish meaning', async () => {
    const html = renderToStaticMarkup(await scriptCoverPage.default(props()));
    expect(html).toContain('<h1>剧本封面 · 月满楼</h1>');
    expect(manualInput(html, 'coverUrl')).toContain(`value="${mediaUrl}"`);
    expect(fileInput(html, 'coverUrl')).toContain('data-media-file="coverUrl"');
    expect(html).toContain(MEDIA_LIMITS_COPY);
    expect(html).toContain('保存并发布封面');
    expect(html).toContain('发布后小程序生效');
    // The live cover, the baseline and "no draft" are three separate real fields, not a placeholder.
    expect(html).toContain(mediaUrl);
    expect(html).toContain('data-script-cover-baseline="2026-11-07T00:00:00.000Z"');
    expect(html).toContain('无草稿');
    expect(html).not.toContain('/data/media');
  });

  it('renders the newest draft as its version number plus the draft cover', async () => {
    const draftUrl = 'https://api.example.test/api/media/55555555-5555-4555-8555-555555555555';
    mocks.getAdminScriptCoverState.mockResolvedValue({
      ...scriptState, draftVersionNo: 2, draftCoverUrl: draftUrl, editableCoverUrl: draftUrl,
    });
    const html = renderToStaticMarkup(await scriptCoverPage.default(props()));
    expect(html).toContain(`v2（封面：${draftUrl}）`);
    expect(html).not.toContain('无草稿');
    // The form starts from the draft cover, which is what the next publish would activate.
    expect(manualInput(html, 'coverUrl')).toContain(`value="${draftUrl}"`);
  });

  it('renders a draft that has no cover as an explicit 未配置 instead of the live one', async () => {
    mocks.getAdminScriptCoverState.mockResolvedValue({
      ...scriptState, draftVersionNo: 4, draftCoverUrl: null, editableCoverUrl: null,
    });
    const html = renderToStaticMarkup(await scriptCoverPage.default(props()));
    expect(html).toContain('v4（封面：未配置）');
    expect(manualInput(html, 'coverUrl')).toContain('value=""');
  });

  it('saves only a draft for a script that is not published', async () => {
    mocks.getAdminScriptCoverState.mockResolvedValue({ ...scriptState, script: { ...scriptState.script, status: 'inactive' } });
    const html = renderToStaticMarkup(await scriptCoverPage.default(props()));
    expect(html).toContain('保存封面草稿');
    expect(html).not.toContain('保存并发布封面');
    expect(html).toContain('该剧本尚未上架');
  });

  it('lists the bounded publish-task history and offers the shared finalize action only while pending', async () => {
    mocks.listPublishTasks.mockResolvedValue([
      { id: 'task-pending', entityType: 'script', entityId: scriptId, versionId, versionNo: 2, status: 'committed', recoveryState: 'audit_pending', lastError: null, createdAt: new Date('2026-11-07T01:00:00Z'), updatedAt: new Date('2026-11-07T01:00:00Z') },
      { id: 'task-done', entityType: 'script', entityId: scriptId, versionId, versionNo: 1, status: 'committed', recoveryState: null, lastError: null, createdAt: new Date('2026-11-06T01:00:00Z'), updatedAt: new Date('2026-11-06T01:00:00Z') },
    ]);
    const html = renderToStaticMarkup(await scriptCoverPage.default(props()));
    expect(mocks.listPublishTasks).toHaveBeenCalledWith('script', scriptId, 5);
    expect(html).toContain('发布任务记录');
    expect(html).toContain('审计待恢复');
    expect(html).toContain('尝试完成审计收尾');
    expect(html).toContain('不会重新执行发布或调账');
    const actions = html.match(/data-finalize-audit="[^"]+"/g) ?? [];
    expect(actions).toEqual(['data-finalize-audit="task-pending"']);
  });

  it('shows no finalize action when no publish audit is pending', async () => {
    mocks.listPublishTasks.mockResolvedValue([
      { id: 'task-done', entityType: 'script', entityId: scriptId, versionId, versionNo: 1, status: 'committed', recoveryState: null, lastError: null, createdAt: new Date('2026-11-06T01:00:00Z'), updatedAt: new Date('2026-11-06T01:00:00Z') },
    ]);
    const html = renderToStaticMarkup(await scriptCoverPage.default(props()));
    expect(html).toContain('发布成功');
    expect(html).not.toContain('尝试完成审计收尾');
    expect(html).not.toContain('data-finalize-audit=');
  });

  it('reports a missing script and a load failure separately', async () => {
    const { NotFoundError } = await import('@/server/http/errors.js');
    mocks.getAdminScriptCoverState.mockRejectedValue(new NotFoundError('Script'));
    expect(renderToStaticMarkup(await scriptCoverPage.default(props()))).toContain('剧本不存在');
    mocks.getAdminScriptCoverState.mockRejectedValue(new Error('down'));
    expect(renderToStaticMarkup(await scriptCoverPage.default(props()))).toContain('剧本封面暂时无法加载');
  });
});

describe('preview uses the real media URL', () => {
  it('renders the asset URL as an image and does not call it a placeholder', async () => {
    const html = renderToStaticMarkup(await previewPage.default({
      params: Promise.resolve({ id: characterId }),
      searchParams: Promise.resolve({}),
    }));
    expect(html).toContain(`src="${mediaUrl}"`);
    expect(html).toContain(`alt="角色顾青梧头像预览"`);
    expect(html).toContain(`alt="剧本《月满楼》封面预览"`);
    expect(html).not.toContain('头像未配置');
    expect(html).not.toContain('封面未配置');
    expect(html).not.toContain('不是 HTTPS');
  });
});
