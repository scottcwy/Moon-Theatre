import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import {
  Badge,
  CharacterPosterCard,
  PageSection,
  PageShell,
  PrimaryButton,
  TopBar,
} from '@juben-sha/miniapp-ui';
import { api } from '../../services/api';
import { featuredScripts, getCharacterAvatarUrl, getCharacterDetailUrl } from './index.model';
import './index.scss';

interface CharacterCard {
  id: string;
  name: string;
  identity: string;
  avatarUrl: string;
}

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
        className="theater-home__topbar"
        titleClassName="theater-home__topbar-title"
        left={
          <View className="theater-home__profile">
            <Text className="theater-home__profile-icon">☻</Text>
          </View>
        }
        title={<Text className="theater-home__brand">灵犀剧场</Text>}
        right={<Text className="theater-home__settings">⚙</Text>}
      />

      <View className="theater-home__content">
        <PageSection title="精选剧本" kicker="今日开演" className="theater-home__hero-section">
          <View className="theater-home__feature-strip">
            {featuredScripts.map((script) => (
              <View key={script.id} className="theater-home__hero-card">
                <Image className="theater-home__hero-image" src={script.cover} mode="aspectFill" />
                <View className="theater-home__hero-shade" />
                <View className="theater-home__hero-logo">
                  <Text className="theater-home__hero-logo-text">{script.genre}</Text>
                </View>
                <View className="theater-home__hero-content">
                  <Badge tone="secondary" className="theater-home__tag">{script.tag}</Badge>
                  <Text className="theater-home__hero-title">{script.title}</Text>
                  <Text className="theater-home__hero-desc">{script.description}</Text>
                  <PrimaryButton className="theater-home__primary-action" onTap={startScript}>
                    开始剧本
                  </PrimaryButton>
                </View>
              </View>
            ))}
          </View>
        </PageSection>

        <PageSection title="角色登场" kicker="选择一位角色开始" className="theater-home__character-section">
          <View className="theater-home__grid">
            {(characters.length > 0 ? characters : featuredScripts).map((item) => (
              <CharacterPosterCard
                key={item.id}
                className="theater-home__poster-card"
                title={'name' in item ? item.name : item.title}
                subtitle={'identity' in item ? item.identity : item.genre}
                imageUrl={'avatarUrl' in item ? getCharacterAvatarUrl(item.name, item.avatarUrl) : item.cover}
                badge={'identity' in item ? '角色' : item.tag}
                onTap={() => {
                  if ('identity' in item) {
                    openCharacter(item.id);
                  } else {
                    startScript();
                  }
                }}
              />
            ))}
          </View>
        </PageSection>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '灵犀剧场',
  navigationStyle: 'custom',
});
