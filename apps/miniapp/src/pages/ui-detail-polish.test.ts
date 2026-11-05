import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pagesDir = __dirname;
const miniappUiDir = path.resolve(process.cwd(), '../../packages/miniapp-ui/src');

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(pagesDir, relativePath), 'utf8');
}

function readUi(relativePath: string): string {
  return fs.readFileSync(path.join(miniappUiDir, relativePath), 'utf8');
}

describe('UI detail polish contract', () => {
  it('uses one tabbar reserve instead of per-page magic numbers', () => {
    const pageShell = readUi('components/layout/PageContainer.scss');
    expect(pageShell).toContain('padding-bottom: calc($tabbar-reserve + env(safe-area-inset-bottom, $safe-bottom));');

    for (const page of [
      readPage('home/index.scss'),
      readPage('profile/index.scss'),
      readPage('community/index.scss'),
      readPage('chat/list.scss'),
    ]) {
      expect(page).toContain('$tabbar-reserve');
    }
  });

  it('keeps the selected tab decoration inside the item and content centered', () => {
    const tabbar = readPage('../components/StageTabBar.scss');
    expect(tabbar).toContain('max-width: 149rpx');
    expect(tabbar).toContain('padding-bottom: 17rpx');
    expect(tabbar).toContain('theater-tab-bar__icon-wrap');
    expect(tabbar).not.toContain('tab-selected.png');
  });

  it('does not hardcode character artwork in page styles', () => {
    const chatStyles = readPage('chat/index.scss');
    const detailStyles = readPage('character/detail.scss');
    expect(chatStyles).not.toContain('hakuzo.jpg');
    expect(detailStyles).not.toContain('white-cang.jpg');
    expect(detailStyles).not.toContain('character-detail-hero__portrait { opacity: 0; }');
  });

  it('does not render fake points or online state', () => {
    expect(readUi('components/ui/Badge.tsx')).not.toContain('points ?? 0');
    expect(readUi('components/character/CharacterDetailHero.tsx')).not.toContain('● 在线');
    expect(readPage('profile/index.tsx')).not.toContain('size="lg" online');
  });

  it('gives the chat page dark state surfaces and a safe-area input bar', () => {
    const chatPage = readPage('chat/index.tsx');
    const chatStyles = readPage('chat/index.scss');
    expect((chatPage.match(/surface="dark"/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(chatStyles).toContain('chat-input-bar__placeholder');
    expect(chatStyles).toContain('env(safe-area-inset-bottom, 34px)');
  });

  it('uses custom navigation on the dark full-screen pages', () => {
    for (const page of [
      readPage('login/index.tsx'),
      readPage('profile/index.tsx'),
      readPage('share/preview.tsx'),
      readPage('script/select.tsx'),
    ]) {
      expect(page).toContain("navigationStyle: 'custom'");
    }
  });

  it('removes dead navigation affordances and the retired memory route', () => {
    expect(readPage('home/index.tsx')).not.toContain('theater-home__settings');
    expect(fs.existsSync(path.join(pagesDir, 'memory/index.tsx'))).toBe(false);
  });

  it('uses the shared stage background on profile, community and chat list', () => {
    for (const page of [
      readPage('profile/index.scss'),
      readPage('community/index.scss'),
      readPage('chat/list.scss'),
    ]) {
      expect(page).toContain('$stage-scene-overlay');
    }
  });

  it('renders the real character portrait in the share preview', () => {
    expect(readPage('share/preview.tsx')).toContain('imageUrl={portraitUrl || undefined}');
    expect(readUi('components/share/SharePreviewCard.tsx')).toContain('share-preview-card__portrait');
    expect(readUi('components/share/SharePreviewCard.scss')).toContain('height: 720rpx');
  });

  it('lets the payment result panel fill the remaining viewport', () => {
    const resultPage = readPage('quota/result.tsx');
    const resultStyles = readPage('quota/result.scss');
    expect(resultPage).toContain('className="result__content"');
    expect(resultStyles).toContain('min-height: calc(100vh - 500rpx)');
    expect(resultStyles).toContain('flex: 1 0 auto');
  });
});
