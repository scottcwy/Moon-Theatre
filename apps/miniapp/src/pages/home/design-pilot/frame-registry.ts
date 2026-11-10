import type { PilotFrameData, PilotFrameSpec } from './types';
import designFrames from '../../../../playground/design-frames.json';

// 设计稿帧数据只被 H5 设计预览页（home/index.h5.tsx）和单测使用，不进入小程序产物。
const frameData = designFrames as PilotFrameData;

export const pilotFrames = frameData;
export const pilotFrameDefinitions = frameData.definitions;
export const defaultPilotFrameKey = '1-863';

export function getPilotFrame(key?: string | null): PilotFrameSpec {
  const requested = key || defaultPilotFrameKey;
  const frame = frameData.frames[requested];
  if (frame) return frame;
  throw new Error(`Unknown H5 pilot frame: ${requested}. Available: ${pilotFrameDefinitions.map((item) => item.key).join(', ')}`);
}
