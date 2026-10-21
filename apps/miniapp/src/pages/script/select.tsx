import { Image, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { CharacterPosterCard, PageSection, StatusStateCard, TopBar } from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, isApiError } from '../../services/api';
import { setCharacterGender } from '../../services/character-gender';
import type { CharacterGender } from '../../types';
import { navigateBackOrHome } from '../../utils/navigation';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';
import { getCharacterAvatarUrl, getCharacterGenderVariants, getScriptCoverUrl } from '../home/index.model';
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
  const [topBarStyle, setTopBarStyle] = useState<Record<string, string>>(
    getTopBarStyle(calculateTopBarMetrics()),
  );

  useEffect(() => {
    try {
      const windowInfo = Taro.getWindowInfo();
      const capsuleInfo = Taro.getMenuButtonBoundingClientRect();
      setTopBarStyle(getTopBarStyle(calculateTopBarMetrics(
        { windowWidth: windowInfo.windowWidth, statusBarHeight: windowInfo.statusBarHeight },
        capsuleInfo,
      )));
    } catch {
      setTopBarStyle(getTopBarStyle(calculateTopBarMetrics()));
    }
  }, []);

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
        const data = await api.get<ScriptDetail>(`/api/scripts/${encodeURIComponent(scriptId)}`);
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

  const nav = (
    <TopBar
      className="script-select__nav"
      titleClassName="script-select__nav-title"
      title={<Text className="script-select__nav-text">选择角色</Text>}
      onBack={navigateBackOrHome}
    />
  );

  if (loading) {
    return (
      <View className="script-select" style={topBarStyle as CSSProperties}>
        {nav}
        <View className="script-select__state">
          <StatusStateCard
            title="正在打开剧本"
            message="世界观和角色资料加载中。"
            icon="…"
            surface="dark"
          />
        </View>
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="script-select" style={topBarStyle as CSSProperties}>
        {nav}
        <View className="script-select__state">
          <StatusStateCard
            title="登录后选择角色"
            message="登录后可以进入剧本角色详情并保存会话。"
            primaryText="去登录"
            onPrimary={goLogin}
            surface="dark"
          />
        </View>
      </View>
    );
  }

  if (error || !script) {
    return (
      <View className="script-select" style={topBarStyle as CSSProperties}>
        {nav}
        <View className="script-select__state">
          <StatusStateCard
            title="无法打开剧本"
            message={error || '剧本资料不可用'}
            tone="error"
            icon="!"
            surface="dark"
          />
        </View>
      </View>
    );
  }

  const coverUrl = getScriptCoverUrl(script);
  const characterOptions = script.characters.flatMap((character) => {
    const genders = getCharacterGenderVariants(character.name);
    return genders.length > 0
      ? genders.map((gender) => ({ character, gender }))
      : [{ character, gender: null as CharacterGender | null }];
  });
  const genre = script.genre?.trim();
  const title = script.title?.trim();
  const description = script.description?.trim();
  const worldSetting = script.worldSetting?.trim();

  return (
    <View className="script-select" style={topBarStyle as CSSProperties}>
      {nav}
      <View className="script-select__hero">
        {coverUrl ? <Image className="script-select__cover" src={coverUrl} mode="aspectFill" /> : <View className="script-select__cover script-select__cover--placeholder" />}
        <View className="script-select__shade" />
        <View className="script-select__hero-copy">
          {(genre || characterOptions.length > 0) ? (
            <View className="script-select__hero-meta">
              {genre ? <Text className="script-select__genre">{genre}</Text> : null}
              {characterOptions.length > 0 ? (
                <Text className="script-select__character-count">{characterOptions.length} 位可互动角色</Text>
              ) : null}
            </View>
          ) : null}
          {title ? <Text className="script-select__title">{title}</Text> : null}
          {description ? <Text className="script-select__description" userSelect>{description}</Text> : null}
        </View>
      </View>

      <View className="script-select__content">
        {worldSetting ? (
          <PageSection title="世界观" className="script-select__world-section">
            <Text className="script-select__world" userSelect>{worldSetting}</Text>
          </PageSection>
        ) : null}

        <PageSection title="登场角色" className="script-select__characters">
          {characterOptions.length > 0 ? (
            <View className="script-select__grid">
              {characterOptions.map(({ character, gender }) => (
                <CharacterPosterCard
                  key={`${character.id}-${gender ?? 'default'}`}
                  className="script-select__poster-card"
                  title={character.name}
                  subtitle={character.identity}
                  description={character.description}
                  imageUrl={getCharacterAvatarUrl(character.name, character.avatarUrl, gender)}
                  badge={gender ? (gender === 'male' ? '男' : '女') : undefined}
                  onTap={() => {
                    if (gender) setCharacterGender(character.name, gender);
                    Taro.navigateTo({ url: getScriptCharacterDetailUrl(character.id) });
                  }}
                />
              ))}
            </View>
          ) : (
            <StatusStateCard
              className="script-select__empty"
              title="暂无可选角色"
              message="该剧本当前没有已上架角色。"
              icon="□"
            />
          )}
        </PageSection>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '选择角色',
  navigationStyle: 'custom',
  backgroundColor: '#170e12',
  backgroundTextStyle: 'light',
});
