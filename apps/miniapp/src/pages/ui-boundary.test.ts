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

  it('keeps migrated page primitives on shared miniapp ui components', () => {
    const loginPage = fs.readFileSync(path.join(pagesDir, 'login/index.tsx'), 'utf8');
    expect(loginPage).toContain('PrimaryButton');
    expect(loginPage).toContain('NoticeBlock');
    expect(loginPage).not.toContain('button-primary');
    expect(loginPage).not.toContain('login-page__notice');

    const profilePage = fs.readFileSync(path.join(pagesDir, 'profile/index.tsx'), 'utf8');
    expect(profilePage).toContain('PageSection');
    expect(profilePage).toContain('NoticeBlock');
    expect(profilePage).toContain('CharacterAvatar');
    expect(profilePage).toContain('PointsBadge');
    expect(profilePage).toContain('AchievementIcon');
    expect(profilePage).not.toContain('className="page-section');
    expect(profilePage).not.toContain('className="notice-block');
    expect(profilePage).not.toContain('surface-card');

    const detailPage = fs.readFileSync(path.join(pagesDir, 'character/detail.tsx'), 'utf8');
    expect(detailPage).toContain('PageSection');
    expect(detailPage).not.toContain('detail__section surface-card');

    const chatListPage = fs.readFileSync(path.join(pagesDir, 'chat/list.tsx'), 'utf8');
    expect(chatListPage).toContain('EmptyState');
    expect(chatListPage).not.toContain('function EmptyPanel');
    expect(chatListPage).not.toContain('button-primary');

    const homePage = fs.readFileSync(path.join(pagesDir, 'home/index.tsx'), 'utf8');
    expect(homePage).toContain('PageSection');
    expect(homePage).toContain('Badge');
    expect(homePage).toContain('PrimaryButton');
    expect(homePage).toContain('CharacterPosterCard');
    expect(homePage).not.toContain('theater-home__script-card');
    expect(homePage).not.toContain('theater-home__poster-wrap');
    expect(homePage).not.toContain('theater-home__start-button');
  });
});
