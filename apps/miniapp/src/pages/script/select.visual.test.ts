import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = fs.readFileSync(path.join(__dirname, 'select.tsx'), 'utf8');
const pageStyles = fs.readFileSync(path.join(__dirname, 'select.scss'), 'utf8');

describe('script select stage visual contract', () => {
  it('uses custom stage navigation instead of a native light navigation bar', () => {
    expect(pageSource).toContain('<TopBar');
    expect(pageSource).toContain('onBack={navigateBackOrHome}');
    expect(pageSource).toContain("navigationStyle: 'custom'");
    expect(pageSource).toContain("backgroundColor: '#170e12'");
    expect(pageStyles).toContain('.script-select__nav');
    expect(pageStyles).toContain('background-color: transparent;');
  });

  it('overlaps the paper panel onto the covered hero without a white seam', () => {
    expect(pageSource).toContain('getScriptCoverUrl(script)');
    expect(pageSource).toContain('script-select__shade');
    expect(pageStyles).toContain('$select-paper: #e4d7c5;');
    expect(pageStyles).toContain('margin: -44rpx $select-gutter 0;');
    expect(pageStyles).toContain('border-radius: 18rpx 18rpx 0 0;');
    expect(pageStyles).toContain('border: 1rpx solid $select-gold-line;');
    expect(pageStyles).toContain('$select-gutter: 36rpx;');
  });

  it('keeps a two-column poster grid with one name and identity hierarchy', () => {
    expect(pageSource).toContain('className="script-select__poster-card"');
    expect(pageSource).toContain('title={character.name}');
    expect(pageSource).toContain('subtitle={character.identity}');
    expect(pageStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(pageStyles).toContain('font-size: 28rpx;');
    expect(pageStyles).toContain('font-size: 22rpx;');
  });

  it('does not invent script copy when backend fields are absent', () => {
    expect(pageSource).not.toContain('剧本内容在这里');
    expect(pageSource).not.toContain("'角色剧本'");
    expect(pageSource).toContain('{genre ?');
    expect(pageSource).toContain('{description ?');
    expect(pageSource).toContain('{worldSetting ?');
  });
});
