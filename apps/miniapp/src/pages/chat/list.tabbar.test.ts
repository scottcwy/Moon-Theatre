import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'list.tsx'), 'utf8');
const modelSource = readFileSync(resolve(__dirname, 'list.model.ts'), 'utf8');
const styleSource = readFileSync(resolve(__dirname, 'list.scss'), 'utf8');
const appConfigSource = readFileSync(resolve(__dirname, '../../app.config.ts'), 'utf8');

describe('chat list tab bar integration', () => {
  it('uses the global chat tab instead of rendering a page-local tab bar', () => {
    expect(appConfigSource).toContain("pagePath: 'pages/chat/list', text: '聊天'");
    expect(source).not.toContain('hideTabBar');
    expect(source).not.toContain('TheaterTabBar');
    expect(source).not.toContain('chat-list-tabbar');
  });

  it('shows cached character chats and silently refreshes whenever the cached tab page is shown', () => {
    expect(source).toContain('useDidShow');
    expect(source).toContain('loadCharacterChats');
    // 命中缓存时先渲染再静默刷新，避免切 tab 返回的 loading 抖动；未读数仍每次拉取。
    expect(source).toContain('chatListCacheRef');
    expect(source).toContain('silent: chatListCacheRef.current.has(searchQuery)');
    expect(source).toContain('loadCharacterUnread');
  });

  it('uses an active debounced server search instead of a disabled fake search affordance', () => {
    expect(source).toContain('searchQuery');
    expect(source).toContain('buildCharacterChatsUrl');
    expect(source).toContain('setTimeout');
    expect(source).toContain('CHAT_SEARCH_DEBOUNCE_MS');
    expect(modelSource).toContain('CHAT_SEARCH_DEBOUNCE_MS = 250');
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

  it('drives the unread red dot from return-message metadata and marks read on session open', () => {
    expect(source).toContain('RETURN_MESSAGES_CHECK_PATH');
    expect(source).toContain('RETURN_MESSAGES_READ_PATH');
    expect(source).toContain('characterUnread');
    expect(source).toContain('unreadCount={characterUnread[entry.characterId] ?? 0}');
    expect(source).not.toContain('ReturnMessageCard');
    expect(source).not.toContain('角色留言');
    expect(source).not.toContain('chat-list__return-messages');
    expect(source).not.toContain('filterChatSessions');
  });

  it('marks return messages read when opening the chat page from any entry, guarded by login', () => {
    const chatSource = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');
    expect(chatSource).toContain('RETURN_MESSAGES_READ_PATH');
    expect(chatSource).toContain('buildReturnMessagesReadBody');
    expect(chatSource).toContain('getReturnMessageReadCharacterId');
    expect(chatSource).toContain('api.post(RETURN_MESSAGES_READ_PATH, buildReturnMessagesReadBody(characterId))');
    // 未登录不发必然 401 的已读请求，失败静默
    expect(chatSource).toContain('if (!isLoggedIn() || !characterId) return;');
    expect(chatSource).toContain('.catch(() => {})');
  });
});
