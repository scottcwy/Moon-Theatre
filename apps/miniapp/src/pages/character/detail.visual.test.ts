import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const detail = fs.readFileSync(path.join(__dirname, 'detail.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'detail.scss'), 'utf8');

describe('character detail visual frame contract', () => {
  it('keeps the first-screen hero and the long-page world section on one route', () => {
    expect(detail).toContain('CharacterDetailHero');
    expect(detail).toContain('title="世界观"');
    expect(detail).toContain('PageShell variant="scroll"');
    expect(detail).toContain('bottomReserve');
    expect(styles).toContain('.detail__section');
  });

  it('uses the shared home model for deterministic character artwork', () => {
    expect(detail).toContain('getCharacterAvatarUrl');
    expect(detail).not.toContain('/playground/');
  });
});
