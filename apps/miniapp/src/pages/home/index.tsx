import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import {
  Badge,
  CharacterPosterCard,
  NoticeBlock,
  PageSection,
  PageShell,
  PrimaryButton,
  TopBar,
} from '@juben-sha/miniapp-ui';
import { api } from '../../services/api';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';
import {
  featuredScripts,
  getCharacterAvatarUrl,
  getCharacterDecisionBadge,
  getCharacterDetailUrl,
  homeSections,
} from './index.model';
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
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [topBarStyle, setTopBarStyle] = useState<Record<string, string>>(
    getTopBarStyle(calculateTopBarMetrics()),
  );

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

  useEffect(() => {
    try {
      const windowInfo = Taro.getWindowInfo();
      const capsuleInfo = Taro.getMenuButtonBoundingClientRect();

      setTopBarStyle(getTopBarStyle(calculateTopBarMetrics(
        {
          windowWidth: windowInfo.windowWidth,
          statusBarHeight: windowInfo.statusBarHeight,
        },
        capsuleInfo,
      )));
    } catch {
      setTopBarStyle(getTopBarStyle(calculateTopBarMetrics()));
    }
  }, []);

  const firstCharacterId = characters[0]?.id ?? '';

  const openCharacter = (characterId: string) => {
    setSelectedCharacterId(characterId);
    Taro.navigateTo({ url: getCharacterDetailUrl(characterId) });
  };

  const chooseRole = () => {
    if (!firstCharacterId) {
      Taro.showToast({ title: characterError || '角色加载中，请稍后再试', icon: 'none' });
      return;
    }
    openCharacter(firstCharacterId);
  };

  return (
    <PageShell variant="scroll" noPadding>
      <View className="theater-home__topbar-shell" style={topBarStyle as CSSProperties}>
        <TopBar
          className="theater-home__topbar"
          titleClassName="theater-home__topbar-title"
          left={
            <View className="theater-home__settings-button">
              <Text className="theater-home__settings">⚙</Text>
            </View>
          }
          title={<Text className="theater-home__brand">灵犀剧场</Text>}
        />
      </View>

      <View className="theater-home__content">
        <PageSection title={homeSections.scriptTitle} kicker={homeSections.scriptKicker} className="theater-home__hero-section">
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
                  <PrimaryButton className="theater-home__primary-action" onTap={chooseRole}>
                    {homeSections.scriptPrimaryAction}
                  </PrimaryButton>
                </View>
              </View>
            ))}
          </View>
        </PageSection>

        <PageSection title={homeSections.characterTitle} kicker={homeSections.characterKicker} className="theater-home__character-section">
          {characters.length > 0 ? (
            <View className="theater-home__grid">
              {characters.map((character) => (
                <CharacterPosterCard
                  key={character.id}
                  className="theater-home__poster-card"
                  title={character.name}
                  subtitle={character.identity}
                  imageUrl={getCharacterAvatarUrl(character.name, character.avatarUrl)}
                  badge={getCharacterDecisionBadge(character.name)}
                  selected={selectedCharacterId === character.id}
                  onTap={() => { openCharacter(character.id); }}
                />
              ))}
            </View>
          ) : (
            <NoticeBlock className="theater-home__empty">
              {characterError || '角色正在登场，请稍后再试'}
            </NoticeBlock>
          )}
        </PageSection>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '灵犀剧场',
  navigationStyle: 'custom',
});
