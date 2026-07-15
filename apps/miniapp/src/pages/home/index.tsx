import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  CharacterPosterCard,
  EmptyState,
  PageSection,
  PageShell,
  PrimaryButton,
  SearchBar,
  StatusStateCard,
  TopBar,
} from '@juben-sha/miniapp-ui';
import { api } from '../../services/api';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';
import {
  buildScriptsUrl,
  getCharacterAvatarUrl,
  getCharacterDecisionBadge,
  getCharacterDetailUrl,
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
  avatarUrl: string;
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

export default function Home() {
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [characterError, setCharacterError] = useState('');
  const [scripts, setScripts] = useState<ScriptCard[]>([]);
  const [scriptQuery, setScriptQuery] = useState('');
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [scriptsError, setScriptsError] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [topBarStyle, setTopBarStyle] = useState<Record<string, string>>(
    getTopBarStyle(calculateTopBarMetrics()),
  );
  const scriptRequestIdRef = useRef(0);

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

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ characters: CharacterCard[] }>('/api/characters')
      .then((data) => {
        if (!cancelled) setCharacters(data.characters);
      })
      .catch(() => {
        if (!cancelled) setCharacterError('角色列表暂时不可用，请稍后重试');
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

  const hasScriptQuery = scriptQuery.trim().length > 0;

  return (
    <PageShell variant="scroll" noPadding>
      <View className="theater-home__topbar-shell" style={topBarStyle as CSSProperties}>
        <TopBar
          className="theater-home__topbar"
          titleClassName="theater-home__topbar-title"
          left={<View className="theater-home__settings-button"><Text className="theater-home__settings">⚙</Text></View>}
          title={<Text className="theater-home__brand">灵犀剧场</Text>}
        />
      </View>

      <View className="theater-home__content" style={topBarStyle as CSSProperties}>
        <PageSection title={homeSections.scriptTitle} kicker={homeSections.scriptKicker} className="theater-home__hero-section">
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
              message="稍后重试，或先从最近角色进入详情。"
              tone="error"
              icon="!"
              primaryText="重新加载"
              onPrimary={() => { void loadScripts(scriptQuery); }}
            />
          ) : scripts.length > 0 ? (
            <View className="theater-home__feature-strip">
              {scripts.map((script) => {
                const coverUrl = getScriptCoverUrl(script);
                return (
                  <View key={script.id} className="theater-home__hero-card">
                    {coverUrl ? (
                      <Image className="theater-home__hero-image" src={coverUrl} mode="aspectFill" />
                    ) : (
                      <View className="theater-home__hero-image theater-home__hero-image--placeholder" />
                    )}
                    <View className="theater-home__hero-shade" />
                    <View className="theater-home__hero-logo">
                      <Text className="theater-home__hero-logo-text">{script.genre || '角色剧本'}</Text>
                    </View>
                    <View className="theater-home__hero-content">
                      <Badge tone="secondary" className="theater-home__tag">可进入</Badge>
                      <Text className="theater-home__hero-title">{script.title}</Text>
                      <Text className="theater-home__hero-desc">{script.description}</Text>
                      <PrimaryButton className="theater-home__primary-action" onTap={() => chooseRole(script.id)}>
                        {homeSections.scriptPrimaryAction}
                      </PrimaryButton>
                    </View>
                  </View>
                );
              })}
            </View>
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

        <PageSection title={homeSections.characterTitle} kicker={homeSections.characterKicker} className="theater-home__character-section">
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
  navigationBarTitleText: '灵犀剧场',
  navigationStyle: 'custom',
});
