import { View } from '@tarojs/components';
import { PilotFrame } from './design-pilot/PilotFrame';
import { getPilotFrame } from './design-pilot/frame-registry';
import './design-pilot/PilotFrame.scss';

function getRequestedFrameKey(): string | null {
  const location = (globalThis as { location?: { search?: string } }).location;
  const search = location?.search || '';
  return new URLSearchParams(search).get('frame');
}

export default function HomePilot() {
  const frame = getPilotFrame(getRequestedFrameKey());
  const misans = (globalThis as { location?: { search?: string } }).location?.search?.includes('font=misans');
  return (
    <View className={`pilot-shell${misans ? ' pilot-shell--misans' : ''}`}>
      <PilotFrame frame={frame} />
    </View>
  );
}
