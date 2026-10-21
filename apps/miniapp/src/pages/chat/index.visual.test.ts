import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chat = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const list = fs.readFileSync(path.join(__dirname, 'list.tsx'), 'utf8');

describe('chat visual frame contract', () => {
  it('keeps empty, focused, and reply states on the real chat page', () => {
    expect(chat).toContain('chat-page');
    expect(chat).toContain('ChatInputBar');
    expect(chat).toContain('messages.length === 0');
    expect(chat).toContain('messages.map');
    expect(chat).toContain('goLogin');
  });

  it('keeps frame 1-2080 on the chat list route with an explicit login prompt', () => {
    expect(list).toContain('title="登录后查看聊天"');
    expect(list).toContain('onPrimary={handleLogin}');
    expect(list).toContain('needsLogin');
  });
});
