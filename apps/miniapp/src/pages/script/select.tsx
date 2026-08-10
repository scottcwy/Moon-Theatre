import { Image, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { Badge, CharacterPosterCard, PageSection, PageShell, StatusStateCard } from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, isApiError } from '../../services/api';
import { getCharacterAvatarUrl, getScriptCoverUrl } from '../home/index.model';
import { getScriptCharacterDetailUrl } from './select.model';
import './select.scss';

interface ScriptCharacter {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
}

interface ScriptDetail {
  id: string;
  title: string;
  description: string;
  worldSetting: string;
  slug: string;
  genre: string;
  coverUrl: string | null;
  status: 'active';
  characters: ScriptCharacter[];
}

export default function ScriptSelect() {
  const router = useRouter();
  const scriptId = router.params.scriptId || '';
  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

  useEffect(() => {
    let cancelled = false;
    async function loadScript() {
      if (!scriptId) {
        setError('缺少剧本信息');
        setLoading(false);
        return;
      }
      try {
        const authenticated = await verifyAuth();
        if (cancelled) return;
        if (!authenticated) {
          setLoading(false);
          return;
        }
        const data = await api.get<ScriptDetail>(`/api/scripts/${scriptId}`);
        if (!cancelled) setScript(data);
      } catch (err) {
        if (cancelled) return;
        if (!handleAuthError(err)) {
          setError(isApiError(err) && err.statusCode === 404 ? '该剧本不存在或已下架' : '剧本资料加载失败，请稍后重试');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadScript();
    return () => { cancelled = true; };
  }, [handleAuthError, scriptId, verifyAuth]);

  if (loading) {
    return <PageShell variant="scroll"><StatusStateCard title="正在打开剧本" message="世界观和角色资料加载中。" icon="…" /></PageShell>;
  }

  if (needsLogin) {
    return (
      <PageShell variant="scroll">
        <StatusStateCard title="登录后选择角色" message="登录后可以进入剧本角色详情并保存会话。" primaryText="去登录" onPrimary={goLogin} />
      </PageShell>
    );
  }

  if (error || !script) {
    return (
      <PageShell variant="scroll">
        <StatusStateCard title="无法打开剧本" message={error || '剧本资料不可用'} tone="error" icon="!" />
      </PageShell>
    );
  }

  const coverUrl = getScriptCoverUrl(script);

  return (
    <PageShell variant="scroll" noPadding>
      <View className="script-select__hero">
        {coverUrl ? <Image className="script-select__cover" src={coverUrl} mode="aspectFill" /> : <View className="script-select__cover script-select__cover--placeholder" />}
        <View className="script-select__shade" />
        <View className="script-select__hero-copy">
          <Badge tone="secondary">{script.genre || '角色剧本'}</Badge>
          <Text className="script-select__title">{script.title}</Text>
          <Text className="script-select__description" userSelect>{script.description}</Text>
        </View>
      </View>

      <View className="script-select__content">
        <PageSection title="世界观" surface>
          <Text className="script-select__world" userSelect>{script.worldSetting}</Text>
        </PageSection>

        <PageSection title="选择角色" kicker={`${script.characters.length} 位可互动角色`} className="script-select__characters">
          {script.characters.length > 0 ? (
            <View className="script-select__grid">
              {script.characters.map((character) => (
                <CharacterPosterCard
                  key={character.id}
                  title={character.name}
                  subtitle={character.identity}
                  description={character.description}
                  imageUrl={getCharacterAvatarUrl(character.name, character.avatarUrl)}
                  badge="查看详情"
                  onTap={() => Taro.navigateTo({ url: getScriptCharacterDetailUrl(character.id) })}
                />
              ))}
            </View>
          ) : (
            <StatusStateCard title="暂无可选角色" message="该剧本当前没有已上架角色。" icon="□" />
          )}
        </PageSection>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '选择角色',
});
