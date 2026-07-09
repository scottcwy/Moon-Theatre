import { Text } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { BottomAction, CharacterDetailHero, PageSection, PageShell, PrimaryButton, StatusStateCard } from '@juben-sha/miniapp-ui';
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

const BOND_EXP_PER_LEVEL = 100;

export default function CharacterDetail() {
  const router = useRouter();
  const characterId = router.params.characterId || '';

  const [character, setCharacter] = useState<CharacterDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

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
        const authenticated = await verifyAuth();
        if (!authenticated) {
          if (!cancelled) setLoading(false);
          return;
        }
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
  }, [characterId, handleAuthError, verifyAuth]);

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
        bondLevel={bondLevel}
        bondExp={bondExp}
        bondMaxExp={bondMaxExp}
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
