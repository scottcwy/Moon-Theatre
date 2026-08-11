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

/**
 * 羁绊等级名称（2026-08-11 产品确认：羁绊全程只有 6 档，不存在 1–10 级数字概念，
 * 界面一律展示名称，不再出现「羁绊 Lv.N」）。
 */
export const BOND_LEVEL_NAMES = ['檐下', '灯前', '杯沿', '留盏', '不言', '入念'] as const;

const MAX_BOND_LEVEL = BOND_LEVEL_NAMES.length;

/**
 * 各档累计经验门槛：等级 N 从 BOND_LEVEL_THRESHOLDS[N-1] 起步，
 * 升级跨度 200/500/2000/8000/16000 逐级递增、越后越难。
 * 2026-08-11 产品约束：成功轮 +10 exp、轻松档 1 点/轮，
 * 花完 1000 点（≈10000 exp）最多升到 4 级「留盏」之前。
 */
const BOND_LEVEL_THRESHOLDS = [0, 200, 700, 2700, 10700, 26700] as const;

/** 等级（1–6，越界与非法输入 clamp）对应的羁绊名称。 */
export function bondLevelName(level: number): string {
  const n = Number(level);
  const clamped = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_BOND_LEVEL) : 1;
  return BOND_LEVEL_NAMES[clamped - 1] ?? BOND_LEVEL_NAMES[0];
}

function impliedLevel(totalExp: number): number {
  let level = 1;
  for (let i = 1; i < MAX_BOND_LEVEL; i += 1) {
    if (totalExp >= BOND_LEVEL_THRESHOLDS[i]!) {
      level = i + 1;
    } else {
      break;
    }
  }
  return level;
}

export function createBondViewModel(input?: BondRelationshipInput | null): BondViewModel {
  if (input == null) {
    return buildViewModel(1, 0);
  }

  const totalExp = safeInt(input.bondExp);
  // 既有约定不变：不信任传入的 bondLevel，等级由累计经验按前端 6 级曲线重算。
  return buildViewModel(impliedLevel(totalExp), totalExp);
}

function buildViewModel(level: number, totalExp: number): BondViewModel {
  const isMaxLevel = level >= MAX_BOND_LEVEL;
  const levelStartExp = BOND_LEVEL_THRESHOLDS[level - 1] ?? 0;
  const currentLevelMaxExp = isMaxLevel
    ? levelStartExp - (BOND_LEVEL_THRESHOLDS[level - 2] ?? 0)
    : (BOND_LEVEL_THRESHOLDS[level] ?? levelStartExp) - levelStartExp;
  const currentLevelExp = isMaxLevel
    ? currentLevelMaxExp
    : Math.max(0, Math.min(totalExp - levelStartExp, currentLevelMaxExp));
  const remainingExp = isMaxLevel ? 0 : Math.max(currentLevelMaxExp - currentLevelExp, 0);
  const percent = isMaxLevel ? 100 : Math.round((currentLevelExp / currentLevelMaxExp) * 100);
  const nextLevelExp = BOND_LEVEL_THRESHOLDS[level] ?? levelStartExp;
  const levelName = bondLevelName(level);

  return {
    level,
    totalExp,
    levelStartExp,
    nextLevelExp,
    currentLevelExp,
    currentLevelMaxExp,
    percent,
    remainingExp,
    levelLabel: levelName,
    compactLevelLabel: levelName,
    progressLabel: `${currentLevelExp}/${currentLevelMaxExp}`,
    remainingLabel: isMaxLevel ? '羁绊已满级' : `距下一级羁绊还需 ${remainingExp}`,
  };
}
