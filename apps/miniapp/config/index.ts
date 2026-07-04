import path from 'path';
import { getApiBaseUrlForMode } from './api-base-url';

function getApiBaseUrl(): string {
  const isDevBuild = process.env.NODE_ENV === 'development' || process.argv.includes('--watch');
  return getApiBaseUrlForMode(isDevBuild ? 'development' : 'production');
}

const apiBaseUrl = getApiBaseUrl();

const config = {
  projectName: 'juben-sha-miniapp',
  date: '2026-6-11',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: ['@tarojs/plugin-framework-react'],
  defineConstants: {
    API_BASE_URL: JSON.stringify(apiBaseUrl),
    DEV_AUTH_BYPASS: JSON.stringify(process.env.DEV_AUTH_BYPASS === 'true'),
    API_DEBUG_LOGS: JSON.stringify(process.env.API_DEBUG_LOGS === 'true'),
  },
  copy: {
    patterns: [
      {
        from: 'src/assets',
        to: 'dist/assets',
      },
      {
        from: 'sitemap.json',
        to: 'dist/sitemap.json',
      },
    ],
    options: {},
  },
  framework: 'react',
  compiler: 'webpack5',
  mini: {
    compile: {
      include: [
        path.resolve(__dirname, '../../../packages/shared/src'),
        path.resolve(__dirname, '../../../packages/miniapp-ui/src'),
      ],
    },
    webpackChain(chain) {
      chain.resolve.set('extensionAlias', {
        '.js': ['.ts', '.tsx', '.js'],
        '.mjs': ['.mts', '.mjs'],
      });
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      pxtransform: { enable: true, config: {} },
    },
  },
};

module.exports = config;
