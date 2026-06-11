import { View, Text, Image } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { MOOD_LABELS } from '../../types';
import type { MoodType } from '../../types';
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
}

export default function CharacterDetail() {
  const router = useRouter();
  const characterId = router.params.characterId || '';

  const [character, setCharacter] = useState<CharacterDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [bondLevel] = useState(1);
  const [bondExp] = useState(30);
  const [bondMaxExp] = useState(100);
  const [mood] = useState<MoodType>('neutral');

  useEffect(() => {
    if (!characterId) {
      setError('缺少角色 ID');
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
          setError(err instanceof Error ? err.message : '加载角色失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchCharacter();
    return () => { cancelled = true; };
  }, [characterId]);

  const handleEnterChat = () => {
    Taro.navigateTo({ url: `/pages/chat/index?characterId=${characterId}` });
  };

  const bondPercent = Math.min(Math.round((bondExp / bondMaxExp) * 100), 100);

  if (loading) {
    return (
      <View className="character-detail-page">
        <View className="character-detail-page__state">
          <Text className="character-detail-page__state-text">加载中…</Text>
        </View>
      </View>
    );
  }

  if (error || !character) {
    return (
      <View className="character-detail-page">
        <View className="character-detail-page__state">
          <Text className="character-detail-page__state-text character-detail-page__state-text--error">
            {error || '角色不存在'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="character-detail-page">
      <View className="character-detail-page__avatar-section">
        {character.avatarUrl ? (
          <Image className="character-detail-page__avatar" src={character.avatarUrl} mode="aspectFill" />
        ) : (
          <View className="character-detail-page__avatar-placeholder">
            <Text className="character-detail-page__avatar-text">{character.name[0]}</Text>
          </View>
        )}
      </View>

      <View className="character-detail-page__info">
        <Text className="character-detail-page__name">{character.name}</Text>
        <Text className="character-detail-page__identity">{character.identity}</Text>
      </View>

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">人设简介</Text>
        <Text className="character-detail-page__description">{character.description}</Text>
      </View>

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">初始关系</Text>
        <View className="chip chip-mood-neutral">
          <Text className="chip__text">{character.initialRelationship}</Text>
        </View>
      </View>

      {character.script && (
        <View className="character-detail-page__section">
          <Text className="character-detail-page__section-title">世界观 · {character.script.title}</Text>
          <Text className="character-detail-page__description">{character.script.description}</Text>
          <Text className="character-detail-page__description">{character.script.worldSetting}</Text>
        </View>
      )}

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">羁绊等级</Text>
        <View className="character-detail-page__bond">
          <View className="character-detail-page__bond-header">
            <Text className="character-detail-page__bond-level">Lv.{bondLevel}</Text>
            <Text className="character-detail-page__bond-exp">{bondExp}/{bondMaxExp}</Text>
          </View>
          <View className="character-detail-page__bond-progress">
            <View className="character-detail-page__bond-progress-bar" style={{ width: `${bondPercent}%` }} />
          </View>
        </View>
      </View>

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">情绪状态</Text>
        <View className="chip chip-mood-neutral">
          <Text className="chip__text">{MOOD_LABELS[mood]}</Text>
        </View>
      </View>

      <View className="character-detail-page__cta">
        <View className="button-primary" onClick={handleEnterChat}>
          <Text className="character-detail-page__cta-text">进入对话</Text>
        </View>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '角色详情',
});
