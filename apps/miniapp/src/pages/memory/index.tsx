import { View, Text } from '@tarojs/components';
import { useState, useEffect } from 'react';
import { EmptyState, MemoryCard, PageShell, StatusStateCard } from '@juben-sha/miniapp-ui';
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
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

  useEffect(() => {
    let cancelled = false;

    async function fetchMemory() {
      try {
        const authenticated = await verifyAuth();
        if (!authenticated) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = await api.get<MemoryResponse>('/api/memory');
        if (!cancelled) {
          setMemoryGroups(data.groups);
        }
      } catch (err) {
        if (!cancelled) {
          if (!handleAuthError(err)) {
            setError(err instanceof Error ? err.message : '加载失败');
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchMemory();
    return () => { cancelled = true; };
  }, [handleAuthError, verifyAuth]);

  const handleLogin = () => {
    goLogin();
  };

  if (loading) {
    return (
      <PageShell variant="scroll" tabBarReserve>
        <Text className="page-title">记忆</Text>
        <StatusStateCard title="正在整理记忆" message="系统正在读取角色维度的关系与剧情摘要。" icon="…" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell variant="scroll" tabBarReserve>
        <Text className="page-title">记忆</Text>
        <StatusStateCard title="记忆暂时不可用" message={error} tone="error" icon="!" />
      </PageShell>
    );
  }

  if (needsLogin) {
    return (
      <PageShell variant="scroll" tabBarReserve>
        <Text className="page-title">记忆</Text>
        <StatusStateCard
          title="登录后查看角色记忆"
          message="对话中的关系线索会在登录后持续整理。"
          primaryText="去登录"
          onPrimary={handleLogin}
        />
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" tabBarReserve>
      <Text className="page-title">记忆</Text>
      <Text className="page-subtitle">系统从对话中整理的关键信息，仅供参考</Text>

      <View className="memory__list">
        {memoryGroups.length === 0 ? (
          <EmptyState title="暂无进行中的故事" message="开始对话后，系统会自动提取关键信息。" />
        ) : (
          memoryGroups.map((group) => (
            <View key={group.characterId} className="memory__group">
              <Text className="memory__group-title">{group.characterName}</Text>
              {group.memories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  className="memory__card"
                  typeLabel={MEMORY_TYPE_LABELS[memory.type] || memory.type}
                  content={memory.content}
                  tone={memory.type === 'relationship' ? 'relationship' : memory.type === 'story' ? 'story' : 'neutral'}
                />
              ))}
            </View>
          ))
        )}
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '记忆',
});
