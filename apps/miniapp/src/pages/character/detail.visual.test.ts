import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const detail = fs.readFileSync(path.join(__dirname, 'detail.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'detail.scss'), 'utf8');

describe('character detail visual frame contract', () => {
  it('keeps the first-screen hero and the long-page world section on one route', () => {
    expect(detail).toContain('CharacterDetailHero');
    expect(detail).toContain('worldView={character.script ?');
    expect(detail).toContain('PageShell variant="scroll"');
    expect(detail).toContain('bottomReserve');
    expect(styles).toContain('margin: -86rpx 36rpx 0');
    expect(styles).toContain('clip-path: polygon(28rpx 0, 100% 0, 100% 100%, 0 100%, 0 28rpx)');
    expect(styles).toContain('-webkit-line-clamp: 1');
  });

  it('does not fabricate a mood chip on the detail page', () => {
    expect(detail).not.toContain('MoodType');
    expect(detail).not.toContain('MoodChip');
  });

  it('uses the shared home model for deterministic character artwork', () => {
    expect(detail).toContain('getCharacterAvatarUrl');
    expect(detail).not.toContain('/playground/');
  });
});
