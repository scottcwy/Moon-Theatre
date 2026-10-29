import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chat = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const list = fs.readFileSync(path.join(__dirname, 'list.tsx'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');
const input = fs.readFileSync(path.resolve(__dirname, '../../../../../packages/miniapp-ui/src/components/chat/ChatInputBar.tsx'), 'utf8');

describe('chat visual frame contract', () => {
  it('把状态栏包含在窗口高度中，灵感开关不改变输入或发送协议', () => {
    expect(style).toMatch(/\.chat-page\s*\{\s*height: 100vh;\s*box-sizing: border-box;/);
    expect(style).toContain('env(safe-area-inset-bottom, 34px)');
    expect(chat).toContain('setStartersDismissed((value) => !value)');
    expect(input).toContain('onToggleStarters &&');
    expect(input).toContain('maxlength={5000}');
    expect(input).toContain('onConfirm={onSend}');
    expect(input).toContain('onInput={(e) => onInput(e.detail.value)}');
  });
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
