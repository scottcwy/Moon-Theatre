import { Text, View } from '@tarojs/components';
import { getShareIdentityLabel } from '../../design/figma-system';
import { Badge } from '../ui/Badge';
import './SharePreviewCard.scss';

interface SharePreviewCardProps {
  characterName: string;
  excerpt: string;
  bondLevel?: number;
}

export function SharePreviewCard({ characterName, excerpt, bondLevel = 4 }: SharePreviewCardProps) {
  return (
    <View className="share-preview-card">
      <View className="share-preview-card__overlay" />
      <Text className="share-preview-card__close">×</Text>
      <View className="share-preview-card__content">
        <Text className="share-preview-card__quote-mark">“</Text>
        <Text className="share-preview-card__quote">{excerpt}</Text>
        <View className="share-preview-card__name-row">
          <Text className="share-preview-card__name">{characterName}</Text>
          <Badge tone="primary">{getShareIdentityLabel(characterName)}</Badge>
        </View>
        <View className="share-preview-card__badges">
          <Badge tone="neutral">♥ 信赖</Badge>
          <Badge tone="neutral">✹ Lv.{bondLevel}</Badge>
        </View>
        <View className="share-preview-card__divider" />
        <Text className="share-preview-card__brand">灵犀剧场</Text>
        <Text className="share-preview-card__scan">扫码加入故事 · AI 生成内容</Text>
      </View>
    </View>
  );
}
