import { Text, View } from '@tarojs/components';
import type { CSSProperties, ReactNode } from 'react';
import type {
  PilotEffectSpec,
  PilotFrameSpec,
  PilotNodeSpec,
  PilotTextSpec,
} from './types';

type PilotStyle = CSSProperties & Record<string, string | number | undefined>;

function rpx(value: number): string {
  // Inline styles cannot pass through postcss-pxtransform; 80 Figma px = 1rem in Taro H5.
  return `${value / 80}rem`;
}

function opacityColor(color: string, opacity: number): string {
  if (opacity >= 1 || !/^#[0-9A-F]{6}$/i.test(color)) return color;
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${color}${alpha}`;
}

function radiusValue(node: PilotNodeSpec): string | number {
  if (node.cornerRadii?.length === 4) {
    return node.cornerRadii.map((radius) => rpx(radius)).join(' ');
  }
  if (node.radius != null) return rpx(node.radius);
  if (node.type === 'ELLIPSE') return '50%';
  return 0;
}

function effectShadow(effect: PilotEffectSpec): string {
  const color = opacityColor(effect.color, effect.opacity);
  const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
  return `${inset}${rpx(effect.offsetX)} ${rpx(effect.offsetY)} ${rpx(effect.radius)} ${rpx(effect.spread)} ${color}`;
}

function rotation(node: PilotNodeSpec): string | undefined {
  return node.rotation ? `rotate(${node.rotation}rad)` : undefined;
}

function baseStyle(node: PilotNodeSpec): PilotStyle {
  const style: PilotStyle = {
    position: 'absolute',
    left: rpx(node.x),
    top: rpx(node.y),
    width: rpx(node.width),
    height: rpx(node.height),
    opacity: node.opacity,
    transform: rotation(node),
    transformOrigin: 'center center',
  };
  if (node.blendMode && !['PASS_THROUGH', 'NORMAL'].includes(node.blendMode)) {
    style.mixBlendMode = node.blendMode.toLowerCase().replace(/_/g, '-') as CSSProperties['mixBlendMode'];
  }
  return style;
}

function fillStyle(node: PilotNodeSpec): PilotStyle {
  const style: PilotStyle = baseStyle(node);
  const fill = node.fill;
  if (fill?.type === 'solid' && fill.color) {
    style.backgroundColor = opacityColor(fill.color, fill.opacity ?? 1);
  }
  const radius = radiusValue(node);
  if (radius) style.borderRadius = radius;
  if (node.strokes[0]?.color && node.strokeWeight > 0) {
    style.border = `${rpx(node.strokeWeight)} solid ${opacityColor(node.strokes[0].color, node.strokes[0].opacity)}`;
    style.boxSizing = 'border-box';
  }
  const shadows = node.effects
    .filter((effect) => effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW')
    .map(effectShadow);
  if (shadows.length) style.boxShadow = shadows.join(', ');
  if (node.clipsContent) style.overflow = 'hidden';
  return style;
}

function imageSize(scaleMode?: string): string {
  switch (scaleMode) {
    case 'FIT': return 'contain';
    case 'STRETCH': return '100% 100%';
    case 'TILE': return 'auto';
    default: return 'cover';
  }
}

export function PilotText({ node }: { node: PilotNodeSpec }) {
  const text = node.text as PilotTextSpec;
  const justify = {
    LEFT: 'flex-start',
    CENTER: 'center',
    RIGHT: 'flex-end',
    JUSTIFIED: 'space-between',
  }[text.textAlignHorizontal] || 'flex-start';
  const align = {
    TOP: 'flex-start',
    CENTER: 'center',
    BOTTOM: 'flex-end',
  }[text.textAlignVertical] || 'flex-start';
  const style: PilotStyle = {
    ...baseStyle(node),
    display: 'flex',
    alignItems: align,
    justifyContent: justify,
    color: opacityColor(text.color, text.colorOpacity),
    fontFamily: text.fontFamily.includes('Inter') ? 'Inter, var(--pilot-font)' : 'var(--pilot-font)',
    fontSize: rpx(text.fontSize),
    fontWeight: text.fontWeight,
    lineHeight: rpx(text.lineHeight),
    letterSpacing: rpx(text.letterSpacing),
    textAlign: text.textAlignHorizontal.toLowerCase() as CSSProperties['textAlign'],
    whiteSpace: text.characters.includes('\n') ? 'pre-wrap' : 'pre',
    wordBreak: 'normal',
    overflow: 'visible',
  };
  return <Text className="pilot-node pilot-node--text" style={style}>{text.characters}</Text>;
}

export function PilotMedia({ node }: { node: PilotNodeSpec }) {
  const style: PilotStyle = {
    ...baseStyle(node),
    borderRadius: typeof node.clipRadius === 'string' ? node.clipRadius : node.clipRadius ? rpx(node.clipRadius) : radiusValue(node),
    backgroundImage: node.asset ? `url("${node.asset}")` : undefined,
    backgroundSize: imageSize(node.scaleMode),
    backgroundPosition: 'center center',
    backgroundRepeat: node.scaleMode === 'TILE' ? 'repeat' : 'no-repeat',
    overflow: 'hidden',
  };
  return <View className="pilot-node pilot-node--media" style={style} />;
}

export function PilotVector({ node }: { node: PilotNodeSpec }) {
  const style: PilotStyle = {
    ...baseStyle(node),
    backgroundImage: node.asset ? `url("${node.asset}")` : undefined,
    backgroundSize: '100% 100%',
    backgroundRepeat: 'no-repeat',
  };
  return <View className="pilot-node pilot-node--vector" style={style} />;
}

export function PilotSurface({ node, children }: { node: PilotNodeSpec; children?: ReactNode }) {
  return <View className="pilot-node pilot-node--surface" style={fillStyle(node)}>{children}</View>;
}

export function PilotNode({ node }: { node: PilotNodeSpec }) {
  if (node.kind === 'text') return <PilotText node={node} />;
  if (node.kind === 'image') return <PilotMedia node={node} />;
  if (node.kind === 'baked') return <PilotVector node={node} />;
  return (
    <PilotSurface node={node}>
      {(node.children || []).map((child) => <PilotNode key={child.id} node={child} />)}
    </PilotSurface>
  );
}

export function PilotFrame({ frame }: { frame: PilotFrameSpec }) {
  const style: PilotStyle = {
    width: rpx(frame.width),
    height: rpx(frame.height),
    backgroundColor: frame.background,
  };
  return (
    <View className="pilot-frame" data-frame={frame.id} style={style}>
      {frame.nodes.map((node) => <PilotNode key={node.id} node={node} />)}
    </View>
  );
}
