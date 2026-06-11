import { View, Text, ScrollView } from '@tarojs/components';
import { useState } from 'react';
import './index.scss';

interface MemoryGroup {
  characterId: string;
  characterName: string;
  memories: {
    id: string;
    type: 'user_info' | 'relationship' | 'story';
    content: string;
  }[];
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  user_info: '用户信息',
  relationship: '关系状态',
  story: '剧情状态',
};

const PLACEHOLDER_MEMORIES: MemoryGroup[] = [
  {
    characterId: 'char-jiang',
    characterName: '蒋伯驾',
    memories: [
      { id: 'm1', type: 'user_info', content: '用户自称是外地来的旅人，对围城内的规矩充满好奇。' },
      { id: 'm2', type: 'relationship', content: '蒋伯驾视用户为同路人，态度谨慎但愿意透露部分信息。' },
      { id: 'm3', type: 'story', content: '用户在城墙巡逻中偶遇蒋伯驾，他正在检查一盏信号灯。' },
    ],
  },
  {
    characterId: 'char-cheng',
    characterName: '程聿怀',
    memories: [
      { id: 'm4', type: 'user_info', content: '用户对旧城的传闻很感兴趣，经常追问程聿怀的背景。' },
      { id: 'm5', type: 'relationship', content: '程聿怀对用户保持旁观者姿态，偶有试探。' },
    ],
  },
  {
    characterId: 'char-yisa',
    characterName: '以撒',
    memories: [
      { id: 'm6', type: 'relationship', content: '医患关系，以撒对用户的伤痛格外关注。' },
      { id: 'm7', type: 'story', content: '以撒在深夜为用户处理了伤口，暗示围城之下只有更深的伤痕。' },
    ],
  },
];

export default function Memory() {
  const [memoryGroups] = useState<MemoryGroup[]>(PLACEHOLDER_MEMORIES);

  return (
    <View className="memory-page">
      <Text className="memory-page__title">记忆</Text>
      <Text className="memory-page__subtitle">系统从对话中整理的关键信息，仅供参考</Text>

      <ScrollView className="memory-page__list" scrollY>
        {memoryGroups.map((group) => (
          <View key={group.characterId} className="memory-page__group">
            <Text className="memory-page__group-title">{group.characterName}</Text>
            {group.memories.map((memory) => (
              <View key={memory.id} className="memory-page__card card">
                <View className="chip chip-mood-neutral">
                  <Text className="chip__text">{MEMORY_TYPE_LABELS[memory.type]}</Text>
                </View>
                <Text className="memory-page__card-content">{memory.content}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '记忆',
});