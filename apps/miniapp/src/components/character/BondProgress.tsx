import { Text, View } from '@tarojs/components';
import { Badge } from '../ui/Badge';
import './BondProgress.scss';

interface BondProgressProps {
  relationship: string;
  level: number;
  exp: number;
  maxExp: number;
}

export function BondProgress({ relationship, level, exp, maxExp }: BondProgressProps) {
  const percent = Math.min(Math.round((exp / Math.max(maxExp, 1)) * 100), 100);
  const remaining = Math.max(maxExp - exp, 0);

  return (
    <View className="bond-progress">
      <View className="bond-progress__head">
        <View>
          <Text className="bond-progress__label">当前关系</Text>
          <Text className="bond-progress__relationship">{relationship} ♥</Text>
        </View>
        <Badge tone="primary">等级 {level}</Badge>
      </View>
      <View className="bond-progress__track">
        <View className="bond-progress__bar" style={{ width: `${percent}%` }} />
      </View>
      <Text className="bond-progress__hint">距下一等级还需 {remaining} 默契度</Text>
    </View>
  );
}
