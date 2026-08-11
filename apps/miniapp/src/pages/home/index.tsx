import { Image, ScrollView, Text, View } from '@tarojs/components';
import type { BaseEventOrig, ScrollViewProps } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CharacterPosterCard,
  EmptyState,
  PageSection,
  PageShell,
  SearchBar,
  StatusStateCard,
  TopBar,
} from '@juben-sha/miniapp-ui';
import { api, isLoggedIn } from '../../services/api';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';
import {
  buildFrequentCharactersUrl,
  buildScriptsUrl,
  getCharacterAvatarUrl,
  getCharacterDecisionBadge,
  getActiveScriptIndex,
  getCharacterDetailUrl,
  getCharacterSectionTitle,
  getScriptCatalogUrl,
  getScriptCoverUrl,
  getScriptRoleSelectUrl,
  homeSections,
  shouldApplyScriptResponse,
} from './index.model';
import './index.scss';

interface CharacterCard {
  id: string;
  name: string;
  identity: string;
  avatarUrl: string | null;
}

interface ScriptCard {
  id: string;
  title: string;
  description: string;
  slug: string;
  genre: string;
  coverUrl: string | null;
  sortOrder: number;
}

/** 常聊角色接口条目：只取首页卡片需要的字段（成功轮数仅用于服务端排序，不在卡片展示）。 */
interface FrequentCharacterEntry {
  characterId: string;
  characterName: string;
  characterAvatarUrl: string | null;
  identity: string;
}

export default function Home() {
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [hasFrequentCharacters, setHasFrequentCharacters] = useState(false);
  const [characterError, setCharacterError] = useState('');
  const [scripts, setScripts] = useState<ScriptCard[]>([]);
  const [scriptQuery, setScriptQuery] = useState('');
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [scriptsError, setScriptsError] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [scriptModeOn, setScriptModeOn] = useState(false);
  const scriptModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [topBarStyle, setTopBarStyle] = useState<Record<string, string>>(
    getTopBarStyle(calculateTopBarMetrics()),
  );
  const scriptRequestIdRef = useRef(0);
  const [activeScriptIndex, setActiveScriptIndex] = useState(0);
  const [scriptScrollEpoch, setScriptScrollEpoch] = useState(0);

  const loadScripts = useCallback(async (query: string) => {
    const requestId = scriptRequestIdRef.current + 1;
    scriptRequestIdRef.current = requestId;
    setScriptsLoading(true);
    setScriptsError('');
    try {
      const data = await api.get<{ scripts: ScriptCard[] }>(buildScriptsUrl(query));
      if (!shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) return;
      setScripts(data.scripts);
    } catch {
      if (!shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) return;
      setScriptsError('剧本目录暂时不可用，请稍后重试');
    } finally {
      if (shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) {
        setScriptsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadScripts(scriptQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadScripts, scriptQuery]);

  const handleScriptScroll = (event: BaseEventOrig<ScrollViewProps.onScrollDetail>) => {
    setActiveScriptIndex(getActiveScriptIndex(event.detail.scrollLeft, event.detail.scrollWidth, scripts.length));
  };

  useEffect(() => {
    // Search results replace the list: reset dots and glide back to the first card.
    setActiveScriptIndex(0);
    setScriptScrollEpoch((epoch) => epoch + 1);
  }, [scripts]);

  useEffect(() => {
    let cancelled = false;

    const loadRecommendedCharacters = () => {
      api
        .get<{ characters: CharacterCard[] }>('/api/characters')
        .then((data) => {
          if (cancelled) return;
          setCharacters(data.characters);
          setHasFrequentCharacters(false);
        })
        .catch(() => {
          if (!cancelled) setCharacterError('角色列表暂时不可用，请稍后重试');
        });
    };

    // 未登录：不发起必然 401 的常聊聚合请求，直接用公共推荐。
    if (!isLoggedIn()) {
      loadRecommendedCharacters();
      return () => { cancelled = true; };
    }

    api
      .get<{ characters: FrequentCharacterEntry[] }>(buildFrequentCharactersUrl())
      .then((data) => {
        if (cancelled) return;
        if (data.characters.length === 0) {
          // 已登录但无历史：回退公共推荐角色。
          loadRecommendedCharacters();
          return;
        }
        setCharacters(data.characters.map((entry) => ({
          id: entry.characterId,
          name: entry.characterName,
          identity: entry.identity,
          avatarUrl: entry.characterAvatarUrl,
        })));
        setHasFrequentCharacters(true);
      })
      .catch(() => {
        if (cancelled) return;
        loadRecommendedCharacters();
      });
    return () => { cancelled = true; };
  }, []);

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

  const openCharacter = (characterId: string) => {
    setSelectedCharacterId(characterId);
    Taro.navigateTo({ url: getCharacterDetailUrl(characterId) });
  };

  const chooseRole = (scriptId: string) => {
    Taro.navigateTo({ url: getScriptRoleSelectUrl(scriptId) });
  };

  const openScriptCatalog = () => {
    Taro.navigateTo({ url: getScriptCatalogUrl() });
  };

  // 滑动开关：点击后短暂展示开启态动画，随后进入剧本目录；回到首页时复位为关闭。
  const handleScriptModeToggle = () => {
    if (scriptModeOn) return;
    setScriptModeOn(true);
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
    scriptModeTimerRef.current = setTimeout(() => {
      openScriptCatalog();
    }, 260);
  };

  useDidShow(() => {
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
    setScriptModeOn(false);
  });

  useEffect(() => () => {
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
  }, []);

  const hasScriptQuery = scriptQuery.trim().length > 0;

  return (
    <PageShell variant="scroll" noPadding>
      <View className="theater-home__topbar-shell" style={topBarStyle as CSSProperties}>
        <TopBar
          className="theater-home__topbar"
          titleClassName="theater-home__topbar-title"
          left={<View className="theater-home__settings-button"><Text className="theater-home__settings">⚙</Text></View>}
          title={<Text className="theater-home__brand">阅满楼</Text>}
        />
      </View>

      <View className="theater-home__content" style={topBarStyle as CSSProperties}>
        <PageSection className="theater-home__hero-section">
          <View className="theater-home__hero-header">
            <View className="theater-home__hero-heading">
              <Text className="theater-home__hero-kicker">{homeSections.scriptKicker}</Text>
              <Text className="theater-home__hero-title">{homeSections.scriptTitle}</Text>
            </View>
            <View
              className={['theater-home__mode-switch', scriptModeOn ? 'theater-home__mode-switch--on' : ''].filter(Boolean).join(' ')}
              onTap={handleScriptModeToggle}
              aria-label="剧本模式开关"
            >
              {scriptModeOn ? (
                <Text className="theater-home__mode-switch-label">{homeSections.scriptModeEntry}</Text>
              ) : null}
              <View className="theater-home__mode-switch-thumb" />
            </View>
          </View>
          <SearchBar
            value={scriptQuery}
            placeholder="搜索剧本名称、类型或关键词"
            className="theater-home__script-search"
            onInput={setScriptQuery}
            onClear={() => setScriptQuery('')}
          />

          {scriptsLoading ? (
            <StatusStateCard className="theater-home__script-state" title="正在读取剧本目录" message="可用剧本加载中。" icon="…" />
          ) : scriptsError ? (
            <StatusStateCard
              className="theater-home__script-state"
              title="剧本目录暂时不可用"
              message="稍后重试，或先从角色卡片进入详情。"
              tone="error"
              icon="!"
              primaryText="重新加载"
              onPrimary={() => { void loadScripts(scriptQuery); }}
            />
          ) : scripts.length > 0 ? (
            <>
              <ScrollView
                className="theater-home__script-scroll"
                scrollX
                enhanced
                showScrollbar={false}
                enableFlex
                scrollIntoView={scriptScrollEpoch > 0 ? `script-0-${scriptScrollEpoch}` : undefined}
                scrollWithAnimation
                onScroll={handleScriptScroll}
              >
                {scripts.map((script, index) => {
                  const coverUrl = getScriptCoverUrl(script);
                  return (
                    <View
                      key={script.id}
                      id={`script-${index}-${scriptScrollEpoch}`}
                      className="theater-home__hero-card"
                      onTap={() => chooseRole(script.id)}
                    >
                      {coverUrl ? (
                        <Image className="theater-home__hero-image" src={coverUrl} mode="aspectFill" />
                      ) : (
                        <View className="theater-home__hero-image theater-home__hero-image--placeholder" />
                      )}
                      <View className="theater-home__hero-shade" />
                      <View className="theater-home__hero-content">
                        <Text className="theater-home__hero-card-title" userSelect>{script.title}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              {scripts.length > 1 && (
                <View className="theater-home__script-dots" aria-label="剧本页码">
                  {scripts.map((script, index) => (
                    <View
                      key={script.id}
                      className={`theater-home__script-dot${index === activeScriptIndex ? ' theater-home__script-dot--active' : ''}`}
                      aria-label={`第 ${index + 1} 张剧本`}
                    />
                  ))}
                </View>
              )}
            </>
          ) : (
            <EmptyState
              className="theater-home__script-state"
              title={hasScriptQuery ? '没有找到相关剧本' : '暂无可用剧本'}
              message={hasScriptQuery ? '清除搜索后查看全部已上架剧本。' : '剧本准备好后会在这里出现。'}
              primaryText={hasScriptQuery ? '清除搜索' : undefined}
              onPrimary={hasScriptQuery ? () => setScriptQuery('') : undefined}
            />
          )}
        </PageSection>

        <PageSection title={getCharacterSectionTitle(hasFrequentCharacters)} kicker={homeSections.characterKicker} className="theater-home__character-section">
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
                  onTap={() => openCharacter(character.id)}
                />
              ))}
            </View>
          ) : (
            <StatusStateCard
              className="theater-home__empty"
              title="角色暂未登场"
              message={characterError || '角色资料加载中，请稍后再看。'}
              tone={characterError ? 'error' : 'empty'}
              icon={characterError ? '!' : '…'}
            />
          )}
        </PageSection>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '阅满楼',
  navigationStyle: 'custom',
});
