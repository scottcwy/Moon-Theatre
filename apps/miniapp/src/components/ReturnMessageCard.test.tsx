import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnMessageCard } from './ReturnMessageCard';

vi.mock('@tarojs/components', () => ({
  Image: 'image',
  Text: 'text',
  View: 'view',
}));

interface RenderedNode {
  type: string;
  props: Record<string, unknown>;
  children: RenderedChild[];
}

type RenderedChild = RenderedNode | string | number | boolean | null;

function renderNode(node: React.ReactNode): RenderedChild {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return null;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return node;
  }
  if (Array.isArray(node)) {
    return {
      type: 'fragment',
      props: {},
      children: node.map(renderNode),
    };
  }
  if (!React.isValidElement(node)) {
    return String(node);
  }
  if (typeof node.type === 'function') {
    const Component = node.type as unknown as (props: unknown) => React.ReactNode;
    return renderNode(Component(node.props));
  }
  return {
    type: String(node.type),
    props: node.props as Record<string, unknown>,
    children: React.Children.toArray(node.props.children).map(renderNode),
  };
}

function renderElement(element: React.ReactElement): RenderedNode {
  const rendered = renderNode(element);
  if (typeof rendered !== 'object' || rendered === null) {
    throw new Error('Expected a rendered node');
  }
  return rendered;
}

function isRenderedNode(node: RenderedChild): node is RenderedNode {
  return Boolean(node && typeof node === 'object' && 'type' in node && 'props' in node);
}

function textContent(node: RenderedChild): string {
  if (!isRenderedNode(node)) {
    return node ? String(node) : '';
  }
  return node.children.map(textContent).join('');
}

function findAll(node: RenderedChild, predicate: (candidate: RenderedNode) => boolean): RenderedNode[] {
  if (!isRenderedNode(node)) {
    return [];
  }
  const matches = predicate(node) ? [node] : [];
  for (const child of node.children) {
    matches.push(...findAll(child, predicate));
  }
  return matches;
}

function findByClass(node: RenderedChild, className: string): RenderedNode {
  const match = findAll(node, (candidate) => String(candidate.props.className ?? '').split(' ').includes(className))[0];
  if (!match) {
    throw new Error(`Missing node with class ${className}`);
  }
  return match;
}

describe('ReturnMessageCard', () => {
  it('renders character name, content, time, unread dot, and fires onTap', () => {
    const onTap = vi.fn();
    const card = renderElement(
      <ReturnMessageCard
        characterName="白藏"
        content="回来吧，月下等你。"
        timeLabel="昨天"
        unread
        onTap={onTap}
      />,
    );

    expect(textContent(card)).toContain('白藏');
    expect(textContent(card)).toContain('回来吧，月下等你。');
    expect(textContent(card)).toContain('昨天');
    expect(card.props.className).toContain('return-message-card--unread');
    findByClass(card, 'return-message-card__unread-dot');
    (card.props.onTap as () => void)();
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('uses a first-character placeholder when no avatar is provided and hides the dot when not unread', () => {
    const card = renderElement(<ReturnMessageCard characterName="月岛澪" content="晚安。" />);

    expect(card.props.className).not.toContain('return-message-card--unread');
    const placeholder = findByClass(card, 'return-message-card__avatar-text');
    expect(textContent(placeholder)).toBe('月');
    expect(
      findAll(card, (node) => String(node.props.className ?? '').includes('return-message-card__unread-dot')),
    ).toHaveLength(0);
  });

  it('renders the avatar image when avatarUrl is provided', () => {
    const card = renderElement(
      <ReturnMessageCard characterName="白藏" avatarUrl="/assets/characters/hakuzo.jpg" content="回来吧。" />,
    );

    const image = findByClass(card, 'return-message-card__avatar-image');
    expect(image.props.src).toBe('/assets/characters/hakuzo.jpg');
  });
});
