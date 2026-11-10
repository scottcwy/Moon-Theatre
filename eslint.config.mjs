import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.swc/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // 平台差异实现保留与另一平台一致的签名，未使用的参数以 `_` 前缀标记。
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // 首页用 require 加载视觉 fixture，靠编译期常量让生产构建整段移除；静态 import 会把 fixture JSON 打进生产主包。
    // 源文件形态受 apps/miniapp/e2e/visual-fixture-boundary.test.mjs 约束，不能插入行内 disable 注释。
    files: ['apps/miniapp/src/pages/home/index.tsx'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
