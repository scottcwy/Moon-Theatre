import { Text } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import { BottomAction, CharacterDetailHero, createBondViewModel, PageSection, PageShell, PrimaryButton, StatusStateCard } from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import type { MoodType } from '../../types';
import { navigateBackOrHome } from '../../utils/navigation';
import { getCharacterAvatarUrl } from '../home/index.model';
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

export default function CharacterDetail() {
  const router = useRouter();
  const characterId = router.params.characterId || '';

  const [character, setCharacter] = useState<CharacterDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();
  const loadIdRef = useRef(0);

  const [mood] = useState<MoodType>('neutral');

  const fetchCharacter = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;

    if (!characterId) {
      setError('缺少角色 ID');
      setLoading(false);
      return;
    }

    try {
      setError('');
      const authenticated = await verifyAuth();
      if (loadIdRef.current !== loadId) return;
      if (!authenticated) {
        setLoading(false);
        return;
      }
      const data = await api.get<CharacterDetailData>(`/api/characters/${characterId}`);
      if (loadIdRef.current !== loadId) return;
      setCharacter(data);
    } catch (err) {
      if (loadIdRef.current !== loadId) return;
      if (!handleAuthError(err)) {
        setError(err instanceof Error ? err.message : '加载角色失败');
      }
    } finally {
      if (loadIdRef.current === loadId) {
        setLoading(false);
      }
    }
  }, [characterId, handleAuthError, verifyAuth]);

  useDidShow(() => {
    void fetchCharacter();
  });

  const handleEnterChat = () => {
    Taro.navigateTo({ url: `/pages/chat/index?characterId=${characterId}` });
  };

  const handleLogin = () => {
    goLogin();
  };

  const bondViewModel = createBondViewModel(character?.relationship);

  if (loading) {
    return (
      <PageShell variant="scroll">
        <StatusStateCard
          title="正在读取角色档案"
          message="人物关系、世界观和羁绊资料加载中。"
          tone="empty"
          icon="…"
        />
      </PageShell>
    );
  }

  if (needsLogin) {
    return (
      <PageShell variant="scroll">
        <StatusStateCard
          title="登录后查看角色档案"
          message="登录后可以读取角色关系和羁绊资料。"
          primaryText="去登录"
          onPrimary={handleLogin}
        />
      </PageShell>
    );
  }

  if (error || !character) {
    return (
      <PageShell variant="scroll">
        <StatusStateCard
          title="角色暂时不可用"
          message={error || '角色不存在'}
          tone="error"
          icon="!"
        />
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" noPadding bottomReserve>
      <CharacterDetailHero
        name={character.name}
        identity={character.identity}
        description={character.description}
        avatarUrl={getCharacterAvatarUrl(character.name, character.avatarUrl)}
        relationship={character.initialRelationship}
        bond={bondViewModel}
        mood={mood}
        onBack={navigateBackOrHome}
      />
      {character.script && (
        <PageSection title="世界观" kicker={character.script.title} surface className="detail__section detail__section--script">
          <Text className="detail__description" userSelect>{character.script.description}</Text>
          <Text className="detail__description detail__description--muted" userSelect>
            {character.script.worldSetting}
          </Text>
        </PageSection>
      )}

      <BottomAction>
        <PrimaryButton onTap={handleEnterChat}>▰ 开启对话</PrimaryButton>
      </BottomAction>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '角色详情',
});
