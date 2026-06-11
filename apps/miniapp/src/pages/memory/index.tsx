import { View, Text, ScrollView } from '@tarojs/components';
import { useState, useEffect } from 'react';
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

  useEffect(() => {
    api
      .get<MemoryResponse>('/api/memory')
      .then((data) => {
        setMemoryGroups(data.groups);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载失败');
        setLoading(false);
      });
  }, []);

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

  return (
    <View className="memory-page">
      <Text className="memory-page__title">记忆</Text>
      <Text className="memory-page__subtitle">系统从对话中整理的关键信息，仅供参考</Text>

      <ScrollView className="memory-page__list" scrollY>
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
      </ScrollView>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '记忆',
});
