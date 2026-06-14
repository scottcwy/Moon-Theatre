import { Text, View } from '@tarojs/components';
import type { ModelTier } from '../../types';
import { getTierMeta } from '../../design/figma-system';
import './ModelTierSegmentedControl.scss';

interface ModelTierSegmentedControlProps {
  tiers: ModelTier[];
  activeTier: ModelTier;
  costs: Record<ModelTier, number>;
  onChange: (tier: ModelTier) => void;
}

export function ModelTierSegmentedControl({ tiers, activeTier, costs, onChange }: ModelTierSegmentedControlProps) {
  return (
    <View className="model-tier-control">
      {tiers.map((tier) => {
        const meta = getTierMeta(tier, costs[tier]);
        const active = activeTier === tier;
        return (
          <View
            key={tier}
            className={`model-tier-control__item${active ? ' model-tier-control__item--active' : ''}`}
            onTap={() => onChange(tier)}
          >
            <Text className="model-tier-control__label">{meta.label}</Text>
            <Text className="model-tier-control__cost">{active ? meta.activeHint : meta.costLabel}</Text>
          </View>
        );
      })}
    </View>
  );
}
