import { Image, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { getAchievementIconMeta } from './AchievementIcon.model';
import './AchievementIcon.scss';

interface AchievementIconProps {
  code?: string | null;
  name?: string | null;
  className?: string;
}

export function AchievementIcon({ code, name, className = '' }: AchievementIconProps) {
  const meta = getAchievementIconMeta(code);
  const [assetFailed, setAssetFailed] = useState(false);
  const classes = [
    'achievement-icon',
    `achievement-icon--${meta.tone}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <View className={classes} aria-label={name || meta.label}>
      {meta.asset && !assetFailed ? (
        <Image
          className="achievement-icon__image"
          src={meta.asset}
          mode="aspectFit"
          onError={() => setAssetFailed(true)}
        />
      ) : (
        <Text className="achievement-icon__fallback">{meta.fallback}</Text>
      )}
      <View className="achievement-icon__ring" />
    </View>
  );
}
