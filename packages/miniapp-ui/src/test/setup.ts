import { vi } from 'vitest';
import React from 'react';

vi.stubGlobal('ENABLE_INNER_HTML', false);
vi.stubGlobal('ENABLE_ADJACENT_HTML', false);
vi.stubGlobal('ENABLE_SIZE_APIS', false);
vi.stubGlobal('ENABLE_TEMPLATE_CONTENT', false);
vi.stubGlobal('ENABLE_CLONE_NODE', false);
vi.stubGlobal('ENABLE_CONTAINS', false);
vi.stubGlobal('ENABLE_MUTATION_OBSERVER', false);
vi.stubGlobal('ENABLE_DOMCONTENTLOADED', false);

vi.mock('@tarojs/components', () => {
  const createComponent = (name: string) => {
    return ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement(name, props, children);
  };

  return {
    Image: createComponent('image'),
    Input: createComponent('input'),
    ScrollView: createComponent('scroll-view'),
    Text: createComponent('text'),
    View: createComponent('view'),
  };
});
