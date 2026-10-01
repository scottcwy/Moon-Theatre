import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BaseButton, BottomTabBar, Icon, LayoutProvider, PageShell, Surface, Text, useLayout } from '../index';

describe('visual foundation components', () => {
  it('exposes the frozen PageShell slots and modes without owning page behavior', () => {
    const header = <Text variant="title">标题</Text>;
    const footer = <Text variant="label">底部</Text>;
    const shell = PageShell({
      variant: 'full',
      navMode: 'custom',
      tabBarMode: 'custom',
      bottomInset: 'safe',
      header,
      footer,
      children: '内容',
    });

    expect(React.isValidElement(shell)).toBe(true);
    expect(String(shell.props.className)).toContain('page-shell--full');
    expect(String(shell.props.className)).toContain('page-shell--nav-custom');
    expect(String(shell.props.className)).toContain('page-shell--tabbar-custom');
    expect(shell.props.children).toHaveLength(3);
  });

  it('keeps primitive states semantic and callbacks explicit', () => {
    const onPress = vi.fn();
    const button = BaseButton({ children: '继续', size: 'sm', tone: 'primary', onPress });
    const surface = Surface({ children: '内容', tone: 'elevated' });
    const text = Text({ children: '正文', variant: 'body', tone: 'secondary' });
    const icon = Icon({ name: 'arrow-left', label: '返回' });

    expect(String(button.props.className)).toContain('ui-button--sm');
    button.props.onTap();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(String(surface.props.className)).toContain('ui-surface--elevated');
    expect(String(text.props.className)).toContain('ui-text--secondary');
    expect(icon.props['aria-label']).toBe('返回');
  });

  it('renders a pure tab bar and reports semantic selection events', () => {
    const onSelect = vi.fn();
    const tabBar = BottomTabBar({
      items: [
        { key: 'home', label: '首页', icon: 'home.png' },
        { key: 'profile', label: '我的', icon: 'profile.png' },
      ],
      selectedKey: 'home',
      onSelect,
    });

    expect(String(tabBar.props.className)).toContain('bottom-tab-bar');
    const selected = tabBar.props.children[0];
    expect(String(selected.props.className)).toContain('bottom-tab-bar__item--selected');
    selected.props.onTap();
    expect(onSelect).toHaveBeenCalledWith('home');
  });

  it('provides deterministic H5-safe layout defaults and accepts fixture metrics', () => {
    const provider = LayoutProvider({
      metrics: { statusBarHeight: 20, safeAreaBottom: 0, capsule: { width: 90 } },
      children: 'fixture',
    });
    expect(provider.props.value).toMatchObject({
      statusBarHeight: 20,
      safeAreaBottom: 0,
      capsule: { width: 90, height: 32 },
    });
    expect(useLayout).toEqual(expect.any(Function));
  });
});
