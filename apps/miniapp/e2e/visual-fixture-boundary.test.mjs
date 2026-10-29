import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIRM_SHEET_FIXTURE, PENDING_RESULT_FIXTURE } from '../src/pages/quota/visual-fixture/fixtures';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(e2eDir, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(e2eDir, 'visual-fixtures/second-contract', `${name}.json`), 'utf8'));
const matrix = JSON.parse(fs.readFileSync(path.join(e2eDir, 'visual-frame-matrix-second-contract.json'), 'utf8'));
const masks = JSON.parse(fs.readFileSync(path.join(e2eDir, 'approved-masks-second-contract.json'), 'utf8'));

const fixtureFiles = [
  'apps/miniapp/src/pages/quota/visual-fixture/index.tsx',
  'apps/miniapp/src/pages/quota/visual-fixture/fixtures.ts',
];

const presentationalFiles = [
  'packages/miniapp-ui/src/components/quota/PaymentConfirmSheet.tsx',
  'packages/miniapp-ui/src/components/quota/PaymentResultPanel.tsx',
  'packages/miniapp-ui/src/components/quota/QuotaPackageList.tsx',
];

const forbidden = [
  { pattern: /services\/api/, label: 'imports services/api' },
  { pattern: /requestPayment/, label: 'references requestPayment' },
  { pattern: /\borders\b/, label: 'mentions orders' },
  { pattern: /\bprepay\b/, label: 'mentions prepay' },
  { pattern: /mock-confirm/, label: 'mentions mock-confirm' },
];

describe('visual fixture payment boundary', () => {
  for (const relativePath of [...fixtureFiles, ...presentationalFiles]) {
    it(`${relativePath} stays presentational`, () => {
      const filePath = path.join(repoRoot, relativePath);
      expect(fs.existsSync(filePath), `${relativePath} is missing`).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      for (const { pattern, label } of forbidden) {
        expect(pattern.test(content), `${relativePath} ${label}`).toBe(false);
      }
    });
  }

  it('production app config registers the fixture page only behind VISUAL_FIXTURES', () => {
    const config = fs.readFileSync(path.join(repoRoot, 'apps/miniapp/src/app.config.ts'), 'utf8');
    expect(config).toMatch(/VISUAL_FIXTURES/);
    expect(config).toMatch(/pages\/quota\/visual-fixture\/index/);
  });

  it('12 帧 fixture 路由、查询与矩阵一致', () => {
    expect(matrix.frames).toHaveLength(12);
    for (const frame of matrix.frames) {
      const data = fixture(frame.fixture);
      expect(data.name).toBe(frame.fixture);
      expect(data.route).toBe(frame.route);
      expect(data.query).toBe(frame.search);
      expect(masks[frame.masks]).toBeDefined();
    }
    expect(matrix.viewport).toEqual({ width: 390, height: 844 });
  });

  it('顶部遮罩保留标题与聊天模式控件，文档 JSON 与实现一致', () => {
    const covers = (group, x, y) => masks[group].some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
    for (const group of ['default', 'keyboard', 'searchInputText', 'tabDefault', 'tabKeyboard', 'chatEmpty']) {
      expect(covers(group, 190, 60), group).toBe(false);
      expect(masks[group].filter((rect) => rect.y < 92 && rect.width === 390)).toEqual([
        { x: 0, y: 0, width: 390, height: 47, reason: '微信系统状态栏' },
      ]);
    }
    expect(covers('chatEmpty', 330, 70)).toBe(false);
    expect(matrix.frames[1].masks).toBe('chatEmpty');
    expect(matrix.frames.filter((frame) => frame.kind === 'component').every((frame) => frame.wholeScreenStatus === 'BLOCKED')).toBe(true);
    const spec = read('docs/specs/2026-10-19-第二份合同UI前端更新Spec.md').split('### 7.3 遮罩')[1];
    expect(JSON.parse(spec.match(/```json\n([\s\S]*?)\n```/)[1])).toEqual(masks);
  });

  it('首页 hero 与列表分槽，不把缺失正文伪装成短文', () => {
    const home = fixture('home-default');
    expect(home.scripts).toHaveLength(7);
    expect(home.scripts.every((script) => typeof script.description === 'string')).toBe(true);
    expect(home.scripts[0].description).toBe(fixture('home-search-results').response.scripts[0].description);
    expect(home.scriptRow.scriptIds).toEqual(home.scripts.slice(0, 3).map((script) => script.id));
    expect(home.scriptRow.description).toBe('剧本内容在这里'.repeat(10) + '剧本内容......');
    const source = read('apps/miniapp/src/pages/home/index.tsx');
    expect(source).toMatch(/typeof VISUAL_FIXTURES !== 'undefined' && VISUAL_FIXTURES\s*\? require\('[^']+home-default.json'\)/);
    expect(source).not.toContain(home.scriptRow.title);
    expect(source).not.toContain(home.scriptRow.description);
    expect(source).toContain('display?.description ?? (script.description');
  });

  it('8/9 最终 props 从 JSON 适配，pending 不渲染多余点数行', () => {
    const confirm = fixture('payment-confirm-sheet');
    expect(CONFIRM_SHEET_FIXTURE).toEqual({
      packageName: confirm.package.name,
      points: confirm.package.points,
      amountCents: confirm.package.priceCents,
      balanceAfterPoints: confirm.balanceAfterPoints,
    });
    expect(PENDING_RESULT_FIXTURE).toEqual(fixture('payment-result-pending').panel);
    expect(PENDING_RESULT_FIXTURE).not.toHaveProperty('points');
    const page = read('apps/miniapp/src/pages/quota/visual-fixture/index.tsx');
    expect(page).not.toContain('points={PENDING_RESULT_FIXTURE');
    expect(page).toContain('message={PENDING_RESULT_FIXTURE.message}');
  });

  it('三档套餐、推荐/选中顺序与成功余额保持设计数据', () => {
    const quota = fixture('quota-package-list');
    expect(quota.balancePoints).toBe(999);
    expect(quota.packages.map((pkg) => [pkg.id, pkg.points, pkg.priceCents, pkg.recommended])).toEqual([
      ['trial', 60, 600, false], ['standard', 200, 1800, true], ['immersive', 450, 3800, false],
    ]);
    const success = fixture('payment-result-success');
    expect(success.balancePoints).toBe(999);
    expect(success.order).toMatchObject({ status: 'credited', packageName: '体验包', pointsAmount: 60, amountCents: 600 });
    const result = fixture('chat-list-search-results');
    expect(result.returnMessages.characterUnread[result.response.characters[0].characterId]).toBe(1);
    expect(result.response.characters[0].updatedAt).toBe('2026-08-14T10:00:00.000Z');
  });

  it('端口回退保持 visual build 标志、路由检查与键盘阻塞口径', () => {
    const source = read('apps/miniapp/e2e/visual-frames.mjs');
    const rebuild = source.split('function rebuildWithApiPort(port) {')[1].split('function getViewport')[0];
    expect(rebuild).toContain("VISUAL_FIXTURES: 'true'");
    expect(rebuild).toContain("DEV_AUTH_BYPASS: 'false'");
    expect(rebuild).toContain('API_BASE_URL: `http://127.0.0.1:${port}`');
    expect(source).toContain("error?.code !== 'EADDRINUSE'");
    expect(source).toContain('report.builtPages.includes(frame.route.split');
    expect(source).toContain('configuredApiPort,');
    expect(source).toContain('rebuilt,');
    expect(source).toContain("item.ok = item.keyboardStatus !== 'BLOCKED'");
  });

  it.runIf(process.env.VISUAL_VERIFY_PRODUCTION === 'true')('生产构建不含 fixture 路由、数据或 QR', () => {
    const dist = path.resolve(e2eDir, '../dist');
    const app = JSON.parse(fs.readFileSync(path.join(dist, 'app.json'), 'utf8'));
    expect(app.pages).not.toContain('pages/quota/visual-fixture/index');
    expect(fs.existsSync(path.join(dist, 'visual-fixtures/share-qr.png'))).toBe(false);
    expect(fs.existsSync(path.join(dist, 'pages/quota/visual-fixture/index.js'))).toBe(false);
    const literals = [fixture('home-default').scriptRow.title, fixture('home-default').scriptRow.description, 'VISUAL-20261019-0001'];
    const inspect = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) inspect(file);
        else if (/\.(js|json|map|wxml)$/.test(entry.name)) {
          const content = fs.readFileSync(file, 'utf8');
          for (const literal of literals) expect(content, path.relative(dist, file)).not.toContain(literal);
        }
      }
    };
    inspect(dist);
  });
});
