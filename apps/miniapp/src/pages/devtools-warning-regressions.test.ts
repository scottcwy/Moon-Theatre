import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = resolve(__dirname, '..');
const miniappUiSrcRoot = resolve(process.cwd(), '../../packages/miniapp-ui/src');

function readSrc(path: string): string {
  return readFileSync(resolve(srcRoot, path), 'utf8');
}

function readMiniappUiSrc(path: string): string {
  return readFileSync(resolve(miniappUiSrcRoot, path), 'utf8');
}

describe('WeChat DevTools warning regressions', () => {
  it('marks long visible text as selectable', () => {
    expect(readMiniappUiSrc('components/chat/ChatBubble.tsx')).toContain(
      '<Text className="chat-bubble__text" userSelect>{displayText}</Text>',
    );
    expect(readMiniappUiSrc('components/character/CharacterDetailHero.tsx')).toContain(
      '<Text className="character-detail-hero__intro-text" userSelect>{description}</Text>',
    );
    expect(readMiniappUiSrc('components/status/StatusStateCard.tsx')).toContain(
      '<Text className="status-state-card__message" userSelect>{message}</Text>',
    );

    const detailPage = readSrc('pages/character/detail.tsx');
    expect(detailPage).toContain('description={character.description}');
    expect(detailPage).toContain('<Text className="detail__description" userSelect>{character.script.description}</Text>');
    expect(detailPage).toContain('<Text className="detail__description detail__description--muted" userSelect>');
    expect(detailPage).not.toContain('<Text className="detail__description" userSelect>{character.description}</Text>');
  });

  it('keeps padding off the scroll-view and moves it to an inner content wrapper', () => {
    expect(readSrc('pages/chat/index.tsx')).toContain('<View className="chat-page__messages-content">');

    const chatStyles = readSrc('pages/chat/index.scss');
    expect(chatStyles).toMatch(/&__messages\s*\{[\s\S]*?padding:\s*0;/);
    expect(chatStyles).toMatch(/&__messages-content\s*\{[\s\S]*?padding:\s*\$space-4;/);
  });

  it('positions chat header content below the measured WeChat capsule', () => {
    const chatPage = readSrc('pages/chat/index.tsx');
    expect(chatPage).toContain('calculateTopBarMetrics');
    expect(chatPage).toContain('getMenuButtonBoundingClientRect');
    expect(chatPage).toContain('style={topBarStyle as CSSProperties}');

    const headerStyles = readMiniappUiSrc('components/character/CharacterHeader.scss');
    expect(headerStyles).toContain('var(--topbar-total-height');
    expect(headerStyles).not.toContain('padding-right: calc(100px');
  });
});
