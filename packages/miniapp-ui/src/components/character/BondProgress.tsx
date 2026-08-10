import { Text, View } from '@tarojs/components';
import { Badge } from '../ui/Badge';
import type { BondViewModel } from './bond.model';
import './BondProgress.scss';

interface BondProgressProps {
  relationship: string;
  level?: number;
  exp?: number;
  maxExp?: number;
  bond?: BondViewModel;
}

export function BondProgress({ relationship, level, exp, maxExp, bond }: BondProgressProps) {
  const percent = bond?.percent
    ?? (maxExp !== undefined && exp !== undefined ? Math.min(Math.round((exp / Math.max(maxExp, 1)) * 100), 100) : 0);
  const displayLevel = bond?.level ?? level ?? 1;
  const remaining = bond?.remainingExp ?? (maxExp !== undefined && exp !== undefined ? Math.max(maxExp - exp, 0) : 0);

  return (
    <View className="bond-progress">
      <View className="bond-progress__head">
        <View>
          <Text className="bond-progress__label">当前关系</Text>
          <Text className="bond-progress__relationship">{relationship} ♥</Text>
        </View>
        <Badge tone="primary">羁绊 Lv.{displayLevel}</Badge>
      </View>
      <View className="bond-progress__track">
        <View className="bond-progress__bar" style={{ width: `${percent}%` }} />
      </View>
      <Text className="bond-progress__hint">{bond?.remainingLabel ?? `距下一级羁绊还需 ${remaining}`}</Text>
    </View>
  );
}
