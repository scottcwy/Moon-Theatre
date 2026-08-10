import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');
const styleSource = readFileSync(resolve(__dirname, 'index.scss'), 'utf8');

describe('home hot scripts layout', () => {
  it('replaces the CSS overflow strip with a Taro horizontal ScrollView without a scrollbar', () => {
    expect(source).toContain('ScrollView');
    expect(source).toContain('scrollX');
    expect(source).toContain('enhanced');
    expect(source).toContain('showScrollbar={false}');
    expect(styleSource).not.toContain('.theater-home__feature-strip');
    expect(styleSource).toContain('.theater-home__script-scroll');
  });

  it('keeps the first card at 86%-90% of the available width with a fixed responsive height', () => {
    expect(styleSource).toMatch(/flex:\s*0\s*0\s*8[6-9]%/);
    expect(styleSource).toMatch(/height:\s*\d+rpx/);
  });

  it('clamps the title to 2 lines and the description to 3 lines', () => {
    expect(styleSource).toContain('-webkit-line-clamp: 2');
    expect(styleSource).toContain('-webkit-line-clamp: 3');
    expect(styleSource).toContain('overflow: hidden');
  });

  it('renders page dots only when more than one script exists', () => {
    expect(source).toContain('scripts.length > 1 &&');
    expect(source).toContain('theater-home__script-dot');
  });

  it('resets to the first card after a search without adding autoplay', () => {
    expect(source).toMatch(/setActiveScriptIndex\(0\)/);
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('autoplay');
  });
});
