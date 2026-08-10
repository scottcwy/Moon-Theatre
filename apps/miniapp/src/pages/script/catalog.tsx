import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, EmptyState, PageSection, PageShell, SearchBar, StatusStateCard } from '@juben-sha/miniapp-ui';
import { api } from '../../services/api';
import { getScriptCoverUrl, getScriptRoleSelectUrl, shouldApplyScriptResponse } from '../home/index.model';
import { buildScriptCatalogUrl, getScriptModeBadge, scriptCatalogSections } from './catalog.model';
import type { ScriptCatalogItem } from './catalog.model';
import './catalog.scss';

export default function ScriptCatalog() {
  const [query, setQuery] = useState('');
  const [scripts, setScripts] = useState<ScriptCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const loadScripts = useCallback(async (keyword: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const data = await api.get<{ scripts: ScriptCatalogItem[] }>(buildScriptCatalogUrl(keyword));
      if (!shouldApplyScriptResponse(requestId, requestIdRef.current)) return;
      setScripts(data.scripts);
    } catch {
      if (!shouldApplyScriptResponse(requestId, requestIdRef.current)) return;
      setError('剧本目录暂时不可用，请稍后重试');
    } finally {
      if (shouldApplyScriptResponse(requestId, requestIdRef.current)) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadScripts(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadScripts, query]);

  const openScript = (script: ScriptCatalogItem) => {
    if (!script.supportsScriptMode) return;
    Taro.navigateTo({ url: getScriptRoleSelectUrl(script.id) });
  };

  const hasQuery = query.trim().length > 0;

  return (
    <PageShell variant="scroll">
      <PageSection title={scriptCatalogSections.title} kicker={scriptCatalogSections.kicker}>
        <SearchBar
          value={query}
          placeholder={scriptCatalogSections.searchPlaceholder}
          className="script-catalog__search"
          onInput={setQuery}
          onClear={() => setQuery('')}
        />

        {loading ? (
          <StatusStateCard className="script-catalog__state" title="正在读取剧本目录" message="可用剧本加载中。" icon="…" />
        ) : error ? (
          <StatusStateCard
            className="script-catalog__state"
            title="剧本目录暂时不可用"
            message="请稍后重试。"
            tone="error"
            icon="!"
            primaryText="重新加载"
            onPrimary={() => { void loadScripts(query); }}
          />
        ) : scripts.length > 0 ? (
          <View className="script-catalog__list">
            {scripts.map((script) => {
              const coverUrl = getScriptCoverUrl(script);
              const playable = script.supportsScriptMode;
              return (
                <View
                  key={script.id}
                  className={['script-catalog__card', !playable && 'script-catalog__card--disabled'].filter(Boolean).join(' ')}
                  onTap={() => openScript(script)}
                >
                  {coverUrl ? (
                    <Image className="script-catalog__cover" src={coverUrl} mode="aspectFill" />
                  ) : (
                    <View className="script-catalog__cover script-catalog__cover--placeholder" />
                  )}
                  <View className="script-catalog__card-body">
                    <View className="script-catalog__card-meta">
                      <Badge tone="secondary">{script.genre || '角色剧本'}</Badge>
                      <Badge tone={playable ? 'primary' : 'neutral'}>{getScriptModeBadge(script)}</Badge>
                    </View>
                    <Text className="script-catalog__card-title">{script.title}</Text>
                    <Text className="script-catalog__card-desc">{script.description}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            className="script-catalog__state"
            title={hasQuery ? '没有找到相关剧本' : '暂无可用剧本'}
            message={hasQuery ? '换个关键词，或清除搜索查看全部剧本。' : '剧本准备好后会在这里出现。'}
            primaryText={hasQuery ? '清除搜索' : undefined}
            onPrimary={hasQuery ? () => setQuery('') : undefined}
          />
        )}
      </PageSection>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '剧本目录',
});
