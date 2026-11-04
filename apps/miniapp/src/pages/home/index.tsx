import { Image, ScrollView, Text, View } from '@tarojs/components';
import type { BaseEventOrig, ScrollViewProps } from '@tarojs/components';
import Taro, { useDidHide } from '@tarojs/taro';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CharacterPosterCard,
  PageSection,
  PageShell,
  SearchBar,
  StatusStateCard,
  TopBar,
} from '@juben-sha/miniapp-ui';
import { api, isLoggedIn } from '../../services/api';
import { getCharacterGender } from '../../services/character-gender';
import { useTabPageLifecycle } from '../../hooks/useTabPageLifecycle';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';
import {
  buildFrequentCharactersUrl,
  buildScriptsUrl,
  CHARACTER_DECISION_BADGE,
  SCRIPT_MODE_ENTRY_DELAY_MS,
  SCRIPT_SEARCH_DEBOUNCE_MS,
  getCharacterAvatarUrl,
  getActiveScriptIndex,
  getCharacterDetailUrl,
  getCharacterSectionTitle,
  getScriptCatalogUrl,
  getScriptCoverUrl,
  getScriptRoleSelectUrl,
  homeSections,
  localHomeCharacters,
  localHomeScripts,
  shouldApplyScriptResponse,
  shouldFallbackToPublicCharacters,
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
  supportsScriptMode?: boolean;
}

/** 常聊角色接口条目：只取首页卡片需要的字段（成功轮数仅用于服务端排序，不在卡片展示）。 */
interface FrequentCharacterEntry {
  characterId: string;
  characterName: string;
  characterAvatarUrl: string | null;
  identity: string;
}

// 仅视觉构建加载设计占位数据；生产编译时移除 require 及整个 JSON 模块。
const visualScriptRow: {
  scriptIds: string[];
  title: string;
  badge: string;
  description: string;
} | undefined = typeof VISUAL_FIXTURES !== 'undefined' && VISUAL_FIXTURES
  ? require('../../../e2e/visual-fixtures/second-contract/home-default.json').scriptRow
  : undefined;

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
  const scriptSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [topBarStyle, setTopBarStyle] = useState<Record<string, string>>(
    getTopBarStyle(calculateTopBarMetrics()),
  );
  const scriptRequestIdRef = useRef(0);
  const characterRequestIdRef = useRef(0);
  const [activeScriptIndex, setActiveScriptIndex] = useState(0);
  const [scriptScrollEpoch, setScriptScrollEpoch] = useState(0);
  const [scriptScrollTarget, setScriptScrollTarget] = useState('');

  const resetSessionData = useCallback(() => {
    scriptRequestIdRef.current += 1;
    characterRequestIdRef.current += 1;
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
    if (scriptSearchTimerRef.current) clearTimeout(scriptSearchTimerRef.current);
    setCharacters([]);
    setHasFrequentCharacters(false);
    setCharacterError('');
    setSelectedCharacterId('');
    setScriptQuery('');
    setScriptsError('');
    setScriptsLoading(false);
  }, []);

  const loadScripts = useCallback(async (
    query: string,
    { silent = false, showLoading = !silent }: { silent?: boolean; showLoading?: boolean } = {},
  ): Promise<boolean> => {
    const requestId = scriptRequestIdRef.current + 1;
    scriptRequestIdRef.current = requestId;
    let applied = false;
    if (showLoading) setScriptsLoading(true);
    setScriptsError('');
    try {
      const data = await api.get<{ scripts: ScriptCard[] }>(buildScriptsUrl(query));
      if (!shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) return false;
      setScripts(data.scripts.length > 0 || query.trim() ? data.scripts : [...localHomeScripts]);
      applied = true;
    } catch {
      if (!shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) return false;
      if (!silent) {
        if (query.trim()) {
          setScripts([]);
          setScriptsError('剧本目录暂时不可用');
        } else {
          setScripts([...localHomeScripts]);
          setScriptsError('');
        }
      }
      if (silent) Taro.showToast({ title: '剧本同步失败，已保留当前内容', icon: 'none' });
      applied = true;
    } finally {
      if (shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) {
        setScriptsLoading(false);
      }
    }
    return applied;
  }, []);

  const scheduleScriptSearch = useCallback((query: string) => {
    if (scriptSearchTimerRef.current) clearTimeout(scriptSearchTimerRef.current);
    scriptSearchTimerRef.current = setTimeout(() => {
      void loadScripts(query, { showLoading: true });
    }, SCRIPT_SEARCH_DEBOUNCE_MS);
  }, [loadScripts]);

  const handleScriptQueryChange = (value: string) => {
    setScriptQuery(value);
    scheduleScriptSearch(value);
  };

  const handleScriptQueryClear = () => {
    setScriptQuery('');
    scheduleScriptSearch('');
  };

  const handleScriptScroll = (event: BaseEventOrig<ScrollViewProps.onScrollDetail>) => {
    setActiveScriptIndex(getActiveScriptIndex(event.detail.scrollLeft, event.detail.scrollWidth, scripts.length));
  };

  const goToScript = (direction: -1 | 1) => {
    if (scripts.length < 2) return;
    const next = (activeScriptIndex + direction + scripts.length) % scripts.length;
    setActiveScriptIndex(next);
    setScriptScrollTarget(`hero-${next}-${scriptScrollEpoch}`);
  };

  useEffect(() => {
    // Search results replace the list: reset dots and glide back to the first card.
    setActiveScriptIndex(0);
    const nextEpoch = scriptScrollEpoch + 1;
    setScriptScrollEpoch(nextEpoch);
    setScriptScrollTarget(`hero-0-${nextEpoch}`);
  }, [scriptQuery]);

  const loadCharacters = useCallback(async (silent = false): Promise<boolean> => {
    const requestId = characterRequestIdRef.current + 1;
    characterRequestIdRef.current = requestId;
    const loadRecommendedCharacters = async (): Promise<boolean> => {
      try {
        const data = await api.get<{ characters: CharacterCard[] }>('/api/characters');
        if (characterRequestIdRef.current !== requestId) return false;
        setCharacters(data.characters.length > 0 ? data.characters : [...localHomeCharacters]);
        setHasFrequentCharacters(false);
        setCharacterError('');
        return true;
      } catch {
        if (characterRequestIdRef.current !== requestId) return false;
        if (!silent) setCharacters([...localHomeCharacters]);
        setCharacterError('角色同步失败');
        if (silent) Taro.showToast({ title: '角色同步失败，已保留当前内容', icon: 'none' });
        return true;
      }
    };

    // 未登录：不发起必然 401 的常聊聚合请求，直接用公共推荐。
    if (!isLoggedIn()) {
      return loadRecommendedCharacters();
    }

    try {
      const data = await api.get<{ characters: FrequentCharacterEntry[] }>(buildFrequentCharactersUrl());
      if (characterRequestIdRef.current !== requestId) return false;
      if (data.characters.length === 0) {
        // 已登录但无历史：回退公共推荐角色。
        return loadRecommendedCharacters();
      }
      setCharacters(data.characters.map((entry) => ({
        id: entry.characterId,
        name: entry.characterName,
        identity: entry.identity,
        avatarUrl: entry.characterAvatarUrl,
      })));
      setHasFrequentCharacters(true);
      setCharacterError('');
      return true;
    } catch {
      if (characterRequestIdRef.current !== requestId) return false;
      if (!shouldFallbackToPublicCharacters(silent, characters.length)) {
        setCharacterError('');
        Taro.showToast({ title: '常聊角色同步失败，已保留当前内容', icon: 'none' });
        return true;
      }
      return loadRecommendedCharacters();
    }
  }, [characters.length]);

  const loadHome = useCallback(async (mode: 'initial' | 'refresh') => {
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
    setScriptModeOn(false);
    const silent = mode === 'refresh';
    const [scriptsLoaded, charactersLoaded] = await Promise.all([
      loadScripts(scriptQuery, { silent, showLoading: mode === 'initial' && scripts.length === 0 }),
      loadCharacters(silent),
    ]);
    return scriptsLoaded && charactersLoaded;
  }, [loadCharacters, loadScripts, scriptQuery, scripts.length]);

  useTabPageLifecycle(loadHome, { onSessionReset: resetSessionData });

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

  const chooseRole = (script: ScriptCard) => {
    // 与剧本目录同范式：仅预览（不支持剧本模式）的剧本不进入选角。
    if (script.supportsScriptMode === false) return;
    Taro.navigateTo({ url: getScriptRoleSelectUrl(script.id) });
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
    }, SCRIPT_MODE_ENTRY_DELAY_MS);
  };

  // 离开首页即取消未触发的跳转定时器，避免用户在 260ms 内点了其它入口后仍被 push 到剧本目录。
  useDidHide(() => {
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
    if (scriptSearchTimerRef.current) clearTimeout(scriptSearchTimerRef.current);
    scriptRequestIdRef.current += 1;
    characterRequestIdRef.current += 1;
    setScriptsLoading(false);
  });

  useEffect(() => () => {
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
    if (scriptSearchTimerRef.current) clearTimeout(scriptSearchTimerRef.current);
  }, []);

  const hasScriptQuery = scriptQuery.trim().length > 0;

  return (
    <PageShell variant="scroll" noPadding className="theater-home">
      <View className="theater-home__topbar-shell" style={topBarStyle as CSSProperties}>
        <TopBar
          className="theater-home__topbar"
          titleClassName="theater-home__topbar-title"
          title={<Text className="theater-home__brand">月满楼</Text>}
        />
      </View>

      <View
        className={`theater-home__content${hasScriptQuery && !scriptsLoading && !scriptsError && scripts.length === 0 ? ' theater-home__content--search-empty' : ''}`}
        style={topBarStyle as CSSProperties}
      >
        <PageSection className="theater-home__hero-section">
          <View className="theater-home__hero-header">
            <View className="theater-home__hero-heading">
              <Text className="theater-home__hero-kicker">{homeSections.scriptKicker}</Text>
              <Text className="theater-home__hero-title">{homeSections.scriptTitle}</Text>
            </View>
            <View
              className={['theater-home__mode-switch', scriptModeOn ? 'theater-home__mode-switch--on' : ''].filter(Boolean).join(' ')}
              onTap={handleScriptModeToggle}
              aria-label="剧本模式"
            >
              <Text className="theater-home__mode-switch-label">{scriptModeOn ? '正在进入…' : homeSections.scriptModeEntry}</Text>
            </View>
          </View>
          <SearchBar
            value={scriptQuery}
            placeholder="搜索剧本名称、类型或关键词"
            className="theater-home__script-search"
            onInput={handleScriptQueryChange}
            onClear={handleScriptQueryClear}
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
              <View className="theater-home__hero-stage">
                <ScrollView
                  className="theater-home__script-scroll"
                  scrollX
                  enhanced
                  showScrollbar={false}
                  enableFlex
                  scrollIntoView={scriptScrollTarget || undefined}
                  scrollWithAnimation
                  onScroll={handleScriptScroll}
                >
                  {scripts.map((script, index) => {
                    const originalCover = getScriptCoverUrl(script);
                    const coverUrl = originalCover === '/assets/home/moon-garden-cover.jpg'
                      ? '/assets/second-contract/hero.webp'
                      : originalCover;
                    return (
                      <View
                        key={script.id}
                        id={`hero-${index}-${scriptScrollEpoch}`}
                        className="theater-home__hero-card"
                        onTap={() => chooseRole(script)}
                      >
                        {coverUrl ? (
                          <Image
                            className={`theater-home__hero-image${coverUrl === '/assets/second-contract/hero.webp' ? ' theater-home__hero-image--courtyard' : ''}`}
                            src={coverUrl}
                            mode="aspectFill"
                            lazyLoad
                          />
                        ) : (
                          <View className="theater-home__hero-image theater-home__hero-image--placeholder" />
                        )}
                        <View className="theater-home__hero-shade" />
                        {coverUrl === '/assets/second-contract/hero.webp' ? <View className="theater-home__hero-edge theater-home__hero-edge--left" /> : null}
                        {coverUrl === '/assets/second-contract/hero.webp' ? <View className="theater-home__hero-edge" /> : null}
                        {script.genre ? <Text className="theater-home__hero-genre">{script.genre}</Text> : null}
                        <View className="theater-home__hero-content">
                          <View className="theater-home__hero-tags">
                            <Text className="theater-home__hero-enter">可进入</Text>
                          </View>
                          <Text className="theater-home__hero-card-title" userSelect>{script.title}</Text>
                          {script.description ? <Text className="theater-home__hero-desc">{script.description}</Text> : null}
                          <View
                            className="theater-home__primary-action"
                            onTap={(event) => {
                              event.stopPropagation?.();
                              chooseRole(script);
                            }}
                          >
                            <Text>选择角色</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
                {scripts.length > 1 && (
                  <>
                    <View className={`theater-home__hero-arrow theater-home__hero-arrow--prev${scripts.length > 1 && activeScriptIndex > 0 ? '' : ' theater-home__hero-arrow--hidden'}`} onTap={() => goToScript(-1)}>
                      <Text className="theater-home__hero-arrow-text">‹</Text>
                    </View>
                    <View className="theater-home__hero-arrow theater-home__hero-arrow--next" onTap={() => goToScript(1)}>
                      <Text className="theater-home__hero-arrow-text">›</Text>
                    </View>
                  </>
                )}
              </View>
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
            <View className="theater-home__script-state">
              <Image className="theater-home__script-state-art" src="/assets/second-contract/home-search-empty.webp" mode="aspectFit" />
              <Text className="theater-home__script-state-title">{hasScriptQuery ? '没有找到相关剧本' : '暂无可用剧本'}</Text>
              <Text className="theater-home__script-state-message">
                {hasScriptQuery ? '换个剧本名或关键词试试' : '剧本准备好后会在这里出现'}
              </Text>
            </View>
          )}
        </PageSection>

        {hasScriptQuery ? (
        <PageSection title={getCharacterSectionTitle(hasFrequentCharacters)} kicker={homeSections.characterKicker} className="theater-home__character-section">
          {characters.length > 0 ? (
            <View className="theater-home__grid">
              {characters.map((character) => (
                <CharacterPosterCard
                  key={character.id}
                  className="theater-home__poster-card"
                  title={character.name}
                  subtitle={character.identity}
                  imageUrl={getCharacterAvatarUrl(character.name, character.avatarUrl, getCharacterGender(character.name))}
                  badge={CHARACTER_DECISION_BADGE}
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
        ) : (
        <View className="theater-home__script-section">
          <View className="theater-home__section-head">
            <View className="theater-home__section-rule" />
            <Text className="theater-home__section-title">选择你喜欢的剧本</Text>
            <View className="theater-home__section-rule" />
          </View>
          <View className="theater-home__script-list">
            {(scripts.length > 0 ? scripts : []).slice(0, 3).map((script) => {
              const display = visualScriptRow?.scriptIds.includes(script.id) ? visualScriptRow : undefined;
              const coverUrl = getScriptCoverUrl(script);
              return (
                <View key={script.id} className="theater-home__script-row" onTap={() => chooseRole(script)}>
                  {coverUrl ? <Image className="theater-home__script-art" src={coverUrl} mode="aspectFill" /> : null}
                  <View className="theater-home__script-title-scrim" />
                  <View className="theater-home__script-title-wrap">
                    <Text className="theater-home__script-title">{display?.title ?? script.title}</Text>
                  </View>
                  <View className="theater-home__script-copy">
                    <Text className="theater-home__script-badge">{display?.badge ?? (script.genre || '剧本')}</Text>
                    <Text className="theater-home__script-desc">{display?.description ?? (script.description || '这一段故事，等你入场。')}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
        )}
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '月满楼',
  navigationStyle: 'custom',
  backgroundColor: '#170e12',
  backgroundTextStyle: 'light',
});
