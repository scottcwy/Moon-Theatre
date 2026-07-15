import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import {
  BottomAction,
  CharacterDetailHero,
  createBondViewModel,
  PageSection,
  PageShell,
  PrimaryButton,
  StatusStateCard,
  TonalButton,
} from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, isApiError } from '../../services/api';
import type { ChatMode, MoodType, StarterQuestions } from '../../types';
import { navigateBackOrHome } from '../../utils/navigation';
import { getCharacterAvatarUrl } from '../home/index.model';
import { buildCharacterChatUrl, getCharacterDefaultMode } from './detail.model';
import './detail.scss';

interface CharacterDetailData {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  initialRelationship: string;
  scriptId: string | null;
  script: {
    id: string;
    title: string;
    description: string;
    worldSetting: string;
  } | null;
  relationship: {
    bondLevel: number;
    bondExp: number;
  } | null;
  availableModes: ChatMode[];
  lastUsedMode: ChatMode | null;
  starterQuestions: StarterQuestions;
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
        setError(isApiError(err) && err.statusCode === 404 ? '角色或所属剧本当前不可用' : '角色资料加载失败，请稍后重试');
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

  const handleEnterChat = (mode: ChatMode) => {
    const scriptId = character?.script?.id || character?.scriptId || undefined;
    try {
      Taro.navigateTo({ url: buildCharacterChatUrl(characterId, mode, scriptId) });
    } catch {
      Taro.showToast({ title: '当前聊天模式不可用', icon: 'none' });
    }
  };

  const handleLogin = () => {
    goLogin();
  };

  const bondViewModel = createBondViewModel(character?.relationship);
  const availableModes = character?.availableModes || [];
  const defaultMode = character ? getCharacterDefaultMode(availableModes, character.lastUsedMode) : 'free';

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
    <PageShell variant="scroll" noPadding bottomReserve className="detail">
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
        <View className="detail__actions">
          {availableModes.includes('script') && (
            defaultMode === 'script' ? (
              <PrimaryButton onTap={() => handleEnterChat('script')}>进入剧本</PrimaryButton>
            ) : (
              <TonalButton onTap={() => handleEnterChat('script')}>进入剧本</TonalButton>
            )
          )}
          {availableModes.includes('free') && (
            defaultMode === 'free' ? (
              <PrimaryButton onTap={() => handleEnterChat('free')}>自由聊天</PrimaryButton>
            ) : (
              <TonalButton onTap={() => handleEnterChat('free')}>自由聊天</TonalButton>
            )
          )}
        </View>
      </BottomAction>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '角色详情',
});
