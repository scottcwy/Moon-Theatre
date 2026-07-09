export interface BondRelationshipInput {
  bondLevel?: number | null;
  bondExp?: number | null;
}

export interface BondViewModel {
  level: number;
  totalExp: number;
  levelStartExp: number;
  nextLevelExp: number;
  currentLevelExp: number;
  currentLevelMaxExp: number;
  percent: number;
  remainingExp: number;
  levelLabel: string;
  compactLevelLabel: string;
  progressLabel: string;
  remainingLabel: string;
}

function safeInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function impliedLevel(totalExp: number): number {
  return Math.floor(totalExp / 100) + 1;
}

export function createBondViewModel(input?: BondRelationshipInput | null): BondViewModel {
  if (input == null) {
    return buildViewModel(1, 0);
  }

  const totalExp = safeInt(input.bondExp);
  return buildViewModel(impliedLevel(totalExp), totalExp);
}

function buildViewModel(level: number, totalExp: number): BondViewModel {
  const levelStartExp = (level - 1) * 100;
  const currentLevelExp = Math.max(0, Math.min(totalExp - levelStartExp, 100));
  const currentLevelMaxExp = 100;
  const remainingExp = Math.max(100 - currentLevelExp, 0);
  const percent = Math.round((currentLevelExp / 100) * 100);
  const nextLevelExp = level * 100;

  return {
    level,
    totalExp,
    levelStartExp,
    nextLevelExp,
    currentLevelExp,
    currentLevelMaxExp,
    percent,
    remainingExp,
    levelLabel: `羁绊 Lv.${level}`,
    compactLevelLabel: `♥ Lv.${level}`,
    progressLabel: `${currentLevelExp}/100`,
    remainingLabel: `距下一等级还需 ${remainingExp} 默契度`,
  };
}
