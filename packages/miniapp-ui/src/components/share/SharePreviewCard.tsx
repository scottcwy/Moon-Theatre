import { Text, View } from '@tarojs/components';
import { SHARE_IDENTITY_FALLBACK } from '../../design/figma-system';
import { bondLevelName } from '../character/bond.model';
import { Badge } from '../ui/Badge';
import './SharePreviewCard.scss';

interface SharePreviewCardProps {
  characterName: string;
  excerpt: string;
  bondLevel?: number;
  /** 数据驱动身份标签；缺省时回退到通用文案。 */
  identity?: string;
  /** 传入后右上角渲染可点击的关闭按钮；缺省不渲染，避免无响应的「×」装饰。 */
  onClose?: () => void;
}

export function SharePreviewCard({ characterName, excerpt, bondLevel = 1, identity, onClose }: SharePreviewCardProps) {
  return (
    <View className="share-preview-card">
      <View className="share-preview-card__overlay" />
      {onClose && <View className="share-preview-card__close" onTap={onClose}>×</View>}
      <View className="share-preview-card__content">
        <Text className="share-preview-card__quote-mark">“</Text>
        <Text className="share-preview-card__quote">{excerpt}</Text>
        <View className="share-preview-card__name-row">
          <Text className="share-preview-card__name">{characterName}</Text>
          <Badge tone="primary">{identity || SHARE_IDENTITY_FALLBACK}</Badge>
        </View>
        <View className="share-preview-card__badges">
          <Badge tone="neutral">♥ 信赖</Badge>
          <Badge tone="neutral">✹ {bondLevelName(bondLevel)}</Badge>
        </View>
        <View className="share-preview-card__divider" />
        <Text className="share-preview-card__brand">月满楼</Text>
        <Text className="share-preview-card__scan">扫码加入故事 · AI 生成内容</Text>
      </View>
    </View>
  );
}
