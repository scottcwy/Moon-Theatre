import React from 'react';
import { describe, expect, it } from 'vitest';
import PlaybookPage from './index';

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

function hasClass(node: RenderedNode, className: string): boolean {
  return String(node.props.className ?? '').split(' ').includes(className);
}

describe('PlaybookPage', () => {
  it('mounts in the standalone playbook shell without depending on app APIs', () => {
    const page = renderElement(<PlaybookPage />);
    const copy = textContent(page);

    expect(page.props.className).toContain('page-shell--no-padding');
    expect(page.props.className).toContain('playbook-shell');
    expect(findByClass(page, 'playbook-scroll').props.scrollY).toBe(true);
    expect(copy).toContain('组件 Playbook');
    expect(copy).toContain('独立小程序预览正式 UI 组件，不接 API、不接登录、不污染主包。');
    expect(copy).not.toContain('api.example.com');
  });

  it('covers the functional component families used by the miniapp UI package', () => {
    const page = renderElement(<PlaybookPage />);
    const sectionTitles = findAll(page, (node) => hasClass(node, 'playbook-section__title')).map(textContent);

    expect(sectionTitles).toEqual([
      'Buttons',
      'Inputs',
      'Badges',
      'Lists',
      'Avatars',
      'Discovery',
      'Commerce',
      'Memory',
      'Status',
      'Page Primitives',
      'Bottom Action',
      'Chat Bubble',
    ]);
    expect(findAll(page, (node) => hasClass(node, 'ui-button'))).not.toHaveLength(0);
    expect(findAll(page, (node) => hasClass(node, 'ui-search-bar'))).toHaveLength(3);
    expect(findAll(page, (node) => hasClass(node, 'chat-bubble-row'))).toHaveLength(4);
    expect(findByClass(page, 'playbook-floating-action').props.className).toContain('bottom-action--default');
  });
});
