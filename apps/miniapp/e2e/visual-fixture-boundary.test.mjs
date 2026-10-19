import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(e2eDir, '../../..');

const fixtureFiles = [
  'apps/miniapp/src/pages/quota/visual-fixture/index.tsx',
  'apps/miniapp/src/pages/quota/visual-fixture/fixtures.ts',
];

const presentationalFiles = [
  'packages/miniapp-ui/src/components/quota/PaymentConfirmSheet.tsx',
  'packages/miniapp-ui/src/components/quota/PaymentResultPanel.tsx',
  'packages/miniapp-ui/src/components/quota/QuotaPackageList.tsx',
];

const forbidden = [
  { pattern: /services\/api/, label: 'imports services/api' },
  { pattern: /requestPayment/, label: 'references requestPayment' },
  { pattern: /\borders\b/, label: 'mentions orders' },
  { pattern: /\bprepay\b/, label: 'mentions prepay' },
  { pattern: /mock-confirm/, label: 'mentions mock-confirm' },
];

describe('visual fixture payment boundary', () => {
  for (const relativePath of [...fixtureFiles, ...presentationalFiles]) {
    it(`${relativePath} stays presentational`, () => {
      const filePath = path.join(repoRoot, relativePath);
      expect(fs.existsSync(filePath), `${relativePath} is missing`).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      for (const { pattern, label } of forbidden) {
        expect(pattern.test(content), `${relativePath} ${label}`).toBe(false);
      }
    });
  }

  it('production app config registers the fixture page only behind VISUAL_FIXTURES', () => {
    const config = fs.readFileSync(path.join(repoRoot, 'apps/miniapp/src/app.config.ts'), 'utf8');
    expect(config).toMatch(/VISUAL_FIXTURES/);
    expect(config).toMatch(/pages\/quota\/visual-fixture\/index/);
  });
});
