export interface PilotFrameDefinition {
  key: string;
  id: string;
  page: string;
  state: string;
  label: string;
}

export interface PilotEffectSpec {
  type: string;
  radius: number;
  spread: number;
  offsetX: number;
  offsetY: number;
  color: string;
  opacity: number;
}

export interface PilotStrokeSpec {
  type: string;
  color: string | null;
  opacity: number;
}

export interface PilotFillSpec {
  type: string;
  color?: string;
  opacity?: number;
  imageRef?: string;
  scaleMode?: string;
  imageTransform?: number[][] | null;
}

export interface PilotTextSpec {
  characters: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlignHorizontal: string;
  textAlignVertical: string;
  color: string;
  colorOpacity: number;
}

export interface PilotNodeSpec {
  id: string;
  name: string;
  type: string;
  kind: 'container' | 'shape' | 'text' | 'image' | 'baked';
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  blendMode: string;
  clipsContent: boolean;
  radius: number | null;
  cornerRadii: number[] | null;
  strokes: PilotStrokeSpec[];
  strokeWeight: number;
  strokeAlign: string;
  effects: PilotEffectSpec[];
  fill?: PilotFillSpec | null;
  children?: PilotNodeSpec[];
  text?: PilotTextSpec;
  asset?: string;
  imageRef?: string;
  scaleMode?: string;
  imageTransform?: number[][] | null;
  clipRadius?: number | string;
}

export interface PilotFrameSpec {
  key: string;
  id: string;
  name: string;
  page: string;
  state: string;
  label: string;
  width: number;
  height: number;
  background: string;
  nodes: PilotNodeSpec[];
}

export interface PilotFrameData {
  version: string;
  generatedAt: string;
  definitions: PilotFrameDefinition[];
  frames: Record<string, PilotFrameSpec>;
}
