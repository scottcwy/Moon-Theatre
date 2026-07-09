import { getCharacterAvatarUrl, getCharacterDecisionBadge } from '../home/index.model';

export interface RoleSelectApiCharacter {
  id: string;
  name: string;
  avatarUrl?: string | null;
  identity: string;
}

export interface MoonGardenRoleDefinition {
  name: string;
  identity: string;
  relation: string;
  description: string;
  avatarUrl: string;
}

export interface MoonGardenRoleCard extends MoonGardenRoleDefinition {
  characterId: string;
  badge: string;
}

export const MOON_GARDEN_SCRIPT = {
  id: 'moon-garden',
  title: '月见庭院：狐神的新娘',
  kicker: '满月庭院',
  primaryAction: '选择角色',
  genre: '和风幻想 / 前世今生',
  description: '选择一位同行者，进入只在满月出现的庭院。每条角色线都会指向同一场未完成的狐嫁契约。',
  cover: '/assets/home/moon-garden-cover.jpg',
} as const;

export const MOON_GARDEN_ROLES: MoonGardenRoleDefinition[] = [
  {
    name: '白藏',
    identity: '月见庭院的狐神',
    relation: '被选中的新娘候选',
    description: '温柔而危险的守约者，知道百年前婚契的核心秘密。',
    avatarUrl: '/assets/characters/hakuzo.jpg',
  },
  {
    name: '贺茂清玄',
    identity: '奉命斩缘的阴阳师',
    relation: '警惕与监视',
    description: '冷静克制的调查者，试图斩断你与狐神之间的红线。',
    avatarUrl: '/assets/characters/kiyoharu.jpg',
  },
  {
    name: '月岛澪',
    identity: '绘梦的病弱画师',
    relation: '似曾相识的温柔',
    description: '能把记忆画进屏风，却不愿你太快想起全部真相。',
    avatarUrl: '/assets/characters/mio.jpg',
  },
  {
    name: '久远',
    identity: '守北门的无言武士',
    relation: '沉默守护',
    description: '常年守着北门禁地，用行动替百年前的选择赎罪。',
    avatarUrl: '/assets/characters/kuon.jpg',
  },
];

export const moonGardenRoleNames = MOON_GARDEN_ROLES.map((role) => role.name);

export function getMoonGardenRoleCards(apiCharacters: RoleSelectApiCharacter[] = []): MoonGardenRoleCard[] {
  const apiCharacterByName = new Map(apiCharacters.map((character) => [character.name, character]));

  return MOON_GARDEN_ROLES.map((role) => {
    const apiCharacter = apiCharacterByName.get(role.name);
    return {
      ...role,
      characterId: apiCharacter?.id ?? '',
      identity: apiCharacter?.identity || role.identity,
      avatarUrl: getCharacterAvatarUrl(role.name, apiCharacter?.avatarUrl || role.avatarUrl),
      badge: getCharacterDecisionBadge(role.name),
    };
  });
}
