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
});
