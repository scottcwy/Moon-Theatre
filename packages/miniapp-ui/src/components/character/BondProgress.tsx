import { Text, View } from '@tarojs/components';
import { Badge } from '../ui/Badge';
import type { BondViewModel } from './bond.model';
import { bondLevelName } from './bond.model';
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

  return (
    <View className="bond-progress">
      <View className="bond-progress__head">
        <Text className="bond-progress__relationship">{relationship}</Text>
        <Badge tone="primary" className="bond-progress__badge">♥ {bondLevelName(displayLevel)}</Badge>
      </View>
      <View className="bond-progress__track">
        <View className="bond-progress__bar" style={{ width: `${percent}%` }} />
      </View>
    </View>
  );
}
