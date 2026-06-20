import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { TopBar } from '../../components/layout/TopBar';
import { PageShell } from '../../components/layout/PageContainer';
import { getCharacterDetailUrl } from './index.model';
import './index.scss';

interface FeaturedScript {
  id: string;
  title: string;
  genre: string;
  tag: string;
  description: string;
  cover: string;
}

interface ScriptCard {
  id: string;
  title: string;
  genre: string;
  cover: string;
}

interface CharacterCard {
  id: string;
  name: string;
  identity: string;
  avatarUrl: string;
}

const featuredScripts: FeaturedScript[] = [
  {
    id: 'liumang',
    title: '流氓叙事',
    genre: '沉浸式体验',
    tag: '沉浸式体验',
    description: '在这个迷离的赛博世界中，你将扮演一个边缘人物，在帮派纷争与霓虹暗影中寻找自...',
    cover: '/assets/home/liumang-cover.png',
  },
  {
    id: 'archive',
    title: '档案迷城',
    genre: '悬疑 / 推理',
    tag: '限时开放',
    description: '翻开尘封卷宗，在失真的证词与断裂记忆中，寻找那枚被藏起来的真相碎片。',
    cover: '/assets/home/theater-cover.png',
  },
];

const scripts: ScriptCard[] = [
  {
    id: 'forest',
    title: '迷雾森林',
    genre: '奇幻 / 探险',
    cover: '/assets/home/forest-cover.png',
  },
  {
    id: 'theater',
    title: '幕后黑手',
    genre: '悬疑 / 推理',
    cover: '/assets/home/theater-cover.png',
  },
];

export default function Home() {
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [characterError, setCharacterError] = useState('');

  useEffect(() => {
    let cancelled = false;

    api
      .get<{ characters: CharacterCard[] }>('/api/characters')
      .then((data) => {
        if (!cancelled) {
          setCharacters(data.characters);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCharacterError(err instanceof Error ? err.message : '角色列表加载失败');
        }
      });

    return () => { cancelled = true; };
  }, []);

  const firstCharacterId = characters[0]?.id ?? '';

  const openCharacter = (characterId: string) => {
    Taro.navigateTo({ url: getCharacterDetailUrl(characterId) });
  };

  const startScript = () => {
    if (!firstCharacterId) {
      Taro.showToast({ title: characterError || '角色加载中，请稍后再试', icon: 'none' });
      return;
    }
    openCharacter(firstCharacterId);
  };

  return (
    <PageShell variant="scroll" noPadding>
      <TopBar
        left={
          <View className="theater-home__profile">
            <Text className="theater-home__profile-icon">☻</Text>
          </View>
        }
        title={<Text className="theater-home__brand">灵犀剧场</Text>}
        right={<Text className="theater-home__settings">⚙</Text>}
      />

      <View className="theater-home__content">
        <View className="theater-home__feature-strip">
          {featuredScripts.map((script) => (
            <View key={script.id} className="theater-home__hero-card">
              <Image className="theater-home__hero-image" src={script.cover} mode="aspectFill" />
              <View className="theater-home__hero-shade" />
              <View className="theater-home__hero-content">
                <View className="theater-home__tag">
                  <Text className="theater-home__tag-text">{script.tag}</Text>
                </View>
                <Text className="theater-home__hero-title">{script.title}</Text>
                <Text className="theater-home__hero-desc">{script.description}</Text>
                <View className="theater-home__start-button" onTap={startScript}>
                  <Text className="theater-home__play">▶</Text>
                  <Text className="theater-home__start-text">开始剧本</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View className="theater-home__grid">
          {(characters.length > 0 ? characters : scripts).map((item) => (
            <View
              key={item.id}
              className="theater-home__script-card"
              onTap={() => {
                if ('identity' in item) {
                  openCharacter(item.id);
                } else {
                  startScript();
                }
              }}
            >
              <View className="theater-home__poster-wrap">
                <Image
                  className="theater-home__poster"
                  src={'avatarUrl' in item ? item.avatarUrl : item.cover}
                  mode="aspectFill"
                />
              </View>
              <Text className="theater-home__script-title">{'name' in item ? item.name : item.title}</Text>
              <Text className="theater-home__script-genre">{'identity' in item ? item.identity : item.genre}</Text>
            </View>
          ))}
        </View>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '灵犀剧场',
  navigationStyle: 'custom',
});
