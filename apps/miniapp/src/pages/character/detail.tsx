import { View, Text } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import type { MoodType } from '../../types';
import { CharacterDetailHero } from '../../components/character/CharacterDetailHero';
import { StatusStateCard } from '../../components/status/StatusStateCard';
import './detail.scss';

interface CharacterDetailData {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  initialRelationship: string;
  script: {
    title: string;
    description: string;
    worldSetting: string;
  } | null;
  relationship: {
    bondLevel: number;
    bondExp: number;
  } | null;
}

const BOND_EXP_PER_LEVEL = 100;

export default function CharacterDetail() {
  const router = useRouter();
  const characterId = router.params.characterId || '';

  const [character, setCharacter] = useState<CharacterDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, requireAuth, handleAuthError, goLogin } = useAuthGuard();

  const [mood] = useState<MoodType>('neutral');

  useEffect(() => {
    if (!characterId) {
      setError('缺少角色 ID');
      setLoading(false);
      return;
    }

    if (!requireAuth()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchCharacter() {
      try {
        const data = await api.get<CharacterDetailData>(`/api/characters/${characterId}`);
        if (!cancelled) {
          setCharacter(data);
        }
      } catch (err) {
        if (!cancelled) {
          if (!handleAuthError(err)) {
            setError(err instanceof Error ? err.message : '加载角色失败');
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchCharacter();
    return () => { cancelled = true; };
  }, [characterId, handleAuthError, requireAuth]);

  const handleEnterChat = () => {
    Taro.navigateTo({ url: `/pages/chat/index?characterId=${characterId}` });
  };

  const handleLogin = () => {
    goLogin();
  };

  const bondLevel = character?.relationship?.bondLevel ?? 1;
  const bondExp = character?.relationship?.bondExp ?? 0;
  const bondMaxExp = bondLevel * BOND_EXP_PER_LEVEL;

  if (loading) {
    return (
      <View className="character-detail-page character-detail-page--state">
        <StatusStateCard
          title="正在读取角色档案"
          message="人物关系、世界观和羁绊资料加载中。"
          tone="empty"
          icon="…"
        />
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="character-detail-page character-detail-page--state">
        <StatusStateCard
          title="登录后查看角色档案"
          message="登录后可以读取角色关系和羁绊资料。"
          primaryText="去登录"
          onPrimary={handleLogin}
        />
      </View>
    );
  }

  if (error || !character) {
    return (
      <View className="character-detail-page character-detail-page--state">
        <StatusStateCard
          title="角色暂时不可用"
          message={error || '角色不存在'}
          tone="error"
          icon="!"
        />
      </View>
    );
  }

  return (
    <View className="character-detail-page">
      <CharacterDetailHero
        name={character.name}
        identity={character.identity}
        description={character.description}
        avatarUrl={character.avatarUrl}
        relationship={character.initialRelationship}
        bondLevel={bondLevel}
        bondExp={bondExp}
        bondMaxExp={bondMaxExp}
        mood={mood}
        onEnterChat={handleEnterChat}
      />
      {character.script && (
        <View className="character-detail-page__section character-detail-page__section--script">
          <Text className="character-detail-page__kicker">{character.script.title}</Text>
          <Text className="character-detail-page__section-title">世界观</Text>
          <Text className="character-detail-page__description">{character.script.description}</Text>
          <Text className="character-detail-page__description character-detail-page__description--muted">
            {character.script.worldSetting}
          </Text>
        </View>
      )}

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">人设简介</Text>
        <Text className="character-detail-page__description">{character.description}</Text>
      </View>

    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '角色详情',
});
