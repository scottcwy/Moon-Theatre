import type { PilotFrameData, PilotFrameSpec } from './types';

const frameData = require('../../../../playground/design-frames.json') as PilotFrameData;

export const pilotFrames = frameData;
export const pilotFrameDefinitions = frameData.definitions;
export const defaultPilotFrameKey = '1-863';

export function getPilotFrame(key?: string | null): PilotFrameSpec {
  const requested = key || defaultPilotFrameKey;
  const frame = frameData.frames[requested];
  if (frame) return frame;
  throw new Error(`Unknown H5 pilot frame: ${requested}. Available: ${pilotFrameDefinitions.map((item) => item.key).join(', ')}`);
}
