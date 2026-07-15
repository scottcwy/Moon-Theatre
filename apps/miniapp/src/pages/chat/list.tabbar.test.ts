import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'list.tsx'), 'utf8');
const styleSource = readFileSync(resolve(__dirname, 'list.scss'), 'utf8');
const appConfigSource = readFileSync(resolve(__dirname, '../../app.config.ts'), 'utf8');

describe('chat list tab bar integration', () => {
  it('uses the global chat tab instead of rendering a page-local tab bar', () => {
    expect(appConfigSource).toContain("pagePath: 'pages/chat/list', text: '聊天'");
    expect(source).not.toContain('hideTabBar');
    expect(source).not.toContain('TheaterTabBar');
    expect(source).not.toContain('chat-list-tabbar');
  });

  it('refreshes auth and character chats whenever the cached tab page is shown', () => {
    expect(source).toContain('useDidShow');
    expect(source).toContain('loadCharacterChats');
  });

  it('uses an active debounced server search instead of a disabled fake search affordance', () => {
    expect(source).toContain('searchQuery');
    expect(source).toContain('buildCharacterChatsUrl');
    expect(source).toContain('setTimeout');
    expect(source).toContain('250');
    expect(source).not.toContain('filterChatSessions');
    expect(source).not.toContain('<SearchBar disabled');
  });

  it('drives the chat header from measured topbar metrics instead of fixed capsule guesses', () => {
    expect(source).toContain('calculateTopBarMetrics');
    expect(source).toContain('getMenuButtonBoundingClientRect');
    expect(source).toContain('className="chat-list"');
    expect(source).toContain('style={topBarStyle as CSSProperties}');
    expect(source).toContain('chat-list__topbar-backdrop');
    expect(source).not.toContain('<TopBar');
    expect(styleSource).toContain('var(--topbar-total-height');
    expect(styleSource).toContain('background: $color-background');
    expect(styleSource).not.toContain('--topbar-menu-reserve: 220rpx');
  });

  it('aligns the header avatar with chat session avatars', () => {
    expect(styleSource).toContain('.chat-list__header');
    expect(styleSource).toContain('padding: 0 $space-2');
    expect(styleSource).toContain('width: 80rpx');
    expect(styleSource).toContain('height: 80rpx');
  });
});
