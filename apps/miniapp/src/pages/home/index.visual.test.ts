import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const page = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');

describe('home visual frame contract', () => {
  it('keeps the default and search-active frame selectors stable', () => {
    expect(page).toContain('theater-home__script-search');
    expect(page).toContain('SCRIPT_SEARCH_DEBOUNCE_MS');
    expect(page).toContain("{hasScriptQuery ? '没有找到相关剧本' : '暂无可用剧本'}");
    expect(styles).toContain('.theater-home__script-scroll');
  });

  it('uses deterministic local cover fallbacks for anonymous fixtures', () => {
    expect(page).toContain('getScriptCoverUrl(script)');
    expect(page).toContain('getCharacterAvatarUrl(character.name');
    expect(page).not.toContain('/playground/');
  });
});
