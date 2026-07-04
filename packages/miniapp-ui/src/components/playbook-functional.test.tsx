import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  BaseButton,
  BottomAction,
  CharacterPosterCard,
  ChatBubble,
  ChatSessionRow,
  IconButton,
  PageShell,
  QuotaPackageCard,
  SearchBar,
} from '../index';

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
  if (!isRenderedNode(rendered)) {
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

function findByType(node: RenderedChild, type: string): RenderedNode {
  const match = findAll(node, (candidate) => candidate.type === type)[0];
  if (!match) {
    throw new Error(`Missing node of type ${type}`);
  }
  return match;
}

describe('playbook component functional behavior', () => {
  it('keeps button and icon button taps gated by disabled state', () => {
    const onButtonTap = vi.fn();
    const activeButton = renderElement(<BaseButton onTap={onButtonTap}>继续</BaseButton>);
    (activeButton.props.onTap as () => void)();
    expect(onButtonTap).toHaveBeenCalledTimes(1);
    expect(activeButton.props.className).toBe('ui-button ui-button--primary ui-button--lg');

    const disabledButton = renderElement(<BaseButton disabled onTap={onButtonTap}>禁用</BaseButton>);
    expect(disabledButton.props.onTap).toBeUndefined();
    expect(disabledButton.props.className).toContain('ui-button--disabled');

    const onIconTap = vi.fn();
    const iconButton = renderElement(<IconButton label="确认" icon="✓" tone="primary" onTap={onIconTap} />);
    expect(iconButton.props['aria-label']).toBe('确认');
    (iconButton.props.onTap as () => void)();
    expect(onIconTap).toHaveBeenCalledTimes(1);

    const disabledIconButton = renderElement(<IconButton label="收藏" icon="☆" disabled onTap={onIconTap} />);
    expect(disabledIconButton.props.onTap).toBeUndefined();
    expect(disabledIconButton.props.className).toContain('ui-icon-button--disabled');
  });

  it('keeps search input, clear action, and disabled state functional', () => {
    const onInput = vi.fn();
    const onClear = vi.fn();
    const search = renderElement(<SearchBar value="白藏" className="host-surface-dark" onInput={onInput} onClear={onClear} />);
    const input = findByType(search, 'input');
    const clear = findByClass(search, 'ui-search-bar__clear');

    expect(search.props.className).toContain('host-surface-dark');
    expect(input.props.value).toBe('白藏');
    (input.props.onInput as (event: { detail: { value: string } }) => void)({ detail: { value: '月岛' } });
    (clear.props.onTap as () => void)();
    expect(onInput).toHaveBeenCalledWith('月岛');
    expect(onClear).toHaveBeenCalledTimes(1);

    const emptySearch = renderElement(<SearchBar value="" clearable={false} />);
    expect(findAll(emptySearch, (node) => String(node.props.className ?? '').includes('ui-search-bar__clear'))).toHaveLength(0);

    const disabledSearch = renderElement(<SearchBar disabled placeholder="不可搜索" />);
    expect(disabledSearch.props.className).toContain('ui-search-bar--disabled');
    expect(findByType(disabledSearch, 'input').props.disabled).toBe(true);
  });

  it('preserves card fallback content, selection flags, and tap behavior', () => {
    const onSessionTap = vi.fn();
    const session = renderElement(<ChatSessionRow characterName="月岛澪" preview="" unread onTap={onSessionTap} />);
    (session.props.onTap as () => void)();
    expect(onSessionTap).toHaveBeenCalledTimes(1);
    expect(textContent(session)).toContain('还没有聊天内容');
    expect(textContent(session)).toContain('月');
    expect(findAll(session, (node) => String(node.props.className ?? '').includes('chat-session-row__unread-dot'))).toHaveLength(1);

    const poster = renderElement(<CharacterPosterCard title="贺茂清玄" subtitle="冷面阴阳师" badge="Lv.1" selected />);
    expect(poster.props.className).toContain('character-poster-card--selected');
    expect(textContent(poster)).toContain('贺茂');
    expect(textContent(poster)).toContain('Lv.1');

    const onPackageTap = vi.fn();
    const quota = renderElement(
      <QuotaPackageCard name="沉浸一幕" points={128} price="¥18.00" selected recommended onTap={onPackageTap} />,
    );
    (quota.props.onTap as () => void)();
    expect(onPackageTap).toHaveBeenCalledTimes(1);
    expect(quota.props.className).toContain('quota-package-card--selected');
    expect(quota.props.className).toContain('quota-package-card--recommended');

    const disabledQuota = renderElement(<QuotaPackageCard name="禁用包" points={0} price="¥0.00" disabled onTap={onPackageTap} />);
    expect(disabledQuota.props.onTap).toBeUndefined();
    expect(disabledQuota.props.className).toContain('quota-package-card--disabled');
  });

  it('renders chat roles and empty assistant states without losing context', () => {
    const systemBubble = renderElement(<ChatBubble role="system" content="第 3 幕 · 月下庭院" />);
    expect(systemBubble.props.className).toContain('chat-bubble-row--system');
    expect(textContent(systemBubble)).toContain('第 3 幕 · 月下庭院');

    const userBubble = renderElement(<ChatBubble role="user" content="这里发生过什么？" />);
    expect(userBubble.props.className).toContain('chat-bubble-row--user');
    expect(findAll(userBubble, (node) => String(node.props.className ?? '').includes('character-avatar'))).toHaveLength(0);

    const assistantBubble = renderElement(<ChatBubble role="assistant" characterName="白藏" mood="thinking" fallback typing content="" />);
    expect(assistantBubble.props.className).toContain('chat-bubble-row--assistant');
    expect(textContent(assistantBubble)).toContain('正在输入...');
    expect(textContent(assistantBubble)).toContain('思索中');
    expect(textContent(assistantBubble)).toContain('本地模式');
  });

  it('keeps layout components stable across host miniapp background surfaces', () => {
    const hostSurfaces = ['host-background', 'host-surface-container', 'host-dark-scene'];

    for (const surfaceClass of hostSurfaces) {
      const shell = renderElement(
        <PageShell variant="full" noPadding tabBarReserve bottomReserve className={surfaceClass}>
          内容
        </PageShell>,
      );
      expect(shell.props.className).toContain('page-shell--full');
      expect(shell.props.className).toContain('page-shell--no-padding');
      expect(shell.props.className).toContain('page-shell--tabbar');
      expect(shell.props.className).toContain('page-shell--bottom-reserve');
      expect(shell.props.className).toContain(surfaceClass);
    }

    expect(renderElement(<BottomAction variant="default">操作</BottomAction>).props.className).toContain('bottom-action--default');
    expect(renderElement(<BottomAction variant="dark">操作</BottomAction>).props.className).toContain('bottom-action--dark');
    expect(renderElement(<BottomAction variant="transparent">操作</BottomAction>).props.className).toContain('bottom-action--transparent');
  });
});
