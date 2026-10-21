import { Image, ScrollView, Text, View } from '@tarojs/components';
import type { BaseEventOrig, ScrollViewProps } from '@tarojs/components';
import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
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
import { StageTabBar } from '../../components/StageTabBar';
import { getCharacterGender } from '../../services/character-gender';
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
  // 首个 onShow 与首挂载加载重叠，跳过；之后每次回到首页都刷新角色列表。
  const skipFirstShowRef = useRef(true);
  const [topBarStyle, setTopBarStyle] = useState<Record<string, string>>(
    getTopBarStyle(calculateTopBarMetrics()),
  );
  const scriptRequestIdRef = useRef(0);
  const [activeScriptIndex, setActiveScriptIndex] = useState(0);
  const [scriptScrollEpoch, setScriptScrollEpoch] = useState(0);
  const [scriptScrollTarget, setScriptScrollTarget] = useState('');

  const loadScripts = useCallback(async (query: string) => {
    const requestId = scriptRequestIdRef.current + 1;
    scriptRequestIdRef.current = requestId;
    setScriptsLoading(true);
    setScriptsError('');
    try {
      const data = await api.get<{ scripts: ScriptCard[] }>(buildScriptsUrl(query));
      if (!shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) return;
      setScripts(data.scripts.length > 0 || query.trim() ? data.scripts : [...localHomeScripts]);
    } catch {
      if (!shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) return;
      if (query.trim()) {
        setScripts([]);
        setScriptsError('');
      } else {
        setScripts([...localHomeScripts]);
        setScriptsError('');
      }
    } finally {
      if (shouldApplyScriptResponse(requestId, scriptRequestIdRef.current)) {
        setScriptsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadScripts(scriptQuery);
    }, SCRIPT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [loadScripts, scriptQuery]);

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
  }, [scripts]);

  // 首页是常驻 tab 页，不做卸载取消；首挂载与返回首页（useDidShow）共用此入口。
  const loadCharacters = useCallback(() => {
    const loadRecommendedCharacters = () => {
      api
        .get<{ characters: CharacterCard[] }>('/api/characters')
        .then((data) => {
          setCharacters(data.characters.length > 0 ? data.characters : [...localHomeCharacters]);
          setHasFrequentCharacters(false);
        })
        .catch(() => {
          setCharacters([...localHomeCharacters]);
          setCharacterError('');
        });
    };

    // 未登录：不发起必然 401 的常聊聚合请求，直接用公共推荐。
    if (!isLoggedIn()) {
      loadRecommendedCharacters();
      return;
    }

    api
      .get<{ characters: FrequentCharacterEntry[] }>(buildFrequentCharactersUrl())
      .then((data) => {
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
        loadRecommendedCharacters();
      });
  }, []);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters]);

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

  useDidShow(() => {
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
    setScriptModeOn(false);
    if (skipFirstShowRef.current) {
      skipFirstShowRef.current = false;
      return;
    }
    loadCharacters();
  });

  // 离开首页即取消未触发的跳转定时器，避免用户在 260ms 内点了其它入口后仍被 push 到剧本目录。
  useDidHide(() => {
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
  });

  useEffect(() => () => {
    if (scriptModeTimerRef.current) clearTimeout(scriptModeTimerRef.current);
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
              aria-label="剧本模式"
            >
              <Text className="theater-home__mode-switch-label">{scriptModeOn ? '正在进入…' : homeSections.scriptModeEntry}</Text>
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
                    const coverUrl = getScriptCoverUrl(script);
                    return (
                      <View
                        key={script.id}
                        id={`hero-${index}-${scriptScrollEpoch}`}
                        className="theater-home__hero-card"
                        onTap={() => chooseRole(script)}
                      >
                        {coverUrl ? (
                          <Image className="theater-home__hero-image" src={coverUrl} mode="aspectFill" lazyLoad />
                        ) : (
                          <View className="theater-home__hero-image theater-home__hero-image--placeholder" />
                        )}
                        <View className="theater-home__hero-shade" />
                        <View className="theater-home__hero-content">
                          <View className="theater-home__hero-tags">
                            {script.genre ? <Text className="theater-home__hero-genre">{script.genre}</Text> : null}
                            <Text className="theater-home__hero-enter">可进入</Text>
                          </View>
                          <Text className="theater-home__hero-card-title" userSelect>{script.title}</Text>
                          {script.description ? <Text className="theater-home__hero-desc">{script.description}</Text> : null}
                          <View className="theater-home__primary-action" onTap={() => chooseRole(script)}>
                            <Text>选择角色</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
                {scripts.length > 1 && (
                  <>
                    <View className="theater-home__hero-arrow theater-home__hero-arrow--prev" onTap={() => goToScript(-1)}>
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
              <Image className="theater-home__script-state-art" src="/assets/second-contract/home-search-empty.png" mode="aspectFit" />
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
            {(scripts.length > 0 ? scripts : []).slice(0, 3).map((script) => (
              <View key={script.id} className="theater-home__script-row" onTap={() => chooseRole(script)}>
                <View className="theater-home__script-spine">
                  <Text className="theater-home__script-spine-text">{script.title.slice(0, 6)}</Text>
                </View>
                <Image className="theater-home__script-art" src="/assets/home/yunyun-cover.jpg" mode="aspectFill" />
                <View className="theater-home__script-copy">
                  <Text className="theater-home__script-badge">{script.genre || '剧本'}</Text>
                  <Text className="theater-home__script-desc">{script.description || '这一段故事，等你入场。'}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
        )}
      </View>
      <StageTabBar selected="/pages/home/index" />
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '月满楼',
  navigationStyle: 'custom',
  backgroundColor: '#170e12',
  backgroundTextStyle: 'light',
});
