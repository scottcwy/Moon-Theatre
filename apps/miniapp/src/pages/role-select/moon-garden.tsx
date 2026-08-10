import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useMemo, useState } from 'react';
import { Badge, CharacterPosterCard, NoticeBlock, PageSection, PageShell } from '@juben-sha/miniapp-ui';
import { api } from '../../services/api';
import { getCharacterDetailUrl } from '../home/index.model';
import {
  MOON_GARDEN_SCRIPT,
  getMoonGardenRoleCards,
  type RoleSelectApiCharacter,
} from './moon-garden.model';
import './moon-garden.scss';

interface CharactersResponse {
  characters: RoleSelectApiCharacter[];
}

export default function MoonGardenRoleSelect() {
  const [characters, setCharacters] = useState<RoleSelectApiCharacter[]>([]);
  const [loadError, setLoadError] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');

  useEffect(() => {
    let cancelled = false;

    api
      .get<CharactersResponse>('/api/characters')
      .then((data) => {
        if (!cancelled) {
          setCharacters(data.characters);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : '角色资料加载失败');
        }
      });

    return () => { cancelled = true; };
  }, []);

  const roleCards = useMemo(() => getMoonGardenRoleCards(characters), [characters]);

  const openRole = (characterId: string) => {
    if (!characterId) {
      Taro.showToast({ title: '角色资料加载中，请稍后再试', icon: 'none' });
      return;
    }

    setSelectedCharacterId(characterId);
    Taro.navigateTo({ url: getCharacterDetailUrl(characterId) });
  };

  return (
    <PageShell variant="scroll" className="moon-role-select">
      <View className="moon-role-select__hero">
        <Image className="moon-role-select__hero-image" src={MOON_GARDEN_SCRIPT.cover} mode="aspectFill" />
        <View className="moon-role-select__hero-shade" />
        <View className="moon-role-select__hero-content">
          <Badge tone="secondary" className="moon-role-select__hero-badge">{MOON_GARDEN_SCRIPT.kicker}</Badge>
          <Text className="moon-role-select__genre">{MOON_GARDEN_SCRIPT.genre}</Text>
          <Text className="moon-role-select__title">{MOON_GARDEN_SCRIPT.title}</Text>
          <Text className="moon-role-select__desc">{MOON_GARDEN_SCRIPT.description}</Text>
        </View>
      </View>

      {loadError ? (
        <NoticeBlock className="moon-role-select__notice">
          本地角色已展示，进入详情需等待资料同步完成。
        </NoticeBlock>
      ) : null}

      <PageSection
        kicker="选择一位角色开始"
        title="月见庭院角色"
        className="moon-role-select__section"
      >
        <View className="moon-role-select__grid">
          {roleCards.map((role) => (
            <View key={role.name} className="moon-role-select__role">
              <CharacterPosterCard
                className="moon-role-select__poster"
                title={role.name}
                subtitle={role.identity}
                imageUrl={role.avatarUrl}
                badge={role.badge}
                selected={selectedCharacterId === role.characterId}
                onTap={() => openRole(role.characterId)}
              />
              <Text className="moon-role-select__relation">{role.relation}</Text>
              <Text className="moon-role-select__role-desc">{role.description}</Text>
            </View>
          ))}
        </View>
      </PageSection>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '选择角色',
  navigationBarBackgroundColor: '#FFFBF8',
  navigationBarTextStyle: 'black',
  backgroundColor: '#FFFBF8',
  backgroundTextStyle: 'dark',
});
