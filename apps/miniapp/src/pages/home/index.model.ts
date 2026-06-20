export interface FeaturedScript {
  id: string;
  title: string;
  genre: string;
  tag: string;
  description: string;
  cover: string;
}

export const featuredScripts: FeaturedScript[] = [
  {
    id: 'moon-garden',
    title: '月下庭院',
    genre: '和风幻想 / 前世今生',
    tag: '满月开启',
    description: '踏入只在满月出现的庭院，在狐嫁试炼中找回前世记忆与未完成的契约。',
    cover: '/assets/home/forest-cover.png',
  },
  {
    id: 'liumang',
    title: '流氓叙事',
    genre: '沉浸式体验',
    tag: '沉浸式体验',
    description: '在这个迷离的赛博世界中，扮演边缘人物，于帮派纷争与霓虹暗影中寻找自我。',
    cover: '/assets/home/liumang-cover.png',
  },
];

export function getCharacterDetailUrl(characterId: string): string {
  const id = characterId.trim();
  if (!id) {
    throw new Error('characterId is required');
  }
  return `/pages/character/detail?characterId=${encodeURIComponent(id)}`;
}
