import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const page = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');

describe('community visual frame contract', () => {
  it('keeps the empty community state on the production route', () => {
    expect(page).toContain('community__body');
    expect(page).toContain('communityPlaceholder');
    expect(page).toContain('communityPreviewItems');
    expect(page).toContain('communityHomeTabUrl');
    expect(styles).toContain('.community__body');
  });

  it('does not introduce H5 playground assets into the production page', () => {
    expect(page).not.toContain('/playground/');
  });
});
