import { Text, View } from '@tarojs/components';
import { SHARE_IDENTITY_FALLBACK } from '../../design/figma-system';
import './SharePreviewCard.scss';

interface SharePreviewCardProps {
  characterName: string;
  excerpt: string;
  bondLevel?: number;
  /** 数据驱动身份标签；缺省时回退到通用文案。 */
  identity?: string;
  /** 传入后右上角渲染可点击的关闭按钮；缺省不渲染，避免无响应的「×」装饰。 */
  onClose?: () => void;
  /** 仅 visual fixture 为 true：渲染不可扫描的装饰性二维码占位。 */
  showQr?: boolean;
}

const QR_PATTERN = [
  '11111110101',
  '10000010110',
  '10111010101',
  '10111010010',
  '10111010111',
  '10000010010',
  '11111110101',
  '00000000110',
  '11010111101',
  '01101000110',
  '10110111011',
];

export function SharePreviewCard({
  characterName,
  excerpt,
  identity,
  onClose,
  showQr = false,
}: SharePreviewCardProps) {
  return (
    <View className="share-preview-card">
      <View className="share-preview-card__overlay" />
      {onClose && (
        <View className="share-preview-card__close" onTap={onClose}>
          <View className="share-preview-card__close-mark" />
        </View>
      )}
      <Text className="share-preview-card__wordmark">月满楼</Text>
      <View className="share-preview-card__content">
        <Text className="share-preview-card__quote-mark">“</Text>
        <Text className="share-preview-card__quote">{excerpt}</Text>
        <View className="share-preview-card__name-row">
          <Text className="share-preview-card__name">{characterName}</Text>
          <View className="share-preview-card__name-rule" />
          <Text className="share-preview-card__identity">{identity || SHARE_IDENTITY_FALLBACK}</Text>
        </View>
        <View className="share-preview-card__divider" />
        <View className="share-preview-card__footer">
          <View className="share-preview-card__brand-copy">
            <Text className="share-preview-card__brand">月满楼</Text>
            <Text className="share-preview-card__scan">AI 生成内容</Text>
          </View>
          {showQr ? (
            <View className="share-preview-card__qr">
              {QR_PATTERN.map((row, rowIndex) => (
                <View key={`qr-row-${rowIndex}`} className="share-preview-card__qr-row">
                  {[...row].map((cell, columnIndex) => (
                    <View
                      key={`qr-cell-${rowIndex}-${columnIndex}`}
                      className={`share-preview-card__qr-cell${cell === '1' ? ' share-preview-card__qr-cell--on' : ''}`}
                    />
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
