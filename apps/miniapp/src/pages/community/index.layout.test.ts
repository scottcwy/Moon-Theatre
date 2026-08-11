import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');
const styleSource = readFileSync(resolve(__dirname, 'index.scss'), 'utf8');

describe('community top bar layout', () => {
  it('shares measured topbar metrics with both the fixed header and body content', () => {
    expect(source).toContain('className="community" style={topBarStyle as CSSProperties}');
    expect(source).not.toContain('community__topbar-shell');
    expect(styleSource).toContain('.community {');
    expect(styleSource).toContain('--topbar-total-height');
    expect(styleSource).toContain('var(--topbar-total-height');
    expect(styleSource).not.toContain('.community__topbar-shell');
  });

  it('renders preview copy from the model as one unframed list instead of repeated cards', () => {
    expect(source).toContain('{communityPlaceholder.previewTitle}');
    expect(source).toContain('key={item.id}');
    expect(styleSource).toContain('.community__preview-item + .community__preview-item');
    expect(styleSource).not.toContain('background: rgba($color-surface-container-low');
  });
});
