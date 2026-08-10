import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = path.resolve(__dirname);
const appPath = 'apps/' + 'miniapp';
const forbiddenPatterns = [
  appPath,
  '../../' + appPath,
  '../../../' + appPath,
  '../../../../' + appPath,
  appPath + '/src/styles',
];

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (entry.isFile() && /\.(ts|tsx|scss)$/.test(fullPath)) return [fullPath];
    return [];
  });
}

describe('miniapp-ui package boundary', () => {
  it('does not import app-private files', () => {
    const offenders = collectSourceFiles(srcDir).filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      return forbiddenPatterns.some((pattern) => content.includes(pattern));
    });

    expect(offenders.map((filePath) => path.relative(srcDir, filePath))).toEqual([]);
  });

  it('keeps character poster selected state tonal instead of border-only', () => {
    const posterStyles = fs.readFileSync(path.join(srcDir, 'components/discovery/CharacterPosterCard.scss'), 'utf8');

    expect(posterStyles).toContain('character-poster-card--selected .character-poster-card__poster');
    expect(posterStyles).toContain('$color-primary-container');
    expect(posterStyles).not.toContain('border: 4rpx solid $color-primary');
  });

  it('reserves full fixed bottom action space for scrollable page content', () => {
    const pageShellStyles = fs.readFileSync(path.join(srcDir, 'components/layout/PageContainer.scss'), 'utf8');

    expect(pageShellStyles).toContain('&--bottom-reserve');
    expect(pageShellStyles).toContain('padding-bottom: calc($page-padding-bottom + env(safe-area-inset-bottom, $safe-bottom));');
    expect(pageShellStyles).not.toContain('padding-bottom: calc(130rpx + env(safe-area-inset-bottom, $safe-bottom));');
  });
});
