import { View, Text } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import './preview.scss';

export default function SharePreview() {
  const router = useRouter();
  const characterId = router.params.characterId || 'char-jiang';

  const CHARACTER_MAP: Record<string, { name: string }> = {
    'char-jiang': { name: '蒋伯驾' },
    'char-cheng': { name: '程聿怀' },
    'char-yisa': { name: '以撒' },
  };

  const character = CHARACTER_MAP[characterId] || { name: '蒋伯驾' };

  const EXCERPT = '夜巡的灯火，你若不怕，便随我来。城墙上只有我们两个人，风吹过来的时候，连铁骑都会觉得冷。';

  return (
    <View className="share-preview-page">
      <View className="share-preview-page__card">
        <View className="share-preview-page__header">
          <View className="share-preview-page__avatar-placeholder">
            <Text className="share-preview-page__avatar-text">{character.name[0]}</Text>
          </View>
          <View className="share-preview-page__header-info">
            <Text className="share-preview-page__name">{character.name}</Text>
            <Text className="share-preview-page__source">来自「夜色围城」</Text>
          </View>
        </View>

        <View className="share-preview-page__excerpt">
          <Text className="share-preview-page__excerpt-text">{EXCERPT}</Text>
        </View>

        <View className="share-preview-page__watermark">
          <Text className="share-preview-page__watermark-text">
            AI 生成内容 · 剧本杀角色扮演
          </Text>
        </View>
      </View>

      <View className="share-preview-page__actions">
        <View className="button-primary">
          <Text className="share-preview-page__btn-text">保存到相册</Text>
        </View>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '分享预览',
});