import { View, Text } from '@tarojs/components';
import { useState, useEffect } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import { StatusStateCard, EmptyState } from '../../components/status/StatusStateCard';
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
        <StatusStateCard title="正在整理记忆" message="系统正在读取角色维度的关系与剧情摘要。" icon="…" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="memory-page">
        <Text className="memory-page__title">记忆</Text>
        <StatusStateCard title="记忆暂时不可用" message={error} tone="error" icon="!" />
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="memory-page">
        <Text className="memory-page__title">记忆</Text>
        <StatusStateCard
          title="登录后查看角色记忆"
          message="对话中的关系线索会在登录后持续整理。"
          primaryText="去登录"
          onPrimary={handleLogin}
        />
      </View>
    );
  }

  return (
    <View className="memory-page">
      <Text className="memory-page__title">记忆</Text>
      <Text className="memory-page__subtitle">系统从对话中整理的关键信息，仅供参考</Text>

      <View className="memory-page__list">
        {memoryGroups.length === 0 ? (
          <EmptyState title="暂无进行中的故事" message="开始对话后，系统会自动提取关键信息。" />
        ) : (
          memoryGroups.map((group) => (
            <View key={group.characterId} className="memory-page__group">
              <Text className="memory-page__group-title">{group.characterName}</Text>
              {group.memories.map((memory) => (
                <View key={memory.id} className="memory-page__card card">
                  <Badge>{MEMORY_TYPE_LABELS[memory.type] || memory.type}</Badge>
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
