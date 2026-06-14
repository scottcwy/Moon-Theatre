import { View, Text } from '@tarojs/components';
import { useState, useEffect } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import './index.scss';

interface MemoryItem {
  id: string;
  type: 'user_info' | 'relationship' | 'story';
  content: string;
}

interface MemoryGroup {
  characterId: string;
  characterName: string;
  memories: MemoryItem[];
}

interface MemoryResponse {
  groups: MemoryGroup[];
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  user_info: '用户信息',
  relationship: '关系状态',
  story: '剧情状态',
};

export default function Memory() {
  const [memoryGroups, setMemoryGroups] = useState<MemoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, requireAuth, handleAuthError, goLogin } = useAuthGuard();

  useEffect(() => {
    if (!requireAuth()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    api
      .get<MemoryResponse>('/api/memory')
      .then((data) => {
        if (!cancelled) {
          setMemoryGroups(data.groups);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (!handleAuthError(err)) {
            setError(err instanceof Error ? err.message : '加载失败');
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [handleAuthError, requireAuth]);

  const handleLogin = () => {
    goLogin();
  };

  if (loading) {
    return (
      <View className="memory-page">
        <Text className="memory-page__title">记忆</Text>
        <View className="memory-page__empty">
          <Text className="memory-page__empty-text">加载中...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="memory-page">
        <Text className="memory-page__title">记忆</Text>
        <View className="memory-page__empty">
          <Text className="memory-page__empty-text">{error}</Text>
        </View>
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="memory-page">
        <Text className="memory-page__title">记忆</Text>
        <View className="memory-page__empty">
          <Text className="memory-page__empty-text">登录后查看角色记忆</Text>
          <Text className="memory-page__empty-hint">对话中的关系线索会在登录后持续整理</Text>
          <View className="button-primary memory-page__empty-action" onClick={handleLogin}>
            <Text className="button-primary__text">去登录</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="memory-page">
      <Text className="memory-page__title">记忆</Text>
      <Text className="memory-page__subtitle">系统从对话中整理的关键信息，仅供参考</Text>

      <View className="memory-page__list">
        {memoryGroups.length === 0 ? (
          <View className="memory-page__empty">
            <Text className="memory-page__empty-text">暂无记忆</Text>
            <Text className="memory-page__empty-hint">开始对话后，系统会自动提取关键信息</Text>
          </View>
        ) : (
          memoryGroups.map((group) => (
            <View key={group.characterId} className="memory-page__group">
              <Text className="memory-page__group-title">{group.characterName}</Text>
              {group.memories.map((memory) => (
                <View key={memory.id} className="memory-page__card card">
                  <View className="chip chip-mood-neutral">
                    <Text className="chip__text">{MEMORY_TYPE_LABELS[memory.type] || memory.type}</Text>
                  </View>
                  <Text className="memory-page__card-content">{memory.content}</Text>
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '记忆',
});
