import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pagesDir = path.resolve(__dirname);
const migratedLocalImportPatterns = [
  '../../components/ui/',
  '../../components/layout/',
  '../../components/character/',
  '../../components/chat/',
  '../../components/status/',
  '../../components/achievement/',
  '../../components/share/',
];

function collectTsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(fullPath);
    if (entry.isFile() && fullPath.endsWith('.tsx')) return [fullPath];
    return [];
  });
}

describe('production pages use shared miniapp ui', () => {
  it('does not import migrated reusable components from app-local components', () => {
    const offenders = collectTsxFiles(pagesDir).filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      return migratedLocalImportPatterns.some((pattern) => content.includes(pattern));
    });

    expect(offenders.map((filePath) => path.relative(path.resolve(__dirname, '..'), filePath))).toEqual([]);
  });
});
