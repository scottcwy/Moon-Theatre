import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'list.tsx'), 'utf8');
const appConfigSource = readFileSync(resolve(__dirname, '../../app.config.ts'), 'utf8');

describe('chat list tab bar integration', () => {
  it('uses the global chat tab instead of rendering a page-local tab bar', () => {
    expect(appConfigSource).toContain("pagePath: 'pages/chat/list', text: '聊天'");
    expect(source).not.toContain('hideTabBar');
    expect(source).not.toContain('TheaterTabBar');
    expect(source).not.toContain('chat-list-tabbar');
  });

  it('refreshes auth and sessions whenever the cached tab page is shown', () => {
    expect(source).toContain('useDidShow');
    expect(source).toContain('loadSessions');
  });
});
